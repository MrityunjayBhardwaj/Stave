/**
 * Convert a note name string or MIDI number to a MIDI note number.
 * Returns null if the input is unrecognized (e.g. percussion sample names).
 *
 * This is the one note-name reader (#1928). Its grammar is Strudel's own
 * (`@strudel/core` util.mjs `tokenizeNote` / `noteToMidi`), so a name means here
 * what it means to the sound: a letter, any run of accidentals from `#` `s`
 * (sharp) and `b` `f` (flat) that add up, and an optional octave that defaults
 * to 3. A test pins it to Strudel's function.
 *
 * Examples: "c3" → 48, "eb4" → 63, "cs3" → 49, "g" → 55, "ef3" → 51,
 * "Bbb2" → 45, "f#2" → 42, 60 → 60
 */
export function noteToMidi(note: unknown): number | null {
  if (typeof note === 'number') return Math.round(note)
  if (typeof note !== 'string') return null

  const m = note.match(/^([a-gA-G])([#bsf]*)(-?\d*)$/)
  if (!m) return null

  const [, letter, accidentals, octave] = m
  // Strudel reads a lone `-` as octave NaN; there is no row for that
  if (octave === '-') return null
  let offset = 0
  for (const a of accidentals) offset += a === '#' || a === 's' ? 1 : -1
  const oct = octave === '' ? DEFAULT_OCTAVE : parseInt(octave, 10)
  return (oct + 1) * 12 + SEMITONE_OF[letter.toLowerCase()] + offset
}

const SEMITONE_OF: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** A name with no octave sounds in octave 3: Strudel's `noteToMidi('c')` is 48 (#467). */
const DEFAULT_OCTAVE = 3
