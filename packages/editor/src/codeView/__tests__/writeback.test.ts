import { describe, it, expect } from 'vitest'
import { formatNumber, normalizeEdits, type OffsetEdit } from '../writeback'

describe('formatNumber', () => {
  it('keeps integers bare', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(2)).toBe('2')
    expect(formatNumber(-1)).toBe('-1')
    expect(formatNumber(127)).toBe('127')
  })

  it('strips float noise from drag values', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3') // 0.30000000000000004
    expect(formatNumber(2.9999999)).toBe('3')
    expect(formatNumber(0.6)).toBe('0.6')
    expect(formatNumber(-1.5)).toBe('-1.5')
  })

  it('rounds to maxDecimals and trims trailing zeros', () => {
    expect(formatNumber(0.123456)).toBe('0.1235')
    expect(formatNumber(0.5, 2)).toBe('0.5')
    expect(formatNumber(0.125, 2)).toBe('0.13')
    expect(formatNumber(0.1, 2)).toBe('0.1')
  })

  it('handles non-finite defensively', () => {
    expect(formatNumber(NaN)).toBe('0')
    expect(formatNumber(Infinity)).toBe('0')
  })
})

describe('normalizeEdits', () => {
  it('sorts edits ascending by start offset', () => {
    const edits: OffsetEdit[] = [
      { range: [10, 12], text: 'b' },
      { range: [2, 4], text: 'a' },
      { range: [20, 21], text: 'c' },
    ]
    expect(normalizeEdits(edits).map((e) => e.text)).toEqual(['a', 'b', 'c'])
  })

  it('allows edits that touch at a point', () => {
    const edits: OffsetEdit[] = [
      { range: [2, 4], text: 'a' },
      { range: [4, 6], text: 'b' },
    ]
    expect(() => normalizeEdits(edits)).not.toThrow()
  })

  it('allows zero-width inserts between ranges', () => {
    const edits: OffsetEdit[] = [
      { range: [2, 4], text: 'a' },
      { range: [4, 4], text: '+' },
      { range: [4, 6], text: 'b' },
    ]
    expect(() => normalizeEdits(edits)).not.toThrow()
  })

  it('throws on overlapping ranges', () => {
    const edits: OffsetEdit[] = [
      { range: [2, 6], text: 'a' },
      { range: [4, 8], text: 'b' },
    ]
    expect(() => normalizeEdits(edits)).toThrow(/overlapping/)
  })

  it('throws on inverted ranges', () => {
    expect(() => normalizeEdits([{ range: [6, 2], text: 'x' }])).toThrow(/inverted/)
  })

  it('does not mutate the input array', () => {
    const edits: OffsetEdit[] = [
      { range: [10, 12], text: 'b' },
      { range: [2, 4], text: 'a' },
    ]
    const snapshot = edits.map((e) => e.text)
    normalizeEdits(edits)
    expect(edits.map((e) => e.text)).toEqual(snapshot)
  })
})
