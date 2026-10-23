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
import { setLineMarker, clearLineMarkers, errorColumns } from '../monaco/diagnostics'

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

/**
 * #2184 / #2185 — where a placed squiggle is now, and whether it still fits.
 * Monaco moves a squiggle with the edits around it, but the marker's numbers
 * and the log entry's `line` stay where the run put them, so going to the
 * error after typing above it landed on the old line. A tracked range that
 * never grows at its edges moves the way the squiggle does, so it says where
 * the error is now; the text it covered says whether the message still
 * describes what is there.
 */
interface Range {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}
interface MarkerData extends Range {
  severity: number
  message: string
}
/** the parts of a Monaco text model the tracking uses */
interface TrackedModel {
  deltaDecorations(oldIds: string[], next: { range: Range; options: object }[]): string[]
  getDecorationRange(id: string): Range | null
  getValueInRange(range: Range): string
  onDidChangeContent(listener: () => void): { dispose(): void }
  onWillDispose?(listener: () => void): { dispose(): void }
}
interface Placed {
  entryId: string
  /** the run's error it was found beside (#2186) */
  alongside?: string
  /** where the run put it, to tell a repeat of the same entry from a new place */
  at: string
  decorationId: string
  /** the text the squiggle covered when it was placed */
  text: string
  marker: MarkerData
  /** false once an edit changed the text it covered (#2185) */
  shown: boolean
  /** the line it was on after the last edit, to tell listeners only when it moved */
  line: number
}
interface Track {
  model: TrackedModel
  placed: Placed[]
  stop: () => void
}
const tracks = new Map<string, Track>()
const positionListeners = new Set<() => void>()

const isTrackable = (model: unknown): model is TrackedModel =>
  typeof (model as TrackedModel | null)?.deltaDecorations === 'function' &&
  typeof (model as TrackedModel).getDecorationRange === 'function' &&
  typeof (model as TrackedModel).onDidChangeContent === 'function'

function notifyPositions(): void {
  for (const listener of positionListeners) {
    try {
      listener()
    } catch {
      /* one listener must not stop the rest */
    }
  }
}

function untrack(fileId: string): void {
  const track = tracks.get(fileId)
  if (!track) return
  tracks.delete(fileId)
  track.stop()
  try {
    track.model.deltaDecorations(track.placed.map((p) => p.decorationId), [])
  } catch {
    /* a disposed model has nothing left to remove */
  }
  notifyPositions()
}

/** After an edit: drop the squiggles whose text changed, keep the rest where they now are. */
function onEdited(fileId: string, track: Track): void {
  const monaco = getMonacoNamespace() as { editor?: { setModelMarkers?: Function } } | null
  let dropped = false
  let moved = false
  for (const p of track.placed) {
    const range = track.model.getDecorationRange(p.decorationId)
    const line = range?.startLineNumber ?? p.line
    if (line !== p.line) {
      p.line = line
      moved = true
    }
    if (!p.shown) continue
    if (!range || track.model.getValueInRange(range) !== p.text) {
      p.shown = false
      dropped = true
    }
  }
  if (dropped) {
    const still = track.placed
      .filter((p) => p.shown)
      .map((p) => ({ ...p.marker, ...track.model.getDecorationRange(p.decorationId) }))
    monaco?.editor?.setModelMarkers?.(track.model, OWNER, still)
    if (still.length === 0) activeMarkers.forEach((key) => key.endsWith(`:${fileId}`) && activeMarkers.delete(key))
  }
  // Typing that moves no error (most keystrokes) re-renders nothing.
  if (moved) notifyPositions()
}

/**
 * Follow the squiggle just placed for `entryId`. It replaces the file's others,
 * as the marker did, except those of its own run (`kept`, #2186).
 */
