/**
 * Sequencer — drum/step grid (#382, per-column velocity #409).
 *
 * Parses the mini-notation of the `s(...)` / `sound(...)` statement under the
 * cursor into a `StepGridModel` and renders lanes × steps. Toggling a cell
 * re-serializes the model and writes it back over the mini-notation range
 * (`'seq'`); a drag paints multiple cells as ONE undo step. Anything outside
 * the editable grid subset (`{}`, `/`, …) → standby, code-only — the
 * conservatism rule.
 *
 * Length: a note is drawn across the columns it covers (#1056) and its trailing
 * edge carries a handle that sets how long it sounds, in whole columns (#1053) —
 * the roll's gesture on the other surface. The handle is drawn only where the
 * writer would take the drag, so it never promises an edit the document refuses.
 *
 * Velocity: an ON cell shows its level as a bottom-anchored fill; dragging it
 * vertically sets the column's gain (DAW velocity-lane behaviour — drag down to
 * soften). The level is written to a parallel `.gain("…")` mini aligned to the
 * serialized columns; when every column returns to neutral the `.gain` is
 * removed. Gain is single-part / single-bar only; richer shapes keep toggling
 * but the `.gain` is left untouched.
 *
 * The model lives in component state, not derived per-render from the chunk, so
 * a lane the user clears completely keeps its row. The model is reseeded only
 * on EXTERNAL edits — see `useGridModel`.
 */
import * as React from 'react'

import { stepGridCodec, gainWritable, slotPress, slotPressCost, NO_RESOLUTION_EFFECT } from '../../codeView'
import { columnCount, isCellOn, laneCoverage, lookOnlyLine } from '../../codeView'
import type { StepGridModel } from '../../codeView'
import { drawnLayout } from '../../codeView'
import { VisualEditStandby } from './VisualEditStandby'
import { SEQUENCER_TAB_ID } from './tabs'
import { opensStepGrid } from '../../codeView'
import { useGridModel } from './useGridModel'
import { stepToCycle, usePlayingStep } from './usePlayingStep'
import { addLane, removeLane } from '../../codeView'
import { canResizeCell, canToggleCell, resizeCell, toggleCell } from '../../codeView'
import { DRUM_SOUNDS } from './soundCatalog'
import { sampleVoice, chordLanes, stepNotes, stepNoteKey } from '../../codeView'
import { useNoteColorMode, velocityColor } from './noteColor'
import { useLiftResolution, useViewProver, type ResolutionControlProps } from './ResolutionControl'
import { PatternTrackChip } from './PatternTrackChip'
import { UNREFINED, type ViewScale } from '../../codeView'
import { setColumnGain } from './inspector'
import { ExtendHandle } from './ExtendHandle'
import {
  boxLengths,
  boxesPlaceNotes,
  groupBoxesBySteps,
  linesModel,
  ownStepWidths,
  rowBoxes,
  rulerLabels,
  useRulerFit,
  writtenStepStarts,
} from './writtenSteps'
import { useGridMode } from './gridMode'
import { emitLog } from '../../engine/engineLog'
import { usePatternLength } from './usePatternLength'
import { InViewBar, PHONE_GRID_WIDTH, PHONE_RULER_HEIGHT, PHONE_STEP_MIN, TurnHint, usePhoneGrid, useRulerPan } from './phoneGrid'
import {
  GRID_SCOPE,
  isCursorMove,
  isNoteEdit,
  matchGridKey,
  mountGridGestures,
  moveBoxCursor,
  type GridAction,
  type GridCell,
} from './gridGestures'

const SEQ_HINT = 'Click a drum pattern to edit it as a step grid.'

/** px of vertical drag that spans the full 0→1 velocity range */
const VELOCITY_FULL_PX = 80
/** px of movement before a press on an ON cell becomes a drag (not a click) */
const DRAG_THRESHOLD = 4
/**
 * Width of the note-length handle, and the floor on its invisible grab zone (#1053).
 *
 * The SAME number the piano roll uses, because this is the same gesture on the other
 * surface and #1053 asks the two to agree rather than diverge. Kept as its own constant
 * here rather than imported: the roll's is a private detail of the roll's geometry, and
 * an import would make either panel's tuning silently retune the other.
 */
const RESIZE_ZONE_PX = 8

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/**
 * Say that a toggle the user asked for was not made (#1836) — the roll's
 * `reportRefusal` sentence, on this surface. A refused cell is normally inert and
 * titled before anyone presses it; this is for the gestures that still reach the op.
 * Today that is the keys (`refuseKey`) — a key user never sees a title. The press
 * path (`paintOne`) carries it too, as the roll's ops do, though every refused
 * toggle the corpus offers is pre-announced, so no fixture reaches that one.
 * `emitLog` coalesces identical rows, so a repeated attempt ticks one row up.
 */
function reportRefusal(attempted: string): void {
  emitLog({
    level: 'warn',
    runtime: 'stave',
    message: `${attempted} — writing it would change the pattern in ways you didn't ask for, so it was left unchanged.`,
  })
}

/**
 * Is this call a `.struct` whose rhythm a cursor can open (#2120)? Only the forms the
 * lookup takes: a string, or a `pick` list of strings. A rhythm bound to a name or built
 * by a function opens nothing yet (#2128), so the chord chart must not point at it.
 */
