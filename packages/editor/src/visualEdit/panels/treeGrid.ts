/**
 * treeGrid.ts — a step grid drawn from the pattern's own divisions alone, for a pattern
 * that has no column model (#1834, #2287, epic #1832).
 *
 * The step grid edits through columns: every bar cut into equal steps. A pattern whose
 * bar needs more than 64 of them (`hh hh [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]` needs
 * 96), or whose onsets land on no column, has no column model, and the Pattern tab had
 * nothing to show for it. Strudel's own answer has no such limit: each bar's tree
 * (`chunkDivisions`) says where every written step sits, as exact shares of the bar. This
 * file turns that tree into what a grid draws — rows, step boxes, the small boxes inside a
 * step that is not open, the lines, the ruler and the hits — all at exact positions. It
 * is LOOK-ONLY: there are no columns, so there is nothing a click could write through.
 *
 * Pure: the component (`TreeStepGrid.tsx`) only renders what this returns. Positions are
 * in CYCLES from the pattern's start (bar `b` is `[b, b + 1)`), so the component turns a
 * position into pixels with one multiplication.
 *
 * ROWS are named as the step grid names them (`StepLane.sound`): one per sound per comma
 * part, `:n` tails included (`bd:4` and `bd` are two rows), in written order.
 */
import { chunkDivisions, chunkPeriod, parseStepGrid, type BarTree, type DivisionRow, type Frac } from '../../codeView'
import { barStepsOrWhy, fracNum, OPEN_PX, type FracStep } from './gridZoom'
import { perText, type PerText } from './useDeferredPerText'

/** the repeat first looked for: the step grid's own cap when it reads a pattern leaf by leaf */
export const TREE_MAX_BARS = 12
/**
 * The longest repeat drawn. A long `< >` is an ordinary pattern (the corpus opens one of 28
 * bars), and asking its hits is what it costs; trees of those bars took under 40 ms each
 * pattern (#2454, measured over the corpus).
 */
export const TREE_LONG_BARS = 64
/**
 * How many bars are read to find where the pattern repeats: every repeat up to the cap is
 * seen twice, the grid's own rule (`detectPeriod`). Reading all 24 as trees cost up to 39 s
 * on one corpus pattern (a 100-part stack), so the period is asked of the hits first and
 * only twice the period is built (`probeTrees`).
 */
const PROBE_BARS = 2 * TREE_MAX_BARS

export interface TreeHit {
  /** cycles from the pattern's start */
  begin: number
  end: number
}

export interface TreeRow {
  /** the row's name: a note as written, `:` tails included */
  sound: string
  /** its comma part */
  part: number
  /** each bar's steps, exact; null when a bar's steps do not tile it (`why` says so) */
  bars: FracStep[][] | null
  why: string | null
  /** what the row plays, every bar */
  hits: TreeHit[]
}

export type TreeGrid = { ok: true; bars: number; rows: TreeRow[] } | { ok: false; why: string }

/** why no tree grid: the tree's own reason, or one of these */
export type TreeGridRefusal =
  /** the pattern's bars do not repeat within `TREE_LONG_BARS` */
  | 'does-not-repeat'
  /** the comma parts are a random choice (`a | b`): no part is a row of its own */
  | 'parts-are-a-choice'
  /** a hit's note has no plain name (`bd:<1 2>`): it belongs to no row */
  | 'unnamed-hit'
  /** the pattern plays nothing */
  | 'no-hits'

/** the smallest period `p ≤ TREE_LONG_BARS` the bars repeat at, seen twice; null when none */
function period(trees: readonly BarTree[]): number | null {
  const keys = trees.map((t) => JSON.stringify(t))
  for (let p = 1; p <= TREE_LONG_BARS && 2 * p <= keys.length; p++) {
    let ok = true
    for (let k = 0; k + p < keys.length && ok; k++) if (keys[k] !== keys[k + p]) ok = false
    if (ok) return p
  }
  return null
}

export type OkTree = Extract<BarTree, { ok: true }>

/**
 * The bars the pattern repeats over, each a tree — or why not: a bar the tree refuses, no
 * repeat within `TREE_LONG_BARS`, or comma parts that are a random choice. Shared by the
 * step grid and the roll drawn from the tree.
 */
export function repeatingBars(probed: readonly BarTree[]): { ok: true; bars: number; trees: OkTree[] } | { ok: false; why: string } {
  for (const t of probed) if (!t.ok) return { ok: false, why: t.why }
  const bars = period(probed)
  if (bars === null) return { ok: false, why: 'does-not-repeat' }
  const trees = probed.slice(0, bars) as OkTree[]
  if (trees.some((t) => t.oneOf && t.parts.length > 1)) return { ok: false, why: 'parts-are-a-choice' }
  return { ok: true, bars, trees }
}

