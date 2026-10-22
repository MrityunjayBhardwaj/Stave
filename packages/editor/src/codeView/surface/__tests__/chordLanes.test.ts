/**
 * chordLanes — is a step grid holding chord symbols rather than sound names?
 *
 * ── WHAT THESE ARMS ARE FOR ──────────────────────────────────────────────
 * The predicate decides two things that both fail SILENTLY when it is wrong:
 * whether a melodic head's declined content falls through to the grid (#1243),
 * and whether the grid drops its drum chrome (#1241). Neither throws, neither
 * corrupts a document, and every downstream fidelity gate is green either way —
 * the same detection profile as the routing defect this sits next to ([[PV327]]).
 * So the arms have to pin the DISCRIMINATION, in both directions, on the real
 * vocabulary rather than on hand-picked shapes.
 *
 * The token lists below are not invented: they are the lane names measured off
 * the 57 vendored fixtures and 150 real tunes, plus the curated drum and
 * instrument catalogues this repo ships. A predicate that passed on made-up
 * tokens and failed on `breaks165` would be worse than none.
 */
import { describe, it, expect } from 'vitest'

import { chordLanes, isChordSymbol, forcesChordReading } from '../chordLanes'

describe('isChordSymbol reads the chord grammar', () => {
  it('recognises the chord spellings that appear in the corpora', () => {
    // Every one of these is a real lane name from a real document.
    for (const sym of ['Gsus', 'G7', 'Em7', 'D7', 'am', 'dm', 'em', 'Em11', 'Am9', 'C', 'G', 'F', 'Am']) {
      expect(isChordSymbol(sym), sym).toBe(true)
    }
  })

  it('rejects every drum voice the grid already knows', () => {
    for (const tok of ['bd', 'sd', 'hh', 'oh', 'cp', 'sn', 'rim', 'perc', 'lt', 'mt', 'ht', 'cr', 'rd', 'sh', 'tb', 'kick', 'snare', 'hat']) {
      expect(isChordSymbol(tok), tok).toBe(false)
    }
  })

  it('rejects instrument, sample and pick-key tokens', () => {
    // `sawtooth` is a synth waveform under `.gain`, `breaks165` a sample under
    // `.mask`, and the last three are `pick` keys — all measured, all reaching
    // the grid through the content fallback, none of them chords.
    for (const tok of ['sawtooth', 'square', 'triangle', 'sine', 'piano', 'breaks165', 'casio', 'fungi', 'polyrhythm', 'polymeter', 'both']) {
      expect(isChordSymbol(tok), tok).toBe(false)
    }
  })

  it('⚠ lets the DRUM vocabulary win the one collision: cb is Cowbell, not C-flat', () => {
    // The single overlap in 85 catalogue tokens. Without the precedence rule the
    // chord grammar answers "Cb major" and a cowbell lane starts claiming to be
    // a chord. This is the arm that fails if `isKnownDrumVoice` is dropped from
    // `isChordSymbol` — the rest of the file passes with it gone.
    expect(isChordSymbol('cb')).toBe(false)
  })

  it('strips a :variant only for the DRUM lookup, never for the chord read', () => {
    // `sd:3` is a sampled snare and must stay a sound…
    expect(isChordSymbol('sd:3')).toBe(false)
    // …while `C:major` is a SCALE. Stripping at the colon here would hand the
    // grammar a bare `C`, and a list of scales would silently be promoted into a
    // chord chart. Measured: `note(scales)` in `bakery-152-block-comment` is
    // exactly this shape, and it correctly does NOT convert.
    expect(isChordSymbol('C:major')).toBe(false)
    expect(isChordSymbol('D:minor')).toBe(false)
  })

  it('rejects prose, which the grid otherwise accepts as happily as a drum kit', () => {
    for (const tok of ['lorem', 'ipsum', 'dolor', 'sit']) {
      expect(isChordSymbol(tok), tok).toBe(false)
    }
  })
})

describe('chordLanes needs EVERY lane, not a majority', () => {
  it('accepts a chart whose lanes are all chords', () => {
    expect(chordLanes(['Gsus', 'G7', 'Em7', 'D7'])).toBe(true)
  })

  it('refuses a melody the roll declined over one stray token', () => {
    // `note("F# E D C# C Bm1 Am1 G")` — the roll refuses the whole string on
    // account of `Bm1`/`Am1`, and the grid would happily draw eight lanes with
    // one note each: right shape, wrong kind, invisible to every fidelity gate
    // downstream. All-lanes is what stops it, and this is the case it stops.
    expect(chordLanes(['F#', 'E', 'D', 'C#', 'C', 'Bm1', 'Am1', 'G'])).toBe(false)
  })

  it('refuses a drum kit carrying one chord-shaped token', () => {
    // Belt and braces against the `cb` collision: even with the precedence rule
    // removed, a real kit does not become a chord chart, because `bd`/`sd`/`hh`
    // are not chords under any reading.
    expect(chordLanes(['bd', 'sd', 'hh', 'cb'])).toBe(false)
  })

  it('refuses an empty grid rather than answering vacuously true', () => {
    // `[].every(...)` is true, which would make a lane-less model a chord chart
    // and drop the drum chrome from a grid that has not drawn anything yet.
    expect(chordLanes([])).toBe(false)
  })
})

