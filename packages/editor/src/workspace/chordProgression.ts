/**
 * chordProgression — prebaked example audio source.
 *
 * A classic I-vi-IV-V chord progression in C major that viz tabs
 * can query AND hear. Each chord is held for 2 seconds, exposed
 * as three simultaneous `IREvent`s (root, third, fifth) so
 * polyphonic viz (chord wheels, harmony analyzers, voice-leading
 * displays) have real simultaneous notes to render.
 *
 * Audio is rendered ONCE per source start via `OfflineAudioContext`:
 * a single 8-second loop containing all four chords is synthesized
 * with 3 triangle oscillators per chord + ADSR envelopes, then
 * played on repeat via a looping `AudioBufferSourceNode`. Audio
 * and scheduler pattern are aligned by construction — both use
 * the same chord timing and the same MIDI notes.
 *
 * ## Pattern structure
 *
 *   Cycle length: 8 seconds (4 chords × 2 seconds each).
 *
 *   Chord sequence (I-vi-IV-V in C major):
 *     - Cmaj  = C4, E4, G4   (60, 64, 67)  at [0s, 2s)
 *     - Amin  = A3, C4, E4   (57, 60, 64)  at [2s, 4s)
 *     - Fmaj  = F3, A3, C4   (53, 57, 60)  at [4s, 6s)
 *     - Gmaj  = G3, B3, D4   (55, 59, 62)  at [6s, 8s)
 *
 *   Each note holds for the full 2-second duration of its chord.
 *   The `s` field is set to `chord-<root>` (e.g., 'chord-C',
 *   'chord-Am', 'chord-F', 'chord-G') so sketches can label
 *   chord regions differently from drum hits. `trackId` groups
 *   all voices within a single chord by the root symbol.
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
export const CHORD_PROGRESSION_SOURCE_ID = '__example_chords__'

/** Human-readable label for the audio source dropdown. */
export const CHORD_PROGRESSION_LABEL = 'Example: chord progression (I-vi-IV-V)'

const CHORD_DURATION = 2
const CYCLE_SECONDS = 8 // 4 chords × 2s

interface ChordDef {
  root: 'C' | 'Am' | 'F' | 'G'
  notes: readonly [number, number, number]
}

/**
 * The I-vi-IV-V progression in C major. Each chord entry lists
 * its three voices (root, third, fifth). The scheduler expands
 * these into `IREvent[]` with note onsets and ends anchored to
 * the chord's time window, and marks all three voices of a single
 * chord with the same `trackId` so consumers can group them.
 */
const CHORD_PROGRESSION: readonly ChordDef[] = [
  { root: 'C', notes: [60, 64, 67] },
  { root: 'Am', notes: [57, 60, 64] },
  { root: 'F', notes: [53, 57, 60] },
  { root: 'G', notes: [55, 59, 62] },
]

/**
 * Virtual `PatternScheduler` for the chord-progression example.
 * Exported for unit testing — accepts any `{ currentTime: number }`
 * stub in place of a real AudioContext.
 */
export class ChordProgressionScheduler implements PatternScheduler {
  constructor(private readonly ctx: { currentTime: number }) {}

  now(): number {
    return this.ctx.currentTime
  }

  query(begin: number, end: number): IREvent[] {
    if (end <= begin) return []
    const events: IREvent[] = []
    const firstCycle = Math.floor(begin / CYCLE_SECONDS)
    const lastCycle = Math.floor(end / CYCLE_SECONDS)

    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      const cycleStart = cycle * CYCLE_SECONDS
      for (let i = 0; i < CHORD_PROGRESSION.length; i++) {
        const chord = CHORD_PROGRESSION[i]
        const chordBegin = cycleStart + i * CHORD_DURATION
        const chordEnd = chordBegin + CHORD_DURATION
        // Skip chords that don't overlap the query window.
        if (chordEnd <= begin || chordBegin >= end) continue
        for (const midi of chord.notes) {
          events.push({
            begin: chordBegin,
            end: chordEnd,
            endClipped: chordEnd,
            note: midi,
            freq: 440 * Math.pow(2, (midi - 69) / 12),
            s: `chord-${chord.root}`,
            type: 'synth',
            gain: 1,
            velocity: 1,
            color: null,
            trackId: `chord-${chord.root}`,
          })
        }
      }
    }
    return events
  }
}

