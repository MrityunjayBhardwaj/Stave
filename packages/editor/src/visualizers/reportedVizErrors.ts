/**
 * A visual's renderer writes its own errors to the Console (#2210, #2219).
 *
 * The renderer is the one place every host shares — the preview, an inline
 * `.viz()` view zone, the pop-out — and only the hosts' `onError` differs: the
 * preview writes a row, a view zone just logs to the browser console. So a
 * renderer that can name its file writes the row itself, and marks the error
 * so a host that also writes rows (the preview) doesn't write it again.
 */

import { emitLog } from '../engine/engineLog'
import { formatFriendlyError } from '../engine/friendlyErrors'
import { HYDRA_DOCS_INDEX } from '../monaco/docs/hydra'
import { getHydraLineOffset } from './hydraCompiler'
import { VizSyntaxError } from './vizSyntaxError'

const REPORTED = new WeakSet<Error>()

/** Note that `e` is already in the Console. */
export function markVizErrorReported(e: Error): void {
  REPORTED.add(e)
}

/** Whether a renderer already wrote `e` to the Console. */
export function isReportedVizError(e: Error): boolean {
  return REPORTED.has(e)
}

/**
 * Write a Hydra sketch's error against `source`, in the words and on the line
 * the preview has always used: the friendly message, and the stack's line
 * counted from the user's file rather than the compiled function's header —
 * or, for a syntax error, where it was located in the user's code.
 */
export function reportHydraError(e: Error, source: string): void {
  const parts = formatFriendlyError(e, 'hydra', { index: HYDRA_DOCS_INDEX })
  const offset = getHydraLineOffset()
  // #2220 — a syntax error carries its line in the user's file already.
  const located = e instanceof VizSyntaxError ? e : null
  emitLog({
    level: 'error',
    runtime: 'hydra',
    source,
    message: parts.message,
    suggestion: parts.suggestion,
    stack: parts.stack,
    line: located
      ? located.line
      : parts.line != null && offset > 0 ? Math.max(1, parts.line - offset) : parts.line,
    column: located ? located.column : parts.column,
  })
  markVizErrorReported(e)
}
