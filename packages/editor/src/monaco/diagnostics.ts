import type * as Monaco from 'monaco-editor'

const MARKER_OWNER = 'stave'

/**
 * #2180 — the columns a squiggle on `line` covers: the word or symbol at `column`,
 * not the rest of the line. A word is what Monaco calls one (`getWordAtPosition`,
 * the span a double-click selects), so `.fooo()` underlines `fooo`; anything else
 * — `]`, `)` — is the one character. A column at or past the end of the line (an
 * "unexpected end of input") is its last character. With no column, the line's
 * code from its first non-blank character. `line` must already be in range.
 */
export function errorColumns(
  model: Monaco.editor.ITextModel,
  line: number,
  column?: number,
): { startColumn: number; endColumn: number } {
  const max = model.getLineMaxColumn(line)
  if (column == null || !Number.isFinite(column) || column < 1) {
    return { startColumn: model.getLineFirstNonWhitespaceColumn?.(line) || 1, endColumn: max }
  }
  if (max <= 1) return { startColumn: 1, endColumn: 1 }
  const at = Math.min(column, max - 1)
  const word = model.getWordAtPosition?.({ lineNumber: line, column: at })
  // Monaco also returns the word just BEFORE a position (`5` for the `]` in `0.5]`),
  // so the word counts only when the character at `at` is in it.
  if (word && word.startColumn <= at && at < word.endColumn) {
    return { startColumn: word.startColumn, endColumn: word.endColumn }
  }
  return { startColumn: at, endColumn: at + 1 }
}

/**
 * Attempts to extract a line/column from a V8 stack trace produced by eval().
 *
 * V8 format: "at eval (<anonymous>:LINE:COL)" or "at eval (eval at ...:LINE:COL)"
 * Returns null if no match — caller falls back to full-document range.
 */
function parseErrorLocation(error: Error): { line: number; col: number } | null {
  const stack = error.stack ?? ''
  const match = stack.match(/at eval[^(]*\(.*?:(\d+):(\d+)\)/)
  if (match) {
    return { line: parseInt(match[1], 10), col: parseInt(match[2], 10) }
  }
  return null
}

/**
 * Sets a red error squiggle on the model.
 * If the error has a parseable, in-range location, marks that single line.
 * Otherwise places NO inline marker (and retires any prior one).
 *
 * A locationless error — no `at eval (<anonymous>:L:C)` frame, an empty
 * stack, or a wrapper line past EOF — came from outside the user's visible
 * code (a runtime/library throw with a bundle-only stack: a soundfont
 * out-of-range, a per-hap failure, etc.). Painting the whole document red
 * is misleading noise — the user's file as a whole did not fail — so we
 * skip the inline marker; the Console row, toast, and status chip still
 * carry the message. This mirrors the engineLog→Monaco bridge's
 * skip-when-line-unknown rule (`engineLogMarkers.ts`); the two marker
 * pipelines now agree (#532). Genuine syntax/eval errors are unaffected —
 * Strudel's transpile+eval throw carries a real `at eval` line.
 *
 * Stack-parsed line numbers can exceed the model's line count — Strudel
 * transpiles user code into a wrapper so the reported line may sit past
 * the end of the visible document. Such an out-of-range line is treated as
 * locationless (skip) rather than clamped to the whole document. Any
 * residual Monaco validation error is swallowed so a bad stack trace never
 * tears down the UI (hetvabhasa P37).
 */
export function setEvalError(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  error: Error
): void {
  try {
    const loc = parseErrorLocation(error)
    const lineCount = model.getLineCount()

    const validLine =
      loc && Number.isFinite(loc.line) && loc.line >= 1 && loc.line <= lineCount
        ? loc.line
        : null

    // No parseable in-range location → skip the inline marker and retire any
    // prior eval marker on this model, rather than painting the whole file.
    if (validLine == null) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
      return
    }

    const { startColumn, endColumn } = errorColumns(model, validLine, loc?.col)

    monaco.editor.setModelMarkers(model, MARKER_OWNER, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: validLine,
        startColumn,
        endLineNumber: validLine,
        endColumn,
      },
    ])
  } catch (markerError) {
    // eslint-disable-next-line no-console
    console.warn('[stave] setEvalError failed, marker skipped:', markerError)
  }
}

