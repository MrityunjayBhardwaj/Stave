/**
 * gridZoom.ts — a grid row as the pattern's own steps, nested, and which of them are open
 * at a zoom (#2277, #2276, #1834, epic #1832).
 *
 * The bar's tree comes from codeView (`chunkDivisions` / `laneDivisions`, asked of
 * Strudel). Its steps are EXACT SHARES OF THE BAR (`FracStep`, `barStepsOrWhy`): that is
 * where every grid's steps are drawn from (#1834). A row that has a column model lays them
 * on the columns every cell, click and write already uses (`laneSteps`), so nothing here
 * changes what a click edits: column `c` of a bar whose columns are `[start, start + per)`
 * is the fraction `(c − start) / per` (`columnOf`). A row with no column model draws the
 * fractions as they are (`treeGrid.ts`).
 *
 *   `bd [~ bd] sd ~` (8 columns)  →  bd [0,2) · [ ~ [2,3) · bd [3,4) ] · sd [4,6) · ~ [6,8)
 *                    (fractions)  →  bd [0,¼) · [ ~ [¼,⅜) · bd [⅜,½) ] · sd [½,¾) · ~ [¾,1)
 *
 * ZOOM OPENS A LEVEL. Once zoomed in, a step that holds smaller steps opens when each of
 * them is at least `OPEN_PX` wide on screen (the grid's own click floor, 16 px a column);
 * until then it is drawn as one step with its columns as small boxes inside it, which is
 * how every such step is drawn at 1× (the grid asks `openAt` with no width that opens).
 *
 * A row gets column nodes only when they hold exactly: every bar has a tree for the row,
 * every edge lands on a whole column, and the row's notes start where its cells do (the
 * same check the corpus test pins). Otherwise `null`, and the row draws as it does today.
 */
import { laneDivisions, laneRowForEdit, type BarTree, type DivisionRow, type DivisionStep, type Frac, type StepAddress, type StepGridModel } from '../../codeView'
import { groupBoxesBySteps, type StepGroup } from './writtenSteps'

/** a step opens once each step inside it is at least this wide: the grid's click floor */
export const OPEN_PX = 16

export interface StepNode {
  /** drawn columns `[from, to)` */
  from: number
  to: number
  /** 1 for the row's own steps, 2 for the steps inside one of them, … */
  depth: number
  /** the steps inside, tiling `[from, to)`; null for a note or a rest, and for a step whose inside is not one row of this sound */
  children: StepNode[] | null
}

/** where bar `b` starts and how many drawn columns it has */
function barColumns(m: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, b: number): { start: number; per: number } {
  const bars = m.bars ?? 1
  if (m.barSteps) return { start: m.barSteps.slice(0, b).reduce((a, n) => a + n, 0), per: m.barSteps[b] }
  return { start: b * (m.steps / bars), per: m.steps / bars }
}

/**
 * Column `end` as a share of the bar column `col` is in (#2293): a note's end, which may be
 * the bar's last edge (1). Null past that bar.
 */
export function endInBar(m: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, col: number, end: number): Frac | null {
  const bars = m.bars ?? 1
  for (let b = 0; b < bars; b++) {
    const { start, per } = barColumns(m, b)
    if (col < start || col >= start + per) continue
    return end > start && end <= start + per ? frac(end - start, per) : null
  }
  return null
}

/**
 * Column `col` as a bar and the exact share of it it begins at (#2294): the roll's address of
 * a place, as the step writer takes it. Null past the last bar.
 */
export function columnPlace(m: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, col: number): { bar: number; at: Frac } | null {
  const bars = m.bars ?? 1
  for (let b = 0; b < bars; b++) {
    const { start, per } = barColumns(m, b)
    if (col >= start && col < start + per) return { bar: b, at: frac(col - start, per) }
  }
  return null
}

/* ── exact fractions of a bar ───────────────────────────────────── */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))

/** `n/d` in lowest terms, the sign on the top */
export function frac(n: number, d: number): Frac {
  const g = gcd(n, d) || 1
  const s = d < 0 ? -1 : 1
  return { n: (s * n) / g, d: (s * d) / g }
}
const cmp = (a: Frac, b: Frac): number => a.n * b.d - b.n * a.d
const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d)
const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d)
/** `a · k / n` */
const scale = (a: Frac, k: number, n: number): Frac => frac(a.n * k, a.d * n)
const fmax = (a: Frac, b: Frac): Frac => (cmp(a, b) >= 0 ? a : b)
const fmin = (a: Frac, b: Frac): Frac => (cmp(a, b) <= 0 ? a : b)
export const fracNum = (x: Frac): number => x.n / x.d
const ZERO = frac(0, 1)
const ONE = frac(1, 1)

