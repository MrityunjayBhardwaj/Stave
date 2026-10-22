/**
 * writtenSteps — where each step AS WRITTEN begins, in the columns a panel draws (#1841).
 *
 * `bd [~ bd] sd ~` is eight columns and four written steps. The grids drew every column
 * edge alike, so the four steps the text writes were invisible. This module adds no
 * reading of the pattern of its own: it re-expresses what the parser already recorded for
 * the writers — one region per top-level element, with the columns it owns
 * (`SourcePart.regions`, `AltSource.regions`) — in DRAWN columns, so a panel can draw a
 * line at each written step and a ruler that counts them. Pattern-grid epic #1832 is
 * visuals only: when the model says `hh*8` is one written step, it is drawn as one.
 *
 * Three spaces meet here, converted in one place each:
 *   part column  → shared column   `× part.factor` (`SourcePart.factor`, how the writers
 *                                  stretch a part onto the shared grid)
 *   bar column   → shared column   `b × perBar + from` (`AltSource`: single-cycle columns)
 *   shared       → drawn           `drawnAt` when the grid is drawn per bar (`perBar.ts`)
 *
 * A region set that no longer tiles the model (a Slots change moved the width out from
 * under it) is skipped, not guessed: that part draws bar and column lines only. It is the
 * same covers-check the writers use before they trust these spans. A leaf-read model
 * carries no written-step regions at all, and gets the same bar-and-column answer.
 */
import * as React from 'react'
import type { AltSource, NotationSource } from '../../codeView'
import { drawnAt, drawnLayout, lcmOf } from '../../codeView'
import { bracketedBarRegions } from '../../codeView'

/** the fields both grid and roll models share that this module reads */
export interface WrittenStepsModel {
  steps: number
  bars?: number
  barSteps?: readonly number[]
  source?: NotationSource<unknown>
  altSource?: AltSource<unknown>
}

/** the columns the writers' regions were captured in */
function sharedSteps(m: WrittenStepsModel): number {
  return m.barSteps ? m.barSteps.length * lcmOf(m.barSteps) : m.steps
}

/** shared column → drawn column, or null when it falls inside a drawn column */
function toDrawn(u: number, m: WrittenStepsModel): number | null {
  const d = m.barSteps ? drawnAt(u, m.barSteps) : u
  return Number.isInteger(d) ? d : null
}

/**
 * Where the steps of ONE written element begin, in the region's own column space.
 *
 * Strudel counts an element as its weight in steps — `bd@3` 3, `hh!6` 6, while `hh*8`,
 * `bd(3,8)` and `[a b]` are 1 (#1845). The region carries that weight from the parser
 * (`ElementSpan.weight`, the number that sized it as `weight × div` columns), so the
 * steps fall every `(to − from) / weight` columns. A region with no weight, or whose
 * columns the weight does not divide, stays one step.
 */
function regionStepStarts(r: { from: number; to: number; weight?: number }): number[] {
  const w = r.weight ?? 1
  const span = r.to - r.from
  if (!Number.isInteger(w) || w <= 1 || span % w !== 0) return [r.from]
  return Array.from({ length: w }, (_, k) => r.from + (k * span) / w)
}

/**
 * The steps of a WHOLE BAR written as one `[…]` element (#1855): `<[bd ~ bd ~] [bd ~ ~ bd]>`
 * spells each bar as one bracketed element, because an entry of `<…>` is one bar. Strudel
 * counts that element as one step, but it IS the bar, and the bar is cut the way its
 * content is: `[~ sd ~ sd]` is `~ sd ~ sd` spelled so it fits in `<…>`, and the editor's
 * own bar-by-bar writes produce exactly that spelling (#1849). So the bar draws the steps
 * of its content — `bracketedBarRegions` asks krill whether the region is one bracketed
 * sequence and the parser what its content is (#1942), never re-derived here. A content
 * the parser does not read as one flat part, or whose steps do not land on the region's
 * columns, stays one step.
 */
function wholeBarStepStarts(r: { raw: string; from: number; to: number }): number[] | null {
  const regions = bracketedBarRegions(r.raw)
  if (!regions) return null
  const cols = regions[regions.length - 1]?.to
  if (!cols) return null
  const starts = regions.flatMap(regionStepStarts).map((c) => r.from + (c * (r.to - r.from)) / cols)
  return starts.every(Number.isInteger) ? starts : null
}

/**
 * Drawn columns where a written step begins, per `,`-part index (`StepLane.part`).
 * Sorted, deduplicated, and including column 0. A part the model has no current
 * regions for is absent from the map.
 */
