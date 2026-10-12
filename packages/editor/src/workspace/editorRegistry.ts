/**
 * editorRegistry — tiny module-level map so callers outside the
 * editor package (shell, app, outline panel) can find the Monaco
 * editor instance that's currently rendering a given fileId. Used
 * for cross-file navigation features like "reveal at line".
 *
 * EditorView registers on mount and unregisters on unmount. Only the
 * ACTIVE editor for a fileId matters — if two groups show the same
 * file, the last mount wins, which matches the UX ("jump to this
 * symbol" lands wherever the editor is currently focused).
 */

import { DEFAULT_VIZ_ENGINE } from '../visualizers/signals/aliasMap'
import type {
  VizEngine,
  EngineAliasMap,
  StoredSignalAliases,
} from '../visualizers/signals/aliasMap'
import { perf } from '../perf/profiler'
import { vizGovernor } from '../visualizers/vizGovernor'
import {
  DEFAULT_VIZ_QUALITY,
  deriveVizQuality,
  updateVizConfig,
  type VizQualityLevel,
} from '../visualizers/vizConfig'
import { TOUCH_POINTER_QUERY } from '../visualEdit/panels/usePhone'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoEditor = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoNs = any

const editors = new Map<string, MonacoEditor>()
// One monaco namespace per process (all editors share it). Captured on
// first mount so global operations (setTheme) can run without holding
// onto a specific editor ref.
let monacoNs: MonacoNs | null = null

export function registerMonacoNamespace(monaco: MonacoNs): void {
  if (!monacoNs) monacoNs = monaco
}

/**
 * Return the Monaco namespace captured at first editor mount. `null`
 * until any editor has rendered — callers relying on this for
 * cross-editor operations (setModelMarkers, setTheme) should early-exit
 * when it's missing, not throw.
 */
export function getMonacoNamespace(): MonacoNs | null {
  return monacoNs
}

export function registerEditor(fileId: string, editor: MonacoEditor): void {
  editors.set(fileId, editor)
}

export function unregisterEditor(fileId: string, editor: MonacoEditor): void {
  if (editors.get(fileId) === editor) editors.delete(fileId)
  // If the editor going away was the active one, clear it so panels bound to
  // the active editor (visual-editing Mixer/Sequencer/Piano Roll) fall back to
  // standby instead of holding a disposed instance.
  if (activeEditor === editor) setActiveEditor(null)
}

export function getEditorForFile(fileId: string): MonacoEditor | undefined {
  return editors.get(fileId)
}

// ── Active editor ───────────────────────────────────────────────────
// The Monaco editor the user is currently working in (last focused / mounted).
// Visual-editing panels bind to it so they always act on the editor in view,
// across splits and tab switches. EditorView sets it on mount and on focus.

let activeEditor: MonacoEditor | null = null
const activeEditorListeners = new Set<() => void>()

/** Set (or clear) the active editor; notifies subscribers on change. */
export function setActiveEditor(editor: MonacoEditor | null): void {
  if (activeEditor === editor) return
  activeEditor = editor
  for (const l of activeEditorListeners) {
    try {
      l()
    } catch {
      /* a listener error must not block the others */
    }
  }
}

/** The active Monaco editor, or null if none is focused/mounted. */
export function getActiveEditor(): MonacoEditor | null {
  return activeEditor
}

/**
 * The fileId of the active editor, or null if none is active. Reverse-looks-up
 * the registry (one registered editor per fileId). Visual-editing consumers that
 * must follow the SAME file the active editor shows — e.g. the Mixer meters
 * pinning the audio bus to the active program rather than the bus's "default"
 * (most-recent) publisher, which can be a chord/sample/drum preview — use this.
 */
export function getActiveFileId(): string | null {
  if (!activeEditor) return null
  for (const [fileId, ed] of editors) {
    if (ed === activeEditor) return fileId
  }
  return null
}

/** The fileId registered for `editor`, or null. The write path uses this to
 * re-evaluate the file that was actually EDITED (not necessarily the active
 * one) when a visual mutation commits. */
export function getFileIdForEditor(editor: MonacoEditor): string | null {
  for (const [fileId, ed] of editors) {
    if (ed === editor) return fileId
  }
  return null
}

/** Subscribe to active-editor changes. Returns an unsubscribe fn. */
export function onActiveEditorChange(cb: () => void): () => void {
  activeEditorListeners.add(cb)
  return () => {
    activeEditorListeners.delete(cb)
  }
}

// Re-evaluate seam — the app owns the runtime, the editor package doesn't, so a
// visual-editing control that must take audible effect immediately (the Mixer's
// live mute) requests a re-eval through here. The app registers a handler that
// re-evaluates the file ONLY if it is currently playing — so a control edit
// never auto-STARTS audio that the user hadn't started. No-op when no handler is
// registered (tests, or before the app mounts).
let reevalHandler: ((fileId: string) => void) | null = null

/** App-side: register how to re-evaluate a playing file. Returns an unregister fn. */
export function registerReevalHandler(fn: (fileId: string) => void): () => void {
  reevalHandler = fn
  return () => {
    if (reevalHandler === fn) reevalHandler = null
  }
}

/** Editor-side: request an immediate re-eval of `fileId` (no-op if unregistered). */
export function requestReeval(fileId: string | null): void {
  if (fileId) reevalHandler?.(fileId)
}

// Eval-source transform seam — the Mixer's SOLO is ephemeral monitoring state
// (design D3): it must never be written to the file, only applied to the STRING
// sent to the engine. The app wraps its `getFileContent` closure with
// `applyEvalSourceTransform`, so a registered transform (the solo overlay) can
// rewrite the source at eval time. The DEFAULT is exact identity (no transform
// registered → the raw content passes through byte-for-byte), so this can never
// alter playback unless something is actively soloed. The mixer re-evals via the
// existing `requestReeval` seam when solo changes.
let evalSourceTransform: ((fileId: string, raw: string) => string) | null = null

/** Editor-side: register a transform applied to a file's source before eval.
 *  Returns an unregister fn. Replaces any prior transform (one owner). */
export function registerEvalSourceTransform(
  fn: (fileId: string, raw: string) => string,
): () => void {
  evalSourceTransform = fn
  return () => {
    if (evalSourceTransform === fn) evalSourceTransform = null
  }
}

/** App-side: apply the registered eval-source transform (identity if none, and
 *  identity-on-throw so a transform bug can never break playback). */
export function applyEvalSourceTransform(fileId: string, raw: string): string {
  if (!evalSourceTransform) return raw
  try {
    return evalSourceTransform(fileId, raw)
  } catch {
    return raw
  }
}

