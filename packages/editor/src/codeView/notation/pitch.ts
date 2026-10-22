/**
 * Note-token ↔ MIDI helpers for the piano roll's vertical axis.
 *
 * Reading a note name is not this file's job: `pitchToMidi` asks the one
 * note-name reader, the engine's `noteToMidi`, whose grammar is Strudel's
 * (`c3 = 48`, `eb4 = 63`, `cs3` and `ef3` and a bare `g` all read, #1928). Writing
 * emits `#`. Conversion only feeds row placement and newly-created notes; the
 * round-trip itself stores the token verbatim, so emission style never
 * threatens fidelity for existing notes.
 */
import { noteToMidi } from '../../engine/noteToMidi'

const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

/**
 * `c3` / `c#3` / `cs3` / `eb4` / `ef4` → MIDI number, or null if not a note token.
 * The octave is OPTIONAL — a bare name (`c`, `eb`, `f#`) defaults to octave 3,
 * matching Strudel (`note("c")` plays C3). A bare integer (`60`, `0`, `-7`)
 * maps to that row directly — `note("60")` is MIDI; `n("0")` is a degree/index.
 * Either way the number IS the row, and the verbatim token is what the
 * serializer writes back (#469).
 */
export function pitchToMidi(token: string): number | null {
  if (/^-?\d+$/.test(token)) return parseInt(token, 10)
  return noteToMidi(token)
}

/** MIDI number → canonical note token (sharps as `#`). Inverse of pitchToMidi. */
export function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${octave}`
}

/**
 * Display form of a MIDI pitch for the note bars (#605): the canonical token
 * with an uppercase letter — `C4`, `C#4`, `D3`. Distinct from `midiToPitch`,
 * whose lowercase token (`c4`) is what the serializer writes back to code; this
 * is for the eye only (matching the uppercase `cLabel` keyboard anchors).
 */
export function noteDisplayName(midi: number): string {
  const token = midiToPitch(midi)
  return token.charAt(0).toUpperCase() + token.slice(1)
}

/** Is this MIDI pitch a black key (for striping the roll's pitch rows)? */
export function isBlackKey(midi: number): boolean {
  return SHARP_NAMES[((midi % 12) + 12) % 12].includes('#')
}

/**
 * The C-octave label for the graphical keyboard (#430): `C3`, `C4`, … on every
 * C row (the convention anchor on a piano), `null` on every other row. Same
 * octave math as `midiToPitch`, so keyboard labels and note tokens never drift.
 */
export function cLabel(midi: number): string | null {
  if (((midi % 12) + 12) % 12 !== 0) return null
  return `C${Math.floor(midi / 12) - 1}`
}
