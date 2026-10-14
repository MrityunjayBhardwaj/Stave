/**
 * Asking the browser to start audio (#1987).
 *
 * A context made before the user has touched the page is born SUSPENDED, and ours is
 * made at boot. Nothing used to ask it to start: superdough's `initAudio` means to, but
 * its guard reads `(!audioCtx) instanceof OfflineAudioContext` (`superdough.mjs`,
 * `initAudio`), which is always false, so the `resume()` under it never runs. Desktop
 * browsers start a suspended context by themselves once the page has been clicked; a
 * phone browser that starts audio only when the page asks INSIDE a touch stays silent.
 *
 * So the page asks: on Play, inside the gesture (`startAudio`), and — for a Play that
 * lands before the engine has a context — on the next touch or key
 * (`startAudioOnNextGesture`).
 */

/** the two things asked of a context here — so a test can hand in a stand-in */
export type StartableAudio = Pick<AudioContext, 'state' | 'resume'>

/**
 * Ask `ctx` to start. Call it SYNCHRONOUSLY inside the user's gesture: a browser that
 * insists on a gesture counts only what runs before the handler first yields.
 * Nothing to do for a context that is already running or has been closed.
 */
export function startAudio(ctx: StartableAudio | null | undefined): void {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return
  try {
    // a refusal is not an error here: the next gesture asks again
    void ctx.resume().catch(() => undefined)
  } catch {
    /* a context that cannot be resumed at all — same answer */
  }
}

type AudioSessionNavigator = { audioSession?: { type?: string } }

/**
 * #2015 — what Stave asks of a phone's audio when it plays. On (the default): it
 * PLAYS, so the ring/silent switch does not mute it, and iOS stops other apps' music
 * for it. Off: it plays ALONGSIDE other apps (`ambient`), and the silent switch mutes
 * it. Set by the app's setting; read on every Play.
 */
let takesPhoneAudio = true
/** whether a Play has declared a session yet: a change before that waits for one */
let declared = false

/**
 * Say how this page plays audio, where the browser lets a page say so (Safari's
 * `navigator.audioSession`). Without `playback` an iPhone treats Web Audio as
 * incidental sound and its ring/silent switch mutes it. A browser without the API is
 * left alone.
 */
export function declarePlayback(nav: AudioSessionNavigator | undefined = globalThis.navigator as AudioSessionNavigator | undefined): void {
  const session = nav?.audioSession
  if (!session) return
  declared = true
  const type = takesPhoneAudio ? 'playback' : 'ambient'
  if (session.type === type) return
  try {
    session.type = type
  } catch {
    /* read-only or refused: the switch keeps its say */
  }
}

/**
 * #2015 — set whether Stave takes the phone's audio (see `takesPhoneAudio`). Once a
 * Play has declared a session, the change applies now, so turning it off lets the
 * other app's music back in without a second Play.
 */
export function setTakesPhoneAudio(
  on: boolean,
  nav: AudioSessionNavigator | undefined = globalThis.navigator as AudioSessionNavigator | undefined,
): void {
  takesPhoneAudio = on
  if (declared) declarePlayback(nav)
}

/** the gestures a browser accepts as "the user asked for sound" */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const

type GestureTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>

/**
 * Until `ctx` is running, every touch or key press asks it to start; once it runs (or
 * is closed) the listeners take themselves off. Returns the way to take them off early.
 *
 * This is what covers a Play pressed before the engine had a context to ask: that
 * gesture is spent by the time boot finishes, so the next one does it.
 */
export function startAudioOnNextGesture(ctx: StartableAudio, target: GestureTarget | undefined = globalThis.document): () => void {
  if (!target) return () => undefined
  const off = (): void => {
    for (const g of GESTURES) target.removeEventListener(g, ask, true)
  }
  const ask = (): void => {
    if (ctx.state === 'running' || ctx.state === 'closed') {
      off()
      return
    }
    startAudio(ctx)
  }
  for (const g of GESTURES) target.addEventListener(g, ask, true)
  return off
}
