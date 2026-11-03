/**
 * gridDivisions.ts — each bar of a grid as the pattern's own divisions, handed to the
 * views (#2275, part of #1833, epic #1832).
 *
 * The tree is built by `./strudelMini/divisions.ts`, asked of Strudel. This file only
 * carries it out of the adapter as PLAIN DATA (exact fractions and spans, no Strudel
 * object, no krill node), and says which part of it each grid row draws. It adds an
 * answer and moves none: the grid and roll models, and every writer, are untouched.
 *
 * WHEN IT IS BUILT: once per chunk text, and only when a view asks — the Pattern tab
 * asks for the chunk it shows, never for every chunk on every keystroke (#2274: the tree
 * costs about what the grid parse costs up to p95, and its tail is longer).
 *
 * A bar the tree refuses carries the refusal's reason, never a tree that is nearly right,
 * and the grid draws it exactly as it does today.
 *
 * Apart from `./notation/` on purpose, like `./noteSounds.ts`: this half loads
 * `@strudel/core` (through `./strudelMini/`).
 */
import type { StepLane } from './notation/model'
import { barDivisions, fracOf, type DivisionsRefusal, type Frac, type Row, type Slot, type Step } from './strudelMini/divisions'
import { miniPattern } from './strudelMini/pattern'
import { argAtom, isRest, type MiniElement, type MiniGroup, type MiniSpan } from './strudelMini/shape'

export type { Frac, Slot, DivisionsRefusal }

/** one hit a note step plays in the bar, and the argument tokens that shaped it (`3` and `8` of `bd(3,8)`) */
export interface DivisionHit {
  begin: Frac
  end: Frac
  args: Array<{ text: string; span: MiniSpan }>
}

export interface DivisionStep {
  /** where the written step sits in the chunk's string, padding included; null when krill gave none */
  span: MiniSpan | null
  /**
   * A note or rest step's name as written, `:` tails included (`bd:4`, `c3`, `~`) — the
   * name a grid row has (`StepLane.sound`). Null for a group, and for a note whose tail
   * is not a plain token (`bd:<1 2>`).
   */
  name: string | null
  rest: boolean
  /**
   * A note or rest step's name in the string, tight: the atom and its `:` tails (`bd:4` of
   * `bd:4@2 `). Null for a group, and wherever the name is not one unbroken run of text.
   * This is the text a toggle rewrites; whatever follows it (`@2`) stays as written.
   */
  head: MiniSpan | null
  /**
   * The step's own ops, by krill's name, in written order: `tail`, `replicate`, `stretch`,
   * `bjorklund`, `degradeBy`, `range`, … — `@n` and `_` are its weight, not ops.
   */
  ops: string[]
  /**
   * `!n` / a bare `!`: the step is written once and plays as `reps` steps side by side,
   * each an equal share of its slot (Strudel counts `bd!3 sd` as four steps). 1 when unwritten.
   */
  reps: number
  /**
   * How many of its row's shares the step takes: `@n`, `_`, and `!n` too (krill folds a
   * replicate into the weight: `bd!3` weighs 3) — 1 when none is written. Strudel counts
   * `bd@3 sd` as four steps (#1845): a note three steps long, then one.
   */
  weight: number
  /** where the written step sits in the bar, its own ops set aside — several when something above repeats its row */
  slots: Slot[]
  /** a note step's hits in this bar, in Strudel's order; empty for a rest, a group, a note held from an earlier bar */
  hits: DivisionHit[]
  /** a group step whose own op repeats it: where each copy of its content sits */
  copies: Slot[] | null
  /** a group step: its rows, each cutting `copies ?? slots` again */
  rows: DivisionRow[] | null
  /** the rows are a random choice (`a | b`): each copy holds one of them */
  oneOf: boolean
}

export interface DivisionRow {
  /** the steps that sit in this bar, in written order */
  steps: DivisionStep[]
  /**
   * How many steps the row WRITES, in every bar together. More than `steps.length` when
   * the row is an alternation's arms (`<bd sd>`) or a polymeter's layer, and only some of
   * them sit in this bar.
   */
  written: number
  /**
   * Every note written in the row, at any depth and in every arm (not only this bar's),
   * as written (`bd:3` and `bd` are two), each once — rests left out. A grid row is one
   * of these (`StepLane.sound`).
   */
  sounds: string[]
}

/** why a bar has no tree: the builder's own reasons, or that the string did not evaluate */
export type BarTreeRefusal = DivisionsRefusal | 'does-not-evaluate'

export type BarTree =
  | {
      ok: true
      /** one row per comma part, in written order; one row when there is no comma */
      parts: DivisionRow[]
      /** the parts are a random choice: this bar holds one of them */
      oneOf: boolean
    }
  | { ok: false; why: BarTreeRefusal }