/**
 * A step of one bar as the share of the bar it takes, exactly (#1834). This is where every
 * grid's steps are: a row with a column model lays these on its columns (`laneSteps`), one
 * without draws them as they are (`treeGrid.ts`).
 */
export interface FracStep {
  /** `[begin, end)` of the bar, 0 … 1 */
  begin: Frac
  end: Frac
  /** 1 for the row's own steps, 2 for the steps inside one of them, … */
  depth: number
  /** the steps inside, tiling `[begin, end)`; null for a note or a rest, and for a step whose inside is not one row of this sound */
  children: FracStep[] | null
}

/**
 * THE COLUMN A FRACTION IS, for a row that has columns: bar fraction `f` of a bar whose
 * columns are `[start, start + per)` is column `start + f · per`, or null when that is not
 * a whole column. Its inverse is `(c − start) / per`. The two are the whole relationship
 * between where a step is and the columns a click goes through.
 */
export function columnOf(f: Frac, start: number, per: number): number | null {
  const c = (f.n * per) / f.d
  const r = Math.round(c)
  return Math.abs(c - r) > 1e-9 ? null : start + r
}

/**
 * The inner row of a group step this lane draws: its only row, or under several (`[hh hh, cp]`)
 * the one that writes the lane's sound, if exactly one does.
 */
function innerRow(s: DivisionStep, sound: string): DivisionRow | null {
  if (!s.rows || s.oneOf) return null
  if (s.rows.length === 1) return s.rows[0]
  const mine = s.rows.filter((r) => r.sounds.includes(sound))
  return mine.length === 1 ? mine[0] : null
}

/** the row's steps that begin inside `[within.b, within.e)` of the bar, as written */
function nodesOf(row: DivisionRow, within: { b: Frac; e: Frac }, depth: number, sound: string): FracStep[] {
  const out: FracStep[] = []
  for (const s of row.steps) {
    for (const slot of s.slots) {
      const b = fmax(slot.begin, ZERO)
      const e = fmin(slot.end, ONE)
      if (cmp(b, within.b) < 0 || cmp(b, within.e) >= 0) continue
      // `bd!3` is written once and is three steps, and so is `bd@3` (#1845, #1846): each an
      // equal share of the slot. krill folds `!n` into the weight (`bd!3` weighs 3), so a note
      // is cut by its weight; a group by its `!` alone — under `@` what it holds spans it.
      const parts = s.rows === null ? (Number.isInteger(s.weight) && s.weight > 1 ? s.weight : 1) : s.reps
      const n = slot.fromBefore || slot.pastEnd ? 1 : parts
      const len = sub(e, b)
      for (let k = 0; k < n; k++) out.push(stepNode(s, add(b, scale(len, k, n)), add(b, scale(len, k + 1, n)), depth, sound))
    }
  }
  return out.sort((x, y) => cmp(x.begin, y.begin))
}

function stepNode(s: DivisionStep, b: Frac, e: Frac, depth: number, sound: string): FracStep {
  const node: FracStep = { begin: b, end: e, depth, children: null }
  const inner = innerRow(s, sound)
  if (!inner) return node
  if (s.copies) {
    // a group its own op repeats (`[~ hh]*4`): the copies are a level of their own
    const copies = s.copies
      .filter((c) => cmp(c.begin, b) >= 0 && cmp(c.begin, e) < 0)
      .map((c): FracStep => {
        const cb = fmax(c.begin, ZERO)
        const ce = fmin(c.end, ONE)
        return { begin: cb, end: ce, depth: depth + 1, children: nodesOf(inner, { b: cb, e: ce }, depth + 2, sound) }
      })
    node.children = copies.length > 1 ? copies : copies.length === 1 ? copies[0].children!.map((n) => lift(n)) : null
    return node
  }
  node.children = nodesOf(inner, { b, e }, depth + 1, sound)
  return node
}