/**
 * The bars a pattern's period is looked for in, each a tree. The period is asked of what
 * the pattern PLAYS first (`chunkPeriod`, cheap), and only twice that many bars are built
 * as trees, so `repeatingBars` checks the trees repeat there too. When they do not (the
 * text repeats later than the sound), or the hits do not repeat within the cap, all
 * `PROBE_BARS` are built and `repeatingBars` decides on them, as before.
 */
export function probeTrees(mini: string): BarTree[] {
  // the long question only once the short one has no answer: it reads 128 bars of hits
  const p = chunkPeriod(mini, TREE_MAX_BARS) ?? chunkPeriod(mini, TREE_LONG_BARS)
  if (p === null) return chunkDivisions(mini, PROBE_BARS)
  const first = chunkDivisions(mini, 2 * p)
  // the trees can repeat later than the hits: `<r l r l>` plays as `<r l>` but is written
  // as four arms (`s@3 <l r> s@3 <r l r l> …` plays every 6 bars, is written every 12)
  const rep = repeatingBars(first)
  if (!rep.ok && rep.why === 'does-not-repeat') return chunkDivisions(mini, PROBE_BARS)
  return first
}

/** every note step in the row at any depth, with its name */
function eachNote(row: DivisionRow, visit: (name: string | null, hits: readonly { begin: Frac; end: Frac }[]) => void): void {
  for (const s of row.steps) {
    if (s.hits.length > 0) visit(s.text, s.hits)
    for (const r of s.rows ?? []) eachNote(r, visit)
  }
}

/** a pattern's tree grid, from its mini string: its bars, rows and hits — or why there is none */
export function treeGridOf(mini: string): TreeGrid {
  return treeGridFrom(probeTrees(mini))
}

/** `treeGridOf`, from the trees of bars `0 … n−1` */
export function treeGridFrom(probed: readonly BarTree[], silent: 'refused' | 'allowed' = 'refused'): TreeGrid {
  const rep = repeatingBars(probed)
  if (!rep.ok) return rep
  const { bars, trees } = rep
  const rows: TreeRow[] = []
  const parts = trees[0].parts.length
  let played = 0
  for (let p = 0; p < parts; p++) {
    // the sounds are every note the part writes, in every arm: the same in every bar
    for (const sound of trees[0].parts[p].notes) {
      const hits: TreeHit[] = []
      let why: string | null = null
      const perBar: FracStep[][] = []
      trees.forEach((t, b) => {
        const row = t.parts[p]
        eachNote(row, (name, hs) => {
          if (name === sound) for (const h of hs) hits.push({ begin: b + fracNum(h.begin), end: b + fracNum(h.end) })
        })
        const steps = barStepsOrWhy(row, sound)
        if (typeof steps === 'string') why = why ?? steps
        else perBar.push(steps)
      })
      hits.sort((x, y) => x.begin - y.begin)
      played += hits.length
      rows.push({ sound, part: p, bars: why ? null : perBar, why, hits })
    }
  }
  // every hit of the bar is some row's, or a row is missing from the picture
  for (const t of trees) {
    for (const part of t.parts) {
      let unnamed = false
      eachNote(part, (name) => {
        if (name === null) unnamed = true
      })
      if (unnamed) return { ok: false, why: 'unnamed-hit' }
    }
  }
  // nothing to look at; an editable grid still has its rests to write into
  if (played === 0 && silent === 'refused') return { ok: false, why: 'no-hits' }
  return { ok: true, bars, rows }
}

/**
 * The refusals a tree grid does NOT stand in for: the pattern is not a row of sounds at
 * all (numbers, which the roll shows; nothing that plays; a mix of pitch kinds), or its
 * text is not the text Strudel plays (a backslash escape). Every other refusal is about
 * the columns — too many, an onset between them, a period too long for them, a hit with no
 * text of its own — and the tree has no columns.
 */
const NOT_A_GRID: ReadonlySet<string | undefined> = new Set<string | undefined>(['wrong-surface', 'no-note-content', 'mixed-pitch-domain', 'escaped-source'])

/**
 * What the step grid draws for a pattern it has no column model for: the tree grid and
 * the sentence that says why it is look-only — or null when the column grid draws it (it
 * has a model, editable or look-only), when the refusal is not about columns, or when the
 * tree has no grid either (`treeGridOf`'s reason, for the corpus count). Kept per text.
 */
export const lookOnlyTreeGrid: PerText<{ grid: Extract<TreeGrid, { ok: true }>; reason: string } | { why: string } | null> = perText(lookOnlyTreeGridUncached)

function lookOnlyTreeGridUncached(mini: string): { grid: Extract<TreeGrid, { ok: true }>; reason: string } | { why: string } | null {
  const g = parseStepGrid(mini)
  if (g.ok || g.lookOnly) return null
  if (NOT_A_GRID.has(g.gate)) return null
  const t = treeGridOf(mini)
  if (!t.ok) return { why: t.why }
  return { grid: t, reason: g.reason }
}

