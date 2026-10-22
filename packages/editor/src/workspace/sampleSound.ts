/**
 * sampleSound — test audio source for viz development.
 *
 * A self-contained sawtooth oscillator with an LFO-modulated pitch that
 * feeds an `AnalyserNode`, plus a virtual `PatternScheduler` that
 * returns a repeating 4-note arpeggio synced to the LFO period. The
 * payload is published to the `workspaceAudioBus` under the fixed
 * source id `__sample__` so the user can pick "Sample sound" in a viz
 * tab's source dropdown and see both FFT-reactive shaders AND
 * scheduler-driven sketches (like the default pianoroll) react to a
 * predictable source without needing to play a real pattern first.
 *
 * @remarks
 * ## Design
 *
 * The sample sound is a **singleton** — one shared `AudioContext`,
 * oscillator graph, `AnalyserNode`, and virtual `PatternScheduler`.
 * Multiple viz previews pinning to `__sample__` all see the same FFT
 * data AND the same scheduler, which is what you want for "test the
 * viz with a known-stable audio source."
 *
 * ## Why an LFO-modulated sawtooth, specifically
 *
 * A pure sine at one frequency produces a single FFT spike that
 * doesn't move — the viz looks dead. A sawtooth produces a rich
 * harmonic series (multiple bins lit up), and modulating its frequency
 * with a slow LFO makes those bins shift over time. The result is a
 * visibly animated FFT without needing a complex score.
 *
 * ## Why a 4-note arpeggio for the virtual scheduler
 *
 * The pianoroll default (PIANOROLL_P5_CODE) polls
 * `stave.scheduler.query()` every frame and draws rectangles for the
 * returned events. Without a scheduler payload, the pianoroll shows
 * only the analyser spectrum — no notes. A minimal virtual pattern
 * lets users see their sketch respond to "pattern-like" data while
 * testing.
 *
 * The pattern is a 4-note A-minor arpeggio (A3, C4, E4, G4) with
 * each note holding for 0.5 seconds, cycling every 2 seconds — the
 * same period as the LFO sweep, so the visible note changes
 * roughly coincide with the audible pitch drift.
 *
 * ## Audibility
 *
 * The output routes to `ctx.destination` with a low gain (0.05) so the
 * user can actually HEAR the test audio. Most viz developers want to
 * hear what they're visualizing — muting it would require the user to
 * trust that audio is "there" purely on visual evidence. Setting a
 * low gain keeps it audible without being annoying.
 *
 * ## Lifecycle (user-driven)
 *
 *   - `start()` — lazy-initializes the AudioContext, oscillator graph,
 *     analyser, and scheduler on first call. No-op if already playing.
 *     Must be called from a user gesture (click handler) per browser
 *     autoplay policy.
 *   - `stop()` — disconnects nodes, unpublishes from the bus, closes
 *     the context. Called when the user selects a different source.
 *   - `isPlaying()` — query for UI state.
 *
 * ## Bus payload shape
 *
 * Publishes an `AudioPayload` with:
 *   - `analyser` — live FFT data from the oscillator
 *   - `audio: { analyser, audioCtx }` — nested component shape for
 *     consumers that read from `payload.audio`
 *   - `scheduler` — virtual `PatternScheduler` returning the arpeggio
 *   - `hapStream` — a fresh empty `HapStream`. The sample sound does
 *     NOT emit hap events in the current revision — event-driven
 *     sketches that subscribe via `hapStream.on()` see nothing. The
 *     field is populated for payload-shape completeness only.
 *
 * ## Identity guard interaction (D-01)
 *
 * The bus's identity guard (`payloadsEquivalent` in `WorkspaceAudioBus`)
 * treats same-ref publishes as no-ops. We publish ONCE on `start()`
 * with a stable payload — the live FFT data updates happen inside the
 * analyser node, not via re-publishing. The scheduler's `now()` reads
 * `ctx.currentTime` per call, so consumers get fresh time every frame
 * without needing a re-publish either.
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

/** Fixed source id the sample sound publishes under on the workspace bus. */
export const SAMPLE_SOUND_SOURCE_ID = '__sample__'

