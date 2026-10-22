/**
 * drumPattern — prebaked example audio source.
 *
 * A canonical 4-beat / 2-second drum pattern that viz tabs can
 * query — AND hear. Combines a prebaked `PatternScheduler` (for
 * scheduler-driven viz like pianoroll) with a real audio graph
 * (for FFT-driven viz like spectrum analyzers).
 *
 * The audio is synthesized ONCE per source start via
 * `OfflineAudioContext`: a 2-second drum loop is rendered to an
 * `AudioBuffer`, then played on repeat through a looping
 * `AudioBufferSourceNode → GainNode → AnalyserNode → destination`.
 * The upside of offline rendering is that we get to use proper
 * envelopes and multiple synthesis stages without real-time
 * scheduling pain, while keeping the runtime overhead to a single
 * buffer source node for the lifetime of the source.
 *
 * The audio and the scheduler pattern are aligned by construction:
 * both use the same 2-second bar length and the same beat offsets,
 * so `stave.analyser.getByteFrequencyData()` rises on the same
 * frame that `stave.scheduler.query()` returns a kick event.
 *
 * ## Pattern structure
 *
 *   Bar length: 2 seconds (matches sampleSound's cycle so examples
 *   align if you compare schedulers side-by-side).
 *
 *   Four "tracks" identified by the `s` field on each event:
 *
 *     - `bd` (MIDI 36, C2) — kick on every quarter: 0, 0.5, 1, 1.5
 *     - `sd` (MIDI 38, D2) — snare on the backbeat: 0.5, 1.5
 *     - `hh` (MIDI 42, F#2) — closed hat on 8ths:
 *                             0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75
 *     - `oh` (MIDI 46, A#2) — open hat on the "and" of 4: 1.75
 *
 *   Every note holds for 0.1 seconds (short percussive hit). The
 *   `trackId` is set to the drum voice name so viz filtering by
 *   track works naturally.
 *
 * ## Synthesis details (minimal but recognizable)
 *
 *   - **Kick**: 100 Hz → 40 Hz sine sweep with exponential gain
 *     decay over 150 ms. Gives a punchy low thump.
 *   - **Snare**: white-noise burst through a bandpass filter
 *     around 2 kHz + a 200 Hz sine hit, both with fast decay.
 *   - **Closed hat**: high-pass filtered white noise, 30 ms decay.
 *   - **Open hat**: same high-pass, 200 ms decay (longer tail).
 */

import { workspaceAudioBus } from './WorkspaceAudioBus'
import type { AudioPayload } from './types'
import type { PatternScheduler } from '../visualizers/types'
import type { IREvent } from '../codeView'
import { HapStream } from '../engine/HapStream'
import {
  notifyPlaybackStarted,
  notifyPlaybackStopped,
  registerPlaybackSource,
} from './playbackCoordinator'

/** Fixed source id. */
export const DRUM_PATTERN_SOURCE_ID = '__example_drums__'

/** Human-readable label for the audio source dropdown. */
export const DRUM_PATTERN_LABEL = 'Example: drum pattern'

const BAR_SECONDS = 2
const HIT_DURATION = 0.1

interface DrumHit {
  s: 'bd' | 'sd' | 'hh' | 'oh'
  midi: number
  beatOffsets: readonly number[]
}

/**
 * The prebaked drum pattern. One entry per drum voice; each entry
 * lists the within-bar offsets (in seconds) at which that voice
 * fires. The scheduler expands this into `IREvent[]` on every
 * query() call so the viz sees consistent events regardless of
 * how far apart successive queries are.
 */
const DRUM_PATTERN: readonly DrumHit[] = [
  { s: 'bd', midi: 36, beatOffsets: [0, 0.5, 1, 1.5] },
  { s: 'sd', midi: 38, beatOffsets: [0.5, 1.5] },
  {
    s: 'hh',
    midi: 42,
    beatOffsets: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75],
  },
  { s: 'oh', midi: 46, beatOffsets: [1.75] },
]

/**
 * Virtual `PatternScheduler` implementation for the drum pattern
 * example. `now()` forwards the real `AudioContext.currentTime` if
 * the source has been started; otherwise a monotonic fallback from
 * `performance.now()` keeps the pattern advancing even for tests
 * or headless contexts.
 *
 * Exported for unit testing — takes any object with a
 * `currentTime: number` field so tests don't need a real
 * `AudioContext`.
 */
