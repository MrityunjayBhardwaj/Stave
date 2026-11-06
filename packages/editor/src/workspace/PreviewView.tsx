/**
 * PreviewView — Phase 10.2 Task 03.
 *
 * Hosts a `PreviewProvider`'s rendered output for a single workspace file.
 * Owns:
 *
 *   1. Theme application on its DOM root (PV6 / PK6).
 *   2. Bus subscription via `props.sourceRef`, stored as local state.
 *   3. React-key-driven re-mount of the provider output on publisher
 *      identity change (CONTEXT D-01 — subscribe + re-mount).
 *   4. Hot-reload debounce per `provider.reload` / `provider.debounceMs`
 *      (CONTEXT D-07).
 *   5. Hidden-tab pause semantics (CONTEXT D-03) — `keepRunningWhenHidden`
 *      providers keep getting renders; others freeze the debounce and
 *      see `hidden: true` in their context; un-hiding triggers one
 *      catch-up reload so content changes that arrived while hidden are
 *      not lost.
 *   6. Source selector chrome (audio source dropdown).
 *
 * Does NOT own:
 *
 *   - Provider creation or registry lookup (Task 06).
 *   - Popout window bridging (existing `usePopoutPreview` handles that).
 *   - Error boundaries around `provider.render` (Task 06 adds them when
 *     the concrete providers ship and can throw meaningfully).
 *   - Tab-level `sourceRef` state (shell owns it in Task 04; this view is
 *     controlled).
 *
 * @remarks
 * ## Why re-mount on publisher identity change (D-01)
 *
 * A viz renderer typically captures the `AnalyserNode` on mount and reads
 * from it per frame. If the publisher changes while the renderer is
 * alive, the renderer is still holding the OLD analyser node reference
 * even after we update state with the new payload. The cleanest way to
 * force a fresh `analyser` capture is to unmount-and-remount the
 * renderer. We do this with a React `key` that includes the current
 * publisher's source id (or `'none'` when null). When the id changes,
 * React tears down the subtree and mounts a fresh one — the provider's
 * `render` is called again with the new `audioSource`, and any effects
 * inside its returned tree capture the new analyser on their own mount.
 *
 * The pre-mortem in PLAN.md §10.2-03 flags this as the most likely
 * secondary failure. The test case `switching sources re-mounts the
 * provider output` guards against regressions.
 *
 * ## Reload policy dispatch (D-07)
 *
 * Three modes:
 *   - `'instant'` — every file content change increments the reload
 *     counter synchronously. No timers.
 *   - `'debounced'` — a timer is (re)started on every content change.
 *     When it fires, the reload counter increments. Rapid typing
 *     collapses into a single reload after `debounceMs` of quiescence.
 *   - `'manual'` — file content changes do nothing. The provider is on
 *     its own to re-render (e.g., by keeping internal state).
 *
 * The reload counter is used as part of the React `key` on the provider
 * output, so every increment forces a full unmount/remount. This matches
 * the publisher-identity re-mount pattern — one mechanism, two triggers.
 *
 * ## Hidden-tab pause (D-03)
 *
 * `provider.keepRunningWhenHidden === false` means "do not burn frames
 * on an invisible canvas." When `props.hidden === true` AND the provider
 * opted out of background running, we:
 *
 *   1. Pass `hidden: true` to the provider's `render` context — the
 *      provider's returned component can check this and pause its RAF
 *      loop.
 *   2. Skip the reload counter bump on content change (the debounce
 *      timer is still cleared on every change, it just never fires
 *      a visible reload).
 *   3. On un-hide, trigger ONE reload to pick up any content changes
 *      that arrived during the hidden period. The `catchUpNeededRef`
 *      tracks whether any content changes were missed.
 *
 * Providers with `keepRunningWhenHidden === true` never see `hidden:
 * true` — the host always passes `false` for them, so the provider's
 * behavior is unchanged regardless of `props.hidden`.
 *
 * ## Demo mode (P7)
 *
 * When `sourceRef.kind === 'none'` OR the bus has no matching publisher,
 * `audioSource` is `null`. PreviewView deliberately DOES NOT render a
 * "no data" placeholder — the provider is responsible for demo-mode
 * fallback content (per CONTEXT P7). PreviewView DOES show a small badge
 * in the chrome area so the user understands why the canvas looks
 * different.
 *
 * ## Source selector chrome
 *
 * Reads `workspaceAudioBus.listSources()` on EVERY open of the selector
 * (not cached in state) per CONTEXT pre-mortem #6 — stale cached
 * entries would desync from actual publishers as they start/stop. A
 * simple `<select>` element serves as the minimal chrome for Task 03;
 * Task 04 / Task 05 may dress it up further.
 */

