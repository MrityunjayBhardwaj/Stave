/**
 * gridZoom.ts — a grid row as the pattern's own steps, nested, and which of them are open
 * at a zoom (#2277, #2276, part of #1834, epic #1832).
 *
 * The bar's tree comes from codeView (`chunkDivisions` / `laneDivisions`, asked of
 * Strudel). This file lays it on the grid's DRAWN columns, the columns every cell, click
 * and write already uses, so nothing here changes what a click edits: a node is only a
 * run of columns and how deep in the pattern it sits.
 *
 *   `bd [~ bd] sd ~` (8 columns)  →  bd [0,2) · [ ~ [2,3) · bd [3,4) ] · sd [4,6) · ~ [6,8)
 *
 * ZOOM OPENS A LEVEL. Once zoomed in, a step that holds smaller steps opens when each of
 * them is at least `OPEN_PX` wide on screen (the grid's own click floor, 16 px a column);
 * until then it is drawn as one step with its columns as small boxes inside it, which is
 * how every such step is drawn at 1× (the grid asks `openAt` with no width that opens).
 *
 * A row gets nodes only when they hold exactly: every bar has a tree for the row, every
 * slot lands on a whole column, and the row's notes start where its cells do (the same
 * check the corpus test pins). Otherwise `null`, and the row draws as it does today.
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

const num = (x: Frac): number => x.n / x.d

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

/**
 * The row's steps in bar columns. `col` maps a bar fraction to a drawn column, or null
 * when it does not land on one. Throws `OFF_GRID` when a slot does not.
 */
const OFF_GRID = new Error('off-grid')

function nodesOf(row: DivisionRow, within: { b: number; e: number }, depth: number, sound: string, col: (f: number) => number): StepNode[] {
  const out: StepNode[] = []
  for (const s of row.steps) {
    for (const slot of s.slots) {
      const b = Math.max(num(slot.begin), 0)
      const e = Math.min(num(slot.end), 1)
      if (b < within.b - 1e-9 || b >= within.e - 1e-9) continue
      // `bd!3` is written once and is three steps, and so is `bd@3` (#1845, #1846): each an
      // equal share of the slot. krill folds `!n` into the weight (`bd!3` weighs 3), so a note
      // is cut by its weight; a group by its `!` alone — under `@` what it holds spans it.
      const parts = s.rows === null ? (Number.isInteger(s.weight) && s.weight > 1 ? s.weight : 1) : s.reps
      const n = slot.fromBefore || slot.pastEnd ? 1 : parts
      for (let k = 0; k < n; k++) out.push(stepNode(s, b + ((e - b) * k) / n, b + ((e - b) * (k + 1)) / n, depth, sound, col))
    }
  }
  return out.sort((x, y) => x.from - y.from)
}

function stepNode(s: DivisionStep, b: number, e: number, depth: number, sound: string, col: (f: number) => number): StepNode {
  const node: StepNode = { from: col(b), to: col(e), depth, children: null }
  const inner = innerRow(s, sound)
  if (!inner) return node
  if (s.copies) {
    // a group its own op repeats (`[~ hh]*4`): the copies are a level of their own
    const copies = s.copies
      .filter((c) => num(c.begin) >= b - 1e-9 && num(c.begin) < e - 1e-9)
      .map((c): StepNode => {
        const cb = Math.max(num(c.begin), 0)
        const ce = Math.min(num(c.end), 1)
        return { from: col(cb), to: col(ce), depth: depth + 1, children: nodesOf(inner, { b: cb, e: ce }, depth + 2, sound, col) }
      })
    node.children = copies.length > 1 ? copies : copies.length === 1 ? copies[0].children!.map((n) => lift(n)) : null
    return node
  }
  node.children = nodesOf(inner, { b, e }, depth + 1, sound, col)
  return node
}

/** one copy alone is not a level: its steps move up one */
function lift(n: StepNode): StepNode {
  return { ...n, depth: n.depth - 1, children: n.children ? n.children.map(lift) : null }
}

