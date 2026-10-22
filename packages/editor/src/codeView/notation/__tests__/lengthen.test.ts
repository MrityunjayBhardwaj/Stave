/**
 * lengthen.test.ts — making a pattern longer by whole bars (#1824).
 *
 * The expected spellings are the ones the mouse already edits correctly in the
 * real app (clicks in bar 2 of each landed in bar 2). What each result PLAYS is
 * asked of Strudel here, independently of the module's own check, so a rewrite
 * that spelled the right text but played something else would still go red.
 */
import { describe, it, expect } from 'vitest'
import { mini } from '@strudel/mini/mini.mjs'

import { appendEmptyBars, duplicateBar, lengthenOffers, appendBarsOffer } from '../lengthen'
import { parsePianoRoll, parseStepGrid } from '../parse'
import type { ChunkGain } from '../model'

/** onsets of `bars` cycles as `value@start` — what the pattern plays */
function plays(m: string, bars: number): string[] {
  return (mini(m) as unknown as { queryArc(a: number, b: number): Array<{ hasOnset(): boolean; value: unknown; whole: { begin: { valueOf(): number } } }> })
    .queryArc(0, bars)
    .filter((h) => h.hasOnset())
    .map((h) => `${String(h.value)}@${+h.whole.begin.valueOf()}`)
    .sort()
}

const MELODY = 'e4 d4 c4 d4 e4 e4 e4@2'
const CHORDS = '<[c3,e3,g3] [a2,c3,e3]>'

/** onsets of one bar, measured from that bar's downbeat */
function bar(m: string, n: number): string[] {
  return plays(m, n + 1)
    .filter((s) => +s.split('@')[1] >= n)
    .map((s) => s.replace(/@([\d.]+)$/, (_, t) => `@${+t - n}`))
}

describe('duplicateBar — click +: one more bar, continuing the pattern', () => {
  it('copies a one-bar melody into a second `<…>` bar, sounding the same', () => {
    const r = duplicateBar(MELODY, 1)
    expect(r).toEqual({ ok: true, mini: `<[${MELODY}] [${MELODY}]>` })
    if (!r.ok) return
    // same onsets over four cycles — the copy is inaudible until edited
    expect(plays(r.mini, 4)).toEqual(plays(MELODY, 4))
  })

  it('adds ONE bar per click: two clicks make three bars, not four', () => {
    const once = duplicateBar(MELODY, 1)
    if (!once.ok) throw new Error(once.reason)
    const twice = duplicateBar(once.mini, 2)
    expect(twice).toEqual({ ok: true, mini: `<[${MELODY}] [${MELODY}] [${MELODY}]>` })
    if (!twice.ok) return
    expect(plays(twice.mini, 6)).toEqual(plays(MELODY, 6))
  })

  it('continues a two-bar progression with its FIRST bar, then its second', () => {
    const C = '[c3,e3,g3]'
    const A = '[a2,c3,e3]'
    const three = duplicateBar(CHORDS, 2)
    expect(three).toEqual({ ok: true, mini: `<${C} ${A} ${C}>` })
    if (!three.ok) return
    // bar 3 plays what bar 1 plays
    expect(bar(three.mini, 2)).toEqual(bar(CHORDS, 0))
    const four = duplicateBar(three.mini, 3)
    expect(four).toEqual({ ok: true, mini: `<${C} ${A} ${C} ${A}>` })
    if (!four.ok) return
    // …and at four bars the progression plays exactly as it did at two
    expect(plays(four.mini, 8)).toEqual(plays(CHORDS, 8))
  })

  it('a pattern with no shorter repeat continues from its first bar', () => {
    expect(duplicateBar('<c3 e3 g3>', 3)).toEqual({ ok: true, mini: '<c3 e3 g3 c3>' })
  })

  it('REFUSES an alternation whose text is not one entry per bar', () => {
    // `a!2` is two bars written as one entry — which text is bar 2 is not the
    // splitter's to guess
    expect(bar('<c3!2 e3>', 1)).toEqual(bar('<c3!2 e3>', 0))
    const r = duplicateBar('<c3!2 e3>', 3)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/one entry per bar/)
    expect(duplicateBar('<c3 e3, g3 b3>', 2).ok).toBe(false)
  })

  it('REFUSES a pattern that changes from cycle to cycle, because `<…>` would change what it plays', () => {
    // The wrap is not neutral here, and Strudel says so: `<[c3 <e3 g3>] [c3 <e3 g3>]>`
    // plays e3 e3 g3 g3 where the original plays e3 g3 e3 g3.
    const naive = '<[c3 <e3 g3>] [c3 <e3 g3>]>'
    expect(plays(naive, 4)).not.toEqual(plays('c3 <e3 g3>', 4))
    const r = duplicateBar('c3 <e3 g3>', 2)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/plays differently from one cycle to the next/)
  })

  it('…and one that changes only in how LONG a note is: same notes, same starts, different ends (#1973)', () => {
    // every other cycle the note is cut to half its length. A comparison of bars by
    // what starts when would call the two cycles the same bar and copy the long one.
    const r = duplicateBar('<a [a ~]>', 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/plays differently from one cycle to the next/)
    // control: read as the two bars it is, the same pattern is continued
    expect(duplicateBar('<a [a ~]>', 2).ok).toBe(true)
  })

  it('REFUSES a pattern the grid draws shorter than it really is', () => {
    // told it is one bar, but it takes two to repeat — no rewrite of it can be
    // checked against what is on screen
    expect(duplicateBar('c3 <e3 g3>', 1).ok).toBe(false)
  })

  it('REFUSES a random pattern — each cycle rolls differently, so a copy is not the same bar', () => {
    expect(duplicateBar('bd*8?', 1).ok).toBe(false)
  })

  it("REFUSES what Strudel can't parse, rather than writing it", () => {
    expect(duplicateBar('bd [sd', 1).ok).toBe(false)
  })

  it('continues a pattern in thirds — equal bars compare equal whatever the split', () => {
    // Every step lands on a third or a sixth of a cycle, which floating-point
    // subtraction does not measure the same in bar 1 as in bar 0 (#1829).
    expect(duplicateBar('c3 e3 g3', 1)).toEqual({ ok: true, mini: '<[c3 e3 g3] [c3 e3 g3]>' })
    expect(duplicateBar('c3 e3 g3 b3 c4 e4', 1).ok).toBe(true)
    expect(duplicateBar('<[c3 e3 g3] [c3 e3 g3 b3]>', 2)).toEqual({
      ok: true,
      mini: '<[c3 e3 g3] [c3 e3 g3 b3] [c3 e3 g3]>',
    })
    expect(appendEmptyBars('c3 e3 g3', 1, 1)).toEqual({ ok: true, mini: '<[c3 e3 g3] ~>' })
  })
})