/**
 * Does revealing a place in the code also give the editor keyboard focus (#2017)?
 *
 * With a mouse, yes: the editor hides its caret while blurred, so focus is what
 * makes the jump visible. On a touch device, no: focusing the editor's text field
 * is what summons the on-screen keyboard, and a reveal is a SELECTION made in the
 * Timeline, the Mixer or a list — nobody asked to type. There the cursor still
 * moves and the code still scrolls; the keyboard opens when the code itself is
 * tapped.
 *
 * Every reveal asks this one function, so the three of them cannot drift apart.
 */
export function revealTakesFocus(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return !window.matchMedia(TOUCH_POINTER_QUERY).matches
}

/**
 * Reveal the given line in the editor for `fileId` and set the cursor
 * at column 1. Returns true if the editor was found. Line numbers are
 * 1-based.
 */
export function revealLineInFile(fileId: string, line: number): boolean {
  const editor = editors.get(fileId)
  if (!editor) return false
  try {
    editor.revealLineInCenter?.(line)
    editor.setPosition?.({ lineNumber: line, column: 1 })
    if (revealTakesFocus()) editor.focus?.()
    return true
  } catch {
    return false
  }
}

/**
 * Reveal a source CHARACTER OFFSET in the editor for `fileId`, placing the cursor
 * at its exact line AND column (not column 1). Returns true if the editor was
 * found. Use this when the cursor position must land INSIDE a specific
 * expression — e.g. binding a track that is one arm of a combinator on a shared
 * line (`arrange([w, pat], …)`): column 1 resolves to the whole combinator
 * (standby), while the leaf's own offset descends to the arm (#472). Falls back
 * to line-only reveal if the model can't map the offset.
 */
export function revealOffsetInFile(fileId: string, offset: number): boolean {
  const editor = editors.get(fileId)
  if (!editor) return false
  try {
    const pos = editor.getModel?.()?.getPositionAt?.(offset)
    if (!pos) return false
    editor.revealLineInCenter?.(pos.lineNumber)
    editor.setPosition?.(pos)
    if (revealTakesFocus()) editor.focus?.()
    return true
  } catch {
    return false
  }
}

// ── Global editor options ──────────────────────────────────────────

const DEFAULT_FONT_SIZE = 14
const FONT_SIZE_STORAGE = 'stave:editorFontSize'
const MINIMAP_STORAGE = 'stave:editorMinimap'
const DEFAULT_UI_ICON_SIZE = 25
const UI_ICON_SIZE_STORAGE = 'stave:uiIconSize'
/** CSS variable that scales every chrome-level icon glyph (menu gear,
 *  activity bar, etc.). Applied to documentElement on mount and on
 *  every change. */
export const UI_ICON_SIZE_VAR = '--ui-icon-size'

const DEFAULT_INLINE_VIZ_ACTION_SIZE = 11
const INLINE_VIZ_ACTION_SIZE_STORAGE = 'stave:inlineVizActionSize'
/** Separate CSS variable for the floating action buttons (edit / crop)
 *  attached to inline `.viz()` zones. They sit inside the canvas area
 *  and tend to need a tighter scale than the rest of the chrome —
 *  hence their own slider, independent of the main UI icon size. */
export const INLINE_VIZ_ACTION_SIZE_VAR = '--inline-viz-action-size'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    if (typeof window.localStorage?.getItem !== 'function') return null
    return window.localStorage
  } catch {
    return null
  }
}

function readFontSize(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_FONT_SIZE
  const saved = Number(ls.getItem(FONT_SIZE_STORAGE))
  return Number.isFinite(saved) && saved >= 8 && saved <= 40 ? saved : DEFAULT_FONT_SIZE
}

function readMinimap(): boolean {
  const ls = safeLocalStorage()
  return ls?.getItem(MINIMAP_STORAGE) === '1'
}

function writeFontSize(size: number): void {
  safeLocalStorage()?.setItem(FONT_SIZE_STORAGE, String(size))
}

function writeMinimap(on: boolean): void {
  safeLocalStorage()?.setItem(MINIMAP_STORAGE, on ? '1' : '0')
}

function applyOptionsToEditor(editor: MonacoEditor): void {
  const fontSize = readFontSize()
  const minimap = readMinimap()
  editor.updateOptions?.({ fontSize, minimap: { enabled: minimap } })
}

/** Get the current global editor font size (px). */
export function getEditorFontSize(): number { return readFontSize() }

/** Get the current global minimap visibility flag. */
export function getEditorMinimap(): boolean { return readMinimap() }

/** Set the font size (clamped 8–40) and apply to every open editor. */
export function setEditorFontSize(size: number): void {
  const clamped = Math.max(8, Math.min(40, Math.round(size)))
  writeFontSize(clamped)
  for (const ed of editors.values()) ed.updateOptions?.({ fontSize: clamped })
}

/** Bump font size by delta (positive / negative). */
export function bumpEditorFontSize(delta: number): void {
  setEditorFontSize(readFontSize() + delta)
}

/** Toggle minimap visibility across every open editor. */
export function toggleEditorMinimap(): void {
  const next = !readMinimap()
  writeMinimap(next)
  for (const ed of editors.values()) ed.updateOptions?.({ minimap: { enabled: next } })
}

// ── UI icon size (scales chrome glyphs: ⚙, ▢, ✎, etc.) ─────────────
const uiIconSizeListeners = new Set<(size: number) => void>()

function readUiIconSize(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_UI_ICON_SIZE
  const saved = Number(ls.getItem(UI_ICON_SIZE_STORAGE))
  return Number.isFinite(saved) && saved >= 10 && saved <= 40
    ? saved
    : DEFAULT_UI_ICON_SIZE
}

function writeUiIconSize(size: number): void {
  safeLocalStorage()?.setItem(UI_ICON_SIZE_STORAGE, String(size))
}

function applyUiIconSizeVar(size: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(UI_ICON_SIZE_VAR, `${size}px`)
}

export function getEditorUiIconSize(): number { return readUiIconSize() }

export function setEditorUiIconSize(size: number): void {
  const clamped = Math.max(10, Math.min(40, Math.round(size)))
  writeUiIconSize(clamped)
  applyUiIconSizeVar(clamped)
  for (const cb of Array.from(uiIconSizeListeners)) cb(clamped)
}

export function onUiIconSizeChange(cb: (size: number) => void): () => void {
  uiIconSizeListeners.add(cb)
  return () => { uiIconSizeListeners.delete(cb) }
}

/** Apply the persisted icon size to the document root on first mount. */
export function applyPersistedUiIconSize(): void {
  applyUiIconSizeVar(readUiIconSize())
}

