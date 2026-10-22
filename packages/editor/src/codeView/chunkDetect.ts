/**
 * chunkDetect — selection → chunk.
 *
 * The parsing half of the visual-editing spine. Strudel programs are plain
 * JS (`$: s("bd")` is a LabeledStatement, bare patterns are
 * ExpressionStatements), so we parse with acorn and break the statement
 * under the cursor into the pieces the visual panels act on: the head call,
 * its mini-notation string, and the method chain with per-argument ranges.
 *
 * Everything here is PURE (string in, plain-object out) — no Monaco, no
 * IndexedDB — so it unit-tests with plain assertions. The companion
 * `writeback.ts` consumes a ChunkInfo's ranges to mutate the document.
 *
 * Range discipline: a chunk's offsets are valid ONLY against the exact doc it
 * was detected from. `isChunkFresh` MUST gate every write — stale offsets
 * corrupt unrelated code.
 */
import { parseTopLevel } from './astParse'
import { resolveMiniSource } from './miniSource/resolveMiniSource'
import { SpanIndex } from './miniSource/spanRole'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The `pick` family as METHODS (`sel.pick(choices)`), every name Strudel 1.2.6
 * registers in `pick.mjs` except the `pickF` pair, whose choices are functions. The
 * choices are an object (`{verse: s("…")}`, #463/#667) or a list (`["…", "…"]`,
 * #2118); a cursor inside one binds THAT choice. `inhabit`/`pickSqueeze` squeeze a
 * choice into the selecting event instead of playing it whole, but the choice is
 * still the text the author wrote, so it is still what the cursor names. */
const PICK_METHODS: ReadonlySet<string> = new Set([
  'pick', 'pickmod', 'pickOut', 'pickmodOut', 'pickRestart', 'pickmodRestart',
  'pickReset', 'pickmodReset', 'inhabit', 'inhabitmod', 'pickSqueeze', 'pickmodSqueeze',
])
/** The same family called as a plain FUNCTION (`pick(sel, choices)`), plus
 * `squeeze`, which exists only in this form: as a method, `.squeeze` is the
 * operator alias (`pat.squeeze(other)` = `pat.set.squeeze(other)`), not a choice. */
const PICK_FUNCTIONS: ReadonlySet<string> = new Set([...PICK_METHODS, 'squeeze'])
/** The calls that say what a bare string plays: notes or sounds (#2118). */
const CONTENT_HEADS: ReadonlySet<string> = new Set(['note', 'n', 's', 'sound'])

/**
 * Where a chain's CHOOSER ends: the index of its first `pick`-family method, or 0
 * when there is none. The calls before it (`irand(3).segment(1).slow(64)`, or a
 * helper like `roll(3, 1)`) build the number that picks a choice. They are not the
 * track's controls, so the mixer does not offer them as knobs (#2118).
 */
export function chooserEnd(chain: readonly ChainCall[]): number {
  const at = chain.findIndex((c, i) => i > 0 && PICK_METHODS.has(c.name))
  return at < 0 ? 0 : at
}

/** Coarse hint for which editor a chunk can open. Panels still read the
 * structured fields below to decide what they can actually edit. */
export type ChunkType = 'step' | 'roll' | 'knobs' | 'unknown'

export interface ChainArg {
  /** source text of the argument expression, verbatim */
  raw: string
  /** numeric value when the arg is a (possibly negated) number literal, else null */
  numeric: number | null
  /** absolute doc offsets of the argument expression */
  range: [number, number]
}

export interface ChainCall {
  name: string
  args: ChainArg[]
  /**
   * For member calls: [dotOffset, callEnd] — replacing/deleting this range
   * removes the call. For the head call: the full call expression range.
   */
  range: [number, number]
}

export interface ChunkInfo {
  /** the whole top-level statement (incl. any `$:` label) */
  statementRange: [number, number]
  /** the statement's exact source when detected — used to verify freshness */
  statementText: string
  /** the pattern expression, excluding the `$:` label — append `.fx()` here */
  exprRange: [number, number]
  /** `$:` label name, or null */
  label: string | null
  /** head function name, e.g. `s`, `note`, `stack` */
  headFn: string | null
  /** contents of the mini string, quotes excluded — see `miniVia` for who found it */
  miniRange: [number, number] | null
  miniString: string | null
  /**
   * WHO FOUND `miniRange` (#1240). `literal` — the head call's first string
   * argument, the rule this module has always used. `resolver` — `miniSource`
   * named the span after the literal walk found nothing: a bound reference, a
   * chained argument, a root literal, a head that is not a content head.
   *
   * Carried rather than inferred because the two are DIFFERENT CONFIDENCE
   * LEVELS and a coverage table that blurs them cannot be read. `null` when
   * there is no mini span at all.
   */
  miniVia: 'literal' | 'resolver' | null
  /**
   * The freshness guard for a mini span that lies OUTSIDE `statementRange` —
   * `s(drums)` whose content is declared in `const drums = "bd sd"` two
   * statements up. Null whenever the span is inside the unit's own statement,
   * which is every `literal` chunk and most resolver ones.
   *
   * WHY IT EXISTS. This module's contract is that `isChunkFresh` gates every
   * write, and it did that by watching `statementRange` — sound while the only
   * writable span was inside it. A resolver span breaks that premise: the guard
   * would watch the unit's statement while the write lands in a different one,
   * so an edit to the declaration between detect and write corrupts unrelated
   * code and every existing check still passes. The invariant is "every byte we
   * may write is freshness-guarded", and its span is now two statements — so
   * the guard widens rather than the feature narrowing (refusing these instead
   * costs 43 of 125 resolver units, including every `s`/`sound` one).
   */
  miniAnchor: { range: [number, number]; text: string } | null
  /** calls in source order, head first */
  chain: ChainCall[]
  type: ChunkType
  /** true when `detectChunk` descended into a combinator argument — i.e. this is
   *  a NESTED voice inside `stack(...)`/`cat(...)` (#395), not a top-level track.
   *  The Pattern inspector uses it to offer a per-voice gain knob (#620): a
   *  top-level track's gain is owned by the channel-strip fader, but a nested
   *  voice's isn't, so only there does the inspector surface gain. Always false
   *  for `detectAllChunks` (every chunk there is top-level). */
  nested: boolean
  /** Set on the chunk for one string choice of a `pick` (#2118). Its chain is the
   *  whole track's, shared by every choice, so a per-note `.gain("…")` written for
   *  this choice would play over the others; `readChunkGain` reads it as foreign. */
  pickChoice?: true
  /** Set on the chunk for a rhythm line: the string in `.struct("…")`, or one string
   *  choice of a `pick` inside it (#2120). The line says WHEN the track plays, so it
   *  opens in the step grid; the chain plays the track's content, so like `pickChoice`
   *  its `.gain` is not this line's own. */
  structRhythm?: true
  /** On a rhythm line's chunk: the head and mini string of the chain `.struct` is
   *  called on, the content the line times (`chord`, `<Em9 A13>`). The Pattern tab
   *  draws that content on the line (#2120). Read-only: nothing writes through it. */
  structOver?: {
    headFn: string | null
    miniString: string | null
    /** each `.mask(…)` after `.struct`, in chain order: its string (through a const
     *  too), or null when it is not written as one */
    masks: Array<string | null>
  }
}

// Re-exported so every existing `from './chunkDetect'` import keeps resolving;
// they live in `astParse.ts` to keep this module off `spanRole`'s import path
// (see that file's header for the cycle it broke).
export { parseTopLevel, docParses } from './astParse'

/**
 * A chunk's ranges are only valid against the exact doc it was detected from.
 * Every write MUST check this first.
 */
export function isChunkFresh(doc: string, chunk: ChunkInfo): boolean {
  if (doc.slice(chunk.statementRange[0], chunk.statementRange[1]) !== chunk.statementText) {
    return false
  }
  // A resolver span in another statement is guarded HERE and nowhere else
  // (#1240) — this function is the one gate every write goes through, so
  // widening it covers every write path by construction rather than by an
  // audit of callers. See `ChunkInfo.miniAnchor`.
  const anchor = chunk.miniAnchor
  return anchor === null || doc.slice(anchor.range[0], anchor.range[1]) === anchor.text
}

/**
 * #866 — binding index: a top-level `const/let/var name = <expr>` maps `name`
 * to its RHS expression node (and its declaring statement). Lets `chunkDetect`
 * resolve a bare-identifier reference (`$: bass`, or `stack(beat, …)`) to the
 * voice it names, instead of classifying it `unknown`/code-only.
 *
 * Same D-02 boundary as the parser's binding map (parseStrudel `buildBindingMap`):
 * a name declared more than once (reassignment / shadowing) is DROPPED — an
 * ambiguous binding stays unresolved (graceful `unknown`). Only simple
 * `Identifier = init` declarations are indexed (no destructuring / bare `let x`).
 */
type BindingIndex = Map<string, { rhs: any; declStmt: any }>

function buildBindingIndex(statements: any[]): BindingIndex {
  const map: BindingIndex = new Map()
  const dropped = new Set<string>()
  for (const stmt of statements) {
    if (!stmt || stmt.type !== 'VariableDeclaration' || !Array.isArray(stmt.declarations)) continue
    for (const decl of stmt.declarations) {
      if (decl?.id?.type !== 'Identifier' || !decl.init) continue
      const name = decl.id.name
      if (map.has(name) || dropped.has(name)) {
        map.delete(name) // D-02: reassignment / shadowing → ambiguous, drop entirely
        dropped.add(name)
        continue
      }
      map.set(name, { rhs: decl.init, declStmt: stmt })
    }
  }
  return map
}

/**
 * Resolve a bare `Identifier` node to the binding it references, following a
 * chain of identifier-to-identifier bindings (`const a = b; const b = s("bd")`)
 * with a cycle guard. Returns the terminal `{ rhs, declStmt }` or null when the
 * node is not a resolvable binding reference.
 */
function resolveBinding(
  node: any,
  index: BindingIndex,
  seen: Set<string> = new Set(),
): { rhs: any; declStmt: any } | null {
  if (!node || node.type !== 'Identifier' || seen.has(node.name)) return null
  const b = index.get(node.name)
  if (!b) return null
  seen.add(node.name)
  if (b.rhs?.type === 'Identifier') {
    const deeper = resolveBinding(b.rhs, index, seen)
    if (deeper) return deeper
  }
  return b
}

/**
 * Build a chunk from `expr`, resolving it first if it is a bare-identifier
 * binding reference. A resolved chunk is anchored at the binding's DEFINITION
 * (its RHS span + the declaring statement's freshness range) — the single
 * source of truth, so an edit writes to `const bass = …`, not the `$: bass`
 * usage. `nested` reflects the CALL SITE (a stack arg is nested; a whole-track
 * ref is not), independent of resolution.
 */
function buildMaybeResolved(
  doc: string,
  expr: any,
  label: string | null,
  stmtRange: [number, number],
  index: BindingIndex,
  nested = false,
  getIndex?: () => SpanIndex | null,
): ChunkInfo {
  const resolved = resolveBinding(expr, index)
  if (resolved) {
    // Keep the call-site `label` (display-only) so a named-label ref
    // (`drums: bass`) still names its strip, while the edit/freshness ranges
    // anchor at the definition. label is independent of stmtRange, so this is
    // safe — a nested stack arg passes label=null anyway.
    return buildChunkFromExpr(
      doc,
      resolved.rhs,
      label,
      [resolved.declStmt.start, resolved.declStmt.end],
      nested,
      getIndex,
    )
  }
  return buildChunkFromExpr(doc, expr, label, stmtRange, nested, getIndex)
}

/**
 * The innermost editable chunk under `pos`, or null. Descends into combinator
 * arguments — a cursor on a track inside `stack(...)` binds THAT track, not the
 * whole `$: stack(...)` statement (#395). A top-level cursor is unchanged.
 */
export function detectChunk(doc: string, pos: number): ChunkInfo | null {
  const statements = parseTopLevel(doc)
  if (!statements) return null
  const bindings = buildBindingIndex(statements)
  const getIndex = lazySpanIndex(doc)
  for (const node of statements) {
    if (pos >= node.start && pos <= node.end) {
      // #868 — a `const/let/var x = <expr>` declaration yields a chunk for its
      // RHS, anchored at the declaration. A resolved bare-ref anchors its
      // `statementRange` HERE (the definition — the edit target), and every
      // visual write re-detects at that anchor (`useActiveChunk.applyEdit`).
      // Without this arm the re-detect returned null (a VariableDeclaration is
      // not an ExpressionStatement) and the write silently no-opped. Also makes
      // a cursor placed directly on the `const` line editable.
      if (node.type === 'VariableDeclaration') {
        const decls = Array.isArray(node.declarations) ? node.declarations : []
        if (decls.length !== 1) return null // multi-declarator → ambiguous
        const decl = decls[0]
        if (decl?.id?.type !== 'Identifier' || !decl.init) return null
        // Mirror the ExpressionStatement path: descend to the innermost chain
        // under `pos` (a cursor inside a const-defined `stack(...)` arm binds
        // THAT arm), else the whole RHS anchored at the declaration. The
        // re-anchor (`pos` = the declaration start) sits outside the init, so it
        // resolves to the whole RHS — exactly the render-time chunk.
        const initTarget = innermostChainUnder(doc, decl.init, pos, bindings)
        if (initTarget.type === PICK_CHOICE) return buildPickChoiceChunk(doc, initTarget, [node.start, node.end])
        if (initTarget.type === STRUCT_RHYTHM) return buildStructRhythmChunk(doc, initTarget, [node.start, node.end], bindings, getIndex)
        return initTarget === decl.init
          ? buildMaybeResolved(doc, decl.init, null, [node.start, node.end], bindings, false, getIndex)
          : buildMaybeResolved(doc, initTarget, null, [initTarget.start, initTarget.end], bindings, true, getIndex)
      }
      let label: string | null = null
      let body = node
      if (node.type === 'LabeledStatement') {
        label = node.label.name
        body = node.body
      }
      if (body.type !== 'ExpressionStatement') return null
      const topExpr = body.expression
      const target = innermostChainUnder(doc, topExpr, pos, bindings)
      if (target.type === PICK_CHOICE) return buildPickChoiceChunk(doc, target, [node.start, node.end])
      if (target.type === STRUCT_RHYTHM) return buildStructRhythmChunk(doc, target, [node.start, node.end], bindings, getIndex)
      // The top-level statement keeps its full range (incl. the `$:` label) so
      // the freshness guard watches the whole statement; a nested target is
      // anchored to its own expression span and carries no label. A bare-ref
      // target (`$: bass`, or a `stack(beat, …)` arm) is resolved to its
      // binding's definition inside buildMaybeResolved (#866).
      return target === topExpr
        ? buildMaybeResolved(doc, topExpr, label, [node.start, node.end], bindings, false, getIndex)
        : buildMaybeResolved(doc, target, null, [target.start, target.end], bindings, true, getIndex)
    }
  }
  return null
}

/** Every editable chunk in the doc, in source order. */
export function detectAllChunks(doc: string): ChunkInfo[] {
  const statements = parseTopLevel(doc)
  if (!statements) return []
  const bindings = buildBindingIndex(statements)
  const getIndex = lazySpanIndex(doc)
  return statements
    .map((node: any) => buildChunk(doc, node, bindings, getIndex))
    .filter((c: ChunkInfo | null): c is ChunkInfo => c !== null)
}

function buildChunk(
  doc: string,
  node: any,
  bindings: BindingIndex,
  getIndex?: () => SpanIndex | null,
): ChunkInfo | null {
  let label: string | null = null
  let body = node
  if (node.type === 'LabeledStatement') {
    label = node.label.name
    body = node.body
  }
  if (body.type !== 'ExpressionStatement') return null
  // A whole-track bare-ref (`$: bass`) resolves to its binding's voice (#866);
  // a `const bass = …` declaration itself is a VariableDeclaration, not an
  // ExpressionStatement, so it never yields its own chunk (no double).
  return buildMaybeResolved(doc, body.expression, label, [node.start, node.end], bindings, false, getIndex)
}

/**
 * A `SpanIndex` built AT MOST ONCE per detect call, and only if some unit
 * actually asks for it (#1240).
 *
 * Both halves matter. `SpanIndex.build` re-parses the document, and
 * `detectChunk` runs on every cursor move — so building it eagerly would double
 * the parse on a path where most chunks never need it (a `note("…")` head finds
 * its literal without asking). Sharing one across a `detectAllChunks` sweep is
 * what keeps that O(statements) rather than O(statements²).
 */
function lazySpanIndex(doc: string): () => SpanIndex | null {
  let built = false
  let index: SpanIndex | null = null
  return () => {
    if (!built) {
      built = true
      index = SpanIndex.build(doc)
    }
    return index
  }
}

/**
 * Build a ChunkInfo from a pattern expression node. `stmtRange` is the source
 * span the freshness guard watches: the whole statement (incl. `$:`) for a
 * top-level chunk, or just the expression for a nested one (#395).
 *
 * `getIndex` is the resolver's lazily-built document index. Omitted, the mini
 * span comes from the first-literal walk alone — the pre-#1240 behaviour, kept
 * for callers that build a chunk outside a detect sweep.
 */
function buildChunkFromExpr(
  doc: string,
  expr: any,
  label: string | null,
  stmtRange: [number, number],
  nested = false,
  getIndex?: () => SpanIndex | null,
): ChunkInfo {
  const headNode = { ref: null as any }
  const chain = collectChain(doc, expr, headNode)
  const headFn = chain.length > 0 ? chain[0].name : null

  let miniRange: [number, number] | null = null
  let miniString: string | null = null
  if (headNode.ref) {
    const firstString = headNode.ref.arguments.find(
      (a: any) =>
        (a.type === 'Literal' && typeof a.value === 'string') || a.type === 'TemplateLiteral',
    )
    if (firstString) {
      miniRange = [firstString.start + 1, firstString.end - 1]
      miniString = doc.slice(firstString.start + 1, firstString.end - 1)
    }
  }

  const info: ChunkInfo = {
    statementRange: stmtRange,
    statementText: doc.slice(stmtRange[0], stmtRange[1]),
    exprRange: [expr.start, expr.end],
    label,
    headFn,
    miniRange,
    miniString,
    miniVia: miniRange ? 'literal' : null,
    miniAnchor: null,
    chain,
    type: 'unknown',
    nested,
  }
  if (info.miniRange === null && getIndex) resolveMini(doc, info, getIndex)
  info.type = classifyChunk(info)
  return info
}

/**
 * THE RESOLVER FALLBACK (#1240) — fill a unit's mini span when the first-literal
 * walk found none, mutating `info` in place.
 *
 * The literal walk answers "the head call's first string argument", which is
 * silent for every shape where the content is somewhere else: a bound reference
 * (`s(drums)`), a chained argument, a root literal, a head that is not a content
 * head at all. `resolveMiniSource` answers the same question structurally and
 * has been gated against 150 real tunes since #1015 — it just had no caller.
 *
 * TWO REFUSALS, and neither is conservatism for its own sake:
 *
 *  - AMBIGUITY. This path runs the PARSE proposer only, because `detectChunk` is
 *    synchronous (it runs on cursor move) and evaluation is not. Parse-only
 *    hands every literal exactly one proposal, so the resolver's most-evidence
 *    ranking degenerates to source order wherever a unit has more than one
 *    `source` literal — and it then picks confidently and wrongly. Measured over
 *    the 150-tune corpus against the eval proposer as oracle: of 148 parse-only
 *    resolutions, 125 have no alternatives and ALL 125 agree with eval exactly;
 *    all 14 disagreements are among the 23 with alternatives. So `alternatives`
 *    is not a hint here, it is the soundness condition, and refusing on it buys
 *    a wrong-anchor rate of zero at a cost of 9 units that would have agreed.
 *
 *  - NO ANCHOR STATEMENT. A span outside the unit's statement needs one to guard
 *    it (see `ChunkInfo.miniAnchor`); if no top-level statement contains it, the
 *    write could not be made fresh and the span is dropped rather than written
 *    unguarded.
 */
function resolveMini(doc: string, info: ChunkInfo, getIndex: () => SpanIndex | null): void {
  const index = getIndex()
  if (!index) return
  const r = resolveMiniSource(doc, info, { index })
  // `alternatives` non-empty ⇒ the parse walk is guessing. See the header.
  if (!r.ok || r.alternatives.length > 0) return

  let anchor: ChunkInfo['miniAnchor'] = null
  const inside = r.range[0] >= info.statementRange[0] && r.range[1] <= info.statementRange[1]
  if (!inside) {
    const stmt = (parseTopLevel(doc) ?? []).find(
      (s: any) => r.range[0] >= s.start && r.range[1] <= s.end,
    )
    if (!stmt) return
    anchor = { range: [stmt.start, stmt.end], text: doc.slice(stmt.start, stmt.end) }
  }

  info.miniRange = r.range
  info.miniString = r.text
  info.miniVia = 'resolver'
  info.miniAnchor = anchor
}

/**
 * Descend to the innermost chain expression containing `pos`. When the cursor
 * sits inside an argument of a combinator (`stack`, `cat`, `layer`, …) that is
 * itself a pattern chain, recurse into that argument; otherwise return `expr`
 * unchanged. This is what lets a panel bind to ONE track inside `stack(...)`
 * rather than the whole statement (#395). Mini-notation strings and numeric
 * args are Literals, not CallExpressions, so a cursor on them keeps the
 * enclosing chain.
 */
function innermostChainUnder(
  doc: string,
  expr: any,
  pos: number,
  bindings?: BindingIndex,
  outerHead: string | null = null,
): any {
  // A string choice of a `pick`-family call (#2118). It is not a chain at all, so
  // it comes back as a marker `detectChunk` builds its own chunk from.
  const choice = pickChoiceUnder(expr, pos)
  if (choice) return { type: PICK_CHOICE, expr, outerHead, ...choice }
  // The rhythm line in a `.struct(…)` (#2120): also a string, also its own marker.
  const rhythm = structRhythmUnder(expr, pos)
  if (rhythm) return { type: STRUCT_RHYTHM, expr, ...rhythm }
  // A `pick*({…})` section value is a chain the panels can bind, but the pick
  // receiver is a string literal (not an identifier head), so the combinator-arg
  // path below never reaches it — check the pick object first (#667).
  const pickSection = pickSectionUnder(expr, pos)
  if (pickSection) return innermostChainUnder(doc, pickSection, pos, bindings)
  const headOut = { ref: null as any }
  collectChain(doc, expr, headOut)
  const head = headOut.ref
  if (!head || !Array.isArray(head.arguments)) return expr
  // `s("a b".inhabit({a: "bd(3,8)"}))`: the choices are bare strings and the call
  // around them is what says they are sounds, so it travels down with the descent.
  const heads = CONTENT_HEADS.has(head.callee.name) ? head.callee.name : null
  for (const arg of head.arguments) {
    const inner = chainArgUnder(arg, pos, bindings)
    // A bare-ref arm (`stack(beat, …)`) has no chain to descend, so return it
    // directly — detectChunk resolves it to the binding's voice (#866).
    if (inner && inner.type === 'Identifier') return inner
    if (inner) return innermostChainUnder(doc, inner, pos, bindings, heads)
  }
  return expr
}

/** The marker `innermostChainUnder` returns for a string choice of a `pick`. */
const PICK_CHOICE = 'PickChoice'

/**
 * The string choice under `pos` in a `pick`-family call on `expr`'s callee spine,
 * or null (#2118). Covers both forms, `sel.pick(["…", "…"])` and
 * `pick(sel, ["…", "…"])`, and both shapes of choices, a list or an object's
 * values. A choice written as a call (`{verse: s("…")}`) is `pickSectionUnder`'s.
 *
 * Nothing about the selector is read, so any chooser works: a helper of any name,
 * `irand(3).segment(1)`, or a literal `"<0 1 2>"`. The selector's own string is
 * never a choice: it is the method's receiver, or a bare argument of the function.
 */
function pickChoiceUnder(expr: any, pos: number): { lit: any; pick: any } | null {
  for (const { pick, choices } of pickCallsOnSpine(expr)) {
    for (const el of choices) {
      if (isMiniString(el) && pos >= el.start && pos <= el.end) return { lit: el, pick }
    }
  }
  return null
}

/**
 * Every `pick`-family call on `expr`'s callee spine, with its choices: the elements
 * of a list argument and the values of an object argument, in source order. The one
 * place that decides what a choice is, so the string lookup (`pickChoiceUnder`) and
 * the call lookup (`pickSectionUnder`) cannot disagree about it (#2121).
 *
 * Walks the spine (like `collectChain`) rather than the whole tree, so a pick NESTED
 * inside another combinator is found only when it lies on the chain under the
 * cursor: the enclosing `innermostChainUnder` recursion has already narrowed to it.
 */
function pickCallsOnSpine(expr: any): { pick: any; choices: any[] }[] {
  const out: { pick: any; choices: any[] }[] = []
  let node = expr
  while (node && node.type === 'CallExpression') {
    const callee = node.callee
    const isPick =
      callee.type === 'MemberExpression'
        ? !callee.computed && callee.property.type === 'Identifier' && PICK_METHODS.has(callee.property.name)
        : callee.type === 'Identifier' && PICK_FUNCTIONS.has(callee.name)
    if (isPick) {
      const choices: any[] = []
      for (const arg of node.arguments) {
        if (arg?.type === 'ArrayExpression') choices.push(...arg.elements)
        else if (arg?.type === 'ObjectExpression') {
          for (const p of arg.properties) choices.push(p?.type === 'Property' ? p.value : null)
        }
      }
      out.push({ pick: node, choices })
    }
    node = callee.type === 'MemberExpression' ? callee.object : null
  }
  return out
}

/** A string literal a mini pattern can be read from: quotes, or a backtick string
 *  with nothing interpolated (an interpolation would make the text not the pattern). */
/** a string argument's text, quotes excluded, followed through a const; else null */
function miniText(doc: string, node: any, bindings: BindingIndex): string | null {
  const lit = node?.type === 'Identifier' ? resolveBinding(node, bindings)?.rhs : node
  return isMiniString(lit) ? doc.slice(lit.start + 1, lit.end - 1) : null
}

function isMiniString(node: any): boolean {
  if (!node || typeof node.start !== 'number') return false
  if (node.type === 'Literal') return typeof node.value === 'string'
  return node.type === 'TemplateLiteral' && node.expressions.length === 0
}

/**
 * The chunk for one string choice of a `pick` (#2118): that string is the pattern.
 *
 * - `miniRange` is the string, so the grid reads and writes that choice and nothing
 *   else; the selector and the other choices stay as written.
 * - `headFn` says what the string plays. A bare string plays whatever the chain
 *   AFTER the pick makes of it (`.note()`, `.s()` with no argument), or failing
 *   that the call the pick sits inside (`s("a".inhabit({a: "bd"}))`). With neither,
 *   it is null and the panels stay in standby, as before.
 * - `chain` is a stand-in head plus the calls after the pick, so the mixer edits the
 *   track's own controls and never the selector's arguments. `MixerBody` never
 *   edits index 0, the same convention `adaptMasterChunk` relies on.
 * - `exprRange` is the whole chain, so an added effect goes at its end.
 * - `statementRange` is the string itself, so `applyEdit`'s re-detect at its start
 *   lands back on this choice. The whole statement is guarded through `miniAnchor`,
 *   because the mixer writes outside the string.
 * - `pickChoice` keeps the velocity lane off the shared `.gain` (see the field).
 */
function buildPickChoiceChunk(doc: string, t: any, outer: [number, number]): ChunkInfo {
  const chain = collectChain(doc, t.expr, { ref: null })
  const at = chain.findIndex((c) => c.range[1] === t.pick.end)
  const after = at < 0 ? [] : chain.slice(at + 1)
  const converter = after.find((c) => CONTENT_HEADS.has(c.name) && c.args.length === 0)
  const headFn: string | null = converter?.name ?? t.outerHead ?? null
  const lit: [number, number] = [t.lit.start, t.lit.end]
  const pickName = at < 0 ? 'pick' : chain[at].name
  const info: ChunkInfo = {
    statementRange: lit,
    statementText: doc.slice(lit[0], lit[1]),
    exprRange: [t.expr.start, t.expr.end],
    label: null,
    headFn,
    miniRange: [lit[0] + 1, lit[1] - 1],
    miniString: doc.slice(lit[0] + 1, lit[1] - 1),
    miniVia: 'literal',
    miniAnchor: { range: outer, text: doc.slice(outer[0], outer[1]) },
    chain: [{ name: headFn ?? pickName, args: [], range: lit }, ...after],
    type: 'unknown',
    nested: false,
    pickChoice: true,
  }
  info.type = classifyChunk(info)
  return info
}

/** The marker `innermostChainUnder` returns for a rhythm line in a `.struct(…)`. */
const STRUCT_RHYTHM = 'StructRhythm'

/**
 * The rhythm line under `pos` in a `.struct(…)` on `expr`'s callee spine, or null
 * (#2120): the argument itself when it is a string, or the string choice under `pos`
 * of a `pick` written as the argument (`.struct(roll(3, 3).pick(["x ~", "~ x"]))`).
 * `receiver` is the chain `.struct` is called on, the content the line times.
 *
 * `.struct` takes its timing from this argument and its values from the chain, so the
 * argument is a pattern the grid can draw on its own. `.mask` is not here on purpose:
 * it keeps the chain's timing and only silences, which the plan shows but does not edit.
 */
function structRhythmUnder(expr: any, pos: number): any {
  let node = expr
  while (node && node.type === 'CallExpression') {
    const callee = node.callee
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'struct'
    ) {
      const arg = node.arguments[0]
      if (arg && typeof arg.start === 'number' && pos >= arg.start && pos <= arg.end) {
        if (isMiniString(arg)) return { lit: arg, receiver: callee.object, struct: node }
        const choice = pickChoiceUnder(arg, pos)
        if (choice) return { lit: choice.lit, receiver: callee.object, struct: node }
      }
    }
    node = callee.type === 'MemberExpression' ? callee.object : null
  }
  return null
}

