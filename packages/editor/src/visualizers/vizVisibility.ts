/**
 * vizVisibility — Phase C: pause a viz renderer while its container is off-screen
 * or collapsed, or while the browser tab is hidden, and resume it when it's both
 * on-screen AND the tab is visible.
 *
 * Why: a viz in a collapsed pane / scrolled out of view / a background tab runs
 * its WHOLE pipeline for output nobody sees. `WorkerVizRenderer.pause()` stops
 * BOTH the main-thread `sample()`+post rAF and the worker draw loop; `P5VizRenderer`
 * `noLoop()`s; `HydraVizRenderer` cancels its rAF. So pausing reclaims real
 * main-thread + GPU work AND bounds the live worker count (mitigates the WebGL
 * ~16-context cap without a full pool — B-6).
 *
 * Model: each registration gets its own `IntersectionObserver`; a SINGLE shared
 * `visibilitychange` listener fans out to every entry. The renderer runs iff
 * `onScreen && tabVisible`; pause/resume fire only on a state TRANSITION (never
 * every event). No-op where `IntersectionObserver`/`document` are unavailable
 * (SSR / a jsdom without the polyfill) — the renderer simply keeps running, i.e.
 * the pre-Phase-C behaviour.
 *
 * REF: #258 (Phase C), VizRenderer.pause/resume, WorkerVizRenderer.pause (stops
 *      main rAF + worker), FallbackVizRenderer (its probation waits for `alive`,
 *      which needs no frame, so pausing does not affect it — #2560), PK24.
 */
import type { VizRenderer } from './types'

/** A renderer this module can pause/resume, and OPTIONALLY reclaim (destroy +
 *  re-create on resume) after a sustained off-screen period — #263 part B. Only
 *  the inline path passes a `teardownMs` + a renderer that implements
 *  `teardown()` (TeardownOnPauseRenderer); everything else pauses as before. */
type Pausable = Pick<VizRenderer, 'pause' | 'resume'> & { teardown?: () => void }

interface Entry {
  renderer: Pausable
  onScreen: boolean
  running: boolean
  io: IntersectionObserver | null
  /** Off-screen reclaim delay (ms); 0 = never tear down (the default). */
  teardownMs: number
  /** Pending off-screen teardown timer, or null. */
  teardownTimer: ReturnType<typeof setTimeout> | null
}

const entries = new Set<Entry>()
let tabVisible = true
let visibilityWired = false

/** Apply the desired running state to one entry, firing pause/resume only on a
 *  transition. Exported for unit tests that drive entries without real observers. */
function syncEntry(e: Entry): void {
  // Off-screen teardown timer (#263 B): arm while OFF-SCREEN specifically — NOT
  // merely paused. A tab-hidden-but-on-screen viz pauses without tearing down
  // (off-screen-only, by design); only a zone scrolled out of view past the
  // threshold is reclaimed. The timer fires renderer.teardown() (destroy +
  // reclaim); resume() below transparently re-creates it on return.
  if (e.teardownMs > 0 && e.renderer.teardown) {
    if (!e.onScreen && e.teardownTimer === null) {
      e.teardownTimer = setTimeout(() => {
        e.teardownTimer = null
        if (!e.onScreen) e.renderer.teardown?.()
      }, e.teardownMs)
    } else if (e.onScreen && e.teardownTimer !== null) {
      clearTimeout(e.teardownTimer)
      e.teardownTimer = null
    }
  }

  const desired = e.onScreen && tabVisible
  if (desired === e.running) return
  e.running = desired
  // resume() on a torn-down TeardownOnPauseRenderer re-creates the inner
  // renderer; on a normal one it just restarts the loop.
  if (desired) e.renderer.resume()
  else e.renderer.pause()
}

function onVisibilityChange(): void {
  tabVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
  entries.forEach(syncEntry)
}

function wireVisibility(): void {
  if (visibilityWired || typeof document === 'undefined') return
  visibilityWired = true
  tabVisible = document.visibilityState !== 'hidden'
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function unwireVisibility(): void {
  if (!visibilityWired || entries.size > 0 || typeof document === 'undefined') return
  visibilityWired = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

/**
 * Register `renderer` to be paused/resumed with `container`'s visibility. Returns
 * an unregister function (call it on unmount/destroy). No-op environment → returns
 * a no-op unregister and the renderer keeps running.
 */
export function registerVizVisibility(
  renderer: Pausable,
  container: Element,
  opts?: { teardownMs?: number },
): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  // Start running + assumed on-screen so the common on-screen mount never flashes
  // pause→resume; the IO's initial callback corrects `onScreen` next frame. The
  // immediate sync below still pauses a viz mounted into an already-hidden tab.
  const entry: Entry = {
    renderer,
    onScreen: true,
    running: true,
    io: null,
    teardownMs: opts?.teardownMs ?? 0,
    teardownTimer: null,
  }
  wireVisibility()
  entries.add(entry)
  syncEntry(entry)

  entry.io = new IntersectionObserver(
    (records) => {
      const last = records[records.length - 1]
      if (last) entry.onScreen = last.isIntersecting
      syncEntry(entry)
    },
    { threshold: 0 },
  )
  entry.io.observe(container)

  return () => {
    entry.io?.disconnect()
    entry.io = null
    if (entry.teardownTimer !== null) {
      clearTimeout(entry.teardownTimer)
      entry.teardownTimer = null
    }
    entries.delete(entry)
    unwireVisibility()
  }
}