/** Human-readable label for the audio source dropdown. */
export const SAMPLE_SOUND_LABEL = 'Sample sound (test audio)'

/**
 * Virtual pattern constants. The cycle length MUST match the LFO
 * period (1 / lfo.frequency) so the note transitions align with the
 * visible pitch sweep in the analyser spectrum — gives a cohesive
 * audio ↔ visual correspondence even though the scheduler is
 * entirely synthetic and not actually driving the oscillator.
 */
const SAMPLE_PATTERN_CYCLE_SECONDS = 2 // matches lfo.frequency = 0.5
const SAMPLE_PATTERN_NOTE_DURATION = 0.5 // 4 notes per cycle

/** A-minor arpeggio: A3, C4, E4, G4. */
const SAMPLE_PATTERN_NOTES = [57, 60, 64, 67] as const

/**
 * Virtual `PatternScheduler` implementation for the sample sound.
 * Produces a repeating 4-note arpeggio in the AudioContext time
 * domain (seconds). `now()` reads `ctx.currentTime` so the values
 * stay in sync with the live audio without needing any re-publish.
 *
 * Exported for unit testing — the class only depends on an object
 * with a `currentTime: number` field, so tests can pass a stub in
 * place of a real `AudioContext`.
 */
export class SampleSoundScheduler implements PatternScheduler {
  constructor(private readonly ctx: { currentTime: number }) {}

  now(): number {
    return this.ctx.currentTime
  }

  query(begin: number, end: number): IREvent[] {
    if (end <= begin) return []
    const events: IREvent[] = []
    // Determine the cycle indices that overlap [begin, end). Use
    // Math.floor so negative times (pre-start queries) stay sound.
    const firstCycle = Math.floor(begin / SAMPLE_PATTERN_CYCLE_SECONDS)
    const lastCycle = Math.floor(end / SAMPLE_PATTERN_CYCLE_SECONDS)

    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      const cycleStart = cycle * SAMPLE_PATTERN_CYCLE_SECONDS
      for (let i = 0; i < SAMPLE_PATTERN_NOTES.length; i++) {
        const noteBegin = cycleStart + i * SAMPLE_PATTERN_NOTE_DURATION
        const noteEnd = noteBegin + SAMPLE_PATTERN_NOTE_DURATION
        // Include if the note's window overlaps the query window.
        if (noteEnd <= begin || noteBegin >= end) continue
        const midi = SAMPLE_PATTERN_NOTES[i]
        events.push({
          begin: noteBegin,
          end: noteEnd,
          endClipped: noteEnd,
          note: midi,
          // freq = 440 * 2^((midi - 69) / 12). Precompute because
          // the renderer may prefer freq over note (e.g., pitch-axis
          // visualizations).
          freq: 440 * Math.pow(2, (midi - 69) / 12),
          s: SAMPLE_SOUND_SOURCE_ID,
          type: 'synth',
          gain: 1,
          velocity: 1,
          color: null,
          trackId: SAMPLE_SOUND_SOURCE_ID,
        })
      }
    }
    return events
  }
}

interface SampleSoundState {
  ctx: AudioContext
  osc: OscillatorNode
  lfo: OscillatorNode
  lfoGain: GainNode
  outGain: GainNode
  analyser: AnalyserNode
  scheduler: SampleSoundScheduler
  hapStream: HapStream
}

let state: SampleSoundState | null = null

/**
 * Start the sample sound. Lazy-initializes the AudioContext, oscillator
 * graph, and analyser on first call. Publishes a payload to the bus
 * under `SAMPLE_SOUND_SOURCE_ID` so any preview pinned to that id sees
 * live FFT data immediately. Safe to call multiple times — second and
 * later calls are no-ops.
 *
 * MUST be called from inside a user gesture handler. Browsers reject
 * `new AudioContext()` outside of click/touch/keydown handlers under
 * the autoplay policy, so tests and UI code should only invoke this
 * in response to a button press.
 */
