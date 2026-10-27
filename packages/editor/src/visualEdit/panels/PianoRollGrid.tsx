/**
 * Piano Roll — note grid (#383, drag-move + range stability from #391).
 *
 * Parses the mini-notation of the `note(...)` / `n(...)` statement under the
 * cursor into a `PianoRollModel` and renders pitch rows × step columns.
 * Interactions:
 *   - click an empty cell → place a note (one step; overlaps resolved);
 *   - click a note → remove it;
 *   - drag a note → move it in pitch + time (duration preserved), one undo;
 *   - drag a note's right-edge handle → resize its duration (`@n`), one undo.
 * Each edit re-serializes and writes back over the mini range (`'roll'`); a
 * serialization the subset can't express (e.g. a move that would overlap) is
 * dropped, leaving the document untouched — the conservatism rule.
 *
 * The visible pitch range is sticky within a binding: it expands to fit notes
 * but never shrinks when notes are removed, and resets only when the cursor
 * moves to a different statement (#391) — so editing doesn't make rows jump.
 */
import * as React from 'react'

import { pianoRollCodec, gainWritable as gainWritableOn, slotPress, slotPressCost, NO_RESOLUTION_EFFECT } from '../../codeView'
import type { PianoRollModel, RollNote, ColumnOverlap } from '../../codeView'
import { lookOnlyLine } from '../../codeView'
import { drawnLayout } from '../../codeView'
import {
  columnCount,
  columnOverlap,
  headColumn,
  rollContentRange,
  sequentialColumnGroups,
  tailColumn,
} from '../../codeView'
import { pitchToMidi, midiToPitch, noteDisplayName, isBlackKey, cLabel } from '../../codeView'
import { VisualEditStandby } from './VisualEditStandby'
import { PIANO_ROLL_TAB_ID } from './tabs'
import { opensPianoRoll } from '../../codeView'
import { useGridModel } from './useGridModel'
import { onLiveGraph } from '../../engine/offlineGraph'
import { emitLog } from '../../engine/engineLog'
import { cycleToColumn, stepToCycle, usePlayingStep } from './usePlayingStep'
import {
  moveNote,
  pasteNote,
  placeNote,
  removeNote,
  resizableNotes,
  resizeNote,
  viewPlacesNotes,
} from '../../codeView'
import { useNoteColorMode, velocityColor } from './noteColor'
import { useLiftResolution, useViewProver, type ResolutionControlProps } from './ResolutionControl'
import { PatternTrackChip } from './PatternTrackChip'
import { UNREFINED, type ViewScale } from '../../codeView'
import { type SelectedNote, gainAtStart, setGroupGain } from './inspector'
import { type Division, DEFAULT_DIVISION, stepsPerBar, snapInterval, snapColumn } from './division'
import { setNoteClip, getNoteClip } from './clipboard'
import {
  GRID_SCOPE,
  isCursorMove,
  isNoteEdit,
  matchGridKey,
  mountGridGestures,
  moveCursor,
  type GridAction,
  type NoteEdit,
} from './gridGestures'
import { colorForTrack, commit, noteSounds, readChainMethod, readSoundCall, soundBlockEdit, soundLane, type SoundBlock } from '../../codeView'
import { SoundPickerMenu } from './SoundPickerMenu'
import { INSTRUMENTS } from './soundCatalog'
import { useSoundCatalog } from '../../workspace/soundRegistry'
import { ExtendHandle } from './ExtendHandle'
import { linesModel, rulerLabels, useLayoutFollow, useRulerFit, writtenStepStarts } from './writtenSteps'
import { usePatternLength } from './usePatternLength'
import { InViewBar, PHONE_GRID_WIDTH, PHONE_RULER_HEIGHT, PHONE_STEP_MIN, TurnHint, usePhoneGrid, useRulerPan } from './phoneGrid'
import { AUDITION_ENVELOPE, AUDITION_DUR_S } from '../audition'
import { superdough, getAudioContext } from '@strudel/webaudio'

const ROLL_HINT = 'Click a melody to edit its notes.'

/**
 * The right-edge grab zone of a note's tail cell, in px (#530). The visible
 * handle is a thin strip, but a near-miss that lands a few px inside the body
 * used to start a MOVE drag → a no-move release then DELETED the note
 * (click-toggle), so "resize" read as "the note keeps vanishing". Treating the
 * right `RESIZE_ZONE_PX` (or 40% of a wide cell) of the tail as resize-intent
 * makes the edge reliably grabbable and non-destructive. Capped below half the
 * cell so a centre click always stays in the move/delete area, even on a dense
 * grid with narrow cells.
 */
const RESIZE_ZONE_PX = 8

/**
 * Audition hold (#633): superdough has no live note-off, so a held key is kept
 * sounding by retriggering an overlapping sustained note on this interval (ms).
 * Each note's slice = this interval (so notes butt-join), with a short release so
 * the tail bridges the seam; the loop stops on release, so the note rings out
 * within one slice of letting go.
 */
const HOLD_RETRIGGER_MS = AUDITION_DUR_S * 1000

/**
 * What the velocity lane says when the gain writer declines this pattern (#1089).
 *
 * Its own sentence, and not the panel's placement one: 30 of the 33 corpus patterns this
 * covers already show "to add one, use the code view", which a reader takes to mean notes
 * cannot be ADDED — it says nothing about whether the ones here can be made louder.
 */
const VELOCITY_READ_ONLY = 'Shows this pattern’s velocities — to change them, use the code view.'

/** velocity lane height (px) and the drag distance that spans the full 0→1 */
const LANE_HEIGHT = 48
const VELOCITY_FULL_PX = 80

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/**
 * Velocity is grid-aligned for single-bar rolls and for multi-bar `<...>` rolls
 * whose bars are a single column each (`perBar === 1`, steps === bars) — one
 * note/chord per bar, where the gain is a flat sequence wrapped in `<...>`
 * (#632). Subdivided multi-bar (perBar > 1) and any `.gain` we don't manage
 * (`gainForeign`) are out of scope.
 */
function gainInScope(model: PianoRollModel): boolean {
  return !model.gainForeign && (model.bars == null || model.bars === model.steps)
}

/**
 * The token for a row. A numeric pattern (#469) emits the bare row number
 * (`60`, `0`) so new/dragged notes keep the pattern's convention and round-trip;
 * a note-name pattern emits `c4`. The row value itself is the same either way.
 */
const tokenForRow = (numeric: boolean, midi: number): string =>
  numeric ? String(midi) : midiToPitch(midi)

/**
 * The outcome clause a refusal ends on. Every refusal but one leaves the document exactly
 * as it was, so this is the default.
 *
 * ⚠ A DECLINED MOVE DROP IS THE EXCEPTION, AND IT IS WHY THE CLAUSE IS A PARAMETER
 * (#1452). Three positions are reachable when a move ends: where the note was grabbed,
 * the last frame the cheap rule accepted, and the cell the pointer was over at release.
 * A readback refusal sends the note HOME — "left unchanged" is true of it. A cheap
 * decline leaves the note at the LAST ACCEPTED FRAME, which is neither home nor the
 * drop, so the same sentence would describe an outcome that did not happen. One message
 * meaning two different resting places is worse than the silence it replaces.
 */
const LEFT_UNCHANGED = 'so it was left unchanged'
const STAYED_AT_LAST_ACCEPTED = 'so it stayed at the last spot it could go'

/**
 * SAY THAT THE EDIT DID NOT HAPPEN (#1336).
 *
 * The readback gate (#1331/#1333) refuses a write the document would not reopen holding —
 * correctly, because the alternative is losing a note. But a refusal that changes nothing
 * and says nothing is the invisible-decline shape #1322 removed from this surface, and the
 * gate reinstated it on three writers at once.
 *
 * ⚠ REPORTING IS THE ANSWER RATHER THAN GATING THE AFFORDANCE, and that is measured, not
 * preferred. Gating needs a per-cell admissibility map, and there is no per-cell seam here
 * at all: the panel asks `viewPlacesNotes` ONCE per view and `overlapAt` per cell, so a
 * writer-side rule cannot reach a cell without one being built. Priced over the corpus:
 *
 *     per-CELL map with readback     p50 7.5ms   p99 8,482ms   worst 31,019ms
 *     per-COLUMN map with readback   p50 0.31ms  p99   546ms   worst  2,228ms
 *
 * #1072 already declined a per-cell map on this surface at p99 21.7ms, and the per-column
 * lever it suggested lands on 546ms — the same p99 that made #1324's readback unshippable,
 * and it recomputes every drag frame because `mutate` makes a new model per frame. The
 * lever is SOUND (2 of 7,984 columns hold both a refusal and an accept) and still
 * unaffordable, so the two failed for different reasons and both are recorded.
 *
 * ⚠ AND RESIZE COULD NOT BE GATED AT OFFER TIME EVEN IF A MAP WERE FREE — the refusal
 * depends on the length the user drags to, which does not exist until the gesture ends.
 * So a message is not the cheap substitute for the gate; for the worst-looking case it is
 * the only available answer.
 *
 * Levelled `warn` rather than `error`: nothing is broken, the notation simply cannot spell
 * this edit. `emitLog` coalesces identical entries into a count, so a user repeatedly
 * trying the same impossible edit gets one row that ticks up rather than a flood.
 */
/**
 * A note's fill when the track plays several sounds (#2226): the sound's colour, a band
 * per sound for a note whose sound changes from pass to pass, and the empty-cell border
 * colour for a note a rest in the sound pattern silences.
 */
function soundFill(names: readonly string[]): string {
  if (names.length === 0) return 'var(--border, #3a3a42)'
  if (names.length === 1) return colorForTrack(names[0])
  const band = 100 / names.length
  const stops = names.map((n, i) => `${colorForTrack(n)} ${i * band}% ${(i + 1) * band}%`)
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}

function reportRefusal(attempted: string, outcome: string = LEFT_UNCHANGED): void {
  emitLog({
    level: 'warn',
    runtime: 'stave',
    message: `${attempted} — writing it would change the pattern in ways you didn't ask for, ${outcome}.`,
  })
}

/**
 * The roll's written steps and ruler (#1841), from the parser's own regions. A stack's
 * parts can split a bar differently; the roll has no "part being edited" yet, so it
 * follows the part holding the most notes — usually the melody or the chords rather than
 * the bass — counted from the notes each part's regions already carry. Ties go to the
 * part written first. Its lines are drawn for every row; the other parts draw none.
 */
function rollSteps(
  model: PianoRollModel,
  cols: number,
): { stepStarts: Set<number>; ruler: Map<number, string> } {
  const byPart = writtenStepStarts(model)
  let part = 0
  if (model.source && model.source.parts.length > 1) {
    let most = -1
    for (const p of model.source.parts) {
      const n = p.regions.reduce((sum, r) => sum + r.content.length, 0)
      if (n > most) {
        most = n
        part = p.part
      }
    }
  }
  const starts = byPart.get(part) ?? []
  return { stepStarts: new Set(starts), ruler: rulerLabels(model, cols, starts) }
}

/**
 * The note covering (midi, step), if any — asked as an INTERVAL, not as an integer walk
 * (#1074).
 *
 * The old test was `n.start <= step && step < n.start + n.duration` against an integer
 * `step`, on the belief that `RollNote.duration` counts whole `@n` steps. It does not, and
 * the belief is worth naming because it has produced the same defect three times here:
 * `@n` is not a count of anything. It is a relative WEIGHT — an element occupies
 * `n / Σweights` of its enclosing sequence — so `@1` lasts half a cycle in `bd@1 sd@1` and
 * a quarter in a four-element one. `duration` is that share converted to COLUMNS, and it
 * is routinely fractional: the corpus disagreed on 17 notes. `[c5@0.5 f4@0.5 f5@3]` puts
 * `f4` at start 0.5 for 0.5, spanning `[0.5, 1.0)`, which contains no integer — so the
 * note sounded and was drawn in no column at all. Ten more were drawn for the wrong length
 * in both directions.
 */
