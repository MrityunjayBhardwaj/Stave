// Pure planner for "assign a sound to the cursor" (#830).
//
// `assignSoundToCursor` (WorkspaceShell) is a React closure that reaches Monaco
// imperatively, so its decision can't be unit-tested as written. This module
// extracts the whole decision into a pure function over `(doc, offset, sound)`
// — mirroring the `detectChunk(doc, offset)` idiom — so the line-aware source
// insert can be pinned by fast unit tests. WorkspaceShell computes the plan
// here and commits it (`assignmentEdit` → `commitToEditor`); the tested code is
// the shipped code.

import { parseTopLevel } from '../astParse'
import { detectChunk } from '../chunkDetect'
import { setStringCall } from '../chainEdit'
import { patternKind } from '../patternKind'
import { bareExpressionOf } from '../bareExpression'
import type { OffsetEdit } from '../writeback'

/**
 * An offset-space edit describing how to write a sound name at the cursor.
 * `replace` swaps an existing range (an existing `.sound()` argument);
 * `insert` drops text at a single offset (a zero-width edit).
 */
export type SoundAssignPlan =
  | { kind: 'replace'; range: [number, number]; text: string }
  | { kind: 'insert'; offset: number; text: string; label?: number }

/**
 * Decide how to write `sound` at `offset` in `doc`, or return `null` when
 * there is nothing to do (empty sound name).
 *
 * Two cases, matching the picker's behavior:
 *  - A note/roll chunk under the cursor → set/replace its `.sound()`. The name
 *    is single-quoted so it stays a string literal, not a reified mini-pattern.
 *  - No note chunk under the cursor → drop a fresh `s("…")` source pattern on
 *    its OWN line. Inserting at the raw offset lands mid-token or inside a
 *    comment (observed: `// scratch` → `// scratchs("…")`), so the insert goes
 *    at the END of the cursor's line, prefixed with a newline only when that
 *    line already has content. Double-quoted: a standalone `s("…")` is
 *    idiomatic mini-notation.
 */
export function planSoundAssignment(
  doc: string,
  offset: number,
  sound: string,
): SoundAssignPlan | null {
  if (!sound) return null

  const chunk = detectChunk(doc, offset)
  if (chunk && patternKind(chunk) === 'roll') {
    const edit = setStringCall(chunk, ['sound', 's'], 'sound', sound)
    return edit.range[0] === edit.range[1]
      ? { kind: 'insert', offset: edit.range[0], text: edit.text }
      : { kind: 'replace', range: edit.range, text: edit.text }
  }

  // Where the new line goes (#2057): after the WHOLE top-level statement under the
  // cursor, so a cursor inside a multi-line `$: stack(…)` does not write into its
  // arguments; with no statement under the cursor (a comment, a blank line), after
  // the cursor's own line. Line-aware either way: a raw offset lands mid-token or
  // inside a comment (observed: `// scratch` → `// scratchs("…")`).
  const statements = parseTopLevel(doc)
  const under = statements?.find((s: { start: number; end: number }) => s.start <= offset && offset <= s.end)
  const anchor = under ? under.end : offset
  const lineStart = doc.lastIndexOf('\n', anchor - 1) + 1
  const nextNewline = doc.indexOf('\n', anchor)
  const lineEnd = nextNewline === -1 ? doc.length : nextNewline
  const hasContent = doc.slice(lineStart, lineEnd).trim().length > 0
  const form = newLineForm(doc, statements)
  return {
    kind: 'insert',
    offset: lineEnd,
    text: `${hasContent ? '\n' : ''}${form.labelled ? '$: ' : ''}s("${sound}")`,
    ...(form.label !== undefined ? { label: form.label } : {}),
  }
}

/**
 * How to write the new line so it is heard, and the song still is (#2057, #2066).
 * Which line a song plays is `bareExpressionOf`'s to say. So:
 *  - a live label anywhere, or no code yet → the new line is `$:`;
 *  - else, the song plays a bare expression → a new line of either form would
 *    silence it (a `$:` one registers a label, a bare one becomes the last
 *    statement): label it too (`label` is where its `$: ` goes), and write the
 *    new line as `$:` — both play;
 *  - else (the song plays nothing: its last statement is a muted label or a
 *    setup call) → `$:`.
 * The Library's Insert is the only caller; nothing else rewrites a line of yours.
 */
function newLineForm(
  doc: string,
  statements: Parameters<typeof bareExpressionOf>[0] | null,
): { labelled: boolean; label?: number } {
  // mid-keystroke the document does not parse: read the lines instead
  if (!statements) return { labelled: /^[ \t]*\$:/m.test(doc) }
  const bare = bareExpressionOf(statements)
  return bare === null ? { labelled: true } : { labelled: true, label: bare }
}

/**
 * The plain edit an assignment plan stands for (#1906). `insert` is a zero-width
 * edit at its offset; `replace` keeps its range — exactly what the writer did
 * with each shape, so a caller hands the result to `commit` without branching on
 * the plan. Takes either planner's result: both share this shape. An insert that
 * also labels the song's playing expression (#2066) is two edits, one write.
 */
export function assignmentEdit(
  plan:
    | { kind: 'replace'; range: [number, number]; text: string }
    | { kind: 'insert'; offset: number; text: string; label?: number },
): OffsetEdit | OffsetEdit[] {
  if (plan.kind === 'replace') return { range: plan.range, text: plan.text }
  const insert: OffsetEdit = { range: [plan.offset, plan.offset], text: plan.text }
  // #2066 — the song's playing expression is labelled in the same write: one undo
  return plan.label === undefined ? insert : [{ range: [plan.label, plan.label], text: '$: ' }, insert]
}