/**
 * The chunk for a rhythm line (#2120). Built like a pick choice's (see
 * `buildPickChoiceChunk` for why each range is what it is), with two differences:
 *
 * - `headFn` is `struct`, the call that reads the string. It is not a content head, so
 *   nothing treats the line as notes or sounds; `chunkSurface` opens it in the step grid.
 * - `chain` keeps every call after the head behind a stand-in, because the calls
 *   before `.struct` (`.voicing()`, an `.lpf`) are the track's controls as much as the
 *   ones after it. Only the content head is left out, and `MixerBody` never edits index 0.
 */
function buildStructRhythmChunk(
  doc: string,
  t: any,
  outer: [number, number],
  bindings: BindingIndex,
  getIndex: () => SpanIndex | null,
): ChunkInfo {
  const over = buildChunkFromExpr(doc, t.receiver, null, outer, false, getIndex)
  // the `.mask(…)` calls after `.struct`, outermost first on the spine, so reversed
  const masks: Array<string | null> = []
  for (let node = t.expr; node && node !== t.struct && node.type === 'CallExpression'; ) {
    const callee = node.callee
    if (callee.type !== 'MemberExpression') break
    if (!callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'mask') {
      masks.unshift(miniText(doc, node.arguments[0], bindings))
    }
    node = callee.object
  }
  const chain = collectChain(doc, t.expr, { ref: null })
  const lit: [number, number] = [t.lit.start, t.lit.end]
  const info: ChunkInfo = {
    statementRange: lit,
    statementText: doc.slice(lit[0], lit[1]),
    exprRange: [t.expr.start, t.expr.end],
    label: null,
    headFn: 'struct',
    miniRange: [lit[0] + 1, lit[1] - 1],
    miniString: doc.slice(lit[0] + 1, lit[1] - 1),
    miniVia: 'literal',
    miniAnchor: { range: outer, text: doc.slice(outer[0], outer[1]) },
    chain: [{ name: 'struct', args: [], range: lit }, ...chain.slice(1)],
    type: 'unknown',
    nested: false,
    structRhythm: true,
    structOver: { headFn: over.headFn, miniString: over.miniString, masks },
  }
  info.type = classifyChunk(info)
  return info
}

