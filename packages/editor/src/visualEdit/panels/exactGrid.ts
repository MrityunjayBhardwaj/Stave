/**
 * exactGrid.ts — what the Exact step grid draws and clicks, from the bar's tree alone (#2295,
 * #2454, epic #1832). No equal columns: every place is an exact share of its bar.
 *
 * A row's CELLS are the places a click on that row acts on:
 *   - a step, one cell (`sd` in `bd sd`);
 *   - a step whose own op places its hits, one cell per place: a euclid's own `n`, so `bd(1,16)`
 *     has 16 though it plays once; otherwise the finest division its hits land on (`hh*4` has 4);
 *   - a plain step longer than the part's finest division, one cell per division: the faint
 *     snap halves (`bd` in `bd [~ bd]`), where a click after the first splits the step.
 *
 * The part's finest division is the least common multiple of every step edge it has, in any
 * bar of the loop: a step of a bar that plays `e5` can still be split where another bar of the
 * part has a finer step. Asked per part, so a row is never cut finer than its own part needs.
 *
 * Rows of a part come in the order their sounds first play, the order the grid has always
 * listed them, which is also the order a chord writes its members.
 *
 * Which steps a gesture can edit is the step writer's rule alone: `cellEdit` hands it an
 * address and returns its answer, refusal included.
 */
import {
  applyStepEdit,
  chunkDivisions,
  splitStep,
  toggleStep,
  type BarTree,
  type DivisionRow,
  type Frac,
  type StepEditResult,
} from '../../codeView'
import { barStepsOrWhy, frac, fracNum, OPEN_PX, splitAddressAtPlace, stepAddressAtPlace, type FracStep, type StepAtRefusal } from './gridZoom'
import { probeTrees, repeatingBars, treeGridFrom, type TreeRow } from './treeGrid'

/** no bar is cut finer than this: past it a plain step shows no snap halves, and is still one cell */
const MAX_DIVISION = 4096

export interface ExactCell {
  bar: number
  begin: Frac
  end: Frac
  /** this row's note starts here */
  on: boolean
  /** part-way through a plain step: a click here splits it */
  split: boolean
}

export interface ExactRow extends TreeRow {
  /**
   * The row's cells, every bar in order. Where a bar's steps do not tile it (`why` says so) its
   * notes are still cells, so they can be erased, and it has no empty cells to add into.
   */
  cells: ExactCell[]
}

export type ExactGrid = { ok: true; bars: number; trees: readonly BarTree[]; rows: ExactRow[] } | { ok: false; why: string }

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b
const keyOf = (f: Frac): string => `${f.n}/${f.d}`

/** the row's notes in the bar as cells, for a bar whose steps do not tile it */
function hitCells(row: DivisionRow, sound: string, bar: number, out: ExactCell[]): ExactCell[] {
  for (const s of row.steps) {
    if (s.text === sound) {
      for (const h of s.hits) {
        if (fracNum(h.begin) >= 0 && fracNum(h.begin) < 1) out.push({ bar, begin: frac(h.begin.n, h.begin.d), end: frac(h.end.n, h.end.d), on: true, split: false })
      }
    }
    for (const r of s.rows ?? []) hitCells(r, sound, bar, out)
  }
  return out.sort((a, b) => fracNum(a.begin) - fracNum(b.begin))
}

/** where this row's note starts in the bar, at any depth */
function starts(row: DivisionRow, sound: string, out: Set<string>): Set<string> {
  for (const s of row.steps) {
    if (s.text === sound) for (const h of s.hits) out.add(keyOf(frac(h.begin.n, h.begin.d)))
    for (const r of s.rows ?? []) starts(r, sound, out)
  }
  return out
}

/** the least common multiple of the denominators of every step edge in the row, at any depth */
function finest(row: DivisionRow, d = 1): number {
  for (const s of row.steps) {
    for (const slot of s.slots) d = lcm(lcm(d, frac(slot.begin.n, slot.begin.d).d), frac(slot.end.n, slot.end.d).d)
    for (const h of s.hits) d = lcm(d, frac(h.begin.n, h.begin.d).d)
    for (const r of s.rows ?? []) d = finest(r, d)
    if (d > MAX_DIVISION) return d
  }
  return d
}

