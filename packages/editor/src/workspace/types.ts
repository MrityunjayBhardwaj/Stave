/**
 * Phase 10.2 — Workspace type vocabulary.
 *
 * This file is the single source of truth for workspace-level types. Each
 * task in Phase 10.2 appends its own type surface here:
 *
 * - Task 01 (this task): WorkspaceFile, WorkspaceLanguage.
 * - Task 02: AudioSourceRef, AudioPayload, WorkspaceAudioBus.
 * - Task 03: EditorViewProps, PreviewViewProps.
 * - Task 04: WorkspaceTab, WorkspaceGroup, WorkspaceLayout.
 * - Task 05: LiveCodingRuntime, LiveCodingRuntimeProvider, ChromeContext.
 * - Task 06: PreviewProvider, PreviewContext.
 *
 * Keep this file type-only. No runtime code, no imports that bring in React
 * or DOM APIs. The types must be consumable from unit tests that run in a
 * plain Node environment. Type-only imports (`import type ...`) are erased
 * at compile time and are safe to add when a downstream task needs to
 * reference engine-layer types from the workspace public surface.
 *
 * @remarks
 * Task 03 adds `EditorViewProps` and `PreviewViewProps`. These DO depend
 * on React types (`ReactNode`) but the imports are type-only and erased at
 * compile time, so the "no React runtime imports" rule is preserved. The
 * concrete `PreviewProvider` interface lives in its own file
 * (`PreviewProvider.ts`) because it contains more than a type — it's a
 * behavioral contract Task 06 will key a registry on.
 */

import type { ReactNode } from 'react'
import type { GroupLayout } from './groupLayout'
import type {
  AudioComponent,
  EngineComponents,
  InlineVizComponent,
  LiveCodingEngine,
  QueryableComponent,
  StreamingComponent,
} from '../engine/LiveCodingEngine'
import type { BreakpointStore } from '../engine/BreakpointStore'
import type { StrudelTheme } from '../theme/tokens'
import type { PreviewProvider } from './PreviewProvider'
import type { BackdropQuality } from './editorRegistry'

/**
 * The set of languages a WorkspaceFile may declare. This is an explicit
 * string-literal union rather than an open string so that the exhaustiveness
 * checker inside providers catches unhandled cases. New languages are added
 * here as new provider registries land (e.g., Phase 7+ may add `.tidal`).
 */
export type WorkspaceLanguage =
  | 'strudel'
  | 'sonicpi'
  | 'hydra'
  | 'p5js'
  | 'glsl'
  | 'markdown'

/**
 * A single editable file owned by the workspace. Instances are **immutable
 * snapshots**: `setContent` replaces the record in the store instead of
 * mutating the object in place. This is load-bearing for
 * `useSyncExternalStore` snapshot identity — consumers compare by reference,
 * so a new object on content change is what triggers their re-render, and
 * an unchanged reference on unrelated content changes is what prevents
 * spurious re-renders.
 *
 * @remarks
 * The `meta` bag is an escape hatch for per-file data that does not belong
 * in the store's public API (e.g., provider-specific viz preset ids in
 * Phase 10.2, cursor position in Phase 10.3). Treat it as opaque — callers
 * should namespace their keys to avoid collisions.
 */
