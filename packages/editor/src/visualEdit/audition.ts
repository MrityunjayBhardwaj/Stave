/**
 * audition.ts — one-shot sound preview through the shared audio graph (#805).
 *
 * "Hear before you place": the instrument picker (and any future sound browser)
 * previews a sound by triggering a single note on the SAME `superdough` singleton
 * the engine drives, so it reuses the already-loaded samples/output. Mirrors the
 * press-and-hold audition in PianoRollGrid (#633), factored out now that a second
 * caller (the Mixer picker) needs the same primitive.
 *
 * Grounding notes (superdough.mjs:439 `superdough(value, t, hapDuration, cps, cycle)`):
 *   - `value` is the resolved hap object — `{ note, s, gain, attack, sustain, release }`.
 *   - Synth sounds always render. Sample/soundfont sounds need the engine
 *     initialized (a played doc) — otherwise superdough REJECTS the promise, so
 *     we `.catch` it and no-op. Never throws: audio-not-ready must never break
 *     the picker UI.
 *   - Percussive samples ignore the note; a mid-register default keeps melodic
 *     instruments in a musical range.
 */
import { superdough, getAudioContext } from '@strudel/webaudio'
import { onLiveGraph } from '../engine/offlineGraph'

/**
 * Shared audition envelope (#816). Both this one-shot preview and PianoRollGrid's
 * key press (`playMidi`) trigger a note through this SAME shape, so a picker ▶
 * preview sounds identical to a key tap — one constant, no drift. `sustain: 1`
 * (full level, not the synth default pluck of 0) gives the note body; the short
 * `release` keeps the tail tight.
 */
export const AUDITION_ENVELOPE = {
  gain: 0.9,
  attack: 0.01,
  sustain: 1,
  release: 0.08,
} as const

/**
 * One-shot / single-tap note length in seconds. A held pianoroll key retriggers
 * at this interval (PianoRollGrid `HOLD_RETRIGGER_MS = AUDITION_DUR_S * 1000`),
 * so a single tap and a ▶ preview are the same length.
 */
export const AUDITION_DUR_S = 0.22

/** Fire one note through the shared audio graph. Internal — the shared unit
 *  behind both the one-shot preview and the sustained/looping preview so they
 *  can never drift (same envelope, same scheduling). */
function fireOnce(sound: string, note: string): void {
  // #1733 — a background waveform render borrows superdough's context; the note
  // waits for it to hand the context back rather than playing into the render.
  onLiveGraph(() => fireNow(sound, note))
}

function fireNow(sound: string, note: string): void {
  try {
    const ctx = getAudioContext()
    // The click/select is the user gesture that unlocks a suspended context.
    void ctx.resume()
    const value: Record<string, unknown> = {
      note,
      s: sound,
      ...AUDITION_ENVELOPE,
    }
    // t must be the absolute onset; a small lead avoids scheduling in the past.
    void superdough(value, ctx.currentTime + 0.02, AUDITION_DUR_S, 0.5, 0)?.catch(() => {})
  } catch {
    /* audio graph not ready — never break the UI */
  }
}

/** Preview `sound` once (a single `note`, default c4). Safe to call anytime. */
export function auditionSound(sound: string, note = 'c4'): void {
  if (!sound) return
  fireOnce(sound, note)
}

/** Handle for a sustained preview — {@link stopAudition}/`stop()` ends it. */
export interface AuditionHandle {
  /** Stop the preview. Idempotent — safe to call after it already ended. */
  stop: () => void
}

/**
 * Start a SUSTAINED preview of `sound` (the Asset Library's play/pause), the
 * same way a held pianoroll key stays sounding (#633): retrigger an overlapping
 * note every {@link AUDITION_DUR_S} so a sample/synth keeps playing until the
 * user stops it. Uses the SAME `fireOnce` (hence the SAME {@link AUDITION_ENVELOPE},
 * PV166) as the one-shot preview, so sustained and single-tap match.
 *
 * Returns a handle whose `stop()` clears the retrigger; the final note's own
 * release tail lets it fade naturally. Never throws (audio-not-ready no-ops).
 */
export function startAudition(sound: string, note = 'c4'): AuditionHandle {
  if (!sound) return { stop: () => {} }
  fireOnce(sound, note)
  // Mirror PianoRollGrid's HOLD_RETRIGGER_MS (= AUDITION_DUR_S * 1000).
  const timer = setInterval(() => fireOnce(sound, note), AUDITION_DUR_S * 1000)
  let stopped = false
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    },
  }
}

/**
 * Preview a recording once, from its start to its end (#2059) — the Library's play
 * button on a sound of your own.
 *
 * {@link startAudition} re-triggers a 0.22 s note every 0.22 s: right for a synth
 * (a held key), wrong for a recording, where it played the opening fifth of a
 * second over and over and never the clip. A recording is heard as it is: decoded
 * from its URL and played straight through on the shared context, so `stop()`
 * ends this preview and nothing else — not the song, if one is playing.
 *
 * `ended` resolves when the clip finishes by itself or is stopped. Never throws:
 * a URL that will not decode resolves `ended` and plays nothing.
 */
export interface ClipPreviewHandle extends AuditionHandle {
  readonly ended: Promise<void>
}

/** decoded clips by URL — a second preview of the same clip does not decode again */
const decodedClips = new Map<string, Promise<AudioBuffer>>()

export function startClipPreview(url: string, gain = AUDITION_ENVELOPE.gain): ClipPreviewHandle {
  let stopped = false
  let source: AudioBufferSourceNode | null = null
  let finish: () => void = () => {}
  const ended = new Promise<void>((resolve) => {
    finish = resolve
  })
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      source?.stop()
    } catch {
      /* not started, or already ended */
    }
    finish()
  }
  try {
    const ctx = getAudioContext()
    // The click is the user gesture that unlocks a suspended context.
    void ctx.resume()
    let decoded = decodedClips.get(url)
    if (!decoded) {
      decoded = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes))
      decodedClips.set(url, decoded)
      decoded.catch(() => decodedClips.delete(url))
    }
    decoded.then(
      (buffer) => {
        if (stopped) return
        const out = ctx.createGain()
        out.gain.value = gain
        out.connect(ctx.destination)
        source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(out)
        source.onended = () => {
          out.disconnect()
          stop()
        }
        source.start()
      },
      () => stop(),
    )
  } catch {
    stop()
  }
  return { stop, ended }
}