/* ── what a row draws at a zoom ─────────────────────────────────── */

/** a step as drawn: where it is, in cycles, how deep, and whether it is open */
export interface DrawnFracStep {
  begin: number
  end: number
  depth: number
  open: boolean
  children: DrawnFracStep[] | null
}

/**
 * Which steps are open, given how wide a bar is on screen: a step opens when each step
 * inside it is at least `openPx` wide — the step grid's rule (`openAt`), on exact shares.
 * `openPx` Infinity opens nothing: 1×.
 */
export function openFracAt(bars: readonly (readonly FracStep[])[], barPx: number, openPx = OPEN_PX): DrawnFracStep[][] {
  return bars.map((steps, b) => {
    const at = (n: FracStep): DrawnFracStep => {
      const open = !!n.children && n.children.every((k) => (fracNum(k.end) - fracNum(k.begin)) * barPx >= openPx - 1e-6)
      return {
        begin: b + fracNum(n.begin),
        end: b + fracNum(n.end),
        depth: n.depth,
        open,
        children: n.children && open ? n.children.map(at) : null,
      }
    }
    return steps.map(at)
  })
}

/** what one row draws, in cycles */
export interface TreeRowDrawing {
  /** each step that is not open: one box */
  steps: Array<{ begin: number; end: number; depth: number }>
  /** inside a step that is not open, the steps it holds, as small boxes */
  inner: Array<{ begin: number; end: number; depth: number }>
  /** where a drawn step begins that is not a bar line, at the shallowest depth beginning there */
  lines: Array<{ at: number; depth: number }>
}

/** the leaves under a step: what its small boxes are */
function leaves(n: FracStep, b: number, out: TreeRowDrawing['inner']): void {
  for (const k of n.children ?? []) {
    if (k.children) leaves(k, b, out)
    else out.push({ begin: b + fracNum(k.begin), end: b + fracNum(k.end), depth: k.depth })
  }
}

/** a row's boxes and lines at a zoom, from its exact steps */
export function drawTreeRow(bars: readonly (readonly FracStep[])[], barPx: number, openPx = OPEN_PX): TreeRowDrawing {
  const out: TreeRowDrawing = { steps: [], inner: [], lines: [] }
  const lines = new Map<number, number>()
  const drawn = openFracAt(bars, barPx, openPx)
  // the exact steps beside the drawn ones, to find each closed step's leaves
  const walk = (d: DrawnFracStep, n: FracStep, b: number): void => {
    if (d.begin !== b && (!lines.has(d.begin) || lines.get(d.begin)! > d.depth)) lines.set(d.begin, d.depth)
    if (d.open && d.children) {
      d.children.forEach((c, i) => walk(c, n.children![i], b))
      return
    }
    out.steps.push({ begin: d.begin, end: d.end, depth: d.depth })
    if (n.children) leaves(n, b, out.inner)
  }
  drawn.forEach((row, b) => row.forEach((d, i) => walk(d, bars[b][i], b)))
  out.lines = [...lines].map(([at, depth]) => ({ at, depth })).sort((x, y) => x.at - y.at)
  return out
}

/**
 * The ruler at a zoom: each bar's number, then each drawn step named by its place in the
 * pattern — `1.2`, then `1.2.2` once step 1.2 is open. A position takes the shallowest
 * name that starts there (`1.2.1` is `1.2`), as the step grid's ruler does (`zoomRuler`).
 */
export function treeRuler(bars: readonly (readonly FracStep[])[], barPx: number, openPx = OPEN_PX): Array<{ at: number; label: string }> {
  const out = new Map<number, string>()
  const drawn = openFracAt(bars, barPx, openPx)
  const name = (nodes: readonly DrawnFracStep[], prefix: string): void => {
    nodes.forEach((n, i) => {
      const label = `${prefix}.${i + 1}`
      if (!out.has(n.begin)) out.set(n.begin, label)
      if (n.open && n.children) name(n.children, label)
    })
  }
  drawn.forEach((row, b) => {
    out.set(b, String(b + 1))
    row.forEach((n, i) => {
      const label = `${b + 1}.${i + 1}`
      if (i > 0) out.set(n.begin, label)
      if (n.open && n.children) name(n.children, label)
    })
  })
  return [...out].map(([at, label]) => ({ at, label })).sort((x, y) => x.at - y.at)
}

/** the pattern's position a cycle plays, in cycles from its start: exact, never rounded to a step */
export function treePlayhead(cycle: number | null, bars: number): number | null {
  if (cycle === null || !Number.isFinite(cycle) || bars <= 0) return null
  return ((cycle % bars) + bars) % bars
}
