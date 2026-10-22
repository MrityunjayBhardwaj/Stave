import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import type { IRPattern } from '../IRPattern'
import { merge, transpose, timestretch, filter, scaleGain } from '../transforms'

function event(begin: number, end: number, note: number, opts?: Partial<IREvent>): IREvent {
  return {
    begin, end, endClipped: end,
    note, freq: 440 * Math.pow(2, (note - 69) / 12), s: null,
    gain: 1, velocity: 1, color: null,
    ...opts,
  }
}

function patternFrom(events: IREvent[], nowVal = 0): IRPattern {
  return {
    now: () => nowVal,
    query: (begin, end) => events.filter(e => e.begin < end && e.end > begin),
  }
}

describe('IR transforms', () => {
  describe('merge', () => {
    it('merges events from multiple patterns sorted by begin', () => {
      const p1 = patternFrom([event(0, 1, 60), event(2, 3, 64)])
      const p2 = patternFrom([event(0.5, 1.5, 67), event(1.5, 2.5, 72)])
      const merged = merge([p1, p2])
      const result = merged.query(0, 4)
      expect(result.map(e => e.begin)).toEqual([0, 0.5, 1.5, 2])
    })

    it('returns empty for empty patterns', () => {
      const merged = merge([patternFrom([]), patternFrom([])])
      expect(merged.query(0, 10)).toEqual([])
    })

    it('now() returns first pattern time', () => {
      const m = merge([patternFrom([], 5), patternFrom([], 10)])
      expect(m.now()).toBe(5)
    })
  })

  describe('transpose', () => {
    it('shifts numeric notes by semitones', () => {
      const events = [event(0, 1, 60), event(1, 2, 64)]
      const result = transpose(events, 7)
      expect(result[0].note).toBe(67)
      expect(result[1].note).toBe(71)
    })

    it('adjusts freq accordingly', () => {
      const events = [event(0, 1, 69)] // A4 = 440Hz
      const result = transpose(events, 12) // up one octave
      expect(result[0].freq).toBeCloseTo(880)
    })

    it('leaves string notes unchanged', () => {
      const events = [{ ...event(0, 1, 0), note: 'c4' as string | number | null }]
      const result = transpose(events, 5)
      expect(result[0].note).toBe('c4')
    })

    it('leaves null notes unchanged', () => {
      const events = [{ ...event(0, 1, 0), note: null, freq: null }]
      const result = transpose(events, 5)
      expect(result[0].note).toBeNull()
    })
  })

  describe('timestretch', () => {
    it('scales time positions', () => {
      const events = [event(1, 2, 60), event(3, 4, 64)]
      const result = timestretch(events, 2)
      expect(result[0].begin).toBe(2)
      expect(result[0].end).toBe(4)
      expect(result[1].begin).toBe(6)
      expect(result[1].end).toBe(8)
    })

    it('compresses with factor < 1', () => {
      const events = [event(4, 8, 60)]
      const result = timestretch(events, 0.5)
      expect(result[0].begin).toBe(2)
      expect(result[0].end).toBe(4)
    })
  })

  describe('filter', () => {
    it('filters by predicate', () => {
      const events = [
        event(0, 1, 60, { s: 'bd' }),
        event(1, 2, 64, { s: 'piano' }),
        event(2, 3, 60, { s: 'bd' }),
      ]
      const result = filter(events, e => e.s === 'bd')
      expect(result).toHaveLength(2)
      expect(result.every(e => e.s === 'bd')).toBe(true)
    })
  })

  describe('scaleGain', () => {
    it('multiplies gain clamped to 0-1', () => {
      const events = [event(0, 1, 60, { gain: 0.8 })]
      const result = scaleGain(events, 0.5)
      expect(result[0].gain).toBe(0.4)
    })

    it('clamps to 1', () => {
      const events = [event(0, 1, 60, { gain: 0.8 })]
      const result = scaleGain(events, 2)
      expect(result[0].gain).toBe(1)
    })

    it('clamps to 0', () => {
      const events = [event(0, 1, 60, { gain: 0.5 })]
      const result = scaleGain(events, -1)
      expect(result[0].gain).toBe(0)
    })
  })
})
