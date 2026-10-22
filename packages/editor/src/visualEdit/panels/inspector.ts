/**
 * inspector — the Pattern grids' selection key + the shared `.gain` (velocity)
 * write transforms.
 *
 * (Named for the former Mixer-as-inspector; the inspector panel was removed —
 * pitch/position/velocity are read straight off the grid — but the selection
 * KEY and the velocity transforms it shared with the grids live on. Selection
 * is now the ⌘/Ctrl-click copy/paste target (#528); the velocity transforms are
 * the grids' vertical-drag write path.)
 *
 * A "selected" cell is a lightweight key, not a reference, so it survives the
 * model reseed every write triggers:
 *   - roll: keyed by `pitch` token + `start` column;
 *   - step: keyed by `lane` index + `step` column.
 *
 * VELOCITY = `.gain` (grounded #427 Q1). `setGroupGain`/`setColumnGain` live
 * HERE so the grid drag writes the SAME `.gain` transform everywhere — one path,
 * no dual-representation drift (PV129).
 */
import type { PianoRollModel, StepGridModel } from '../../codeView'

/** The cell a grid has selected, keyed by stable musical identity. */
export type SelectedNote =
  | { kind: 'roll'; pitch: string; start: number }
  | { kind: 'step'; lane: number; step: number }

/** the gain shared by the note group starting at `start` (chord members share) */
export function gainAtStart(model: PianoRollModel, start: number): number {
  return model.notes.find((n) => n.start === start)?.gain ?? 1
}

// ── velocity transforms (SHARED by grid drag + paste — one `.gain` path) ──────

/** set the gain on every note of the group at `start` (chord shares one gain) */
export function setGroupGain(model: PianoRollModel, start: number, gain: number): PianoRollModel {
  if (model.lookOnly) return model
  return {
    ...model,
    notes: model.notes.map((n) => (n.start === start ? { ...n, gain } : n)),
  }
}

/** set one column's velocity (gains default to a neutral 1-filled array) */
export function setColumnGain(model: StepGridModel, stepIndex: number, gain: number): StepGridModel {
  if (model.lookOnly) return model
  const gains = model.gains ? [...model.gains] : Array<number>(model.steps).fill(1)
  if (gains[stepIndex] === gain) return model
  gains[stepIndex] = gain
  return { ...model, gains }
}
