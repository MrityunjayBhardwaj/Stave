/**
 * The geometry of a STEPPED automation on a lane (#1463 Stage 2).
 *
 * A stepped parameter holds one value per cycle and repeats with a period
 * (`steppedAutomations`, editor). Drawing it is not a curve sample: it is a
 * staircase of flat segments, one per run of cycles that play the same step. This
 * module turns an automation plus the visible cycle span into those segments, a
 * value into a height and a pointer's travel back into a value (#1578), and a
 * press into the step it names. The canvas calls live in `drawTimeline`; the
 * gestures that use this geometry live in `FullSongTimeline`.
 *
 * ⚠ A SEGMENT IS ONE STEP, NOT ONE VALUE. Two adjacent steps that happen to hold
 * the same number (`<0.5 0.5 0.8>`) are two segments, because they are two
 * different places in the text: a later edit to one must not look like it edits
 * the other. Merging by value would draw the same line and hand Stage 3 the wrong
 * index.
 *
 * Pure. The range function and the step selection (`stepIndexAtCycle`, which
 * knows the arrangement sections, #1585) are passed IN by the caller that already
 * holds the real one.
 *
 * The value↔position map is the editor's (#1581), the same three rules the mixer
 * knob reads — one owner, so a level dragged on a lane and the same control turned
 * on the knob land on the same number.
 */
import {
  positionOfValue,
  snapToStep,
  valueAtPosition,
  type FixedParameter,
  type OffsetEdit,
  type SteppedAutomation,
} from '@stave/editor'
import { automationBand, automationBandHeight } from './automationCaption'

/** `value` on the grid of `step`, spelled without float noise — the mixer knob's
 *  own rule, re-exported so the lane's callers keep one import (#1581). */
export { snapToStep }

/**
 * Controls the knob table ranges that a lane still does not offer to automate
 * (#1601). Each changes something other than a sound: `cps` is the tempo, so a
 * dragged step would change how long the song plays, and the rest reshape time or
 * probability rather than set a level. Kept beside the offer, not in the editor's
 * table, because the table also serves the mixer, which does show these.
 */
const NOT_A_LANE_CONTROL: ReadonlySet<string> = new Set(['cps', 'slow', 'fast', 'degradeBy', 'sometimesBy'])

/**
 * The fixed values a lane's menu offers (#1601): the ones whose control has a knob
 * range of its own, keyed by the method as TYPED (`lpf`, not `cutoff`) because that
 * is how the table is keyed. `hasRange` is `hasKnownKnobRange`, injected (see the
 * header).
 */
export function automatableFixed(
  fixed: readonly FixedParameter[],
  hasRange: (method: string) => boolean,
): FixedParameter[] {
  return fixed.filter((f) => hasRange(f.method) && !NOT_A_LANE_CONTROL.has(f.method))
}

/**
 * How many steps automating `f` writes: one per bar its lane shows for a pass, so a
 * drag on bar k changes bar k and no other (#1601). Inside a section that is the
 * section's own length; under none it is the lane's span (`loopCycles` — the bare
 * floor and a resize included, the transient extend-drag margin not).
 */
export function automateStepCount(f: FixedParameter, laneCycles: number): number {
  return f.sectionCycles ?? Math.max(1, Math.round(laneCycles))
}

/** The value axis a stepped lane is drawn against. */
export interface StepAxis {
  readonly lo: number
  readonly hi: number
  /** `log` for frequency controls (`cutoff`, `hcutoff`, …), as the mixer knobs are. */
  readonly scale: 'linear' | 'log'
  /** The knob's quantum (`gain` 0.01, `cutoff` 1 Hz, `crush` 1) — what a dragged
   *  level snaps to, so a drag writes `0.43` and never `0.4312…` (#1578). */
  readonly step: number
}

/** The shape of `knobRangeFor` — injected, see the header. */
export type RangeFor = (
  method: string,
  value: number,
) => { readonly min: number; readonly max: number; readonly step: number; readonly scale: 'linear' | 'log' }

/** The shape of `stepIndexAtCycle` — injected, see the header. Which step plays in
 *  a song cycle, or null where the parameter's arrangement section is silent (#1585). */
export type StepAt = (a: SteppedAutomation, cycle: number) => number | null

/** A stepped automation as a lane holds it: the axis it is drawn against and the
 *  selection that places its steps, both resolved by the caller that can reach them. */
