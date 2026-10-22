/**
 * perBar — a multi-bar pattern drawn with each bar at its OWN step count (#1827).
 *
 * `<[c3 e3 g3] [c3 e3 g3 b3]>` is a bar of three followed by a bar of four. The
 * parsers lay every bar on one shared column grid, the least common multiple of the
 * bars' own counts, so this pattern used to open as 24 columns (both bars drawn at
 * 12) and `<[8 steps] [7 steps]>` did not open at all (112 columns, past the cap).
 *
 * The shared grid is still what the WRITERS need: every one of them slices bars as
 * equal runs of columns, and their region tables were captured in that space. So it
 * stays the representation on the way in and on the way out, and this module is the
 * one exact map between it and what the panel draws:
 *
 *   shared column  u  in bar b  (b·P ≤ u < (b+1)·P, P = columns per bar)
 *   drawn column   d  in bar b  (D_b ≤ d < D_b + s_b, D_b = s_0 + … + s_{b−1})
 *   d = D_b + (u − b·P) · s_b / P
 *
 * A model carrying `barSteps` holds its notes and cells in DRAWN columns, so every
 * panel keeps working in whole cells exactly as it did; `toUniform*` puts the shared
 * grid back for the writers, and the parser calls `toDrawn*` once, last.
 *
 * WHEN IT APPLIES. Only when the bars' counts do not nest. `<[a b c d] [e]>` (4 and 1)
 * or 8 and 4 keep the uniform layout they have always had, which is what lets a bar
 * that is one rest take new notes at its neighbours' resolution; 3 and 4, or 8 and 7,
 * are the patterns the uniform layout draws wrong or cannot draw.
 */
import type { PianoRollModel, RollNote, StepCell, StepGridModel } from './model'

/** columns a model may hold on the shared grid when it is DRAWN per bar */
export const MAX_SHARED_STEPS = 4096

const EPS = 1e-9

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** exact least common multiple of small positive integers */
export function lcmOf(ns: readonly number[]): number {
  return ns.reduce((l, n) => (l / gcd(l, n)) * n, 1)
}

/**
 * The per-bar layout for bars of these counts, or null for the uniform one. Null
 * when there is one bar, when any count is not a positive integer, or when every
 * count divides the largest (the counts nest, and uniform draws them exactly).
 */
export function perBarLayout(counts: readonly number[]): number[] | null {
  if (counts.length < 2) return null
  if (counts.some((n) => !Number.isInteger(n) || n < 1)) return null
  const most = Math.max(...counts)
  return counts.every((n) => most % n === 0) ? null : [...counts]
}

/** snap a value that should be a whole number of columns, or keep it as it is */
function tidy(x: number): number {
  const r = Math.round(x)
  return Math.abs(x - r) < EPS ? r : x
}

/** where each bar starts, in drawn columns, with the total as a final entry */
export function barStarts(barSteps: readonly number[]): number[] {
  const out = [0]
  for (const s of barSteps) out.push(out[out.length - 1] + s)
  return out
}

/** drawn column → shared column */
export function sharedAt(d: number, barSteps: readonly number[]): number {
  const P = lcmOf(barSteps)
  let at = 0
  for (let b = 0; b < barSteps.length; b++) {
    const s = barSteps[b]
    if (d <= at + s + EPS || b === barSteps.length - 1) return tidy(b * P + ((d - at) * P) / s)
    at += s
  }
  return barSteps.length * P
}

/** shared column → drawn column */
export function drawnAt(u: number, barSteps: readonly number[]): number {
  const P = lcmOf(barSteps)
  const b = Math.min(barSteps.length - 1, Math.max(0, Math.floor((u + EPS) / P)))
  const starts = barStarts(barSteps)
  return tidy(starts[b] + ((u - b * P) * barSteps[b]) / P)
}

/** the bar a drawn column falls in */
export function barOfDrawn(d: number, barSteps: readonly number[]): number {
  const starts = barStarts(barSteps)
  for (let b = barSteps.length - 1; b >= 0; b--) if (d + EPS >= starts[b]) return b
  return 0
}