/**
 * Clears all eval error markers from the model.
 * Call on successful evaluate() or on stop().
 */
export function clearEvalErrors(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): void {
  try {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
  } catch (markerError) {
    // eslint-disable-next-line no-console
    console.warn('[stave] clearEvalErrors failed:', markerError)
  }
}

/**
 * Place a single marker on a specific line. Owner is caller-supplied so
 * log-driven markers (`stave-log`) can coexist with the runtime-driven
 * `setEvalError` markers (`stave`) without clobbering each other — the
 * user sees both surfaces highlight the same line when they overlap.
 *
 * Line/column validation mirrors `setEvalError`: values outside the
 * model's range fall back to a full-document marker. Any residual
 * Monaco throw is swallowed (hetvabhasa P37).
 */
export function setLineMarker(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  opts: {
    line?: number
    column?: number
    message: string
    severity?: 'error' | 'warn' | 'info'
    owner?: string
  }
): void {
  try {
    const lineCount = model.getLineCount()
    const line =
      opts.line != null &&
      Number.isFinite(opts.line) &&
      opts.line >= 1 &&
      opts.line <= lineCount
        ? opts.line
        : null
    const severityMap = {
      error: monaco.MarkerSeverity.Error,
      warn: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
    } as const
    const severity = severityMap[opts.severity ?? 'error']

    const startLine = line ?? 1
    const endLine = line ?? lineCount
    const { startColumn, endColumn } = line
      ? errorColumns(model, line, opts.column)
      : { startColumn: 1, endColumn: model.getLineMaxColumn(endLine) }

    monaco.editor.setModelMarkers(model, opts.owner ?? MARKER_OWNER, [
      {
        severity,
        message: opts.message,
        startLineNumber: startLine,
        startColumn,
        endLineNumber: endLine,
        endColumn,
      },
    ])
  } catch (markerError) {
    // eslint-disable-next-line no-console
    console.warn('[stave] setLineMarker failed, skipped:', markerError)
  }
}

/** Clear markers of a specific owner. Use to drop log-driven squiggles. */
export function clearLineMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  owner: string
): void {
  try {
    monaco.editor.setModelMarkers(model, owner, [])
  } catch (markerError) {
    // eslint-disable-next-line no-console
    console.warn('[stave] clearLineMarkers failed:', markerError)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Strudel idiom lint — F-2 (`.planning/phases/20-musician-timeline/
// FOLLOWUPS.md`).
//
// Strudel's transpiler converts double-quoted string literals to mini-
// notation Patterns at eval time. That's the right default for
// `s("bd cp")`, `note("c d")`, etc. — but for `.p()`, which registers
// the pattern in Strudel's `D` registry keyed by the id, the
// double-quoted form silently becomes `.p(<Pattern>)`. Pre-wave-δ this
// crashed `k.includes is not a function`. Wave-δ added a runtime
// wrapper guard that no-ops on non-string ids — so the call no longer
// throws but is also silently dropped at runtime (the user's chosen
// track id is registered nowhere).
//
// This lint surfaces the gap at WRITE time: `.p("...")` gets a yellow
// warning squiggle prompting the user to rewrite as `.p('...')`. The
// IR-side 20-11 parser accepts both quote styles so the timeline
// label is consistent either way; the lint exists to keep the runtime
// + IR contracts visibly aligned to the user.
//
// Scan: regex over the model text. Cheap (model.getValue is O(N)
// where N is doc size; for live-coding files this is a few KB max).
// Stays in single-pass / no incremental re-tokenisation.
// ─────────────────────────────────────────────────────────────────────────

const STRUDEL_LINT_OWNER = 'stave-strudel-lint'
const STRUDEL_DOUBLE_QUOTED_P_RE = /\.p\(\s*"([^"\n\r]*)"\s*\)/g

/**
 * Scan `model` for `.p("name")` (double-quoted) call sites and emit a
 * Warning marker at each. Idempotent — repeated calls replace the
 * previous marker set under owner `stave-strudel-lint`.
 *
 * Call from `model.onDidChangeContent` on Strudel models AND once on
 * editor mount so the lint reflects the persisted file content on
 * first paint.
 */
export function refreshStrudelLintMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): void {
  try {
    const text = model.getValue()
    const markers: Monaco.editor.IMarkerData[] = []

    STRUDEL_DOUBLE_QUOTED_P_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = STRUDEL_DOUBLE_QUOTED_P_RE.exec(text))) {
      const matchStart = m.index
      const matchEnd = matchStart + m[0].length
      const startPos = model.getPositionAt(matchStart)
      const endPos = model.getPositionAt(matchEnd)
      const inner = m[1]
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: `Strudel's transpiler converts double-quoted strings to mini-notation, so .p("${inner}") becomes .p(<Pattern>) at runtime — the track-id registration silently no-ops. Use single quotes: .p('${inner}').`,
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
        source: 'stave',
        code: 'strudel/p-double-quoted',
      })
    }

    monaco.editor.setModelMarkers(model, STRUDEL_LINT_OWNER, markers)
  } catch (lintError) {
    // eslint-disable-next-line no-console
    console.warn('[stave] refreshStrudelLintMarkers failed:', lintError)
  }
}