export function writtenStepStarts(m: WrittenStepsModel): Map<number, number[]> {
  const out = new Map<number, number[]>()
  const shared = sharedSteps(m)
  const put = (part: number, us: number[]): void => {
    const cols = new Set<number>()
    for (const u of us) {
      const d = toDrawn(u, m)
      if (d !== null) cols.add(d)
    }
    out.set(part, [...cols].sort((a, b) => a - b))
  }
  if (m.source) {
    for (const p of m.source.parts) {
      const last = p.regions[p.regions.length - 1]
      // a part written over fewer bars than the stack repeats them (#1849): its regions
      // tile one window, and the window recurs `repeats` times across the model
      const repeats = p.bars === undefined ? 1 : (m.bars ?? 1) / p.bars
      if (!last || !Number.isInteger(repeats) || last.to * p.factor * repeats !== shared) continue // stale
      const span = last.to * p.factor
      // a region that is one whole bar of the grid draws its bar's own steps (#1855)
      const bar = (m.bars ?? 1) > 1 ? shared / (m.bars ?? 1) : null
      const once = p.regions
        .flatMap((r) =>
          bar !== null && (r.to - r.from) * p.factor === bar
            ? (wholeBarStepStarts(r) ?? regionStepStarts(r))
            : regionStepStarts(r),
        )
        .map((c) => c * p.factor)
      put(
        p.part,
        Array.from({ length: repeats }, (_, k) => once.map((c) => c + k * span)).flat(),
      )
    }
    return out
  }
  const a = m.altSource
  if (a && a.perBar * a.bars === shared) {
    const us: number[] = []
    for (let b = 0; b < a.bars; b++) for (const r of a.regions) us.push(b * a.perBar + r.from)
    put(0, us) // an alternation-as-element pattern has no `,`-parts
  }
  return out
}

/**
 * Exact mode (#1855): how many drawn columns ONE OF A PART'S OWN STEPS spans, per `,`-part.
 *
 * `~ sd ~ sd, hh*8` shares 8 columns, and the snare's own step is 2 of them — its
 * `SourcePart.factor`, the stretch the writers already use. Exact draws that part as 4 boxes,
 * each 2 columns wide; a click fills one whole box. Only parts stretched by more than 1 are
 * listed, and only when their regions still tile the model (the same stale check as
 * `writtenStepStarts`) — anything else is drawn one box per column, as LCM draws it.
 *
 * A model drawn per bar (`barSteps`, #1827) lists nothing: its drawn columns are already
 * each bar's own, and its one part has factor 1 (measured: `<[a b c] [a b c d]>`); a stack
 * with differing bar counts is read leaf by leaf and carries no parts at all.
 */
export function ownStepWidths(m: WrittenStepsModel): Map<number, number> {
  const out = new Map<number, number>()
  if (!m.source || m.barSteps) return out
  for (const p of m.source.parts) {
    const last = p.regions[p.regions.length - 1]
    const repeats = p.bars === undefined ? 1 : (m.bars ?? 1) / p.bars
    if (!last || !Number.isInteger(repeats) || last.to * p.factor * repeats !== m.steps) continue // stale
    if (p.factor > 1 && Number.isInteger(p.factor) && m.steps % p.factor === 0) out.set(p.part, p.factor)
  }
  return out
}

/**
 * The boxes one row is drawn as: `[start, start + width)` in drawn columns. A row whose part
 * has an own step of `width` columns is cut into boxes of that width — unless one of its hits
 * starts inside a box, which that picture cannot show, and then it keeps a box per column.
 */
export function rowBoxes<C>(
  cells: readonly C[],
  steps: number,
  width: number | undefined,
  isOn: (cell: C) => boolean,
): { start: number; width: number }[] {
  const w = width !== undefined && width > 1 && steps % width === 0 && cells.every((c, i) => i % width === 0 || !isOn(c)) ? width : 1
  return Array.from({ length: steps / w }, (_, k) => ({ start: k * w, width: w }))
}

/**
 * Does the grid ON SCREEN take a new hit anywhere (#1070, #1858)? Asked of the boxes it
 * draws, through the same per-box answers its cells use (`placeable[lane][box start]`), so
 * the "add it in the code view" line can never speak about cells Exact does not draw. With a
 * box per column this asks exactly what `viewPlacesNotes` asks. No empty box → `true`: a full
 * grid has nothing to refuse.
 */
export function boxesPlaceNotes<C>(
  lanes: readonly { cells: readonly C[] }[],
  boxes: readonly (readonly { start: number }[])[],
  isOn: (cell: C) => boolean,
  placeable: readonly (readonly boolean[])[],
): boolean {
  let asked = 0
  for (let li = 0; li < lanes.length; li++)
    for (const b of boxes[li] ?? []) {
      if (isOn(lanes[li].cells[b.start])) continue
      asked++
      if (placeable[li]?.[b.start]) return true
    }
  return asked === 0
}