export function startSampleSound(): void {
  if (state) return // already running

  const ctx = new AudioContext()

  // Main oscillator — sawtooth at A2 (110 Hz). The rich harmonic
  // content gives the analyser something to show across multiple bins.
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 110

  // LFO — slow sine sweep that modulates the main oscillator's
  // frequency by ±80 Hz at 0.5 Hz. Produces a visible "slide" in the
  // FFT bins over a 2-second period.
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.5

  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 80 // ±80 Hz swing around the base frequency
  lfo.connect(lfoGain)
  lfoGain.connect(osc.frequency)

  // Output gain — low enough to not be annoying, high enough to be
  // audibly present. The user is testing their viz; hearing the
  // test audio is part of the point.
  const outGain = ctx.createGain()
  outGain.gain.value = 0.05

  // Analyser — the live FFT source the viz reads from. fftSize of
  // 2048 gives 1024 frequency bins which is plenty for any shader
  // or sketch that samples a handful of bands.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.8

  // Graph: osc → outGain → destination (audible) AND osc → analyser.
  // Routing osc directly into the analyser (instead of tapping the
  // outGain) gives cleaner FFT data unaffected by the output gain.
  osc.connect(outGain)
  outGain.connect(ctx.destination)
  osc.connect(analyser)

  osc.start()
  lfo.start()

  // Virtual pattern scheduler (for pianoroll-style viz) + fresh
  // empty hap stream (for payload-shape completeness — no events
  // fire through it in this revision).
  const scheduler = new SampleSoundScheduler(ctx)
  const hapStream = new HapStream()

  state = { ctx, osc, lfo, lfoGain, outGain, analyser, scheduler, hapStream }

  // Publish to the bus. The analyser node and scheduler are stable
  // references — consumers read FFT data and call scheduler.now() /
  // scheduler.query() per-frame without needing a re-publish.
  const payload: AudioPayload = {
    analyser,
    scheduler,
    hapStream,
    audio: {
      analyser,
      audioCtx: ctx,
    },
  }
  workspaceAudioBus.publish(SAMPLE_SOUND_SOURCE_ID, payload)

  // Single-source-at-a-time playback: tell the coordinator this
  // source just started. Any other currently-registered playback
  // source (a pattern runtime, a different example source) gets
  // its stop callback invoked so the user only hears one thing
  // at a time.
  notifyPlaybackStarted(SAMPLE_SOUND_SOURCE_ID)
}

/**
 * Stop the sample sound. Disconnects the oscillator graph, unpublishes
 * from the bus, and closes the AudioContext. No-op if not running.
 * Consumers pinned to `__sample__` receive `null` on their next bus
 * callback and fall back to demo mode.
 */
export function stopSampleSound(): void {
  if (!state) return
  try {
    state.osc.stop()
    state.lfo.stop()
  } catch {
    // osc.stop() throws if already stopped — non-fatal during teardown.
  }
  try {
    state.osc.disconnect()
    state.lfo.disconnect()
    state.lfoGain.disconnect()
    state.outGain.disconnect()
    state.analyser.disconnect()
  } catch {
    // disconnect() throws if already disconnected — non-fatal.
  }
  // Clear hap stream subscribers before unpublishing so any viz still
  // holding a handler reference gets detached cleanly.
  state.hapStream.dispose()
  workspaceAudioBus.unpublish(SAMPLE_SOUND_SOURCE_ID)
  try {
    void state.ctx.close()
  } catch {
    // close() rejects if already closed — non-fatal.
  }
  state = null
  notifyPlaybackStopped(SAMPLE_SOUND_SOURCE_ID)
}

/** Query whether the sample sound is currently running. */
export function isSampleSoundPlaying(): boolean {
  return state !== null
}

// Eager registration with the playback coordinator so any OTHER
// source that starts playing can stop this one. `stopSampleSound`
// is idempotent (no-op if already stopped), so it's safe to leave
// registered across the module's lifetime. Module-level singleton
// → registration is also singleton.
registerPlaybackSource(
  SAMPLE_SOUND_SOURCE_ID,
  stopSampleSound,
  SAMPLE_SOUND_LABEL,
)