import React, { useEffect, useRef, useState } from 'react'
import { applyTheme } from '../theme/tokens'
import { useWorkspaceFile } from './useWorkspaceFile'
import { workspaceAudioBus } from './WorkspaceAudioBus'
import { getVizLive, onVizLiveChange } from './preview/vizLiveToggle'
import type {
  AudioPayload,
  AudioSourceRef,
  PreviewViewProps,
} from './types'

/**
 * Stable string id for a payload's publisher, used as part of the React
 * `key` on the provider output. `null` when no publisher matches the ref.
 *
 * @remarks
 * The payload object itself does not carry its source id — by design,
 * per the CONTEXT D-02 comment that the sourceId is "implicit from the
 * subscribe key." We derive the id from the ref:
 *
 *   - `{ kind: 'none' }` → `'none'` (no publisher).
 *   - `{ kind: 'file', fileId }` → `fileId` if payload is non-null.
 *   - `{ kind: 'default' }` → `bus.listSources()[last].sourceId` at the
 *     moment the payload arrived. We cannot read this from the payload;
 *     we look it up via the bus state. Because the default tracker
 *     always points at the most-recent publisher, and `listSources()`
 *     returns the recency list, the last entry IS the id we want.
 *     If the list is empty, the payload must be null and we return
 *     `'none'`.
 */
function payloadKey(
  ref: AudioSourceRef,
  payload: AudioPayload | null,
): string {
  if (payload === null) return 'none'
  if (ref.kind === 'file') return `file:${ref.fileId}`
  if (ref.kind === 'default') {
    const sources = workspaceAudioBus.listSources()
    if (sources.length === 0) return 'none'
    return `default:${sources[sources.length - 1].sourceId}`
  }
  // ref.kind === 'none' — payload is null, handled above. Unreachable
  // at runtime, but TypeScript requires a branch.
  return 'none'
}

/**
 * Stable string derived from the `AudioSourceRef` ALONE, independent of
 * whether a payload has arrived yet. Used as part of the React key on
 * the provider mount so that an explicit source swap (e.g., the user
 * picks a different pattern from the chrome dropdown) always forces a
 * fresh mount, even if the new source isn't publishing yet.
 *
 * Without this, the key was computed only from `payloadKey(ref, payload)`
 * which can return the same `'none'` string for two DIFFERENT sources
 * that both happen to have null payloads — e.g., swapping from an idle
 * `{ kind: 'file', fileId: 'A' }` to an idle `{ kind: 'file', fileId: 'B' }`
 * wouldn't remount. Task 2 of the editor-fixes branch needs source
 * swaps to always re-run a sketch's `setup()` so that injected globals
 * like `stave.analyser` / `stave.scheduler` (coming in Task 3) stay
 * consistent with the source bound at mount time — no stale caches,
 * no mutable-bag footguns.
 */
function sourceRefKey(ref: AudioSourceRef): string {
  if (ref.kind === 'file') return `ref:file:${ref.fileId}`
  if (ref.kind === 'none') return 'ref:none'
  return 'ref:default'
}

