/**
 * playbackCoordinator — single-source-at-a-time playback across tabs.
 *
 * Stave's UX model: only ONE audio source is playing at any given
 * time. Starting a new one (a pattern runtime's `play()`, or a
 * built-in example like drum pattern / chord progression / sample
 * sound) should stop whatever was playing before, without the user
 * having to manually stop the old source.
 *
 * This module is a tiny coordinator that audio sources register
 * themselves with. Each registered source provides an idempotent
 * `stop()` callback. When any source calls `notifyPlaybackStarted`,
 * the coordinator invokes `stop()` on every OTHER registered
 * source, leaving just the started one active.
 *
 * ## Why a separate module (instead of threading through React)
 *
 * Playback sources live in different layers: `LiveCodingRuntime`
 * (class instances), `sampleSound` / `drumPattern` /
 * `chordProgression` (module-level singletons). None of them share
 * a React component tree, and the relationship between them is
 * "at most one active at a time" — a cross-cutting concern that
 * doesn't map cleanly to props or context. A module-level
 * coordinator is the smallest thing that correctly expresses that
 * relationship.
 *
 * ## Stop callbacks must be idempotent
 *
 * The coordinator calls every non-matching registered `stop()` on
 * every start event. If `stop()` was already called (source is
 * already idle), calling it again must be a no-op. All existing
 * sources already satisfy this — `LiveCodingRuntime.stop()`
 * checks `isPlayingState`, `stopSampleSound` checks `state !==
 * null`, etc.
 *
 * ## Stop callbacks must not throw
 *
 * The coordinator wraps each `stop()` in a try/catch so a broken
 * source can't prevent others from stopping. A throw is logged
 * (console) but the iteration continues.
 *
 * ## Sources that play alongside (#2427)
 *
 * A built-in example sound that a viz file's OWN background listens to is part
 * of that background, not a competing player: each file owns its background, so
 * playing a pattern must not silence another file's. The shell names those
 * sources with `setAlongsideSources`. Such a source is never stopped by another
 * start, and its own start stops nothing. Everything else keeps the
 * one-at-a-time rule.
 *
 * ## Not a React hook
 *
 * The coordinator is plain module functions — no React involved.
 * React components that want to observe playback state can call
 * `onPlaybackChanged` to subscribe.
 */

type StopFn = () => void
type Unsubscribe = () => void

interface RegisteredSource {
  readonly stop: StopFn
  /**
   * Human-readable label for debug logging. Not used for
   * coordination — the sourceId is the unique key.
   */
  readonly label?: string
}

const registry = new Map<string, RegisteredSource>()
const changeListeners = new Set<(currentlyPlaying: string | null) => void>()
let currentlyPlaying: string | null = null
let alongside: ReadonlySet<string> = new Set()

/**
 * #2427 — the sources that play alongside everything else (see the module doc).
 * Replaces the whole set; the shell passes the built-ins its viz backgrounds
 * currently use, every time that record changes.
 */
export function setAlongsideSources(sourceIds: Iterable<string>): void {
  alongside = new Set(sourceIds)
}

/**
 * Register a playback source with the coordinator. The caller
 * supplies a stable `sourceId` (same id across register/unregister
 * cycles) and an idempotent `stop` callback. Returns an
 * unregister function — call it when the source is disposed
 * (e.g., in `LiveCodingRuntime.dispose()`).
 *
 * Safe to call multiple times with the same id — the latest
 * registration wins. Re-registering does NOT stop the source.
 */
export function registerPlaybackSource(
  sourceId: string,
  stop: StopFn,
  label?: string,
): Unsubscribe {
  registry.set(sourceId, { stop, label })
  return () => {
    const entry = registry.get(sourceId)
    // Only delete if the entry is OUR registration — protect
    // against stale unregister calls clobbering a re-registration.
    if (entry?.stop === stop) {
      registry.delete(sourceId)
      if (currentlyPlaying === sourceId) {
        currentlyPlaying = null
        fireChange()
      }
    }
  }
}

/**
 * Notify the coordinator that a source has started playing. Every
 * OTHER registered source has its `stop` callback invoked, leaving
 * the new source as the sole active one. The new source's own
 * stop is NOT called (we'd be asking it to immediately undo what
 * the user just did).
 *
 * If the coordinator already has `sourceId` as the currently-
 * playing source, this is a no-op. Calling `notifyPlaybackStarted`
 * with an UNREGISTERED id is allowed — the id still becomes the
 * currently-playing marker, and future starts will stop any
 * sources registered AFTER this call too.
 */
export function notifyPlaybackStarted(sourceId: string): void {
  if (currentlyPlaying === sourceId) return
  // #2427 — a background's own source starts without stopping anything
  if (alongside.has(sourceId)) return
  for (const [id, src] of registry) {
    if (id === sourceId || alongside.has(id)) continue
    try {
      src.stop()
    } catch (err) {
      // Non-fatal — a broken source shouldn't stop the iteration.
      // eslint-disable-next-line no-console
      console.warn(
        `[playbackCoordinator] stop() threw for source "${id}" (${
          src.label ?? 'unlabeled'
        }):`,
        err,
      )
    }
  }
  currentlyPlaying = sourceId
  fireChange()
}

/**
 * Notify the coordinator that a source has stopped playing on its
 * own (user pressed Stop, natural end, error). If this source is
 * the currently-playing marker, clear it. Otherwise a no-op.
 */
export function notifyPlaybackStopped(sourceId: string): void {
  if (currentlyPlaying !== sourceId) return
  currentlyPlaying = null
  fireChange()
}

/**
 * The id of the source the coordinator believes is currently
 * playing, or `null` if nothing is. Reflects what the coordinator
 * was last told via `notifyPlaybackStarted` / `notifyPlaybackStopped`.
 * Consumers that need real-time accuracy should query the source
 * directly; this is primarily for UI state mirrors.
 */
export function getCurrentlyPlaying(): string | null {
  return currentlyPlaying
}

/**
 * Subscribe to playback state changes. The callback fires AFTER
 * `currentlyPlaying` updates, with the new value. Returns an
 * idempotent unsubscribe.
 */
export function onPlaybackChanged(
  cb: (currentlyPlaying: string | null) => void,
): Unsubscribe {
  changeListeners.add(cb)
  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true
    changeListeners.delete(cb)
  }
}

function fireChange(): void {
  if (changeListeners.size === 0) return
  const snapshot = Array.from(changeListeners)
  for (const cb of snapshot) {
    try {
      cb(currentlyPlaying)
    } catch {
      // Listener exceptions never break the dispatch loop.
    }
  }
}

/**
 * Test-only helper — reset the coordinator between tests so
 * registrations don't leak across `describe` blocks.
 */
export function __resetPlaybackCoordinatorForTests(): void {
  registry.clear()
  changeListeners.clear()
  currentlyPlaying = null
  alongside = new Set()
}