// ── Inline-viz action button size (edit / crop on viz zones) ────────
const inlineVizActionSizeListeners = new Set<(size: number) => void>()

function readInlineVizActionSize(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_INLINE_VIZ_ACTION_SIZE
  const saved = Number(ls.getItem(INLINE_VIZ_ACTION_SIZE_STORAGE))
  return Number.isFinite(saved) && saved >= 8 && saved <= 28
    ? saved
    : DEFAULT_INLINE_VIZ_ACTION_SIZE
}

function writeInlineVizActionSize(size: number): void {
  safeLocalStorage()?.setItem(INLINE_VIZ_ACTION_SIZE_STORAGE, String(size))
}

function applyInlineVizActionSizeVar(size: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(
    INLINE_VIZ_ACTION_SIZE_VAR,
    `${size}px`,
  )
}

export function getInlineVizActionSize(): number {
  return readInlineVizActionSize()
}

export function setInlineVizActionSize(size: number): void {
  const clamped = Math.max(8, Math.min(28, Math.round(size)))
  writeInlineVizActionSize(clamped)
  applyInlineVizActionSizeVar(clamped)
  for (const cb of Array.from(inlineVizActionSizeListeners)) cb(clamped)
}

export function onInlineVizActionSizeChange(
  cb: (size: number) => void,
): () => void {
  inlineVizActionSizeListeners.add(cb)
  return () => { inlineVizActionSizeListeners.delete(cb) }
}

export function applyPersistedInlineVizActionSize(): void {
  applyInlineVizActionSizeVar(readInlineVizActionSize())
}

// ── Inline-viz render resolution (#261 follow-up) ───────────────────
// Project-wide render backing-store HEIGHT (px) for inline `.viz()` zones.
// The zone renders at this resolution (width = aspect-preserved) and the
// existing layout STRETCHES it to the computed display rect — so display
// size, crop, and the drag-to-resize behaviour are all unchanged; only the
// pixel resolution the sketch renders at changes. Lower = cheaper blit /
// softer; higher = crisper / costlier (the per-instance blit is pixel-bound,
// #261 profile). Applies to new/re-evaluated zones. Default 512.
const DEFAULT_INLINE_VIZ_RESOLUTION = 512
const MIN_INLINE_VIZ_RESOLUTION = 64
const MAX_INLINE_VIZ_RESOLUTION = 2048
const INLINE_VIZ_RESOLUTION_STORAGE = 'stave:inlineVizResolution'
const inlineVizResolutionListeners = new Set<(n: number) => void>()

function readInlineVizResolution(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_INLINE_VIZ_RESOLUTION
  const saved = Number(ls.getItem(INLINE_VIZ_RESOLUTION_STORAGE))
  return Number.isFinite(saved) &&
    saved >= MIN_INLINE_VIZ_RESOLUTION &&
    saved <= MAX_INLINE_VIZ_RESOLUTION
    ? saved
    : DEFAULT_INLINE_VIZ_RESOLUTION
}

function writeInlineVizResolution(n: number): void {
  safeLocalStorage()?.setItem(INLINE_VIZ_RESOLUTION_STORAGE, String(n))
}

/** Current inline-viz render resolution (height in px). */
export function getInlineVizResolution(): number {
  return readInlineVizResolution()
}

/** Set the inline-viz render resolution (clamped 64–2048). Notifies listeners;
 *  takes effect on the next zone (re)mount / evaluate. */
export function setInlineVizResolution(n: number): void {
  const clamped = Math.max(
    MIN_INLINE_VIZ_RESOLUTION,
    Math.min(MAX_INLINE_VIZ_RESOLUTION, Math.round(n)),
  )
  writeInlineVizResolution(clamped)
  for (const cb of Array.from(inlineVizResolutionListeners)) cb(clamped)
}

export function onInlineVizResolutionChange(cb: (n: number) => void): () => void {
  inlineVizResolutionListeners.add(cb)
  return () => { inlineVizResolutionListeners.delete(cb) }
}

// ── Viz quality / "performance mode" (Phase D, #269) ────────────────
// The headline quality knob. A single level scales BOTH the inline-viz render
// RESOLUTION (above — composite/fill cost) AND the sketch LOD `density`
// (vizConfig — segment count for CPU-tessellation meshes), because the winning
// lever differs by sketch class (#232). `deriveVizQuality` maps the level to
// both; this setter applies each to its own channel:
//   resolution → setInlineVizResolution (applies on next (re)mount)
//   density    → updateVizConfig (MERGE — marshalled live to the worker via the
//                config channel, so a worker sketch's next frame reads u.density)
// `balanced` is the default and maps to today's values (512 / 1) → no regression.
// The standalone render-resolution setting remains an advanced override; quality
// is a preset over it (last-write-wins on resolution).
const VIZ_QUALITY_STORAGE = 'stave:vizQuality'
const VIZ_QUALITY_LEVELS: readonly VizQualityLevel[] = ['high', 'balanced', 'performance']
const vizQualityListeners = new Set<(level: VizQualityLevel) => void>()

function readVizQuality(): VizQualityLevel {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_VIZ_QUALITY
  const saved = ls.getItem(VIZ_QUALITY_STORAGE)
  return VIZ_QUALITY_LEVELS.includes(saved as VizQualityLevel)
    ? (saved as VizQualityLevel)
    : DEFAULT_VIZ_QUALITY
}

function writeVizQuality(level: VizQualityLevel): void {
  safeLocalStorage()?.setItem(VIZ_QUALITY_STORAGE, level)
}

/** Push a quality level's two knobs onto their channels. Shared by the setter
 *  and the startup `applyPersistedVizQuality` so persistence and live-set agree. */
function applyVizQuality(level: VizQualityLevel): void {
  const { resolution, density } = deriveVizQuality(level)
  setInlineVizResolution(resolution)
  updateVizConfig({ density })
}

/** Current viz quality level ("performance mode"). */
export function getVizQuality(): VizQualityLevel {
  return readVizQuality()
}

/** Set the viz quality level — persists, applies resolution + density to their
 *  channels (the density marshals live to worker viz), and notifies listeners. */
export function setVizQuality(level: VizQualityLevel): void {
  const safe = VIZ_QUALITY_LEVELS.includes(level) ? level : DEFAULT_VIZ_QUALITY
  writeVizQuality(safe)
  applyVizQuality(safe)
  for (const cb of Array.from(vizQualityListeners)) cb(safe)
}

export function onVizQualityChange(cb: (level: VizQualityLevel) => void): () => void {
  vizQualityListeners.add(cb)
  return () => { vizQualityListeners.delete(cb) }
}