/** One written step of a row, as the boxes it is drawn over (#1861). */
export interface StepGroup {
  /** `[from, to)` in drawn columns */
  from: number
  to: number
  boxes: { start: number; width: number }[]
  /**
   * In every row of the part, one thing sounds through the whole step or nothing does: `bd`
   * in `bd hh*2 sd cp`, a `~`. Drawn as one box with faint halves. Otherwise the step holds
   * several hits or rests (`[~ bd]`, `hh*8`, `bd(3,8)`) and is drawn as one step with its
   * boxes inside it — in every row of the part, as the text writes it for all of them.
   */
  plain: boolean
}

/**
 * A row's boxes grouped by the written steps they fall in (#1861, Exact). `starts` are the
 * part's `writtenStepStarts` (drawn columns); `owners` holds, for EVERY row of the part, the
 * note sounding at a column (its start column, from the grid's own coverage) or undefined for
 * silence. Whether a step is plain is read off the content, never the text: a written step is
 * plain when, in each row of the part, all its columns have the same owner — so a row silent
 * inside a `[…]` step still draws that step as subdivided, as its siblings do.
 *
 * Without starts, or when a box would straddle a step edge (the regions and boxes disagree),
 * every box is its own step — today's drawing.
 */
export function groupBoxesBySteps(
  boxes: readonly { start: number; width: number }[],
  starts: readonly number[] | undefined,
  steps: number,
  owners: readonly ((col: number) => number | undefined)[],
): StepGroup[] {
  const alone = (): StepGroup[] => boxes.map((b) => ({ from: b.start, to: b.start + b.width, boxes: [b], plain: true }))
  if (!starts || starts.length === 0) return alone()
  const edges = [...new Set([...starts, steps])].filter((c) => c >= 0 && c <= steps).sort((a, b) => a - b)
  if (edges[0] !== 0) edges.unshift(0)
  const out: StepGroup[] = []
  let k = 0
  for (let i = 0; i + 1 < edges.length; i++) {
    const [from, to] = [edges[i], edges[i + 1]]
    const inStep: { start: number; width: number }[] = []
    while (k < boxes.length && boxes[k].start < to) {
      if (boxes[k].start < from || boxes[k].start + boxes[k].width > to) return alone()
      inStep.push(boxes[k++])
    }
    if (inStep.length === 0) continue
    let plain = true
    for (const owner of owners) {
      const first = owner(from)
      for (let c = from + 1; c < to && plain; c++) plain = owner(c) === first
    }
    out.push({ from, to, boxes: inStep, plain })
  }
  return k === boxes.length ? out : alone()
}

/**
 * The lengths a note moves to one box longer and one box shorter, in columns, on a row whose
 * boxes are `w` columns wide (#1855) — what the length handle offers and ⌥⇧←/→ writes. On a
 * box per column this is ±1; on a row at a part's own steps it is ± one own step, landing on
 * a whole number of them, since a half step is a length that row cannot draw. `shorter` is
 * null below one box.
 */
export function boxLengths(duration: number, w: number): { longer: number; shorter: number | null } {
  const d = Math.round(duration)
  const down = Math.ceil(d / w) - 1
  return { longer: (Math.floor(d / w) + 1) * w, shorter: down >= 1 ? down * w : null }
}

/**
 * The model whose `source` the step lines are drawn from: the text's own reading when it
 * lays out the same columns as the model on screen, else the model on screen (#1849).
 * After a write the kept model's source still describes the text it was parsed from.
 */
export function linesModel<M extends { steps: number; bars?: number; barSteps?: readonly number[] }>(
  shown: M,
  read: M | null,
): M {
  if (!read || read.steps !== shown.steps || (read.bars ?? 1) !== (shown.bars ?? 1)) return shown
  return (read.barSteps ?? []).join() === (shown.barSteps ?? []).join() ? read : shown
}

/**
 * Where each bar begins in drawn columns, with `cols` as a final entry — asked of
 * `drawnLayout`, the answer the panels already draw their bar gaps from, so the ruler's
 * bar numbers cannot sit anywhere the bar lines do not.
 */
export function drawnBarStarts(m: WrittenStepsModel, cols: number): number[] {
  const layout = drawnLayout(m, cols)
  const out = [0]
  for (let c = 1; c < cols; c++) if (layout.barStart(c)) out.push(c)
  out.push(cols)
  return out
}

