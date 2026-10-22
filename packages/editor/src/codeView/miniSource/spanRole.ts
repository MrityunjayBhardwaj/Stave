/**
 * spanRole — the DISPOSAL half of "eval proposes, AST disposes".
 *
 * Evaluation finds the candidate spans (the hard half: it crosses bindings,
 * chained transforms, `pick`, `voicing` and every other combinator without our
 * modelling any of them). This module answers ONE structural bit per candidate:
 *
 *     is this span the pattern SOURCE, or a control's ARGUMENT?
 *
 * The rule is about POSITION in the expression, never about a vocabulary of head
 * names. `s("bd sd")` as a head call is drum content; `.s("gm_trumpet")` after a
 * pattern source is a timbre. A resolver that scanned for a "view head" by name
 * admitted 30 timbres as content and every downstream gate passed them — a
 * one-cell view of an instrument name parses, serialises and round-trips
 * perfectly, because deleting the only cell of a one-cell grid IS a faithful
 * edit. So the disposal is positional and the only names it reads are `note`/`n`
 * (see `NOTE_OVERRIDE` below).
 *
 * It also FOLLOWS BINDINGS in both directions: a span inside `const drums =
 * "Linn9000"` is judged by how `drums` is USED, so `.bank(drums)` disposes as an
 * argument exactly as `.bank("Linn9000")` does.
 */
import { parseTopLevel } from '../astParse'
import type { Span, SpanRole } from './types'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The ONLY method names this module reads, and the reason it may.
 *
 * A chain has exactly one pattern source, but two shapes put a string in front
 * of it: `"gm_pad_warm".note("<c4 e4>")` (root position) and
 * `n(lh).scale("C:major")` (a control argument). In root position the ROOT is
 * the timbre and the note content lives in the mid-chain `.note(…)` argument —
 * the one case where a mid-chain argument is content rather than a control
 * value. Position alone cannot decide it: both are "a string argument to a
 * member call". `note`/`n` are the note-content controls, so they are the
 * override, and nothing else is.
 */
const NOTE_OVERRIDE: ReadonlySet<string> = new Set(['note', 'n'])

interface Parented {
  parent: Map<any, any>
  /** every string/template literal node, innermost-last */
  literals: any[]
  /** `name` → declarator node, for simple `const x = <init>` bindings */
  bindings: Map<string, any>
  /** `name` → every Identifier node that READS the binding (its declarator's id excluded) */
  refs: Map<string, any[]>
}

function walk(node: any, parent: any, ctx: Parented): void {
  if (!node || typeof node.type !== 'string') return
  ctx.parent.set(node, parent)
  if (isMiniLiteral(node)) ctx.literals.push(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, node, ctx))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, node, ctx)
  }
}

/**
 * A string that can carry mini-notation: a string Literal or a TemplateLiteral.
 *
 * SINGLE-quoted literals are included here deliberately — they are mini-parsed
 * at runtime like any other string, so the parse walk can serve them. What they
 * do NOT have is a document-space hap location (the transpiler rewrites only
 * double-quoted and template literals), which is why the eval proposer never
 * offers one and the parse walk is their only route.
 */
function isMiniLiteral(node: any): boolean {
  if (node.type === 'Literal' && typeof node.value === 'string') return true
  if (node.type === 'TemplateLiteral') return true
  return false
}

/** The interior span of a mini literal — quotes/backticks excluded. */
export function literalInterior(node: any): Span {
  return [node.start + 1, node.end - 1]
}

/** Does `node` lie wholly inside one of `ranges`? */
function containedIn(node: any, ranges: Span[]): boolean {
  return ranges.some((r) => node.start >= r[0] && node.end <= r[1])
}

export class SpanIndex {
  private ctx: Parented

  private constructor(ctx: Parented) {
    this.ctx = ctx
  }

