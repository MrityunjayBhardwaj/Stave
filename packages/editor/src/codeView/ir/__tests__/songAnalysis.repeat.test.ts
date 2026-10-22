/**
 * #1599 — the WHOLE-SONG repeat: the cycles after which every lane has come back
 * round, beside the display span, which stays the longest single lane (#488).
 *
 * The display span answers "how wide is the view"; a bounce needs "after how many
 * cycles does the audio repeat". For lanes of different lengths those differ —
 * a 4-cycle lane beside a 3-cycle lane views at 4 and repeats at 12 — and the
 * bounce offer used to read the view's number.
 *
 * The repeat is the LCM of the per-lane periods the analysis already detects. It
 * is exact: every lane's smallest period divides the song's, so their least
 * common multiple is it. Null wherever that cannot be vouched for — a lane with
 * no loop of its own, or an LCM past the cap — and a null leaves the bounce on
 * the display span it offered before.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeEvents, analyzeSong, wholeSongRepeat } from '../songAnalysis'

/** One onset per cycle on `lane`, carrying `note(c)` so the lane's period is the note's. */
function lane(name: string, cycles: number, note: (c: number) => number): IREvent[] {
  return Array.from({ length: cycles }, (_, c) => ({
    begin: c,
    end: c + 0.25,
    endClipped: c + 0.25,
    note: note(c),
    freq: null,
    s: name,
    gain: 1,
    velocity: 1,
    color: null,
    trackId: name,
  }))
}

const collectorOf = (events: IREvent[]) => (start: number, end: number) =>
  events.filter((e) => e.begin >= start && e.begin < end)

describe('wholeSongRepeat — the LCM of the per-lane periods (#1599)', () => {
  it('a 4-cycle lane beside a 3-cycle lane repeats at 12', () => {
    const events = [...lane('a', 24, (c) => c % 4), ...lane('b', 24, (c) => c % 3)]
    expect(wholeSongRepeat(events, 24, 256)).toBe(12)
  })

  it('lanes of one length repeat at that length', () => {
    const events = [...lane('a', 16, (c) => c % 4), ...lane('b', 16, (c) => (c + 1) % 4)]
    expect(wholeSongRepeat(events, 16, 256)).toBe(4)
  })

  it('a lane that divides another adds nothing — 2 inside 4 repeats at 4, not 8', () => {
    const events = [...lane('a', 16, (c) => c % 4), ...lane('b', 16, (c) => c % 2)]
    expect(wholeSongRepeat(events, 16, 256)).toBe(4)
  })

  it('is null when a lane has no loop of its own in the horizon', () => {
    const events = [...lane('a', 32, (c) => c % 4), ...lane('b', 32, (c) => c)]
    expect(wholeSongRepeat(events, 32, 256)).toBeNull()
  })

  it('is null when the LCM runs past the cap — never a number the audio does not repeat at', () => {
    const events = [...lane('a', 32, (c) => c % 7), ...lane('b', 32, (c) => c % 9)]
    expect(wholeSongRepeat(events, 32, 32)).toBeNull()
    // Control: the same lanes under a cap the LCM fits.
    expect(wholeSongRepeat(events, 32, 256)).toBe(63)
  })

  it('is null for no events', () => {
    expect(wholeSongRepeat([], 8, 256)).toBeNull()
  })
})

describe('SongAnalysis.repeatCycles — beside the display span, not instead of it (#1599)', () => {
  it('analyzeEvents: the view stays at the longest lane (4), the repeat is 12', () => {
    const a = analyzeEvents([...lane('a', 24, (c) => c % 4), ...lane('b', 24, (c) => c % 3)], 24)
    expect(a.periodCycles).toBe(4)
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 4 })
    expect(a.repeatCycles).toBe(12)
  })

  it('analyzeSong: the progressive horizon reports the same pair', async () => {
    const events = [...lane('a', 64, (c) => c % 4), ...lane('b', 64, (c) => c % 3)]
    const a = await analyzeSong(null, { collectFn: collectorOf(events), yieldFn: async () => {} })
    expect(a.periodCycles).toBe(4)
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 4 })
    expect(a.repeatCycles).toBe(12)
  })

  it('analyzeSong: lanes of one length keep repeat === period — nothing changes for them', async () => {
    const events = [...lane('a', 64, (c) => c % 4), ...lane('b', 64, (c) => (c * 3) % 4)]
    const a = await analyzeSong(null, { collectFn: collectorOf(events), yieldFn: async () => {} })
    expect(a.periodCycles).toBe(4)
    expect(a.repeatCycles).toBe(4)
  })

  it('analyzeSong: an aperiodic document has no repeat', async () => {
    const events = lane('a', 64, (c) => c)
    const a = await analyzeSong(null, { collectFn: collectorOf(events), capCycles: 16, yieldFn: async () => {} })
    expect(a.periodCycles).toBeNull()
    expect(a.repeatCycles).toBeNull()
  })

  it('a display span that does not divide the repeat gets no repeat — the view and the bounce cannot disagree', () => {
    // No production rule reaches this (the display span is a lane's own period,
    // which divides the LCM), but the period rule is a public seam the sweeps
    // inject candidates through. A rule answering 5 for lanes of 4 and 3 must not
    // be handed a 12-cycle repeat that is not a whole number of its own loops.
    const events = [...lane('a', 24, (c) => c % 4), ...lane('b', 24, (c) => c % 3)]
    const a = analyzeEvents(events, 24, false, () => 5)
    expect(a.periodCycles).toBe(5)
    expect(a.repeatCycles).toBeNull()
    // Control: the production rule on the same events keeps its 12.
    expect(analyzeEvents(events, 24).repeatCycles).toBe(12)
  })

  it('whenever it is a number, the repeat is a whole number of display spans', async () => {
    for (const [p, q] of [[4, 3], [6, 4], [5, 2], [8, 8], [2, 3]]) {
      const events = [...lane('a', 96, (c) => c % p), ...lane('b', 96, (c) => c % q)]
      const a = await analyzeSong(null, { collectFn: collectorOf(events), yieldFn: async () => {} })
      expect(a.repeatCycles, `${p}×${q}`).not.toBeNull()
      expect((a.repeatCycles as number) % (a.periodCycles as number), `${p}×${q}`).toBe(0)
    }
  })
})
