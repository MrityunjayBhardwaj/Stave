import { describe, it, expect } from 'vitest'
import { noteToMidi as strudelNoteToMidi, isNote } from '@strudel/core'
import { noteToMidi } from './noteToMidi'
import { pitchToMidi } from '../codeView/notation/pitch'

/** What Strudel makes of a name: its number, or null where it refuses (or reads NaN). */
function strudel(name: string): number | null {
  if (!isNote(name)) return null
  const midi = strudelNoteToMidi(name)
  return Number.isFinite(midi) ? midi : null
}

// Every value in the 360-doc corpus where the old engine reader said null and
// Strudel plays a pitch (43 values, 7,564 haps, 49 docs — #1928).
const CORPUS_DRIFT = [
  'A', 'Ab', 'B', 'Bb', 'C', 'C#', 'D', 'E', 'Eb', 'F', 'F#', 'Fb', 'G', 'a', 'a#', 'as1', 'as2',
  'as3', 'as6', 'b', 'bb', 'c', 'c#', 'cs2', 'cs3', 'cs5', 'd', 'd#', 'ds1', 'ds2', 'ds3', 'e',
  'eb', 'f', 'fs1', 'fs2', 'fs3', 'fs5', 'g', 'gb', 'gs1', 'gs2', 'gs3',
]
// Where hand-written grammars part from Strudel's: flats written f, stacked
// accidentals, a letter that is also an accidental, negative and missing octaves.
const NEIGHBOURS = [
  'c3', 'eb4', 'f#2', 'ef3', 'bf2', 'css3', 'Bbb2', 'c#b3', 'ff', 'fb3', 'bs3', 'e#-1', 'c-1',
  'Bb-1', 'c10', 'c-', 'c3.5', 'h3', 'cx3', 'bd', 'sd', 'Em', 'Cmaj7', '0bb', '60', '', ' c3',
]

describe('#1928 — the one note-name reader is Strudel’s', () => {
  it.each([...CORPUS_DRIFT, ...NEIGHBOURS])('%j reads as Strudel reads it', (name) => {
    expect(noteToMidi(name)).toBe(strudel(name))
  })

  it('the corpus drift values all have a pitch (the old reader gave every one null)', () => {
    expect(CORPUS_DRIFT.filter((n) => noteToMidi(n) === null)).toEqual([])
    expect([noteToMidi('cs3'), noteToMidi('g'), noteToMidi('Fb')]).toEqual([49, 55, 52])
  })

  it('the hard neighbours give numbers, not just agreement on null', () => {
    expect([noteToMidi('ef3'), noteToMidi('css3'), noteToMidi('Bbb2'), noteToMidi('ff')]).toEqual([51, 50, 45, 52])
    expect([noteToMidi('c-'), noteToMidi('bd'), noteToMidi('60')]).toEqual([null, null, null])
  })

  it('numbers stay MIDI, rounded', () => {
    expect([noteToMidi(60), noteToMidi(60.4), noteToMidi(null)]).toEqual([60, 60, null])
  })

  it('the piano roll reads names through the same reader, and integer tokens as rows', () => {
    for (const name of [...CORPUS_DRIFT, ...NEIGHBOURS].filter((n) => !/^-?\d+$/.test(n))) {
      expect(pitchToMidi(name)).toBe(noteToMidi(name))
    }
    expect([pitchToMidi('60'), pitchToMidi('-7')]).toEqual([60, -7])
  })
})