/**
 * The choice under `pos` that is written as a call, or null: `{verse: s("…")}` in an
 * object (#667), or `[s("…"), note("…")]` in a list (#2121), of any `pick`-family
 * call in either form. A cursor inside one binds THAT choice's own chain, the same
 * descent `chainArgUnder` does for a `stack`/`arrange` arm. The selector and the
 * property keys are not choices: a cursor there returns null so the outer statement
 * stays selected (the selector is a Timeline concern, #463). A string choice is
 * `pickChoiceUnder`'s.
 */
function pickSectionUnder(expr: any, pos: number): any {
  for (const { choices } of pickCallsOnSpine(expr)) {
    for (const el of choices) {
      if (el?.type === 'CallExpression' && typeof el.start === 'number' && pos >= el.start && pos <= el.end) {
        return el
      }
    }
  }
  return null
}

/**
 * The chain expression to descend into for a combinator argument under `pos`:
 * the arg itself when it's a pattern chain (`stack`/`cat`/`layer` args), OR —
 * for an `arrange([w, pat])` arm — the `pat` CallExpression element inside the
 * `[w, pat]` ArrayExpression (#472). Returns null when `pos` isn't inside a
 * descendable chain arg (e.g. on the weight literal, or a non-chain arg), so the
 * cursor keeps the enclosing combinator chain. Without the array case, an
 * arrange arm leaf never binds a panel — the cursor resolves to the whole
 * `arrange(...)` (head `arrange`, no mini) → standby.
 */
