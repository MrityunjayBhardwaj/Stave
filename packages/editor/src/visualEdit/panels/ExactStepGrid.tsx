/**
 * ExactStepGrid — the step grid in Exact: drawn and edited from the bar's tree, no equal columns
 * (#2458, #2295, epic #1832).
 *
 * `exactGrid.ts` says what each row's cells are, at exact shares of the bar; `treeGrid.ts` says
 * where the steps, lines and ruler go. This renders them and turns gestures into step edits. A
 * position `t` (cycles from the pattern's start) is `x(t)` pixels: one multiplication, and the
 * bar gaps. LCM keeps the column grid (`SequencerGrid.tsx`).
 *
 * What a gesture can edit is the step writer's alone: every cell asks `cellEdit`, and a cell the
 * writer refuses is inert and says why. A click on a place part-way through a plain step splits
 * it. A paint drag walks steps and passes over those places.
 *
 * Velocity (#2468): a lit cell's fill is as tall as the level its hit plays at, and a vertical
 * drag on it writes that hit's own level of the chain's `.gain("…")` (`stepGainEdit`) — a new
 * `.gain` mirrors the steps when there is none. A click that would add a hit under a gain `~`
 * is refused (#2467): the hit would play nothing.
 */
import * as React from 'react'

import { chordLanes, commit, fmtLevel, gainLevelsAt, gridWriteEdits, lookOnlyLine, opensStepGrid, readChunkGain, resizeStep, resizeStepBy, sampleVoice, stepGainEdit, stepGainWriteEdits, stepNoteKey, stepNotes, type ChunkInfo, type Frac, type ParseResult, type StepEdit, type StepEditResult, type StepGainRefusal, type ViewScale } from '../../codeView'
import { emitLog } from '../../engine/engineLog'
import { readCurrentCycle } from '../../workspace/currentCycle'
import { ExtendHandle } from './ExtendHandle'
import { cellAt, cellEdit, cellEnd, drawnCells, exactGridFrom, playsNumbers, removeRowText, type ExactCell, type ExactRow, type KeptRow } from './exactGrid'
import { OPEN_PX, stepAddressAtPlace } from './gridZoom'
import { GridZoomControl, useGridZoom } from './gridZoomControl'
import { GRID_SCOPE, isCursorMove, isNoteEdit, matchGridKey, mountGridGestures, moveStepCursor, stopAt, type GridAction } from './gridGestures'
import { InViewBar, PHONE_RULER_HEIGHT, PHONE_STEP_MIN, TurnHint, usePhoneGrid, useRulerPan } from './phoneGrid'
import { useNoteColorMode, velocityColor } from './noteColor'
import { PatternTrackChip } from './PatternTrackChip'
import { lookOnlyTreeRoll } from './rollTree'
import { DRUM_SOUNDS } from './soundCatalog'
import { SEQUENCER_TAB_ID } from './tabs'
import { TreeRollGrid } from './TreeRollGrid'
import { drawTreeRow, probeTrees, treePlayhead, treeRuler } from './treeGrid'
import { useActiveChunk } from './useActiveChunk'
import { useDeferredPerText } from './useDeferredPerText'
import { stepWriteEdits } from './useGridModel'
import { usePatternLength } from './usePatternLength'
import { VisualEditStandby } from './VisualEditStandby'

/**
 * Is this call a `.struct` whose rhythm a cursor can open (#2120)? Only the forms the lookup
 * takes: a string, or a `pick` list of strings.
 */