function overlapAt(
  model: PianoRollModel,
  midi: number,
  step: number,
): { note: RollNote; overlap: ColumnOverlap } | undefined {
  for (const n of model.notes) {
    if (pitchToMidi(n.pitch) !== midi) continue
    const overlap = columnOverlap(n.start, n.start + n.duration, step)
    if (overlap) return { note: n, overlap }
  }
  return undefined
}

/** the note covering (midi, step), if any */
function noteAt(model: PianoRollModel, midi: number, step: number): RollNote | undefined {
  return overlapAt(model, midi, step)?.note
}

interface DragState {
  /** 'move' drags the note in pitch+time; 'resize' grows/shrinks its duration */
  mode: 'move' | 'resize'
  /**
   * The document AS AT GESTURE START — the fixed base every frame rebuilds from.
   *
   * ⚠ IT IS THE WHOLE MODEL, not the complement of the grabbed note, and that is the
   * point. `mutate` re-parses the document between frames, so a note REFERENCE cannot
   * survive a drag; the panel used to carry `model.notes.filter((n) => n !== note)` to
   * work around that. Carrying the base model instead keeps the same no-drift property,
   * hands the writer the source anchors span surgery needs, and lets the grabbed note be
   * addressed by INDEX — sound here precisely because the base is captured ONCE, so the
   * index cannot drift under a re-parse the way it would against `prev`.
   */
  base: PianoRollModel
  /** how far into the note the grab landed (step − note.start) */
  grabOffset: number
  /** the original note's pitch/start, for a click (no-move) removal / resize anchor */
  origPitch: string
  origStart: number
  moved: boolean
  /**
   * The last length a resize drag ASKED for, kept so the gesture can be re-run once on
   * release under the readback check (#1331).
   *
   * ⚠ IT IS THE ASK, NOT THE OUTCOME. `resizeNote` caps, so the length that reached the
   * document is routinely shorter than this; re-running from the outcome would pose a
   * different gesture than the user made. Undefined for a move drag, and until the first
   * frame of a resize.
   */
  askedDur?: number
  /**
   * The pitch/column a move drag last ASKED for, kept so the gesture can be re-run once
   * on release under the readback check (#1340) — the same shape as `askedDur`.
   *
   * ⚠ THE ASK, NOT THE OUTCOME, for the same reason: `moveNote` clamps the landing column
   * to the grid, so what reached the document may be short of what the pointer asked for,
   * and re-running from the outcome would settle a gesture the user did not make.
   */
  askedPitch?: string
  askedStart?: number
  /**
   * Whether the LAST frame's ask was DECLINED by the cheap rule (#1452).
   *
   * ⚠ THIS IS A VERDICT, NOT AN ASK, AND THAT SEPARATION IS THE WHOLE POINT. `askedPitch`
   * / `askedStart` are recorded only for frames that were ACCEPTED, because the commit-time
   * re-run must pose a gesture the document already took — recording the ask above the
   * decline check is what broke the accepted-position semantics in #1325/#1326. But that
   * ordering also means nothing anywhere records that the pointer was ever over the cell
   * the user actually released on. So the panel could not tell that the drop was refused;
   * not for want of a check, for want of a record.
   *
   * Kept as a separate boolean so both facts survive: the drop was declined, AND we stand
   * at the last accepted frame. It is read at commit to REPORT, never to re-run or write.
   */
  dropRefused?: boolean
}

export interface PianoRollGridProps {
  /** the inspector's selected note (#432), owned by PatternPanel */
  selected?: SelectedNote | null
  onSelect?: (sel: SelectedNote | null) => void
  /** snap/quantize division for move + resize (#432 Slice 2), owned by PatternPanel */
  division?: Division
  /** lift the grid-resolution ("Slots") control to the Pattern inspector (#601) */
  onResolution?: (r: ResolutionControlProps | null) => void
}