/** one copy alone is not a level: its steps move up one */
function lift(n: FracStep): FracStep {
  return { ...n, depth: n.depth - 1, children: n.children ? n.children.map(lift) : null }
}

/** does every node tile its parent edge to edge, with at least two inside? */
function tiles(nodes: FracStep[], from: Frac, to: Frac): boolean {
  let at = from
  for (const n of nodes) {
    if (cmp(n.begin, at) !== 0 || cmp(n.end, n.begin) <= 0) return false
    // a level of one step is not a level: what it holds moves up (`<bd [bd bd]>` in the
    // bar that plays `[bd bd]` is the two steps, not a step holding one)
    while (n.children && n.children.length === 1) {
      const only = n.children[0]
      if (cmp(only.begin, n.begin) !== 0 || cmp(only.end, n.end) !== 0) return false
      n.children = only.children ? only.children.map(lift) : null
    }
    if (n.children && !tiles(n.children, n.begin, n.end)) return false
    at = n.end
  }
  return cmp(at, to) === 0
}

/** every edge in the steps, at every depth */
function edges(nodes: readonly FracStep[], out: Frac[] = []): Frac[] {
  for (const n of nodes) {
    out.push(n.begin, n.end)
    if (n.children) edges(n.children, out)
  }
  return out
}

/** the steps as written, before they are checked: what `barStepsOrWhy` settles */
function writtenSteps(row: DivisionRow, sound: string): FracStep[] {
  return nodesOf(row, { b: ZERO, e: ONE }, 1, sound)
}

/** they tile the bar, a level of one step lifted; null when they do not tile */
function settle(nodes: FracStep[]): FracStep[] | null {
  if (!tiles(nodes, ZERO, ONE)) return null
  // a bar that is one step (`<a [b c]>`'s second bar) is cut by that step: its split is the pulse
  while (nodes.length === 1 && nodes[0].children) nodes = nodes[0].children.map(lift)
  return nodes
}

/**
 * Bar row `row`'s steps for sound `sound` (the grid row's name; `''` for a roll's part, which
 * has no row per sound), as exact shares of the bar — or `does-not-tile`.
 */
export function barStepsOrWhy(row: DivisionRow, sound: string): FracStep[] | 'does-not-tile' {
  return settle(writtenSteps(row, sound)) ?? 'does-not-tile'
}

/** the steps laid on a bar's columns; null when an edge is not on one */
function onColumns(nodes: readonly FracStep[], start: number, per: number): StepNode[] | null {
  const out: StepNode[] = []
  for (const n of nodes) {
    const from = columnOf(n.begin, start, per)
    const to = columnOf(n.end, start, per)
    if (from === null || to === null) return null
    let children: StepNode[] | null = null
    if (n.children) {
      children = onColumns(n.children, start, per)
      if (!children) return null
    }
    out.push({ from, to, depth: n.depth, children })
  }
  return out
}

/** where the row's notes named `sound` start, as bar fractions, by the tree */
function treeStarts(row: DivisionRow, sound: string, out: Frac[]): void {
  for (const s of row.steps) {
    if (s.name === sound) for (const h of s.hits) if (cmp(h.begin, ZERO) >= 0 && cmp(h.begin, ONE) < 0) out.push(h.begin)
    for (const r of s.rows ?? []) treeStarts(r, sound, out)
  }
}

/** why a row has no nodes: the tree's own reason for a bar, or which check failed */
export type LaneStepsRefusal = string

/**
 * Lane `lane`'s steps over every bar, nested — or null when they do not hold exactly
 * (see the file's header). `trees[b]` is bar b's tree from `chunkDivisions`.
 */
export function laneSteps(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps' | 'lanes'>, trees: readonly BarTree[], lane: number): StepNode[] | null {
  const r = laneStepsOrWhy(model, trees, lane)
  return typeof r === 'string' ? null : r
}

/**
 * `laneSteps`, saying why when there are none. The steps are the tree's exact shares of
 * each bar (`barStepsOrWhy`); this only lays them on the bar's columns, and checks the
 * columns are this tree's: every edge on a whole column (`off-grid` otherwise), and the
 * row's notes starting exactly where its cells do (`cells-differ`).
 */
