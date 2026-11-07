/**
 * Registry of built-in example audio sources.
 *
 * Each entry describes a module-level singleton audio source
 * (sample sound, drum pattern, chord progression) that the viz
 * chrome offers in its source dropdown alongside user-published
 * patterns. The registry is data-driven so adding a new example
 * just appends an entry — the dropdown picks it up automatically,
 * and so do every gesture path that needs to start/stop a
 * built-in (chrome click, dropdown change, tab close).
 *
 * ## Why a shared module
 *
 * Both `VizEditorChrome` (Stop click + dropdown change) and
 * `WorkspaceShell.handleTabClose` need to dispatch `stopIfRunning`
 * for the right built-in when the user pushes a "make it quiet"
 * gesture (click Stop, pick "none", × the preview tab). Without
 * a shared registry, each callsite would import three pairs of
 * start/stop functions and re-derive the routing logic. With the
 * registry, both callsites import the SAME data structure and
 * the routing is one-line lookup-by-id.
 *
 * Pattern runtime sources (Strudel/SonicPi tabs) are deliberately
 * NOT in this registry. They have their own pattern tab, their own
 * Play/Stop button, and their own runtime instance per tab — the
 * cross-tab "make it quiet" gestures must not reach into someone
 * else's tab.
 */

import {
  startSampleSound,
  stopSampleSound,
  isSampleSoundPlaying,
  SAMPLE_SOUND_SOURCE_ID,
  SAMPLE_SOUND_LABEL,
} from './sampleSound'
import {
  startDrumPattern,
  stopDrumPattern,
  isDrumPatternPlaying,
  DRUM_PATTERN_SOURCE_ID,
  DRUM_PATTERN_LABEL,
} from './drumPattern'
import {
  startChordProgression,
  stopChordProgression,
  isChordProgressionPlaying,
  CHORD_PROGRESSION_SOURCE_ID,
  CHORD_PROGRESSION_LABEL,
} from './chordProgression'

/**
 * One built-in example source. `startIfIdle` and `stopIfRunning`
 * are idempotent: safe to call when the source is already in the
 * target state. `startIfIdle` MUST be called from inside a user
 * gesture (click handler, change handler) so the browser's
 * autoplay policy accepts the AudioContext creation.
 */
export interface BuiltinExampleSource {
  readonly sourceId: string
  readonly label: string
  readonly startIfIdle: () => void
  readonly stopIfRunning: () => void
}

export const BUILTIN_EXAMPLE_SOURCES: readonly BuiltinExampleSource[] = [
  {
    sourceId: SAMPLE_SOUND_SOURCE_ID,
    label: SAMPLE_SOUND_LABEL,
    startIfIdle: () => {
      if (!isSampleSoundPlaying()) startSampleSound()
    },
    stopIfRunning: () => {
      if (isSampleSoundPlaying()) stopSampleSound()
    },
  },
  {
    sourceId: DRUM_PATTERN_SOURCE_ID,
    label: DRUM_PATTERN_LABEL,
    // Not guarded on "playing", which includes "starting": a start must reach a
    // render already under way, to take back a stop that came meanwhile.
    startIfIdle: () => {
      void startDrumPattern()
    },
    stopIfRunning: () => {
      if (isDrumPatternPlaying()) stopDrumPattern()
    },
  },
  {
    sourceId: CHORD_PROGRESSION_SOURCE_ID,
    label: CHORD_PROGRESSION_LABEL,
    startIfIdle: () => {
      void startChordProgression()
    },
    stopIfRunning: () => {
      if (isChordProgressionPlaying()) stopChordProgression()
    },
  },
]

/**
 * Set of all built-in source ids — useful for filtering pattern
 * sources out of the bus listing so they don't double-render in
 * the dropdown.
 */
export const BUILTIN_SOURCE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_EXAMPLE_SOURCES.map((s) => s.sourceId),
)

/**
 * Look up a built-in by its source id, or undefined if the id
 * isn't a built-in. Use from any callsite that has a sourceId
 * string and needs the start/stop functions.
 */
export function findBuiltinExampleSource(
  sourceId: string,
): BuiltinExampleSource | undefined {
  return BUILTIN_EXAMPLE_SOURCES.find((s) => s.sourceId === sourceId)
}