function opensRhythmLine(call: { name: string; args: { raw: string }[] }): boolean {
  const raw = call.args[0]?.raw ?? ''
  return call.name === 'struct' && (/^["'`]/.test(raw) || /\.pick\w*\(\s*\[\s*["'`]/.test(raw))
}

/** the gap between bars, as the column grid draws it */
const BAR_GAP = 8
/** the row names' column: the label, and the remove button */
const NAME_PX = 96
const ROW_PX = 22
const RESIZE_ZONE_PX = 8
/** px of movement before a press on a note becomes a drag (not a click) */
const DRAG_THRESHOLD = 4
/** px of vertical drag that spans the full 0→1 velocity range, as the column grid's */
const VELOCITY_FULL_PX = 80
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const STEP_REFUSALS: Record<string, string> = {
  'inside-a-step': 'This place is part of a longer step — click where the step begins, or change it in the code view.',
  'step-is-generated': 'This hit is made by an operator on its step (like *4 or (3,8)) — change it in the code view.',
  'step-is-replicated': 'This step is written once and repeated with ! — change it in the code view.',
  'step-is-a-random-choice': 'This step plays by chance (? or |) — change it in the code view.',
  'step-under-a-generator': 'This step plays by chance (? or |) — change it in the code view.',
  'loop-shorter-than-the-pattern': "This step also plays in bars the grid doesn't show — change it in the code view.",
  'step-crosses-a-bar': 'This note runs over a bar line — switch it where it starts, or change it in the code view.',
  'step-has-no-text': "This note isn't one plain name in the code, so the grid can't change it — change it in the code view.",
  'under-a-gain-rest': 'The .gain has a rest (~) here, so a hit here would play nothing — change the .gain in the code view.',
}

/** why a velocity drag on a hit writes nothing */
const VELOCITY_REFUSALS: Partial<Record<StepGainRefusal, string>> = {
  'gain-not-ours': "this pattern's .gain isn't a plain number or string, so the grid leaves it as written",
  'hit-is-silent': 'the .gain has a rest (~) on this hit, so it plays nothing',
  'gain-step-not-the-hit': "the .gain's level on this hit also covers other places, so changing it would change them too",
  'no-gain-for-this-pattern': 'a new .gain could not follow this pattern’s steps (parts side by side, a random choice, or {…})',
  'step-is-a-random-choice': "the .gain's level on this hit is chosen by chance",
  'step-under-a-generator': "the .gain's level on this hit sits under an op the grid can't write through",
  'loop-shorter-than-the-pattern': "the .gain plays past the bars the grid shows",
}
const velocityLine = (why: StepGainRefusal): string => `${VELOCITY_REFUSALS[why] ?? "the grid can't find this hit's own level in the .gain"} — change it in the code view.`


function refusalLine(why: string, on: boolean): string {
  if (why === 'step-is-a-group') {
    return on
      ? 'This hit sits in a group the grid cannot take it out of — change it in the code view.'
      : "This step holds a group the grid can't add a sound to — change it in the code view."
  }
  return STEP_REFUSALS[why] ?? "The grid can't find this step's own text to change — change it in the code view."
}

function report(attempted: string, why?: string): void {
  emitLog({
    level: 'warn',
    runtime: 'stave',
    message: why
      ? `${attempted} — ${why.charAt(0).toLowerCase()}${why.slice(1)}`
      : `${attempted} — writing it would change the pattern in ways you didn't ask for, so it was left unchanged.`,
  })
}

/** a step's outline, lighter the deeper it sits */
function outline(depth: number): string {
  if (depth <= 1) return '1px solid var(--border, #3a3a42)'
  if (depth === 2) return '1px solid color-mix(in srgb, var(--border, #3a3a42) 60%, transparent)'
  return '1px dashed color-mix(in srgb, var(--border, #3a3a42) 50%, transparent)'
}

function lineColor(depth: number): string {
  if (depth <= 1) return 'var(--foreground-muted, #6a6a90)'
  if (depth === 2) return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 55%, transparent)'
  return 'color-mix(in srgb, var(--foreground-muted, #6a6a90) 30%, transparent)'
}

const cellKeyOf = (ri: number, c: Pick<ExactCell, 'bar' | 'begin'>): string => `${ri}:${c.bar}:${c.begin.n}/${c.begin.d}`
const listOf = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/** the `+` handle reads the pattern back through this: does the longer text still open here, and at how many bars? */
function parseForLength(mini: string, _scale: ViewScale): ParseResult<{ bars: number }> {
  const g = exactGridFrom(probeTrees(mini))
  return g.ok ? { ok: true, model: { bars: g.bars } } : { ok: false, reason: "this pattern doesn't open as a grid" }
}

interface Press {
  row: number
  cell: ExactCell
  startX: number
  startY: number
  mode: 'paint' | 'pending' | 'resize' | 'velocity'
  paintOn: boolean
  /** a lit cell: its hit, and the level it played at when the press began */
  hit?: { begin: number; end: number }
  startLevel?: number
  /** the last level a velocity drag wrote, so a move that rounds to the same level writes nothing */
  wroteLevel?: string
  /** a vertical drag was refused once: said once per press */
  saidNo?: boolean
  /** the row's sound: a paint drag stays in the row it began in, even if rows move under it */
  sound: string
}

export function ExactStepGrid({ notice = null }: { notice?: string | null }): React.ReactElement {
  const { chunk, applyEdit, beginGesture, endGesture } = useActiveChunk()
  const mini = chunk?.miniString ?? null
  const eligible = !!chunk && mini !== null && opensStepGrid(chunk)
  const stmtId = chunk ? chunk.statementRange[0] : null

  // ROWS THE VIEW KEEPS: a voice just added, or one an edit emptied, stays on screen in its place
  // until the pattern changes some other way. The panel's own write is not such a change.
  const [kept, setKept] = React.useState<readonly KeptRow[]>([])
  const ownWrite = React.useRef<string | null>(null)
  const lastText = React.useRef<{ stmt: number | null; mini: string | null }>({ stmt: stmtId, mini })
  React.useEffect(() => {
    const was = lastText.current
    lastText.current = { stmt: stmtId, mini }
    if (was.stmt !== stmtId || (was.mini !== mini && ownWrite.current !== mini)) setKept([])
  }, [stmtId, mini])

  const probed = React.useMemo(() => (eligible ? probeTrees(mini!) : null), [eligible, mini])
  const grid = React.useMemo(() => (probed ? exactGridFrom(probed, kept) : null), [probed, kept])
  const ok = grid && grid.ok && !playsNumbers(grid.trees) ? grid : null
  const bars = ok?.bars ?? 1

  // THE CHAIN'S `.gain`: the level each place plays at, null under a gain `~` (#2467, #2468)
  const gain = React.useMemo(() => (chunk ? readChunkGain(chunk) : null), [chunk])
  const gainRef = React.useRef(gain)
  gainRef.current = gain

  const gridRef_ = React.useRef(ok)
  gridRef_.current = ok
  const miniRef = React.useRef(mini)
  miniRef.current = mini

  const writeEdit = React.useCallback(
    (from: string, edit: StepEdit): boolean => {
      let wrote = false
      applyEdit((fresh, wb) => {
        if (fresh.miniString !== from || !fresh.miniRange) return
        ownWrite.current = from.slice(0, edit.from) + edit.insert + from.slice(edit.to)
        wrote = commit(wb, stepWriteEdits(fresh, from, edit), 'seq') === 'written'
      })
      return wrote
    },
    [applyEdit],
  )
  const writeMini = React.useCallback(
    (text: string): void => {
      applyEdit((fresh, wb) => {
        ownWrite.current = text
        commit(wb, gridWriteEdits(fresh, text, null), 'seq')
      })
    },
    [applyEdit],
  )

  const length = usePatternLength<{ bars: number }>(chunk as ChunkInfo | null, ok ? { bars: ok.bars } : null, parseForLength, writeMini)

  const span = bars
  const playedNotes = React.useMemo(() => (chunk && ok ? stepNotes(chunk, span) : null), [chunk, ok, span])
  const [colorMode] = useNoteColorMode()
  const phone = usePhoneGrid()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const rulerPan = useRulerPan(scrollRef, phone.phone)
  const zoom = useGridZoom(scrollRef, !phone.phone, !!ok)

  // A BAR'S WIDTH: 1× fits the bars to the panel, each zoom step widens them. On a phone every
  // cell stays wide enough for a finger, and the grid scrolls under it.
  const maxCellsInBar = React.useMemo(() => {
    let most = 1
    for (const r of ok?.rows ?? []) {
      const perBar = new Map<number, number>()
      for (const c of r.cells) if (!c.split) perBar.set(c.bar, (perBar.get(c.bar) ?? 0) + 1)
      for (const n of perBar.values()) most = Math.max(most, n)
    }
    return most
  }, [ok])
  const fit = zoom.avail !== null ? Math.max(40, (zoom.avail - BAR_GAP * (bars - 1)) / bars) : 320
  // (a cell is drawn 2 px narrower than its place, so a finger's width needs those 2 px on top)
  const fingerPx = PHONE_STEP_MIN + 2
  const barPx = phone.phone ? Math.max(fit, maxCellsInBar * fingerPx) : fit * zoom.level
  const openPx = zoom.level > 1 ? OPEN_PX : Infinity
  const x = (t: number): number => {
    const b = Math.min(bars - 1, Math.max(0, Math.floor(t)))
    return b * (barPx + BAR_GAP) + (t - b) * barPx
  }
  const xRef = React.useRef(x)
  xRef.current = x
  const trackPx = bars * barPx + (bars - 1) * BAR_GAP

  const rows = ok?.rows ?? []
  // a snap half opens only once it can be aimed at: by a pointer, or on a phone by a finger
  const halfPx = phone.phone ? fingerPx : OPEN_PX
  const drawn = React.useMemo(() => rows.map((r) => drawnCells(r.cells, barPx, halfPx)), [rows, barPx, halfPx])
  // the level at every place drawn and every hit: one ask of Strudel per text
  const levelAt = React.useMemo(() => {
    const times = [...new Set([...drawn.flatMap((cs) => cs.map(cellAt)), ...rows.flatMap((r) => r.hits.map((h) => h.begin))])]
    const levels = gain ? gainLevelsAt(gain, times) : null
    const out = new Map<string, number | null>()
    if (levels) times.forEach((t, i) => out.set(t.toFixed(9), levels[i]))
    return out
  }, [drawn, rows, gain])
  /** the level at `t`: undefined where nothing is known (a `.gain` velocity does not manage) */
  const levelOf = (t: number): number | null | undefined => levelAt.get(t.toFixed(9))

  // WHERE A VELOCITY DRAG IS OFFERED: where the writer would write it, asked of `stepGainEdit`
  // itself for every hit (#1839's rule — never predicted beside the writer). `data-gain` says so
  // on the cell. Read from deferred inputs: a drag rewrites the `.gain` on every move, and these
  // dry runs must never hold the pointer up.
  const velocityIn = React.useMemo(() => ({ mini, gain, rows, bars }), [mini, gain, rows, bars])
  const velocityLate = React.useDeferredValue(velocityIn)
  const offered = React.useMemo(() => {
    const out = new Set<string>()
    const { mini: m, gain: g, rows: rs, bars: b } = velocityLate
    if (m === null || !g || g.foreign) return out
    for (const r of rs) {
      for (const h of r.hits) {
        const k = h.begin.toFixed(9)
        if (!out.has(k) && h.begin < b && stepGainEdit(m, g, b, { begin: h.begin, end: h.end }, 0.5).ok) out.add(k)
      }
    }
    return out
  }, [velocityLate])
  const drawings = React.useMemo(() => rows.map((r) => (r.bars ? drawTreeRow(r.bars, barPx, openPx) : null)), [rows, barPx, openPx])
  const orderOf = (r: ExactRow): string[] => rows.filter((k) => k.part === r.part).map((k) => k.sound)

  // WHAT EACH DRAWN CELL WOULD DO, asked of the writer before it is offered: once per text
  const answers = React.useMemo(() => {
    const out = new Map<string, ReturnType<typeof cellEdit>>()
    if (!ok || mini === null) return out
    rows.forEach((r, ri) => {
      const order = rows.filter((k) => k.part === r.part).map((k) => k.sound)
      for (const c of drawn[ri]) out.set(cellKeyOf(ri, c), cellEdit(mini, ok.trees, r, order, c, levelAt.get(cellAt(c).toFixed(9)) === null))
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, mini, drawn, levelAt])
  const answersRef = React.useRef(answers)
  answersRef.current = answers

  // the notes whose length the writer will change: a handle only where a drag would write
  const resizable = React.useMemo(() => {
    const out = new Set<string>()
    if (!ok || mini === null) return out
    rows.forEach((r, ri) => {
      const row = { sound: r.sound, part: r.part }
      for (const c of r.cells) {
        if (!c.on) continue
        const at = stepAddressAtPlace(ok.trees, r, c.bar, c.begin)
        if (typeof at === 'string') continue
        if (resizeStepBy(mini, ok.trees, at, 1, row).ok || resizeStepBy(mini, ok.trees, at, -1, row).ok) out.add(cellKeyOf(ri, c))
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, mini])

  // THE CURSOR: a row and a position in cycles. Arrow keys walk each row's places, and a step's
  // snap halves are not stops: they are where a click splits it, not steps.
  const [cursor, setCursor] = React.useState<{ row: number; col: number } | null>(null)
  const liveCursor = cursor && cursor.row < rows.length && cursor.col < bars ? cursor : null
  const cursorRef = React.useRef(liveCursor)
  cursorRef.current = liveCursor
  const stops = React.useMemo(() => rows.map((r) => r.cells.filter((c) => !c.split).map(cellAt)), [rows])
  const stopsRef = React.useRef(stops)
  stopsRef.current = stops
  const stmtRef = React.useRef(stmtId)
  React.useEffect(() => {
    if (stmtRef.current !== stmtId) {
      stmtRef.current = stmtId
      setCursor(null)
    }
  }, [stmtId])
  const tab = liveCursor ?? { row: 0, col: 0 }
  const focusNext = React.useRef(false)
  const gridBox = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!focusNext.current) return
    focusNext.current = false
    gridBox.current?.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"]')?.focus()
  })

  /** a row's drawn cell holding position `t` */
  const cellHolding = (ri: number, t: number): ExactCell | null => drawn[ri]?.find((c) => cellAt(c) <= t + 1e-9 && t < cellEnd(c) - 1e-9) ?? null

  const paint = React.useCallback(
    (ri: number, cell: ExactCell, on: boolean, drag = false): { refused: boolean; why?: string } => {
      if (cell.on === on) return { refused: false }
      const answer = answersRef.current.get(cellKeyOf(ri, cell))
      const from = miniRef.current
      if (!answer || from === null) return { refused: true }
      if (!answer.ok) return { refused: true, why: answer.why }
      if (drag && 'split' in answer && answer.split) return { refused: false }
      // a voice the edit empties stays on screen
      const row = gridRef_.current?.rows[ri]
      if (row && !on) setKept((k) => (k.some((r) => r.sound === row.sound && r.part === row.part) ? k : [...k, { sound: row.sound, part: row.part }]))
      return { refused: !writeEdit(from, answer.edit) }
    },
    [writeEdit],
  )
  const paintOne = (ri: number, cell: ExactCell, on: boolean): void => {
    const { refused, why } = paint(ri, cell, on)
    if (refused) report(on ? "Couldn't add that hit" : "Couldn't remove that hit", why ? refusalLine(why, !on) : undefined)
  }
  const paintOneRef = React.useRef(paintOne)
  paintOneRef.current = paintOne

  /** make a row's note at `cell` end at `end` (of its bar), or a unit longer or shorter */
  const resizeNote = React.useCallback(
    (ri: number, cell: Pick<ExactCell, 'bar' | 'begin'>, to: { end: Frac } | { by: number }, dryRun = false): boolean => {
      const g = gridRef_.current
      const from = miniRef.current
      const row = g?.rows[ri]
      if (!g || !row || from === null) return false
      const at = stepAddressAtPlace(g.trees, row, cell.bar, cell.begin)
      if (typeof at === 'string') return false
      const writerRow = { sound: row.sound, part: row.part }
      const r: StepEditResult = 'by' in to ? resizeStepBy(from, g.trees, at, to.by, writerRow) : resizeStep(from, g.trees, at, to.end, writerRow)
      if (!r.ok) return false
      return dryRun || writeEdit(from, r.edit)
    },
    [writeEdit],
  )

  /** set the level of the hit at `hit` (cycles) to `level`, from the text as it is now; or why not */
  const writeLevel = React.useCallback(
    (hit: { begin: number; end: number }, level: number, dryRun = false): { ok: true } | { ok: false; why: StepGainRefusal } => {
      const from = miniRef.current
      const g = gainRef.current
      if (from === null || !g) return { ok: false, why: 'gain-not-ours' }
      const r = stepGainEdit(from, g, bars, hit, level)
      if (!r.ok || dryRun) return r.ok ? { ok: true } : r
      applyEdit((fresh, wb) => {
        if (fresh.miniString !== from) return
        commit(wb, stepGainWriteEdits(fresh, g.mini, r), 'seq')
      })
      return { ok: true }
    },
    [applyEdit, bars],
  )

  // ONE POINTER GESTURE. An empty cell paints at once; a note starts pending, so a horizontal
  // drag paints it off, a vertical drag sets its level, and a release with no drag erases it. A
  // press on a note's handle resizes.
  const press = React.useRef<Press | null>(null)
  const writeLevelRef = React.useRef(writeLevel)
  writeLevelRef.current = writeLevel
  React.useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const g = press.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (g.mode === 'pending') {
        if (g.hit && Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          // a vertical drag on a lit cell is its velocity, where the `.gain` can take it
          const can = writeLevelRef.current(g.hit, (g.startLevel ?? 1) === 0 ? 1 : 0, true)
          if (!can.ok) {
            if (!g.saidNo) report("Couldn't change that hit's velocity", velocityLine(can.why))
            g.saidNo = true
            return
          }
          g.mode = 'velocity'
        } else if (Math.abs(dx) > DRAG_THRESHOLD) {
          g.mode = 'paint'
          paintOneRef.current(g.row, g.cell, g.paintOn)
          return
        } else return
      }
      if (g.mode === 'velocity' && g.hit) {
        // drag DOWN softens; up to a full 1, down to 0
        const level = clamp01((g.startLevel ?? 1) - dy / VELOCITY_FULL_PX)
        const text = fmtLevel(level)
        if (text === g.wroteLevel) return
        g.wroteLevel = text
        writeLevelRef.current(g.hit, level)
      }
    }
    const onUp = (): void => {
      const g = press.current
      if (!g) return
      press.current = null
      // a press refused its velocity drag stays a click only if the pointer barely moved
      if (g.mode === 'pending' && !g.saidNo) paintOneRef.current(g.row, g.cell, false)
      endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [endGesture])

  const onCellDown = (ri: number, cell: ExactCell, e: React.PointerEvent): void => {
    e.preventDefault()
    setCursor({ row: ri, col: cellAt(cell) })
    const answer = answers.get(cellKeyOf(ri, cell))
    if (!answer?.ok) return
    beginGesture()
    const at = cellAt(cell)
    const h = cell.on ? rows[ri].hits.find((x) => Math.abs(x.begin - at) < 1e-9) : undefined
    const hit = h ? { begin: h.begin, end: h.end } : undefined
    press.current = { row: ri, cell, startX: e.clientX, startY: e.clientY, mode: cell.on ? 'pending' : 'paint', paintOn: !cell.on, sound: rows[ri].sound, hit, startLevel: hit ? levelOf(hit.begin) ?? 1 : undefined }
    if (!cell.on) paintOne(ri, cell, true)
  }
  const onCellEnter = (ri: number, cell: ExactCell): void => {
    const g = press.current
    if (!g) return
    if (g.mode === 'resize') {
      // the pointer's cell ends the note; the row it wanders into does not matter
      const end = rows[g.row]?.cells.find((c) => c.bar === g.cell.bar && cellAt(c) <= cellAt(cell) && cellAt(cell) < cellEnd(c))
      if (end && cell.bar === g.cell.bar && cellAt(end) >= cellAt(g.cell)) resizeNote(g.row, g.cell, { end: end.end })
      return
    }
    if (g.mode !== 'paint' || ri !== g.row || rows[ri]?.sound !== g.sound) return
    paint(ri, cell, g.paintOn, true)
  }
  const onResizeDown = (ri: number, cell: ExactCell, e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    beginGesture()
    press.current = { row: ri, cell, startX: e.clientX, startY: e.clientY, mode: 'resize', paintOn: false, sound: rows[ri].sound }
  }

  // THE KEYS, through the same command path as the roll's
  const runGesture = (action: GridAction, dryRun: boolean, fromKey = false): boolean => {
    if (!ok || rows.length === 0) return false
    const at = cursorRef.current ?? (fromKey ? { row: 0, col: 0 } : null)
    if (isCursorMove(action)) {
      if (dryRun) return true
      focusNext.current = true
      setCursor(moveStepCursor(at ?? { row: 0, col: 0 }, action, rows.length, Math.max(1, bars), (r) => stopsRef.current[r] ?? null))
      return true
    }
    if (!at) return false
    const place = stopsRef.current[at.row]?.length ? stopAt(stopsRef.current[at.row], at.col) : at.col
    const cell = cellHolding(at.row, place)
    if (!cell) return false
    if (isNoteEdit(action)) {
      if (action !== 'shorter' && action !== 'longer') return false
      const row = rows[at.row]
      const head = [...row.cells].reverse().find((c) => c.on && cellAt(c) <= at.col + 1e-9 && row.hits.some((h) => Math.abs(h.begin - cellAt(c)) < 1e-9 && at.col < h.end))
      if (!head) return false
      const by = action === 'longer' ? 1 : -1
      if (!resizeNote(at.row, head, { by }, true)) return false
      if (!dryRun) {
        beginGesture()
        resizeNote(at.row, head, { by })
        endGesture()
        focusNext.current = true
        setCursor({ row: at.row, col: cellAt(head) })
      }
      return true
    }
    if (action !== 'toggle' && action !== 'remove') return false
    if (action === 'remove' && !cell.on) return false
    const answer = answers.get(cellKeyOf(at.row, cell))
    if (!answer?.ok) {
      if (!dryRun) report(cell.on ? "Couldn't remove that hit" : "Couldn't add that hit", answer ? refusalLine(answer.why, cell.on) : undefined)
      return false
    }
    if (!dryRun) {
      if (!cursorRef.current) setCursor(at)
      beginGesture()
      paintOne(at.row, cell, action === 'toggle' ? !cell.on : false)
      endGesture()
      focusNext.current = true
    }
    return true
  }
  const runRef = React.useRef(runGesture)
  runRef.current = runGesture
  React.useEffect(() => mountGridGestures(GRID_SCOPE.sequencer, (a, dry) => runRef.current(a, dry)), [])

  // THE PLAYHEAD, at the exact position playing, moved each frame by style alone; the cell it is
  // in is marked only when that changes
  const headRef = React.useRef<HTMLDivElement>(null)
  const [playAt, setPlayAt] = React.useState<number | null>(null)
  const edges = React.useMemo(() => [...new Set(rows.flatMap((r) => r.cells.map(cellAt)))].sort((a, b) => a - b), [rows])
  const edgesRef = React.useRef(edges)
  edgesRef.current = edges
  React.useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const t = treePlayhead(readCurrentCycle(), bars)
      const el = headRef.current
      if (el) {
        if (t === null) el.style.display = 'none'
        else {
          el.style.display = 'block'
          el.style.transform = `translateX(${xRef.current(t)}px)`
          el.dataset.treePlayhead = t.toFixed(4)
        }
      }
      let edge: number | null = null
      if (t !== null) for (const k of edgesRef.current) if (k <= t + 1e-9) edge = k
      setPlayAt((p) => (p === edge ? p : edge))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bars])

  const lookRoll = useDeferredPerText(eligible && grid?.ok && playsNumbers(grid.trees) ? mini : null, lookOnlyTreeRoll)
  const rulerRow = rows[liveCursor?.row ?? 0]?.bars ? rows[liveCursor?.row ?? 0] : rows.find((r) => r.bars)
  const ruler = rulerRow?.bars ? treeRuler(rulerRow.bars, barPx, openPx) : Array.from({ length: bars }, (_, b) => ({ at: b, label: String(b + 1) }))
  const chordChart = chunk?.headFn === 'chord' || chordLanes(rows.map((r) => r.sound))

  if (!ok) {
    if (lookRoll && 'roll' in lookRoll) return <TreeRollGrid roll={lookRoll.roll} reason={lookRoll.reason} />
    return React.createElement(VisualEditStandby, {
      panel: SEQUENCER_TAB_ID,
      hint: eligible ? "This pattern isn't grid-editable — edit it as code." : 'Click a drum pattern to edit it as a step grid.',
      icon: 'symbol-array',
    })
  }

  const muted = 'var(--foreground-muted, #a0a0aa)'
  const pinned: React.CSSProperties = phone.phone ? { position: 'sticky', left: 0, zIndex: 2, background: 'var(--background, #0f0f12)' } : {}
  const anyWrites = [...answers.values()].some((a) => a.ok)

  return (
    <div
      ref={scrollRef}
      data-bottom-panel-tab="sequencer"
      data-exact-grid
      data-tree-bars={bars}
      data-pattern-scroll
      onPointerDownCapture={(e) => {
        ;(e.target as HTMLElement).closest<HTMLElement>('[data-seq-cell]')?.focus({ preventScroll: true })
      }}
      onKeyDown={(e) => {
        if (!(e.target as HTMLElement).closest?.('[data-seq-cell]')) return
        const action = matchGridKey(GRID_SCOPE.sequencer, e.nativeEvent)
        if (!action) return
        e.preventDefault()
        e.stopPropagation()
        runGesture(action, false, true)
      }}
      style={{ padding: phone.phone ? '16px 16px 16px 0' : 16, height: '100%', overflow: 'auto', outline: 'none', boxSizing: 'border-box', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', touchAction: 'none' }}
    >
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, width: NAME_PX + 8 + trackPx + 28, paddingRight: 28, minWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4, position: 'sticky', left: 0, width: phone.phone ? Math.max(0, rulerPan.viewWidth - 44) : zoom.avail !== null ? zoom.avail + NAME_PX + 8 : undefined, boxSizing: 'border-box' }}>
          <PatternTrackChip />
          {!phone.phone && <GridZoomControl zoom={zoom} />}
          <TurnHint show={phone.upright && rulerPan.inView.more} />
        </div>
        {chordChart && (
          <div data-seq-chord-chart style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
            Chord chart — each lane is a chord, not a sound.
            {chunk?.chain.some(opensRhythmLine) && ' They play to the rhythm in .struct(…): click into a rhythm line to see them on it and edit it.'}
          </div>
        )}
        {playedNotes && (
          <div data-seq-sound-first style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
            The sounds set the rhythm here: each step plays the note written where it starts
            {playedNotes.unheard.length > 0 ? `, so ${listOf(playedNotes.unheard)} never ${playedNotes.unheard.length === 1 ? 'plays' : 'play'}.` : '.'}
          </div>
        )}
        {notice && (
          <div data-seq-notice style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
            {notice}
          </div>
        )}
        {!anyWrites && rows.length > 0 && (
          <div data-seq-look-only style={{ fontSize: 11, color: muted, paddingBottom: 2 }}>
            {lookOnlyLine({ reason: "the grid can't reach this pattern's own text" })}
          </div>
        )}
        <div ref={gridBox} role="grid" aria-label="Step sequencer" style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
          {phone.phone && (
            <div style={{ position: 'sticky', left: 104, width: 0, height: 0, marginBottom: -4 }}>
              <InViewBar inView={rulerPan.inView} width={rulerPan.viewWidth - 16 - 104} />
            </div>
          )}
          {/* the ruler: each bar's number, and each drawn step named by its place in the pattern */}
          <div data-seq-ruler aria-hidden="true" {...rulerPan.handlers} style={{ display: 'flex', gap: 8, height: phone.phone ? PHONE_RULER_HEIGHT : 12, ...(phone.phone ? { touchAction: 'none', cursor: 'grab' } : {}) }}>
            <div style={{ width: NAME_PX, flex: '0 0 auto', alignSelf: 'stretch', ...pinned }} />
            <div style={{ position: 'relative', width: trackPx, flex: '0 0 auto', height: '100%' }}>
              {Array.from({ length: bars }, (_, b) => (
                // what the `+` handle measures: one bar is one of its columns
                <div key={`bar${b}`} data-exact-bar={`bar:${b}`} style={{ position: 'absolute', left: x(b), width: barPx, top: 0, bottom: 0, pointerEvents: 'none' }} />
              ))}
              {ruler.map(({ at, label }) => {
                const isBar = !label.includes('.')
                return (
                  <span
                    key={label}
                    data-seq-ruler-label={label}
                    data-ruler-bar={isBar ? '' : undefined}
                    style={{ position: 'absolute', left: x(at), bottom: 0, fontSize: 9, lineHeight: '10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: isBar ? 600 : 400, color: isBar ? 'var(--foreground, #e6e6ea)' : muted }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
          {rows.map((row, ri) => {
            const voice = sampleVoice(row.sound)
            const d = drawings[ri]
            return (
              <div key={`${row.sound}:${row.part}`} role="row" data-tree-row={row.sound} data-tree-part={row.part} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div role="rowheader" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', alignSelf: 'stretch', width: NAME_PX, boxSizing: 'border-box', ...pinned }}>
                  <span data-seq-voice={row.sound} title={row.sound} style={{ width: 72, textAlign: 'right', fontSize: 11, color: 'var(--foreground, #e6e6ea)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {voice.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`remove ${row.sound}`}
                    data-seq-remove-voice={row.sound}
                    title={`Remove ${row.sound}`}
                    onClick={() => {
                      if (mini === null) return
                      const r = removeRowText(mini, bars, { sound: row.sound, part: row.part }, orderOf(row))
                      if (!r.ok) {
                        report(`Couldn't remove ${row.sound}`, refusalLine(r.why, true))
                        return
                      }
                      setKept((k) => k.filter((x) => x.sound !== row.sound || x.part !== row.part))
                      if (r.mini !== mini) writeMini(r.mini)
                    }}
                    style={{ width: 16, height: 16, flex: '0 0 auto', padding: 0, lineHeight: '14px', fontSize: 12, borderRadius: 3, border: '1px solid var(--border, #3a3a42)', background: 'transparent', color: muted, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
                <div role="none" data-tree-why={row.why ?? undefined} style={{ position: 'relative', width: trackPx, height: ROW_PX, flex: '0 0 auto' }}>
                  {d?.steps.map((s) => (
                    <div key={`s${s.begin}`} data-tree-step={s.depth} style={{ position: 'absolute', left: x(s.begin) + 1, width: Math.max(1, x(s.end) - x(s.begin) - 2), top: 0, bottom: 0, boxSizing: 'border-box', border: outline(s.depth), borderRadius: 3, background: d.inner.some((k) => k.begin >= s.begin && k.begin < s.end) ? 'var(--background, #1e1e24)' : 'var(--background-elevated, #26262c)', pointerEvents: 'none' }} />
                  ))}
                  {d?.inner.map((s) => (
                    <div key={`i${s.begin}`} data-tree-inner={s.depth} style={{ position: 'absolute', left: x(s.begin) + 2, width: Math.max(1, x(s.end) - x(s.begin) - 3), top: 4, bottom: 4, boxSizing: 'border-box', border: '1px solid var(--border, #3a3a42)', borderRadius: 2, background: 'var(--background-elevated, #26262c)', pointerEvents: 'none' }} />
                  ))}
                  {d?.lines.map((l) => (
                    <div key={`l${l.at}`} data-tree-line={l.depth} style={{ position: 'absolute', left: x(l.at) - 1, width: 2, top: 0, bottom: 0, background: lineColor(l.depth), pointerEvents: 'none' }} />
                  ))}
                  {/* what the row plays, at its exact time and length */}
                  {row.hits.map((h, i) => {
                    // HEIGHT is the level the hit plays at, bottom-anchored and full at 1 (#2468)
                    const level = clamp01(levelOf(h.begin) ?? 1)
                    return (
                      <div key={`h${i}`} data-seq-fill data-tree-hit={h.begin.toFixed(6)} style={{ position: 'absolute', left: x(h.begin) + 2, width: Math.max(2, x(Math.min(h.end, bars)) - x(h.begin) - 3), top: 3 + (1 - level) * (ROW_PX - 6), bottom: 3, borderRadius: 2, background: colorMode === 'velocity' ? velocityColor(level) : voice.color, pointerEvents: 'none' }} />
                    )
                  })}
                  {/* the places a click acts on, over the picture */}
                  {drawn[ri].map((cell) => {
                    const key = cellKeyOf(ri, cell)
                    const answer = answers.get(key)
                    const can = !!answer?.ok
                    const splits = !!answer && answer.ok && 'split' in answer && !!answer.split
                    const at = cellAt(cell)
                    const inCell = (t: number): boolean => at <= t + 1e-9 && t < cellEnd(cell) - 1e-9
                    const isCursor = liveCursor?.row === ri && inCell(liveCursor.col)
                    const isTab = tab.row === ri && (inCell(tab.col) || (tab.col === 0 && at === 0))
                    const plays = cell.on && playedNotes ? playedNotes.notes.get(stepNoteKey(row.sound, at))?.join(' / ') ?? null : null
                    const held = !cell.on && row.hits.some((h) => h.begin < at - 1e-9 && at < h.end - 1e-9)
                    const stepNo = row.cells.filter((c) => !c.split && cellAt(c) <= at + 1e-9).length
                    return (
                      <button
                        key={key}
                        type="button"
                        role="gridcell"
                        aria-selected={isCursor}
                        aria-pressed={cell.on}
                        aria-disabled={can ? undefined : true}
                        aria-label={held ? `${row.sound} step ${stepNo}, held` : `${row.sound} step ${stepNo}${plays ? `, plays ${plays}` : ''}`}
                        tabIndex={isTab ? 0 : -1}
                        data-seq-cell={key}
                        data-seq-at={at.toFixed(6)}
                        data-seq-cell-inert={can ? undefined : 'true'}
                        data-seq-splits={splits ? 'true' : undefined}
                        data-seq-sustain={held ? 'true' : undefined}
                        data-seq-step-note={plays ?? undefined}
                        data-gain={cell.on && offered.has(at.toFixed(9)) && levelOf(at) != null ? fmtLevel(levelOf(at) as number) : undefined}
                        data-playing={playAt !== null && inCell(playAt) ? 'true' : undefined}
                        title={can ? (splits ? `Splits this step: adds ${row.sound} here` : plays ? `${row.sound} plays ${plays}` : undefined) : answer && !answer.ok ? refusalLine(answer.why, cell.on) : undefined}
                        onFocus={() => {
                          if (!isCursor) setCursor({ row: ri, col: at })
                        }}
                        onPointerDown={(e) => onCellDown(ri, cell, e)}
                        onPointerEnter={() => onCellEnter(ri, cell)}
                        style={{
                          position: 'absolute',
                          left: x(at) + 1,
                          width: Math.max(1, x(cellEnd(cell)) - x(at) - 2),
                          top: 0,
                          bottom: 0,
                          padding: 0,
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                          background: 'transparent',
                          border: playAt !== null && inCell(playAt) ? '1px solid var(--foreground, #e6e6ea)' : cell.split ? 'none' : '1px solid color-mix(in srgb, var(--border, #3a3a42) 70%, transparent)',
                          borderRadius: 3,
                          cursor: can ? 'pointer' : 'default',
                        }}
                      >
                        {plays && (
                          <span data-seq-step-note-label style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 3, fontSize: 9, lineHeight: 1, color: 'var(--background, #1c1c22)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                            {plays}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {/* the length handle, on the note's own end, only where a drag would write */}
                  {row.cells.filter((c) => c.on && resizable.has(cellKeyOf(ri, c))).map((cell) => {
                    const hit = row.hits.find((h) => Math.abs(h.begin - cellAt(cell)) < 1e-9)
                    if (!hit) return null
                    const end = x(Math.min(hit.end, bars)) - 1
                    return (
                      <span
                        key={`r${cellKeyOf(ri, cell)}`}
                        data-seq-resize={cellKeyOf(ri, cell)}
                        aria-label={`resize ${row.sound}`}
                        onPointerDown={(e) => onResizeDown(ri, cell, e)}
                        style={{ position: 'absolute', top: 0, bottom: 0, left: end - RESIZE_ZONE_PX, width: RESIZE_ZONE_PX, cursor: 'ew-resize', background: 'var(--foreground, #e6e6ea)', opacity: 0.45, borderRadius: '0 2px 2px 0' }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div style={{ position: 'relative', height: 0, marginLeft: NAME_PX + 8 }}>
            <div
              ref={headRef}
              aria-hidden="true"
              data-seq-playhead-line
              style={{ display: 'none', position: 'absolute', left: 0, bottom: 0, width: 2, marginLeft: -1, height: rows.length * (ROW_PX + 4) + 16, background: 'var(--foreground, #e6e6ea)', opacity: 0.5, pointerEvents: 'none', zIndex: 3 }}
            />
          </div>
        </div>
        <ExtendHandle length={length} gridRef={gridBox} cellAttr="data-exact-bar" cols={bars} lastBarCols={1} />
        {!chordChart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ width: 72, flex: '0 0 auto' }} />
            <select
              data-seq-add-voice
              aria-label="add drum voice"
              value=""
              onChange={(e) => {
                const sound = e.target.value
                if (!sound) return
                // the part the cursor is in: a new voice's first hit writes into it
                const part = rows[liveCursor?.row ?? 0]?.part ?? 0
                setKept((k) => (k.some((r) => r.sound === sound) || rows.some((r) => r.sound === sound) ? k : [...k, { sound, part }]))
              }}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px dashed var(--border, #3a3a42)', background: 'var(--background-elevated, #26262c)', color: muted, cursor: 'pointer' }}
            >
              <option value="">+ add voice…</option>
              {DRUM_SOUNDS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
