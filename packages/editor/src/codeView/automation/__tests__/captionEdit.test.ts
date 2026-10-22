/**
 * What an automation lane's caption WRITES (#1464, #1610, #1611, #1613; moved here
 * with the builders by #1886).
 *
 * This is where a wrong answer reaches the user's document, so the tests are
 * written as the properties `captionEdit` exists to enforce — the rounding cannot
 * escape, an unchanged field writes nothing, an unspelled leg inserts rather than
 * replaces — because each is a silent corruption if it regresses, not a visible one.
 *
 * The caption's text, geometry and hit-test are the timeline's and are tested there
 * (`automationCaption.test.ts` in the app), along with the path from a drawn field
 * to one of these edits.
 */
import { describe, it, expect } from 'vitest'
import { captionEdit, rateEditable, shapeEdit, shapeOptions } from '../captionEdit'
import { parseStrudel } from '../../ir/parseStrudel'
import {
  signalAutomations,
  shapeAlternatives,
  crossClassShapes,
  type SignalAutomation,
} from '../../ir/signalAutomation'

const NO_SPANS = { shape: null, rate: null, range: null, chainEnd: null } as const

const auto = (over: Partial<SignalAutomation> = {}): SignalAutomation => ({
  trackId: 'd1', paramKey: 'cutoff', kind: 'sine', periodCycles: 1, lanePeriodCycles: 1,
  lo: 200, hi: 2000, ranged: true, boundsAsWritten: true, offset: 0, spans: NO_SPANS, placements: [[]], ...over,
})

describe('captionEdit — the three things it exists to enforce', () => {
  const RANGED = { shape: null, rate: null, range: { start: 30, end: 46 }, chainEnd: 46 }

  it('(1) the display\'s rounding cannot reach the document', () => {
    // The caption reads `0.3→1`; the document holds 0.30001. Editing the HIGH
    // bound must not rewrite the low one to the rounded string beside it.
    const a = auto({ lo: 0.30001, hi: 1, spans: RANGED })
    expect(captionEdit(a, 'hi', '2')).toEqual({
      range: [30, 46], text: '.range(0.30001,2)',
    })
  })

  it('(2) an unchanged field writes nothing — including a differently spelled same number', () => {
    const a = auto({ lo: 200, hi: 2000, spans: RANGED })
    expect(captionEdit(a, 'lo', '200')).toBeNull()
    expect(captionEdit(a, 'lo', '200.0')).toBeNull()
    expect(captionEdit(a, 'lo', ' 200 ')).toBeNull()
  })

  it('(3) a leg the document does not spell INSERTS at chainEnd rather than replacing', () => {
    // `pan ~0→1` — the bounds are this code's, not the document's, so there is
    // no `.range()` to overwrite.
    const a = auto({ paramKey: 'pan', lo: 0, hi: 1, ranged: false,
      spans: { shape: null, rate: null, range: null, chainEnd: 21 } })
    expect(captionEdit(a, 'hi', '0.8')).toEqual({
      range: [21, 21], text: '.range(0,0.8)',
    })
  })

  it('refuses a non-numeric entry', () => {
    const a = auto({ spans: RANGED })
    expect(captionEdit(a, 'lo', 'loud')).toBeNull()
    expect(captionEdit(a, 'lo', '')).toBeNull()
  })

  it('refuses a bound that turns the curve over, or leaves it spanning nothing (#1613)', () => {
    const a = auto({ lo: 200, hi: 2000, spans: RANGED })
    expect(captionEdit(a, 'hi', '100')).toBeNull()   // hi below lo
    expect(captionEdit(a, 'hi', '200')).toBeNull()   // hi equal to lo
  })

  it('refuses when the automation has nowhere to write at all', () => {
    const a = auto({ ranged: false, spans: NO_SPANS })
    expect(captionEdit(a, 'hi', '0.5')).toBeNull()
  })

  it('the parameter name is a menu anchor, not a typed field', () => {
    const a = auto({ spans: RANGED })
    expect(captionEdit(a, 'param', 'gain')).toBeNull()
  })
})