export function laneStepsOrWhy(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps' | 'lanes'>, trees: readonly BarTree[], lane: number): StepNode[] | LaneStepsRefusal {
  const bars = model.bars ?? 1
  if (trees.length !== bars) return 'bar-count'
  const l = model.lanes[lane]
  const out: StepNode[] = []
  for (let b = 0; b < bars; b++) {
    const d = laneDivisions(trees[b], l)
    if (!d.ok) return d.why
    const { start, per } = barColumns(model, b)
    const written = writtenSteps(d.row, l.sound)
    if (edges(written).some((f) => columnOf(f, start, per) === null)) return 'off-grid'
    const steps = settle(written)
    if (!steps) return 'does-not-tile'
    const nodes = onColumns(steps, start, per)
    if (!nodes) return 'off-grid'
    // the row's notes start where its cells do, or the tree is not this grid's
    const begins: Frac[] = []
    treeStarts(d.row, l.sound, begins)
    const starts = new Set<number>()
    for (const f of begins) {
      const c = columnOf(f, start, per)
      if (c === null) return 'off-grid'
      starts.add(c)
    }
    for (let c = start; c < start + per; c++) {
      if (!!l.cells[c] !== starts.has(c)) return 'cells-differ'
    }
    out.push(...nodes)
  }
  return out
}

/**
 * A roll's part `part` as its own steps over every bar, nested (#2277) — or why not. A roll
 * has no row per sound, so a group of several rows (a chord, `[c4,e4,g4]`) is one step;
 * every slot and every note's start must land on a whole column.
 */
export function partStepsOrWhy(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, trees: readonly BarTree[], part: number): StepNode[] | LaneStepsRefusal {
  const bars = model.bars ?? 1
  if (trees.length !== bars) return 'bar-count'
  const out: StepNode[] = []
  for (let b = 0; b < bars; b++) {
    const t = trees[b]
    if (!t.ok) return t.why
    const row = t.parts[part]
    if (!row) return 'lane-part-missing'
    const { start, per } = barColumns(model, b)
    const written = writtenSteps(row, '')
    if (edges(written).some((f) => columnOf(f, start, per) === null)) return 'off-grid'
    const steps = settle(written)
    if (!steps) return 'does-not-tile'
    const nodes = onColumns(steps, start, per)
    if (!nodes) return 'off-grid'
    // every note starts on a column, or the roll's columns are not this tree's
    const every = (r: DivisionRow): boolean => {
      for (const s of r.steps) {
        for (const h of s.hits) if (cmp(h.begin, ZERO) >= 0 && cmp(h.begin, ONE) < 0 && columnOf(h.begin, start, per) === null) return false
        for (const k of s.rows ?? []) if (!every(k)) return false
      }
      return true
    }
    if (!every(row)) return 'off-grid'
    out.push(...nodes)
  }
  return out
}

/** `partStepsOrWhy`, null when there are none */
export function partSteps(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, trees: readonly BarTree[], part: number): StepNode[] | null {
  const r = partStepsOrWhy(model, trees, part)
  return typeof r === 'string' ? null : r
}

/** why a drawn column names no step a click can edit */
export type StepAtRefusal = LaneStepsRefusal | 'inside-a-step' | 'step-is-generated' | 'step-is-replicated'

/**
 * The written step a click on lane `lane`, drawn column `col` lands on (#2292): the step
 * of the row this lane draws (the same `innerRow` rule the drawing uses) whose slot BEGINS
 * at that column. A column part-way through a step (`bd@2`'s second column) names none —
 * splitting a step is a later stage's gesture. The address is what `toggleStep` takes.
 */
