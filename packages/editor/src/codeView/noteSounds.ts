/**
 * noteSounds.ts — which sound each note of a roll plays, when its `.sound(…)` is a
 * pattern of several (#2226), asked of Strudel.
 *
 * Apart from `./soundArg.ts` on purpose: this half loads `@strudel/core` (through
 * `./strudelMini/pattern.ts`), and `soundArg` is reached from the engine's graph
 * (the Mixer's strips), which must stay importable without it.
 */
import { playingCall, readChainMethod } from './chainMethod'
import type { ChunkInfo } from './chunkDetect'
import { readSoundArg } from './soundArg'
import { miniValuesAt } from './strudelMini/pattern'

/**
 * Calls that set a value on each note and leave its time alone. A call written between
 * the notes and their `.sound(…)` that is not one of these (`.fast(2)`, `.late(…)`)
 * moves the notes under the sound pattern, so where a note sits in the roll would no
 * longer say which sound it meets — and none is claimed (#2226).
 */
const VALUE_ONLY = new Set([
  'gain', 'velocity', 'pan', 'n', 'bank', 'room', 'size', 'delay', 'delaytime', 'delayfeedback',
  'lpf', 'hpf', 'cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release', 'clip', 'legato',
  'orbit', 'postgain', 'shape', 'crush', 'coarse', 'vowel', 'color', 'analog',
])

/** the passes of the roll a note's sound is read over: enough for `<a b c d>` under a bar of notes, and its double */
const SOUND_PASSES = 8

/** the sound a played value names: `piano`, or the `piano` of `piano:2` */
function playedName(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

/**
 * Which sounds each note of a roll plays (#2226), asked of Strudel. `onsets` are when the
 * notes begin, in cycles; the roll repeats every `span` cycles. Each entry lists the
 * names that note plays, in the order first heard over several passes: one when it
 * always plays the same sound, several when the sound changes under it from pass to
 * pass (`<piano gm_electric_guitar_muted>` under one bar of notes), none when a rest
 * in the sound pattern silences it.
 *
 * Null when there is nothing to tell apart or nothing can be said truthfully: the
 * argument is one name, is not notation Strudel plays, or a call that moves time sits
 * between the notes and the `.sound(…)` (see `VALUE_ONLY`).
 */
export function noteSounds(
  chunk: ChunkInfo,
  onsets: readonly number[],
  span: number,
  names: readonly string[] = ['sound', 's'],
): string[][] | null {
  const cur = readChainMethod(chunk, names)
  if (!cur || readSoundArg(cur.value).kind === 'one' || !(span > 0)) return null
  const at = chunk.chain.indexOf(playingCall(chunk, names)!)
  if (chunk.chain.slice(1, at).some((c) => !VALUE_ONLY.has(c.name))) return null
  const times: number[] = []
  for (const t of onsets) for (let k = 0; k < SOUND_PASSES; k++) times.push(t + k * span)
  let values: unknown[][]
  try {
    values = miniValuesAt(cur.value, times)
  } catch {
    return null
  }
  return onsets.map((_, i) => {
    const heard: string[] = []
    for (let k = 0; k < SOUND_PASSES; k++) {
      for (const v of values[i * SOUND_PASSES + k]) {
        const n = playedName(v)
        if (n !== null && !heard.includes(n)) heard.push(n)
      }
    }
    return heard
  })
}