export interface WorkspaceFile {
  readonly id: string
  readonly path: string
  readonly content: string
  readonly language: WorkspaceLanguage
  readonly meta?: Readonly<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Task 02 — WorkspaceAudioBus
// ---------------------------------------------------------------------------

/**
 * Selector that a preview consumer hands to `WorkspaceAudioBus.subscribe`
 * to declare which publisher's payload it wants to receive. Discriminated
 * union per CONTEXT D-02 / D-04 (preview tab source dropdown).
 *
 * - `{ kind: 'default' }` — follow whichever publisher is currently
 *   most-recent. Snaps to a new publisher when one starts; falls through
 *   to the next-most-recent when the current default unpublishes.
 * - `{ kind: 'file', fileId }` — pin to a specific publisher. Fires once
 *   on subscribe with the current payload (or `null` if that publisher is
 *   not currently registered), again when that publisher (un)publishes,
 *   and never for any other publisher's events.
 * - `{ kind: 'none' }` — explicit "no audio input." Subscribers fire once
 *   on subscribe with `null` and then never again. Used by viz tabs in
 *   demo mode (P7 fallback).
 */
export type AudioSourceRef =
  | { kind: 'default' }
  | { kind: 'file'; fileId: string }
  | { kind: 'none' }

/**
 * The component bag that a `LiveCodingRuntime` publishes to the bus when its
 * pattern starts playing, and that every viz consumer subscribes to in order
 * to drive its renderer.
 *
 * The shape mirrors `Partial<EngineComponents>` from `LiveCodingEngine.ts`
 * with the slots flattened (no nested `streaming.hapStream` indirection) so
 * that consumers can destructure `{ hapStream, analyser, scheduler }` in one
 * line. The slots themselves are the SAME references the engine holds —
 * the bus owns no audio nodes (PV3, UV6: observation, not mutation).
 *
 * @remarks
 * ## Identity contract (D-01 — subscribe + re-mount)
 *
 * The bus delivers ONE callback per publisher identity change, not per
 * audio frame. Identity is determined by shallow comparison across
 * `hapStream`, `analyser`, `scheduler`, `inlineViz`, and `audio` — if a
 * runtime calls `publish(sameId, newPayload)` and every slot reference
 * matches the previous payload, subscribers do NOT re-fire. This keeps the
 * bus out of the per-frame FFT read path; consumers reach into
 * `payload.analyser` directly for that.
 *
 * ## Optionality
 *
 * Every slot is optional because not every engine populates every slot
 * (e.g., the demo engine has streaming + audio but no scheduler). Consumers
 * MUST guard each slot before use.
 */
export interface AudioPayload {
  readonly hapStream?: StreamingComponent['hapStream']
  readonly analyser?: AudioComponent['analyser']
  readonly scheduler?: QueryableComponent['scheduler']
  readonly inlineViz?: InlineVizComponent
  readonly audio?: AudioComponent
  /**
   * Full engine components in their original nested shape. Needed by
   * `addInlineViewZones` which reads `queryable.trackSchedulers`,
   * `audio.trackAnalysers`, `inlineViz.trackStreams`, etc. The flat
   * fields above are convenience accessors for simple consumers
   * (PreviewView source selector, popout bridge). Inline zones and
   * viz renderers must read from this field to get per-track data.
   */
  readonly engineComponents?: Partial<EngineComponents>
  /**
   * Phase 20-07 — per-engine breakpoint registry. The Monaco gutter UI in
   * EditorView reads this to subscribe + render glyphs; the gutter click
   * handler calls `toggleSet` to register breakpoints. Absent for engines
   * that don't support the breakpoint protocol.
   */
  readonly breakpointStore?: BreakpointStore
  /**
   * Phase 20-07 — invoked when the user clicks "Debugger: Resume" via the
   * Monaco command palette. Calls `runtime.resume()`. Absent for engines
   * without scheduler-pause support.
   */
  readonly onResume?: () => void
}

/**
 * Description of a single registered publisher, returned from
 * `WorkspaceAudioBus.listSources()`. Always read on demand (e.g., on dropdown
 * open) — never cached in React state, since it can desync between renders
 * when publishers start/stop rapidly. The bus emits `onSourcesChanged` to
 * trigger re-renders, but the source data must be fetched fresh each time.
 *
 * - `sourceId` — the file id the publisher registered under.
 * - `label` — display label (currently equals `sourceId`; future Task 05 may
 *   pass through `WorkspaceFile.path` for prettier dropdown text).
 * - `playing` — `true` while the publisher has an active payload on the bus.
 *   Phase 10.2 only ever lists currently-publishing entries, so this is
 *   always `true`. Reserved for Phase 10.3+ when "stopped but recently
 *   active" entries may also be surfaced.
 */
export interface AudioSourceListing {
  readonly sourceId: string
  readonly label: string
  readonly playing: boolean
}

/**
 * The public surface of the workspace audio bus. The bus is implemented as a
 * module-level singleton in `WorkspaceAudioBus.ts` (per CONTEXT U1, matching
 * the `VizPresetStore` precedent); this interface exists for type-driven
 * consumers and for the eventual Phase 11 multi-shell refactor that may
 * introduce a class-per-shell variant.
 */
export interface WorkspaceAudioBus {
  /**
   * Register or replace the payload for a given source id.
   *
   * Calling `publish(id, payload)` for a brand-new id appends `id` to the
   * end of the recency list (making it the new "most recent" publisher) and
   * fires every default-tracker plus every pinned subscriber on `id`.
   *
   * Calling `publish(id, payload)` for an existing id and a payload whose
   * shallow component slots match the previous payload is a **no-op** —
   * subscribers do NOT re-fire and the recency list is unchanged. This is
   * the D-01 identity guarantee that keeps the bus out of the FFT read
   * path. Calling with an existing id and DIFFERENT slot references
   * replaces the entry, leaves the recency position alone, and fires the
   * affected subscribers.
   */
  publish(sourceId: string, payload: AudioPayload): void

  /**
   * Remove the payload for a given source id. Pinned subscribers on `id`
   * fire once with `null`; default-trackers fire once with whatever
   * publisher is now most-recent (or `null` if no publishers remain).
   * Calling on an unknown id is a no-op.
   */
  unpublish(sourceId: string): void

  /**
   * Subscribe to the bus with a consumer-side selector. Returns an
   * unsubscribe function.
   *
   * **Synchronous initial fire** (krama lifecycle step 2): the callback is
   * invoked SYNC, before `subscribe` returns, with the current payload for
   * `ref` (or `null` if no publisher matches). This handles the popout
   * window race where the consumer mounts before the publisher.
   *
   * The unsubscribe function is idempotent — calling it multiple times has
   * the same effect as calling it once.
   */
  subscribe(
    ref: AudioSourceRef,
    cb: (payload: AudioPayload | null) => void,
  ): () => void

  /**
   * Synchronously read the current payload for a ref without subscribing.
   * Returns `null` for `{ kind: 'none' }` or when no publisher matches.
   * Used by consumers that want to peek at the current state without
   * setting up a subscription (e.g., for one-shot rendering).
   */
  consume(ref: AudioSourceRef): AudioPayload | null

  /**
   * List every currently-registered publisher. Always returns a fresh array.
   *
   * **MUST be read on demand** — never cached in React state. The bus emits
   * `onSourcesChanged` whenever the publisher set changes; that event is
   * the signal to re-read `listSources()`, not a snapshot to memoize. See
   * the pre-mortem in PLAN.md §10.2-02.
   */
  listSources(): AudioSourceListing[]