export interface SteppedEntry {
  readonly automation: SteppedAutomation
  readonly axis: StepAxis
  readonly stepAt: StepAt
}

/**
 * The axis for one stepped automation: the mixer knob's range for this control,
 * widened to hold every step the document writes.
 *
 * Asked once with the smallest step and once with the largest, because
 * `knobRangeFor` widens a KNOWN range only to the single value it is handed, and
 * derives an UNKNOWN control's range from that value alone. Asking with one step
 * would clip every other step to the axis edge — a lane that draws `0.2 → 1.4` as
 * `0.2 → 1` is drawing a document nobody wrote.
 */
export function stepAxis(a: SteppedAutomation, rangeFor: RangeFor): StepAxis {
  const values = a.steps.map((s) => s.value)
  const low = rangeFor(a.method, Math.min(...values))
  const high = rangeFor(a.method, Math.max(...values))
  const lo = Math.min(low.min, high.min)
  const hi = Math.max(low.max, high.max)
  // A log axis needs a positive floor; a document that writes 0 or less on a
  // frequency control falls back to linear rather than drawing -Infinity.
  const scale = low.scale === 'log' && lo > 0 ? 'log' : 'linear'
  // The finer of the two quanta: an unknown control's step is derived from the
  // value it was asked with, and the finer one can spell every step of both.
  const step = Math.min(low.step, high.step)
  return { lo, hi, scale, step }
}

/** Where `value` sits on the axis, 0 (floor) … 1 (ceiling), clamped — the mixer
 *  knob's map over this lane's axis (#1581). */
export function unitOnAxis(value: number, axis: StepAxis): number {
  return positionOfValue(value, axis.lo, axis.hi, axis.scale)
}

/**
 * The value at `unit` (0 floor … 1 ceiling, clamped) — `unitOnAxis` run
 * backwards (#1578).
 *
 * ⚠ THE SAME MAP, INVERTED, NOT A SECOND MAP. A drag reads the level under the
 * pointer through this and the staircase draws the result through `stepY`; if the
 * two disagreed about the log axis the line would slide away from the pointer
 * while it moved. The pair is pinned by a round-trip arm over both scales.
 */
export function valueAtUnit(unit: number, axis: StepAxis): number {
  return valueAtPosition(unit, axis.lo, axis.hi, axis.scale)
}

/**
 * How much slower a step drag moves while the fine modifier is held (#1582).
 *
 * A tenth is the DAW convention for a modified drag, and it is what this lane
 * needs: an expanded single-voice lane can be 25px tall when the panel has no
 * room to grow it, which leaves a 19px band — about 0.05 of `gain` per pixel, so
 * 0.60 is not reachable from 0.9 by any pixel. At a tenth, one pixel is 0.005 and
 * every value on the control's own quantum can be landed on.
 */
export const FINE_DRAG_RATIO = 0.1

/**
 * What a step drag has travelled so far, in the band's own pixels (#1582).
 *
 * ⚠ TRAVEL IS ACCUMULATED, NOT RE-DERIVED FROM THE PRESS. The modifier can go
 * down or up in the middle of a drag, and the pixels moved before it changed
 * were worth ten times the pixels moved after. Reading `clientY - startClientY`
 * and scaling the whole thing would re-price travel the user already spent: the
 * level would LEAP the moment the key went down, away from the pointer that is
 * holding it. So each change of mode closes the current run — banking what it
 * was worth — and starts the next one from where the pointer is standing.
 */
export interface StepTravel {
  /** Screen y where the current run began — the last mode change, or the press. */
  readonly anchorClientY: number
  /** Band pixels banked by the runs BEFORE the current one. */
  readonly beforePx: number
  /** Whether the current run is moving at the fine ratio. */
  readonly fine: boolean
}

/** A drag's travel at the moment of the press. */
export function stepTravel(clientY: number, fine: boolean): StepTravel {
  return { anchorClientY: clientY, beforePx: 0, fine }
}

/** The band pixels travelled by the time the pointer reaches `clientY`. */
export function travelledPx(travel: StepTravel, clientY: number): number {
  if (!Number.isFinite(clientY)) return travel.beforePx
  const run = (clientY - travel.anchorClientY) * (travel.fine ? FINE_DRAG_RATIO : 1)
  return travel.beforePx + run
}

