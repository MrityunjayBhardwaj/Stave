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
import { miniPattern, miniValuesAt } from './strudelMini/pattern'
import { miniShape, type MiniGroup, type MiniSpan } from './strudelMini/shape'
import type { OffsetEdit } from './writeback'

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

/**
 * The playing sound call's string, when the roll's columns are its time: null when it is
 * absent or not a plain string, or when a call that moves time sits between the notes
 * and it (see `VALUE_ONLY`).
 */
function soundInRollTime(chunk: ChunkInfo, names: readonly string[]) {
  const cur = readChainMethod(chunk, names)
  if (!cur) return null
  const at = chunk.chain.indexOf(playingCall(chunk, names)!)
  return chunk.chain.slice(1, at).some((c) => !VALUE_ONLY.has(c.name)) ? null : cur
}

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
  const cur = soundInRollTime(chunk, names)
  if (!cur || readSoundArg(cur.value).kind === 'one' || !(span > 0)) return null
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

/** one sound of the sound lane: when it plays, in cycles from the roll's start, and where it is written */
export interface SoundBlock {
  begin: number
  end: number
  name: string
  /** where the name is written, inside the literal's quotes; null when Strudel does not say */
  at: MiniSpan | null
}

/**
 * The sound lane under a roll (#2226): the sound pattern drawn as its own row, with its
 * own divisions, over the roll's `span` cycles — what Strudel plays, never re-derived.
 *
 * `readOnly` says why there are no blocks: a picture of one pass would be wrong when the
 * sounds are chosen at random, when several play at once, or when the pattern takes
 * longer than the roll to come round. Null when the track has no sound pattern to draw:
 * one sound (however written), no call, not notation, or the roll's columns are not its time.
 */
export function soundLane(
  chunk: ChunkInfo,
  span: number,
  names: readonly string[] = ['sound', 's'],
): { blocks: SoundBlock[]; readOnly?: string } | null {
  const cur = soundInRollTime(chunk, names)
  const arg = cur ? readSoundArg(cur.value) : null
  // one sound, however it is written (`"piano*2"`), has nothing to tell apart
  if (!cur || !arg || arg.kind === 'one' || arg.names.length < 2 || !(span > 0)) return null
  const body = cur.value
  if (isRandom(miniShape(body))) {
    return { blocks: [], readOnly: 'These sounds are chosen at random as it plays, so the lane can’t draw them — change them in the code.' }
  }
  let pass: SoundBlock[][]
  try {
    const pat = miniPattern(body)
    pass = [0, 1].map((k) => {
      const out: SoundBlock[] = []
      for (let c = 0; c < span; c++) {
        for (const h of pat.hits(k * span + c)) {
          const name = playedName(h.value)
          if (name === null) continue
          const at = h.locations.find((l) => body.slice(l.start, l.end) === name) ?? null
          out.push({ begin: h.begin.valueOf() - k * span, end: h.end.valueOf() - k * span, name, at })
        }
      }
      return out
    })
  } catch {
    return null
  }
  const [blocks, next] = pass
  const key = (b: SoundBlock) => `${b.begin.toFixed(9)}:${b.end.toFixed(9)}:${b.name}`
  if (blocks.map(key).join() !== next.map(key).join()) {
    return { blocks: [], readOnly: 'These sounds take longer than these notes to come round, so the lane can’t draw them here — change them in the code.' }
  }
  const sorted = [...blocks].sort((a, b) => a.begin - b.begin)
  if (sorted.some((b, i) => i > 0 && b.begin < sorted[i - 1].end - 1e-9)) {
    return { blocks: [], readOnly: 'These sounds play more than one at a time, so one lane can’t draw them — change them in the code.' }
  }
  return { blocks: sorted }
}

/** a `|` random choice, or a `?` that drops steps at random */
function isRandom(g: MiniGroup): boolean {
  if (g.alignment === 'rand') return true
  return g.children.some((c) =>
    c.kind === 'group'
      ? isRandom(c)
      : c.ops.some((o) => o.kind === 'degradeBy') || (c.content.kind === 'group' && isRandom(c.content)),
  )
}

/**
 * The edit that makes one block of the sound lane play `value` (#2226): its name, where
 * it is written, and nothing else. Refused when the code moved under the lane (the name
 * is not where the block says), or when `value` would not read back as one name.
 */
export function soundBlockEdit(
  fresh: ChunkInfo,
  block: SoundBlock,
  value: string,
  names: readonly string[] = ['sound', 's'],
): { edit: OffsetEdit } | { refused: string } {
  const cur = readChainMethod(fresh, names)
  if (!cur || !block.at || cur.value.slice(block.at.start, block.at.end) !== block.name) {
    return { refused: 'The sound pattern changed under the lane, so nothing was written.' }
  }
  const asAtom = readSoundArg(value)
  if (asAtom.kind !== 'one' || asAtom.name !== value) {
    return { refused: `"${value}" can't be written inside this sound pattern as it stands, so change it in the code.` }
  }
  const lit = cur.range[0] + 1 // the literal's body starts after its opening quote
  return { edit: { range: [lit + block.at.start, lit + block.at.end], text: value } }
}