  /**
   * Register a callback that fires whenever the set of currently-registered
   * publishers changes (i.e., a `publish` for a new id, or an `unpublish`).
   * Re-publishing an existing id with the same shallow payload does NOT
   * trigger this. Returns an unsubscribe function.
   */
  onSourcesChanged(cb: () => void): () => void
}

// ---------------------------------------------------------------------------
// Task 03 — View abstractions (EditorView / PreviewView)
// ---------------------------------------------------------------------------

/**
 * A theme value accepted by every new workspace top-level component. Every
 * view owns its own theme application per CONTEXT PV6 — the shell does not
 * bubble the theme down through inline style inheritance because each
 * group in the shell's split layout is its own DOM root and CSS custom
 * properties do not cross React portal boundaries.
 *
 * Defaults to `'dark'` when the prop is omitted.
 */
export type WorkspaceTheme = 'dark' | 'light' | StrudelTheme

/**
 * Props accepted by `EditorView` — the Monaco-based editor for a single
 * workspace file. Task 03 ships the editor with a theme, a chrome slot for
 * Task 05 to inject runtime transport UI into, and an optional mount
 * callback so downstream tests and host components can capture the Monaco
 * editor instance.
 *
 * @remarks
 * ## What this does NOT include (yet)
 *
 * - `sourceRef` — Task 07 wires a bus subscription inside `EditorView` to
 *   drive `.viz()` inline view zones and highlighting; that subscription
 *   reads its own file's publisher via `{ kind: 'file', fileId }` (D-08)
 *   and does not need a prop, so no `sourceRef` is exposed here.
 * - Control over Monaco options (font size, minimap, etc.) — Task 03 hard
 *   codes the same option set the legacy `EditorGroup.tsx` used. Future
 *   phases can open this up if embedders need it.
 * - Task 07 added: bus subscription for inline zones + highlighting,
 *   `error` prop for diagnostics squiggles (S7).
 */
export interface EditorViewProps {
  /**
   * The workspace file id this editor binds to. The hook
   * `useWorkspaceFile(fileId)` drives the Monaco `value` prop. If the file
   * is not yet registered (`undefined`), `EditorView` renders a loading
   * placeholder — the file may be seeded after the editor mounts.
   */
  readonly fileId: string

  /**
   * Theme applied to the editor container via `applyTheme()` on mount
   * and on every theme change. Defaults to `'dark'`. PV6 — every view
   * owns its own theme application.
   */
  readonly theme?: WorkspaceTheme

  /**
   * Chrome injected ABOVE the Monaco editor, inside the same DOM root.
   * Task 05 fills this slot with per-language runtime chrome (e.g.,
   * transport bar for pattern files). Task 03 accepts whatever the host
   * passes and renders it verbatim — no wrapping, no styling beyond the
   * flex container boundary.
   */
  readonly chromeSlot?: ReactNode

  /**
   * Called after Monaco has mounted, with the editor instance and the
   * Monaco module reference. Downstream tasks (Task 07 — inline view
   * zones, highlighting) use this to attach behavior to the editor. The
   * `editor` and `monaco` types are intentionally `unknown` at this
   * layer — typed consumers cast at the call site.
   */
  readonly onMount?: (editor: unknown, monaco: unknown) => void

  /**
   * Current runtime evaluation error, or `null` when no error is active.
   * The parent (compat shim or shell integration) manages the runtime's
   * `onError` subscription and passes the latest error through this prop.
   * When non-null, `EditorView` calls `setEvalError(monaco, model, error)`
   * to show a squiggle marker. When cleared to `null`, it calls
   * `clearEvalErrors(monaco, model)`. S7 — diagnostics driven by prop,
   * not by direct engine subscription inside EditorView.
   */
  readonly error?: Error | null

  /**
   * Called when the user presses Ctrl+Enter (Cmd+Enter on Mac) inside the
   * Monaco editor. The parent (compat shim or shell integration) wires this
   * to `runtime.play()`. If omitted, the keybinding is not registered.
   */
  readonly onPlay?: () => void

  /**
   * Called when the user presses Ctrl+. (Cmd+. on Mac) inside the Monaco
   * editor. The parent wires this to `runtime.stop()`. If omitted, the
   * keybinding is not registered.
   */
  readonly onStop?: () => void

  /** Called when the user clicks the "edit" icon on an inline viz zone.
   *  Receives the viz name (e.g., "Piano Roll"). The host should navigate
   *  to the corresponding viz file. */
  readonly onEditViz?: (vizId: string) => void

  /** Called when the user clicks the "crop" icon on an inline viz zone.
   *  Receives the viz name, preset id, and `trackKey` — the per-$:-block
   *  identifier (same key used for trackSchedulers / trackAnalysers /
   *  vizRequests). Required so the host can save the crop as a per-instance
   *  override rather than overwriting the shared VizPreset. */
  readonly onCropViz?: (vizId: string, presetId: string | null, trackKey: string) => void
}

/**
 * Props accepted by `PreviewView` — the host for a `PreviewProvider`'s
 * rendered output. Task 03 ships the view as a controlled component: the
 * shell (Task 04) owns the `sourceRef` state and passes it down plus an
 * `onSourceRefChange` callback so the built-in source selector chrome can
 * drive tab-level state updates.
 *
 * @remarks
 * ## What this does NOT include (yet)
 *
 * - A provider registry lookup — Task 06 adds that. Task 03 accepts the
 *   `provider` directly as a prop so the view can be tested in isolation.
 * - A `theme` broadcaster that writes to the popout window — the popout
 *   integration lives inside `usePopoutPreview` (Task 07's scope).
 * - Error reporting for provider render failures — Task 06 adds an error
 *   boundary around `provider.render` when the concrete providers land.
 *   Task 03 trusts the provider to not throw.
 */
export interface PreviewViewProps {
  /**
   * The workspace file id being previewed. The view subscribes to the
   * file via `useWorkspaceFile(fileId)` so provider reloads see fresh
   * content on every content change.
   */
  readonly fileId: string

  /**
   * The provider that knows how to render this file type. Task 06 will
   * move provider selection inside a registry lookup keyed on
   * `file.language`; Task 03 accepts the provider directly for isolated
   * testing. Changing the provider prop mid-life of the view triggers a
   * fresh render; the view does not dispose the old provider (providers
   * are stateless value objects).
   */
  readonly provider: PreviewProvider

  /**
   * Which publisher the view subscribes to on the bus. Owned by the
   * shell (Task 04); this view is controlled. `'default'` follows
   * most-recent, `{ kind: 'file' }` pins, `'none'` forces demo mode.
   */
  readonly sourceRef: AudioSourceRef

  /**
   * Called when the user picks a different source from the built-in
   * selector chrome. The view does NOT hold its own `sourceRef` state —
   * it dispatches to this callback and waits for the controlled prop to
   * update. The shell (Task 04) wires this callback to its tab state.
   */
  readonly onSourceRefChange: (ref: AudioSourceRef) => void