export function stepAddressAt(
  model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps' | 'lanes'>,
  trees: readonly BarTree[],
  lane: number,
  col: number,
): StepAddress | StepAtRefusal {
  const bars = model.bars ?? 1
  if (trees.length !== bars) return 'bar-count'
  const l = model.lanes[lane]
  if (!l) return 'lane-part-missing'
  for (let b = 0; b < bars; b++) {
    const { start, per } = barColumns(model, b)
    if (col < start || col >= start + per) continue
    // the row the click edits, a voice the text does not write yet included
    const d = laneRowForEdit(trees[b], l)
    if (!d.ok) return d.why
    const want = col - start
    const visit = (row: DivisionRow): StepAddress | null => {
      for (const s of row.steps) {
        const inner = s.rows ? innerRow(s, l.sound) : null
        if (inner) {
          const got = visit(inner)
          if (got) return got
          continue
        }
        if (!s.span) continue
        for (const slot of s.slots) {
          if (slot.fromBefore) continue
          if (columnOf(slot.begin, 0, per) === want) return { bar: b, span: s.span, at: slot.begin }
        }
        // a hit that begins part-way through its step was made by the step's own op
        // (`hh*4`'s second hat, `bd!3`'s second copy). Since #2326 the writer edits one hit
        // of a plain `x*k` / `x!k`, so the address is the step and where that hit begins; it
        // gives the refusal itself for the ops it still does not edit (euclid, `?`, …)
        const hit = s.hits.find((h) => columnOf(h.begin, 0, per) === want)
        if (hit) {
          if (s.ops.every((o) => o === 'tail' || o === 'stretch' || o === 'replicate')) return { bar: b, span: s.span, at: hit.begin }
          generated = s.reps > 1 || s.ops.includes('replicate') ? 'step-is-replicated' : 'step-is-generated'
        }
      }
      return null
    }
    let generated: 'step-is-generated' | 'step-is-replicated' | null = null
    return visit(d.row) ?? generated ?? 'inside-a-step'
  }
  return 'inside-a-step'
}

/**
 * The plain step a column PART-WAY THROUGH it belongs to, and where in the bar that column
 * is (#2293): what `splitStep` takes when a click lands on a step's faint snap half. The
 * step is found by the same row rule as `stepAddressAt`; a column that begins a step, or one
 * inside a step that holds others (a group the lane does not draw open), names none.
 */
export function splitAddressAt(
  model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps' | 'lanes'>,
  trees: readonly BarTree[],
  lane: number,
  col: number,
): { address: StepAddress; at: Frac } | null {
  const bars = model.bars ?? 1
  if (trees.length !== bars) return null
  const l = model.lanes[lane]
  if (!l) return null
  for (let b = 0; b < bars; b++) {
    const { start, per } = barColumns(model, b)
    if (col < start || col >= start + per) continue
    const d = laneRowForEdit(trees[b], l)
    if (!d.ok) return null
    const at = frac(col - start, per)
    const visit = (row: DivisionRow): { address: StepAddress; at: Frac } | null => {
      for (const s of row.steps) {
        const inner = s.rows ? innerRow(s, l.sound) : null
        if (inner) {
          const got = visit(inner)
          if (got) return got
          continue
        }
        if (!s.span || s.rows) continue
        for (const slot of s.slots) {
          if (slot.fromBefore || slot.pastEnd) continue
          if (cmp(slot.begin, at) < 0 && cmp(at, slot.end) < 0) return { address: { bar: b, span: s.span, at: slot.begin }, at }
        }
      }
      return null
    }
    return visit(d.row)
  }
  return null
}

/**
 * The cursor's stops in one row (#2293): where each of the row's own steps begins, at
 * every depth — a group's steps in place of the group, open or not. Arrow keys walk these,
 * so the cursor moves step to step, into a group and out of it, and never onto a column in
 * the middle of a step (a snap half is where a click splits a step, not a step).
 */
export function leafStops(nodes: readonly StepNode[]): number[] {
  const out: number[] = []
  const walk = (n: StepNode): void => {
    if (n.children) n.children.forEach(walk)
    else out.push(n.from)
  }
  nodes.forEach(walk)
  return out
}

/**
 * A step group's stops: a step holding small boxes stops on each; a PLAIN step (one note or
 * rest through several columns) only where it begins — its faint snap halves are places a
 * click splits it, not steps the cursor walks.
 */
export function groupStops(g: StepGroup): number[] {
  return g.plain ? [g.from] : g.boxes.map((b) => b.start)
}

/** every open step's first column and its depth: where the lines go, and how light */
export function openStarts(drawn: readonly DrawnNode[], out = new Map<number, number>()): Map<number, number> {
  for (const n of drawn) {
    if (!out.has(n.from) || out.get(n.from)! > n.depth) out.set(n.from, n.depth)
    if (n.open && n.children) openStarts(n.children, out)
  }
  return out
}

/** a node as drawn at a zoom: open when each step inside it is at least `OPEN_PX` wide */
export interface DrawnNode extends StepNode {
  open: boolean
  children: DrawnNode[] | null
}