/**
 * #1257 — the chord reading needs evidence, not merely permission.
 *
 * ⚠ EVERY ARM ABOVE THIS POINT PASSES WITH THE `some(forcesChordReading)` CLAUSE
 * DELETED. That is why this block exists and is stated rather than left for
 * someone to discover: the file it guards was fully green while a shaker line
 * captioned itself as a chord chart and lost its drum picker.
 */
describe('the chord reading has to be FORCED by a lane nothing else explains (#1257)', () => {
  it('a note spelling is not evidence of a chord, whatever its octave', () => {
    // The collision itself: the chord grammar reads a trailing digit as a
    // quality, so each of these IS a legal chord symbol and none of them is
    // evidence of one.
    for (const tok of ['a4', 'c4', 'c5', 'c6', 'c7', 'g7', 'd7', 'bb4', 'f#5', 'c', 'a', 'C']) {
      expect(isChordSymbol(tok), `${tok} is a legal chord symbol`).toBe(true)
      expect(forcesChordReading(tok), `${tok} must not be evidence`).toBe(false)
    }
  })

  it('a chord that is not also a note spelling IS evidence', () => {
    for (const tok of ['Gsus', 'Em7', 'Am9', 'Em11', 'am', 'dm', 'em']) {
      expect(forcesChordReading(tok), tok).toBe(true)
    }
  })

  it('⚠ the same music one octave apart used to get opposite answers', () => {
    // `c4 e4 g4` and `c3 e3 g3` are the same three notes in different registers.
    // Octave 4 is a sus4 to the chord grammar and octave 3 is nothing, so the
    // predicate answered true and false on identical music. Both are melodies.
    expect(chordLanes(['c4', 'e4', 'g4'])).toBe(false)
    expect(chordLanes(['c3', 'e3', 'g3'])).toBe(false)
  })

  it('the twelve real mislabelled lane sets, taken from the corpora', () => {
    // Every one of these is a real grid from a real document, and every one was
    // captioned "Chord chart — each lane is a chord, not a sound" before #1257.
    const melodies = [
      ['a4'], //                                   .sound("shaker_large"), twice over
      ['c5', 'f5', 'a5'], //                        gm_trumpet
      ['f4', 'a4', 'c5', 'f5', 'e5', 'd5', 'bb4', 'g4'],
      ['c5', 'bb4', 'a4', 'g4', 'f4'],
      ['a4', 'c5', 'f5', 'a5', 'g5', 'e5', 'g4'],
      ['a4', 'bb4', 'c5', 'd5', 'e5', 'f5'],
      ['f5', 'e5', 'd5', 'c5', 'bb4', 'a4'],
      ['f5', 'a5', 'c6', 'e5', 'd5', 'c5', 'f4'],
      ['c4', 'f4', 'a4', 'g4', 'e4', 'd4'],
      ['a4', 'g4'],
      ['a', 'b', 'c'], //                           sample names, not pitches and not chords
    ]
    for (const lanes of melodies) expect(chordLanes(lanes), JSON.stringify(lanes)).toBe(false)
  })

  it('and the three real charts keep their caption — the reason it exists', () => {
    // `<Gsus G7 Em7 D7>`, the lane set behind all three surviving captions.
    expect(chordLanes(['Gsus', 'G7', 'Em7', 'D7'])).toBe(true)
    // A progression with one unambiguous lane is still a chart; the clause asks
    // for ONE piece of evidence, not for every lane to carry it.
    expect(chordLanes(['am', 'F', 'C', 'G'])).toBe(true)
  })

  it('⚠ the stated limit: an all-ambiguous progression is NOT captioned', () => {
    // `<C F G>` is three major triads and three plausible sample names, and
    // nothing in the tokens can separate them. The default wins, which is this
    // module's own precedence rule rather than a gap in it. Pinned so that if
    // someone later decides differently, they change a test that says why.
    expect(chordLanes(['C', 'F', 'G'])).toBe(false)
  })
})