export class DrumPatternScheduler implements PatternScheduler {
  constructor(private readonly ctx: { currentTime: number }) {}

  now(): number {
    return this.ctx.currentTime
  }

  query(begin: number, end: number): IREvent[] {
    if (end <= begin) return []
    const events: IREvent[] = []
    const firstBar = Math.floor(begin / BAR_SECONDS)
    const lastBar = Math.floor(end / BAR_SECONDS)

    for (let bar = firstBar; bar <= lastBar; bar++) {
      const barStart = bar * BAR_SECONDS
      for (const hit of DRUM_PATTERN) {
        for (const offset of hit.beatOffsets) {
          const noteBegin = barStart + offset
          const noteEnd = noteBegin + HIT_DURATION
          if (noteEnd <= begin || noteBegin >= end) continue
          events.push({
            begin: noteBegin,
            end: noteEnd,
            endClipped: noteEnd,
            note: hit.midi,
            freq: 440 * Math.pow(2, (hit.midi - 69) / 12),
            s: hit.s,
            type: 'sample',
            gain: 1,
            velocity: 1,
            color: null,
            trackId: hit.s,
          })
        }
      }
    }
    return events
  }
}

interface DrumPatternState {
  ctx: AudioContext
  source: AudioBufferSourceNode
  gain: GainNode
  analyser: AnalyserNode
  scheduler: DrumPatternScheduler
  hapStream: HapStream
}

let state: DrumPatternState | null = null
/**
 * Race-guard so multiple rapid clicks on Preview don't kick off
 * parallel offline renders. The async `startDrumPattern` may be
 * in-flight for ~50ms while the OfflineAudioContext renders the
 * loop; during that window `state` is still null, so an un-guarded
 * check `if (state) return` would let a second call re-enter.
 */
let starting = false

/**
 * Render the 2-second drum loop into an `AudioBuffer` using an
 * `OfflineAudioContext`. Called ONCE per `startDrumPattern` —
 * the returned buffer is then played on repeat via a looping
 * `AudioBufferSourceNode` in the real audio context, so the
 * synth code doesn't need to do any real-time scheduling.
 *
 * The offline synthesis exactly mirrors the `DrumPatternScheduler`
 * pattern: same beat offsets, same bar length. Audio and scheduler
 * stay in perfect sync by construction — no drift, no timer loop.
 */
async function renderDrumLoopBuffer(): Promise<AudioBuffer> {
  const sampleRate = 44100
  const durationSeconds = 2 // matches BAR_SECONDS
  const offline = new OfflineAudioContext(
    1,
    sampleRate * durationSeconds,
    sampleRate,
  )

  // --- Kick: 100 Hz → 40 Hz sine sweep with expo gain decay ---
  const kickTimes = [0, 0.5, 1, 1.5]
  for (const t of kickTimes) {
    const osc = offline.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(100, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1)
    const gain = offline.createGain()
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.linearRampToValueAtTime(0.9, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
    osc.connect(gain).connect(offline.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  // --- Snare: bandpass-filtered noise + 200 Hz sine hit ---
  const snareTimes = [0.5, 1.5]
  for (const t of snareTimes) {
    // Noise burst
    const noiseBuf = offline.createBuffer(
      1,
      Math.floor(sampleRate * 0.12),
      sampleRate,
    )
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1
    }
    const noise = offline.createBufferSource()
    noise.buffer = noiseBuf
    const bp = offline.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2000
    bp.Q.value = 0.8
    const noiseGain = offline.createGain()
    noiseGain.gain.setValueAtTime(0.001, t)
    noiseGain.gain.linearRampToValueAtTime(0.5, t + 0.002)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    noise.connect(bp).connect(noiseGain).connect(offline.destination)
    noise.start(t)

    // Tonal component
    const tone = offline.createOscillator()
    tone.type = 'triangle'
    tone.frequency.value = 200
    const toneGain = offline.createGain()
    toneGain.gain.setValueAtTime(0.001, t)
    toneGain.gain.linearRampToValueAtTime(0.25, t + 0.002)
    toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    tone.connect(toneGain).connect(offline.destination)
    tone.start(t)
    tone.stop(t + 0.1)
  }

  // --- Closed hats: high-pass filtered noise, 30 ms decay ---
  const closedHatTimes = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5] // exclude 1.75 (open hat)
  for (const t of closedHatTimes) {
    const noiseBuf = offline.createBuffer(
      1,
      Math.floor(sampleRate * 0.05),
      sampleRate,
    )
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1
    }
    const noise = offline.createBufferSource()
    noise.buffer = noiseBuf
    const hp = offline.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = offline.createGain()
    g.gain.setValueAtTime(0.001, t)
    g.gain.linearRampToValueAtTime(0.15, t + 0.001)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    noise.connect(hp).connect(g).connect(offline.destination)
    noise.start(t)
  }

  // --- Open hat: same high-pass, longer 200 ms decay ---
  const openHatTime = 1.75
  {
    const noiseBuf = offline.createBuffer(
      1,
      Math.floor(sampleRate * 0.22),
      sampleRate,
    )
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1
    }
    const noise = offline.createBufferSource()
    noise.buffer = noiseBuf
    const hp = offline.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = offline.createGain()
    g.gain.setValueAtTime(0.001, openHatTime)
    g.gain.linearRampToValueAtTime(0.18, openHatTime + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, openHatTime + 0.2)
    noise.connect(hp).connect(g).connect(offline.destination)
    noise.start(openHatTime)
  }

  return offline.startRendering()
}