export function PreviewView({
  fileId,
  provider,
  sourceRef,
  onSourceRefChange,
  theme = 'dark',
  hidden = false,
  paused = false,
  backdrop = false,
  backdropOwner,
}: PreviewViewProps): React.ReactElement {
  const { file } = useWorkspaceFile(fileId)
  const containerRef = useRef<HTMLDivElement>(null)

  // Audio payload state — updated by bus subscription.
  const [audioPayload, setAudioPayload] = useState<AudioPayload | null>(null)

  // Reload counter — incremented on every debounce-resolved reload. Used
  // as part of the React key on the provider output so each increment
  // forces a fresh mount. Separate from the publisher-identity key so
  // the two triggers compose cleanly.
  const [reloadTick, setReloadTick] = useState(0)

  // Source selector toggle — the dropdown options are read from
  // `bus.listSources()` on every open to avoid stale caches per the
  // pre-mortem guidance. We also subscribe to `onSourcesChanged` so the
  // closed selector label re-renders when publishers start/stop.
  const [, forceSourcesRerender] = useState(0)

  // Whether we owe a catch-up reload next time we become visible. Set to
  // `true` whenever file content changes while hidden + effectively-paused.
  const catchUpNeededRef = useRef(false)

  // Per-file hot-reload toggle. When off, skip the reload dispatch so
  // the compiled preview freezes on its last state while the user keeps
  // editing. Subscribe so flipping the chrome's button takes effect
  // without remounting.
  const [liveOn, setLiveOn] = useState<boolean>(() => getVizLive(fileId))
  useEffect(() => {
    setLiveOn(getVizLive(fileId))
    return onVizLiveChange(fileId, setLiveOn)
  }, [fileId])

  // Theme application — PV6 / PK6. Effect, not render.
  useEffect(() => {
    if (!containerRef.current) return
    applyTheme(containerRef.current, theme)
  }, [theme])

  // Bus subscription. Re-keyed on `sourceRef` identity so a source switch
  // unsubscribes the old ref and subscribes the new one. The callback is
  // invoked synchronously once on subscribe with the current payload
  // (or null) — see `WorkspaceAudioBus.subscribe` contract.
  useEffect(() => {
    const unsubscribe = workspaceAudioBus.subscribe(sourceRef, (payload) => {
      setAudioPayload(payload)
    })
    return unsubscribe
  }, [sourceRef])

  // Source-selector refresh trigger. Fires whenever the SET of publishers
  // changes — not per-frame. Used to re-render the selector label when
  // the closed dropdown is showing an id that just appeared/disappeared.
  useEffect(() => {
    const unsubscribe = workspaceAudioBus.onSourcesChanged(() => {
      forceSourcesRerender((n) => n + 1)
    })
    return unsubscribe
  }, [])

  // Whether the provider is effectively paused by the hidden flag.
  // Always false for `keepRunningWhenHidden: true` providers.
  const effectivelyHidden = hidden && !provider.keepRunningWhenHidden

  // Reload dispatch — keyed on file content. Observes the provider's
  // reload policy. `instant` bumps the counter on every change; `debounced`
  // starts a timer and bumps on fire; `manual` never bumps. Hidden +
  // paused providers never bump either mode (the catch-up flag records
  // the missed change).
  useEffect(() => {
    if (!file) return
    if (provider.reload === 'manual') return
    // User-facing hot-reload toggle: treat as 'manual' while off so the
    // compiled preview freezes on its last state across content edits.
    if (!liveOn) {
      catchUpNeededRef.current = true
      return
    }

    if (effectivelyHidden) {
      catchUpNeededRef.current = true
      return
    }

    if (provider.reload === 'instant') {
      setReloadTick((n) => n + 1)
      return
    }

    // Debounced case. `reload === 'debounced'` — `debounceMs` is required
    // for this mode but defensive default of 0 keeps the type-level code
    // honest if a provider omits the field by accident (the PreviewProvider
    // interface marks it optional only because `'instant'`/`'manual'`
    // providers may omit it).
    const ms = provider.debounceMs ?? 0
    const handle = setTimeout(() => {
      setReloadTick((n) => n + 1)
    }, ms)
    return () => {
      clearTimeout(handle)
    }
  }, [
    file?.content,
    provider.reload,
    provider.debounceMs,
    effectivelyHidden,
    liveOn,
    file,
  ])

  // Catch-up reload on un-hide. When `effectivelyHidden` flips from true
  // to false AND a content change was missed, trigger exactly ONE reload
  // so the provider sees the latest content.
  const prevEffectivelyHiddenRef = useRef(effectivelyHidden)
  useEffect(() => {
    const wasHidden = prevEffectivelyHiddenRef.current
    prevEffectivelyHiddenRef.current = effectivelyHidden
    if (wasHidden && !effectivelyHidden && catchUpNeededRef.current) {
      catchUpNeededRef.current = false
      setReloadTick((n) => n + 1)
    }
  }, [effectivelyHidden])

  // Catch-up on live-toggle flip off → on. Same mechanic as un-hide:
  // the user edited while frozen, flipping the toggle resumes live
  // updates AND pulls in any missed edits via a single reload bump.
  const prevLiveOnRef = useRef(liveOn)
  useEffect(() => {
    const wasOff = !prevLiveOnRef.current
    prevLiveOnRef.current = liveOn
    if (wasOff && liveOn && catchUpNeededRef.current) {
      catchUpNeededRef.current = false
      setReloadTick((n) => n + 1)
    }
  }, [liveOn])

  // Provider render. The loading placeholder mirrors `EditorView` for
  // consistency. Once the file exists, we hand the provider a fresh
  // ctx and let it return its tree. The two re-mount triggers (payload
  // identity + reload counter) are composed into the React `key`.
  const providerNode = React.useMemo(() => {
    if (!file) return null
    return provider.render({
      file,
      audioSource: audioPayload,
      hidden: effectivelyHidden,
      paused,
      backdrop,
      backdropOwner,
    })
    // Note: `reloadTick` is NOT a dep because we want the memo to
    // recompute on every reload. It IS in the key below, which drives
    // the React reconciliation. If we added it as a dep here as well,
    // we'd double-recompute but behavior would be unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, provider, audioPayload, effectivelyHidden, paused, backdrop, backdropOwner, reloadTick])

  // React key on the provider mount. Composes three independent
  // remount triggers:
  //   1. `sourceRefKey(sourceRef)` — explicit source swap from the
  //      chrome dropdown. Fires immediately, even before the new
  //      source's payload arrives. Needed so `setup()` re-runs with
  //      the fresh injected globals (Task 2 → Task 3).
  //   2. `payloadKey(sourceRef, audioPayload)` — publisher identity
  //      change within a single `default` tracker (a new pattern
  //      starts publishing and becomes the most-recent). CONTEXT D-01.
  //   3. `reloadTick` — hot-reload debounce resolved, the provider's
  //      render should re-run with the new file content.
  // Any single change to any component forces a full unmount +
  // remount of the provider subtree below the keyed div.
  //
  // A BACKGROUND leaves trigger 2 out. Play publishes the pattern on the bus and
  // Stop unpublishes it, so keying on the publisher restarted the background
  // sketch on every Play and every Stop — trails, camera and clock gone, when
  // Play/Stop should only start and stop the music. The sketch instead keeps
  // running and receives the new (or absent) audio inputs through
  // `renderer.update()`, which every renderer implements as an in-place rebind
  // (CompiledVizMount calls it whenever the payload changes). A preview TAB keeps
  // the remount: there, following a different pattern re-runs `setup()` on purpose.
  //
  // #2428 — for the same reason a background leaves trigger 1 out too. Picking a
  // different source in the viz's settings, or a tab switch that changes whose
  // audio the background follows, is new audio, not a new sketch: the bus
  // subscription above follows `sourceRef`, and the payload reaches the running
  // sketch through `update()`.
  const providerKey = backdrop
    ? `bg:${reloadTick}`
    : `${sourceRefKey(sourceRef)}:${payloadKey(sourceRef, audioPayload)}:${reloadTick}`

  return (
    <div
      ref={containerRef}
      data-workspace-view="preview"
      data-file-id={fileId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
      {/*
        Provider output area. Keyed on `${publisherId}:${reloadTick}` so
        every reload trigger forces a fresh mount — the provider's
        internal state (effect closures capturing the analyser, RAF loops,
        compiled shaders) is torn down and rebuilt cleanly. PK5 step
        "destroy → mount" — this is the "destroy" half; the provider
        owns the "compile → mount" half inside its render function.
      */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {file ? (
          <div
            key={providerKey}
            data-testid={`preview-provider-mount-${fileId}`}
            data-provider-key={providerKey}
            style={{ width: '100%', height: '100%' }}
          >
            {providerNode}
          </div>
        ) : (
          <div
            data-workspace-view-state="loading"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--foreground-muted)',
              fontSize: 12,
            }}
          >
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}