/** Restore the persisted quality's DENSITY into the vizConfig singleton on
 *  startup (call once at app init, like `applyPersistedInlineVizActionSize`).
 *
 *  Density ONLY — deliberately NOT resolution. Resolution is pull-model (read
 *  fresh from its own `stave:inlineVizResolution` setting when a zone mounts),
 *  and `setVizQuality` already writes that setting at set-time, so a chosen
 *  level's resolution persists through that channel. Re-applying resolution here
 *  would CLOBBER a user's standalone render-resolution override on every reload
 *  (it would force the default level's 512 whenever quality was never changed).
 *  Density, by contrast, lives in the in-memory vizConfig singleton that resets
 *  to default(1) per page load, so it's the only knob that needs restoring. */
export function applyPersistedVizQuality(): void {
  const { density } = deriveVizQuality(readVizQuality())
  updateVizConfig({ density })
}

// ── Off-screen inline-viz teardown (#263 / Phase B-teardown) ─────────────────
// Phase C (#259) PAUSES an off-screen inline viz but HOLDS its worker + GL
// context + ~60–110MB (PV77). When a zone stays off-screen past this threshold
// we DESTROY the renderer to reclaim that memory + a WebGL-context slot, and
// re-create it when it scrolls back (the trade = a brief reinit on return).
// Off-screen ONLY (a hidden tab stays paused-resident — user decision). A later
// worker pool will reuse a parked warm worker instead of respawn (#263 part A).
const INLINE_VIZ_TEARDOWN_MS = 60_000
// Default ON — the validated memory/cap lever (#263). OBSERVED via the
// multi-cycle A/B (high-n-headroom.spec.ts): destroying an off-screen inline viz
// after this threshold bounds renderer RSS at a PLATEAU (it does NOT leak —
// terminate settles ~2175MB over churn, LOWER than the worker pool) and frees a
// WebGL-context slot, so a long scroll-through-many session holds only ~on-screen
// viz live instead of all N (which would also hit Chrome's ~16-context cap →
// black viz). The trade is a brief reinit when a long-gone zone scrolls back;
// the opt-in worker pool (localStorage `stave.viz.pool`) smooths that at a memory
// cost. (An earlier default-OFF was a reaction to a single-cycle RSS spike that
// the multi-cycle plateau disproved.)
const DEFAULT_INLINE_VIZ_TEARDOWN_ENABLED = true
const INLINE_VIZ_TEARDOWN_STORAGE = 'stave:inlineVizTeardown'
const inlineVizTeardownListeners = new Set<(on: boolean) => void>()

function readInlineVizTeardownEnabled(): boolean {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_INLINE_VIZ_TEARDOWN_ENABLED
  const saved = ls.getItem(INLINE_VIZ_TEARDOWN_STORAGE)
  if (saved === null) return DEFAULT_INLINE_VIZ_TEARDOWN_ENABLED
  return saved === '1'
}

/** Whether off-screen inline viz are torn down (destroyed to reclaim memory)
 *  after the threshold. Default ON. */
export function getInlineVizTeardownEnabled(): boolean {
  return readInlineVizTeardownEnabled()
}

/** Enable/disable off-screen inline-viz teardown. Notifies listeners; takes
 *  effect on the next zone (re)mount / evaluate. */
export function setInlineVizTeardownEnabled(on: boolean): void {
  safeLocalStorage()?.setItem(INLINE_VIZ_TEARDOWN_STORAGE, on ? '1' : '0')
  for (const cb of Array.from(inlineVizTeardownListeners)) cb(on)
}

export function onInlineVizTeardownChange(cb: (on: boolean) => void): () => void {
  inlineVizTeardownListeners.add(cb)
  return () => { inlineVizTeardownListeners.delete(cb) }
}

// ── Left-edge track colour bar (#608) ───────────────────────────────
// The per-track colour stripe down the editor's left edge (useTrackColourBars).
// Default ON (current behaviour). OFF removes the overlay for a plainer gutter.
const DEFAULT_TRACK_COLOUR_BARS_ENABLED = true
const TRACK_COLOUR_BARS_STORAGE = 'stave:trackColourBars'
const trackColourBarsListeners = new Set<(on: boolean) => void>()

function readTrackColourBarsEnabled(): boolean {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_TRACK_COLOUR_BARS_ENABLED
  const saved = ls.getItem(TRACK_COLOUR_BARS_STORAGE)
  if (saved === null) return DEFAULT_TRACK_COLOUR_BARS_ENABLED
  return saved === '1'
}

/** Whether the left-edge per-track colour bar is painted in the code view.
 *  Default ON. */
export function getTrackColourBarsEnabled(): boolean {
  return readTrackColourBarsEnabled()
}

/** Show/hide the left-edge track colour bar. Notifies listeners so open
 *  editors add/remove the overlay live. */
export function setTrackColourBarsEnabled(on: boolean): void {
  safeLocalStorage()?.setItem(TRACK_COLOUR_BARS_STORAGE, on ? '1' : '0')
  for (const cb of Array.from(trackColourBarsListeners)) cb(on)
}

export function onTrackColourBarsChange(cb: (on: boolean) => void): () => void {
  trackColourBarsListeners.add(cb)
  return () => { trackColourBarsListeners.delete(cb) }
}

// ── Play viz on hover (#769) ─────────────────────────────────────────
// Gates the split-pane backdrop freeze policy. Default OFF → every pane's
// backdrop renders LIVE (the #768 behaviour). ON → only the focused pane renders
// live and non-focused panes freeze to their last frame UNLESS the cursor hovers
// them — an opt-in GPU saver for many-pane layouts. The GPU floor either way is
// held by `vizGovernor`; this just lets a user trade always-live for lower idle
// cost. Read live in WorkspaceShell's backdrop `paused` computation.
const DEFAULT_PLAY_VIZ_ON_HOVER = false
const PLAY_VIZ_ON_HOVER_STORAGE = 'stave:playVizOnHover'
const playVizOnHoverListeners = new Set<(on: boolean) => void>()

function readPlayVizOnHoverEnabled(): boolean {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_PLAY_VIZ_ON_HOVER
  const saved = ls.getItem(PLAY_VIZ_ON_HOVER_STORAGE)
  if (saved === null) return DEFAULT_PLAY_VIZ_ON_HOVER
  return saved === '1'
}

/** Whether non-focused split-pane backdrops freeze unless hovered. Default OFF
 *  (all panes live, #768). */
export function getPlayVizOnHoverEnabled(): boolean {
  return readPlayVizOnHoverEnabled()
}

/** Enable/disable the hover-gated backdrop freeze. Notifies listeners so the open
 *  WorkspaceShell re-evaluates every pane's `paused` state live. */