export function PianoRollGrid({
  selected,
  onSelect,
  division = DEFAULT_DIVISION,
  onResolution,
}: PianoRollGridProps = {}): React.ReactElement {
  // How finely this panel DRAWS the pattern (#1057) — a view only; the first write
  // absorbs it. A roll length is measured in columns, so a refine magnifies note
  // DURATIONS alongside their starts and the picture stays proportional.
  const [viewScale, setViewScale] = React.useState<ViewScale>(UNREFINED)
  /**
   * The `midi:step` cell a move drag is currently hovering that the writer will NOT take,
   * or null (#1452) — the same refusal the Console row reports, said before the fact.
   *
   * ⚠ ONE CELL, NOT A MAP, AND THAT IS WHAT MAKES IT AFFORDABLE. The docblock above rules
   * out gating the whole grid at offer time: the answer depends on the note being dragged,
   * so a map would be rebuilt every frame. The HOVERED cell costs the writer nothing extra
   * — the frame already computed its verdict to decide whether to write.
   *
   * ⚠ THE RENDER IS NOT FREE, AND THE NUMBER IS THE POINT. A declined frame used to render
   * nothing at all (it returned early), so every render this causes is new. Measured over
   * 130 declined frames per arm, same gesture, two builds differing only in this line
   * (CDP `Performance.ScriptDuration`, so the harness's own cost is excluded):
   *
   *   declined frame, marking on    4.49 ms      declined frame, marking off   0.24 ms
   *   accepted frame, marking on    8.99 ms      accepted frame, marking off   9.11 ms
   *
   * So it adds ~4.3ms, on a frame that is HALF what an accepted frame already costs, and
   * inside a 16.7ms budget. The accepted column is the control: the marking never fires
   * there and the two builds agree to 1.4%, which is what makes the declined column's
   * difference attributable to this line rather than to the machine.
   *
   * It fires once per newly-entered declined CELL, not per pointermove — `pointerenter`
   * does not repeat within a cell, and an unchanged value bails out of the re-render. The
   * worst case measured here is a sweep down the 13 declined cells of one column.
   */
  const [declinedCell, setDeclinedCell] = React.useState<string | null>(null)
  const { chunk, model, read, mutate, settle, writeMini, beginGesture, endGesture, patternKey, applyEdit } = useGridModel<PianoRollModel>({
    ...pianoRollCodec,
    source: 'roll',
    eligible: opensPianoRoll,
    viewScale,
    onViewScaleConsumed: () => setViewScale(UNREFINED),
  })
  // The `+` past the last column: add a bar that continues the pattern, or drag in empty bars (#1824).
  const length = usePatternLength(chunk, model, pianoRollCodec.parse, writeMini)

  // A refinement belongs to the pattern it was made on — see `SequencerGrid` for
  // why carrying it across a cursor move could send an editable pattern to standby.
  // The panel's own writes do not count as a new pattern (#1964).
  React.useEffect(() => {
    setViewScale(UNREFINED)
  }, [patternKey])

  const dragRef = React.useRef<DragState | null>(null)
  // A velocity-lane drag: vertical drag on a note's bar sets that group's gain.
  const velRef = React.useRef<{ start: number; startY: number; startGain: number } | null>(null)
  const playingStep = usePlayingStep(
    model?.steps ?? 0,
    model?.bars ?? 1,
    model ? columnCount(model) : 0,
    model?.barSteps,
  )
  const [colorMode] = useNoteColorMode()
  // #2226 — which sound each note plays, when the track's sound is a pattern of
  // several (`.sound("piano gm_electric_guitar_muted")`). Asked of Strudel for each
  // note's onset; null when the track plays one sound, so such a roll looks as it did.
  const sounds = React.useMemo(() => {
    if (!chunk || !model) return null
    const span = model.bars ?? 1
    const onsets = model.notes.map((n) => stepToCycle(n.start, model.steps, span, model.barSteps))
    const per = noteSounds(chunk, onsets, span)
    if (!per) return null
    const names = [...new Set(per.flat())]
    if (names.length < 2) return null
    return { names, byNote: new Map(model.notes.map((n, i) => [n, per[i]] as const)) }
  }, [chunk, model])
  // #2226 — the sound pattern as its own row under the notes, with its own divisions
  const lane = React.useMemo(() => (chunk && model ? soundLane(chunk, model.bars ?? 1) : null), [chunk, model])
  // each column's pieces of the lane's blocks, in columns (fractional where a block
  // begins or ends inside one)
  const laneSegments = React.useMemo(() => {
    const out: { block: number; from: number; to: number; first: boolean }[][] = []
    if (!lane || !model) return out
    const span = model.bars ?? 1
    lane.blocks.forEach((b, i) => {
      const c0 = cycleToColumn(b.begin, model.steps, span, model.barSteps)
      const c1 = cycleToColumn(Math.min(b.end, span), model.steps, span, model.barSteps)
      for (let c = Math.floor(c0); c < c1 - 1e-9; c++) {
        ;(out[c] ??= []).push({ block: i, from: Math.max(c0, c), to: Math.min(c1, c + 1), first: c === Math.floor(c0) })
      }
    })
    return out
  }, [lane, model])
  // a block's other segments open the picker its first segment holds
  const laneToggles = React.useRef(new Map<number, () => void>())
  const instruments = useSoundCatalog()
  // A block writes only its own name. A refusal changes nothing and says why.
  const writeBlock = (block: SoundBlock, value: string): void => {
    if (value === '') return
    applyEdit((fresh, wb) => {
      const r = soundBlockEdit(fresh, block, value)
      if ('refused' in r) emitLog({ level: 'warn', runtime: 'stave', message: r.refused })
      commit(wb, 'edit' in r ? r.edit : null, 'roll')
    })
  }
  // Pitch row the pointer is over → highlight its key on the keyboard (#430).
  const [hoveredMidi, setHoveredMidi] = React.useState<number | null>(null)
  // Audition (#633): press-and-hold a key to sustain it (drag to glissando).
  // `holdMidiRef` = the pitch currently held (null when released); `holdTimerRef`
  // = the retrigger interval that keeps it sounding while held.
  const holdMidiRef = React.useRef<number | null>(null)
  const holdTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Latest selection + setter for use inside window-listener effects without
  // re-subscribing (#432). The grid sets selection; PatternPanel owns it.
  const onSelectRef = React.useRef(onSelect)
  onSelectRef.current = onSelect
  const selectedRef = React.useRef(selected)
  selectedRef.current = selected
  const select = (sel: SelectedNote | null): void => onSelectRef.current?.(sel)

  // Sticky pitch range: expand to fit, never shrink within a binding; reset on
  // statement change (#391).
  // Seeded from the same rule that will reseed it — a model with nothing spellable
  // in it is exactly what the panel shows before one arrives.
  const [range, setRange] = React.useState<{ lo: number; hi: number }>(() =>
    rollContentRange({ notes: [] }),
  )
  const stmtIdRef = React.useRef<number | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const openScrollRef = React.useRef(false)
  React.useEffect(() => {
    if (!model) return
    // Never reflow the rows mid-drag: a moved note expanding the range would
    // shift every row, so the cell under the pointer would change midi and the
    // drag would run away. The range catches up once the drag ends.
    if (dragRef.current) return
    const content = rollContentRange(model)
    const id = chunk ? chunk.statementRange[0] : null
    if (stmtIdRef.current !== id) {
      stmtIdRef.current = id
      setRange(content) // new statement → reseed
      openScrollRef.current = true // …and open on its notes (#1850)
    } else {
      setRange((prev) => ({
        lo: Math.min(prev.lo, content.lo),
        hi: Math.max(prev.hi, content.hi),
      }))
    }
    // Key on `model` ONLY, not `[model, chunk]` (#597). `chunk` (the cursor's
    // statement) updates one render BEFORE `model` (useGridModel sets it in an
    // effect keyed on chunk). Firing on `chunk` ran the statement-change reset
    // on the STALE render — reseeding from the PREVIOUS track's model — so the
    // correct model always arrived in the expand-only union branch and the row
    // extent grew monotonically across track switches (never shrank, stuck at
    // the widest track). Firing on `model` only skips that stale render: the
    // reset runs once `model` matches the new `chunk`, replacing the extent.
    // Within-track edits still change `model` → id matches → sticky union (#391).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // OPEN ON THE NOTES (#1850). The range above puts the lowest note two rows above
  // the bottom of at least 13, and the default drawer shows 9, so a roll left at its
  // top row opened with its lowest note out of view — every roll in the corpus did.
  // Once per statement, when the reseed above marks it: centre the notes when they
  // fit, else put the lowest note at the bottom (the bass reads from the floor).
  // Never on an edit — the range is sticky within a statement so the rows don't
  // jump while you work, and the view must not either.
  // After every render AND on the scroll area's resize: the rows the reseed asks for
  // exist one render later, and a grid can read its pattern while the drawer is still
  // closed — no height to scroll, and opening it resizes without a render.
  useLayoutFollow(scrollRef, () => {
    const sc = scrollRef.current
    if (!openScrollRef.current || !sc || !model || sc.clientHeight === 0) return
    const midis = model.notes.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null)
    if (midis.length === 0) {
      openScrollRef.current = false
      return
    }
    const rowOf = (midi: number) => sc.querySelector<HTMLElement>(`[data-roll-cell^="${midi}:"]`)
    const top = rowOf(Math.max(...midis))
    const bottom = rowOf(Math.min(...midis))
    if (!top || !bottom) return // the rows for the new range are not drawn yet
    openScrollRef.current = false
    const box = sc.getBoundingClientRect()
    const pad = 16 // the scroll area's own padding, kept clear at both edges
    const y0 = top.getBoundingClientRect().top - box.top + sc.scrollTop
    const y1 = bottom.getBoundingClientRect().bottom - box.top + sc.scrollTop
    const room = sc.clientHeight - 2 * pad
    sc.scrollTop = y1 - y0 <= room ? (y0 + y1) / 2 - sc.clientHeight / 2 : y1 + pad - sc.clientHeight
  })

  // The roll's half of placement admissibility (#1064/#1070) — the VIEW-level
  // question only, and that asymmetry with the grid is measured, not stylistic.
  //
  // A leaf-anchored roll writes by byte surgery at each note's own span, and the
  // roll's leaf writer indexes no rest to swap, so it creates nothing: 18,386 of
  // 18,386 corpus placements on that path are refused, which is 96.3% of
  // everything inert on this surface. This one boolean catches all of it.
  //
  // The remaining 3.7% would need the grid's per-cell map, and here it does not
  // pay for itself. The roll's own paths are near-clean (element 0.9%, alt
  // 0.0%), while a roll view spans rows × steps rather than lanes × steps —
  // measured over the corpus, per model change: grid p50 0.01ms / p99 2.1ms,
  // roll p50 0.28ms / p99 21.7ms / worst 50ms at 1,632 cells. `mutate` fires on
  // every pointermove of a move drag, so on the roll that map would be a
  // per-frame cost, to make 0.9% of cells legible.
  //
  // Correctness does not rest on this either way: `placeNote` still asks the
  // real writer, so a refused click leaves the document untouched exactly as a
  // gated one would. What the 0.9% does not get is the affordance — unchanged
  // from today, and stated rather than quietly dropped.
  //
  // ⚠ IT ASKS THE OP NOW rather than reading the write path (#1154). The roll's
  // leaf writer indexes no rests, so its answer is the same `false` it always
  // was — but it is measured rather than inferred, and it stops at the first
  // acceptance, so a roll that places anything answers in one cell. Memoized on
  // the model, because a leaf roll (which refuses everything and is therefore
  // scanned in full) would otherwise pay for that scan on every render.
  const placesNotes = React.useMemo(() => (model ? viewPlacesNotes(model) : false), [model])
  /**
   * WHICH NOTES A LENGTH HANDLE WOULD ACTUALLY RESIZE (#1322).
   *
   * The roll drew its right-edge handle on every note's tail. #1318 gave resize the
   * ability to decline — where the only writable answer would move a voice the gesture
   * never touched, and where the answer cannot be spelled — so since then some of those
   * handles have taken the cursor, accepted the drag and written nothing. The gesture was
   * offered and then silently did nothing, which is what #1064/#1070 removed from the
   * cell and #1089 removed from the velocity lane; this is the same rule reaching the one
   * affordance that still promised more than it could keep.
   *
   * ASKED OF THE WRITER, not predicted beside it — `resizableNotes` is in `place.ts` for
   * the same reason `canResizeCell` is, and its docblock carries the measurement.
   *
   * ⚠ MEASURED AT 1,861 OF 5,480 CORPUS NOTES (33.96%), not the 93 the issue was filed
   * with. That figure came from asking `canResizeNote` over durations {1,2,4}; that
   * predicate is an IDENTITY check, so it answers true for a resize that rebuilds the
   * same bytes, and it kept a dead handle on 1,768 notes. The commonest inert note is an
   * ordinary one: a duration-1 note in a dense pattern cannot grow (the next onset caps
   * it) and cannot shrink (the writer floors at 1).
   *
   * ⚠ KEYED BY NOTE OBJECT. `overlapAt` hands the render the note out of `model.notes`,
   * so identity is exact and free. `(pitch, start)` is NOT an identity on this surface —
   * a comma-stack holds the same pitch twice at one start (#1321) — and keying on it
   * merged 5 of 3,619 offerable notes. The grid keys its own set by start column and is
   * right to: a lane cannot hold two notes at one step.
   *
   * Memoized on the model. It is a per-FRAME cost during a drag, not a per-gesture one,
   * because `mutate` fires on every `pointermove` that changes the model — p99 3.61ms,
   * worst 15.88ms over the corpus, against the grid's shipped `placeable` memo at p99
   * 2.54ms / worst 14.4ms.
   */
  const resizable = React.useMemo(() => (model ? resizableNotes(model) : null), [model])
  // How many columns this roll DRAWS — not `model.steps`, which is the pattern's length
  // and need not be a whole number of columns (#1087). See `columnCount`.
  const cols = model ? columnCount(model) : 0
  /**
   * Can a velocity drag actually WRITE? (#1089)
   *
   * Asked of the REAL writer, not predicted. `gainInScope` answers a different question —
   * whether the lane should RENDER — and the two had drifted apart: for a pattern like
   * `[c5@0.5 f4@0.5 f5@3]` it is true (not foreign, single-bar) so the lane rendered in
   * full, every column took a `ns-resize` cursor and a pointer handler, and
   * `serializeRollGain` then declined every write. 305 columns across 33 corpus patterns
   * offered a drag that silently did nothing.
   *
   * The writer's refusal is CORRECT — the gain mini is one slot per column (`"0.5 1 1 1"`)
   * and a note beginning mid-column has no slot of its own to hold a value. The panel just
   * never asked it. `serializeRollGain` is already the exact predicate, so this is a read
   * and not a new rule — the failure mode `can<Op>` helpers have here is predicting the
   * writer, and asking it is what makes that impossible.
   *
   * Asked of the CURRENT model rather than of the model a drag would produce, and that is
   * measured rather than assumed: the skip is caused by the note geometry, which a gain
   * edit does not move, so the two answers never differ (0 of 2950 corpus columns).
   */
  const gainWritable = React.useMemo(
    () => (model ? gainWritableOn(pianoRollCodec, model) : false),
    [model],
  )

  React.useEffect(() => {
    const onUp = (): void => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      // a press with no move on a note body = a click → DELETE it (click-toggle:
      // click empty adds, click a note removes). A no-move on the resize handle
      // does nothing; a real drag already moved/resized it.
      if (!d.moved && d.mode === 'move') {
        // ⚠ GATED ON READBACK, and like a placement it costs nothing here (#1340). A
        // click-delete is ONE gesture, so the check runs on the write rather than being
        // deferred. Ungated, 5 of 5,480 corpus deletes wrote bytes that spell and reopen
        // holding FEWER notes than the model meant — the rest lands inside a nested
        // `<...>` or a `,`-stack and takes the structure with it.
        let refused = false
        mutate((prev) => {
          const next = removeNote(prev, d.origStart, d.origPitch, { readback: true })
          refused = next === prev
          return next
        })
        if (refused) reportRefusal("Couldn't delete that note")
      }
      // ⚠ SETTLE A RESIZE AGAINST WHAT THE DOCUMENT WILL REOPEN AS (#1331). Every frame
      // of the drag wrote under the cheap rule — the bytes spell — and that rule lets a
      // stretch re-spell a comma-stack as `[g3@4 ~ ~]`, dropping the sibling voice. The
      // document then holds one fewer note than the user can see, silently. Measured at
      // 1,099 of 10,960 ordinary d±1 asks, touching 1,095 of 5,480 notes.
      //
      // Re-running here rather than per frame is the whole point: the check parses, and
      // gating the writer on it per pointermove took p99 to 549ms (#1324). Once per
      // gesture it is one parse, and the gesture is already exactly one undo step, so the
      // correction coalesces into it — there is no second entry to undo.
      //
      // ⚠ RE-RUN FROM `d.base`, THE GESTURE'S OWN START, not from `prev`. `prev` holds
      // the last frame's answer, so re-asking against it would pose the question about a
      // note this gesture has already changed.
      //
      // ⚠ AND A REFUSAL MUST GO HOME, not merely be left alone. Mid-drag the document
      // sits at the last accepted frame, so returning the base is what puts the note back
      // where the user grabbed it; doing nothing would leave the lossy write standing.
      if (d.mode === 'resize' && d.moved && d.askedDur != null) {
        const asked = d.askedDur
        // ⚠ THE REFUSAL IS READ OFF THE WRITER, NOT OFF `mutate` (#1336). Mid-drag the
        // document sits at the last accepted frame, so a refusal RETURNS THE BASE and
        // `mutate` writes it — a real write that puts the note back. `next === prev` is
        // therefore false here, and asking `mutate` whether anything changed would report
        // nothing. Only `settled === d.base` distinguishes "went home" from "accepted".
        // ⚠ THE VERDICT IS COMPUTED HERE, NOT INSIDE `mutate` (#1453). Read off the
        // writer as before — only the place moved. A commit-time settle that computes
        // its refusal inside the callback is only as reliable as the callback running,
        // and `mutate` declines whenever the live model is null. A lossy mid-drag frame
        // can leave the document unparseable, which is precisely when the model IS null
        // — so the gate went quiet exactly in the cases it exists for.
        const settled = resizeNote(d.base, d.origStart, d.origPitch, asked, {
          readback: true,
        })
        const refused = settled === d.base
        // A refusal must go home, and it must be able to go home from a document the
        // panel can no longer parse — hence `settle`, which does not consult the live
        // model. An acceptance keeps the ordinary path.
        if (refused) settle(d.base)
        else mutate(() => settled)
        if (refused) reportRefusal("Couldn't set that length")
      }
      // ⚠ SETTLE A MOVE THE SAME WAY (#1340). A move drag fires per pointermove and wrote
      // under the cheap spelling rule at every frame, so it could land the note on bytes
      // the document reopens holding different notes — 14 of 20,587 asks the panel can
      // actually make. Same cadence argument as the resize above: one parse per gesture,
      // re-run from `d.base` so the question is about the note the user grabbed, and a
      // refusal RETURNS THE BASE so the note goes home rather than being left mid-drag.
      //
      // ⚠ READ OFF THE WRITER, not off `mutate`, for the same reason resize is: a refused
      // move writes the base back, so `next === prev` is false exactly when it matters.
      if (d.mode === 'move' && d.moved) {
        // ⚠ EXACTLY ONE MESSAGE, AND THE READBACK VERDICT WINS (#1452). Both refusals can
        // be true of one gesture: the standing frame can fail readback AND the drop cell
        // can have been declined. But a readback refusal sends the note HOME, so saying it
        // stayed at the last accepted frame would describe a position it no longer holds.
        // The settle therefore runs first and its verdict, when it fires, is the one told.
        let wentHome = false
        if (d.askedPitch != null && d.askedStart != null) {
          const toPitch = d.askedPitch
          const toStart = d.askedStart
          // ⚠ SAME AS THE RESIZE ABOVE, AND FOR THE SAME REASON (#1453). Observed: a
          // gate-only drag wrote the lossy spelling mid-drag, the document stopped
          // parsing, the live model went null, and `mutate` returned before running the
          // callback — so `refused` stayed false, the note never went home, and nothing
          // was reported. The gate was disabled by the write it exists to undo.
          const settled = moveNote(d.base, d.origPitch, d.origStart, toPitch, toStart, {
            readback: true,
          })
          wentHome = settled === d.base
          if (wentHome) settle(d.base)
          else mutate(() => settled)
        }
        // A declined drop is REPORTED AND NOTHING ELSE — no re-run, no write (#1452).
        // Nothing lossy was ever written for it: the cheap rule returned the base and the
        // frame never landed. The document stands at the last accepted frame, which is
        // #1325/#1326's ruling and still right — the user can see that position and it is
        // good. All that was missing is saying that the drop itself did not take.
        //
        // `askedPitch` doubles as "did any frame land", which is exactly what picks the
        // outcome clause: with one, the note sits somewhere other than where it was
        // grabbed; with none, it never moved and "left unchanged" is the true sentence.
        if (wentHome) reportRefusal("Couldn't move that note there")
        else if (d.dropRefused)
          reportRefusal(
            "Couldn't move that note there",
            d.askedPitch != null ? STAYED_AT_LAST_ACCEPTED : LEFT_UNCHANGED,
          )
      }
      setDeclinedCell(null)
      endGesture()
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [mutate, endGesture])

  // Velocity-lane drag: vertical drag on a note's bar sets its group's gain
  // (down = softer, up to a neutral-1 ceiling). One undo step per drag.
  React.useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const v = velRef.current
      if (!v) return
      const next = clamp01(v.startGain - (e.clientY - v.startY) / VELOCITY_FULL_PX)
      mutate((prev) => setGroupGain(prev, v.start, next))
    }
    const onUp = (): void => {
      if (!velRef.current) return
      velRef.current = null
      endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [mutate, endGesture])

  // Play one note through the same global audio graph the engine drives (#633).
  // `superdough` is a module singleton shared with the engine, so it reuses the
  // loaded samples/output. We pass the bound track's sound (`.s`) and the row's
  // note name (superdough parses the name itself, so the pitch matches playback),
  // plus a sustaining envelope so a held key rings out instead of the default
  // pluck (the synth `sustain` defaults to 0). Synth sounds always render;
  // sample/soundfont sounds need the engine initialized (a played doc) — else
  // this silently no-ops. superdough is async: an unready/unknown sound REJECTS,
  // so .catch it too (the try/catch only guards a synchronous throw).
  // #1733 — through `onLiveGraph`, so a key tap during a background waveform
  // render waits for it to hand superdough back instead of playing into it.
  const playMidi = (midi: number): void => onLiveGraph(() => {
    try {
      const ctx = getAudioContext()
      void ctx.resume() // the press is the user gesture that unlocks audio
      const sound = previewSound()
      // Shared envelope (#816) so a key tap and the Mixer picker's ▶ preview
      // sound identical — both trigger the same note shape through superdough.
      const value: Record<string, unknown> = {
        note: midiToPitch(midi),
        ...AUDITION_ENVELOPE,
      }
      if (sound) value.s = sound
      void superdough(value, ctx.currentTime + 0.02, HOLD_RETRIGGER_MS / 1000, 0.5, 0)?.catch(() => {})
    } catch {
      /* audio graph not ready — never break the UI */
    }
  })

  // The ONE sound a key tap plays (#2226). The written argument is notation, not a
  // name: `"piano*2"` or `"piano gm_electric_guitar_muted"` handed to superdough as `s`
  // plays nothing. A pattern of sounds plays the one the cursor's column meets, else the
  // first one written.
  function previewSound(): string | null {
    const arg = chunk ? readSoundCall(chunk, ['sound', 's']) : null
    if (!arg) return null
    if (arg.kind === 'one') return arg.name
    const sel = selectedRef.current
    if (chunk && model && sel?.kind === 'roll') {
      const span = model.bars ?? 1
      const at = noteSounds(chunk, [stepToCycle(sel.start, model.steps, span, model.barSteps)], span)?.[0]
      if (at && at.length > 0) return at[0]
    }
    return arg.names[0]
  }

  // Press-and-hold sustains the pitch (#633): superdough has no live note-off, so
  // a tight retrigger of an overlapping sustained note keeps it sounding while
  // held and lets go shortly after release. Dragging onto another key moves the
  // held pitch (glissando).
  const startHold = (midi: number): void => {
    holdMidiRef.current = midi
    playMidi(midi)
    if (holdTimerRef.current == null) {
      holdTimerRef.current = setInterval(() => {
        if (holdMidiRef.current != null) playMidi(holdMidiRef.current)
      }, HOLD_RETRIGGER_MS)
    }
  }
  const moveHold = (midi: number): void => {
    if (holdMidiRef.current == null || holdMidiRef.current === midi) return
    holdMidiRef.current = midi
    playMidi(midi) // immediate response as the drag crosses keys
  }
  const stopHold = (): void => {
    holdMidiRef.current = null
    if (holdTimerRef.current != null) {
      clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  // Release the hold anywhere (the drag may end off a key); stop on unmount too.
  React.useEffect(() => {
    window.addEventListener('pointerup', stopHold)
    window.addEventListener('pointercancel', stopHold)
    return () => {
      window.removeEventListener('pointerup', stopHold)
      window.removeEventListener('pointercancel', stopHold)
      if (holdTimerRef.current != null) clearInterval(holdTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onBarDown = (start: number, e: React.PointerEvent): void => {
    if (!model) return
    velRef.current = { start, startY: e.clientY, startGain: gainAtStart(model, start) }
    beginGesture()
  }

  const onCellDown = (midi: number, step: number, e: React.PointerEvent): void => {
    if (!model) return
    // ⌘/Ctrl-click → SELECT this cell (for copy/paste, #528): the position is a
    // pitch token + step, so it works on an empty cell too (a paste target). No
    // edit. Modifier-gated, independent of the plain-click toggle.
    if (e.metaKey || e.ctrlKey) {
      select({ kind: 'roll', pitch: tokenForRow(!!model.numeric, midi), start: step })
      return
    }
    // A plain click moves the cursor too (#1802): the cursor IS the selection, so
    // the keys that follow act where the pointer last was.
    select({ kind: 'roll', pitch: tokenForRow(!!model.numeric, midi), start: step })
    const note = noteAt(model, midi, step)
    if (note) {
      // Pressing the trailing edge of the note's TAIL cell = resize intent (#530),
      // even if the thin handle strip was missed. Widening this grab zone stops
      // a near-miss from starting a move/delete instead of a resize.
      //
      // ANCHORED TO THE BAR, NOT THE CELL (#1078) — and asked of the same
      // `tailColumn` the render uses. Both halves were wrong for a note that does
      // not fill its column. The integer walk (`start + duration - 1 === step`)
      // never matches a fractional note at all — `c5@0.5` asks `-0.5 === 0` — so
      // the generous zone simply never fired for the notes that most need it,
      // while the render drew them a handle; and measuring inward from the CELL's
      // right edge put the zone past the end of a bar that stops mid-column.
      //
      // The zone runs from the bar's trailing edge to the cell's right edge, so
      // nothing that used to resize stops resizing: for a whole-column note the
      // bar's edge IS the cell's edge and this reduces to the old rule exactly,
      // which is the control that keeps 4842-minus-18 notes unchanged. Its depth
      // scales with the BAR — a grab zone should be proportional to the thing it
      // grabs — floored at RESIZE_ZONE_PX so a 3px bar stays aimable, and still
      // capped against the CELL so it can never reach into a neighbouring column.
      const isTail = tailColumn(note) === step
      const rect = e.currentTarget.getBoundingClientRect()
      const ov = columnOverlap(note.start, note.start + note.duration, step)
      const barEnd = ov ? (ov.offset + ov.extent) * rect.width : rect.width
      const barW = ov ? ov.extent * rect.width : rect.width
      const zone = Math.min(rect.width * 0.45, Math.max(RESIZE_ZONE_PX, barW * 0.4))
      if (isTail && e.clientX - rect.left >= barEnd - zone) {
        // ⚠ THE ZONE IS SUPPRESSED, AND THE PRESS STAYS INERT (#1322). Falling through
        // to the move branch below would be the tidier code and the wrong behaviour: on
        // this surface a press with no drag DELETES the note, so removing a handle that
        // did nothing would install a destructive gesture exactly where the user had
        // learned nothing happens. Offering less must not mean doing more.
        if (!resizable?.has(note)) return
        onResizeDown(note)
        return
      }
      // a note: start a move drag; a press with no drag deletes it (onUp).
      dragRef.current = {
        mode: 'move',
        base: model,
        grabOffset: step - note.start,
        origPitch: note.pitch,
        origStart: note.start,
        moved: false,
      }
      beginGesture()
    } else {
      // empty cell → place a one-step note (its own undo). Direct edit, no select.
      //
      // ⚠ GATED ON READBACK, and unlike resize it costs nothing to do it here (#1333). A
      // placement is ONE CLICK, so there is no per-frame cadence to defer to gesture
      // commit — the check runs on the write. Ungated, 4,362 of 35,601 placements the
      // panel offers wrote a document that reopens without the note the click just made,
      // after re-spelling the pattern around it for nothing.
      placeAt(midi, step)
    }
  }

  // A one-step note at (midi, step) — the click on an empty cell, and the toggle
  // key on one (#1802). One op, one read-back, one refusal sentence.
  const placeAt = (midi: number, step: number): void => {
    let refused = false
    mutate((prev) => {
      const next = placeNote(prev, tokenForRow(!!prev.numeric, midi), step, 1, {
        readback: true,
      })
      refused = next === prev
      return next
    })
    if (refused) reportRefusal("Couldn't add that note")
  }

  // Grab a note's right-edge handle → resize its duration. Anchored at the
  // note's start; the column the pointer reaches sets the new length.
  const onResizeDown = (note: RollNote): void => {
    if (!model) return
    dragRef.current = {
      mode: 'resize',
      base: model,
      grabOffset: 0,
      origPitch: note.pitch,
      origStart: note.start,
      moved: false,
    }
    beginGesture()
  }

  const onCellEnter = (midi: number, step: number): void => {
    const d = dragRef.current
    if (!d || !model) return
    // Snap interval in columns for the active division (#432 Slice 2); null when
    // the division is the native grid or doesn't divide this grid evenly — then
    // move/resize land on the raw hovered column, exactly as before.
    const interval = snapInterval(stepsPerBar(model.steps, model.bars, model.barSteps), division)
    if (d.mode === 'resize') {
      // duration = columns from the note start through the hovered column;
      // snap the END edge to the division line (min one division when snapping).
      // resizeNote floors at 1 and resizes only the grabbed note, by pitch — a note may
      // sustain under a later onset (#628). Where it caps depends on the model: the grid
      // end in a single-bar roll, the next onset in a multi-bar one, since `<...>` cannot
      // spell a mixed-duration chord inside one slot.
      //
      // ⚠ THIS COMMENT DOCUMENTED THE OPPOSITE OF WHAT HAPPENED until #1318. Multi-bar
      // rolls resized the whole chord and capped at any pitch's onset, so a drag on one
      // voice silently restretched its neighbours. The comment was right about the
      // intent and wrong about the code, which is the direction that gets believed.
      //
      // ⚠ IT CAN NOW DECLINE, returning the model unchanged — `mutate` treats that as no
      // edit, so the drag simply does not move, which is the right answer for a length
      // the document cannot carry. The handle is still drawn unconditionally though; the
      // grid gates its own on `canResizeCell` and the roll does not yet.
      let dur = step - d.origStart + 1
      if (interval) dur = Math.max(interval, snapColumn(d.origStart + dur, interval) - d.origStart)
      mutate((prev) => resizeNote(prev, d.origStart, d.origPitch, dur))
      d.moved = true
      // Kept for the commit-time re-run on release (#1331). The per-frame write stays
      // cheap and unchecked; the gesture is settled once, where a parse is affordable.
      d.askedDur = dur
      return
    }
    let newStart = Math.max(0, Math.min(step - d.grabOffset, d.base.steps - 1))
    if (interval) newStart = Math.max(0, Math.min(snapColumn(newStart, interval), d.base.steps - 1))
    const newPitch = tokenForRow(!!d.base.numeric, midi)
    // ⚠ THE BASE, NOT `prev`, and still rebuilt every frame — that part was always right.
    // What the inline build got wrong was everything it did NOT copy: it constructed a
    // bare `{ steps, bars, numeric, notes }`, so the model's `source`/`altSource`/
    // `leafSource` never reached the writer and EVERY drag re-authored the whole pattern
    // instead of editing the note's own bytes. Measured over 988,686 asks: 97.4% of moves
    // came back on the `rebuild` path, and 2.1% serialized to null and were dropped in
    // silence by `mutate`. The same literal also could not carry `gain` — a field it does
    // not name — though no corpus unit witnesses that one, so it is fixed by construction
    // rather than on evidence.
    const next = moveNote(d.base, d.origPitch, d.origStart, newPitch, newStart)
    d.moved = true
    // A refusal leaves the document exactly as it was — which is what used to happen
    // anyway when the write serialized to null, only now the op says so and
    // `canMoveNote` can be asked the same question.
    //
    // ⚠ THE VERDICT IS RECORDED HERE, ABOVE THE RETURN — THE ASK IS STILL NOT (#1452).
    // These are two different facts and the ordering below is what keeps them apart. The
    // panel used to record neither on a declined frame, so a drop the writer refused left
    // no trace at all and the commit could only ever re-ask a target the cheap rule had
    // already accepted. Recording the ASK here is the thing that must not happen; the
    // verdict costs nothing and disturbs nothing.
    const declined = next === d.base
    d.dropRefused = declined
    // The refusal is also said BEFORE the fact, on the cell itself, using the comparison
    // this frame already made (#1452). Identical values bail out of the re-render, so a
    // drag across a run of declined cells renders once, not once per frame.
    setDeclinedCell(declined ? `${midi}:${step}` : null)
    if (declined) return
    mutate(() => next)
    // Kept for the commit-time re-run on release (#1340), exactly as a resize keeps its
    // asked length. The per-frame write stays cheap and unchecked.
    //
    // ⚠ RECORDED ONLY FOR A FRAME THAT WAS ACCEPTED, and the ordering is the whole point.
    // A DECLINED drop must hold the last accepted position rather than snap home — that is
    // #1325/#1326's ruling and it is right: nothing lossy was written, so there is nothing
    // to undo, and going home would throw away a good intermediate the user can see.
    // Recording the ask above the decline check instead made every declined drag re-run its
    // refused position at commit and write the base back, which reverted exactly that.
    //
    // A resize does not face this: its frames DO land under the cheap rule, so its commit
    // re-run is undoing a write that happened. A move's declined frames never landed.
    d.askedPitch = newPitch
    d.askedStart = newStart
  }

  // Delete/Backspace and the toggle key remove the note UNDER the cursor — any
  // column it covers, as a click anywhere on a note does (#1802). The same op and
  // gate as the click-delete (#1340). One undo step; the cursor stays where it is,
  // so the next key acts on the same cell.
  const deleteNote = (note: RollNote): void => {
    let refused = false
    mutate((prev) => {
      const next = removeNote(prev, note.start, note.pitch, { readback: true })
      refused = next === prev
      return next
    })
    if (refused) reportRefusal("Couldn't delete that note")
  }

  // ⌘/Ctrl-C → copy the note at the selected cell (its shape: pitch/duration/
  // gain) to the session clipboard (#528). No-op if the selected cell is empty.
  const copyNote = (note: RollNote): void => {
    setNoteClip({ pitch: note.pitch, duration: note.duration, gain: note.gain ?? 1 })
  }

  // ⌘/Ctrl-V → stamp the clip's duration + velocity at the SELECTED cell
  // (⌘-clicked target), replacing any note already there. One undo (#528).
  const pasteClip = (): void => {
    const clip = getNoteClip()
    const sel = selectedRef.current
    if (!model || !clip || !sel || sel.kind !== 'roll') return
    let pasteRefused = false
    mutate((prev) => {
      // Replace-at-target is ONE op (`pasteNote`), so a refusal takes the clear
      // back with it instead of leaving a deletion behind. The gain is applied
      // only once the paste itself is known to have happened — `setGroupGain`
      // cannot decline, so composing it onto a refusal would write a gain
      // change for a note that was never pasted.
      // Readback for the same reason placement takes it (#1333) — one gesture, one parse.
      // A refusal takes the clear back with it, which is the whole reason paste is one op.
      const pasted = pasteNote(prev, sel.pitch, sel.start, clip.duration, { readback: true })
      if (pasted === prev) {
        pasteRefused = true
        return prev
      }
      return setGroupGain(pasted, sel.start, clip.gain)
    })
    if (pasteRefused) reportRefusal("Couldn't paste that note")
  }

  // PROVE, DON'T PREDICT — ask `parsePianoRoll` whether it really draws this
  // pattern at `scale`, never infer it from the arithmetic (#1117 refuses four).
  // Memoized per mini; the roll's parse is the dearer of the two (1.74ms/ask).
  const canDrawView = useViewProver(chunk?.miniString, pianoRollCodec.parse)

  // Grid resolution (#479, #1057): a free-zone target changes only how finely we
  // DRAW and leaves the document byte-identical. Everything else is unchanged —
  // lossless ×2/÷2 when the ratio allows (onsets byte-identical), else quantize
  // the notes onto the new grid, a no-op target returning the same model so
  // `mutate` skips. The verdict comes from the same `rollSlotState` call that
  // renders the button, so the control and the click cannot disagree.
  const scaleToSlots = (target: number): void => {
    if (!model) return
    const press = slotPress(pianoRollCodec, model, target, canDrawView)
    if (press.kind === 'view') setViewScale(press.scale)
    else if (press.kind === 'write') mutate((prev) => pianoRollCodec.quantizeTo(prev, target))
  }

  // The "Slots" control now lives in the Pattern inspector (#601) — lift this
  // grid's resolution state to it instead of rendering it in the overlay header.
  // (`scaleToSlots` is a fresh closure each render; useLiftResolution keeps it
  // ref-backed so the lift stays loop-free.)
  useLiftResolution(
    model?.steps ?? null,
    (t) => (model ? pianoRollCodec.slotState(model, t, canDrawView) : 'disabled'),
    scaleToSlots,
    onResolution,
    // #1933 — what the press would cost, asked of the op `scaleToSlots` runs. A
    // free-zone target never reaches the op, so it reports nothing.
    (t) => (model ? slotPressCost(pianoRollCodec, model, t, canDrawView) : NO_RESOLUTION_EFFECT),
  )

  // Rows top to bottom (high pitch first) — the render draws exactly these.
  const rows: number[] = []
  for (let m = range.hi; m >= range.lo; m--) rows.push(m)

  /** The cursor as a (row, col) — the selected cell, when it is a roll cell on screen. */
  const cursorCell = (): { row: number; col: number } | null => {
    const sel = selectedRef.current
    if (!sel || sel.kind !== 'roll') return null
    const midi = pitchToMidi(sel.pitch)
    const row = midi === null ? -1 : rows.indexOf(midi)
    return row < 0 || sel.start >= cols ? null : { row, col: sel.start }
  }

  /**
   * Where the cursor is before anyone has put it anywhere: the first note (earliest,
   * then highest), else the top-left cell. It is the grid's one tab stop, so Tab
   * lands on the music rather than 40 empty rows above it.
   */
  const defaultCell = (): { row: number; col: number } => {
    let best: { row: number; col: number } | null = null
    for (const n of model?.notes ?? []) {
      const midi = pitchToMidi(n.pitch)
      const row = midi === null ? -1 : rows.indexOf(midi)
      const col = model ? headColumn(n) : 0
      if (row < 0 || col < 0 || col >= cols) continue
      if (!best || col < best.col || (col === best.col && row < best.row)) best = { row, col }
    }
    return best ?? { row: 0, col: 0 }
  }

  // Set when a key moved the cursor, so the render that draws it also focuses it.
  // Held until the cursor cell EXISTS: an octave move can put the note on a row the
  // sticky range only draws a render later (#1803).
  const focusCursorRef = React.useRef(false)
  const gridRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!focusCursorRef.current) return
    const cell = gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"] > [data-roll-cell]')
    if (!cell) return
    focusCursorRef.current = false
    cell.focus()
  })

  // Move, transpose or resize the note under the cursor by key (#1803): the drag's
  // own writers, under the read-back gate the drag's commit applies, so a key can
  // write nothing a drag would refuse. One key, one write, one undo step. The
  // cursor follows the note. The step is the roll's snap division, the unit a drag
  // snaps to (Stave has no separate nudge value).
  const editNote = (note: RollNote, edit: NoteEdit, dryRun: boolean): boolean => {
    if (!model) return false
    const step = snapInterval(stepsPerBar(model.steps, model.bars, model.barSteps), division) ?? 1
    const head = headColumn(note)
    const midi = pitchToMidi(note.pitch)
    if (midi === null) return false
    const follow = (pitch: string, start: number): void => {
      focusCursorRef.current = true
      select({ kind: 'roll', pitch, start })
    }
    if (edit === 'shorter' || edit === 'longer') {
      // The drag's rule: a whole number of columns, the END edge on a division line.
      const cols = Math.max(1, Math.round(note.duration))
      let dur = edit === 'longer' ? cols + step : cols - step
      if (step > 1) dur = Math.max(step, snapColumn(head + dur, step) - head)
      if (dur < 1 || dur === cols) return false
      if (dryRun) return true
      const settled = resizeNote(model, note.start, note.pitch, dur, { readback: true })
      if (settled === model) {
        reportRefusal("Couldn't set that length")
        return true
      }
      mutate(() => settled)
      follow(note.pitch, head)
      return true
    }
    if (edit === 'octaveUp' || edit === 'octaveDown') {
      // On a degree roll (`n()`, or any `.scale()`) a row is a scale step, so twelve
      // rows is not an octave: measured, one row up on `n("0 ~ ~ 7").scale("C:major")`
      // writes `1`. Refused rather than guessed.
      const degrees = !!model.numeric || (chunk ? readChainMethod(chunk, ['scale']) !== null : false)
      if (degrees) {
        // The palette does not offer it; the key is claimed and says why.
        if (dryRun) return false
        emitLog({
          level: 'warn',
          runtime: 'stave',
          message:
            "Couldn't move that note an octave — on a scale pattern a row is one scale step, so twelve rows isn't an octave, left unchanged.",
        })
        return true
      }
    }
    let toMidi = midi
    let toStart = head
    if (edit === 'rowUp') toMidi = midi + 1
    else if (edit === 'rowDown') toMidi = midi - 1
    else if (edit === 'octaveUp') toMidi = midi + 12
    else if (edit === 'octaveDown') toMidi = midi - 12
    else if (edit === 'nudgeLeft') toStart = head - step
    else if (edit === 'nudgeRight') toStart = head + step
    if (step > 1) toStart = snapColumn(toStart, step)
    toStart = Math.max(0, Math.min(toStart, model.steps - 1))
    if (toMidi === midi && toStart === head) return false
    if (toMidi < 0 || toMidi > 127) return false
    if (dryRun) return true
    const toPitch = tokenForRow(!!model.numeric, toMidi)
    const settled = moveNote(model, note.pitch, note.start, toPitch, toStart, { readback: true })
    if (settled === model) {
      reportRefusal("Couldn't move that note there")
      return true
    }
    mutate(() => settled)
    follow(toPitch, toStart)
    return true
  }

  // The roll's keys are commands (#1801) and act at the cursor (#1802). A dry run
  // answers whether one applies now — the palette offers only what would act.
  // `fromKey`: a key pressed on the grid's tab stop before any cursor exists acts
  // on that cell; the palette, with nothing selected, acts nowhere.
  const runGesture = (action: GridAction, dryRun: boolean, fromKey = false): boolean => {
    if (!model || rows.length === 0 || cols === 0) return false
    const at = cursorCell() ?? (fromKey ? defaultCell() : null)
    if (isCursorMove(action)) {
      if (dryRun) return true
      const next = moveCursor(at ?? defaultCell(), action, rows.length, cols)
      focusCursorRef.current = true
      select({ kind: 'roll', pitch: tokenForRow(!!model.numeric, rows[next.row]), start: next.col })
      return true
    }
    if (!at) return false
    // A look-only view (#1975) can be walked and copied from, and nothing else: an edit
    // key is not offered, rather than run and refused with a console line each press.
    if (model.lookOnly && action !== 'copy') return false
    const midi = rows[at.row]
    const note = noteAt(model, midi, at.col)
    if (isNoteEdit(action)) return note ? editNote(note, action, dryRun) : false
    switch (action) {
      case 'remove':
        if (!note) return false
        if (!dryRun) deleteNote(note)
        return true
      case 'copy':
        if (!note) return false
        if (!dryRun) copyNote(note)
        return true
      case 'paste':
        // Paste lands on the SELECTED cell (#528), so it needs a real cursor.
        if (!getNoteClip() || !cursorCell()) return false
        if (!dryRun) pasteClip()
        return true
      case 'toggle':
        // Exactly what a click on this cell does: a note → delete it; an empty cell
        // → place one, where the view takes a new note at all (#1070).
        if (note) {
          if (!dryRun) deleteNote(note)
          return true
        }
        if (!placesNotes) return false
        if (!dryRun) placeAt(midi, at.col)
        return true
    }
  }
  const runGestureRef = React.useRef(runGesture)
  runGestureRef.current = runGesture
  React.useEffect(
    () => mountGridGestures(GRID_SCOPE.pianoRoll, (action, dryRun) => runGestureRef.current(action, dryRun)),
    [],
  )

  // labels that would run together on narrow steps are hidden, bar numbers first (#1843).
  // Above the no-model return: a hook runs on every render or not at all.
  const rulerRef = React.useRef<HTMLDivElement>(null)
  useRulerFit(rulerRef, 'data-roll-ruler-label')
  // On a phone (#2006): columns a finger can hit, the ruler as the sideways scroll
  // handle, and a key bed that stays put. See `phoneGrid`.
  const phoneGrid = usePhoneGrid()
  const rulerPan = useRulerPan(scrollRef, phoneGrid.phone)
  /** a column's narrowest width per unit of weight */
  const stepMin = phoneGrid.phone ? PHONE_STEP_MIN : 12
  /** what keeps a row's key in place while its columns scroll under it */
  const pinned: React.CSSProperties = phoneGrid.phone
    ? { position: 'sticky', left: 0, zIndex: 2, background: 'var(--background, #0f0f12)' }
    : {}

  if (!model) {
    return React.createElement(VisualEditStandby, {
      panel: PIANO_ROLL_TAB_ID,
      hint:
        chunk && opensPianoRoll(chunk)
          ? "This melody isn't grid-editable — edit it as code."
          : ROLL_HINT,
      icon: 'music',
    })
  }

  const tabCell = cursorCell() ?? defaultCell()
  // A line before each bar after the first, so a pattern made longer by the `+` reads
  // as bars rather than one run of columns (#1824).
  //
  // ⚠ A SHADOW INTO THE EXISTING 1px GAP, NOT A MARGIN. The sequencer's 8px gap was tried
  // first and MEASURED: on 32 columns at 1280px it narrowed every cell 2.6px (to 18.3px),
  // which put a cell's centre on its note's 8px resize handle — a grab-to-move became a
  // resize (roll-move-readback went red). A roll's cells are flexible and already narrow;
  // a bar marker must not take width from them.
  //
  // Each bar may hold its own count of cells (#1827); `drawnLayout` says where bars start
  // and how wide a cell is, so every bar is drawn the same width whatever its count.
  const layout = drawnLayout(model, cols)
  // drawn from what the TEXT reads as — the kept model's source is the text before the edit
  const { stepStarts, ruler } = rollSteps(linesModel(model, read), cols)
  // THREE LINE WEIGHTS, all in that same gap (#1841): a bar line, then a lighter line
  // where a step AS WRITTEN begins, then a plain column. Colour carries the difference,
  // never width, for the reason above.
  const barLine = (c: number): string | undefined =>
    layout.barStart(c)
      ? '-2px 0 0 0 var(--foreground, #e6e6ea)'
      : c > 0 && stepStarts.has(c)
        ? '-2px 0 0 0 var(--foreground-muted, #6a6a90)'
        : undefined
  /** a cell's flex box: weighted so a bar of 3 is as wide as a bar of 4 */
  const cellBox = (c: number): React.CSSProperties => {
    const w = layout.weight(c)
    return { flex: `${w} ${w} 0`, minWidth: stepMin * w, maxWidth: 44 * w }
  }

  return (
    <div
      data-bottom-panel-tab="piano-roll"
      data-look-only={model.lookOnly ? model.lookOnly.gate : undefined}
      // Focusable, but not a tab stop: the grid's one tab stop is its cursor cell
      // (#1802, ARIA grid pattern).
      tabIndex={-1}
      // Cell pointerdowns call preventDefault (blocks default focus, P200), so
      // focus in the capture phase — the pressed CELL, which is where the cursor
      // moves (#1802), else the panel, so ⌘Z still finds it (#432, #1800).
      onPointerDownCapture={(e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-roll-cell]')
        ;(cell ?? (e.currentTarget as HTMLElement)).focus({ preventScroll: true })
      }}
      onKeyDown={(e) => {
        // Only from a cell: Enter on the track chip's button, or a key in its
        // rename box, is that control's own.
        if (!(e.target as HTMLElement).closest?.('[data-roll-cell]')) return
        // Matched exactly, modifiers included, against the keys the host has
        // bound (#1801) — so ⌘⇧C (Chrome's element picker) and ⌘⇧V (paste
        // without formatting) are not copy and paste (#1425), and ⌥⌫ is not
        // delete. A matched key is claimed even when there is nothing to act on,
        // as the raw handler before it did.
        const action = matchGridKey(GRID_SCOPE.pianoRoll, e.nativeEvent)
        if (!action) return
        e.preventDefault()
        e.stopPropagation()
        runGesture(action, false, true)
      }}
      style={{
        position: 'relative',
        height: '100%',
        // a column: the header line, then the scroll area taking what is left (#1844)
        display: 'flex',
        flexDirection: 'column',
        outline: 'none', // focusable for the Delete key (#432); scroll is on the inner div (#518)
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        touchAction: 'none',
      }}
    >
      {/* THE HEADER LINE: the track chip, and beside it the one statement for a view that
          cannot take a new note. The chip was an overlay pinned top-left, to cost no
          height, but it sat over the first pitch row's key and over this statement's
          first words (#1844). It takes its own line now, as the sequencer's does; the
          statement shares that line, so a roll that shows it grows by only the chip's
          extra few pixels. */}
      <div data-roll-header style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        {/* Track identity (#589) — the bound track's colour dot + name. Click the dot to
            recolour, double-click the name to rename. */}
        <PatternTrackChip />
        <TurnHint show={phoneGrid.upright && rulerPan.inView.more} />
        {/* ONE statement for a view that cannot take a new note (#1070) — the same
            fact the grid states, on the surface that carries 18,386 of the corpus's
            19,098 inert roll placements. Moving, resizing, deleting and velocity
            all still work on the notes that are here. */}
        {model.lookOnly && (
          <div
            data-roll-look-only
            style={{
              fontSize: 11,
              color: 'var(--foreground-muted, #a0a0aa)',
              padding: '0 8px 0 0',
            }}
          >
            {lookOnlyLine(model.lookOnly)}
          </div>
        )}
        {sounds && (
          // #2226 — the key to the colours: which sound each colour is
          <div
            data-roll-sound-key
            title="Each note is coloured by the sound it plays. A striped note plays a different sound on different passes."
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)' }}
          >
            {sounds.names.map((n) => (
              <span key={n} data-roll-sound-key-item={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorForTrack(n), flexShrink: 0 }} />
                {n}
              </span>
            ))}
          </div>
        )}
        {!placesNotes && !model.lookOnly && (
          <div
            data-roll-no-placement
            style={{
              fontSize: 11,
              color: 'var(--foreground-muted, #a0a0aa)',
              padding: '0 8px 0 0',
            }}
          >
            Edits the notes already here — to add one, use the code view.
          </div>
        )}
      </div>
      {/* "Slots" moved to the Pattern inspector (#601) and the Note Color toggle
          to the editor Settings tab (#602) — the old top-right overlay is gone,
          so the piano roll keeps its full height for pitch rows. */}
      <div
        // always-visible (non-overlay) scrollbar when the rows overflow the
        // panel, styled in globals.css (the editor ships no CSS) — #pattern-scrollbar.
        data-pattern-scroll
        ref={scrollRef}
        // on a phone there is no padding at the top or the left: the ruler and the key
        // bed are pinned at the padding's edge, and rows scrolling past would show in
        // the gap beside them
        style={{ padding: phoneGrid.phone ? '0 16px 16px 0' : 16, flex: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box' }}
      >
        <div
          // paddingRight: room for the `+` past the last column (#1824), so a long
          // pattern's cells never grow into it
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1, width: '100%', paddingRight: 28, boxSizing: 'border-box', ...(phoneGrid.phone ? PHONE_GRID_WIDTH : {}) }}
          onPointerLeave={() => setHoveredMidi(null)}
        >
          {/* THE RULER (#1841): counts the written steps, `1, 1.2, …, 2`, laid out like a
              row — the key bed's width, the same weights — so each label sits over its
              column. Visual only, hidden from the accessibility tree.

              ⚠ IT SITS IN THE SCROLL AREA'S TOP PADDING, TAKING NO HEIGHT. As a plain
              row it pushed every pitch row down 13px (its 12 + the 1px row gap), which
              cost the roll most of a visible row and put `snap-division`'s c3 row past
              the bottom of a 720px viewport, where the drag's press landed on nothing.
              The padding is 16px, so the -13px margin keeps the rows exactly where they
              were before the ruler existed. */}
          {phoneGrid.phone && (
            // which part of the pattern is on screen: as wide as the panel, not as the
            // pattern, and it stays put both ways while the rows scroll
            // (past the key bed and its gap, which is pinned over this row)
            <div style={{ position: 'sticky', left: (model.numeric ? 36 : 40) + 6, top: 0, zIndex: 4, width: 0, height: 0 }}>
              <InViewBar inView={rulerPan.inView} width={rulerPan.viewWidth - 16 - (model.numeric ? 36 : 40) - 6} />
            </div>
          )}
          <div
            ref={rulerRef}
            data-roll-ruler
            aria-hidden="true"
            {...rulerPan.handlers}
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 6,
              // on a phone the ruler is tall enough to hold, so it takes real height and
              // stays at the top while the pitch rows scroll under it
              ...(phoneGrid.phone
                ? { height: PHONE_RULER_HEIGHT, position: 'sticky', top: 0, zIndex: 3, background: 'var(--background, #0f0f12)', touchAction: 'none', cursor: 'grab' }
                : { height: 12, marginTop: -13 }),
            }}
          >
            <div style={{ width: model.numeric ? 36 : 40, flex: '0 0 auto', alignSelf: 'stretch', ...pinned }} />
            <div style={{ display: 'flex', gap: 1, flex: 1, minWidth: 0 }}>
              {Array.from({ length: cols }, (_, c) => {
                const label = ruler.get(c)
                const isBar = label !== undefined && !label.includes('.')
                return (
                  <div key={c} style={{ ...cellBox(c), position: 'relative', height: '100%' }}>
                    {label !== undefined && (
                      <span
                        data-roll-ruler-label={c}
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
          {/* The pitch rows are the grid (#1802); the velocity lane below is not a row of it. */}
          <div
            ref={gridRef}
            role="grid"
            aria-label="Piano roll"
            style={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
          {rows.map((midi) => {
          // Piano black/white striping only makes sense for note-name rows;
          // for numeric patterns a row is a raw value (MIDI or degree), not a
          // key, so stripe uniformly and let the numeric label carry the pitch.
          const black = !model.numeric && isBlackKey(midi)
          const hovered = midi === hoveredMidi
          const keyC = cLabel(midi)
          return (
            <div
              key={midi}
              role="row"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              // Don't chase hover mid-drag — a re-render here would interrupt the
              // note move/resize gesture (which is driven by cell pointerenter).
              onPointerEnter={() => {
                if (!dragRef.current && !velRef.current) setHoveredMidi(midi)
              }}
            >
              {model.numeric ? (
                // Numeric rows are raw values/degrees, not piano keys — keep the
                // value label (no keyboard graphic).
                <span
                  role="rowheader"
                  style={{
                    width: 36,
                    fontSize: 9,
                    textAlign: 'right',
                    color: 'var(--foreground, #e6e6ea)',
                    ...pinned,
                  }}
                >
                  {tokenForRow(true, midi)}
                </span>
              ) : (
                // Graphical piano key (#430). Fixed-width key bed so the note
                // cells stay column-aligned across every row (PV120 single
                // vertical axis — same `rows` midi list). White keys fill the
                // bed light; a black key is a shorter dark bar overlaid on the
                // BACK (left) of the bed, leaving the white front edge visible —
                // the keyboard look. C rows are labelled (C is always white).
                <span
                  role="rowheader"
                  aria-label={noteDisplayName(midi)}
                  data-roll-key={midi}
                  data-roll-key-black={black ? 'true' : undefined}
                  // Press-and-hold to audition (sustains while held); drag onto
                  // another key to glissando (#633).
                  title={`Play ${noteDisplayName(midi)}`}
                  onPointerDown={(e) => {
                    e.preventDefault() // don't start a text selection / steal focus
                    startHold(midi)
                  }}
                  onPointerEnter={() => moveHold(midi)}
                  style={{
                    position: 'relative',
                    width: 40,
                    height: 16,
                    flex: '0 0 auto',
                    boxSizing: 'border-box',
                    borderRadius: '2px 3px 3px 2px',
                    border: '1px solid var(--border, #3a3a42)',
                    background: hovered ? '#cdd3ff' : '#e8e8ec',
                    color: '#3a3a42',
                    fontSize: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: 3,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    touchAction: 'none', // let a touch-drag glissando across keys
                    // pinned on a phone (#2006); the key keeps its own colour
                    ...(phoneGrid.phone ? { position: 'sticky', left: 0, zIndex: 2 } : {}),
                  }}
                >
                  {black && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: '62%',
                        background: hovered ? '#3a3a44' : '#1b1b20',
                        borderRadius: '1px 2px 2px 1px',
                      }}
                    />
                  )}
                  <span style={{ position: 'relative' }}>{keyC ?? ''}</span>
                </span>
              )}
              <div role="none" style={{ display: 'flex', gap: 1, flex: 1, minWidth: 0 }}>
                {Array.from({ length: cols }, (_, step) => {
                  const hit = overlapAt(model, midi, step)
                  const note = hit?.note
                  const on = note !== undefined
                  const isHead = on && headColumn(note!) === step
                  const isTail = on && tailColumn(note!) === step
                  // the ⌘-clicked copy/paste cell — highlighted whether or not a
                  // note sits there, so an empty paste target is visible (#528).
                  const isSel =
                    selected?.kind === 'roll' &&
                    selected.start === step &&
                    selected.pitch === tokenForRow(!!model.numeric, midi)
                  // On a view that takes no new note, an empty cell says so
                  // (#1070). A cell holding a note keeps every gesture it had —
                  // move, resize, delete, velocity — and so does ⌘-click, which
                  // selects a paste target without editing anything.
                  // …and on a look-only view (#1975) no cell takes a gesture, a note's
                  // own included: the same inert cell, for the model's own reason.
                  const canPlace = !model.lookOnly && (on || placesNotes)
                  // The cell a move drag is over that the writer declines (#1452). Only
                  // ever one at a time, and only during a drag.
                  const dropRefused = declinedCell === `${midi}:${step}`
                  // THE NOTE'S LENGTH IS FIXED HERE, THOUGH THE CELL IS NOT (#1322).
                  // Move, delete, select and the velocity drag all still work on this
                  // note — only the length handle is gone, because no length this drag
                  // can reach writes anything. So this marks the missing affordance and
                  // must NOT disable the cell: `aria-disabled` would announce that
                  // nothing works, which is false and is the louder error of the two.
                  const resizeInert = on && isTail && resizable?.has(note!) === false
                  const isTab = tabCell.col === step && rows[tabCell.row] === midi
                  return (
                    // A gridcell holding one toggle button (ARIA grid pattern: a cell
                    // with a single widget puts focus on the widget). The button keeps
                    // `aria-pressed` — a gridcell may not carry it, a button may — and
                    // the cell carries the cursor as `aria-selected` (#1802).
                    <div
                      key={step}
                      role="gridcell"
                      aria-selected={isSel}
                      data-roll-step-start={step > 0 && !layout.barStart(step) && stepStarts.has(step) ? 'true' : undefined}
                      style={{ display: 'flex', ...cellBox(step), boxShadow: barLine(step) }}
                    >
                    <button
                      type="button"
                      // One tab stop for the whole grid, and it moves with the cursor.
                      tabIndex={isTab ? 0 : -1}
                      // Focus IS the cursor (ARIA grid pattern): Tab landing here, or a
                      // focus moved by any other means, puts the cursor on this cell.
                      onFocus={() => {
                        if (!isSel) select({ kind: 'roll', pitch: tokenForRow(!!model.numeric, midi), start: step })
                      }}
                      aria-pressed={on}
                      // A column a longer note sounds through reads as that note, not
                      // as an empty cell (#1802) — the sequencer's wording.
                      aria-label={
                        on && !isHead
                          ? `${tokenForRow(!!model.numeric, midi)} step ${step + 1}, held from step ${headColumn(note!) + 1}`
                          : `${tokenForRow(!!model.numeric, midi)} step ${step + 1}`
                      }
                      // THE SELECTION IS SAID, NOT ONLY DRAWN (#1080) — now as the
                      // gridcell's `aria-selected`, above. #1080 held back from
                      // `aria-selected` because a grid role commits the panel to a
                      // roving tab stop and arrow keys; #1802 keeps that contract.
                      data-roll-cell={`${midi}:${step}`}
                      data-roll-selected={isSel ? 'true' : undefined}
                      data-playing={step === playingStep ? 'true' : undefined}
                      data-roll-cell-inert={canPlace ? undefined : 'true'}
                      data-roll-drop-refused={dropRefused ? 'true' : undefined}
                      data-roll-resize-inert={resizeInert ? 'true' : undefined}
                      aria-disabled={canPlace ? undefined : true}
                      // Two different absences, and a cell can only carry one tooltip.
                      // `canPlace` false is the wider one — the view takes no new note
                      // anywhere — so it wins; a cell in that state holds no note and
                      // therefore has no length handle to explain either.
                      //
                      // ⚠ THE SECOND REASON IS WHY #1322 EXISTS. A refused resize left
                      // the document alone, correctly, and said nothing — so a note whose
                      // length is fixed looked exactly like one whose drag was broken.
                      // Removing the handle makes the absence visible; this makes it
                      // legible.
                      title={
                        model.lookOnly
                          ? lookOnlyLine(model.lookOnly)
                          : !canPlace
                          ? 'This pattern edits its existing notes — add notes in the code view.'
                          : resizeInert
                            ? 'This note has no other length the pattern can hold — change its length in the code view.'
                            : undefined
                      }
                      onPointerDown={(e) => {
                        e.preventDefault()
                        // ⌘/Ctrl-click is selection, not an edit — it stays
                        // available on a cell that cannot take a note.
                        if (!canPlace && !(e.metaKey || e.ctrlKey)) return
                        onCellDown(midi, step, e)
                      }}
                      onPointerEnter={() => onCellEnter(midi, step)}
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: 16,
                        padding: 0,
                        border:
                          step === playingStep
                            ? '1px solid var(--foreground, #e6e6ea)'
                            : '1px solid var(--border, #3a3a42)',
                        borderRadius: 2,
                        // The note is drawn by the fill BELOW, not by this background, so
                        // that a note occupying part of a column occupies part of the box
                        // (#1074). The cell keeps its own empty-cell background.
                        background:
                          step === playingStep
                            ? 'var(--background, #34343c)'
                            : black
                              ? 'var(--background, #1c1c20)'
                              : 'var(--background-elevated, #26262c)',
                        cursor: dropRefused ? 'not-allowed' : model.lookOnly ? 'default' : 'pointer',
                        // The selection ring (#432) is NOT here — see the overlay that
                        // is the cell's last child (#1077).
                      }}
                    >
                      {hit && (
                        // The note itself. WIDTH is how much of this column it sounds
                        // for and LEFT is where in the column it begins — the same
                        // geometry the step grid draws (#1056), from the same shared
                        // `columnOverlap` rule, with the offset that only the roll needs
                        // because only a roll note carries a fractional start.
                        //
                        // A non-head is dimmed, which is what this surface already did
                        // via the button's own opacity; moving it onto the fill keeps the
                        // cell's playhead border and selection ring at full strength.
                        <span
                          data-roll-fill
                          data-roll-sustain={!isHead ? 'true' : undefined}
                          data-roll-note-sounds={sounds ? (sounds.byNote.get(note!) ?? []).join(' ') : undefined}
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${hit.overlap.offset * 100}%`,
                            width: `${hit.overlap.extent * 100}%`,
                            background:
                              colorMode === 'velocity'
                                ? velocityColor(note!.gain ?? 1)
                                : sounds
                                  ? soundFill(sounds.byNote.get(note!) ?? [])
                                  : 'var(--accent, #6ea8fe)',
                            opacity: isHead ? 1 : 0.7,
                            pointerEvents: 'none',
                          }}
                        />
                      )}
                      {isHead && (
                        // Note name inside the bar (#605) — rendered on the head
                        // cell, clipped to THE BAR so it never spills onto a
                        // neighbour or onto the empty part of its own column.
                        // pointer-events:none so it never blocks the cell's
                        // pointer gestures (paint/drag) or the tail resize handle.
                        //
                        // Positioned against the FILL's box, not the cell's (#1078).
                        // While the note WAS the whole cell the two rectangles
                        // coincided and nothing had to choose; once the note became a
                        // child span occupying only its overlap (#1076), `inset: 0`
                        // put the label on empty background BESIDE the bar it names —
                        // 12 of 4842 corpus notes, every one of them a note that
                        // begins mid-column. Same two numbers the bar uses, so the
                        // two cannot drift apart again.
                        <span
                          data-roll-note-name
                          // aria-hidden holds, checked rather than assumed (#1080):
                          // this renders `noteDisplayName(midi)`, which is
                          // `midiToPitch(midi)` capitalised, and the cell's own
                          // aria-label opens with `tokenForRow` — the same
                          // `midiToPitch(midi)`. The name is already announced.
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${hit!.overlap.offset * 100}%`,
                            width: `${hit!.overlap.extent * 100}%`,
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: 3,
                            fontSize: 8,
                            lineHeight: 1,
                            fontWeight: 600,
                            color: '#fff',
                            textShadow: '0 1px 1px rgba(0,0,0,0.55)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            pointerEvents: 'none',
                          }}
                        >
                          {model.numeric ? String(midi) : noteDisplayName(midi)}
                        </span>
                      )}
                      {isTail && resizable?.has(note!) && (
                        // RENDERED ONLY WHERE A DRAG WOULD WRITE (`resizable`, #1322),
                        // which is the standing rule for every affordance this panel
                        // draws (#1064/#1070/#1089). 1,861 of 5,480 corpus notes have no
                        // length the document can carry, and until now every one of them
                        // drew a handle that took the cursor and did nothing.
                        //
                        // The resize handle sits at the BAR's trailing edge, not the
                        // cell's (#1078). A note that ends mid-column used to put its
                        // handle at the far side of the column — floating in empty
                        // background past the end of the note it resizes, which is a
                        // handle you cannot aim at because it is not on the thing.
                        // 18 of 4842 corpus notes.
                        //
                        // WIDTH IS CLAMPED TO THE BAR: a `@0.25` note in a
                        // minimum-width (12px) column is a 3px bar, and a fixed 8px
                        // handle would be wider than the note, overhanging backwards
                        // past its own start. The handle is never wider than what it
                        // resizes. What that costs — a very small note draws a very
                        // small handle — is paid back by the pointer-down grab zone
                        // below, which is floored and invisible: what you SEE is the
                        // note's own trailing edge, what you can HIT is larger.
                        <span
                          data-roll-resize={`${midi}:${note!.start}`}
                          aria-label={`resize ${tokenForRow(!!model.numeric, midi)}`}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onResizeDown(note!)
                          }}
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            right: `${(1 - hit!.overlap.offset - hit!.overlap.extent) * 100}%`,
                            width: `min(${RESIZE_ZONE_PX}px, ${hit!.overlap.extent * 100}%)`,
                            cursor: 'ew-resize',
                            background: 'var(--foreground, #e6e6ea)',
                            opacity: 0.45,
                            borderRadius: '0 2px 2px 0',
                          }}
                        />
                      )}
                      {isSel && (
                        // Selection ring (#432), drawn as the LAST child rather than as
                        // the cell's own inset shadow (#1077).
                        //
                        // An inset box-shadow paints with the element's background, and
                        // every child paints above it. That cost nothing while the note
                        // WAS the background; once the note became a child span (#1074)
                        // the ring was covered on every cell holding a note — which is
                        // every cell you would want to select. Measured against the
                        // previous build: 424 white ring pixels on a selected note cell
                        // → 0, while a selected EMPTY cell was unaffected, which is
                        // exactly why every existing assertion stayed green.
                        //
                        // Drawn last so it frames whatever is underneath — note, name,
                        // resize handle or bare cell — and never has to know which.
                        <span
                          data-roll-selection
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            // Laid out against the PADDING box, so the ring sits a pixel
                            // further in than the old inset shadow did — measured 403
                            // white frame pixels against the original 424. Growing the
                            // overlay by the border width to close that gap was tried and
                            // MEASURED WORSE: at `inset: -1` the ring is drawn outside the
                            // cell and bleeds across the 1px lane gap (2156). The pixel
                            // nearest the border is not worth a ring that leaves its cell.
                            inset: 0,
                            borderRadius: 2,
                            boxShadow: 'inset 0 0 0 2px var(--foreground, #e6e6ea)',
                            pointerEvents: 'none',
                          }}
                        />
                      )}
                    </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
          </div>
        {!model.lookOnly && (
          <ExtendHandle length={length} gridRef={gridRef} cellAttr="data-roll-cell" cols={cols} lastBarCols={layout.lastBarCols} />
        )}
        {lane && (
          // #2226 — THE SOUND LANE: the track's sound pattern as its own row, drawn on
          // the roll's own columns (the same weighted slots a pitch row has) with the
          // pattern's own divisions. A block is a segment in each column it covers; any
          // of them opens the picker, and a pick writes only that block's name. A
          // pattern no single pass draws truly says why instead.
          <div data-roll-sound-lane style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <span
              title="The sound each part of the bar plays"
              style={{ width: model.numeric ? 36 : 40, flex: '0 0 auto', fontSize: 9, textAlign: 'right', color: 'var(--foreground-muted, #a0a0aa)' }}
            >
              snd
            </span>
            {lane.readOnly ? (
              <div data-roll-sound-lane-read-only style={{ flex: 1, fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)' }}>
                {lane.readOnly}
              </div>
            ) : (
              <div role="none" style={{ display: 'flex', gap: 1, flex: 1, minWidth: 0, height: 20 }}>
                {Array.from({ length: cols }, (_, c) => (
                  <div key={c} style={{ ...cellBox(c), position: 'relative', height: '100%' }}>
                    {laneSegments[c]?.map(({ block: i, from, to, first }) => {
                      const b = lane.blocks[i]
                      const editable = !!b.at && !model.lookOnly
                      const style: React.CSSProperties = {
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${(from - c) * 100}%`,
                        width: `${(to - from) * 100}%`,
                        padding: first ? '0 3px' : 0,
                        border: 'none',
                        borderRadius: 2,
                        background: colorForTrack(b.name),
                        color: '#111',
                        fontSize: 9,
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: editable ? 'pointer' : 'default',
                      }
                      const title = editable ? `${b.name} — click to change this part's sound` : b.name
                      if (!first || !editable) {
                        return (
                          <span
                            key={i}
                            data-roll-sound-block={first ? b.name : undefined}
                            data-roll-sound-segment={b.name}
                            title={title}
                            onClick={editable ? () => laneToggles.current.get(i)?.() : undefined}
                            style={{ ...style, display: 'block' }}
                          >
                            {first ? b.name : null}
                          </span>
                        )
                      }
                      return (
                        <SoundPickerMenu
                          key={i}
                          label="Sound"
                          groups={instruments ?? INSTRUMENTS}
                          value={b.name}
                          placeholder={b.name}
                          onChange={(v) => writeBlock(b, v)}
                          renderTrigger={({ ref, open, toggle }) => {
                            laneToggles.current.set(i, toggle)
                            return (
                              <button
                                ref={ref}
                                type="button"
                                data-roll-sound-block={b.name}
                                data-roll-sound-segment={b.name}
                                aria-expanded={open}
                                title={title}
                                onClick={toggle}
                                style={style}
                              >
                                {b.name}
                              </button>
                            )
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Not on a look-only view (#1975): its levels are never read from the code, so
            the lane would draw every note at full level whatever the pattern says. */}
        {gainInScope(model) && !model.lookOnly && (
          <div
            data-roll-velocity-lane
            // The velocity lane is the last child INSIDE the scroll area, so it
            // scrolls together with the pitch rows (the #604 sticky / #624 footer
            // pinning is reverted): the always-visible scrollbar lets you scroll
            // straight down to it, so it no longer needs to be pinned or pulled
            // out as a footer.
            style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 8 }}
          >
          <span
              // The reason, stated rather than left to a dead gesture (#1089). The lane
              // still shows the pattern's real gains; what it cannot do here is change
              // them, because a note starting mid-column has no gain slot of its own.
              title={
                gainWritable
                  ? undefined
                  : VELOCITY_READ_ONLY
              }
              style={{
                width: 36,
                fontSize: 9,
                textAlign: 'right',
                color: 'var(--foreground-muted, #a0a0aa)',
              }}
            >
              vel{gainWritable ? '' : ' ·'}
            </span>
            <div style={{ display: 'flex', gap: 1, flex: 1, minWidth: 0, height: LANE_HEIGHT }}>
              {Array.from({ length: cols }, (_, col) => {
                // Prefer the note that STARTS at this column (it keeps its own
                // velocity); otherwise a held note (`@n`) sustaining over the
                // column fills the slot with its velocity. So extending a note
                // copies its velocity onto the empty slots it covers, while a
                // slot that already has its own note keeps that note's velocity.
                const covering =
                  model.notes.find((n) => n.start === col) ??
                  model.notes.find((n) => n.start < col && col < n.start + n.duration)
                const g = covering ? gainAtStart(model, covering.start) : 1
                // SPLIT THE COLUMN when more than one group sounds through it AND those
                // groups are sequential — one ends where the next begins (#1086). Then
                // each gets its own bar at its own offset/extent, the geometry the roll's
                // own rows have drawn since #1074. A group that begins mid-column had no
                // bar at all before this: the lane asked `n.start === col`, an equality a
                // fractional start never satisfies.
                //
                // Groups that overlap IN TIME are NOT split — a stack's simultaneous
                // voices are not sequential along the column's time axis, so laying them
                // out that way stacks one bar on another. 129 of the corpus's 137
                // multi-group columns are that case and they keep today's single bar;
                // what they should show instead is #1088, a layout question.
                const split = sequentialColumnGroups(model.notes, col)
                return (
                  <div
                    key={col}
                    data-vel-col={col}
                    // The gesture is offered only where the writer accepts it (#1089).
                    // On a pattern whose gain the writer declines the bars still draw —
                    // they carry the gains the pattern really has — but there is no
                    // cursor and no handler, because both would promise a write that
                    // cannot happen.
                    data-vel-readonly={gainWritable ? undefined : 'true'}
                    // Stated where the pointer actually goes. The panel's other refusal
                    // ("to add one, use the code view") is about PLACEMENT and covers 30
                    // of these 33 patterns, but it does not say anything about velocity —
                    // a reader takes it to mean notes cannot be ADDED, not that the ones
                    // here cannot be made louder. So the lane owes its own reason.
                    title={
                      gainWritable
                        ? undefined
                        : VELOCITY_READ_ONLY
                    }
                    onPointerDown={
                      covering && gainWritable
                        ? (e) => {
                            e.preventDefault()
                            onBarDown(covering.start, e)
                          }
                        : undefined
                    }
                    style={{
                      position: 'relative',
                      ...cellBox(col),
                      boxShadow: barLine(col),
                      height: '100%',
                      borderRadius: 2,
                      background: 'var(--background-elevated, #26262c)',
                      cursor: covering && gainWritable ? 'ns-resize' : 'default',
                    }}
                  >
                    {split
                      ? split.map((grp) => {
                          const gg = gainAtStart(model, grp.start)
                          return (
                            <span
                              key={grp.start}
                              data-vel-bar={col}
                              data-vel-group={grp.start}
                              data-gain={gg}
                              style={{
                                position: 'absolute',
                                // laid against the column's own box, like the note fill
                                left: `${grp.offset * 100}%`,
                                width: `${grp.extent * 100}%`,
                                bottom: 0,
                                height: `${clamp01(gg) * 100}%`,
                                background:
                                  colorMode === 'velocity' ? velocityColor(gg) : 'var(--accent, #6ea8fe)',
                                borderRadius: 2,
                                // VISUAL ONLY, and still deliberately so. Every column
                                // that splits today sits in a pattern with a
                                // fractional-start note, and `serializeRollGain` skips
                                // exactly those — the gain mini is one slot per column,
                                // and a note beginning mid-column has no slot of its own.
                                // #1089 has since made the whole column read-only in that
                                // case, so there is no drag here to divide per group; a
                                // per-bar drag becomes worth building the day a split
                                // column appears in a pattern the gain writer accepts,
                                // and not before.
                                pointerEvents: 'none',
                              }}
                            />
                          )
                        })
                      : covering && (
                          // bottom-anchored bar = the note group's velocity (full = neutral)
                          <span
                            data-vel-bar={col}
                            data-vel-group={covering.start}
                            data-gain={g}
                            style={{
                              position: 'absolute',
                              left: 1,
                              right: 1,
                              bottom: 0,
                              height: `${clamp01(g) * 100}%`,
                              background: colorMode === 'velocity' ? velocityColor(g) : 'var(--accent, #6ea8fe)',
                              borderRadius: 2,
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
