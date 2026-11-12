/**
 * rollWriter.ts — which writer the piano roll's gestures use, and where its length handle is
 * drawn (#2294). Kept out of `PianoRollGrid.tsx` so the choice can be asked without mounting
 * the panel.
 *
 * Settings › Grid decides it: Exact (the tree) edits one step's own text through the step
 * writer (`codeView/rollEdit.ts`); LCM (the shared grid) uses the column writer, as the roll
 * always has.
 */
import { chunkDivisions, pitchToMidi, rollResize, type BarTree, type PianoRollModel, type RollNote } from '../../codeView'
import { columnPlace, endInBar } from './gridZoom'
import type { GridMode } from './gridMode'

/**
 * WHICH WRITER THE ROLL'S GESTURES USE — the grid mode's one decision in the roll (#2294).
 * Exact (the tree) → the text and its divisions, so add/delete/length/move edit one step's
 * own text; LCM (the shared grid) → null, so they use the column writer. Also null where
 * nothing can be written (no model, a look-only model, no mini string).
 */
export function rollStepText(
  mode: GridMode,
  model: { lookOnly?: unknown; bars?: number } | null,
  mini: string | null,
): { mini: string; trees: readonly BarTree[] } | null {
  if (mode !== 'exact' || !model || model.lookOnly || mini == null) return null
  return { mini, trees: chunkDivisions(mini, model.bars ?? 1) }
}

/**
 * THE NOTES WHOSE LENGTH THE STEP WRITER WILL CHANGE (#2294) — the tree mode's `resizableNotes`.
 *
 * A handle is drawn only where a drag would write (#1322). In the tree mode the drag asks
 * `rollResize`, so the handle asks it too: a note keeps its handle when some other whole
 * number of columns, ending inside its bar, is a length `rollResize` writes. Asking the column
 * writer's predicate instead drew handles on notes the step writer refuses (a note followed
 * by another note has no rest to grow into), and the drag then did nothing.
 */
export function rollResizableNotes(
  model: PianoRollModel,
  base: { mini: string; trees: readonly BarTree[] },
): Set<RollNote> {
  const out = new Set<RollNote>()
  for (const note of model.notes) {
    const midi = pitchToMidi(note.pitch) ?? (model.numeric ? Number(note.pitch) : null)
    const place = columnPlace(model, note.start)
    if (midi === null || !place) continue
    const cols = Math.max(1, Math.round(note.duration))
    for (let dur = 1; ; dur++) {
      if (dur === cols) continue
      const end = endInBar(model, note.start, note.start + dur)
      if (!end) break
      if (rollResize(base.mini, base.trees, place, midi, end).ok) {
        out.add(note)
        break
      }
    }
  }
  return out
}
