/**
 * drumVoices.ts — Logic-parity drum-voice identity for the Sequencer (#471).
 *
 * Logic's Step Sequencer labels each lane with a friendly voice NAME (Kick,
 * Snare, Hi-Hat…) and a per-voice COLOUR, not the raw sample token. This maps a
 * Strudel sample id to `{ label, color }` for that gutter + cell colouring.
 *
 * GROUNDED, not inferred: the voice list + colour families are read off the
 * reference image `artifacts/logic_pro/Apple-iPad-Logic-Pro-Step-Sequencer_screen.png`
 * (Kick magenta, Snare orange, Hi-Hat teal, Shaker purple, Conga/Tom green) and
 * the #471 mapping table. Tokens are the standard tidal drum-voice ids.
 *
 * The map is DATA — easy to extend. Any unmapped sound (or a `:variant`'d token
 * whose base isn't known) falls back to its RAW name + a neutral colour, so the
 * underlying mini is never hidden and nothing crashes. The lookup is by the
 * token's sample name (`sampleNameOf`, the head of the `s` tuple — `bd` for
 * `bd:3`); lanes stay keyed on the full sound elsewhere.
 */

import { sampleNameOf } from '../notation/parse'

export interface DrumVoice {
  /** friendly display name, e.g. `Kick` */
  label: string
  /** per-voice hex colour for the indicator dot + cells */
  color: string
}

/** neutral colour for an unmapped sound (no crash, no blank label). */
export const VOICE_FALLBACK_COLOR = '#9ca3af'

/**
 * Strudel sample id (base, no `:variant`) → friendly voice identity.
 * Colours follow the reference's per-family hues: kicks magenta, snares/claps
 * warm orange, hats teal/cyan, cymbals blue, shakers/cowbell purple, toms/perc
 * green. Aliases collapse onto the same voice (`sn`→Snare like `sd`).
 */
const VOICE_MAP: Record<string, DrumVoice> = {
  bd: { label: 'Kick', color: '#e0407f' },
  kick: { label: 'Kick', color: '#e0407f' },
  sd: { label: 'Snare', color: '#f97316' },
  sn: { label: 'Snare', color: '#f97316' },
  snare: { label: 'Snare', color: '#f97316' },
  rim: { label: 'Rim', color: '#f59e0b' },
  cp: { label: 'Clap', color: '#fb7185' },
  clap: { label: 'Clap', color: '#fb7185' },
  hh: { label: 'Hi-Hat', color: '#14b8a6' },
  hat: { label: 'Hi-Hat', color: '#14b8a6' },
  oh: { label: 'Open Hi-Hat', color: '#22d3ee' },
  cr: { label: 'Crash', color: '#38bdf8' },
  crash: { label: 'Crash', color: '#38bdf8' },
  rd: { label: 'Ride', color: '#60a5fa' },
  ride: { label: 'Ride', color: '#60a5fa' },
  sh: { label: 'Shaker', color: '#a855f7' },
  cb: { label: 'Cowbell', color: '#8b5cf6' },
  lt: { label: 'Low Tom', color: '#22c55e' },
  mt: { label: 'Mid Tom', color: '#84cc16' },
  ht: { label: 'High Tom', color: '#a3e635' },
  perc: { label: 'Perc', color: '#10b981' },
  tb: { label: 'Tambourine', color: '#d946ef' },
}

/**
 * Resolve a lane's sound token to its drum-voice identity, looked up by its sample
 * name (`bd` for `bd:3`); an unmapped name falls back to the RAW token (incl. its
 * variant) as the label, with a neutral colour.
 */
export function sampleVoice(sound: string): DrumVoice {
  const voice = VOICE_MAP[sampleNameOf(sound).toLowerCase()]
  if (voice) return voice
  return { label: sound, color: VOICE_FALLBACK_COLOR }
}

/**
 * Is this token a drum voice this map knows?
 *
 * Exported for `chordLanes.ts`, which needs the two vocabularies ordered rather
 * than merely consulted: `cb` is Cowbell here AND a legal C-flat chord in the
 * chord grammar, and it is the only such overlap in the 85 tokens of the
 * curated drum + instrument catalogues. A lane's tokens are sounds by default,
 * so where the two collide this map wins and a chord reading has to displace it.
 *
 * Deliberately asked of THIS map rather than of `sampleVoice`'s result: a
 * fallback label is byte-identical to the token it fell back from, so "did the
 * lookup hit?" cannot be recovered from the label ([[P512]]'s shape — a check
 * whose two outcomes read the same).
 */
export function isKnownDrumVoice(sound: string): boolean {
  return VOICE_MAP[sampleNameOf(sound).toLowerCase()] !== undefined
}
