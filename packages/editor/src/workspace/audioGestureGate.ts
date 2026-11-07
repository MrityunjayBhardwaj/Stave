/**
 * audioGestureGate — start a sound now if the page may play audio, otherwise on
 * the person's first click or key press (#2451).
 *
 * Browsers refuse audio until the person has interacted with the page. A built-in
 * example sound started then (a viz's own background restored after a reload) gets
 * an AudioContext that stays suspended, so the background reacts to silence and
 * nothing says why. The page's sticky activation (`navigator.userActivation
 * .hasBeenActive`) says whether audio may start; while it is false, starts wait
 * here, keyed by the viz file they belong to, and run inside the first gesture
 * that grants it. `isWaitingForGesture` lets the viz's chrome say so meanwhile.
 *
 * One set of window listeners, armed only while something waits and removed as
 * soon as the waiting starts run or are all cancelled.
 */

const pending = new Map<string, () => void>()
const listeners = new Set<() => void>()
let armed = false

// A mouse press grants the page permission on the way down; a finger only on the
// way up (a touch might still become a scroll), so a phone's tap passes `pointerdown`
// with the page still unable to play audio and needs the later events.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const

/** whether the page may start audio now (no activation API → assume it may) */
export function audioMayStart(): boolean {
  if (typeof navigator === 'undefined') return true
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  return ua ? ua.hasBeenActive : true
}

function notify(): void {
  for (const cb of Array.from(listeners)) cb()
}

function onGesture(): void {
  // An event that doesn't count as interaction (Escape, a finger going down)
  // leaves the page unable to play audio: keep waiting for one that does.
  if (!audioMayStart()) return
  disarm()
  const starts = Array.from(pending.values())
  pending.clear()
  notify()
  for (const start of starts) start()
}

function arm(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  for (const type of GESTURES) window.addEventListener(type, onGesture, true)
}

function disarm(): void {
  if (!armed) return
  armed = false
  for (const type of GESTURES) window.removeEventListener(type, onGesture, true)
}

/**
 * Run `start` now if audio may start; otherwise on the first gesture, replacing
 * anything already waiting under the same key.
 */
export function startWhenAudioAllowed(key: string, start: () => void): void {
  if (audioMayStart()) {
    cancelAudioStart(key)
    start()
    return
  }
  pending.set(key, start)
  arm()
  notify()
}

/** Drop a waiting start (its background went away). No-op if none waits. */
export function cancelAudioStart(key: string): void {
  if (!pending.delete(key)) return
  if (pending.size === 0) disarm()
  notify()
}

export function isWaitingForGesture(key: string): boolean {
  return pending.has(key)
}

/** Called whenever the set of waiting starts changes. Returns an unsubscribe. */
export function onGestureWaitChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Test-only. */
export function __resetAudioGestureGateForTests(): void {
  pending.clear()
  listeners.clear()
  disarm()
}