/** does every node tile its parent edge to edge, with at least two inside? */
function tiles(nodes: StepNode[], from: number, to: number): boolean {
  let at = from
  for (const n of nodes) {
    if (n.from !== at || n.to <= n.from) return false
    // a level of one step is not a level: what it holds moves up (`<bd [bd bd]>` in the
    // bar that plays `[bd bd]` is the two steps, not a step holding one)
    while (n.children && n.children.length === 1) {
      const only = n.children[0]
      if (only.from !== n.from || only.to !== n.to) return false
      n.children = only.children ? only.children.map(lift) : null
    }
    if (n.children && !tiles(n.children, n.from, n.to)) return false
    at = n.to
  }
  return at === to
}

/** where the row's notes named `sound` start, in drawn columns, by the tree */
function treeStarts(row: DivisionRow, sound: string, col: (f: number) => number, out: Set<number>): void {
  for (const s of row.steps) {
    if (s.name === sound) for (const h of s.hits) if (num(h.begin) >= 0 && num(h.begin) < 1) out.add(col(num(h.begin)))
    for (const r of s.rows ?? []) treeStarts(r, sound, col, out)
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

/** `laneSteps`, saying why when there are none */
export function laneStepsOrWhy(model: Pick<StepGridModel, 'steps' | 'bars' | 'barSteps' | 'lanes'>, trees: readonly BarTree[], lane: number): StepNode[] | LaneStepsRefusal {
  const bars = model.bars ?? 1
  if (trees.length !== bars) return 'bar-count'
  const l = model.lanes[lane]
  const out: StepNode[] = []
  try {
    for (let b = 0; b < bars; b++) {
      const d = laneDivisions(trees[b], l)
      if (!d.ok) return d.why
      const { start, per } = barColumns(model, b)
      const col = (f: number): number => {
        const c = f * per
        const r = Math.round(c)
        if (Math.abs(c - r) > 1e-6) throw OFF_GRID
        return start + r
      }
      let nodes = nodesOf(d.row, { b: 0, e: 1 }, 1, l.sound, col)
      if (!tiles(nodes, start, start + per)) return 'does-not-tile'
      // a bar that is one step (`<a [b c]>`'s second bar) is cut by that step: its split is the pulse
      while (nodes.length === 1 && nodes[0].children) nodes = nodes[0].children.map(lift)
      // the row's notes start where its cells do, or the tree is not this grid's
      const starts = new Set<number>()
      treeStarts(d.row, l.sound, col, starts)
      for (let c = start; c < start + per; c++) {
        if (!!l.cells[c] !== starts.has(c)) return 'cells-differ'
      }
      out.push(...nodes)
    }
  } catch (e) {
    if (e === OFF_GRID) return 'off-grid'
    throw e
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
  try {
    for (let b = 0; b < bars; b++) {
      const t = trees[b]
      if (!t.ok) return t.why
      const row = t.parts[part]
      if (!row) return 'lane-part-missing'
      const { start, per } = barColumns(model, b)
      const col = (f: number): number => {
        const c = f * per
        const r = Math.round(c)
        if (Math.abs(c - r) > 1e-6) throw OFF_GRID
        return start + r
      }
      let nodes = nodesOf(row, { b: 0, e: 1 }, 1, '', col)
      if (!tiles(nodes, start, start + per)) return 'does-not-tile'
      while (nodes.length === 1 && nodes[0].children) nodes = nodes[0].children.map(lift)
      // every note starts on a column, or the roll's columns are not this tree's
      const every = (r: DivisionRow): void => {
        for (const s of r.steps) {
          for (const h of s.hits) if (num(h.begin) >= 0 && num(h.begin) < 1) col(num(h.begin))
          for (const k of s.rows ?? []) every(k)
        }
      }
      every(row)
      out.push(...nodes)
    }
  } catch (e) {
    if (e === OFF_GRID) return 'off-grid'
    throw e
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
          if (Math.abs(num(slot.begin) * per - want) < 1e-9) return { bar: b, span: s.span, at: slot.begin }
        }
        // a hit that begins part-way through its step was made by the step's own op
        // (`hh*4`'s second hat): that is the reason to give, not "inside a step"
        if (s.hits.some((h) => Math.abs(num(h.begin) * per - want) < 1e-9)) {
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