export function setPlayVizOnHoverEnabled(on: boolean): void {
  safeLocalStorage()?.setItem(PLAY_VIZ_ON_HOVER_STORAGE, on ? '1' : '0')
  for (const cb of Array.from(playVizOnHoverListeners)) cb(on)
}

export function onPlayVizOnHoverChange(cb: (on: boolean) => void): () => void {
  playVizOnHoverListeners.add(cb)
  return () => { playVizOnHoverListeners.delete(cb) }
}

// ── Backdrop viz span (#770) ─────────────────────────────────────────
// 'file'      → each split pane shows its OWN backdrop (the default / historical
//               behaviour: a per-pane backdrop bounded to that pane's box).
// 'workspace' → a SINGLE backdrop spans the whole editor area behind ALL panes
//               (the first pane with a backdrop set drives it), so a viz reads as
//               one continuous image behind every split window rather than one
//               copy per pane. Read live in WorkspaceShell's group render.
export type BackdropVizSpan = 'file' | 'workspace'
const DEFAULT_BACKDROP_VIZ_SPAN: BackdropVizSpan = 'file'
const BACKDROP_VIZ_SPAN_STORAGE = 'stave:backdropVizSpan'
const backdropVizSpanListeners = new Set<(span: BackdropVizSpan) => void>()

function readBackdropVizSpan(): BackdropVizSpan {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_BACKDROP_VIZ_SPAN
  return ls.getItem(BACKDROP_VIZ_SPAN_STORAGE) === 'workspace' ? 'workspace' : 'file'
}

/** Whether backdrops are per-pane ('file', default) or one shared viz spanning
 *  every split pane ('workspace'). */
export function getBackdropVizSpan(): BackdropVizSpan {
  return readBackdropVizSpan()
}

/** Switch the backdrop span mode. Notifies listeners so the open WorkspaceShell
 *  re-renders (per-pane backdrops ⇄ one spanning backdrop) without a remount. */
export function setBackdropVizSpan(span: BackdropVizSpan): void {
  safeLocalStorage()?.setItem(BACKDROP_VIZ_SPAN_STORAGE, span)
  for (const cb of Array.from(backdropVizSpanListeners)) cb(span)
}

export function onBackdropVizSpanChange(cb: (span: BackdropVizSpan) => void): () => void {
  backdropVizSpanListeners.add(cb)
  return () => { backdropVizSpanListeners.delete(cb) }
}

/** Effective teardown delay in ms for a newly-mounted inline zone: the threshold
 *  when enabled, 0 (= never tear down) when disabled. Read at mount. An optional
 *  `stave:inlineVizTeardownMs` localStorage override tunes the delay (advanced /
 *  test churn harnesses) — clamped to ≥1000ms; absent → the 60s default. */
export function getInlineVizTeardownMs(): number {
  if (!readInlineVizTeardownEnabled()) return 0
  try {
    const raw = safeLocalStorage()?.getItem('stave:inlineVizTeardownMs')
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 1000) return n
    }
  } catch {
    /* ignore */
  }
  return INLINE_VIZ_TEARDOWN_MS
}

// ── Live values in the "Stave Inputs" viz drawer (#346) ─────────────
// When ON, the open StaveInputsPanel paints each injected signal's LIVE master
// value (bar+number / sparkline / iTime seconds) off the already-running
// vizSignalProbe, throttled ~12fps, only while a pattern plays. Main-thread DOM
// only — orthogonal to the #299/#122 GPU jank. Default ON; OFF falls back to the
// static reference block.
const DEFAULT_VIZ_INPUTS_LIVE_VALUES = true
const VIZ_INPUTS_LIVE_VALUES_STORAGE = 'stave:vizInputsLiveValues'
const vizInputsLiveValuesListeners = new Set<(on: boolean) => void>()

function readVizInputsLiveValuesEnabled(): boolean {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_VIZ_INPUTS_LIVE_VALUES
  const saved = ls.getItem(VIZ_INPUTS_LIVE_VALUES_STORAGE)
  if (saved === null) return DEFAULT_VIZ_INPUTS_LIVE_VALUES
  return saved === '1'
}

/** Whether the open Stave Inputs drawer paints live master signal values
 *  (#346). Default ON. */
export function getVizInputsLiveValuesEnabled(): boolean {
  return readVizInputsLiveValuesEnabled()
}

/** Enable/disable live values in the Stave Inputs drawer. Notifies listeners so
 *  a mounted panel can start/stop its paint loop without a reload. */
export function setVizInputsLiveValuesEnabled(on: boolean): void {
  safeLocalStorage()?.setItem(VIZ_INPUTS_LIVE_VALUES_STORAGE, on ? '1' : '0')
  for (const cb of Array.from(vizInputsLiveValuesListeners)) cb(on)
}

export function onVizInputsLiveValuesChange(cb: (on: boolean) => void): () => void {
  vizInputsLiveValuesListeners.add(cb)
  return () => { vizInputsLiveValuesListeners.delete(cb) }
}

// ── Musical Timeline sub-row height (Phase 20-12 wave-δ) ────────────
// Sub-row band height (px) when an expanded track has multiple leaves.
// Default = 25; range 12-48 covers compact-density to "I want to read
// pitch contours" comfortable. No CSS variable — the consumer is React
// (layoutTrackRows + MusicalTimeline), not CSS.
const DEFAULT_MUSICAL_TIMELINE_SUB_ROW_HEIGHT = 25
/** The setting's range, px. Exported for a caller that solves for a height
 *  (the Song timeline's row-edge drag, #1750) and must search inside it. */
export const MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MIN = 12
export const MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MAX = 48
const MUSICAL_TIMELINE_SUB_ROW_HEIGHT_STORAGE = 'stave:musicalTimeline.subRowHeight'
const musicalTimelineSubRowHeightListeners = new Set<(h: number) => void>()

function readMusicalTimelineSubRowHeight(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_MUSICAL_TIMELINE_SUB_ROW_HEIGHT
  const saved = Number(ls.getItem(MUSICAL_TIMELINE_SUB_ROW_HEIGHT_STORAGE))
  return Number.isFinite(saved) &&
    saved >= MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MIN &&
    saved <= MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MAX
    ? saved
    : DEFAULT_MUSICAL_TIMELINE_SUB_ROW_HEIGHT
}

function writeMusicalTimelineSubRowHeight(h: number): void {
  safeLocalStorage()?.setItem(MUSICAL_TIMELINE_SUB_ROW_HEIGHT_STORAGE, String(h))
}

export function getMusicalTimelineSubRowHeight(): number {
  return readMusicalTimelineSubRowHeight()
}