function mapNote(n: RollNote, f: (x: number) => number): RollNote {
  const start = f(n.start)
  return { ...n, start, duration: tidy(f(n.start + n.duration) - start) }
}

/**
 * The drawn form of a roll the parser built on the shared grid, or null when a note
 * does not land on the drawn columns (then the caller keeps the uniform model).
 */
export function toDrawnRoll(model: PianoRollModel, barSteps: number[]): PianoRollModel | null {
  const bars = model.bars ?? 1
  if (bars !== barSteps.length || model.steps !== bars * lcmOf(barSteps)) return null
  const notes = model.notes.map((n) => mapNote(n, (u) => drawnAt(u, barSteps)))
  if (notes.some((n) => !Number.isInteger(n.start))) return null
  return { ...model, steps: barSteps.reduce((a, b) => a + b, 0), barSteps, notes }
}

/** the shared-grid form a writer needs; a uniform model is returned as it is */
export function toUniformRoll(model: PianoRollModel): PianoRollModel {
  const barSteps = model.barSteps
  if (!barSteps) return model
  const { barSteps: _drop, ...rest } = model
  return {
    ...rest,
    steps: barSteps.length * lcmOf(barSteps),
    notes: model.notes.map((n) => mapNote(n, (d) => sharedAt(d, barSteps))),
  }
}

function mapCells(
  cells: readonly StepCell[],
  length: number,
  f: (x: number) => number,
): StepCell[] | null {
  const out: StepCell[] = Array.from({ length }, () => false)
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (!c) continue
    const at = f(i)
    if (!Number.isInteger(at) || at < 0 || at >= length) return null
    out[at] = { ...c, duration: tidy(f(i + c.duration) - at) }
  }
  return out
}

/** the drawn form of a grid the parser built on the shared grid, or null (keep uniform) */
export function toDrawnGrid(model: StepGridModel, barSteps: number[]): StepGridModel | null {
  const bars = model.bars ?? 1
  if (bars !== barSteps.length || model.steps !== bars * lcmOf(barSteps) || model.gains) return null
  const steps = barSteps.reduce((a, b) => a + b, 0)
  const lanes = []
  for (const lane of model.lanes) {
    const cells = mapCells(lane.cells, steps, (u) => drawnAt(u, barSteps))
    if (cells === null) return null
    lanes.push({ ...lane, cells })
  }
  return { ...model, steps, barSteps, lanes }
}

/** the shared-grid form a writer needs; a uniform grid is returned as it is */
export function toUniformGrid(model: StepGridModel): StepGridModel {
  const barSteps = model.barSteps
  if (!barSteps) return model
  const { barSteps: _drop, ...rest } = model
  const steps = barSteps.length * lcmOf(barSteps)
  return {
    ...rest,
    steps,
    // A drawn cell always lands on the shared grid (each shared bar is a multiple of
    // every drawn one), so this cannot decline; the fallback is unreachable by design.
    lanes: model.lanes.map((l) => ({ ...l, cells: mapCells(l.cells, steps, (d) => sharedAt(d, barSteps)) ?? l.cells })),
  }
}

/** How a panel lays out the cells it draws — the one answer both grids ask (#1827). */
export interface DrawnLayout {
  /** a cell's width relative to the finest bar's cell: every bar comes out the same width */
  weight: (col: number) => number
  /** does a bar (after the first) begin at this cell? */
  barStart: (col: number) => boolean
  /** cells in the last bar — what one more bar at the end would hold */
  lastBarCols: number
}

export function drawnLayout(
  model: { bars?: number; barSteps?: readonly number[] },
  cols: number,
): DrawnLayout {
  const bs = model.barSteps
  if (bs) {
    const most = Math.max(...bs)
    const starts = barStarts(bs)
    return {
      weight: (c) => most / bs[barOfDrawn(c, bs)],
      barStart: (c) => c > 0 && starts.includes(c),
      lastBarCols: bs[bs.length - 1],
    }
  }
  const bars = model.bars ?? 1
  const perBar = bars > 1 && Number.isInteger(cols / bars) ? cols / bars : 0
  return {
    weight: () => 1,
    barStart: (c) => perBar > 0 && c > 0 && c % perBar === 0,
    lastBarCols: perBar || cols,
  }
}