/** one leaf's cells: its places, equal shares of it */
function leafCells(leaf: FracStep, bar: number, division: number, mine: Set<string>): ExactCell[] {
  const hits = (leaf.step?.hits ?? []).filter((h) => fracNum(h.begin) >= fracNum(leaf.begin) && fracNum(h.begin) < fracNum(leaf.end))
  const cell = (begin: Frac, end: Frac, split: boolean): ExactCell => ({ bar, begin, end, on: mine.has(keyOf(begin)), split })
  const span = frac(leaf.end.n * leaf.begin.d - leaf.begin.n * leaf.end.d, leaf.end.d * leaf.begin.d)
  /** this many of the leaf's shares, or one when they do not cut it whole */
  const whole = (x: number): number => (Number.isInteger(x) && x >= 1 ? x : 1)
  // THE STEP'S OWN PLACES: a euclid's `n`; or a step whose hits begin part-way through it
  let own = leaf.step?.euclidPlaces ?? 1
  if (own === 1) {
    let d = 1
    const lead = leaf.begin
    for (const h of hits) d = lcm(d, frac(h.begin.n * lead.d - lead.n * h.begin.d, h.begin.d * lead.d).d)
    own = whole((span.n * d) / span.d)
  }
  // ...cut again by the part's division: a place that is not the step's own is a snap half
  const parts = lcm(own, division > MAX_DIVISION ? 1 : whole((span.n * division) / span.d))
  if (parts <= 1) return [cell(leaf.begin, leaf.end, false)]
  const place = (k: number): Frac => {
    // begin + k · (span / parts)
    const step = frac(span.n, span.d * parts)
    return frac(leaf.begin.n * step.d + k * step.n * leaf.begin.d, leaf.begin.d * step.d)
  }
  const everyOwn = parts / own
  return Array.from({ length: parts }, (_, k) => cell(place(k), k === parts - 1 ? leaf.end : place(k + 1), k % everyOwn !== 0))
}

function leavesOf(steps: readonly FracStep[], out: FracStep[] = []): FracStep[] {
  for (const s of steps) {
    if (s.children) leavesOf(s.children, out)
    else out.push(s)
  }
  return out
}

/** a row the view keeps on screen though the text writes no note of it: just added, or just emptied */
export interface KeptRow {
  sound: string
  part: number
}

/** a pattern as rows of cells, from the trees of bars `0 … n−1` — or why it has none */
export function exactGridFrom(probed: readonly BarTree[], kept: readonly KeptRow[] = []): ExactGrid {
  const rep = repeatingBars(probed)
  const grid = treeGridFrom(probed, 'allowed')
  if (!rep.ok) return rep
  if (!grid.ok) return grid
  const divisions = new Map<number, number>()
  for (const t of rep.trees) t.parts.forEach((row, p) => divisions.set(p, finest(row, divisions.get(p) ?? 1)))
  // rows the view keeps come after the rows the text writes, in their own part's place
  const written = grid.rows.map((r) => `${r.part}\u0000${r.sound}`)
  const extra = kept
    .filter((k) => !written.includes(`${k.part}\u0000${k.sound}`) && rep.trees[0].parts[k.part])
    .map((k): TreeRow => {
      const perBar: FracStep[][] = []
      let why: string | null = null
      for (const t of rep.trees) {
        const steps = barStepsOrWhy(t.parts[k.part], k.sound)
        if (typeof steps === 'string') why = why ?? steps
        else perBar.push(steps)
      }
      return { sound: k.sound, part: k.part, bars: why ? null : perBar, why, hits: [] }
    })
  const rows = [...grid.rows, ...extra].map((r): ExactRow => {
    const cells: ExactCell[] = []
    for (let b = 0; b < rep.bars; b++) {
      const row = rep.trees[b].parts[r.part]
      const steps = barStepsOrWhy(row, r.sound)
      if (typeof steps === 'string') {
        cells.push(...hitCells(row, r.sound, b, []))
        continue
      }
      const mine = starts(row, r.sound, new Set())
      for (const leaf of leavesOf(steps)) cells.push(...leafCells(leaf, b, divisions.get(r.part) ?? 1, mine))
    }
    return { ...r, cells }
  })
  // a sort is stable: rows that first play together keep the order the text writes them
  const firstPlay = (r: ExactRow): number => r.hits[0]?.begin ?? Infinity
  rows.sort((a, b) => a.part - b.part || firstPlay(a) - firstPlay(b))
  return { ok: true, bars: rep.bars, trees: rep.trees, rows }
}

/** a pattern as rows of cells, from its mini string */
export function exactGridOf(mini: string, kept: readonly KeptRow[] = []): ExactGrid {
  return exactGridFrom(probeTrees(mini), kept)
}

