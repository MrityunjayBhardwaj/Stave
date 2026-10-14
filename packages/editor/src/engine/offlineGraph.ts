/**
 * The page's ONE superdough graph, and who may borrow it for an offline render
 * (#1733).
 *
 * An offline render points superdough's module-level audio context and
 * controller at an `OfflineAudioContext` for as long as it runs
 * (`renderPatternOffline.ts`). Those globals are one per PAGE, not one per
 * engine: every file's runtime has its own `StrudelEngine`, and every one of
 * them, and every audition, reads the same two globals. So the rules that keep
 * a render honest live here, at page scope:
 *
 * ⚠ ONE OFFLINE RENDER AT A TIME, ACROSS ENGINES. `withOfflineGraph` queues
 * every render, a bounce or a background waveform render (#1731), behind the
 * one before it. Two engines each keep their own renders in order
 * (`renderStemsInOrder`, `trackEnvelopes.ts`) but cannot see each other's.
 *
 * ⚠ A LIVE SOUND FIRST, A BACKGROUND RENDER SECOND. An audition (the
 * instrument picker's ▶, a piano-roll key) calls `superdough()` directly, so
 * during a render it would play into the render: silent to the user, and drawn
 * into the waveform. `onLiveGraph` interrupts every background render, waits
 * for it to hand the globals back — at most one render window — and only then
 * plays. When nothing is rendering it plays at once, in the same call.
 *
 * ⚠ A USER'S RENDER BEFORE EVERY ENGINE'S BACKGROUND RENDER (#1735). A bounce
 * or a stems export in one file must not wait out another file's waveform
 * render: that is seconds per track on a long song. `withUserRender` stops the
 * background render in flight on EVERY engine and keeps them all from starting
 * one until it ends, not only its own engine's. A stems export is several
 * renders in a row, and a render that slipped in between two of them would
 * cost the same wait again.
 *
 * Not covered, on purpose: a USER's render (a bounce) is not interrupted by an
 * audition. The bounce is what the user asked for; an audition during one still
 * reaches the bounce's context, as it did before this module existed.
 *
 * Deliberately free of imports: the renders and interrupts arrive as functions.
 */

let queue: Promise<void> = Promise.resolve()
let held = 0

/** Run `render` once every earlier offline render has let go of the graph. */
export function withOfflineGraph<T>(render: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    held++
    try {
      return await render()
    } finally {
      held--
    }
  })
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Is an offline render borrowing the graph right now? */
/**
 * Run `fn` once no offline render holds the graph — at once, in the same call,
 * when none does (#2064).
 *
 * For anything that acts on what superdough is PLAYING rather than starting a
 * sound: Stop's fade (#2058) reads superdough's context and its live-sound map,
 * and while a bounce renders both are the bounce's — a fade then lands on the
 * file being written (measured: the bounced file changed by 0.22 per sample).
 * Waits out every render queued at the time of the call, not only the one in
 * flight, because each of them points the globals at its own context.
 */
export function whenGraphFree(fn: () => void): void {
  if (held === 0) {
    fn()
    return
  }
  void queue.then(fn, fn)
}

export function offlineGraphBusy(): boolean {
  return held > 0
}

/** A background renderer: one engine's display-render scheduler (#1731). */
export interface BackgroundRenderer {
  /**
   * Stop the render in flight. Settles once it has handed the graph back, or
   * null when it had nothing in flight.
   */
  interrupt(): Promise<void> | null
  /** Run `fn` with none of this renderer's renders in flight or starting. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>
}

const renderers = new Set<BackgroundRenderer>()

/** Register a background renderer; returns its removal. */
export function registerBackgroundRender(renderer: BackgroundRenderer): () => void {
  renderers.add(renderer)
  return () => {
    renderers.delete(renderer)
  }
}

/**
 * Interrupt every background render. Null when none was in flight, so a caller
 * can act at once; otherwise settles when all of them have let go.
 */
export function interruptBackgroundRenders(): Promise<void> | null {
  const waits: Promise<void>[] = []
  for (const renderer of renderers) {
    const wait = renderer.interrupt()
    if (wait) waits.push(wait)
  }
  return waits.length === 0 ? null : Promise.all(waits).then(() => undefined)
}

/**
 * Run a USER's render (a bounce, a stems export) with no background render in
 * flight or starting on any engine, until it ends.
 */
export function withUserRender<T>(render: () => Promise<T>): Promise<T> {
  // Every render in flight is told to stop NOW, so they wind down together;
  // each `exclusive` below only waits for its own to have let go.
  interruptBackgroundRenders()
  let run = render
  for (const renderer of renderers) {
    const inner = run
    run = () => renderer.exclusive(inner)
  }
  return run()
}

/**
 * Run `play` against the LIVE graph: at once when no background render is in
 * flight, else as soon as every one has let go. For anything that calls
 * `superdough()` outside the scheduler, which is what an audition does.
 */
export function onLiveGraph(play: () => void): void {
  const wait = interruptBackgroundRenders()
  if (wait == null) {
    play()
    return
  }
  void wait.then(play, play)
}
