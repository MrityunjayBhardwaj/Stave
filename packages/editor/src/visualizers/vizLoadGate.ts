/**
 * vizLoadGate — Play waits for the pattern's sketches to finish loading (#2560).
 *
 * A heavy sketch (a three.js scene loading a 4K HDRI and a model) takes seconds
 * to set up. Most of that now happens before Play: the background is built when
 * the file opens, and inline `.viz()` sketches are warmed hidden
 * (`inlineVizWarmup.ts`). When Play is pressed before a sketch has finished, the
 * music waits for it — so the song does not start under a frozen picture — but
 * only up to {@link PLAY_VIZ_WAIT_CAP_MS}: a sketch that never finishes (a broken
 * load, a top level that never returns) can never hold the music for longer. A
 * cap of 0 starts the music at once, as before.
 *
 * The two doors that build a sketch the PATTERN uses register here — the inline
 * zones (`viewZones.addInlineViewZones`) and the background
 * (`compiledVizProvider`, when it renders a backdrop). A viz in a preview tab or
 * the gallery is not the pattern's, and does not hold Play.
 *
 * While Play waits, `isWaitingForVisuals()` is true and the transport says so
 * ("Loading visuals…"), so the wait is never a silent stall.
 */
import type { VizRenderer } from './types'

/** Longest the music waits for the pattern's sketches after Play (ms). */
export const PLAY_VIZ_WAIT_CAP_MS = 20_000

const pending = new Set<Promise<void>>()

/** Register a sketch the pattern uses; Play will wait for its `whenLoaded`. A
 *  renderer without one is taken as loaded. */
export function trackPatternVizLoad(renderer: VizRenderer): void {
  const p = renderer.whenLoaded?.()
  if (!p) return
  pending.add(p)
  void p.then(
    () => pending.delete(p),
    () => pending.delete(p),
  )
}

/** How many registered sketches are still loading. */
export function pendingPatternVizLoads(): number {
  return pending.size
}

let waiting = false
const listeners = new Set<(waiting: boolean) => void>()

function setWaiting(next: boolean): void {
  if (waiting === next) return
  waiting = next
  for (const cb of Array.from(listeners)) {
    try {
      cb(next)
    } catch {
      /* a listener's failure is its own */
    }
  }
}

/** True while a Play is holding the music for the pattern's sketches. */
export function isWaitingForVisuals(): boolean {
  return waiting
}

/** Fires on every change of {@link isWaitingForVisuals}. Returns unsubscribe. */
export function onWaitingForVisualsChanged(cb: (waiting: boolean) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** How a wait ended: nothing to wait for, every sketch loaded, the cap ran out,
 *  or the caller cancelled it (Stop). */
export type VizWaitOutcome = 'none' | 'loaded' | 'cap' | 'cancelled'

/**
 * Wait for every sketch registered so far to load, at most `capMs`. Resolves —
 * never rejects. `cancel` (a promise the caller settles on Stop) ends it early.
 */
export function waitForPatternViz(
  capMs: number = PLAY_VIZ_WAIT_CAP_MS,
  cancel?: Promise<unknown>,
): Promise<VizWaitOutcome> {
  if (pending.size === 0 || capMs <= 0) return Promise.resolve('none')
  const all = Promise.all(Array.from(pending)).then(() => 'loaded' as const)
  setWaiting(true)
  return new Promise<VizWaitOutcome>((resolve) => {
    let settled = false
    const finish = (outcome: VizWaitOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      setWaiting(false)
      resolve(outcome)
    }
    const timer = setTimeout(() => finish('cap'), capMs)
    void all.then(finish)
    void cancel?.then(() => finish('cancelled'))
  })
}

/** Tests only: forget every registered sketch and any wait state. */
export function __resetVizLoadGateForTests(): void {
  pending.clear()
  waiting = false
  listeners.clear()
}
