/**
 * #1108 — windowed collection: reaching material past the first span.
 *
 * The decision this is built on: the period is a property of the SONG, detected
 * once over `[0, cap)`. Paging exists only on the branch where that failed, so a
 * window never re-detects — enforced here by `WindowAnalysis` having nowhere to
 * put a period.
 *
 * The hazard these arms exist for is lane MEMBERSHIP. `accumulateLanes` creates
 * a lane only from an onset inside the window, and the invariant that makes
 * that safe for the period trim (`displayPeriodRule` refusing a span that
 * empties a known lane, #1107) does not exist for a paged window.
 */
import { describe, it, expect } from 'vitest'
import {
  accumulateLanes,
  accumulateLanesInWindow,
  computeSections,
  computeSectionsInWindow,
  analyzeWindow,
} from '../songAnalysis'
import type { IREvent } from '../IREvent'

const ev = (begin: number, trackId: string): IREvent =>
  ({ begin, end: begin + 0.25, trackId, s: 'bd' }) as IREvent

describe('accumulateLanesInWindow (#1108)', () => {
  // THE REGRESSION CONTROL. `accumulateLanes` became a delegate; if that changed
  // its behaviour at all, every period verdict in the corpus moves. Asserted
  // against the shape it has always had rather than against the delegate.
  it('THE CONTROL ARM: the origin-0 case is unchanged, membership and order included', () => {
    const events = [ev(0, '$0'), ev(1, '$1'), ev(1, '$0'), ev(9, '$2')]
    const lanes = accumulateLanes(events, 4)

    // $2 sounds at cycle 9, outside [0,4) — absent, as it has always been.
    expect(lanes.map((l) => l.laneKey)).toEqual(['$0', '$1'])
    expect(lanes[0].onsetsByCycle).toEqual([1, 1, 0, 0])
    expect(lanes[1].onsetsByCycle).toEqual([0, 1, 0, 0])
    // And the delegate agrees with the function it replaced.
    expect(accumulateLanesInWindow(events, 0, 4)).toEqual(lanes)
  })

  it('indexes from the ORIGIN, not from zero', () => {
    const lanes = accumulateLanesInWindow([ev(256, '$0'), ev(258, '$0')], 256, 4)
    expect(lanes).toHaveLength(1)
    // index 0 IS cycle 256 — the array is window-relative by construction.
    expect(lanes[0].onsetsByCycle).toEqual([1, 0, 1, 0])
  })

  it('a PINNED lane silent through the window is an EMPTY ROW, not an absent one', () => {
    // The #1098 defect in its paging form: without the pin, a track playing
    // thousands of notes elsewhere draws exactly like one playing none.
    const lanes = accumulateLanesInWindow([ev(256, '$0')], 256, 4, ['$0', '$1'])
    expect(lanes.map((l) => l.laneKey)).toEqual(['$0', '$1'])
    expect(lanes[1].onsetsByCycle).toEqual([0, 0, 0, 0])

    // The control: WITHOUT the pin the silent lane vanishes. This is the arm
    // that proves the pin is doing something, rather than agreeing with a
    // default that would have produced the same rows anyway.
    const unpinned = accumulateLanesInWindow([ev(256, '$0')], 256, 4)
    expect(unpinned.map((l) => l.laneKey)).toEqual(['$0'])
  })

  it('a lane heard here but NOT pinned is appended — the pin is a floor, not a whitelist', () => {
    // The mirrored defect: a track entering at cycle 300 has no lane in window
    // 0, so a strict pin would hide it forever.
    const lanes = accumulateLanesInWindow([ev(300, '$9')], 256, 256, ['$0'])
    expect(lanes.map((l) => l.laneKey)).toEqual(['$0', '$9'])
    expect(lanes[1].onsetsByCycle[300 - 256]).toBe(1)
  })

  it('row ORDER follows the pin, so rows do not reorder as the user pages', () => {
    // Window 1 hears $1 before $0; unpinned that would flip the rows.
    const events = [ev(257, '$1'), ev(258, '$0')]
    expect(accumulateLanesInWindow(events, 256, 4).map((l) => l.laneKey)).toEqual(['$1', '$0'])
    expect(
      accumulateLanesInWindow(events, 256, 4, ['$0', '$1']).map((l) => l.laneKey),
    ).toEqual(['$0', '$1'])
  })
})

