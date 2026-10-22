/**
 * Step-count changes. A flat mini string spans one cycle, so step count is the
 * note value (8 steps → 8th notes, 16 → 16ths):
 *
 *  - "spread" (default): preserve musical time — 8→16 moves a hit at step i to
 *    step 2i, so it sounds identical at finer resolution; shrinking quantizes
 *    hits onto the coarser grid (any hit in a bucket keeps the bucket on).
 *  - "pad": preserve step indices — append/truncate at the end, stretching or
 *    compressing the groove (hardware "pattern length" semantics).
 *
 * Multi-bar (`<...>`) patterns don't resize — their column resolution is fixed
 * by the bar groups — so both functions return the model unchanged.
 */
import { cellOn, clampLane, isCellOn, scaleCell } from './model'
import type { PianoRollModel, StepCell, StepGridModel } from './model'
import { ifGridSpellable, ifRollSpellable } from './serialize'

export type ResizeMode = 'spread' | 'pad'

/**
 * Drop the source provenance (#913). A resize re-lays every column, so the
 * regions no longer describe anything: their notation was written for a grid
 * that no longer exists, and the writer must rebuild the line from the model.
 *
 * `serializeStepGrid` would also catch this — a resized grid's column count
 * stops matching its regions' — but a length check is a coincidence to lean on
 * for a path whose failure mode is pasting the WRONG bytes into someone's file.
 * The function that invalidates the regions is the one that should say so.
 */
const restructured = ({ source: _drop, ...rest }: StepGridModel): StepGridModel => rest

/**
 * Both modes clamp lengths (`clampLane`) for the same reason `quantizeStepGridTo` and
 * `resizeRoll` do: rounding hits onto a coarser grid, or truncating one, can leave a
 * note reaching past the next hit or past the end of the grid, and neither is
 * something the writer could spell. The roll has always clamped here; the grid could
 * not, because a cell had no length to clamp (#1010 P4b).
 */
export function resizeGrid(
  model: StepGridModel,
  nextSteps: number,
  mode: ResizeMode,
): StepGridModel {
  if (nextSteps === model.steps || (model.bars ?? 1) > 1) return model
  if (mode === 'pad' || model.steps === 0) {
    // `pad` KEEPS lengths ([[PV240]]), so it cannot push one below a column — but it is
    // gated all the same, because the rule is "ask the writer", not "ask the writer where
    // I predict trouble". A prediction about which ops are safe is the thing this replaces.
    return ifGridSpellable(model, {
      ...restructured(model),
      steps: nextSteps,
      lanes: model.lanes.map((l) => ({
        ...l,
        cells: clampLane(padCells(l.cells, nextSteps), nextSteps),
      })),
    })
  }
  const from = model.steps
  // "spread" preserves musical time, so a note's LENGTH scales with the grid exactly
  // as its position does (#1010 P4b): 8→16 puts a hit at 2i and makes it twice as many
  // columns long, which is the same fraction of the cycle. Leaving lengths alone here
  // would halve every note while claiming to preserve the groove.
  const factor = nextSteps / from
  // DOWNSAMPLING scales every length down, and below one column the grid has no spelling
  // for it, so `spread` is not offered there (#1010 P4c) — see `ifGridSpellable`.
  return ifGridSpellable(model, {
    ...restructured(model),
    steps: nextSteps,
    lanes: model.lanes.map((l) => {
      const cells = Array.from({ length: nextSteps }, (_, j): StepCell => {
        if (nextSteps >= from) {
          // upsample: a hit only at the exact mapped position
          if ((j * from) % nextSteps !== 0) return false
          return scaleCell(l.cells[(j * from) / nextSteps] ?? false, factor)
        }
        // downsample: any hit in the bucket lands on this step, and where several do,
        // the SHORTEST wins — a merged note never sounds longer than a note it stands
        // for (the rule `quantizeStepGridTo` uses for the same collision)
        const lo = Math.ceil((j * from) / nextSteps)
        const hi = Math.ceil(((j + 1) * from) / nextSteps)
        const hits = l.cells.slice(lo, hi).filter(isCellOn)
        return hits.length === 0
          ? false
          : cellOn(Math.min(...hits.map((h) => h.duration)) * factor)
      })
      return { ...l, cells: clampLane(cells, nextSteps) }
    }),
  })
}

export function resizeRoll(
  model: PianoRollModel,
  nextSteps: number,
  mode: ResizeMode,
): PianoRollModel {
  if (nextSteps === model.steps || (model.bars ?? 1) > 1) return model
  if (mode === 'pad' || model.steps === 0) {
    return ifRollSpellable(model, {
      ...model,
      steps: nextSteps,
      notes: model.notes
        .filter((n) => n.start < nextSteps)
        .map((n) => ({ ...n, duration: Math.min(n.duration, nextSteps - n.start) })),
    })
  }
  const factor = nextSteps / model.steps
  const scaled = model.notes
    .map((n) => {
      const start = Math.floor(n.start * factor)
      const end = Math.max(start + 1, Math.round((n.start + n.duration) * factor))
      return { ...n, start, duration: Math.min(end, nextSteps) - start }
    })
    .filter((n) => n.start < nextSteps && n.duration >= 1)
  // drop collisions from downsampling (same pitch onto the same step)
  const seen = new Set<string>()
  return ifRollSpellable(model, {
    ...model,
    steps: nextSteps,
    notes: scaled.filter((n) => {
      const key = `${n.pitch}@${n.start}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  })
}

/**
 * "pad" preserves step INDICES, so a cell keeps the length it had in columns and the
 * groove stretches or compresses with the grid — the hardware "pattern length"
 * semantics this file's header describes. That is the opposite choice from "spread",
 * and it is the same choice for lengths as for positions, which is the point: each
 * mode is consistent about what it holds fixed.
 */
function padCells(cells: StepCell[], steps: number): StepCell[] {
  if (cells.length === steps) return [...cells]
  if (cells.length > steps) return cells.slice(0, steps)
  return [...cells, ...new Array<StepCell>(steps - cells.length).fill(false)]
}