describe('a range written high-to-low keeps its direction (#1613)', () => {
  const RANGED = { shape: null, rate: null, range: { start: 30, end: 46 }, chainEnd: 46 }
  const turned = auto({ kind: 'tri', lo: 0.7, hi: 0.3, spans: RANGED })

  it('can be retyped, and stays high-to-low', () => {
    expect(captionEdit(turned, 'hi', '0.1')).toEqual({ range: [30, 46], text: '.range(0.7,0.1)' })
    expect(captionEdit(turned, 'lo', '0.9')).toEqual({ range: [30, 46], text: '.range(0.9,0.3)' })
  })

  it('refuses a bound that would turn it over, or leave it spanning nothing', () => {
    expect(captionEdit(turned, 'hi', '0.8')).toBeNull()
    expect(captionEdit(turned, 'hi', '0.7')).toBeNull()
    // Control: the upright curve refuses the mirror of that, and takes its own direction.
    const upright = auto({ kind: 'tri', lo: 0.3, hi: 0.7, spans: RANGED })
    expect(captionEdit(upright, 'hi', '0.2')).toBeNull()
    expect(captionEdit(upright, 'hi', '0.9')).toEqual({ range: [30, 46], text: '.range(0.3,0.9)' })
  })

  it('a flat range has no direction yet, so it widens either way', () => {
    const flat = auto({ lo: 5, hi: 5, spans: RANGED })
    expect(captionEdit(flat, 'hi', '6')).toEqual({ range: [30, 46], text: '.range(5,6)' })
    expect(captionEdit(flat, 'hi', '4')).toEqual({ range: [30, 46], text: '.range(5,4)' })
  })
})

describe('bounds that are not the range call\'s arguments (#1610)', () => {
  const RANGED = { shape: null, rate: null, range: { start: 30, end: 46 }, chainEnd: 46 }
  const bipolar = auto({ kind: 'sine2', lo: -1600, hi: 2000, boundsAsWritten: false, spans: RANGED })
  const unipolar = auto({ lo: 200, hi: 2000, spans: RANGED })

  it('writes nothing even when asked for a bound, beside a control that writes', () => {
    expect(captionEdit(unipolar, 'hi', '3000')).toEqual({ range: [30, 46], text: '.range(200,3000)' })
    expect(captionEdit(bipolar, 'hi', '3000')).toBeNull()
  })
})

describe('rateEditable — whether a typed rate has somewhere honest to go', () => {
  const SLOWED = { shape: null, rate: { start: 20, end: 28 }, range: null, chainEnd: 40 }
  const UNSPELLED = { shape: null, rate: null, range: null, chainEnd: 40 }

  it('one spelled rate, or none and a place to insert one', () => {
    expect(rateEditable(auto({ periodCycles: 4, lanePeriodCycles: 4, spans: SLOWED }))).toBe(true)
    expect(rateEditable(auto({ spans: UNSPELLED }))).toBe(true)
  })

  it('not two composing rates, not a lane whose routes disagree, not a chain with no end', () => {
    expect(rateEditable(auto({ periodCycles: 2, lanePeriodCycles: 2, spans: UNSPELLED }))).toBe(false)
    expect(rateEditable(auto({ periodCycles: 4, lanePeriodCycles: null, spans: SLOWED }))).toBe(false)
    expect(rateEditable(auto({ spans: NO_SPANS }))).toBe(false)
  })
})