/** Drop every Strudel idiom-lint marker on the model. Use on dispose. */
export function clearStrudelLintMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): void {
  try {
    monaco.editor.setModelMarkers(model, STRUDEL_LINT_OWNER, [])
  } catch {
    /* swallow — see hetvabhasa P37 */
  }
}

/**
 * Register a one-shot Monaco code-action provider that converts the
 * `.p("...")` warning into a quick-fix the user can accept (alt-Enter /
 * lightbulb). Rewrites `"..."` → `'...'` at the same range.
 *
 * Idempotent under the `disposed` ref — multiple calls reuse a single
 * provider registration. The provider is owned by the editor's
 * lifetime; we don't need to unregister explicitly (Monaco's namespace
 * persists for the page lifetime).
 *
 * Returns the disposable for tests / callers that want to tear down.
 */
let strudelLintProviderDisposable: Monaco.IDisposable | null = null
export function ensureStrudelLintCodeActionProvider(
  monaco: typeof Monaco,
  languageId: string,
): Monaco.IDisposable {
  if (strudelLintProviderDisposable) return strudelLintProviderDisposable
  strudelLintProviderDisposable = monaco.languages.registerCodeActionProvider(
    languageId,
    {
      provideCodeActions(model, _range, context) {
        const fixes: Monaco.languages.CodeAction[] = []
        for (const marker of context.markers) {
          if (marker.code !== 'strudel/p-double-quoted') continue
          // Re-read the matched text from the model so the quick-fix
          // mirrors the exact slice the marker covers (handles edits
          // since marker creation gracefully — if mis-aligned, the
          // quick-fix still rewrites what's at the range now).
          const slice = model.getValueInRange({
            startLineNumber: marker.startLineNumber,
            startColumn: marker.startColumn,
            endLineNumber: marker.endLineNumber,
            endColumn: marker.endColumn,
          })
          const rewritten = slice.replace(
            /\.p\(\s*"([^"\n\r]*)"\s*\)/,
            ".p('$1')",
          )
          if (rewritten === slice) continue
          fixes.push({
            title: "Rewrite .p(\"...\") to .p('...') (single quotes)",
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: [marker],
            edit: {
              edits: [
                {
                  resource: model.uri,
                  textEdit: {
                    range: {
                      startLineNumber: marker.startLineNumber,
                      startColumn: marker.startColumn,
                      endLineNumber: marker.endLineNumber,
                      endColumn: marker.endColumn,
                    },
                    text: rewritten,
                  },
                  versionId: model.getVersionId(),
                },
              ],
            },
          })
        }
        return { actions: fixes, dispose() { /* no-op */ } }
      },
    },
  )
  return strudelLintProviderDisposable
}