/**
 * The travel with the fine mode set to `fine`, re-anchored at `clientY` if that
 * is a change (#1582).
 *
 * Called on every move AND on the modifier's own key events, because a key
 * pressed while the pointer stands still sends no pointer event at all — and the
 * value must not move when it is pressed, only the speed of what comes next.
 * Identity is returned unchanged when the mode is the same, so the common path
 * allocates nothing.
 */
export function withFineDrag(travel: StepTravel, clientY: number, fine: boolean): StepTravel {
  if (fine === travel.fine) return travel
  return { anchorClientY: clientY, beforePx: travelledPx(travel, clientY), fine }
}

/**
 * The value a step's level holds after the pointer has travelled `dyPx` from
 * where the drag began (#1578). `dyPx` is screen travel: positive is DOWN the
 * lane and lowers the value, as pulling a fader down does.
 *
 * ⚠ RELATIVE TO THE PRESS, NOT THE POINTER'S ABSOLUTE HEIGHT. A press counts
 * anywhere within `STEP_HIT_TOLERANCE_PX` of the level, so reading the absolute y
 * would jump the value by up to that much on the first pixel of travel — a press
 * that grabbed the line from just below it would pull it down before the user
 * moved.
 *
 * ⚠ THE AXIS AND BAND ARE THE ONES FROZEN AT POINTER-DOWN. `stepAxis` widens to
 * the steps the document holds, so re-deriving it from a previewed value would
 * rescale the lane under the pointer and the drag would run away from it.
 * Clamped to that axis: a typed value can still widen it, a drag cannot.
 */
export function stepDragValue(startValue: number, dyPx: number, axis: StepAxis, band: StepBand): number {
  const bandH = automationBandHeight(band.rowHeight, band.padY)
  if (!(bandH > 0)) return startValue
  const unit = unitOnAxis(startValue, axis) - dyPx / bandH
  return snapToStep(valueAtUnit(unit, axis), axis.step)
}

/**
 * `entries` with step `index` of `automation` holding `value` — the drawn
 * preview of a drag, never the document (#1578).
 *
 * Matches the automation by IDENTITY, and keeps its axis: two parameters on one
 * lane can hold equal steps, and a preview that rescaled the band would move every
 * other staircase on it.
 */
export function withStepValue(
  entries: readonly SteppedEntry[],
  automation: SteppedAutomation,
  index: number,
  value: number,
): SteppedEntry[] {
  return entries.map((entry) =>
    entry.automation !== automation || !automation.steps[index]
      ? entry
      : {
          ...entry,
          automation: {
            ...automation,
            steps: automation.steps.map((s, k) => (k === index ? { ...s, value } : s)),
          },
        },
  )
}

/** The band a lane's automation is drawn in — the same inset and floor the curves use. */
export interface StepBand {
  readonly top: number
  readonly rowHeight: number
  readonly padY: number
  readonly minBandH: number
}

/** Canvas y of `value` on `axis` inside `band`. ONE formula, two readers — the
 *  staircase draw and the hit-test must agree about where a step sits, or a press
 *  lands one step off and edits the wrong number. */
export function stepY(value: number, axis: StepAxis, band: StepBand): number {
  // No floor here, deliberately: the draw and hit-test paths abstain before
  // calling this, and a step still needs a y while a drag previews one (#1498).
  const bandH = automationBandHeight(band.rowHeight, band.padY)
  return band.top + band.padY + (1 - unitOnAxis(value, axis)) * bandH
}

/** What a press on a stepped staircase hit. */
export interface StepHit {
  readonly entry: SteppedEntry
  /** Index into `entry.automation.steps` — the step an edit writes. */
  readonly index: number
  /** Canvas y of that step's level, for placing an editor over it. */
  readonly y: number
}

/** How near a step's level counts as pressing it. */
export const STEP_HIT_TOLERANCE_PX = 4

/**
 * The step under a point, or null.
 *
 * `cycle` is the song-absolute cycle under the pointer (the caller inverts x with
 * the same map the ruler uses). Only the step PLAYING at that cycle can be hit —
 * the staircase has one level there, or none where the parameter's arrangement
 * section is silent (#1585) — and when several parameters share
 * the band the nearest level wins, so overlapping staircases stay reachable.
 *
 * ⚠ EXPANDED LANES ONLY, the rule the bounds caption already follows. A collapsed
 * row is a contour view whose whole height is contested with the clip body, and a
 * press there must keep selecting the clip it always selected.
 */
