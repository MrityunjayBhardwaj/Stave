/**
 * ungatedOps.ts — THE PLACEMENT OPS MINUS THEIR SPELLABILITY GATE, kept in one place.
 *
 * ⚠ THESE TRACK THE CURRENT EDIT, THEY DO NOT FREEZE AN OLD ONE. The one axis they
 * control for is the GATE; everything else must move with production. So when #1064
 * phase 2 widened the grid clamp from the lane to the `,`-part, `ungatedToggle` widened
 * with it. Left lane-scoped, it would have gone on answering "would the writer have
 * taken it?" about a model the op no longer builds — every assertion still passing,
 * all of them measuring nothing.
 *
 * Since #1071 the production ops answer "could not apply" by returning their INPUT
 * by reference (`ifGridSpellable` / `ifRollSpellable`). That is the right shape for
 * production and the wrong shape for two kinds of measurement:
 *
 *  - a CONTROL ARM that needs to ask the writer itself, so that the gate is not
 *    comparing a derived predicate against the thing it is derived from
 *    ([[P370]] — a gate that cannot fail);
 *  - a HYPOTHESIS ARM that asks what a DIFFERENT rule would have made spellable.
 *    The gate refuses exactly the placements such an arm exists to rescue, so
 *    composing on top of the gated op measures nothing ([[P379]]).
 *
 * These are a deliberate second oracle used as a control, which is the one use
 * [[PV192]] permits: they exist to be compared against, never to decide anything.
 * Kept byte-for-byte in shape with the production ops minus the spellability
 * wrapper, so the only variable between arms is the gate itself.
 *
 * THEY LIVE HERE RATHER THAN IN EACH SWEEP because a second copy is how this
 * boundary keeps growing duplicated rules ([[PV247]]): `toggleCell` itself was
 * defined three times before #1048. Two callers is the point at which the copy
 * becomes a module.
 */
import {
  cellOn,
  clampLane,
  clampPartAtOnset,
} from '../../../editor/src/codeView/notation/model'
import type {
  PianoRollModel,
  StepCell,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'

/** `toggleCell` without `ifGridSpellable` — builds the model and never refuses. */
export function ungatedToggle(
  model: StepGridModel,
  laneIndex: number,
  stepIndex: number,
  value: boolean,
  length = 1,
): StepGridModel {
  // a hit one box long, as the op paints it — one of a part's own steps in Exact (#1855)
  const paint = (v: boolean): StepCell => (v ? cellOn(length) : false)
  const painted = model.lanes.map((lane, i) =>
    i === laneIndex
      ? {
          ...lane,
          cells: clampLane(
            lane.cells.map((c, j) => (j === stepIndex ? paint(value) : c)),
            model.steps,
          ),
        }
      : lane,
  )
  // The part-wide clamp is #1064 phase 2's edit, not its gate, so the control arm
  // carries it too — see the warning at the top of this file.
  const lanes = value
    ? clampPartAtOnset(painted, model.lanes[laneIndex]?.part ?? 0, stepIndex)
    : painted
  return { ...model, lanes }
}

/** `placeNote` without `ifRollSpellable` — resolves overlaps and never refuses. */
export function ungatedPlace(
  model: PianoRollModel,
  pitch: string,
  start: number,
  duration: number,
): PianoRollModel {
  const groupAt = model.notes.find((n) => n.start === start)
  if (groupAt) {
    return { ...model, notes: [...model.notes, { pitch, start, duration: groupAt.duration }] }
  }
  const nextStart = Math.min(
    ...model.notes.filter((n) => n.start > start).map((n) => n.start),
    model.steps,
  )
  // The same-pitch scope is #1310's EDIT, not its gate, so the control arm carries it
  // too — see the warning at the top of this file. Left unscoped, this would go on asking
  // "would the writer have taken it?" about a model `placeNote` no longer builds, and the
  // disagreement it reported would be its own staleness rather than a divergence.
  const notes = model.notes.map((n) =>
    n.pitch === pitch && n.start < start && n.start + n.duration > start
      ? { ...n, duration: start - n.start }
      : n,
  )
  notes.push({ pitch, start, duration: Math.max(1, Math.min(duration, nextStart - start)) })
  return { ...model, notes }
}
