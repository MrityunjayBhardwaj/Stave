/**
 * Bridge engineLog → Monaco inline markers.
 *
 * Every log entry that carries `source` + `line` places a squiggle on
 * the matching file's Monaco model. `emitFixed` clears all log-driven
 * squiggles for that `(runtime, source)` pair — so a clean re-eval
 * immediately retires the prior error's marker, matching Live mode's
 * Console-panel behaviour at the inline surface.
 *
 * Owner namespace: `stave-log`. Deliberately different from the
 * `stave` owner used by `setEvalError` (driven by EditorView's `error`
 * prop for Strudel/Sonic Pi's existing in-prop error pipeline), so the
 * two paths don't clobber each other when they agree on a line — the
 * user just sees the line highlighted, Monaco merges same-owner lists
 * but shows different-owner markers stacked.
 *
 * The bridge is a module-level subscriber that installs once. Call
 * `installEngineLogMarkers()` from shell init; subsequent calls are
 * no-ops. Unsubscribes are not exposed — the bridge's lifetime matches
 * the process.
 */

import {
  subscribeLog,
  subscribeFixed,
  type LogEntry,
  type FixedMarker,
  type RuntimeId,
} from '../engine/engineLog'
import {
  getEditorForFile,
  getMonacoNamespace,
} from './editorRegistry'
import { listWorkspaceFiles } from './WorkspaceFile'
import { setLineMarker, clearLineMarkers } from '../monaco/diagnostics'

const OWNER = 'stave-log'

let installed = false

/**
 * Track the active (runtime, fileId) pairs so we can clear
 * deterministically on a fix. Set-keyed (not an array) because a
 * flooding emitter — p5 FES firing each frame inside `draw()`, or a
 * hap subscriber re-raising the same error — would otherwise push
 * thousands of duplicates. The set collapses those to one membership
 * entry and the fix loop stays cheap.
 */
const activeMarkers = new Set<string>()
const markerKey = (runtime: RuntimeId, fileId: string): string =>
  `${runtime}:${fileId}`

function findFileIdForSource(source: string): string | null {
  // Workspace paths are unique per file, so this is a safe lookup.
  // Fall back to `source` itself — StrudelEditorClient uses
  // `fileNow?.path ?? fileId` as the source, so bare fileIds can
  // appear when the workspace file is missing (edge case during
  // unmount / swap).
  const files = listWorkspaceFiles()
  const byPath = files.find((f) => f.path === source)
  if (byPath) return byPath.id
  const byId = files.find((f) => f.id === source)
  if (byId) return byId.id
  return null
}

function getModelForFile(fileId: string): {
  monaco: ReturnType<typeof getMonacoNamespace>
  model: unknown
} | null {
  const editor = getEditorForFile(fileId)
  const monaco = getMonacoNamespace()
  if (!editor || !monaco) return null
  const model = editor.getModel?.()
  if (!model) return null
  return { monaco, model }
}

function applyEntry(entry: LogEntry): void {
  if (!entry.source || entry.line == null) return
  const fileId = findFileIdForSource(entry.source)
  if (!fileId) return
  const resolved = getModelForFile(fileId)
  if (!resolved) return
  // Guard against a stack-parsed line that sits past the user's file.
  // `new Function` errors sometimes carry line numbers relative to the
  // generated wrapper body (or to a bundle frame that slipped through
  // parseStackLocation's filters). `setLineMarker` would clamp that to
  // the full-document range and paint the whole sketch red — visually
  // louder than "we don't know where it is." Skip instead; the Console
  // row already carries the message, and nothing else pretends to
  // know the line.
  const model = resolved.model as { getLineCount?: () => number }
  const lineCount = model.getLineCount?.() ?? 0
  if (entry.line < 1 || entry.line > lineCount) return
  // Severity mapping: engine 'error' / 'warn' / 'info' → Monaco
  // Error / Warning / Info.
  const severity = entry.level
  setLineMarker(
    resolved.monaco as Parameters<typeof setLineMarker>[0],
    resolved.model as Parameters<typeof setLineMarker>[1],
    {
      line: entry.line,
      column: entry.column,
      // #2170 — "try" only names a symbol; a hint without one says just the hint.
      message: entry.suggestion?.name
        ? `${entry.message} — try \`${entry.suggestion.name}\``
        : entry.message,
      severity,
      owner: OWNER,
    },
  )
  activeMarkers.add(markerKey(entry.runtime, fileId))
}

function clearForFix(marker: FixedMarker): void {
  const prefix = `${marker.runtime}:`
  if (!marker.source) {
    // Runtime-wide fix — clear every active marker for this runtime.
    for (const key of Array.from(activeMarkers)) {
      if (!key.startsWith(prefix)) continue
      const fileId = key.slice(prefix.length)
      const resolved = getModelForFile(fileId)
      if (resolved) {
        clearLineMarkers(
          resolved.monaco as Parameters<typeof clearLineMarkers>[0],
          resolved.model as Parameters<typeof clearLineMarkers>[1],
          OWNER,
        )
      }
      activeMarkers.delete(key)
    }
    return
  }
  const fileId = findFileIdForSource(marker.source)
  if (!fileId) return
  const resolved = getModelForFile(fileId)
  if (!resolved) return
  clearLineMarkers(
    resolved.monaco as Parameters<typeof clearLineMarkers>[0],
    resolved.model as Parameters<typeof clearLineMarkers>[1],
    OWNER,
  )
  activeMarkers.delete(markerKey(marker.runtime, fileId))
}

/** Wire the bridge. Idempotent. */
export function installEngineLogMarkers(): void {
  if (installed) return
  installed = true
  subscribeLog((entry) => {
    if (!entry) return // clearLog notification
    try {
      applyEntry(entry)
    } catch {
      // A broken model resolver must not kill the subscriber chain.
    }
  })
  subscribeFixed((marker) => {
    try {
      clearForFix(marker)
    } catch {
      /* ignore */
    }
  })
}

/** TESTING ONLY — reset the bridge between suites. */
export function __resetEngineLogMarkersForTests(): void {
  installed = false
  activeMarkers.clear()
}