  /**
   * Theme applied to the view container via `applyTheme()` on mount and
   * on every theme change. Defaults to `'dark'`. PV6 — every view owns
   * its own theme application.
   */
  readonly theme?: WorkspaceTheme

  /**
   * `true` when the tab is currently hidden (another tab is active in
   * this group, or the preview is background-layered under an editor).
   * The view checks `provider.keepRunningWhenHidden` to decide whether
   * to pause — if `false`, the view freezes its reload debounce AND
   * passes `hidden: true` to the provider's render context. On un-hide,
   * the view triggers one catch-up reload to pick up any content changes
   * that arrived while hidden.
   */
  readonly hidden?: boolean

  /**
   * User-initiated pause state. When `true`, the view threads
   * `paused: true` into the provider render context so compiled
   * viz mounts can call `renderer.pause()` (p5.noLoop / hydra
   * stop) and freeze the canvas. Unlike `hidden`, this is an
   * explicit user action via the chrome's Stop button — the tab
   * stays visible but the animation loop halts. Click Play to
   * resume.
   */
  readonly paused?: boolean
}

// ---------------------------------------------------------------------------
// Task 04 — WorkspaceShell (tab / group / split container)
// ---------------------------------------------------------------------------

/**
 * A single tab inside the workspace shell. Tabs are the user-visible units
 * the shell renders; the shell dispatches rendering by `kind`:
 *
 *   - `kind: 'editor'` → `EditorView` bound to `fileId`.
 *   - `kind: 'preview'` → `PreviewView` bound to `fileId` with the tab's
 *     `sourceRef` pinned as a tab-level field (so the source dropdown
 *     inside `PreviewView` drives state up to the shell, which persists
 *     it per tab — two viz preview tabs of the same file can be pinned to
 *     different publishers).
 *
 * Each tab carries its own `id` separate from `fileId` because multiple
 * tabs can reference the same file (e.g., an editor tab AND a preview tab
 * for the same `pianoroll.hydra`, or two preview tabs pinned to different
 * sources). The shell uses `id` as the reconciliation key and drag-drop
 * identifier; `fileId` routes to the underlying file store.
 *
 * ## PV7 — no rendering-mode field on the tab
 *
 * The legacy `EditorGroup.tsx` carried a single state field that enumerated
 * four rendering modes (panel / inline / background / popout) and
 * entangled editor and preview concerns. The whole point of Phase 10.2 is
 * to dissolve that entanglement — a preview tab is a first-class tab,
 * dispatched by `kind`, not a rendering mode on top of an editor. Any
 * future "background decoration" support is shaped as a file id on
 * `WorkspaceGroupState.backgroundFileId` (promote-to-backdrop flow),
 * NOT as a mode on the tab itself.
 */
export type WorkspaceTab =
  | {
      readonly kind: 'editor'
      readonly id: string
      readonly fileId: string
      /**
       * Preview tabs render in italic and are replaced when another file
       * is opened in preview mode. Promoted to pinned (preview=false) on
       * double-click or on first edit. Matches VSCode's preview-tab UX.
       */
      readonly preview?: boolean
    }
  | {
      readonly kind: 'preview'
      readonly id: string
      readonly fileId: string
      readonly sourceRef: AudioSourceRef
    }
  | {
      /**
       * A read-only history viewer hosted in the main editor area — the
       * project commit store's Diff / time-travel View, moved out of the
       * cramped Version History side panel (#210). Carries everything the
       * HistoryDiffOverlay / HistoryViewOverlay components need to render.
       *
       * Reuses the preview-tab mechanism: opened as a single italic
       * `preview` slot that the next Diff/View replaces, promoted to a
       * pinned tab on double-click (same UX as opening a file in preview).
       * Never persisted — `tabPersistence` keeps only `editor` tabs, and a
       * commit can be pruned between sessions, so a stale history tab would
       * be a ghost.
       */
      readonly kind: 'history'
      readonly id: string
      /** The file the viewer is focused on (drives the tab label + initial selection). */
      readonly fileId: string
      readonly mode: 'diff' | 'view'
      /** The commit being diffed / viewed. */
      readonly commitId: string
      /**
       * Diff mode only (#211): open the diff in "vs current" (commit ↔ live
       * working tree) by default, for the "Uncommitted Changes" section's
       * live ↔ HEAD diff. With `commitId` = HEAD, the original side is the
       * file's HEAD content and the modified side is its live content.
       */
      readonly vsCurrent?: boolean
      /**
       * Diff mode only (#211): scope the file picker to these ids instead of
       * the commit's own changeset — so an uncommitted file that HEAD didn't
       * touch is still selectable (the dirty-set snapshot at open time).
       */
      readonly pickerFileIds?: readonly string[]
      /** Preview slot (italic, replaced by the next open). Promoted on double-click. */
      readonly preview?: boolean
    }

/**
 * A single tab group inside the shell. Groups are the unit the `SplitPane`
 * layout operates on — N groups render as N panes, each with its own tab
 * bar and active-tab content area.
 *
 * - `id` — stable group identifier; used as drag-drop target id and as the
 *   React reconciliation key.
 * - `tabs` — the ordered list of tabs hosted by this group. Order is
 *   preserved across drag-drop moves and splits. Empty groups are legal
 *   (the last tab was closed but the group remains) and render an empty
 *   state prompting the user to drop a tab.
 * - `activeTabId` — which tab is visible inside this group. `null` when
 *   the group is empty. Closing the active tab selects the next adjacent
 *   tab (previous if one exists, else first).
 * - `backgroundFileId` — id of the viz file pinned as this group's
 *   backdrop (promote-to-backdrop / `Cmd+K B`). Independent of
 *   `activeTabId` — the backdrop survives tab switches; the active
 *   editor renders on top. Absent when no backdrop is set. Field is
 *   the FILE id (not a tab id) so a single source of truth survives
 *   tab churn — tabs come and go, but the promoted file reference is
 *   durable.
 */
export interface WorkspaceGroupState {
  readonly id: string
  readonly tabs: readonly WorkspaceTab[]
  readonly activeTabId: string | null
  readonly backgroundFileId?: string
  /**
   * Per-pane backdrop opacity override (#350c). When set, this group's
   * backdrop renders at this opacity instead of the global
   * `getBackdropOpacity()` default. Absent → the global default applies.
   * Persisted user intent (survives reload), unlike the transient code
   * override — so it lives on the group snapshot.
   */
  readonly backdropOpacity?: number
  /**
   * Per-pane backdrop quality override (#350c). When set, this group's
   * backdrop renders at this quality tier instead of the global
   * `getBackdropQuality()` default. Absent → the global default applies.
   */
  readonly backdropQuality?: BackdropQuality
}

// ---------------------------------------------------------------------------
// Task 05 — LiveCodingRuntime + LiveCodingRuntimeProvider + ChromeContext
// ---------------------------------------------------------------------------

/**
 * Per-file runtime that wraps a `LiveCodingEngine`. Created by a
 * `LiveCodingRuntimeProvider.createEngine`-derived factory inside Task 09's
 * compat shims (and Task 10's app rewire). Owns the engine lifecycle for a
 * single workspace file id, publishes its component bag to the workspace
 * audio bus when playing, and unpublishes on stop / dispose.
 *
 * @remarks
 * ## What the runtime is, and is not
 *
 * - **Is** a strict passthrough wrapper around an engine plus the bus
 *   publish/unpublish wiring required to surface the engine's component
 *   bag to viz consumers and the EditorView (for inline view zones / S7).
 * - **Is** the elevation point for `BufferedScheduler` (S8) — when an
 *   engine ships streaming + audio without a native queryable, the
 *   runtime constructs a `BufferedScheduler` lazily on first `play()` and
 *   places it on the published payload's `scheduler` slot.
 * - **Is NOT** a place to install Pattern.prototype interception (PV2 / P2).
 *   All Strudel Pattern method wrappers are installed inside
 *   `StrudelEngine.evaluate()`'s setter trap and live nowhere else. The
 *   runtime never reads, writes, or proxies anything on `Pattern.prototype`.
 * - **Is NOT** a place to mutate `file.content` before evaluation (P1).
 *   The runtime passes the file content unchanged into `engine.evaluate`.
 *
 * ## Lifecycle (PK1 — STRICT)
 *
 * `play()` runs nine ordered steps with no React state writes interleaved
 * between `engine.evaluate()` resolving and `bus.publish()` firing:
 *
 *   1. `await engine.init()` if not already initialized.
 *   2. `await engine.evaluate(getFileContent())`.
 *   3. If `error` — fire `onError`, do not publish, do not call play.
 *   4. SYNCHRONOUSLY read `engine.components` (no awaits between here and
 *      step 7).
 *   5. Determine the queryable scheduler. Native if `components.queryable`,
 *      otherwise elevate via `BufferedScheduler` (S8).
 *   6. Build the `AudioPayload` with `hapStream`, `analyser`, `scheduler`,
 *      `inlineViz`, and the full `audio` slot.
 *   7. `workspaceAudioBus.publish(fileId, payload)` — subscribers fire SYNC.
 *   8. `engine.play()` — schedules audio.
 *   9. Fire `onPlayingChanged(true)`.
 *
 * The `publish` BEFORE `play` ordering matters: viz consumers and the
 * EditorView's inline-zone subscription must see the payload before the
 * first hap event fires. The `publish` AFTER `evaluate` ordering matters
 * even more: only after `evaluate` resolves does `engine.components`
 * contain the captured `inlineViz.vizRequests` for the current code.
 */
export interface LiveCodingRuntime {
  /** The wrapped engine. Owned by the runtime; never escapes. */
  readonly engine: LiveCodingEngine