export function setMusicalTimelineSubRowHeight(h: number): void {
  const clamped = Math.max(
    MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MIN,
    Math.min(MUSICAL_TIMELINE_SUB_ROW_HEIGHT_MAX, Math.round(h)),
  )
  writeMusicalTimelineSubRowHeight(clamped)
  for (const cb of Array.from(musicalTimelineSubRowHeightListeners)) cb(clamped)
}

export function onMusicalTimelineSubRowHeightChange(
  cb: (h: number) => void,
): () => void {
  musicalTimelineSubRowHeightListeners.add(cb)
  return () => { musicalTimelineSubRowHeightListeners.delete(cb) }
}

// ── Backdrop blur (code-surface legibility over viz backdrop) #39 ───
const DEFAULT_BACKDROP_BLUR = 8
const BACKDROP_BLUR_STORAGE = 'stave:backdropBlur'
/** CSS variable read by the shell's code-panel blur rule (see
 *  globals.css). 0 disables the blur entirely; higher values push
 *  more toward frosted-glass legibility. */
export const BACKDROP_BLUR_VAR = '--stave-backdrop-blur'

function readBackdropBlur(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_BACKDROP_BLUR
  // Same null→0 guard as readBackdropOpacity: a missing key → Number(null) === 0
  // passes `>= 0` and would default blur to 0 instead of DEFAULT_BACKDROP_BLUR.
  const raw = ls.getItem(BACKDROP_BLUR_STORAGE)
  if (raw == null || raw === '') return DEFAULT_BACKDROP_BLUR
  const saved = Number(raw)
  return Number.isFinite(saved) && saved >= 0 && saved <= 40
    ? saved
    : DEFAULT_BACKDROP_BLUR
}

function writeBackdropBlur(size: number): void {
  safeLocalStorage()?.setItem(BACKDROP_BLUR_STORAGE, String(size))
}

function applyBackdropBlurVar(size: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(
    BACKDROP_BLUR_VAR,
    `${size}px`,
  )
}

export function getEditorBackdropBlur(): number {
  return readBackdropBlur()
}

export function setEditorBackdropBlur(size: number): void {
  const clamped = Math.max(0, Math.min(40, Math.round(size)))
  writeBackdropBlur(clamped)
  applyBackdropBlurVar(clamped)
}

export function applyPersistedBackdropBlur(): void {
  applyBackdropBlurVar(readBackdropBlur())
}

// ── Backdrop viz opacity — user-facing dim control ──────────────────
const DEFAULT_BACKDROP_OPACITY = 1
const BACKDROP_OPACITY_STORAGE = 'stave:backdropOpacity'
const backdropOpacityListeners = new Set<(o: number) => void>()

function readBackdropOpacity(): number {
  const ls = safeLocalStorage()
  if (!ls) return DEFAULT_BACKDROP_OPACITY
  // Guard the ABSENT case before Number() — a missing key returns null and
  // Number(null) === 0, which passes the range check below and would make the
  // backdrop default to opacity 0 (fully invisible) instead of the intended
  // DEFAULT_BACKDROP_OPACITY. A legitimately-saved "0" is still honoured.
  const raw = ls.getItem(BACKDROP_OPACITY_STORAGE)
  if (raw == null || raw === '') return DEFAULT_BACKDROP_OPACITY
  const saved = Number(raw)
  return Number.isFinite(saved) && saved >= 0 && saved <= 1
    ? saved
    : DEFAULT_BACKDROP_OPACITY
}

function writeBackdropOpacity(o: number): void {
  safeLocalStorage()?.setItem(BACKDROP_OPACITY_STORAGE, String(o))
}

export function getBackdropOpacity(): number {
  return readBackdropOpacity()
}

export function setBackdropOpacity(o: number): void {
  const clamped = Math.max(0, Math.min(1, o))
  writeBackdropOpacity(clamped)
  for (const cb of Array.from(backdropOpacityListeners)) cb(clamped)
}

export function onBackdropOpacityChange(
  cb: (o: number) => void,
): () => void {
  backdropOpacityListeners.add(cb)
  return () => { backdropOpacityListeners.delete(cb) }
}

// ── Signal aliases (custom bare-name → sound(s) map) Phase 21 ───────
// The ONLY JSON/object-valued setting. Persisted ENGINE-KEYED so one alias
// NAME can carry per-engine sound lists (`kick → { strudel:['bd'],
// sonicpi:['drum_heavy_kick'] }`) — the engine dimension is absorbed HERE
// (storage) and in the aliasMap resolver, NOT in the bus, which stays pure and
// only ever sees a flat `name → value` map for one engine (PV12). See
// aliasMap.ts for why a sound's identity is a string in every engine.
//
// Two SHAPE GUARDS on read: (1) a corrupt/non-JSON value MUST NOT throw, and
// (2) a malformed entry MUST NOT leak — the flattened map is pushed straight
// into the SignalBus/renderers, which would crash bare-name resolution at draw
// time on a bad value. A LEGACY FLAT stored map (`{ kick:'bd' }`, the pre-
// engine-keyed shape) is migrated on read to `{ kick:{ strudel:'bd' } }` so no
// destructive localStorage migration is ever needed.

/** The flat per-engine view the bus consumes and the settings UI edits. */
export type SignalAliasMap = Record<string, string | string[]>
const DEFAULT_STORED_ALIASES: StoredSignalAliases = {}
const SIGNAL_ALIASES_STORAGE = 'stave:signalAliases'
// Listeners receive the FLAT view for the engine that was set (the active
// engine on a UI edit) — the shape a live-remount consumer wants. The raw
// engine-keyed map is available via getStoredSignalAliases().
const signalAliasesListeners = new Set<(map: SignalAliasMap) => void>()

/** True iff `v` is a non-empty string. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** Sanitize one alias value → a non-empty string or a non-empty array of
 *  non-empty strings, else null (the caller drops null). */
function sanitizeAliasValue(v: unknown): string | string[] | null {
  if (isNonEmptyString(v)) return v
  if (Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString)) {
    return v as string[]
  }
  return null
}

/** Validate + MIGRATE a parsed alias map to the engine-keyed shape. Accepts
 *  either the LEGACY FLAT shape (`{ kick:'bd' }` → `{ kick:{ strudel:'bd' } }`)
 *  or the ENGINE-KEYED shape (kept, each slot sanitized). Engine keys are NOT
 *  allow-listed — any key with a valid value is kept, so a future engine
 *  survives a round-trip through an older build. Everything malformed is
 *  silently dropped. Returns a fresh object (never mutates input). */