/** which nodes are open, given each drawn column's width on screen */
export function openAt(nodes: readonly StepNode[], colPx: (c: number) => number, openPx = OPEN_PX): DrawnNode[] {
  const px = (n: StepNode): number => {
    let w = 0
    for (let c = n.from; c < n.to; c++) w += colPx(c)
    return w
  }
  const at = (n: StepNode): DrawnNode => {
    const open = !!n.children && n.children.every((k) => px(k) >= openPx - 1e-6)
    return { ...n, open, children: n.children && open ? n.children.map(at) : null }
  }
  return nodes.map(at)
}

/**
 * The ruler for a row at a zoom: each open step's first column, named by its place in the
 * pattern — `1`, `1.2`, then `1.2.2` once step 1.2 is open. A column takes the shallowest
 * name that starts there (`1.2.1` is `1.2`).
 */
export function zoomRuler(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps'>, drawn: readonly DrawnNode[]): Map<number, string> {
  const out = new Map<number, string>()
  const bars = model.bars ?? 1
  const name = (nodes: readonly DrawnNode[], prefix: string): void => {
    nodes.forEach((n, i) => {
      const label = `${prefix}.${i + 1}`
      if (!out.has(n.from)) out.set(n.from, label)
      if (n.open && n.children) name(n.children, label)
    })
  }
  for (let b = 0; b < bars; b++) {
    const { start, per } = barColumns(model, b)
    const inBar = drawn.filter((n) => n.from >= start && n.from < start + per)
    out.set(start, String(b + 1))
    inBar.forEach((n, i) => {
      if (i > 0) out.set(n.from, `${b + 1}.${i + 1}`)
      if (n.open && n.children) name(n.children, i === 0 ? `${b + 1}.1` : `${b + 1}.${i + 1}`)
    })
  }
  return out
}

/** what a row draws: an open step holds steps, every other step holds its boxes as today */
export type DrawnStep =
  | { kind: 'open'; from: number; to: number; depth: number; children: DrawnStep[] }
  | { kind: 'boxes'; group: StepGroup; depth: number }

/**
 * A row's drawing at a zoom, from its open nodes and the boxes it already draws
 * (`rowBoxes`) — or null when a box crosses a step's edge, and the row draws as today.
 *
 * A step that is not open is today's step group: one box, a step holding small boxes, or
 * a plain step (one note through several columns). A plain step's columns show as faint
 * halves only once they are `OPEN_PX` wide — the snap halves open with their level; until
 * then the step is one box, and a click on it is the click on its first column.
 */
export function drawnSteps(
  drawn: readonly DrawnNode[],
  boxes: readonly { start: number; width: number }[],
  steps: number,
  owners: readonly ((col: number) => number | undefined)[],
  colPx: (c: number) => number,
  openPx = OPEN_PX,
): DrawnStep[] | null {
  let k = 0
  const walk = (n: DrawnNode): DrawnStep | null => {
    if (n.open && n.children) {
      const children: DrawnStep[] = []
      for (const c of n.children) {
        const d = walk(c)
        if (!d) return null
        children.push(d)
      }
      return { kind: 'open', from: n.from, to: n.to, depth: n.depth, children }
    }
    const mine: { start: number; width: number }[] = []
    while (k < boxes.length && boxes[k].start < n.to) {
      if (boxes[k].start < n.from || boxes[k].start + boxes[k].width > n.to) return null
      mine.push(boxes[k++])
    }
    if (mine.length === 0 || mine[0].start !== n.from || mine[mine.length - 1].start + mine[mine.length - 1].width !== n.to) return null
    const [group] = groupBoxesBySteps(mine, [n.from, n.to], steps, owners).filter((g) => g.from === n.from)
    if (!group || group.to !== n.to) return null
    let narrow = false
    for (let c = n.from; c < n.to; c++) if (colPx(c) < openPx - 1e-6) narrow = true
    if (group.plain && group.boxes.length > 1 && narrow) {
      return { kind: 'boxes', depth: n.depth, group: { ...group, boxes: [{ start: n.from, width: n.to - n.from }] } }
    }
    return { kind: 'boxes', group, depth: n.depth }
  }
  const out: DrawnStep[] = []
  for (const n of drawn) {
    const d = walk(n)
    if (!d) return null
    out.push(d)
  }
  return k === boxes.length ? out : null
}
