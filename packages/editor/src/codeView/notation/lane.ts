/**
 * lane.ts — pure add/remove-voice transforms for the Sequencer step grid (#516).
 *
 * A "voice" is a `StepLane` — one drum sound (e.g. `bd`, `cp`) across the step
 * columns. The serializer (`serializeStepGrid`) rebuilds the mini-notation from
 * lanes × cells: a sound present in any column appears in the output, multiple
 * lanes in a column collapse to `[a,b]`. So adding a lane is a pure model insert
 * and removing one is a filter — re-serialization is automatic and lossless.
 *
 * Add-voice STAGING (grounded #427): a freshly-added lane is all-rest, so it
 * serializes to NOTHING until the user places the first hit. `useGridModel`
 * keeps it anyway — its reseed guard compares `serialize(model)` to the source
 * mini, and an empty lane leaves that unchanged, so the staged row survives
 * re-detection and only writes to text on the first hit.
 */
import type { StepCell, StepGridModel, StepLane } from './model'

/**
 * Append a new drum voice of all-rest cells. No-op when `sound` is blank or
 * already present (the serializer combines same-part lanes by membership, so a
 * duplicate sound token would be indistinguishable). The new lane inherits the
 * first lane's `part` so it lands in the part being edited rather than forcing
 * a new top-level `,`-stack.
 */
export function addLane(model: StepGridModel, sound: string): StepGridModel {
  const token = sound.trim()
  if (model.lookOnly) return model
  if (token === '' || model.lanes.some((l) => l.sound === token)) return model
  const lane: StepLane = {
    sound: token,
    part: model.lanes[0]?.part,
    cells: Array<StepCell>(model.steps).fill(false),
  }
  return { ...model, lanes: [...model.lanes, lane] }
}

/**
 * Remove a voice by its sound token. Its cells drop out of the serialized
 * output; every other lane stays byte-identical. No-op when the sound is absent.
 */
export function removeLane(model: StepGridModel, sound: string): StepGridModel {
  if (model.lookOnly) return model
  if (!model.lanes.some((l) => l.sound === sound)) return model
  return { ...model, lanes: model.lanes.filter((l) => l.sound !== sound) }
}
