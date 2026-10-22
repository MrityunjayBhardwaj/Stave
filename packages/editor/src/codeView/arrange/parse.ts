/**
 * arrange/parse — combinator-arm detection at the JS-argument altitude.
 *
 * The arrangement half of the visual-editing spine. A timeline CLIP is one arm
 * of a time-sequence combinator (`arrange(...)` / `cat(...)` / `slowcat(...)`);
 * editing a clip is a STRUCTURAL mutation of that combinator (PV121/PV122). The
 * `notation/{parse,serialize}` layer is the wrong altitude — it edits
 * mini-notation CONTENT inside one pattern and explicitly rejects parens
 * (parse.ts:284). Arrangement lives one level up, in the JS argument list, so
 * it gets its OWN parser here.
 *
 * Like `chunkDetect`, everything is PURE (string in, plain-object out) and uses
 * acorn for exact node ranges — no paren-slicing, no Monaco, no runtime IR
 * import (so it stays out of vitest's CJS-`gifenc` trap, P172). The companion
 * `serialize.ts` turns these ranges into surgical `OffsetEdit`s.
 *
 * Range discipline: the offsets returned here are valid ONLY against the exact
 * doc they were detected from. Route every write through `writeback`'s
 * freshness-guarded path.
 */
import { parse } from 'acorn'

// acorn's node types are intentionally loose; we walk untyped nodes here.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The literal combinator name — round-trip identity (PV122 #3). */
export type ArrangeMode = 'arrange' | 'cat' | 'slowcat'

const COMBINATORS: ReadonlySet<string> = new Set(['arrange', 'cat', 'slowcat'])

/** Per-arm source ranges within a detected combinator call. One arm = one clip. */
export interface ArrangeArmRange {
  /**
   * Absolute `[start, end)` of the weight number literal — present for
   * `arrange` arms (the `n` in `[n, pat]`), `null` for `cat`/`slowcat` arms
   * (whose weight is an implicit `1`, with no literal to edit).
   */
  weightRange: [number, number] | null
  /** Absolute `[start, end)` of the arm's pattern expression. */
  patternRange: [number, number]
  /**
   * Absolute `[start, end)` of the WHOLE arm: the `[n, pat]` array for
   * `arrange`, else identical to `patternRange`. This is the unit a
   * reorder/remove/insert op moves.
   */
  armRange: [number, number]
}

/** A detected `arrange(...)`/`cat(...)`/`slowcat(...)` call and its arms. */
export interface ArrangeCall {
  mode: ArrangeMode
  /** Absolute `[start, end)` of the whole `mode(...)` call expression. */
  callRange: [number, number]
  /** Absolute `[start, end)` of the callee identifier (`arrange`/`cat`/…). */
  calleeRange: [number, number]
  /** Absolute `[start, end)` of the argument region between `(` and `)`. */
  argsRange: [number, number]
  /** Arms in source order; clip order is arm order (PV122 #1). */
  arms: ArrangeArmRange[]
}

/** Top-level program body, or null when the doc doesn't parse. */
function parseProgram(doc: string): any | null {
  try {
    return parse(doc, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }) as any
  } catch {
    return null
  }
}

/** Is this node a `arrange|cat|slowcat(...)` call (function form, not a method)? */
function isCombinatorCall(node: any): boolean {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    COMBINATORS.has(node.callee.name)
  )
}

/** Visit every AST node depth-first, calling `visit` on each. */
function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string' && typeof node.start === 'number') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) walk(c, visit)
    } else if (child && typeof child === 'object') {
      walk(child, visit)
    }
  }
}

/** Build the per-arm ranges for one combinator-call argument. */
function armFromArg(mode: ArrangeMode, arg: any): ArrangeArmRange | null {
  if (mode === 'arrange') {
    // `arrange` arms are `[n, pat]` tuples — an ArrayExpression with a numeric
    // weight then the pattern. A non-tuple arg is malformed for arrange.
    if (arg.type !== 'ArrayExpression' || arg.elements.length < 2) return null
    const weight = arg.elements[0]
    const pat = arg.elements[1]
    if (!weight || !pat) return null
    return {
      weightRange: [weight.start, weight.end],
      patternRange: [pat.start, pat.end],
      armRange: [arg.start, arg.end],
    }
  }
  // `cat`/`slowcat` arms are bare patterns (implicit weight 1).
  return {
    weightRange: null,
    patternRange: [arg.start, arg.end],
    armRange: [arg.start, arg.end],
  }
}