  /** Workspace file id this runtime publishes under on the audio bus. */
  readonly fileId: string

  /**
   * Initialize the engine if it has not been initialized yet. Idempotent.
   * `play()` calls this internally; callers usually do not need to.
   */
  init(): Promise<void>

  /**
   * Evaluate the current file content, publish the engine's component bag
   * to the bus under `fileId`, then start the engine. Returns the
   * evaluation error if any (also fires `onError` listeners). On error, the
   * payload is NOT published and `engine.play()` is NOT called.
   *
   * @returns `{ error: null }` on success; `{ error: Error }` if
   *   `engine.evaluate` returned an error or the runtime caught one
   *   bridging to the bus.
   */
  play(): Promise<{ error: Error | null }>

  /**
   * Stop the engine and unpublish from the bus. Idempotent — calling
   * `stop()` twice is safe.
   */
  stop(): void

  /**
   * Dispose the runtime — calls `stop()`, releases the
   * `BufferedScheduler` if one was elevated, and disposes the underlying
   * engine. After `dispose()`, the runtime is unusable.
   */
  dispose(): void

  /**
   * Subscribe to runtime errors — fired by `play()` on evaluate failure
   * AND by the engine's runtime error handler (audio scheduling errors
   * after `play()` succeeded). Returns an idempotent unsubscribe function.
   * S7 — the EditorView subscribes to this for `setEvalError` markers,
   * the chrome subscribes for the error badge.
   */
  onError(cb: (err: Error) => void): () => void

  /**
   * Subscribe to playing-state changes. Fires SYNC after `play()` succeeds
   * with `true`, after `stop()` with `false`. Returns an idempotent
   * unsubscribe function. The chrome subscribes to drive its
   * `isPlaying`-dependent rendering without prop-drilling.
   */
  onPlayingChanged(cb: (playing: boolean) => void): () => void

  /**
   * Read the engine's current BPM, if extractable. The runtime parses
   * `setcps(...)` from the last evaluated code and converts to BPM
   * (Strudel) or returns `undefined` for engines that have no analogous
   * concept. Used by the chrome's BPM display (U8). Returns `undefined`
   * before the first successful `play()`.
   */
  getBpm(): number | undefined