interface ChordProgressionState {
  ctx: AudioContext
  source: AudioBufferSourceNode
  gain: GainNode
  analyser: AnalyserNode
  scheduler: ChordProgressionScheduler
  hapStream: HapStream
}

let state: ChordProgressionState | null = null
/** Race-guard for parallel starts during the offline render window. */
let starting = false

/**
 * Render the 8-second chord progression loop into an `AudioBuffer`
 * via `OfflineAudioContext`. Each chord is 3 triangle oscillators
 * (root, third, fifth) with an ADSR envelope: 20ms attack, full
 * sustain through the chord body, 50ms release crossfading into
 * the next chord so there's no audible click between changes.
 *
 * Triangle waves give a warmer harmonic profile than pure sines
 * without being as bright as sawtooths, appropriate for sustained
 * chords that the user will hear for minutes at a time.
 */
async function renderChordLoopBuffer(): Promise<AudioBuffer> {
  const sampleRate = 44100
  const durationSeconds = 8 // matches CYCLE_SECONDS
  const offline = new OfflineAudioContext(
    1,
    sampleRate * durationSeconds,
    sampleRate,
  )

  const chordDuration = 2 // seconds per chord
  const attack = 0.02
  const release = 0.05
  const sustainLevel = 0.06 // per-voice gain — three voices sum, so keep low

  for (let i = 0; i < CHORD_PROGRESSION.length; i++) {
    const chord = CHORD_PROGRESSION[i]
    const chordStart = i * chordDuration
    const chordEnd = chordStart + chordDuration
    for (const midi of chord.notes) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const osc = offline.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const g = offline.createGain()
      // ADSR: silent → attack up to sustainLevel → hold → release down
      g.gain.setValueAtTime(0.0001, chordStart)
      g.gain.linearRampToValueAtTime(sustainLevel, chordStart + attack)
      g.gain.setValueAtTime(sustainLevel, chordEnd - release)
      g.gain.linearRampToValueAtTime(0.0001, chordEnd)
      osc.connect(g).connect(offline.destination)
      osc.start(chordStart)
      osc.stop(chordEnd + 0.01)
    }
  }

  return offline.startRendering()
}

/**
 * Start the chord progression source. Async — renders the audio
 * buffer via `OfflineAudioContext.startRendering()` (~30–80ms),
 * then plays it on repeat via a looping buffer source. Must be
 * called from a user gesture. Safe to call multiple times — the
 * `starting` race guard + `state` early-return handle both the
 * in-flight and already-running cases.
 */
export async function startChordProgression(): Promise<void> {
  if (state || starting) return
  starting = true
  try {
    const ctx = new AudioContext()
    const buffer = await renderChordLoopBuffer()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gain = ctx.createGain()
    gain.gain.value = 0.5
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    source.start()

    const scheduler = new ChordProgressionScheduler(ctx)
    const hapStream = new HapStream()
    state = { ctx, source, gain, analyser, scheduler, hapStream }

    const payload: AudioPayload = {
      analyser,
      scheduler,
      hapStream,
      audio: { analyser, audioCtx: ctx },
    }
    workspaceAudioBus.publish(CHORD_PROGRESSION_SOURCE_ID, payload)
    notifyPlaybackStarted(CHORD_PROGRESSION_SOURCE_ID)
  } finally {
    starting = false
  }
}

/**
 * Stop the chord progression source. Stops the buffer source,
 * disposes the hap stream, unpublishes, closes the AudioContext.
 * No-op if not running.
 */
export function stopChordProgression(): void {
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
  workspaceAudioBus.unpublish(CHORD_PROGRESSION_SOURCE_ID)
  try {
    void state.ctx.close()
  } catch {
    // close() rejects if already closed — non-fatal.
  }
  state = null
  notifyPlaybackStopped(CHORD_PROGRESSION_SOURCE_ID)
}

/** Query whether the chord progression source is running or starting. */
export function isChordProgressionPlaying(): boolean {
  return state !== null || starting
}

// Eager registration with the playback coordinator.
registerPlaybackSource(
  CHORD_PROGRESSION_SOURCE_ID,
  stopChordProgression,
  CHORD_PROGRESSION_LABEL,
)