/** a cell's position in cycles from the pattern's start */
export const cellAt = (c: Pick<ExactCell, 'bar' | 'begin'>): number => c.bar + fracNum(c.begin)
export const cellEnd = (c: Pick<ExactCell, 'bar' | 'end'>): number => c.bar + fracNum(c.end)

/**
 * The cells a row draws when a bar is `barPx` wide (the design's option B): a snap half only once
 * it is wide enough to aim at. Until then the step is one cell, and a click on it is the click on
 * its first place. A step's own places (`hh*4`) are always drawn: each is a hit.
 */
export function drawnCells(cells: readonly ExactCell[], barPx: number, openPx = OPEN_PX): ExactCell[] {
  const out: ExactCell[] = []
  for (const c of cells) {
    const wide = (fracNum(c.end) - fracNum(c.begin)) * barPx >= openPx - 1e-6
    const last = out[out.length - 1]
    if (c.split && !wide && last) out[out.length - 1] = { ...last, end: c.end }
    else out.push(c)
  }
  return out
}

/**
 * The text with every note of a row taken out, one step at a time through the writer — or why
 * not: the first note the writer refuses. Nothing is written unless all of them can be.
 */
export function removeRowText(mini: string, bars: number, row: KeptRow, order: readonly string[]): { ok: true; mini: string } | { ok: false; why: string } {
  let text = mini
  for (let guard = 0; guard < 4096; guard++) {
    const g = exactGridFrom(chunkDivisions(text, 2 * bars), [row])
    if (!g.ok) return { ok: false, why: g.why }
    const r = g.rows.find((x) => x.sound === row.sound && x.part === row.part)
    const on = r?.cells.find((c) => c.on)
    if (!r || !on) return { ok: true, mini: text }
    const e = cellEdit(text, g.trees, r, order, on)
    if (!e.ok) return { ok: false, why: e.why }
    text = applyStepEdit(text, e.edit)
  }
  return { ok: false, why: 'too-many-notes' }
}

/** does the pattern play numbers, which the roll shows, rather than a row of sounds? */
export function playsNumbers(trees: readonly BarTree[]): boolean {
  let any = false
  let all = true
  const visit = (row: DivisionRow): void => {
    for (const s of row.steps) {
      for (const h of s.hits) {
        any = true
        const v = Array.isArray(h.value) ? h.value[0] : h.value
        if (typeof v !== 'number') all = false
      }
      for (const r of s.rows ?? []) visit(r)
    }
  }
  for (const t of trees) if (t.ok) t.parts.forEach(visit)
  return any && all
}

/** a click that would add a hit where the chain's `.gain` is a rest: the hit would play nothing (#2467) */
export type GainRestRefusal = 'under-a-gain-rest'

/**
 * What a click on `cell` of `row` writes: a toggle where a step or a hit begins, a split part-way
 * through a plain step, or the writer's refusal. `order` is the part's rows in the order drawn.
 *
 * `silent`: the chain's `.gain` is a rest at the cell's place (`gainLevelsAt` says null there).
 * A click that would ADD a hit there is refused — Strudel keeps only the hits the gain covers,
 * so the hit would be written and never heard (#2467). Erasing a hit there is still a click.
 */
export function cellEdit(
  mini: string,
  trees: readonly BarTree[],
  row: Pick<ExactRow, 'sound' | 'part'>,
  order: readonly string[],
  cell: Pick<ExactCell, 'bar' | 'begin'> & { on?: boolean },
  silent = false,
): (StepEditResult & { split?: true }) | { ok: false; why: StepAtRefusal | GainRestRefusal } {
  const writerRow = { sound: row.sound, part: row.part, order }
  const at = stepAddressAtPlace(trees, row, cell.bar, cell.begin)
  if (at === 'inside-a-step') {
    const inside = splitAddressAtPlace(trees, row, cell.bar, cell.begin)
    if (!inside) return { ok: false, why: at }
    const r = splitStep(mini, trees, inside.address, inside.at, writerRow)
    if (r.ok && silent) return { ok: false, why: 'under-a-gain-rest' }
    return r.ok ? { ...r, split: true } : r
  }
  if (typeof at === 'string') return { ok: false, why: at }
  const r = toggleStep(mini, trees, at, writerRow)
  return r.ok && silent && !cell.on ? { ok: false, why: 'under-a-gain-rest' } : r
}