  /**
   * Current cycle position from the engine's pattern scheduler, or `null`
   * when the scheduler is unavailable (engine not initialized, transport
   * stopped, non-Strudel runtime). Used by the IR Inspector timeline
   * strip's tooltip to anchor each captured snapshot to musical time.
   * The tooltip falls back to wall-clock when this returns `null`.
   *
   * Phase 19-08 (#85). Mirrors `getBpm()` shape.
   */
  getCurrentCycle(): number | null

  /**
   * Enable or disable live mode (auto-refresh). When enabled and the
   * runtime is playing, every file content change triggers a
   * debounced re-`play()` (which re-evaluates the current code) so
   * the audio stays in sync with the source as you type.
   *
   * No-op if the runtime was constructed without a `subscribeToFile`
   * function (the default in tests) — the flag is still set, but no
   * subscription is installed.
   */
  setAutoRefresh(enabled: boolean): void

  /** Current live-mode flag. */
  isAutoRefreshEnabled(): boolean

  /**
   * Subscribe to live-mode state changes. Fires after every
   * `setAutoRefresh` mutation with the new enabled value. Returns an
   * idempotent unsubscribe. Used by the chrome's live-mode toggle to
   * re-render without polling.
   */
  onAutoRefreshChanged(cb: (enabled: boolean) => void): () => void
}

/**
 * Context object handed to `LiveCodingRuntimeProvider.renderChrome` on every
 * chrome render. The chrome is a React component (the provider's
 * `renderChrome` is itself a React functional component), so it can use
 * hooks to subscribe to `runtime.onError` / `runtime.onPlayingChanged` and
 * track its own `isPlaying` / `error` state — but for callers that already
 * have those values in scope (e.g., the compat shims that wire chrome from
 * outside the provider), passing them through the context avoids a second
 * subscription.
 *
 * Per CONTEXT D-07 + U8.
 */
export interface ChromeContext {
  /** The living runtime instance. The chrome calls `runtime.play()` etc. */
  readonly runtime: LiveCodingRuntime
  /** The workspace file the runtime serves. */
  readonly file: WorkspaceFile
  /** Current playing state — sourced by the embedder. */
  readonly isPlaying: boolean
  /** Current evaluation / runtime error, if any. */
  readonly error: Error | null
  /**
   * `error` as the Console and the toast word it (#2177) — what the chrome shows.
   * Omitted by an embedder that does not word errors; the chrome then shows
   * `error.message`.
   */
  readonly errorMessage?: string
  /**
   * Beats-per-minute display value. Built-in per U8 — the runtime extracts
   * BPM from the engine where available; the chrome only renders. May be
   * `undefined` if BPM is not yet known or is not applicable.
   */
  readonly bpm?: number
  /** Play handler — usually `() => runtime.play()`. */
  onPlay(): void
  /** Stop handler — usually `() => runtime.stop()`. */
  onStop(): void
  /**
   * Optional embedder-injected extras (e.g., the export button surfaced by
   * the legacy `StrudelEditor` shim in Task 09). Rendered to the right of
   * the built-in transport controls. Per U8.
   */
  readonly chromeExtras?: ReactNode

  /**
   * Current live-mode (autoRefresh) state for this runtime. When `true`,
   * the chrome renders the live toggle button in its active style. When
   * omitted, the chrome renders the toggle in its inactive style.
   *
   * Sourced by the embedder — the app layer typically mirrors
   * `runtime.isAutoRefreshEnabled()` into React state so changes re-render
   * the chrome. Provider chromes that subscribe to
   * `runtime.onAutoRefreshChanged` directly may ignore this field.
   */
  readonly autoRefresh?: boolean

  /**
   * Toggle handler for live mode. When supplied, the chrome renders a
   * live-mode toggle button; when omitted, the button is hidden. This
   * lets embedders that don't want a live-mode button (tests, kiosk
   * displays) opt out cleanly.
   */
  readonly onToggleAutoRefresh?: () => void

  /**
   * End-behaviour state for a document that CAN end on its own (#1388,
   * inverted by #1396). `true` means the user has asked an arranged song to
   * stop at its last cycle instead of repeating.
   *
   * ⚠ DEFAULT IS `false` — LOOPING. #1388 had this the other way round and
   * #1396 flipped it: every reference DAW runs past the end of the arrangement
   * (REAPER stops, but as a preference), and a document that acquires an
   * `arrange(...)` should not silently gain the ability to stop under someone
   * mid-edit. Stopping is the specialised choice, so it is the one you ask for.
   *
   * Only meaningful alongside `onToggleStopAtEnd` — see below.
   */
  readonly stopAtEnd?: boolean