describe('appendEmptyBars — drag +: silent bars after the pattern', () => {
  it('appends one empty bar to a one-bar melody', () => {
    const r = appendEmptyBars(MELODY, 1, 1)
    expect(r).toEqual({ ok: true, mini: `<[${MELODY}] ~>` })
    if (!r.ok) return
    // bar 1 is the melody, bar 2 is silent, then it starts again
    expect(plays(r.mini, 1)).toEqual(plays(MELODY, 1))
    expect(plays(r.mini, 2)).toEqual(plays(MELODY, 1))
    const shifted = plays(MELODY, 1).map((s) => s.replace(/@([\d.]+)$/, (_, t) => `@${+t + 2}`))
    expect(plays(r.mini, 3)).toEqual([...plays(MELODY, 1), ...shifted].sort())
  })

  it('appends to a progression after its last chord', () => {
    expect(appendEmptyBars(CHORDS, 2, 2)).toEqual({
      ok: true,
      mini: '<[c3,e3,g3] [a2,c3,e3] ~ ~>',
    })
  })

  it('refuses a count that is not a positive whole number of bars', () => {
    expect(appendEmptyBars(MELODY, 1, 0).ok).toBe(false)
    expect(appendEmptyBars(MELODY, 1, 1.5).ok).toBe(false)
  })

  it('REFUSES a pattern that changes from cycle to cycle', () => {
    expect(appendEmptyBars('c3 <e3 g3>', 2, 1).ok).toBe(false)
  })
})

describe("the `+` handle's offers: Strudel, then the velocity string, then the grid (#1942)", () => {
  const NO_GAIN: ChunkGain = { mini: null, numeric: null, foreign: false }

  it('offers both choices when Strudel and the grid both read them back', () => {
    const o = lengthenOffers(parsePianoRoll, 'c3 e3', 1, NO_GAIN)
    expect(o.duplicate).toEqual({ ok: true, mini: '<[c3 e3] [c3 e3]>' })
    expect(o.append).toEqual({ ok: true, mini: '<[c3 e3] ~>' })
    expect(appendBarsOffer(parsePianoRoll, 'c3 e3', 1, 3, NO_GAIN)).toEqual({ ok: true, mini: '<[c3 e3] ~ ~ ~>' })
  })

  it("Strudel's refusal comes through unchanged", () => {
    expect(lengthenOffers(parsePianoRoll, 'c3 e3', 1, NO_GAIN).duplicate).toEqual(duplicateBar('c3 e3', 1))
    const refused = duplicateBar('c3 <e3 g3>', 2)
    expect(refused.ok).toBe(false)
    expect(lengthenOffers(parsePianoRoll, 'c3 <e3 g3>', 2, NO_GAIN).duplicate).toEqual(refused)
  })

  it('a per-column .gain string refuses both, even where Strudel would agree', () => {
    const o = lengthenOffers(parsePianoRoll, 'c3 e3', 1, { mini: '0.5 1', numeric: null, foreign: false })
    expect(o.duplicate).toEqual({ ok: false, reason: expect.stringContaining('velocity lane') })
    expect(o.append).toEqual({ ok: false, reason: expect.stringContaining('velocity lane') })
    // CONTROL: a scalar .gain is not a per-column string, and does not refuse
    expect(lengthenOffers(parsePianoRoll, 'c3 e3', 1, { mini: null, numeric: 0.5, foreign: false }).duplicate.ok).toBe(true)
  })

  it("a rewrite the grid can't show at the new length is refused", () => {
    const opensAtOneBar = (m: string, s: number) => {
      const r = parseStepGrid(m, s)
      return r.ok ? { ...r, model: { ...r.model, bars: 1 } } : r
    }
    expect(lengthenOffers(opensAtOneBar, 'bd sn', 1, NO_GAIN).duplicate).toEqual({
      ok: false,
      reason: "the grid couldn't show the longer pattern",
    })
    // CONTROL: the real parser does show it
    expect(lengthenOffers(parseStepGrid, 'bd sn', 1, NO_GAIN).duplicate.ok).toBe(true)
  })
})