function chainArgUnder(arg: any, pos: number, bindings?: BindingIndex): any {
  if (!arg || typeof arg.start !== 'number' || pos < arg.start || pos > arg.end) return null
  if (arg.type === 'CallExpression') return arg
  // A bare-identifier arm that names a binding (`stack(beat, …)`) is descendable
  // — return it so detectChunk resolves it to the bound voice (#866). A
  // non-binding identifier stays non-descendable (unchanged behaviour).
  if (arg.type === 'Identifier' && bindings?.has(arg.name)) return arg
  if (arg.type === 'ArrayExpression' && Array.isArray(arg.elements)) {
    for (const el of arg.elements) {
      if (
        el &&
        el.type === 'CallExpression' &&
        typeof el.start === 'number' &&
        pos >= el.start &&
        pos <= el.end
      ) {
        return el
      }
    }
  }
  return null
}

/**
 * Walk the callee spine of a chained expression, e.g.
 * `s("bd").bank("x").gain(0.6)` → [s, bank, gain] in source order.
 * Records the innermost (head) call node on `headOut.ref`.
 *
 * Exported so the master-strip detector (`masterEdit.ts`) can read an
 * `all(x => x.gain().viz())` arrow body with byte-identical arg parsing
 * (numeric detection, per-arg ranges) to a channel chain — one source of truth
 * for "parse a method chain". A chain that bottoms out at a bare Identifier (the
 * arrow param `x`, not a head call) simply leaves `headOut.ref` null.
 */