  /** Build the index for a document, or null when it does not parse. */
  static build(doc: string): SpanIndex | null {
    const program = parseTopLevel(doc)
    if (!program) return null
    const ctx: Parented = {
      parent: new Map(),
      literals: [],
      bindings: new Map(),
      refs: new Map(),
    }
    for (const stmt of program) walk(stmt, null, ctx)

    // Bindings: mirror `chunkDetect.buildBindingIndex`'s D-02 rule — a name
    // declared more than once is ambiguous and dropped entirely.
    const dropped = new Set<string>()
    for (const stmt of program) {
      if (stmt?.type !== 'VariableDeclaration' || !Array.isArray(stmt.declarations)) continue
      for (const decl of stmt.declarations) {
        if (decl?.id?.type !== 'Identifier' || !decl.init) continue
        const name = decl.id.name
        if (ctx.bindings.has(name) || dropped.has(name)) {
          ctx.bindings.delete(name)
          dropped.add(name)
          continue
        }
        ctx.bindings.set(name, decl)
      }
    }
    // References: every Identifier that is not a declarator id, not a member
    // property, and not an object key.
    for (const [node, parent] of ctx.parent) {
      if (node?.type !== 'Identifier') continue
      if (parent?.type === 'VariableDeclarator' && parent.id === node) continue
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) continue
      if (parent?.type === 'Property' && parent.key === node && !parent.computed) continue
      if (parent?.type === 'LabeledStatement' && parent.label === node) continue
      const list = ctx.refs.get(node.name)
      if (list) list.push(node)
      else ctx.refs.set(node.name, [node])
    }
    return new SpanIndex(ctx)
  }

  /** Every mini literal in the document, innermost-last. */
  get literals(): readonly any[] {
    return this.ctx.literals
  }

  /** The innermost mini literal whose INTERIOR contains `span`, or null. */
  literalFor(span: Span): any | null {
    let best: any = null
    for (const lit of this.ctx.literals) {
      const [s, e] = literalInterior(lit)
      if (span[0] >= s && span[1] <= e) {
        if (!best || lit.start >= best.start) best = lit
      }
    }
    return best
  }

  /** The role of the literal enclosing `span`, or `unknown` when there is none. */
  roleOfSpan(span: Span, boundary: Span[]): SpanRole {
    const lit = this.literalFor(span)
    return lit ? this.roleOfNode(lit, boundary) : 'unknown'
  }

  /**
   * The role of a VALUE-producing node, decided by its syntactic position.
   *
   * Every arm is a position, not a name, with the single stated exception of
   * `NOTE_OVERRIDE`. Positions the rule does not claim to judge return
   * `unknown` and are never treated as content.
   */
  roleOfNode(node: any, boundary: Span[], seen: Set<string> = new Set()): SpanRole {
    return this.computeRole(node, boundary, seen)
  }

  private computeRole(node: any, boundary: Span[], seen: Set<string>): SpanRole {
    let child = node
    let parent = this.ctx.parent.get(child)
    // Walk outward until a position that decides. Transparent wrappers
    // (array elements, object values, parenthesised/awaited expressions) carry
    // the question up: an `arrange([4, pat])` arm and a `pick({verse: pat})`
    // section are the enclosing call's arguments.
    for (let guard = 0; parent && guard < 64; guard++) {
      // THE CLIMB IS BOUNDED BY THE UNIT. Once the value has escaped the unit's
      // own expression it IS the unit's pattern, and how some OUTER expression
      // consumes it is a different question — `"< 0!8 1!12 >".pick([intro,
      // core1])` consumes six whole voices as arguments, and judging their
      // contents by that outer position would call every one of them a control
      // value. A binding hop is not an escape (`VariableDeclarator` is handled
      // below), because there the question genuinely moves to the reference.
      if (parent.type !== 'VariableDeclarator' && !containedIn(parent, boundary)) return 'source'
      switch (parent.type) {
        case 'CallExpression': {
          if (parent.callee === child) {
            // we climbed out of `.method` into its call — keep climbing
            child = parent
            parent = this.ctx.parent.get(child)
            continue
          }
          if (Array.isArray(parent.arguments) && parent.arguments.includes(child)) {
            const callee = parent.callee
            if (callee?.type === 'Identifier') {
              // Head call: `s("bd sd")`, `note("c3")`, `gain("[.5 1]")`. The
              // argument is this call's pattern source — but only as far as the
              // CALL itself is a source. `.mul(gain("[.5 1]"))` is a head call
              // sitting inside a control's argument, and its literal is a gain
              // curve, not content.
              return this.roleOfNode(parent, boundary, seen)
            }
            if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
              // Mid-chain. A control's argument — EXCEPT the note-content
              // override, and only when the chain has no head call of its own
              // to be the source: `"gm_pad_warm".note("<c4 e4>")` overrides a
              // root literal, `sound("hh").note("c2")` does not override the
              // `sound(…)` the harness edits.
              if (NOTE_OVERRIDE.has(callee.property.name) && !this.chainRootIsCall(parent)) {
                return this.roleOfNode(parent, boundary, seen)
              }
              return 'argument'
            }
            return 'unknown'
          }
          return 'unknown'
        }
        case 'TaggedTemplateExpression':
          // `mondo\`…\`` / `tidal\`…\`` — the quasi IS the pattern source.
          return parent.quasi === child ? this.roleOfNode(parent, boundary, seen) : 'unknown'
        case 'MemberExpression': {
          if (parent.object !== child) return 'unknown'
          // Root position. The value flows into the chain as its source, so the
          // question becomes the CHAIN's role — `"-1 | 1 | 2".fast(2)` is a
          // whole chain that happens to sit inside `.speed(…)`, and stopping
          // here would call its literal content.
          //
          // One exception: a root LITERAL under a note-content override is the
          // timbre, not the content (`"gm_pad_warm".note("<c4 e4>")`).
          if (isMiniLiteral(child) && this.chainOverridesRoot(parent)) return 'argument'
          child = parent
          parent = this.ctx.parent.get(child)
          continue
        }
        case 'VariableDeclarator': {
          if (parent.init !== child) return 'unknown'
          // The unit IS this binding (`let crackles = sound("crackle")…`, bound
          // into a `stack`): the value has escaped the unit's expression, so it
          // is the unit's pattern. Only a binding the unit REFERENCES asks the
          // usage question.
          if (boundary.length > 0 && containedIn(parent.init, [boundary[0]])) return 'source'
          const name = parent.id?.type === 'Identifier' ? parent.id.name : null
          if (!name || seen.has(name)) return 'unknown'
          seen.add(name)
          return this.roleOfBinding(name, boundary)
        }
        case 'ExpressionStatement':
        case 'LabeledStatement':
          // a bare pattern statement — the value IS the pattern
          return 'source'
        case 'ArrayExpression':
        case 'Property':
        case 'ObjectExpression':
        case 'ParenthesizedExpression':
        case 'AwaitExpression':
        case 'SequenceExpression':
        case 'ConditionalExpression':
        // A pattern-producing helper (`let bass = (lpf) => n("…").lpf(lpf)`) is
        // called where a pattern is wanted, so the body's role is the role of
        // the CALL. Transparency is what carries that through — and it is not a
        // way in for lambdas that are themselves control arguments, because
        // `.sometimes(x => x.note("c3"))`'s literal is decided at `.note`'s own
        // chain long before the arrow is reached.
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'ReturnStatement':
        case 'BlockStatement':
          // transparent: ask the enclosing position instead
          child = parent
          parent = this.ctx.parent.get(child)
          continue
        default:
          return 'unknown'
      }
    }
    return 'unknown'
  }

  /**
   * Does the chain containing `call` bottom out at a CALL (`sound("hh").note(…)`)
   * rather than at a bare literal or identifier (`"gm_pad_warm".note(…)`)?
   *
   * A chain with a head call already has its source — the head's argument — so a
   * mid-chain `note`/`n` there is an ordinary control. Only a chain rooted at a
   * bare value has no source of its own for the override to replace.
   */
  private chainRootIsCall(call: any): boolean {
    let node = call
    for (let guard = 0; node && guard < 64; guard++) {
      if (node.type === 'CallExpression') {
        const callee = node.callee
        if (callee?.type === 'Identifier') return true
        if (callee?.type === 'MemberExpression') {
          node = callee.object
          continue
        }
        return false
      }
      if (node.type === 'MemberExpression') {
        node = node.object
        continue
      }
      return false
    }
    return false
  }

  /**
   * Does the member chain rooted at `member` apply a note-content control?
   * Walks OUTWARD from the root member expression through the call spine.
   */
  private chainOverridesRoot(member: any): boolean {
    let node: any = member
    let parent = this.ctx.parent.get(node)
    for (let guard = 0; parent && guard < 64; guard++) {
      if (parent.type === 'CallExpression' && parent.callee === node) {
        const prop = node.type === 'MemberExpression' ? node.property : null
        if (prop?.type === 'Identifier' && NOTE_OVERRIDE.has(prop.name)) {
          // An override only when the call CARRIES a note argument. `.note()`
          // with none is the opposite operation — it reifies the root itself as
          // note content (`"0 5 3 2".scale('G4 minor').note()`), so the root
          // stays the source. Any argument counts, not just a literal one: a
          // bound argument (`"gm_pad_warm".note(mel)`) is the same shape, and
          // requiring a literal made the answer depend on which of the two
          // strings happened to be written first in the document.
          if ((parent.arguments ?? []).length > 0) return true
        }
        node = parent
        parent = this.ctx.parent.get(node)
        continue
      }
      if (parent.type === 'MemberExpression' && parent.object === node) {
        node = parent
        parent = this.ctx.parent.get(node)
        continue
      }
      return false
    }
    return false
  }

  /**
   * The role of a BOUND value, decided by how the binding is USED.
   *
   * `const drums = "Linn9000"` is content or a bank name depending entirely on
   * whether `drums` appears as `s(drums)` or as `.bank(drums)`. Judging the
   * initialiser by its own position gets this wrong in the direction that
   * matters: `const x = "…"` is not syntactically anybody's argument, so a
   * position-only rule keeps every bound control argument.
   *
   * THE QUESTION IS SCOPED TO THE UNIT, because a role is a property of a
   * REFERENCE and a unit only ever sees its own. Asking it of the whole document
   * manufactures ties that do not exist locally, and the ranking then resolves
   * them by source order: `var ch = "[Am C G <Em F>]/8"` is a pattern source in
   * `chord(ch).voicing()` and a control argument in
   * `n("[0 1 <- 2>…]*2").chord(ch)`, and a document-wide verdict of `source`
   * hands the second unit the first one's chord progression as its own content —
   * because `ch` is declared at the top of the file and the ranking breaks ties
   * on source order. `boundary` is the unit's own expression plus the initialiser
   * of every binding it reaches, so filtering references to it asks only about
   * the uses this unit can actually see.
   *
   * A binding used both ways WITHIN one unit still resolves as `source`: losing
   * real content is the worse error of the two. That tie-break is a JUDGEMENT
   * CALL, so `mixedUseBindings()` reports the population it could apply to and
   * `tieBreakFired` counts how often it actually decides — a guard believed
   * load-bearing is a false claim about the code.
   */
  private roleOfBinding(name: string, boundary: Span[]): SpanRole {
    const all = this.ctx.refs.get(name) ?? []
    // Fall back to every reference only when there is no boundary to scope by
    // (`roleOfNode` called without one) — never as a way to widen the question.
    const mine = boundary.length
      ? all.filter((r: any) => boundary.some(([s, e]) => r.start >= s && r.end <= e))
      : all
    const refs = mine.length ? mine : all
    let sawArgument = false
    let sawSource = false
    for (const ref of refs) {
      // ONE STEP, not a climb. The question a binding asks is only "is this
      // name consumed as a pattern, or as a control's argument value" — and
      // that is answered by the position the reference sits in. Climbing on
      // would ask how the CONSUMER's own value is used, which is a different
      // unit's question and (for a name used by several units) would be
      // answered against whichever statement happened to come first.
      const r = this.roleOfRef(ref)
      if (r === 'source') sawSource = true
      else if (r === 'argument') sawArgument = true
    }
    // Both, inside this unit: the tie-break decides, and says so out loud.
    if (sawSource && sawArgument) this.tieBreakFired++
    if (sawSource) return 'source'
    // No reference decided: an unused binding, or one used only in positions
    // this rule does not judge. Neither content nor a control value.
    return sawArgument ? 'argument' : 'unknown'
  }

  /**
   * How many times the mixed-use tie-break actually DECIDED a role — a binding
   * referenced both ways within one unit's boundary. Scoping the question to the
   * unit is expected to make this rare or zero; if it is zero over the corpus the
   * tie-break is DEFENSIVE, and saying so is more honest than leaving a comment
   * claiming it carries weight.
   */
  tieBreakFired = 0

  /**
   * Bindings referenced BOTH as a pattern and as a control argument SOMEWHERE in
   * the document. This is the population the tie-break could apply to, not the
   * set it decides: `roleOfBinding` scopes the question to one unit's references,
   * so a binding can be mixed-use document-wide and unambiguous in every unit
   * that reads it. Compare with `tieBreakFired`, which counts the decisions.
   */
  mixedUseBindings(): string[] {
    const out: string[] = []
    for (const [name] of this.ctx.bindings) {
      let src = false
      let arg = false
      for (const ref of this.ctx.refs.get(name) ?? []) {
        const r = this.roleOfRef(ref)
        if (r === 'source') src = true
        else if (r === 'argument') arg = true
      }
      if (src && arg) out.push(name)
    }
    return out
  }

  /**
   * The role of ONE reference to a binding, from the position that consumes it.
   * Transparent wrappers are stepped through; nothing else is climbed.
   */
  private roleOfRef(ref: any): SpanRole {
    let child = ref
    let parent = this.ctx.parent.get(child)
    for (let guard = 0; parent && guard < 32; guard++) {
      switch (parent.type) {
        case 'CallExpression': {
          if (!Array.isArray(parent.arguments) || !parent.arguments.includes(child)) return 'source'
          const callee = parent.callee
          if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
            return NOTE_OVERRIDE.has(callee.property.name) ? 'source' : 'argument'
          }
          return 'source'
        }
        case 'ArrayExpression':
        case 'Property':
        case 'ObjectExpression':
        case 'ParenthesizedExpression':
        case 'AwaitExpression':
        case 'SequenceExpression':
          child = parent
          parent = this.ctx.parent.get(child)
          continue
        default:
          // a statement, a chain root, a declarator — consumed as a pattern
          return 'source'
      }
    }
    return 'source'
  }

  /**
   * Ranges a span may live in and still belong to `exprRange`: the expression
   * itself, plus the initialiser of every binding it references, transitively.
   * This is what lets an eval-proposed span in ANOTHER top-level statement be
   * attributed to the unit that plays it.
   *
   * Walks REFERENCES, not every identifier that happens to spell a binding's
   * name. Method names are identifiers too, and Strudel's vocabulary collides
   * with the names people give their patterns constantly — `.cpm(…)` beside
   * `let cpm`, and `.p1`/`.d1` (the repl's pattern getters) beside `let p1`,
   * `let d1`, which is a real document in the corpus. A name-based scan pulls
   * those unrelated initialisers into the unit's reachable set, and a span
   * belonging to another statement then becomes admissible content for this one.
   * Measured: 37 of 148 documents contain at least one such collision.
   */
  reachableRanges(exprRange: Span): Span[] {
    const out: Span[] = [exprRange]
    const seen = new Set<string>()
    const queue: Span[] = [exprRange]
    while (queue.length) {
      const [s, e] = queue.shift()!
      for (const [name, refs] of this.ctx.refs) {
        if (seen.has(name)) continue
        if (!refs.some((r: any) => r.start >= s && r.end <= e)) continue
        const decl = this.ctx.bindings.get(name)
        if (!decl) continue
        seen.add(name)
        const range: Span = [decl.init.start, decl.init.end]
        out.push(range)
        queue.push(range)
      }
    }
    return out
  }
}