describe('captionEdit on the rate — what a typed number writes (#1464 Stage 3)', () => {
  const SLOWED = { shape: null, rate: { start: 20, end: 28 }, range: null, chainEnd: 40 }
  /** The fixture must be one the caption would offer a rate field on — else a `null`
   *  below would be the gate declining, not the rule under test. */
  const rated = (a: SignalAutomation): SignalAutomation => {
    if (!rateEditable(a)) throw new Error('no rate field on this fixture')
    return a
  }
  const spelled = auto({ periodCycles: 4, lanePeriodCycles: 4, spans: SLOWED })

  it('replaces the spelled rate with the typed bars', () => {
    expect(captionEdit(rated(spelled), 'rate', '8')).toEqual({ range: [20, 28], text: '.slow(8)' })
  })

  it('writes a whole-number speed-up as fast, and anything else as slow', () => {
    expect(captionEdit(rated(spelled), 'rate', '0.5')).toEqual({ range: [20, 28], text: '.fast(2)' })
    expect(captionEdit(rated(spelled), 'rate', '1.5')).toEqual({ range: [20, 28], text: '.slow(1.5)' })
    expect(captionEdit(rated(spelled), 'rate', '0.4')).toEqual({ range: [20, 28], text: '.slow(0.4)' })
  })

  it('divides the route\'s time change back out: 8 bars under a whole-track slow(2) writes slow(4)', () => {
    const a = auto({ periodCycles: 2, lanePeriodCycles: 4, spans: SLOWED })
    expect(captionEdit(rated(a), 'rate', '8')).toEqual({ range: [20, 28], text: '.slow(4)' })
  })

  it('inserts a rate the signal does not write, at chainEnd', () => {
    const a = auto({ lanePeriodCycles: 1, spans: { shape: null, rate: null, range: null, chainEnd: 40 } })
    expect(captionEdit(rated(a), 'rate', '4')).toEqual({ range: [40, 40], text: '.slow(4)' })
  })

  it('writes nothing for an unchanged, empty, zero, negative or non-numeric rate', () => {
    for (const typed of ['4', '4.0', ' 4 ', '', ' ', '0', '-2', 'fast']) {
      expect(captionEdit(rated(spelled), 'rate', typed), JSON.stringify(typed)).toBeNull()
    }
  })

  it('writes nothing it cannot spell exactly: 2 bars under a whole-track slow(3)', () => {
    const a = auto({ periodCycles: 1, lanePeriodCycles: 3, spans: SLOWED })
    expect(captionEdit(rated(a), 'rate', '2')).toBeNull()
    // Control: under the same slow, a number it can spell.
    expect(captionEdit(rated(a), 'rate', '6')).toEqual({ range: [20, 28], text: '.slow(2)' })
  })

  it('writes nothing that would read back as a different number of bars, even in few digits', () => {
    // Under a whole-track fast(5) a 0.25-cycle signal shows 0.05 bars. Typing 0.85 means
    // `.slow(4.25)`, six digits or fewer, but 4.25 × 0.2 reads back as 0.8500000000000001,
    // so the next edit would see a changed number the user never typed. Found by a search
    // over whole-track scales and typed bars, not by reasoning: the precision rule alone
    // lets 28,515 of 1,378,007 such inputs through.
    const a = auto({ periodCycles: 0.25, lanePeriodCycles: 0.25 * (1 / 5), spans: SLOWED })
    expect(captionEdit(rated(a), 'rate', '0.85')).toBeNull()
    // Control: under the same fast, a number that reads back exactly.
    expect(captionEdit(rated(a), 'rate', '1')).toEqual({ range: [20, 28], text: '.slow(5)' })
  })
})