  /**
   * Toggle handler for the end behaviour. Supplied by the embedder ONLY for
   * documents that have a definite end; when omitted the button is hidden,
   * exactly like the live-mode toggle above.
   *
   * ⚠ THE OMISSION IS THE FEATURE, not an oversight. 96.7% of real documents
   * have no arrangement and loop forever no matter what, so the toggle on them
   * would be a control that visibly does nothing — and a control that does
   * nothing teaches the user that the ones that DO work might not. The button
   * appears exactly when it changes what happens. That reasoning is unchanged
   * by #1396: what a document with no end lacks is an END, which is what both
   * settings are about, so neither of them means anything there.
   */
  readonly onToggleStopAtEnd?: () => void
}

/**
 * Per-extension provider for executable file types. Owns engine creation
 * AND chrome rendering. Registered in the `liveCodingRuntimeRegistry` keyed
 * by extension. The shell never invokes a provider directly — Task 09's
 * compat shims and Task 10's app rewire instantiate runtimes from the
 * provider's `createEngine` and pass `renderChrome(ctx)` into
 * `WorkspaceShell.chromeForTab`.
 */
export interface LiveCodingRuntimeProvider {
  /** Extensions this provider claims, including the leading dot. */
  readonly extensions: readonly string[]
  /** Workspace language id this provider corresponds to. */
  readonly language: WorkspaceLanguage
  /** Factory for a fresh engine instance. The runtime owns disposal. */
  createEngine(): LiveCodingEngine
  /**
   * Render the per-tab chrome for an editor of this language. Receives
   * the live runtime + state. Returns a `ReactNode` that the host
   * (Task 09 / Task 10) injects into `EditorView.chromeSlot`.
   */
  renderChrome(ctx: ChromeContext): ReactNode
}

/**
 * Forward-compatible alias retained from Task 04. Resolves to the real
 * `LiveCodingRuntimeProvider` interface so any consumer that imported the
 * stub from the barrel keeps compiling without source changes.
 */
export type LiveCodingRuntimeProviderStub = LiveCodingRuntimeProvider

/**
 * Signature of the optional callback the shell uses to resolve per-tab
 * runtime chrome for editor-kind tabs. Task 05 will wire this through the
 * runtime provider registry so pattern-file editors receive a transport
 * bar. Task 04 accepts the callback as a prop and passes its return value
 * into `EditorView.chromeSlot`. Returning `undefined` (the default) means
 * "no chrome for this tab," which is the correct answer for viz / markdown
 * editors.
 */
export type ChromeForTab = (tab: WorkspaceTab) => ReactNode | undefined

/**
 * Props accepted by `WorkspaceShell`. The shell is uncontrolled — it
 * seeds group state from `initialTabs` on first mount and manages its own
 * layout state internally. Tab changes are broadcast via callbacks so
 * downstream host code (Task 08's command registry, Task 10's app page)
 * can observe without owning the state.
 *
 * @remarks
 * ## What the shell does NOT do (yet)
 *
 * - No `window.addEventListener('keydown', ...)` for Cmd+K V/B/W — Task
 *   08 adds that, using `onActiveTabChange` to know which tab the command
 *   should act on.
 * - No runtime provider instantiation — `runtimeProviders` is a typed
 *   slot for Task 05 / Task 07 to inject concrete providers. The shell
 *   never calls `createEngine`; it only passes the list to `chromeForTab`.
 * - No preview provider registry lookup — `previewProviders` is a slot
 *   for Task 06 to populate. Task 04 uses a single `previewProviderFor`
 *   callback to resolve the provider at render time so the shell is
 *   testable in isolation with a stub.
 * - No `Cmd+K B` background decoration rendering. The field is reserved
 *   on `WorkspaceGroupState.backgroundFileId` but Task 04 does not render
 *   anything based on it.
 */
export interface WorkspaceShellProps {
  /**
   * Seed tabs for the shell on first mount. Splits into one initial group
   * holding every seed tab; the first tab becomes the active tab. The
   * shell does not re-read this prop after mount — changes to `initialTabs`
   * on re-render are ignored. Callers that need to add tabs later use
   * commands (Task 08) or the shell's imperative handle (future).
   */
  readonly initialTabs?: readonly WorkspaceTab[]

  /**
   * Theme applied to the shell root via `applyTheme()` on mount and on
   * every theme change. Defaults to `'dark'`. PV6 / P6 — every top-level
   * component owns its own theme application.
   */
  readonly theme?: WorkspaceTheme

  /**
   * Explicit height for the shell root. Defaults to `'100%'` so the
   * shell fills whatever container the host mounts it in.
   */
  readonly height?: number | string

  /**
   * Fires whenever the active tab changes — either because the user
   * clicked a different tab inside a group, or because the user
   * switched focus between groups. Task 08 listens so Cmd+K V/B/W can
   * dispatch against the currently-active tab.
   *
   * The callback fires with `null` when no tab is active (every group
   * is empty). Fires once on mount with the initial active tab (or
   * `null`) so late subscribers see the initial state.
   */
  /**
   * Persistence-friendly initial state. When provided, takes precedence
   * over `initialTabs` and seeds the shell's groups + 2-D pane layout +
   * active group id in one shot. Like `initialTabs` it is read exactly
   * once on mount.
   *
   * Issue #175 — lets the consumer hydrate from `tabPersistence` so the
   * user's pane splits + per-group tabs survive a refresh. If absent,
   * the shell falls back to the legacy single-group seed from
   * `initialTabs`.
   */
  readonly initialGroups?: ReadonlyMap<string, WorkspaceGroupState>
  readonly initialLayout?: GroupLayout
  readonly initialActiveGroupId?: string

  /**
   * Fires reactively whenever the shell's groups / layout / activeGroupId
   * change — i.e. on tab open / close / reorder, group split / collapse,
   * active-tab change, active-group change, and `backgroundFileId`
   * transitions. The callback receives the full state snapshot in the
   * shape `tabPersistence.serializeShellState` expects, so the consumer
   * can pipe it straight through to localStorage / Yjs.
   *
   * Issue #175 — single sink for persistence. Does NOT fire on initial
   * mount (no-op write of just-hydrated state); only on subsequent
   * mutations.
   */
  readonly onGroupsChange?: (snapshot: {
    groups: ReadonlyMap<string, WorkspaceGroupState>
    layout: GroupLayout
    activeGroupId: string
  }) => void

  readonly onActiveTabChange?: (tab: WorkspaceTab | null) => void

  /**
   * Fires when the user clicks the "+" action in a group's tab bar
   * (issue #612). The host opens its own new-file flow — the shell has
   * no knowledge of file creation, it only surfaces the affordance. When
   * omitted, the "+" button is not rendered.
   */
  readonly onNewFile?: () => void

  /**
   * Fires when any group's `backgroundFileId` changes — either set
   * (pinned a file) or cleared (null). `groupId` identifies the
   * affected group. Used by the app to mirror backdrop state into
   * local React state (for the file-tree "Set ↔ Clear" label) and
   * to persist per-project. Fires once per real change; no initial-
   * state fire since an unset backdrop is the default.
   */
  readonly onBackgroundFileChange?: (
    groupId: string,
    fileId: string | null,
  ) => void

