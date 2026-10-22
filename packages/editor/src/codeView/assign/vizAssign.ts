// Pure planner for "attach a viz preset to the cursor" (#832).
//
// The Asset Library's Viz provider inserts `.viz("name")` onto the pattern under
// the cursor. Like `soundAssign`, the decision is extracted into a pure function
// over `(doc, offset, name)` so it can be unit-tested without Monaco; the shell's
// `assignVizToCursor` commits the result (`assignmentEdit` → `commitToEditor`).
//
// Unlike a sound, a viz has nothing to stand on its own — it decorates an
// existing pattern — so there is no "drop a fresh line" fallback: with no chunk
// under the cursor the planner returns null (the insert no-ops). `.viz()` names
// are DOUBLE-quoted, matching the shipped convention (`masterEdit` /
// inline-viz `.viz("pianoroll")`), not the single-quoted sound-id rule.

import { detectChunk } from '../chunkDetect'
import { setLiteralCall } from '../chainEdit'

/** An offset-space edit describing how to write a viz name at the cursor. */
export type VizAssignPlan =
  | { kind: 'replace'; range: [number, number]; text: string }
  | { kind: 'insert'; offset: number; text: string }

/**
 * Decide how to attach viz `name` at `offset` in `doc`, or return `null` when
 * there is nothing to do (empty name, or no pattern chunk under the cursor — a
 * viz must decorate a pattern).
 *
 * A `.viz()` already on the chunk → replace its (first, string) argument in
 * place, preserving any options object. Otherwise append `.viz("name")` at the
 * end of the chunk's expression, exactly like the `.sound()` insert idiom.
 */
export function planVizAssignment(
  doc: string,
  offset: number,
  name: string,
): VizAssignPlan | null {
  if (!name) return null

  const chunk = detectChunk(doc, offset)
  if (!chunk) return null

  // double-quoted, escapes special chars
  const edit = setLiteralCall(chunk, ['viz'], 'viz', JSON.stringify(name))
  return edit.range[0] === edit.range[1]
    ? { kind: 'insert', offset: edit.range[0], text: edit.text }
    : { kind: 'replace', range: edit.range, text: edit.text }
}
