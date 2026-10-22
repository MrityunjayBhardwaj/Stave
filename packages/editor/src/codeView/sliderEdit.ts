/**
 * sliderEdit.ts — what a `slider(…)` drag writes (#345).
 *
 * Strudel's transpiler, not chunk detection, places a slider: it reports the span of
 * the call's value argument, and the editor keeps that span on the number as the text
 * moves. So this takes the live document and the span instead of a chunk, and like
 * `knobEdit` it writes only over a plain number literal.
 *
 * This module is pure.
 */
import { formatNumber, parseTypedNumber, type OffsetEdit } from './writeback'

/**
 * The edit that moves the slider at `span` to `value`. Null when the span no
 * longer holds a number (the text under it was rewritten) or the value is not
 * finite — writing anyway would overwrite somebody's code with a dial position.
 */
export function sliderEdit(doc: string, span: readonly [number, number], value: number): OffsetEdit | null {
  if (!Number.isFinite(value)) return null
  const [start, end] = span
  if (start < 0 || end > doc.length || end <= start) return null
  const text = doc.slice(start, end)
  if (text !== text.trim() || parseTypedNumber(text) === null) return null
  return { range: [start, end], text: formatNumber(value) }
}