describe('the rate field through the real parser: written, then read back (#1464 Stage 3)', () => {
  const apply = (src: string, e: { range: [number, number]; text: string }) => src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])
  const readOne = (src: string) => signalAutomations(parseStrudel(src) as never)[0]
  const retype = (src: string, typed: string): string | null => {
    const a = readOne(src)
    expect(a, `no automation read from ${src}`).toBeDefined()
    if (!rateEditable(a)) return null
    const edit = captionEdit(a, 'rate', typed)
    return edit && apply(src, edit)
  }

  it.each([
    ['a spelled slow', '$: s("bd*8").cutoff(saw.slow(4).range(200, 2000))', '8', '$: s("bd*8").cutoff(saw.slow(8).range(200, 2000))'],
    ['a spelled fast, sped up further', '$: s("bd*8").cutoff(sine.fast(2).range(200, 2000))', '0.25', '$: s("bd*8").cutoff(sine.fast(4).range(200, 2000))'],
    ['no rate at all', '$: s("bd*8").cutoff(saw.range(200, 2000))', '4', '$: s("bd*8").cutoff(saw.range(200, 2000).slow(4))'],
    ['under a whole-track slow', '$: s("bd*8").cutoff(saw.slow(4).range(200, 2000)).slow(2)', '4', '$: s("bd*8").cutoff(saw.slow(2).range(200, 2000)).slow(2)'],
  ])('%s: writes only the rate call, and reads back as the bars typed', (_label, src, typed, out) => {
    expect(retype(src, typed)).toBe(out)
    expect(readOne(out).lanePeriodCycles).toBe(Number(typed))
  })

  it('offers no field on two composing rates', () => {
    expect(retype('$: s("bd*8").cutoff(sine.slow(2).fast(4).range(200, 2000))', '4')).toBeNull()
  })
})

describe('the shape menu — what the caption\'s name offers and writes (#1464)', () => {
  const SRC = '$: s("bd*8").cutoff(saw.slow(4).range(200, 2000))'
  const readOne = (src: string) => signalAutomations(parseStrudel(src) as never)[0]
  const apply = (src: string, e: { range: [number, number]; text: string }) => src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

  it('offers the editor\'s alternatives where the document spells a shape, and none where it does not', () => {
    expect(shapeOptions(readOne(SRC))).toEqual([...shapeAlternatives('saw'), ...crossClassShapes('saw')])
    expect(shapeOptions(auto({ kind: 'saw', spans: NO_SPANS }))).toEqual([])
  })

  it('replaces the identifier and no other byte, and reads back as the new shape with the same bounds and rate', () => {
    const a = readOne(SRC)
    const edit = shapeEdit(a, 'tri', SRC)
    expect(edit).not.toBeNull()
    const out = apply(SRC, edit!)
    expect(out).toBe('$: s("bd*8").cutoff(tri.slow(4).range(200, 2000))')
    const back = readOne(out)
    expect({ kind: back.kind, lo: back.lo, hi: back.hi, period: back.periodCycles, lane: back.lanePeriodCycles })
      .toEqual({ kind: 'tri', lo: a.lo, hi: a.hi, period: a.periodCycles, lane: a.lanePeriodCycles })
  })

  it('writes nothing for the same shape, or a shape the editor does not offer', () => {
    const a = readOne(SRC)
    // Control first: an offered shape does write.
    expect(shapeEdit(a, 'sine', SRC)).not.toBeNull()
    // `perlin` is offered since #1611 — the menu, not this function, holds it until the
    // song length is said (`shapeMenuOptions`).
    expect(shapeEdit(a, 'perlin', SRC)).not.toBeNull()
    for (const next of ['saw', 'saw2', 'rand2', 'time', 'cutoff', '']) {
      expect(shapeEdit(a, next, SRC), next).toBeNull()
    }
  })

  it('writes nothing where the document spells no shape', () => {
    expect(shapeEdit(auto({ kind: 'saw', spans: NO_SPANS }), 'tri', SRC)).toBeNull()
  })

  it('#1611 — noise can be switched to a waveform', () => {
    const src = '$: s("bd*8").cutoff(perlin.slow(16).range(200, 2000))'
    const a = readOne(src)
    const edit = shapeEdit(a, 'sine', src)
    expect(apply(src, edit!)).toBe('$: s("bd*8").cutoff(sine.slow(16).range(200, 2000))')
  })

  it('writes nothing when the document moved under the open menu', () => {
    const a = readOne(SRC)
    // Two characters inserted before the curve: the captured offsets now land on `(s`.
    expect(shapeEdit(a, 'tri', `  ${SRC}`)).toBeNull()
    // Control: the same bytes at the same place still write.
    expect(shapeEdit(a, 'tri', SRC)).not.toBeNull()
  })
})