  /**
   * Fires when the ACTIVE group's RESOLVED backdrop changes (#350a) — the code
   * override (`setBackgroundOverride`) if present, else the manual sticky. This
   * is "what is currently showing behind the active editor," for UI that must
   * reflect reality (the menubar bg indicator, the popover pinned-state). Unlike
   * `onBackgroundFileChange`, it is NOT a persistence signal — code overrides are
   * transient — so consumers must mirror it into UI state WITHOUT persisting.
   * Fires once per real change (ref-guarded); no per-eval churn for steady code.
   */
  readonly onActiveBackdropChange?: (fileId: string | null) => void

  /**
   * #240 — open a viz file's preview in a pop-out browser window. The shell
   * forwards the Cmd+K W command (`workspace.openPreviewInWindow` →
   * `shell.openPopoutPreview(fileId)`) to this host callback; the app compiles
   * a descriptor + subscribes the audio bus and drives `usePopoutPreview`.
   * Optional: when the host omits it, Cmd+K W is a no-op (the command guards
   * on `shell.openPopoutPreview?.`).
   */
  readonly onOpenPopoutPreview?: (fileId: string) => void

  /**
   * Crop region applied to the pinned backdrop — 0–1 fractional
   * `{x, y, w, h}`. Absent means render the full viz rect. The
   * shell's backdrop wrapper scales/positions its inner div so
   * only the cropped sub-rect fills the viewport, preserving the
   * quality-ladder transform math. Purely presentational; app
   * owns persistence, keyed by the backdrop's viz FILE (#1435 —
   * `stave:backdropCrops:${projectId}`, beside the per-tab backdrop
   * file itself). The shell never stores it, so a crop can't outlive
   * the sketch it was cut for.
   */
  readonly backgroundCrop?: {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
  } | null

  /**
   * Fires when a tab is closed by the user. Runtime disposal hooks
   * (Task 05 / Task 07) plug in here to call `runtime.dispose()` on
   * the closed tab's pattern file. The callback receives the tab that
   * was just removed; the tab has already been dropped from the group
   * state by the time this fires.
   *
   * CONTEXT U3 — closing a pattern file's last editor tab MUST dispose
   * its runtime. Task 04 exposes the seam; Task 05 fills it in.
   */
  readonly onTabClose?: (closingTab: WorkspaceTab) => void

  /**
   * Runtime providers available to the shell. Forward-declared slot
   * type — Task 05 will replace `LiveCodingRuntimeProviderStub` with
   * the concrete `LiveCodingRuntimeProvider` interface. Task 04 accepts
   * the array and only hands it to `chromeForTab` (the shell itself
   * never instantiates engines).
   */
  readonly runtimeProviders?: readonly LiveCodingRuntimeProviderStub[]

  /**
   * Callback the shell uses to look up a preview provider for a given
   * preview tab. Task 06 will ship the registry that wires the default
   * implementation; Task 04 accepts the callback directly so tests can
   * pass a stub provider. Returning `undefined` means "no provider
   * available" — the shell renders a fallback message in the preview
   * tab's content area.
   */
  readonly previewProviderFor?: (tab: WorkspaceTab & {
    kind: 'preview'
  }) => PreviewProvider | undefined

  /**
   * Callback for resolving per-tab runtime chrome (transport bar for
   * pattern files). Task 05 fills this in with a lookup into
   * `runtimeProviders`. Task 04 calls the callback for every editor tab
   * and passes the return value into `EditorView.chromeSlot`. Returns
   * `undefined` by default — viz / markdown editors have no chrome.
   */
  readonly chromeForTab?: ChromeForTab

  /**
   * Callback for resolving per-tab editor extras (play/stop keybindings,
   * error prop). The compat shim (LiveCodingEditor) returns
   * `{ onPlay, onStop, error }` for pattern-file tabs; the shell passes
   * them through to `EditorView`. Returns `undefined` for tabs that don't
   * need extras (viz, markdown).
   */
  readonly editorExtrasForTab?: (tab: WorkspaceTab & { kind: 'editor' }) => {
    onPlay?: () => void
    onStop?: () => void
    error?: Error | null
  } | undefined

  /**
   * Host callback for "save this file" — fires when the user presses
   * Cmd+S / Ctrl+S anywhere in the shell, or clicks the Save button on
   * the preview-provider's editor chrome (viz files). The shell owns the
   * keybinding + chrome wiring; the host owns what "save" actually means
   * for a given file type (e.g., `flushToPreset` for viz files backed by
   * `VizPresetStore`).
   *
   * Fires with the currently-active editor tab. The shell does nothing
   * if the active tab is a preview tab or no tab is active.
   */
  readonly onSaveFile?: (tab: WorkspaceTab & { kind: 'editor' }) => void

  /**
   * Fires when the user right-clicks on a tab's chrome. Receives the
   * tab, viewport coords of the click, and a minimal set of handles
   * the listener can call back to close tabs or reveal them in the
   * host app's sidebar. Host apps typically render a context menu
   * positioned at (x, y) and call the handles.
   */
  readonly onTabContextMenu?: (
    tab: WorkspaceTab,
    x: number,
    y: number,
  ) => void

  /** Inline viz "edit" icon clicked — navigate to the viz file. */
  readonly onEditViz?: (vizId: string) => void

  /** Inline viz "crop" icon clicked — open crop popup. `trackKey` scopes
   *  the crop to this specific zone instance; see onCropViz above for the
   *  per-instance rationale. */
  readonly onCropViz?: (vizId: string, presetId: string | null, trackKey: string) => void

  /**
   * #773 — open the app's backdrop crop popup for the active group's backdrop.
   * Surfaced inside the viz-settings popover (crop… action). App-owned because
   * the crop UI is an app-level popup. */
  readonly onCropBackdrop?: () => void

  /**
   * #773 — reveal the active group's backdrop source viz file in the editor.
   * Surfaced inside the viz-settings popover (reveal action). */
  readonly onRevealBackdrop?: () => void
}