function sanitizeStoredSignalAliases(raw: unknown): StoredSignalAliases {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: StoredSignalAliases = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) continue
    // Legacy flat value (string | string[]) → wrap under the default engine.
    const legacy = sanitizeAliasValue(value)
    if (legacy != null) {
      out[key] = { [DEFAULT_VIZ_ENGINE]: legacy }
      continue
    }
    // Engine-keyed object → sanitize each engine slot.
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const slot: EngineAliasMap = {}
      for (const [eng, ev] of Object.entries(value as Record<string, unknown>)) {
        if (!isNonEmptyString(eng)) continue
        const sv = sanitizeAliasValue(ev)
        if (sv != null) slot[eng as VizEngine] = sv
      }
      if (Object.keys(slot).length > 0) out[key] = slot
    }
    // anything else (number, null, empty) is silently dropped.
  }
  return out
}

function readStoredSignalAliases(): StoredSignalAliases {
  const ls = safeLocalStorage()
  if (!ls) return { ...DEFAULT_STORED_ALIASES }
  try {
    const saved = ls.getItem(SIGNAL_ALIASES_STORAGE)
    if (saved == null) return { ...DEFAULT_STORED_ALIASES }
    return sanitizeStoredSignalAliases(JSON.parse(saved))
  } catch {
    // Corrupt / non-JSON value — never let it propagate.
    return { ...DEFAULT_STORED_ALIASES }
  }
}

function writeStoredSignalAliases(map: StoredSignalAliases): void {
  try {
    safeLocalStorage()?.setItem(SIGNAL_ALIASES_STORAGE, JSON.stringify(map))
  } catch {
    /* quota / serialization failure — non-fatal, in-memory listeners still fire */
  }
}

/** Flatten the stored engine-keyed map to the per-engine `name → value` view. */
function flattenForEngine(
  stored: StoredSignalAliases,
  engine: VizEngine,
): SignalAliasMap {
  const out: SignalAliasMap = {}
  for (const [name, slot] of Object.entries(stored)) {
    const v = slot[engine]
    if (v != null) out[name] = v
  }
  return out
}

/** The raw engine-keyed custom-alias map (sanitized + migrated). Source of
 *  truth for the renderer's `resolveAliasesForEngine` and any future
 *  multi-engine settings UI. */
export function getStoredSignalAliases(): StoredSignalAliases {
  return readStoredSignalAliases()
}

/** Custom signal aliases for ONE engine (default: the active engine, Strudel),
 *  as the flat `name → value` view the settings UI edits. Built-ins are NOT
 *  included — custom map only. */
export function getSignalAliases(
  engine: VizEngine = DEFAULT_VIZ_ENGINE,
): SignalAliasMap {
  return flattenForEngine(readStoredSignalAliases(), engine)
}

/** Replace the custom aliases for ONE engine (default: active/Strudel) from the
 *  flat `name → value` view, persist, and notify. Surviving names KEEP their
 *  other engines' slots (editing the Strudel column never wipes a Sonic Pi one);
 *  names absent from `map` are removed. The values are sanitized so a bad caller
 *  can't poison storage. */
export function setSignalAliases(
  map: SignalAliasMap,
  engine: VizEngine = DEFAULT_VIZ_ENGINE,
): void {
  const prev = readStoredSignalAliases()
  const next: StoredSignalAliases = {}
  for (const [name, value] of Object.entries(map)) {
    if (!isNonEmptyString(name)) continue
    const sv = sanitizeAliasValue(value)
    if (sv == null) continue
    next[name] = { ...(prev[name] ?? {}), [engine]: sv }
  }
  writeStoredSignalAliases(next)
  const flat = flattenForEngine(next, engine)
  for (const cb of Array.from(signalAliasesListeners)) cb(flat)
}

/** Subscribe to alias-map changes (fires on every setSignalAliases). The
 *  callback receives the FLAT view for the engine that was set. Returns an
 *  unsubscribe. */
export function onSignalAliasesChange(
  cb: (map: SignalAliasMap) => void,
): () => void {
  signalAliasesListeners.add(cb)
  return () => { signalAliasesListeners.delete(cb) }
}

// ── Backdrop quality ladder (Full / Half / Quarter) #41 ─────────────
export type BackdropQuality = 'full' | 'half' | 'quarter'
const DEFAULT_BACKDROP_QUALITY: BackdropQuality = 'half'
const BACKDROP_QUALITY_STORAGE = 'stave:backdropQuality'
const backdropQualityListeners = new Set<(q: BackdropQuality) => void>()

function readBackdropQuality(): BackdropQuality {
  const ls = safeLocalStorage()
  const v = ls?.getItem(BACKDROP_QUALITY_STORAGE)
  return v === 'full' || v === 'half' || v === 'quarter'
    ? v
    : DEFAULT_BACKDROP_QUALITY
}

function writeBackdropQuality(q: BackdropQuality): void {
  safeLocalStorage()?.setItem(BACKDROP_QUALITY_STORAGE, q)
}

export function getBackdropQuality(): BackdropQuality {
  return readBackdropQuality()
}

export function setBackdropQuality(q: BackdropQuality): void {
  writeBackdropQuality(q)
  for (const cb of Array.from(backdropQualityListeners)) cb(q)
}

export function onBackdropQualityChange(
  cb: (q: BackdropQuality) => void,
): () => void {
  backdropQualityListeners.add(cb)
  return () => { backdropQualityListeners.delete(cb) }
}

/** Resolution factor applied to the backdrop — render at factor×
 *  viewport size, CSS-stretch to fill. Lower = cheaper GPU. */
export function backdropQualityFactor(q: BackdropQuality): number {
  return q === 'full' ? 1 : q === 'quarter' ? 0.25 : 0.5
}

/** Called by EditorView on mount to seed the editor with saved options. */
export function applyPersistedEditorOptions(editor: MonacoEditor): void {
  applyOptionsToEditor(editor)
}

// ── Theme ──────────────────────────────────────────────────────────

export type EditorTheme = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
const THEME_STORAGE = 'stave:editorTheme'

function readTheme(): EditorTheme {
  const ls = safeLocalStorage()
  const v = ls?.getItem(THEME_STORAGE)
  return v === 'light' || v === 'system' ? v : v === 'dark' ? 'dark' : 'dark'
}