function trackPlaced(fileId: string, model: unknown, entry: LogEntry, marker: MarkerData, kept: Placed[]): void {
  if (!isTrackable(model)) return
  let track = tracks.get(fileId)
  if (track && track.model !== model) {
    untrack(fileId)
    track = undefined
  }
  const monaco = getMonacoNamespace() as {
    editor?: { TrackedRangeStickiness?: { NeverGrowsWhenTypingAtEdges?: number } }
  } | null
  const stickiness = monaco?.editor?.TrackedRangeStickiness?.NeverGrowsWhenTypingAtEdges ?? 1
  const range: Range = {
    startLineNumber: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber,
    endColumn: marker.endColumn,
  }
  const [decorationId] = model.deltaDecorations(
    track ? track.placed.filter((p) => !kept.includes(p)).map((p) => p.decorationId) : [],
    [{ range, options: { stickiness } }],
  )
  const placed: Placed = {
    entryId: entry.id,
    alongside: entry.alongside,
    at: `${entry.line}:${entry.column ?? ''}:${entry.message}`,
    decorationId,
    text: model.getValueInRange(range),
    marker,
    shown: true,
    line: range.startLineNumber,
  }
  if (track) {
    track.placed = [...kept, placed]
  } else {
    const t: Track = { model, placed: [placed], stop: () => {} }
    const sub = model.onDidChangeContent(() => onEdited(fileId, t))
    // A closed file's model is disposed, and reading a range off it throws.
    const gone = model.onWillDispose?.(() => untrack(fileId))
    t.stop = () => {
      sub.dispose()
      gone?.dispose()
    }
    tracks.set(fileId, t)
  }
  notifyPositions()
}

/**
 * #2184 — where the squiggle for this log entry is now, following edits made
 * since the run. Null when there is none to follow (the entry had no line, or
 * a later error or a clean run replaced it); the entry's own `line` is then
 * the best there is.
 */
export function errorPositionNow(entryId: string): { line: number; column: number } | null {
  for (const track of tracks.values()) {
    const p = track.placed.find((q) => q.entryId === entryId)
    if (!p) continue
    try {
      const range = track.model.getDecorationRange(p.decorationId)
      return range ? { line: range.startLineNumber, column: range.startColumn } : null
    } catch {
      return null // a model disposed without telling us: the Console renders this
    }
  }
  return null
}

/** Called after any edit that may have moved an error (#2184). Returns the unsubscribe. */
export function subscribeErrorPositions(listener: () => void): () => void {
  positionListeners.add(listener)
  return () => {
    positionListeners.delete(listener)
  }
}

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
  // A repeat of the same entry (a play-time error raised every cycle, or the
  // same failing code run again) keeps the place its squiggle has followed
  // since, instead of jumping back to the line the run reported (#2184). One
  // taken off because its text was edited (#2185) comes back only if the
  // reported place reads as it did, e.g. after an undo.
  const track = tracks.get(fileId)
  const placedBefore = track?.placed.find((p) => p.entryId === entry.id)
  if (placedBefore && placedBefore.at === `${entry.line}:${entry.column ?? ''}:${entry.message}`) {
    if (placedBefore.shown) return
    const cols = errorColumns(resolved.model as Parameters<typeof errorColumns>[0], entry.line, entry.column)
    const there = track!.model.getValueInRange({ startLineNumber: entry.line, endLineNumber: entry.line, ...cols })
    if (there !== placedBefore.text) return
  }
  const marker = setLineMarker(
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
  // #2186 — a mistake found beside the run's error joins that run's squiggles,
  // which `setLineMarker` (one marker per file) has just replaced.
  const kept = entry.alongside === undefined || !track
    ? []
    : track.placed.filter((p) => p.entryId !== entry.id
      && (p.entryId === entry.alongside || p.alongside === entry.alongside))
  if (marker && kept.length > 0) {
    const shown = kept
      .filter((p) => p.shown)
      .map((p) => ({ ...p.marker, ...track!.model.getDecorationRange(p.decorationId) }))
    const monaco = resolved.monaco as { editor: { setModelMarkers: Function } }
    monaco.editor.setModelMarkers(resolved.model, OWNER, [...shown, marker])
  }
  activeMarkers.add(markerKey(entry.runtime, fileId))
  if (marker) trackPlaced(fileId, resolved.model, entry, marker as MarkerData, kept)
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
      untrack(fileId)
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
  untrack(fileId)
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
  for (const fileId of Array.from(tracks.keys())) untrack(fileId)
  positionListeners.clear()
}