/**
 * The ruler's labels: `1`, `1.2`, `1.3`, … `2`, counting written steps within each bar.
 * A bar always gets its number at its first column, even when no written step begins
 * there (a step written across the bar line); `starts` null or empty → bar numbers only.
 */
export function rulerLabels(
  m: WrittenStepsModel,
  cols: number,
  starts: readonly number[] | undefined,
): Map<number, string> {
  const bars = drawnBarStarts(m, cols)
  const labels = new Map<number, string>()
  for (let b = 0; b + 1 < bars.length; b++) {
    const from = bars[b]
    const to = bars[b + 1]
    labels.set(from, String(b + 1))
    let k = 1
    for (const c of starts ?? []) {
      if (c <= from || c >= to) continue
      k++
      labels.set(c, `${b + 1}.${k}`)
    }
  }
  return labels
}

/**
 * The space a shown ruler label keeps clear of its neighbours, in px. At 1440px wide, 32
 * steps leave 3.8px between `1.10` and `1.11`, which reads cleanly; at 1024px they overlap
 * by 2.4px (#1843).
 */
const LABEL_GAP = 3

/**
 * Which ruler labels fit (#1843): given each label's drawn box, in order, the ones to show.
 *
 * Every label is drawn at its column's left edge and is wider than a narrow column, so
 * past a point `1.10`, `1.11` … run together. The rule is a DAW ruler's as it zooms out:
 * bar numbers first, then a step label only where it clears the label shown before it
 * AND the next bar number. Nothing moves; a hidden label's step line is still drawn.
 */
export function fitLabels(boxes: readonly { left: number; right: number; bar: boolean }[]): boolean[] {
  const show = boxes.map(() => false)
  // bar numbers, left to right, each clear of the last bar number shown
  let lastBarRight = -Infinity
  boxes.forEach((b, i) => {
    if (b.bar && (lastBarRight === -Infinity || b.left >= lastBarRight + LABEL_GAP)) {
      show[i] = true
      lastBarRight = b.right
    }
  })
  // step labels, each clear of the label shown before it and of the next bar number shown
  let prevRight = -Infinity
  boxes.forEach((b, i) => {
    if (b.bar) {
      if (show[i]) prevRight = b.right
      return
    }
    let nextBar = Infinity
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].bar && show[j]) {
        nextBar = boxes[j].left
        break
      }
    }
    if (b.left >= prevRight + LABEL_GAP && b.right + LABEL_GAP <= nextBar) {
      show[i] = true
      prevRight = b.right
    }
  })
  return show
}

/**
 * Hide the ruler labels that would collide (#1843), measured where they are drawn: on
 * every render and whenever the ruler's width changes (`ExtendHandle`'s measure pattern).
 * Labels are found by `labelAttr`; a bar number carries `data-ruler-bar`. Hiding uses
 * `visibility`, so every label keeps its box and the next measurement is unchanged.
 */
export function useRulerFit(rulerRef: React.RefObject<HTMLElement | null>, labelAttr: string): void {
  const fit = React.useCallback(() => {
    const root = rulerRef.current
    if (!root) return
    const els = [...root.querySelectorAll<HTMLElement>(`[${labelAttr}]`)]
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, bar: e.hasAttribute('data-ruler-bar') }
    })
    const show = fitLabels(boxes)
    els.forEach((e, i) => {
      e.style.visibility = show[i] ? '' : 'hidden'
    })
  }, [rulerRef, labelAttr])
  useLayoutFollow(rulerRef, fit)
}

/**
 * Run `run` after every render AND whenever `ref`'s element changes size.
 *
 * The observer follows the ELEMENT, attached from the every-render layout effect: a
 * grid renders before its pattern has loaded, with no ruler yet, so an effect that
 * looked once would find nothing and never look again (the ruler's resize bug). The
 * size arm is what a closed drawer needs: a grid can mount and read its pattern with
 * no height at all, and opening the drawer resizes it without a render (#1850).
 * `run` is called through a ref, so it always sees the latest render's values.
 */
export function useLayoutFollow(ref: React.RefObject<HTMLElement | null>, run: () => void): void {
  const runRef = React.useRef(run)
  runRef.current = run
  const observed = React.useRef<{ el: HTMLElement; ro: ResizeObserver } | null>(null)
  React.useLayoutEffect(() => {
    runRef.current()
    const el = ref.current
    if (observed.current?.el === el) return
    observed.current?.ro.disconnect()
    observed.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => runRef.current())
    ro.observe(el)
    observed.current = { el, ro }
  })
  React.useEffect(() => () => observed.current?.ro.disconnect(), [])
}