function writeTheme(t: EditorTheme): void {
  safeLocalStorage()?.setItem(THEME_STORAGE, t)
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

function resolveTheme(t: EditorTheme): ResolvedTheme {
  if (t === 'dark' || t === 'light') return t
  return systemPrefersLight() ? 'light' : 'dark'
}

type ThemeListener = (t: ResolvedTheme) => void
const themeListeners = new Set<ThemeListener>()
let systemMqlWired = false
let systemMql: MediaQueryList | null = null

function notifyThemeListeners(resolved: ResolvedTheme): void {
  for (const fn of themeListeners) {
    try { fn(resolved) } catch { /* swallow */ }
  }
}

function wireSystemMqlOnce(): void {
  if (systemMqlWired || typeof window === 'undefined' || !window.matchMedia) return
  systemMqlWired = true
  systemMql = window.matchMedia('(prefers-color-scheme: light)')
  const onChange = (): void => {
    if (readTheme() !== 'system') return
    applyResolvedTheme(resolveTheme('system'))
  }
  try {
    systemMql.addEventListener('change', onChange)
  } catch {
    // Safari < 14 fallback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(systemMql as any).addListener?.(onChange)
  }
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (monacoNs?.editor?.setTheme) {
    monacoNs.editor.setTheme(resolved === 'light' ? 'stave-light' : 'stave-dark')
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-stave-theme', resolved)
  }
  notifyThemeListeners(resolved)
}

export function getEditorTheme(): EditorTheme { return readTheme() }

export function getResolvedTheme(): ResolvedTheme { return resolveTheme(readTheme()) }

export function setEditorTheme(theme: EditorTheme): void {
  writeTheme(theme)
  wireSystemMqlOnce()
  applyResolvedTheme(resolveTheme(theme))
}

/** Cycle dark → light → system → dark. Used by the menu command. */
export function cycleEditorTheme(): EditorTheme {
  const next: EditorTheme = readTheme() === 'dark' ? 'light' : readTheme() === 'light' ? 'system' : 'dark'
  setEditorTheme(next)
  return next
}

/** Subscribe to resolved theme changes. Fires when mode changes or when
 * 'system' preference flips. Returns an unsubscribe. */
export function onThemeChange(fn: ThemeListener): () => void {
  themeListeners.add(fn)
  return () => { themeListeners.delete(fn) }
}

/** Seed DOM + monaco with the persisted theme. Call after mounting. */
export function applyPersistedTheme(): void {
  wireSystemMqlOnce()
  setEditorTheme(readTheme())
}

// ── Performance overlay toggle (issue #228) ─────────────────────────
// Persists whether the perf profiler + overlay are active, and keeps the
// profiler singleton in sync (the profiler holds the live `enabled` flag the
// hot-path branches on; this is just the persisted preference + a notifier).
// `globalThis.__STAVE_PERF__ === true` (set before load, e.g. e2e) forces it on
// regardless of the stored value.
const PERF_ENABLED_STORAGE = 'stave:perfEnabled'
const perfEnabledListeners = new Set<(on: boolean) => void>()

function readPerfEnabled(): boolean {
  try {
    if ((globalThis as { __STAVE_PERF__?: boolean }).__STAVE_PERF__ === true) {
      return true
    }
  } catch {
    /* locked global — ignore */
  }
  return safeLocalStorage()?.getItem(PERF_ENABLED_STORAGE) === '1'
}

/** Whether the perf overlay/profiler is enabled (persisted preference, or the
 *  `__STAVE_PERF__` global force-on). */
export function getPerfEnabled(): boolean {
  return readPerfEnabled()
}

/** Enable/disable the perf profiler + overlay. Persists, flips the profiler
 *  singleton's live flag, and notifies listeners (the overlay subscribes). */
export function setPerfEnabled(on: boolean): void {
  try {
    safeLocalStorage()?.setItem(PERF_ENABLED_STORAGE, on ? '1' : '0')
  } catch {
    /* quota — non-fatal */
  }
  perf.setEnabled(on)
  for (const cb of Array.from(perfEnabledListeners)) cb(on)
}

/** Toggle the perf overlay; returns the new state. */
export function togglePerfEnabled(): boolean {
  const next = !readPerfEnabled()
  setPerfEnabled(next)
  return next
}

/** Subscribe to perf-enabled changes (fires on set/toggle). Returns an
 *  unsubscribe. */
export function onPerfEnabledChange(cb: (on: boolean) => void): () => void {
  perfEnabledListeners.add(cb)
  return () => { perfEnabledListeners.delete(cb) }
}

/** Apply the persisted perf-enabled preference to the profiler. Call once at
 *  app start so a reload restores an enabled overlay. */
export function applyPersistedPerfEnabled(): void {
  perf.setEnabled(readPerfEnabled())
}

// ── Adaptive performance toggle (the GPU-budget governor, P122/PV91) ─────────
// "Adaptive performance" = the global viz governor that throttles + round-robins
// + drops render resolution of worker viz under sustained GPU/scroll jank, and is
// a total no-op when frames are smooth. ON by default. Persisted under the SAME
// `stave.viz.governor` key the governor reads at construction (single source of
// truth — only the explicit string '0' disables, so a fresh user gets it on).
const ADAPTIVE_PERF_STORAGE = 'stave.viz.governor'
const adaptivePerfListeners = new Set<(on: boolean) => void>()

function readAdaptivePerf(): boolean {
  // Default ON: anything but the explicit '0' (incl. absent) = enabled. Mirrors
  // vizGovernor's own constructor read so the two never disagree.
  return safeLocalStorage()?.getItem(ADAPTIVE_PERF_STORAGE) !== '0'
}

/** Whether adaptive performance (the viz governor) is enabled (persisted; ON by default). */
export function getAdaptivePerfEnabled(): boolean {
  return readAdaptivePerf()
}

/** Enable/disable adaptive performance. Persists, flips the governor's live gate
 *  (disabling releases the levers immediately — full resolution, no throttle),
 *  and notifies listeners. */
export function setAdaptivePerfEnabled(on: boolean): void {
  try {
    safeLocalStorage()?.setItem(ADAPTIVE_PERF_STORAGE, on ? '1' : '0')
  } catch {
    /* quota — non-fatal */
  }
  vizGovernor.setEnabled(on)
  for (const cb of Array.from(adaptivePerfListeners)) cb(on)
}

/** Toggle adaptive performance; returns the new state. */
export function toggleAdaptivePerfEnabled(): boolean {
  const next = !readAdaptivePerf()
  setAdaptivePerfEnabled(next)
  return next
}

/** Subscribe to adaptive-performance changes (fires on set/toggle). */
export function onAdaptivePerfChange(cb: (on: boolean) => void): () => void {
  adaptivePerfListeners.add(cb)
  return () => { adaptivePerfListeners.delete(cb) }
}

/** Apply the persisted adaptive-performance preference to the governor. Call once
 *  at app start (like applyPersistedPerfEnabled) so the governor's live flag agrees
 *  with the stored preference regardless of module-load ordering. */
export function applyPersistedAdaptivePerf(): void {
  vizGovernor.setEnabled(readAdaptivePerf())
}