export function collectChain(doc: string, expr: any, headOut: { ref: any }): ChainCall[] {
  const calls: ChainCall[] = []
  let node = expr
  while (node) {
    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier'
      ) {
        const dot = doc.lastIndexOf('.', callee.property.start)
        calls.push({
          name: callee.property.name,
          args: node.arguments.map((a: any) => toArg(doc, a)),
          range: [dot, node.end],
        })
        node = callee.object
        continue
      }
      if (callee.type === 'Identifier') {
        calls.push({
          name: callee.name,
          args: node.arguments.map((a: any) => toArg(doc, a)),
          range: [node.start, node.end],
        })
        headOut.ref = node
      }
    }
    break
  }
  return calls.reverse()
}

/** A call argument as a `ChainArg` — exported so the master-strip detector can
 *  read the literal NESTED inside `.mul(postgain(N))` with the same numeric rule. */
export function toArg(doc: string, node: any): ChainArg {
  let numeric: number | null = null
  if (node.type === 'Literal' && typeof node.value === 'number') {
    numeric = node.value
  } else if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  ) {
    numeric = -node.argument.value
  }
  return { raw: doc.slice(node.start, node.end), numeric, range: [node.start, node.end] }
}

/**
 * Best-guess primary editor for a chunk. Coarse — panels read `chain`/`mini`
 * directly to decide what they can edit. A pattern with a `note`/`n` head and
 * a mini string is roll-shaped; an `s`/`sound` head with a mini string is
 * grid-shaped; anything with a numeric chain literal can at least show knobs.
 */
export function classifyChunk(info: ChunkInfo): ChunkType {
  const head = info.headFn
  if (info.miniString !== null) {
    if (head === 'note' || head === 'n') return 'roll'
    if (head === 's' || head === 'sound') return 'step'
  }
  if (info.chain.some((c) => c.args.some((a) => a.numeric !== null))) return 'knobs'
  return 'unknown'
}