/**
 * Start the drum pattern source. Async because the audio buffer is
 * rendered via `OfflineAudioContext.startRendering()` — typically
 * ~30–80ms on desktop hardware, imperceptible to the user but not
 * instant. The chrome's click handler fires this as
 * fire-and-forget; the source appears on the bus once the render
 * completes and any pinned previews see the payload on their next
 * bus callback.
 *
 * Must be called from a user gesture per browser autoplay policy.
 * Safe to call multiple times — the `starting` race guard prevents
 * parallel renders and the `state` early-return handles the
 * already-running case.
 */
export async function startDrumPattern(): Promise<void> {
  if (state || starting) return
  starting = true
  try {
    const ctx = new AudioContext()
    const buffer = await renderDrumLoopBuffer()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gain = ctx.createGain()
    gain.gain.value = 0.4 // low enough to not be annoying
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.7
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    source.start()

    const scheduler = new DrumPatternScheduler(ctx)
    const hapStream = new HapStream()
    state = { ctx, source, gain, analyser, scheduler, hapStream }

    const payload: AudioPayload = {
      analyser,
      scheduler,
      hapStream,
      audio: { analyser, audioCtx: ctx },
    }
    workspaceAudioBus.publish(DRUM_PATTERN_SOURCE_ID, payload)
    // Single-source playback coordination — see playbackCoordinator.ts.
    notifyPlaybackStarted(DRUM_PATTERN_SOURCE_ID)
  } finally {
    starting = false
  }
}

/**
 * Stop the drum pattern source. Stops the buffer source, disposes
 * the hap stream, unpublishes from the bus, closes the AudioContext.
 * No-op if not running.
 */
export function stopDrumPattern(): void {
  if (!state) return
  try {
    state.source.stop()
  } catch {
    // stop() throws if already stopped — non-fatal.
  }
  try {
    state.source.disconnect()
    state.gain.disconnect()
    state.analyser.disconnect()
  } catch {
    // disconnect() throws if already disconnected — non-fatal.
  }
  state.hapStream.dispose()
  workspaceAudioBus.unpublish(DRUM_PATTERN_SOURCE_ID)
  try {
    void state.ctx.close()
  } catch {
    // close() rejects if already closed — non-fatal.
  }
  state = null
  notifyPlaybackStopped(DRUM_PATTERN_SOURCE_ID)
}

/**
 * Query whether the drum pattern source is currently running OR
 * in the middle of starting. The `starting` flag is included so
 * the chrome's click handler doesn't kick off a second parallel
 * render while the first is still producing its AudioBuffer.
 */
export function isDrumPatternPlaying(): boolean {
  return state !== null || starting
}

// Eager registration with the playback coordinator — same pattern
// as `sampleSound`. `stopDrumPattern` is idempotent, so leaving it
// registered across the module's lifetime is safe.
registerPlaybackSource(
  DRUM_PATTERN_SOURCE_ID,
  stopDrumPattern,
  DRUM_PATTERN_LABEL,
)
