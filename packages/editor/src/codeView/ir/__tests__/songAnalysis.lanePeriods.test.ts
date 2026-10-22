/**
 * #1602 — `lanePeriods` and `previewRepeat`, the arithmetic, on hand-built analyses.
 * What the engine gives for real documents is `stepCount.engine.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { analyzeEvents, previewRepeat, type LanePeriod, type SongAnalysis } from '../songAnalysis'

const withLanes = (lanePeriods: LanePeriod[]): SongAnalysis => ({
  periodCycles: null,
  horizonCycles: 0,
  lanes: [],
  sections: [],
  displaySpan: { kind: 'horizon', cycles: 0 },
  repeatCycles: null,
  lanePeriods,
})

describe('previewRepeat', () => {
  const song = withLanes([
    { laneKey: 'kick', periodCycles: 4, restCycles: 4 },
    { laneKey: 'hat', periodCycles: 3, restCycles: 1 },
  ])

  it('combines the other lanes, this lane without its steps, and the new step periods', () => {
    expect(previewRepeat(song, 'hat', [2])).toBe(4)
    expect(previewRepeat(song, 'hat', [5])).toBe(20)
    expect(previewRepeat(song, 'hat', [3])).toBe(12)
  })

  it('counts every stepped parameter on the lane it is given', () => {
    expect(previewRepeat(song, 'hat', [2, 3])).toBe(12)
  })

  it('is null for an unknown lane, a lane with no loop, or a repeat past the cap', () => {
    expect(previewRepeat(song, 'bass', [2])).toBeNull()
    expect(previewRepeat(withLanes([{ laneKey: 'a', periodCycles: null, restCycles: 1 }, { laneKey: 'b', periodCycles: 2, restCycles: 2 }]), 'b', [2])).toBeNull()
    expect(previewRepeat(withLanes([{ laneKey: 'a', periodCycles: 2, restCycles: null }]), 'a', [2])).toBeNull()
    expect(previewRepeat(song, 'hat', [7], 16)).toBeNull()
    expect(previewRepeat(song, 'hat', [7], 28)).toBe(28)
  })
})

describe('lanePeriods on a direct analysis', () => {
  it('is empty with no events, and a direct caller with no IR gets rest === period', () => {
    expect(analyzeEvents([], 0).lanePeriods).toEqual([])
    const events = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({ begin: c, end: c + 0.5, trackId: 'a', s: c % 2 ? 'sd' : 'bd' }))
    expect(analyzeEvents(events as never, 8).lanePeriods).toEqual([{ laneKey: 'a', periodCycles: 2, restCycles: 2 }])
  })
})