describe('computeSectionsInWindow (#1108)', () => {
  it('reads relative but emits ABSOLUTE bounds', () => {
    const lanes = accumulateLanesInWindow([ev(256, '$0'), ev(257, '$0')], 256, 4)
    const sections = computeSectionsInWindow(lanes, 256, 4)
    // Active for [256,258), silent for [258,260) — in song-absolute cycles,
    // which is what the ruler chips need to keep meaning absolute position.
    expect(sections).toEqual([
      { startCycle: 256, endCycle: 258, laneKeys: ['$0'] },
      { startCycle: 258, endCycle: 260, laneKeys: [] },
    ])
  })

  it('THE CONTROL ARM: the origin-0 case is unchanged', () => {
    const lanes = accumulateLanes([ev(0, '$0'), ev(1, '$0')], 4)
    expect(computeSections(lanes, 4)).toEqual(computeSectionsInWindow(lanes, 0, 4))
    expect(computeSections(lanes, 4)[0].startCycle).toBe(0)
  })
})

describe('analyzeWindow (#1108)', () => {
  it('collects ONLY its own band, in slices', async () => {
    const asked: Array<[number, number]> = []
    const result = await analyzeWindow(256, 16, {
      collectFn: (a, b) => {
        asked.push([a, b])
        return [ev(a, '$0')]
      },
      yieldFn: async () => {},
    })

    // Never reaches below the origin — the whole point of the band accessor.
    expect(Math.min(...asked.map(([a]) => a))).toBe(256)
    expect(Math.max(...asked.map(([, b]) => b))).toBe(272)
    // Contiguous, non-overlapping slices covering exactly the window.
    expect(asked[0][0]).toBe(256)
    for (let i = 1; i < asked.length; i++) expect(asked[i][0]).toBe(asked[i - 1][1])

    expect(result.originCycle).toBe(256)
    expect(result.spanCycles).toBe(16)
    expect(result.complete).toBe(true)
    expect(result.lanes[0].onsetsByCycle).toHaveLength(16)
  })

  it('a window carries no period — the type has nowhere to put one', async () => {
    const result = await analyzeWindow(256, 8, {
      collectFn: (a) => [ev(a, '$0')],
      yieldFn: async () => {},
    })
    // Guards the decision itself: if someone later widens the return type to
    // carry a period, this arm is where that shows up as a deliberate change.
    expect('periodCycles' in result).toBe(false)
    expect('reachedCap' in result).toBe(false)
  })

  it('an aborted window keeps its requested WIDTH and says it is incomplete', async () => {
    const signal = { aborted: true }
    const result = await analyzeWindow(256, 16, {
      collectFn: (a) => [ev(a, '$0')],
      yieldFn: async () => {},
      signal,
    })
    expect(result.complete).toBe(false)
    // Geometry must not silently shrink mid-page: the span is what was asked
    // for, and `complete` is the only thing that reports the shortfall.
    expect(result.spanCycles).toBe(16)
  })

  it('pins lane membership through to the accumulation', async () => {
    const result = await analyzeWindow(256, 8, {
      collectFn: (a) => (a === 256 ? [ev(256, '$0')] : []),
      yieldFn: async () => {},
      pinnedLaneKeys: ['$0', '$1'],
    })
    expect(result.lanes.map((l) => l.laneKey)).toEqual(['$0', '$1'])
    expect(result.lanes[1].onsetsByCycle.every((n) => n === 0)).toBe(true)
  })

  it('with no collector it yields an empty window rather than throwing', async () => {
    const result = await analyzeWindow(256, 8, { yieldFn: async () => {} })
    expect(result.lanes).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]).toEqual({ startCycle: 256, endCycle: 264, laneKeys: [] })
  })
})