/** Build an `ArrangeCall` from a combinator call node, or null if any arm is
 *  malformed (e.g. an `arrange` arg that isn't a `[n, pat]` tuple). */
function buildCall(doc: string, node: any): ArrangeCall | null {
  const mode = node.callee.name as ArrangeMode
  if (node.arguments.length === 0) return null
  const arms: ArrangeArmRange[] = []
  for (const arg of node.arguments) {
    const arm = armFromArg(mode, arg)
    if (!arm) return null
    arms.push(arm)
  }
  // The args region sits between the `(` after the callee and the call's end.
  const open = doc.indexOf('(', node.callee.end)
  if (open < 0) return null
  return {
    mode,
    callRange: [node.start, node.end],
    calleeRange: [node.callee.start, node.callee.end],
    argsRange: [open + 1, node.end - 1],
    arms,
  }
}

/**
 * The innermost `arrange|cat|slowcat(...)` call whose range contains `pos`, or
 * null. "Innermost" so a cursor on a clip inside a nested combinator binds THAT
 * combinator (mirrors `chunkDetect.innermostChainUnder`, #395). `pos` is
 * typically `Arrange.arms[i].loc[0].start` — the anchor the IR already carries.
 */
export function detectArrangeAt(doc: string, pos: number): ArrangeCall | null {
  const program = parseProgram(doc)
  if (!program) return null
  let best: any = null
  walk(program, (n) => {
    if (!isCombinatorCall(n)) return
    if (pos < n.start || pos > n.end) return
    // innermost = the smallest containing span = the latest start
    if (!best || n.start > best.start) best = n
  })
  return best ? buildCall(doc, best) : null
}

/** Every combinator call in the doc, in source order. For tests / sweeps. */
export function detectAllArrangeCalls(doc: string): ArrangeCall[] {
  const program = parseProgram(doc)
  if (!program) return []
  const nodes: any[] = []
  walk(program, (n) => {
    if (isCombinatorCall(n)) nodes.push(n)
  })
  nodes.sort((a, b) => a.start - b.start)
  return nodes.map((n) => buildCall(doc, n)).filter((c): c is ArrangeCall => c !== null)
}

/**
 * The bare PATTERN expression of the top-level track statement containing `pos`,
 * when that track is NOT already a combinator (so there is no `arrange`/`cat` to
 * reorder). Returns the expression's absolute `[start, end)` — the range §2.1
 * `wrapBare` wraps to INTRODUCE a combinator when a steady pattern is first
 * placed in time (the "move-on-a-bare-track" case).
 *
 * Returns null when: the doc doesn't parse; `pos` isn't inside a top-level
 * expression statement; or that statement already contains a combinator (then
 * `detectArrangeAt` owns the edit). A `$:`/label prefix and any trailing
 * statements are excluded — we return the EXPRESSION range only, so a wrap edits
 * just the pattern and leaves the rest of the line byte-identical.
 */
export function detectBarePattern(
  doc: string,
  pos: number,
): { patternRange: [number, number] } | null {
  const program = parseProgram(doc)
  if (!program?.body) return null
  for (const stmt of program.body as any[]) {
    // Unwrap `$: expr` (LabeledStatement) → its ExpressionStatement.
    const exprStmt = stmt?.type === 'LabeledStatement' ? stmt.body : stmt
    if (exprStmt?.type !== 'ExpressionStatement') continue
    const expr = exprStmt.expression
    if (!expr || pos < expr.start || pos > expr.end) continue
    // A combinator anywhere inside → not bare; detectArrangeAt handles it.
    let hasCombinator = false
    walk(expr, (n) => {
      if (isCombinatorCall(n)) hasCombinator = true
    })
    if (hasCombinator) return null
    // A trailing `.viz(...)` is a DISPLAY annotation on the WHOLE statement, not
    // part of the sound pattern. Exclude it from the range so materializing into
    // an `arrange` wraps only the sound — `s("bd").viz("x")` →
    // `arrange([1, s("bd")], [1, s("bd")]).viz("x")` — instead of copying `.viz()`
    // into every arm (#657), which both duplicates it and strips it of the
    // terminal position the inline-viz reader requires (#571).
    let pat = expr
    while (
      pat?.type === 'CallExpression' &&
      pat.callee?.type === 'MemberExpression' &&
      !pat.callee.computed &&
      pat.callee.property?.name === 'viz'
    ) {
      pat = pat.callee.object
    }
    if (!pat) return null
    return { patternRange: [pat.start, pat.end] }
  }
  return null
}
