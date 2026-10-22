/**
 * pitch — Phase 20-12 α-6.
 *
 * Coverage:
 *   - note names read through the editor's one reader (#1928)
 *   - freqToMidi: A4 / A3 / A5 sanity
 *   - extractPitch: priority order across evt.note + evt.params.{note,n,freq}
 */

import { describe, it, expect } from 'vitest'
import type { IREvent } from '@stave/editor'
import { freqToMidi, extractPitch, pitchToY } from '../pitch'

function baseEvent(partial: Partial<IREvent> = {}): IREvent {
  return {
    begin: 0,
    end: 0.1,
    endClipped: 0.1,
    note: null,
    freq: null,
    s: null,
    gain: 1,
    velocity: 1,
    color: null,
    ...partial,
  }
}

describe('#1928 — a note name reads the way Strudel plays it', () => {
  const midiOf = (note: string) => extractPitch(baseEvent({ note }))?.midi ?? null
  it('c4 → 60, C4 → 60, C#5 → 73, Bb3 → 58, Bb-1 → 10', () => {
    expect([midiOf('c4'), midiOf('C4'), midiOf('C#5'), midiOf('Bb3'), midiOf('Bb-1')]).toEqual([60, 60, 73, 58, 10])
  })
  it('a sharp written with s, and a name with no octave, have a pitch (they had none before)', () => {
    expect(midiOf('cs3')).toBe(49)
    expect(midiOf('ds2')).toBe(39)
    expect(midiOf('g')).toBe(55)
    expect(midiOf('C')).toBe(48)
  })
  it('the same names through a chained .note() param', () => {
    expect(extractPitch(baseEvent({ params: { note: 'as3' } }))).toEqual({ source: 'params.note', midi: 58 })
  })
  it('a word that is not a note has no pitch', () => {
    expect(midiOf('xyz')).toBeNull()
    expect(midiOf('')).toBeNull()
  })
})

describe('20-12 α-6 — freqToMidi', () => {
  it('440 → 69 (A4)', () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 5)
  })
  it('220 → 57 (A3)', () => {
    expect(freqToMidi(220)).toBeCloseTo(57, 5)
  })
  it('880 → 81 (A5)', () => {
    expect(freqToMidi(880)).toBeCloseTo(81, 5)
  })
  it('non-positive freq → NaN (defensive)', () => {
    expect(freqToMidi(0)).toBeNaN()
    expect(freqToMidi(-440)).toBeNaN()
  })
})

describe('20-12 α-6 — extractPitch', () => {
  it('reads top-level evt.note (numeric)', () => {
    const evt = baseEvent({ note: 60 })
    expect(extractPitch(evt)).toEqual({ source: 'note', midi: 60 })
  })

  it('reads top-level evt.note (string)', () => {
    const evt = baseEvent({ note: 'c4' })
    expect(extractPitch(evt)).toEqual({ source: 'note', midi: 60 })
  })

  it('reads evt.params.note when top-level is null', () => {
    const evt = baseEvent({ note: null, params: { note: 'c4' } })
    expect(extractPitch(evt)).toEqual({ source: 'params.note', midi: 60 })
  })

  it('reads evt.params.n (numeric MIDI)', () => {
    const evt = baseEvent({ note: null, params: { n: 7 } })
    expect(extractPitch(evt)).toEqual({ source: 'params.n', midi: 7 })
  })

  it('preserves n: 0 (valid MIDI 0 = C-1) — not skipped by truthy guard', () => {
    const evt = baseEvent({ note: null, params: { n: 0 } })
    expect(extractPitch(evt)).toEqual({ source: 'params.n', midi: 0 })
  })

  it('reads evt.params.freq via freqToMidi', () => {
    const evt = baseEvent({ note: null, params: { freq: 440 } })
    const p = extractPitch(evt)
    expect(p?.source).toBe('params.freq')
    expect(p?.midi).toBeCloseTo(69, 5)
  })

  it('returns null when no pitch source present (percussive event)', () => {
    const evt = baseEvent({ note: null, params: {} })
    expect(extractPitch(evt)).toBeNull()
  })

  it('returns null when params is undefined and note is null', () => {
    const evt = baseEvent({ note: null })
    expect(extractPitch(evt)).toBeNull()
  })

  it('top-level evt.note wins over evt.params.note (priority order)', () => {
    const evt = baseEvent({ note: 'a4', params: { note: 'c4' } })
    expect(extractPitch(evt)).toEqual({ source: 'note', midi: 69 })
  })

  it('params.note wins over params.n (priority order)', () => {
    const evt = baseEvent({ note: null, params: { note: 'c4', n: 99 } })
    expect(extractPitch(evt)).toEqual({ source: 'params.note', midi: 60 })
  })

  it('params.n wins over params.freq (priority order)', () => {
    const evt = baseEvent({ note: null, params: { n: 7, freq: 440 } })
    expect(extractPitch(evt)).toEqual({ source: 'params.n', midi: 7 })
  })

  it('falls through to next source when string is unparseable', () => {
    const evt = baseEvent({ note: null, params: { note: 'xyz', n: 7 } })
    // params.note 'xyz' is not a note name → fall through to params.n.
    expect(extractPitch(evt)).toEqual({ source: 'params.n', midi: 7 })
  })

  it('non-numeric, non-string param value → fall through', () => {
    const evt = baseEvent({ note: null, params: { note: { foo: 'bar' }, n: 7 } as Record<string, unknown> })
    expect(extractPitch(evt)).toEqual({ source: 'params.n', midi: 7 })
  })
})

// ─── Phase 20-12 β-4 — pitchToY auto-fit ────────────────────────────────────

describe('20-12 β-4 — pitchToY auto-fit', () => {
  const band = { top: 100, height: 18 }
  const barHeight = 12

  it('single-pitch range (min === max) → bar centred in band', () => {
    const y = pitchToY(60, band, { min: 60, max: 60 }, barHeight)
    // padding=2, innerTop=102, innerHeight=18-4-12=2, midpoint=103.
    expect(y).toBe(103)
  })

  it('high pitch (max) maps near band TOP, low pitch (min) maps near band BOTTOM (DAW convention)', () => {
    const range = { min: 60, max: 72 }
    const yHigh = pitchToY(72, band, range, barHeight)
    const yLow = pitchToY(60, band, range, barHeight)
    // padding=2, innerTop=102, innerHeight=2.
    // t=1 → innerTop + (1-1)*innerHeight = innerTop = 102.
    // t=0 → innerTop + (1-0)*innerHeight = 102 + 2 = 104.
    expect(yHigh).toBe(102)
    expect(yLow).toBe(104)
    expect(yHigh).toBeLessThan(yLow)
  })

  it('linearity: midi midpoint maps to mid of band', () => {
    const range = { min: 60, max: 72 }
    const yMid = pitchToY(66, band, range, barHeight)
    const yHigh = pitchToY(72, band, range, barHeight)
    const yLow = pitchToY(60, band, range, barHeight)
    expect(yMid).toBeCloseTo((yHigh + yLow) / 2, 6)
  })

  it('returns band.top when band is too small for any mapping', () => {
    // band.height < 2*padding + barHeight → innerHeight ≤ 0 → flatline.
    const tinyBand = { top: 50, height: 8 }
    const y = pitchToY(60, tinyBand, { min: 50, max: 70 }, barHeight)
    expect(y).toBe(tinyBand.top)
  })
})