export function stepHitAt(
  entries: readonly SteppedEntry[],
  band: StepBand,
  expanded: boolean,
  cycle: number,
  y: number,
  tolerancePx: number = STEP_HIT_TOLERANCE_PX,
): StepHit | null {
  if (!expanded || entries.length === 0 || !Number.isFinite(cycle)) return null
  if (!automationBand(band.top, band.rowHeight, band.padY, band.minBandH)) return null
  let best: StepHit | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const a = entry.automation
    if (!(a.periodCycles > 0) || a.steps.length === 0) continue
    // A bar where the parameter's section is silent has no segment, so no level to press.
    const [segment] = stepSegments(a, Math.floor(cycle), Math.floor(cycle) + 1, entry.stepAt)
    if (!segment) continue
    const levelY = stepY(segment.value, entry.axis, band)
    const dist = Math.abs(levelY - y)
    if (dist <= tolerancePx && dist < bestDist) {
      best = { entry, index: segment.index, y: levelY }
      bestDist = dist
    }
  }
  return best
}

/** The shape of `stepTextEdit` — injected, for the reason `RangeFor` is. */
export type StepTextEdit = (
  a: SteppedAutomation,
  index: number,
  text: string,
) => OffsetEdit | null

/**
 * Turn "the user typed `nextText` over the step `hit` names" into a source edit,
 * or into NOTHING (#1463 Stage 3).
 *
 * The ONE place a typed step becomes an edit, so a caller cannot skip a rule by
 * building the number itself. This function owns only which step the hit names;
 * `textEdit` owns the text and the document — an empty or non-numeric entry
 * writes nothing, an unchanged value writes nothing, only that step's number
 * moves, and a number the reader could not read back is refused (#1918 moved the
 * text rule beside the caption's, so the two cannot drift).
 */
export function stepEdit(hit: StepHit, nextText: string, textEdit: StepTextEdit): OffsetEdit | null {
  return textEdit(hit.entry.automation, hit.index, nextText)
}

/** One flat run of the staircase — a single step, over song-absolute cycles. */
export interface StepSegment {
  /** Index into `automation.steps` — the step an edit to this segment writes. */
  readonly index: number
  readonly value: number
  readonly startCycle: number
  readonly endCycle: number
}

/**
 * The segments covering `[firstCycle, lastCycle)`, in song-absolute cycles.
 *
 * Walks whole cycles, because a step is chosen per cycle (`<a b>` plays `a` for
 * all of cycle 0), and joins consecutive cycles only when they play the SAME STEP
 * — a weighted step becomes one segment across its weight. The first and last
 * segments are clipped to the requested span, so a paged window draws its own part
 * of the song and nothing outside it. A cycle where the parameter's section is
 * silent (#1585) has no segment, so a staircase inside an arrangement is drawn
 * only over the bars that play it.
 *
 * ⚠ THE INDEX IS THE WHOLE RULE. Within one section, the cycle just before step k
 * begins always plays a DIFFERENT step, so "same index as the previous cycle"
 * already separates every step, including the same step met again on the next
 * pass. A second clause for "a new pass" was written, broken alone, and turned
 * nothing red — it re-stated this one. A single-step pattern (`<0.8>`) is index 0
 * every cycle and draws as one line, which is what it sounds like, with no special
 * case. Two appearances of one section side by side can hold the same step across
 * their seam (`arrange([1, a], [1, a])` plays step 0 in both bars) — one written
 * number held for two bars, and one segment is what that is.
 *
 * `stepAt` is `stepIndexAtCycle`, injected like `RangeFor`, so this module keeps
 * no second copy of the engine's selection.
 */
export function stepSegments(
  a: SteppedAutomation,
  firstCycle: number,
  lastCycle: number,
  stepAt: StepAt,
): StepSegment[] {
  if (!(lastCycle > firstCycle) || !(a.periodCycles > 0) || a.steps.length === 0) return []
  const out: StepSegment[] = []
  for (let c = Math.floor(firstCycle); c < lastCycle; c++) {
    const index = stepAt(a, c)
    if (index === null) continue
    const start = Math.max(c, firstCycle)
    const end = Math.min(c + 1, lastCycle)
    const prev = out[out.length - 1]
    // Same step, and the previous run ends exactly where this cycle begins.
    const continues = prev !== undefined && prev.index === index && prev.endCycle === start
    if (continues) {
      out[out.length - 1] = { ...prev, endCycle: end }
    } else {
      out.push({ index, value: a.steps[index].value, startCycle: start, endCycle: end })
    }
  }
  return out
}