function opensRhythmLine(call: { name: string; args: { raw: string }[] }): boolean {
  const raw = call.args[0]?.raw ?? ''
  return call.name === 'struct' && (/^["'`]/.test(raw) || /\.pick\w*\(\s*\[\s*["'`]/.test(raw))
}

export interface SequencerGridProps {
  /** lift the grid-resolution ("Slots") control to the Pattern inspector (#601) */
  onResolution?: (r: ResolutionControlProps | null) => void
  /** a sentence shown over the grid: why a rhythm line is drawn without its chords (#2120) */
  notice?: string | null
}

export function SequencerGrid({ onResolution, notice = null }: SequencerGridProps = {}): React.ReactElement {
  // How finely this panel DRAWS the pattern (#1057). Purely a view: nothing here
  // reaches the document until an actual edit is made, and the first write absorbs
  // it (`useGridModel` → `absorbViewScale`).
  const [viewScale, setViewScale] = React.useState<ViewScale>(UNREFINED)
  const { chunk, model, read, mutate, writeMini, beginGesture, endGesture, patternKey } = useGridModel<StepGridModel>({
    ...stepGridCodec,
    source: 'seq',
    eligible: opensStepGrid,
    viewScale,
    onViewScaleConsumed: () => setViewScale(UNREFINED),
  })
  // The `+` past the last column: add a bar that continues the pattern, or drag in empty bars (#1824).
  const length = usePatternLength(chunk, model, stepGridCodec.parse, writeMini)

  // A refinement belongs to the pattern it was made on. Dropping it when the cursor
  // moves keeps a leftover zoom from deciding whether the NEXT pattern opens at all —
  // four projections refuse a finer view (#1117), so a carried scale could send an
  // perfectly editable pattern to standby with nothing reporting why.
  // The panel's own writes do not count as a new pattern (#1964).
  React.useEffect(() => {
    setViewScale(UNREFINED)
  }, [patternKey])

  // The grid's length is always a whole number of columns, so `columnCount` is `steps`
  // here; it is asked anyway so both panels bound the playhead by the same rule (#1087).
  const playingStep = usePlayingStep(
    model?.steps ?? 0,
    model?.bars ?? 1,
    model ? columnCount(model) : 0,
    model?.barSteps,
  )
  const [colorMode] = useNoteColorMode()
  const gridMode = useGridMode()

  // A SOUND-FIRST LINE (#2226): `sound("piano gm_electric_guitar_muted").note("48 67 63 [62, 58]")`.
  // The sounds set the rhythm, so this grid draws them — and each step plays the note
  // sounding where it starts, which the grid otherwise never shows. Asked of Strudel;
  // null for every line that is not one (a drum grid has no `.note`).
  const span = model?.bars ?? 1
  const playedNotes = React.useMemo(() => (chunk ? stepNotes(chunk, span) : null), [chunk, span])

  // One pointer gesture from a cell press. An OFF cell paints immediately (snappy
  // step entry); an ON cell starts PENDING — a vertical drag past the threshold
  // becomes velocity, a horizontal drag becomes paint-off, and a release with no
  // move is a plain toggle-off. The whole gesture is one undo step.
  //
  // A press inside a note's trailing grab zone is 'resize' and is decided BEFORE any
  // of that (#1053), so it never passes through 'pending' — which is what keeps a
  // release with no movement from falling through to the toggle-off in `onUp`.
  // `step` is then the note's OWN start column, not the column pressed.
  const gestureRef = React.useRef<{
    lane: number
    step: number
    startX: number
    startY: number
    startGain: number
    mode: 'paint' | 'pending' | 'velocity' | 'resize'
    paintValue: boolean
  } | null>(null)

  // Velocity is offered where the WRITER will write it — `gainWritable` asks `serializeStepGain`
  // itself, the way the roll's `gainWritable` asks `serializeRollGain` (#1089), not
  // predicted beside it (#1839). The prediction that lived here copied the writer's
  // foreign/bars/parts lines and missed its leaf line, so on every leaf-read grid a
  // vertical drag redrew the bar and the code never changed.
  //
  // Asked of the CURRENT model: the writer's skips are shape (foreign `.gain`, bars,
  // parts, leaf, unspellable columns), which a gain edit does not move. Memoized on
  // the model, as `mutate` fires every pointermove of the drag it gates.
  const gainScoped = React.useMemo(() => (model ? gainWritable(stepGridCodec, model) : false), [model])


  // Is this a CHORD CHART rather than a drum kit (#1241)? Asked of the lane
  // tokens, because the route cannot answer it: seven of the thirteen units
  // that reach this grid without an `s()` head are ordinary drum patterns whose
  // sound is assigned further down the chain, so "the head was silent" would
  // relabel them all. Memoized on the lane names rather than the model, since
  // every drag rebuilds the model and none of them renames a lane.
  const laneKey = model ? model.lanes.map((l) => l.sound).join('\u0000') : ''
  // A `chord(…)` head says so itself (#2142): `<C F G>` is a chord chart there, though
  // its lanes spell like notes and so never force the reading on their own.
  const chordHead = chunk?.headFn === 'chord'
  const isChordChart = React.useMemo(
    () => chordHead || chordLanes(laneKey === '' ? [] : laneKey.split('\u0000')),
    [chordHead, laneKey],
  )

  // THE BOXES EACH ROW IS DRAWN AS (#1855). LCM: one per column. Exact: a row whose
  // `,`-part is stretched onto the shared grid is drawn at the part's own steps, each box
  // `factor` columns wide, so `~ sd ~ sd, hh*8` shows the snare as 4 boxes and the hats
  // as 8. The part's own step is read from what the TEXT reads as, like the step lines.
  const boxes = React.useMemo(() => {
    if (!model) return null
    const widths = gridMode === 'exact' ? ownStepWidths(linesModel(model, read)) : new Map<number, number>()
    return model.lanes.map((lane) => rowBoxes(lane.cells, model.steps, widths.get(lane.part ?? 0), isCellOn))
  }, [model, read, gridMode])
  /** columns one box of this row spans: 1 in LCM and on a row at the shared grid */
  const boxesRef = React.useRef(boxes)
  boxesRef.current = boxes
  const boxWidth = (laneIndex: number): number => boxesRef.current?.[laneIndex]?.[0]?.width ?? 1

  // PROVE BEFORE OFFER, at the cell — the gesture this panel exists for.
  // `canToggleCell` runs the real op and asks the real writer, so it cannot
  // drift from what a click actually does ([[PV241]]).
  //
  // ⚠ BOTH DIRECTIONS ARE ASKED (#1836). This map used to answer `true` for every
  // ON cell, on the reasoning that a lit cell's erase and velocity drag are other
  // ops with their own write paths. The erase is not: it is this same op with
  // `false`, and on a leaf grid it refuses whenever the hit's token plays in more
  // than one box of the view (`hh` outside `< >` over two bars) — 285 of the
  // 5,707 erase clicks the corpus offers. Answering `true` for those made the
  // cell look pressable and do nothing, with nothing said.
  //
  // A refused lit cell loses its velocity drag with the rest: all 285 are on
  // leaf-read grids, where the writer never writes velocity anyway (#1839).
  //
  // Memoized on the model, so the serialize-per-cell is paid once per edit rather
  // than once per render. Asking the lit cells too was TIMED, not estimated ([[P380]]):
  // over the 1,014 corpus grids (best of 3, Node) p50 0.0042 → 0.0111ms, p99 6.23 →
  // 6.52ms, worst 14.5 → 21.1ms, total +15%.
  //
  // A box in Exact is asked as the click it is: a hit one whole box long, at its first
  // column (#1855). The columns inside a box are never drawn, so they are not asked.
  const toggleable = React.useMemo(
    () =>
      model
        ? model.lanes.map((lane, li) => {
            const w = boxes?.[li]?.[0]?.width ?? 1
            return lane.cells.map((c, si) => si % w === 0 && canToggleCell(model, li, si, !isCellOn(c), w))
          })
        : null,
    [model, boxes],
  )

  // Does this view place notes ANYWHERE? Said ONCE here rather than as a grid
  // full of individually dead cells with no reason on them (#1070) — the per-cell
  // map above refuses each of them anyway; this is what lets the panel give a
  // reason for the surface.
  //
  // ⚠ It ASKS, and no longer reads the write path. A leaf-anchored projection
  // used to be creation-incapable by construction; since rests carry a span
  // (#1154) some leaf grids take a note and most still do not, so the honest
  // answer is per view and only the view can give it.
  //
  // Read off the SAME per-box answers the cells use (#1858), so in Exact it speaks
  // about the boxes on screen, not columns it does not draw. With a box per column
  // (LCM) those are exactly the asks `viewPlacesNotes` makes; the map is already
  // paid for, so this costs one pass over it.
  const placesNotes = React.useMemo(
    () => (model && boxes && toggleable ? boxesPlaceNotes(model.lanes, boxes, isCellOn, toggleable) : false),
    [model, boxes, toggleable],
  )

  // How long each note SOUNDS, per column (#1056). The grid drew one full box per
  // trigger and nothing at all for the columns a note carried on through, so
  // `bd _ sd ~` and `bd ~ sd ~` were the same picture — a length the parser reads
  // and the printer preserves that no user could see ([[PV245]]).
  //
  // Memoized alongside `toggleable` and for the same reason: `mutate` fires every
  // pointermove of a drag, so anything derived per cell is recomputed per frame
  // unless it hangs off the model ([[P380]] — where the comment claiming a per-cell
  // map was cheap predated any measurement, so this one carries the number).
  //
  // MEASURED over the 958 corpus models, same shape as that entry: p50 0.0006ms,
  // p99 0.0063ms, worst 0.0985ms — against the cell map's (then `placeable`, asking empty
  // cells only — #1836 added the lit ones) p99 2.25ms and worst
  // 13.10ms on the same run, i.e. 0.86% of its total. The carry loop breaks at the
  // next onset, so a lane costs one pass over its own cells however long the notes
  // are. It rides along with the expensive memo rather than adding a frame cost.
  const coverage = React.useMemo(
    () => (model ? model.lanes.map((lane) => laneCoverage(lane.cells, model.steps)) : null),
    [model],
  )

  // WHERE EACH STEP AS WRITTEN BEGINS, per `,`-part (#1841) — the parser's own regions
  // in drawn columns, so `bd [~ bd] sd ~` shows four steps over its eight columns. A
  // row draws its own part's lines; a part with no current regions draws none.
  const stepStarts = React.useMemo(() => {
    if (!model) return null
    const out = new Map<number, Set<number>>()
    // drawn from what the TEXT reads as — the kept model's source is the text before the edit
    for (const [part, cols] of writtenStepStarts(linesModel(model, read))) out.set(part, new Set(cols))
    return out
  }, [model, read])

  // EACH ROW AS ITS WRITTEN STEPS (#1861, Exact). A step spanning several boxes is drawn as
  // one: `hh*8` one step holding 8 small boxes, `bd` in `bd hh*2 sd cp` one box with faint
  // halves. Edges from the step lines above; plain-or-not from the part's coverage, never
  // the text. LCM draws every box on its own, as it always has.
  const stepGroups = React.useMemo(() => {
    if (!model || !boxes || !coverage) return null
    return model.lanes.map((lane, li) => {
      const part = lane.part ?? 0
      const starts = gridMode === 'exact' ? stepStarts?.get(part) : undefined
      const owners = model.lanes.flatMap((l, i) =>
        (l.part ?? 0) === part ? [(c: number) => coverage[i]?.[c]?.start] : [],
      )
      return groupBoxesBySteps(boxes[li], starts ? [...starts].sort((a, b) => a - b) : undefined, model.steps, owners)
    })
  }, [model, boxes, coverage, stepStarts, gridMode])

  // PROVE BEFORE OFFER, at the length handle (#1053) — the same rule the cell already
  // applies, asked of `resizeCell` itself so the handle cannot promise a drag the writer
  // declines. A note gets a handle exactly when SOME length other than its own is
  // admissible: one column longer, or one shorter. Both are asked, because the two
  // decline independently — a note with no room ahead can still be shortened, and a note
  // already at one column can only grow.
  //
  // Asked around the ROUNDED length, since that is the lattice the gesture moves on: a
  // drag sets a whole number of boxes (columns in LCM), and a sub-column note (`[hh ~]!16`
  // → 0.5) is offered the nearest whole lengths rather than a fraction it could not be
  // dragged to (`boxLengths`).
  //
  // Keyed by the note's HEAD column, so a two-column note asks once rather than once per
  // column it covers. Memoized on the model beside `toggleable`/`coverage` and for the
  // same reason ([[P380]]): `mutate` fires every pointermove, so anything derived per
  // cell is recomputed per frame unless it hangs off the model.
  //
  // MEASURED over the 966 corpus models, because [[P380]] is precisely the entry where a
  // comment called a per-cell map cheap before anyone had timed one: p50 0.0022ms, p99
  // 0.357ms, worst 1.26ms — against the cell map's (then `placeable`) p50 0.0047ms, p99 2.54ms, worst 14.4ms
  // on the same run, i.e. **16.1% of its total**. It costs less than the map beside it
  // despite serializing, because it asks once per NOTE while that map then asked once per
  // EMPTY cell, and grids have far more of those.
  //
  // In Exact the neighbours are one BOX away (#1855): on a factor-2 row ±1 column is half a
  // step, which the writer declines both ways, so `~ sd ~ sd, hh*8` offered no handle at all
  // while a snare two steps long was writable.
  const resizable = React.useMemo(() => {
    if (!model) return null
    return model.lanes.map((lane, li) => {
      const out = new Set<number>()
      const w = boxes?.[li]?.[0]?.width ?? 1
      lane.cells.forEach((c, si) => {
        if (!isCellOn(c)) return
        const { longer, shorter } = boxLengths(c.duration, w)
        if (canResizeCell(model, li, si, longer) || (shorter !== null && canResizeCell(model, li, si, shorter))) out.add(si)
      })
      return out
    })
  }, [model, boxes])

  // Returns whether the writer REFUSED the toggle — `toggleCell` handing back the
  // model it was given — as distinct from a cell already in the asked state, which
  // is no refusal. The caller decides whether to say so: a single press or key does
  // (`paintOne`), a paint drag brushing across inert cells does not.
  //
  // A hit is painted one box long: one column in LCM, one of the part's own steps in
  // Exact (#1855) — the step the user sees and clicked.
  const paintCell = React.useCallback(
    (laneIndex: number, stepIndex: number, value: boolean): boolean => {
      let refused = false
      const length = boxWidth(laneIndex)
      mutate((prev) => {
        const lane = prev.lanes[laneIndex]
        if (!lane || stepIndex >= lane.cells.length || isCellOn(lane.cells[stepIndex]) === value) {
          return prev // no change → useGridModel skips the write
        }
        const next = toggleCell(prev, laneIndex, stepIndex, value, length)
        refused = next === prev
        return next
      })
      return refused
    },
    [mutate],
  )
  /** One deliberate toggle — a press or a key — which says so when it is refused. */
  const paintOne = React.useCallback(
    (laneIndex: number, stepIndex: number, value: boolean): void => {
      if (paintCell(laneIndex, stepIndex, value)) {
        reportRefusal(value ? "Couldn't add that hit" : "Couldn't remove that hit")
      }
    },
    [paintCell],
  )

  // Add a new drum voice (#516). The new lane is all-rest, so it stages in the
  // model and only writes to the source on the first hit (useGridModel keeps it
  // because serialize is unchanged). Remove drops the voice from the pattern.
  const addVoice = React.useCallback(
    (sound: string): void => {
      mutate((prev) => addLane(prev, sound))
    },
    [mutate],
  )
  const removeVoice = React.useCallback(
    (sound: string): void => {
      mutate((prev) => removeLane(prev, sound))
    },
    [mutate],
  )

  // PROVE, DON'T PREDICT: does the parser actually draw this pattern at `scale`?
  // Asked of `parseStepGrid` itself, because four projections refuse a finer view
  // (#1117) and an offer made on arithmetic alone is how a control ends up
  // clickable and inert — the defect #1010 P4c had to repair once already.
  // Memoized per mini: the control asks once per preset per render, and a real
  // parse per ask is a per-gesture cost charged at a per-frame rate.
  const canDrawView = useViewProver(chunk?.miniString, stepGridCodec.parse)

  // Grid resolution (#479, #1057): a target in the free zone changes only how
  // finely we DRAW — the document is left byte-identical. Everything else keeps
  // today's behaviour: lossless ×2/÷2 when the ratio allows, else quantize the
  // hits onto the new grid, with a no-op target returning the same model so
  // `useGridModel` skips the write.
  //
  // The verdict comes from `slotPress`, which asks `stepSlotState` — the SAME call that renders the
  // button — so a target cannot be drawn as a view change and then written, or
  // shown as a write and then silently absorbed. One authority, asked twice.
  const scaleToSlots = React.useCallback(
    (target: number): void => {
      if (!model) return
      const press = slotPress(stepGridCodec, model, target, canDrawView)
      if (press.kind === 'view') setViewScale(press.scale)
      else if (press.kind === 'write') mutate((prev) => stepGridCodec.quantizeTo(prev, target))
    },
    [model, canDrawView, mutate],
  )

  // The "Slots" control now lives in the Pattern inspector (#601) — lift this
  // grid's resolution state to it instead of rendering it in the grid header.
  useLiftResolution(
    model?.steps ?? null,
    (t) => (model ? stepGridCodec.slotState(model, t, canDrawView) : 'disabled'),
    scaleToSlots,
    onResolution,
    // #1061 — what the press would COST, asked of the very op `scaleToSlots` runs, so
    // the sentence in the tooltip and the write the user gets are the same computation.
    // A free-zone target never reaches the op, and reports nothing, which is correct:
    // looking closer costs nothing.
    (t) => (model ? slotPressCost(stepGridCodec, model, t, canDrawView) : NO_RESOLUTION_EFFECT),
  )

  React.useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const g = gestureRef.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (g.mode === 'pending') {
        if (gainScoped && Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'velocity'
        } else if (Math.abs(dx) > DRAG_THRESHOLD) {
          g.mode = 'paint'
          paintOne(g.lane, g.step, g.paintValue) // toggle the start cell off
          return
        } else {
          return
        }
      }
      if (g.mode === 'velocity') {
        // drag DOWN (positive dy) softens; up to a full-1 ceiling, down to 0.
        const next = clamp01(g.startGain - dy / VELOCITY_FULL_PX)
        mutate((prev) => setColumnGain(prev, g.step, next))
      }
    }
    const onUp = (): void => {
      const g = gestureRef.current
      if (!g) return
      gestureRef.current = null
      // a plain click on an ON cell with NO drag → toggle it OFF (click-toggle:
      // click empty turns a step on, click it again turns it off). A vertical/
      // horizontal drag already ran as velocity / paint-off and left mode !=
      // 'pending'.
      if (g.mode === 'pending') paintOne(g.lane, g.step, false)
      endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [mutate, paintOne, endGesture, gainScoped])

  const onCellDown = (laneIndex: number, stepIndex: number, current: boolean, e: React.PointerEvent): void => {
    beginGesture()
    if (current) {
      // an ON cell starts PENDING: a vertical drag becomes velocity, a horizontal
      // drag paint-off, and a release with no drag toggles it OFF (onUp). Direct
      // edit — no selection.
      gestureRef.current = {
        lane: laneIndex,
        step: stepIndex,
        startX: e.clientX,
        startY: e.clientY,
        startGain: model?.gains?.[stepIndex] ?? 1,
        mode: 'pending',
        paintValue: false,
      }
    } else {
      // empty cell → paint on immediately, then keep painting on enter
      gestureRef.current = {
        lane: laneIndex,
        step: stepIndex,
        startX: e.clientX,
        startY: e.clientY,
        startGain: 1,
        mode: 'paint',
        paintValue: true,
      }
      paintOne(laneIndex, stepIndex, true)
    }
  }

  // Grab a note's trailing handle → set its length. Anchored at the note's own start
  // column, so the column the pointer reaches IS the new length and the drag never
  // accumulates: every pointermove re-applies an ABSOLUTE duration to the same note.
  const onResizeDown = (laneIndex: number, startCol: number): void => {
    beginGesture()
    gestureRef.current = {
      lane: laneIndex,
      step: startCol,
      startX: 0,
      startY: 0,
      startGain: 1,
      mode: 'resize',
      paintValue: false,
    }
  }

  const onCellEnter = (laneIndex: number, stepIndex: number, width: number): void => {
    const g = gestureRef.current
    if (!g) return
    if (g.mode === 'resize') {
      // The LANE the pointer wanders into is ignored, exactly as the roll ignores the
      // row: a resize is a horizontal gesture and a few px of vertical drift should not
      // silently retarget it. `resizeCell` floors at one column and `clampLane` caps at
      // the room the note has, so a drag back past the note's own start, or forward past
      // the next hit, lands on the shortest/longest length rather than doing nothing.
      // the pointer's box ends the note: its last column, however wide the box is
      mutate((prev) => resizeCell(prev, g.lane, g.step, stepIndex + width - g.step))
      return
    }
    if (g.mode !== 'paint') return
    paintCell(laneIndex, stepIndex, g.paintValue)
  }

  // THE CURSOR (#1802): a (lane, step) the arrow keys move and the keys act on.
  // A press on a cell moves it there too. Local to the grid — the sequencer has no
  // selection for anything else to share.
  const [cursor, setCursor] = React.useState<GridCell | null>(null)
  const rowsN = model?.lanes.length ?? 0
  const colsN = model?.steps ?? 0
  /** The cursor, when it is still on the grid (a voice can be removed under it). */
  const liveCursor = cursor && cursor.row < rowsN && cursor.col < colsN ? cursor : null
  const cursorRef = React.useRef(liveCursor)
  cursorRef.current = liveCursor

  // The cursor belongs to the pattern it was placed on, like the Piano Roll's
  // selection (PatternPanel). Keyed on the STATEMENT, not `patternKey` — that one
  // changes on any edit typed in the code, and that must not throw the cursor away.
  const stmtId = chunk ? chunk.statementRange[0] : null
  const stmtRef = React.useRef<number | null>(stmtId)
  React.useEffect(() => {
    if (stmtRef.current !== stmtId) {
      stmtRef.current = stmtId
      setCursor(null)
    }
  }, [stmtId])

  // Set when a key moved the cursor, so the render that draws it also focuses it.
  const focusCursorRef = React.useRef(false)
  const gridRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!focusCursorRef.current) return
    focusCursorRef.current = false
    gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"] > [data-seq-cell]')?.focus()
  })

  // One edit, bracketed the way the click brackets it — one undo step, one re-eval.
  const paintByKey = (laneIndex: number, stepIndex: number, value: boolean): void => {
    beginGesture()
    paintOne(laneIndex, stepIndex, value)
    endGesture()
  }

  // ⌥⇧← / ⌥⇧→ set the length of the hit under the cursor, a box at a time (#1803, #1855)
  // — what the handle does, through the same `resizeCell`, on the note sounding
  // through the cursor's column (its head, when the cursor sits on a held column).
  // The sequencer has no move: every other note edit is declined here.
  const resizeByKey = (at: GridCell, action: GridAction, dryRun: boolean): boolean => {
    if (!model || (action !== 'shorter' && action !== 'longer')) return false
    const cells = model.lanes[at.row]?.cells ?? []
    let head = -1
    for (let si = at.col; si >= 0; si--) {
      const c = cells[si]
      if (isCellOn(c)) {
        if (si + Math.ceil(c.duration) > at.col) head = si
        break
      }
    }
    if (head < 0) return false
    const c = cells[head]
    if (!isCellOn(c)) return false
    const { longer, shorter } = boxLengths(c.duration, boxWidth(at.row))
    const dur = action === 'longer' ? longer : shorter
    if (dur === null || !canResizeCell(model, at.row, head, dur)) return false
    if (!dryRun) {
      beginGesture()
      mutate((prev) => resizeCell(prev, at.row, head, dur))
      endGesture()
      focusCursorRef.current = true
      setCursor({ row: at.row, col: head })
    }
    return true
  }

  // A key on a cell whose toggle is refused (#1836). The pointer is told before it
  // presses — the cell is inert and titled — but a key user never sees a title, and
  // the handler has already swallowed the key, so without this the key does nothing
  // and says nothing: the very bug, one input device over. A dry run (the palette
  // asking whether the command applies) stays quiet and just answers no.
  const refuseKey = (on: boolean, dryRun: boolean): false => {
    if (!dryRun) reportRefusal(on ? "Couldn't remove that hit" : "Couldn't add that hit")
    return false
  }

  // The sequencer's keys (#1802), through the same command path as the roll's
  // (#1801). `fromKey`: a key on the grid's tab stop before any cursor exists
  // acts on that cell (the top-left); the palette, with no cursor, acts nowhere.
  const runGesture = (action: GridAction, dryRun: boolean, fromKey = false): boolean => {
    if (!model || rowsN === 0 || colsN === 0) return false
    const at = cursorRef.current ?? (fromKey ? { row: 0, col: 0 } : null)
    // A look-only view (#1975) can be walked, and nothing else: an edit key is not
    // offered, rather than run and refused with a console line on every press.
    if (model.lookOnly && !isCursorMove(action)) return false
    if (isCursorMove(action)) {
      if (dryRun) return true
      focusCursorRef.current = true
      // ←/→ step over a whole box; ↑/↓ land on the box playing at the same moment (#1855)
      setCursor(moveBoxCursor(at ?? { row: 0, col: 0 }, action, rowsN, colsN, boxWidth))
      return true
    }
    if (!at) return false
    if (isNoteEdit(action)) return resizeByKey(at, action, dryRun)
    // a key acts on the box the cursor is in, at its first column — what a click on it does
    const boxW = boxWidth(at.row)
    const col = at.col - (at.col % boxW)
    const cell = model.lanes[at.row]?.cells[col]
    const on = cell !== undefined && isCellOn(cell)
    switch (action) {
      case 'toggle':
        // Exactly what a click does: the cell flips where the writer takes it
        // (`toggleable`, the same gate that makes the cell inert to the pointer —
        // an ON cell included, #1836); a column a note sounds through is inert.
        if (!(toggleable?.[at.row]?.[col] ?? false)) return refuseKey(on, dryRun)
        if (!dryRun) {
          if (!cursorRef.current) setCursor(at)
          paintByKey(at.row, col, !on)
        }
        return true
      case 'remove':
        if (!on) return false // nothing under the cursor: nothing asked, nothing to say
        if (!(toggleable?.[at.row]?.[col] ?? false)) return refuseKey(on, dryRun)
        if (!dryRun) paintByKey(at.row, col, false)
        return true
      default:
        return false
    }
  }
  const runGestureRef = React.useRef(runGesture)
  runGestureRef.current = runGesture
  React.useEffect(
    () => mountGridGestures(GRID_SCOPE.sequencer, (action, dryRun) => runGestureRef.current(action, dryRun)),
    [],
  )

  // labels that would run together on narrow steps are hidden, bar numbers first (#1843).
  // Above the no-model return: a hook runs on every render or not at all.
  const rulerRef = React.useRef<HTMLDivElement>(null)
  useRulerFit(rulerRef, 'data-seq-ruler-label')
  // On a phone (#2006): steps a finger can hit, the ruler as the sideways scroll
  // handle, and row names that stay put. See `phoneGrid`.
  const phoneGrid = usePhoneGrid()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const rulerPan = useRulerPan(scrollRef, phoneGrid.phone)
  /** a step's narrowest width per unit of weight */
  const stepMin = phoneGrid.phone ? PHONE_STEP_MIN : 16
  /** what keeps a row's name in place while its steps scroll under it */
  const pinned: React.CSSProperties = phoneGrid.phone
    ? { position: 'sticky', left: 0, zIndex: 2, background: 'var(--background, #0f0f12)' }
    : {}

  if (!model) {
    return React.createElement(VisualEditStandby, {
      panel: SEQUENCER_TAB_ID,
      hint: chunk && opensStepGrid(chunk)
        ? "This pattern isn't grid-editable — edit it as code."
        : SEQ_HINT,
      icon: 'symbol-array',
    })
  }

  // Each bar may hold its own count of cells (#1827) — the roll's `drawnLayout`, so the
  // two grids agree on where bars start and how wide a cell is.
  const layout = drawnLayout(model, model.steps)
  // What the MODEL says about itself (#1975). The cells below already grey themselves
  // out — each asks the op whether it could toggle, and every op declines — so this
  // only adds the sentence and takes away the controls that are not cells.
  const lookOnly = model.lookOnly ?? null
  const tabCell = liveCursor ?? { row: 0, col: 0 }
  // The ruler counts the steps of the row you're on — the first row until a cursor
  // exists — because rows from different `,`-parts can split a bar differently (#1841).
  const rulerPart = model.lanes[liveCursor?.row ?? 0]?.part ?? 0
  const ruler = rulerLabels(model, model.steps, [...(stepStarts?.get(rulerPart) ?? [])])

  return (
    <div
      ref={scrollRef}
      // Cell pointerdowns call preventDefault (blocks default focus), so focus the
      // pressed cell in the capture phase — the cursor moves there (#1802).
      onPointerDownCapture={(e) => {
        ;(e.target as HTMLElement).closest<HTMLElement>('[data-seq-cell]')?.focus({ preventScroll: true })
      }}
      onKeyDown={(e) => {
        // Only from a cell: Enter on "remove voice", or a key in the voice menu or
        // the track chip, is that control's own.
        if (!(e.target as HTMLElement).closest?.('[data-seq-cell]')) return
        // Matched exactly against the keys the host has bound (#1801, #1802).
        const action = matchGridKey(GRID_SCOPE.sequencer, e.nativeEvent)
        if (!action) return
        e.preventDefault()
        e.stopPropagation()
        runGesture(action, false, true)
      }}
      data-bottom-panel-tab="sequencer"
      data-look-only={lookOnly ? lookOnly.gate : undefined}
      // always-visible (non-overlay) scrollbar when the grid overflows the panel,
      // styled in globals.css (the editor ships no CSS) — #pattern-scrollbar.
      data-pattern-scroll
      style={{
        // on a phone there is no padding on the left: a pinned row name sticks at the
        // edge of the padding, and steps scrolling past would show in the gap beside it
        padding: phoneGrid.phone ? '16px 16px 16px 0' : 16,
        height: '100%',
        overflow: 'auto',
        outline: 'none',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        touchAction: 'none',
      }}
    >
      {/* paddingRight: room for the `+` past the last column (#1824) */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, width: '100%', paddingRight: 28, boxSizing: 'border-box', ...(phoneGrid.phone ? PHONE_GRID_WIDTH : {}) }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 4,
            // on a phone this line is the panel's width and stays put while the steps
            // scroll. (44: the panel's 16 px on the right and this box's own 28 — a line
            // any wider would itself make the grid wider than the screen.)
            ...(phoneGrid.phone
              ? { justifyContent: 'flex-start', position: 'sticky', left: 0, width: Math.max(0, rulerPan.viewWidth - 44), paddingLeft: 16, boxSizing: 'border-box' }
              : {}),
          }}
        >
          {/* Track identity (#589) — the bound track's colour dot + name; click
              the dot to recolour, double-click the name to rename. */}
          {/* "Slots" moved to the Pattern inspector (#601); the Note Color toggle
              moved to the editor Settings tab (#602). Both are lifted/owned
              elsewhere now — the header just carries the track identity chip. */}
          <PatternTrackChip />
          <TurnHint show={phoneGrid.upright && rulerPan.inView.more} />
        </div>
        {/* ONE statement for a view that cannot take a new note, rather than a
            grid of dead cells with no reason on them (#1070). The notes that are
            here still edit, delete and take velocity — which is what this view
            was opened for. */}
        {/* THE LANES ARE CHORD SYMBOLS, AND NOTHING ELSE HERE SAYS SO (#1241).
            Every other affordance in this panel reads as a drum machine — that is
            what a step grid has always been — so a musician who wrote a chord
            chart is looking at one and has no way to tell it understood. The
            edits are already correct; a delete on a chord lane removes that
            chord. This is the sentence that was missing, not a new capability. */}
        {isChordChart && (
          <div
            data-seq-chord-chart
            style={{
              fontSize: 11,
              color: 'var(--foreground-muted, #a0a0aa)',
              paddingBottom: 2,
            }}
          >
            Chord chart — each lane is a chord, not a sound.
            {/* #2120: the rhythm these chords play to is a line of its own */}
            {chunk?.chain.some(opensRhythmLine) &&
              ' They play to the rhythm in .struct(…): click into a rhythm line to see them on it and edit it.'}
          </div>
        )}
        {playedNotes && (
          <div data-seq-sound-first style={{ fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)', paddingBottom: 2 }}>
            The sounds set the rhythm here: each step plays the note written where it starts
            {playedNotes.unheard.length > 0 ? `, so ${listOf(playedNotes.unheard)} never ${playedNotes.unheard.length === 1 ? 'plays' : 'play'}.` : '.'}
          </div>
        )}
        {notice && (
          <div data-seq-notice style={{ fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)', paddingBottom: 2 }}>
            {notice}
          </div>
        )}
        {lookOnly && (
          <div
            data-seq-look-only
            style={{
              fontSize: 11,
              color: 'var(--foreground-muted, #a0a0aa)',
              paddingBottom: 2,
            }}
          >
            {lookOnlyLine(lookOnly)}
          </div>
        )}
        {!placesNotes && !lookOnly && (
          <div
            data-seq-no-placement
            style={{
              fontSize: 11,
              color: 'var(--foreground-muted, #a0a0aa)',
              paddingBottom: 2,
            }}
          >
            Edits the notes already here — to add one, use the code view.
          </div>
        )}
        {/* The voices are the grid (#1802, ARIA grid pattern): a row per voice, a
            gridcell per step, one tab stop that moves with the cursor. */}
        <div ref={gridRef} role="grid" aria-label="Step sequencer" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* THE RULER (#1841): counts the written steps of the cursor's row, `1, 1.2, …, 2`.
            Laid out exactly like a row — the header's width, the same weights and bar
            gaps — so each label sits over its own column. Visual only: hidden from the
            accessibility tree, where every cell already names its step. */}
        {phoneGrid.phone && (
          // which part of the pattern is on screen. It sits over the top of the ruler
          // and stays put while the ruler's numbers scroll under it; its width is the
          // panel's, not the pattern's.
          // (104: past the row names' column and its gap, which is pinned over this row)
          <div style={{ position: 'sticky', left: 104, width: 0, height: 0, marginBottom: -4 }}>
            <InViewBar inView={rulerPan.inView} width={rulerPan.viewWidth - 16 - 104} />
          </div>
        )}
        <div
          ref={rulerRef}
          data-seq-ruler
          aria-hidden="true"
          {...rulerPan.handlers}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            height: phoneGrid.phone ? PHONE_RULER_HEIGHT : 12,
            ...(phoneGrid.phone ? { touchAction: 'none', cursor: 'grab' } : {}),
          }}
        >
          <div style={{ width: 96, flex: '0 0 auto', alignSelf: 'stretch', ...pinned }} />
          <div style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}>
            {Array.from({ length: model.steps }, (_, c) => {
              const label = ruler.get(c)
              const isBar = label !== undefined && !label.includes('.')
              return (
                <div
                  key={c}
                  // the ExtendHandle measures the last COLUMN here: in Exact a row's last box
                  // can start several columns before the end, so no cell names that column
                  data-seq-col={`ruler:${c}`}
                  style={{
                    flex: `${layout.weight(c)} ${layout.weight(c)} 0`,
                    minWidth: stepMin * layout.weight(c),
                    maxWidth: 56 * layout.weight(c),
                    marginLeft: layout.barStart(c) ? 8 : 0,
                    position: 'relative',
                    height: '100%',
                  }}
                >
                  {label !== undefined && (
                    <span
                      data-seq-ruler-label={c}
                      data-ruler-bar={isBar ? '' : undefined}
                      style={{
                        position: 'absolute',
                        left: 0,
                        bottom: 0,
                        fontSize: 9,
                        lineHeight: '10px',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: isBar ? 600 : 400,
                        color: isBar ? 'var(--foreground, #e6e6ea)' : 'var(--foreground-muted, #a0a0aa)',
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {model.lanes.map((lane, laneIndex) => {
          const voice = sampleVoice(lane.sound)
          return (
          <div
            key={`${lane.sound}:${lane.part ?? 0}`}
            role="row"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {/* The voice's name and its remove button are the row's header. */}
            <div role="rowheader" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', alignSelf: 'stretch', ...pinned }}>
            {/* Per-voice label only — the colour dot was removed (#589); the track's
                identity colour lives in the PatternTrackChip up top, so a separate
                drumVoices palette here would read as a second, conflicting colour code. */}
            <span
              data-seq-voice={lane.sound}
              style={{
                width: 72,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                fontSize: 11,
                color: 'var(--foreground, #e6e6ea)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
              title={lane.sound}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.label}</span>
            </span>
            {/* a look-only view removes nothing; the space stays so rows keep their ruler */}
            {lookOnly ? <span style={{ width: 16, flex: '0 0 auto' }} /> : (
            <button
              type="button"
              aria-label={`remove ${lane.sound}`}
              data-seq-remove-voice={lane.sound}
              title={`Remove ${lane.sound}`}
              onClick={() => removeVoice(lane.sound)}
              style={{
                width: 16,
                height: 16,
                flex: '0 0 auto',
                padding: 0,
                lineHeight: '14px',
                fontSize: 12,
                borderRadius: 3,
                border: '1px solid var(--border, #3a3a42)',
                background: 'transparent',
                color: 'var(--foreground-muted, #a0a0aa)',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
            )}
            </div>
            <div role="none" style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}>
              {(stepGroups?.[laneIndex] ?? []).map((g) => {
                // ONE BOX — `solo` as it has always been drawn; `inner` a small box inside a
                // step that holds several (#1861); `plain` one column of a step drawn as a
                // single box, its gaps showing as faint halves.
                const cellFor = (
                  { start: stepIndex, width: w }: { start: number; width: number },
                  variant: 'solo' | 'inner' | 'plain',
                  /** a plain step's first/last column carries the step's rounded corner */
                  ends: { first: boolean; last: boolean } = { first: true, last: true },
                ) => {
                // ONE BOX, `w` columns from `stepIndex` (#1855): a column in LCM, one of
                // the part's own steps in Exact. Everything below reads the box's first
                // column — a box only exists where no hit starts inside it (`rowBoxes`).
                const cell = lane.cells[stepIndex]
                // A cell is drawn from the note SOUNDING through it, not from the
                // trigger alone (#1056): `cov.extent` is how much of this column
                // the note fills, so a half-column note draws a half-width bar and
                // a two-column note lights both. `on` stays the trigger — it is
                // what the ops, `aria-pressed` and the velocity gesture mean.
                const on = isCellOn(cell)
                const cov = coverage?.[laneIndex]?.[stepIndex]
                /** this column is carried by a note that began earlier in the lane */
                const held = cov !== undefined && cov.start !== stepIndex
                // THE LAST COLUMN THIS NOTE COVERS, read off the same array that draws
                // it rather than recomputed from `start + duration` (#1053). The two
                // would agree only while every model is a `clampLane` fixpoint, and the
                // drawing is the thing the handle must sit on the end of — so it is the
                // drawing that has to be asked. `undefined` past the lane end is not the
                // same note, which is what makes the final column a tail.
                const isTail =
                  cov !== undefined && coverage?.[laneIndex]?.[stepIndex + w]?.start !== cov.start
                // how much of the BOX the note fills: its columns' shares, over the box width
                let extent = cov?.extent ?? 0
                if (cov && w > 1) {
                  extent = 0
                  for (let c = stepIndex; c < stepIndex + w; c++) {
                    const k = coverage?.[laneIndex]?.[c]
                    if (k && k.start === cov.start) extent += k.extent
                  }
                  extent /= w
                }
                /** the note's own start column, when this cell carries an offerable handle */
                const resizeStart =
                  cov !== undefined && isTail && resizable?.[laneIndex]?.has(cov.start)
                    ? cov.start
                    : null
                // A held column shows the HEAD's velocity, not its own: the grid's
                // gains are per column and a column with no trigger has none, so
                // reading `stepIndex` would make a long note jump to full height
                // halfway through. Same rule the roll's velocity lane already uses.
                const gain = model.gains?.[cov ? cov.start : stepIndex] ?? 1
                const isPlaying = playingStep !== null && playingStep >= stepIndex && playingStep < stepIndex + w
                // A cell is offered only where the writer will take its toggle.
                // Where it will not, the cell is inert AND says so, instead of
                // swallowing the click the way it did before (#1064/#1070) — for a
                // lit cell's erase too (#1836).
                const canToggle = toggleable?.[laneIndex]?.[stepIndex] ?? true
                // the note this step plays, on a sound-first line (#2226): `c / e` when it changes by pass
                const playsNote =
                  on && !held && playedNotes
                    ? playedNotes.notes.get(stepNoteKey(lane.sound, stepToCycle(stepIndex, model.steps, span, model.barSteps)))?.join(' / ') ?? null
                    : null
                const inBox = (c: number): boolean => c >= stepIndex && c < stepIndex + w
                const isCursor = liveCursor?.row === laneIndex && inBox(liveCursor.col)
                const isTab = tabCell.row === laneIndex && inBox(tabCell.col)
                // a box is as wide as its columns AND the 2px gaps between them, so its
                // edges fall on the columns of the rows drawn one box per column
                let weight = 0
                for (let c = stepIndex; c < stepIndex + w; c++) weight += layout.weight(c)
                const gaps = 2 * (w - 1)
                /** the step number a person reads: the box's, counted in this row */
                const stepNo = (c: number): number => Math.floor(c / w) + 1
                // A written step begins here, and it is not a bar line (those keep their gap)
                const stepStart =
                  stepIndex > 0 && !layout.barStart(stepIndex) && !!stepStarts?.get(lane.part ?? 0)?.has(stepIndex)
                return (
                  // A gridcell holding one toggle button — `aria-pressed` stays on the
                  // button, which may carry it; the cursor is the cell's `aria-selected`.
                  <div
                    key={stepIndex}
                    role="gridcell"
                    aria-selected={isCursor}
                    data-seq-step-start={variant === 'solo' && stepStart ? 'true' : undefined}
                    style={{
                      display: 'flex',
                      flex: `${weight} ${weight} ${gaps}px`,
                      minWidth: stepMin * weight + gaps,
                      maxWidth: 56 * weight + gaps,
                      // subtle gap at each bar boundary
                      marginLeft: variant === 'solo' && layout.barStart(stepIndex) ? 8 : 0,
                      // THREE LINE WEIGHTS (#1841): a bar is the 8px gap above; a written
                      // step fills the 2px gap before it with a line; a plain column
                      // leaves that gap empty. Drawn as a shadow INTO the gap rather than
                      // as extra width, because rows of different parts start steps at
                      // different columns and a real gap would push their columns apart.
                      boxShadow: variant === 'solo' && stepStart ? '-2px 0 0 0 var(--foreground-muted, #6a6a90)' : undefined,
                    }}
                  >
                  <button
                    type="button"
                    // One tab stop for the whole grid, and it moves with the cursor.
                    tabIndex={isTab ? 0 : -1}
                    // Focus IS the cursor (ARIA grid pattern).
                    onFocus={() => {
                      if (!isCursor) setCursor({ row: laneIndex, col: stepIndex })
                    }}
                    aria-pressed={on}
                    // A carried column now LOOKS different and has to READ different:
                    // the fill says "a note is sounding through here" to anyone who can
                    // see it, and without this the accessible name is identical to an
                    // empty cell's. Making the picture richer is what opened the gap.
                    aria-label={
                      held
                        ? `${lane.sound} step ${stepNo(stepIndex)}, held from step ${stepNo(cov!.start)}`
                        : `${lane.sound} step ${stepNo(stepIndex)}${playsNote ? `, plays ${playsNote}` : ''}`
                    }
                    data-seq-step-note={playsNote ?? undefined}
                    data-seq-cell={`${laneIndex}:${stepIndex}`}
                    data-seq-box-width={w > 1 ? w : undefined}
                    data-gain={on && gainScoped ? gain : undefined}
                    data-playing={isPlaying ? 'true' : undefined}
                    data-seq-cell-inert={canToggle ? undefined : 'true'}
                    aria-disabled={canToggle ? undefined : true}
                    // WHY THIS CELL IS INERT, and the two reasons are not
                    // interchangeable. On the element and alt paths every
                    // remaining refusal is part-relative — a sound sustaining
                    // through the clicked column, which the corpus gate pins at
                    // 31 of 11,633, all on `,`-stacked units. On a leaf grid the
                    // reason is never that: the column simply has no span to
                    // write through.
                    //
                    // ⚠ SO IT CANNOT KEY ON `placesNotes` ANY MORE (#1154). That
                    // used to be the same question as "is this leaf-anchored?";
                    // now 17 leaf units place a note somewhere, and keying the
                    // wording on the view-level answer told ~950 of their refused
                    // cells that a sound was sustaining through them when none
                    // was. The affordance is decided by the op; only the sentence
                    // is decided here, and it reads the path because the path is
                    // what makes the two reasons different.
                    //
                    // A LIT cell's reason is its own (#1836): on a leaf grid a hit
                    // whose text plays in more than one box has no replacement that
                    // removes only this box — all 285 refused erases in the corpus.
                    title={
                      lookOnly
                        ? lookOnlyLine(lookOnly)
                        : canToggle
                        ? playsNote ? `${lane.sound} plays ${playsNote}` : undefined
                        : on
                          ? model.leafSource
                            ? 'This hit comes from text that plays in more than one box here — remove it in the code view.'
                            : 'Removing this hit would change the pattern in other places too — the grid has no way to write that.'
                          : model.leafSource
                            ? 'This pattern edits its existing notes — add steps in the code view.'
                            : 'Adding a step here would change how long another sound plays — the grid has no way to write that.'
                    }
                    onPointerDown={(e) => {
                      e.preventDefault()
                      setCursor({ row: laneIndex, col: stepIndex })
                      // RESIZE INTENT IS DECIDED FIRST, and before the placement guard.
                      // The grab zone runs inward from the BAR's trailing edge, which on
                      // a held note is a column the placement gate has already made inert
                      // (a hit cannot be painted under a sustain) — so a `!canToggle`
                      // return above this would leave every note longer than one column
                      // with a handle that is drawn and cannot be pressed.
                      //
                      // Zone geometry mirrors the roll's (#1078): proportional to the BAR
                      // so a short note still gets a zone on the thing it resizes, floored
                      // so a 2px bar stays aimable, and capped against the CELL so it can
                      // never swallow more of the cell than the gestures it shares with.
                      // A grid note always begins AT its column, so the bar's trailing
                      // edge is simply its extent — the roll's `offset` term is 0 here.
                      if (resizeStart !== null) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const barW = clamp01(extent) * rect.width
                        const zone = Math.min(rect.width * 0.45, Math.max(RESIZE_ZONE_PX, barW * 0.4))
                        if (e.clientX - rect.left >= barW - zone) {
                          onResizeDown(laneIndex, resizeStart)
                          return
                        }
                      }
                      if (!canToggle) return
                      onCellDown(laneIndex, stepIndex, on, e)
                    }}
                    onPointerEnter={() => onCellEnter(laneIndex, stepIndex, w)}
                    style={{
                      position: 'relative',
                      width: '100%',
                      // a small box inside a step that holds several, as the design draws it
                      height: variant === 'inner' ? 14 : 22,
                      alignSelf: 'center',
                      padding: 0,
                      overflow: 'hidden',
                      border:
                        variant === 'plain'
                          ? 'none'
                          : isPlaying
                            ? '1px solid var(--foreground, #e6e6ea)'
                            : '1px solid var(--border, #3a3a42)',
                      borderRadius:
                        variant === 'plain'
                          ? `${ends.first ? 3 : 0}px ${ends.last ? 3 : 0}px ${ends.last ? 3 : 0}px ${ends.first ? 3 : 0}px`
                          : variant === 'inner'
                            ? 2
                            : 3,
                      background: isPlaying
                        ? 'var(--background, #34343c)'
                        : 'var(--background-elevated, #26262c)',
                      cursor: !canToggle ? 'default' : gainScoped && on ? 'ns-resize' : 'pointer',
                    }}
                  >
                    {cov && (
                      // Two orthogonal axes on one bar, which is how a DAW draws a
                      // note: WIDTH is how much of this column the note sounds for
                      // (#1056), HEIGHT is velocity, bottom-anchored and full when
                      // neutral — so a length-1 note at neutral gain is the same
                      // solid square it has always been. The hue is the voice
                      // colour (#471), or a velocity ramp when View ▸ Note Color =
                      // Velocity (#428).
                      //
                      // A carried column is dimmed rather than drawn solid, the
                      // vocabulary the piano roll already ships for the same fact
                      // (`opacity: on && !isHead ? 0.7 : 1`) — one held note reads
                      // as one note, and never as a second trigger.
                      <span
                        data-seq-fill
                        data-seq-sustain={held ? 'true' : undefined}
                        data-seq-extent={extent !== 1 ? extent.toFixed(4) : undefined}
                        style={{
                          position: 'absolute',
                          left: 0,
                          bottom: 0,
                          // `minWidth` is a floor on the PIXEL, not on the datum: a
                          // note whose length rounds to nothing still has to be
                          // visible, or the grid would silently lose a trigger it
                          // can spell.
                          width: `${clamp01(extent) * 100}%`,
                          minWidth: held ? 0 : 2,
                          height: `${clamp01(gainScoped ? gain : 1) * 100}%`,
                          background:
                            colorMode === 'velocity'
                              ? velocityColor(gainScoped ? gain : 1)
                              : voice.color,
                          // one plain step is one note: its columns are not a second trigger
                          opacity: held && variant !== 'plain' ? 0.7 : 1,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    {playsNote && (
                      <span
                        data-seq-step-note-label
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 3,
                          fontSize: 9,
                          lineHeight: 1,
                          color: 'var(--background, #1c1c22)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          pointerEvents: 'none',
                        }}
                      >
                        {playsNote}
                      </span>
                    )}
                    {variant === 'plain' && isPlaying && (
                      // A plain step's columns draw no border, so the playing column is marked by
                      // a frame drawn over its fill — the note is an absolutely placed child and
                      // would paint over the button's own outline.
                      <span
                        data-seq-playing-frame
                        style={{
                          position: 'absolute',
                          inset: 0,
                          border: '1px solid var(--foreground, #e6e6ea)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    {resizeStart !== null && (
                      // THE LENGTH HANDLE (#1053) — the axis #1056 made visible, made
                      // settable. Same shape as the roll's, because this is the same
                      // gesture on the other surface and the issue asks the two to agree.
                      //
                      // It sits at the BAR's trailing edge rather than the cell's, so a
                      // note that stops mid-column carries its handle on its own end
                      // instead of floating in the empty background past it. Width is
                      // clamped to the bar for the same reason the roll clamps it: a
                      // handle wider than the note would overhang backwards past the
                      // note's own start. What that costs a very short note — a very
                      // small handle — is paid back by the invisible grab zone above.
                      //
                      // RENDERED ONLY WHERE A DRAG WOULD DO SOMETHING (`resizable`),
                      // which is the panel's standing rule for every affordance it draws
                      // (#1064/#1070): a handle on a note whose every length the writer
                      // declines is a control the user can press to no effect, and this
                      // project ranks that worse than not offering it at all.
                      <span
                        data-seq-resize={`${laneIndex}:${resizeStart}`}
                        aria-label={`resize ${lane.sound} step ${stepNo(resizeStart)}`}
                        onPointerDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onResizeDown(laneIndex, resizeStart)
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          right: `${(1 - clamp01(extent)) * 100}%`,
                          width: `min(${RESIZE_ZONE_PX}px, ${clamp01(extent) * 100}%)`,
                          cursor: 'ew-resize',
                          background: 'var(--foreground, #e6e6ea)',
                          opacity: 0.45,
                          borderRadius: '0 2px 2px 0',
                        }}
                      />
                    )}
                  </button>
                  </div>
                )
                }
                // A step of one box, or one a bar line would cut, is drawn box by box — inside the
                // SAME keyed wrapper, laid out as nothing (`display: contents`). An edit can turn a
                // grouped step into single boxes (`[bd ~ sd ~]` → `bd _ sd ~`); with a different
                // parent React would replace the focused cell and the next key would go nowhere.
                const grouped = g.boxes.length > 1 && !g.boxes.slice(1).some((b) => layout.barStart(b.start))
                if (!grouped) {
                  return (
                    <div key={`step-${g.from}`} role="none" style={{ display: 'contents' }}>
                      {g.boxes.map((b) => cellFor(b, 'solo'))}
                    </div>
                  )
                }
                let weight = 0
                for (let c = g.from; c < g.to; c++) weight += layout.weight(c)
                const gaps = 2 * (g.to - g.from - 1)
                const stepStart =
                  g.from > 0 && !layout.barStart(g.from) && !!stepStarts?.get(lane.part ?? 0)?.has(g.from)
                return (
                  <div
                    key={`step-${g.from}`}
                    role="none"
                    data-seq-step={g.plain ? 'plain' : 'holds'}
                    data-seq-step-start={stepStart ? 'true' : undefined}
                    style={{
                      display: 'flex',
                      gap: 2,
                      height: 22,
                      // exactly the space its boxes take drawn one by one, so its edges and
                      // its boxes' edges fall on the other rows' columns
                      flex: `${weight} ${weight} ${gaps}px`,
                      minWidth: stepMin * weight + gaps,
                      maxWidth: 56 * weight + gaps,
                      marginLeft: layout.barStart(g.from) ? 8 : 0,
                      // an outline takes no space, so it cannot push a column
                      outline: '1px solid var(--border, #3a3a42)',
                      borderRadius: g.plain ? 3 : 4,
                      // NOT overflow-hidden: the focus ring is drawn just outside a cell, and
                      // clipping it here hid the keyboard cursor on a filled column
                      // plain: the gaps between its columns read as faint halves; a step that
                      // holds several: a darker well its small boxes sit in
                      background: g.plain ? 'var(--border, #3a3a42)' : 'var(--background, #1e1e24)',
                      boxShadow: stepStart ? '-2px 0 0 0 var(--foreground-muted, #6a6a90)' : undefined,
                    }}
                  >
                    {g.boxes.map((b, i) =>
                      cellFor(b, g.plain ? 'plain' : 'inner', { first: i === 0, last: i === g.boxes.length - 1 }),
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          )
        })}
        </div>
        {!lookOnly && (
          <ExtendHandle length={length} gridRef={gridRef} cellAttr="data-seq-col" cols={model.steps} lastBarCols={layout.lastBarCols} />
        )}
        {/* The drum catalogue is the wrong menu for a chord chart — it would
            offer Kick and Snare as things to add to a progression. Withdrawn
            rather than restocked: a chord picker is a different feature, and
            offering the wrong one is worse than offering none. Every other
            gesture in the grid keeps working. */}
        {!isChordChart && !lookOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ width: 72, flex: '0 0 auto' }} />
          <select
            data-seq-add-voice
            aria-label="add drum voice"
            value=""
            onChange={(e) => {
              if (e.target.value) addVoice(e.target.value)
            }}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px dashed var(--border, #3a3a42)',
              background: 'var(--background-elevated, #26262c)',
              color: 'var(--foreground-muted, #a0a0aa)',
              cursor: 'pointer',
            }}
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

/** `a`, `a and b`, `a, b and c` */
function listOf(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