/** a note's name as written: its text and every `:` tail (`bd:4`), or null when a tail is not a token */
function nameOf(e: MiniElement): string | null {
  if (e.content.kind !== 'atom') return null
  let name = e.content.text
  for (const op of e.ops) {
    if (op.kind !== 'tail') continue
    const tail = argAtom(op.args.element)
    if (!tail) return null
    name += ':' + tail.text
  }
  return name
}

/** where a note's name sits, tight — or null when its atom and tails are not one run of text */
function headOf(e: MiniElement, name: string | null, mini: string): MiniSpan | null {
  if (e.content.kind !== 'atom' || name === null) return null
  const start = e.content.span.start
  const end = start + name.length
  return mini.slice(start, end) === name ? { start, end } : null
}

function stepOut(s: Step, cyc: number, mini: string): DivisionStep {
  const name = nameOf(s.element)
  return {
    span: s.element.span,
    name,
    head: headOf(s.element, name, mini),
    ops: s.element.ops.map((o) => o.kind),
    rest: s.rest,
    reps: s.element.reps,
    weight: s.element.weight,
    slots: s.slots,
    hits: s.hits.map((j) => ({
      begin: fracOf(j.hit.begin, cyc),
      end: fracOf(j.hit.end, cyc),
      args: j.args.map((a) => ({ text: a.text, span: a.span })),
    })),
    copies: s.copies,
    rows: s.rows ? s.rows.map((r) => rowOut(r, cyc, mini)) : null,
    oneOf: s.oneOf,
  }
}

function soundsIn(group: MiniGroup, out: Set<string>): Set<string> {
  for (const c of group.children) {
    if (c.kind === 'group') soundsIn(c, out)
    else if (c.content.kind === 'group') soundsIn(c.content, out)
    else if (!isRest(c.content)) {
      const name = nameOf(c)
      if (name !== null) out.add(name)
    }
  }
  return out
}

const rowOut = (r: Row, cyc: number, mini: string): DivisionRow => ({
  steps: r.steps.map((s) => stepOut(s, cyc, mini)),
  written: r.group.children.length,
  sounds: [...soundsIn(r.group, new Set())],
})

/** the tree of each bar, by chunk text — a handful, since only the shown chunk is asked */
const KEEP = 16
const BUILT = new Map<string, BarTree[]>()

/**
 * Bars `0 … bars−1` of `mini` as the pattern's own divisions, each a tree or the reason
 * it has none. Built once per text and bar count, then handed back as it was: treat it
 * as read-only.
 */
export function chunkDivisions(mini: string, bars: number): BarTree[] {
  const key = `${bars}\u0000${mini}`
  const kept = BUILT.get(key)
  if (kept) {
    BUILT.delete(key)
    BUILT.set(key, kept)
    return kept
  }
  let trees: BarTree[]
  try {
    const pat = miniPattern(mini)
    trees = Array.from({ length: bars }, (_, cyc): BarTree => {
      const d = barDivisions(pat, cyc)
      return d.ok ? { ok: true, parts: d.parts.map((r) => rowOut(r, cyc, mini)), oneOf: d.oneOf } : { ok: false, why: d.why }
    })
  } catch {
    // Strudel or krill threw for the pattern itself: no bar of it has a tree
    trees = Array.from({ length: bars }, (): BarTree => ({ ok: false, why: 'does-not-evaluate' }))
  }
  BUILT.set(key, trees)
  if (BUILT.size > KEEP) BUILT.delete(BUILT.keys().next().value!)
  return trees
}

/** why a grid row has no row of a bar's tree */
export type LaneDivisionsRefusal =
  | BarTreeRefusal
  /** the row names no comma part and the bar has several: which one it draws is not known */
  | 'lane-part-unknown'
  /** the row's comma part is not in the bar's tree */
  | 'lane-part-missing'
  /** the part the row names writes no note of the row's sound */
  | 'lane-sound-not-in-part'

export type LaneDivisions = { ok: true; row: DivisionRow; oneOf: boolean } | { ok: false; why: LaneDivisionsRefusal }

/**
 * The row of a bar's tree that grid row `lane` draws: its comma part (`StepLane.part`).
 * A row that names no part draws the bar's only part, and is refused when there are
 * several. The part must write a note of the row's sound — the check that the parser's
 * count of parts and Strudel's are the same parts.
 */
export function laneDivisions(tree: BarTree, lane: Pick<StepLane, 'sound' | 'part'>): LaneDivisions {
  if (!tree.ok) return tree
  if (lane.part === undefined && tree.parts.length !== 1) return { ok: false, why: 'lane-part-unknown' }
  const at = lane.part ?? 0
  const row = tree.parts[at]
  if (!row) return { ok: false, why: 'lane-part-missing' }
  if (!row.sounds.includes(lane.sound)) return { ok: false, why: 'lane-sound-not-in-part' }
  return { ok: true, row, oneOf: tree.oneOf }
}
