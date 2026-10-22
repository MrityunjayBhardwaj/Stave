/**
 * The shared onset collector (#1201) — the band rule and the key remap that
 * `analyzeSong` and `analyzeWindow` must both read through.
 *
 * ── WHY THIS FILE EXISTS, and why it could not exist before ─────────────────
 * The collector used to be a closure built inside `MusicalTimeline`'s analyze
 * effect. Nothing could reach it, so its most load-bearing line — the filter
 * that drops a hap `queryArc` returns from two adjacent bands — was pinned by
 * NOTHING. Measured directly before writing this: deleting that filter leaves
 * all 66 arms across the four specs that touch this wiring GREEN, while
 * silently changing the cycle fingerprints and therefore the detected period.
 *
 * Extracting the collector for paging's second caller is what made these
 * assertions writable. They are the coverage that break test proved absent.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  structuralWalk: () => [],
}))

import { createSongCollector } from '../songCollector'
import type { IREvent, PatternIR } from '@stave/editor'

/** A bare document — no `dollarPos`, so `buildLaneAnchors` yields an empty
 *  containment index and every hap falls through to the positional mapping. */
const IR = { tag: 'stack', tracks: [] } as unknown as PatternIR

function ev(begin: number, trackId?: string): IREvent {
  return {
    begin,
    end: begin + 0.25,
    endClipped: begin + 0.25,
    note: null,
    freq: null,
    s: 'bd',
    ...(trackId === undefined ? {} : { trackId }),
  } as unknown as IREvent
}

describe('the shared song collector — the band rule (#1201)', () => {
  it('drops a hap that STRADDLES the band boundary, so one onset is counted once', () => {
    // `queryArc` returns every hap OVERLAPPING the arc, so a hap beginning at
    // 3.5 comes back from BOTH [0,4) and [4,8). Analysis buckets by
    // floor(begin), so an unfiltered collector counts it in two cycles.
    const straddler = ev(3.5)
    const { collectFn } = createSongCollector(IR, {
      getTimelineEventsBand: () => [straddler],
    })

    const first = collectFn!(0, 4)
    const second = collectFn!(4, 8)

    expect(first).toHaveLength(1) // floor(3.5) === 3, inside [0,4)
    expect(second).toHaveLength(0) // and NOT again in [4,8)
  })

  it('keeps a hap in exactly the band its ONSET falls in, never the one it ends in', () => {
    const { collectFn } = createSongCollector(IR, {
      getTimelineEventsBand: () => [ev(7.9)], // ends at 8.15, inside [8,12)
    })
    expect(collectFn!(4, 8)).toHaveLength(1)
    expect(collectFn!(8, 12)).toHaveLength(0)
  })

  it('narrows the PREFIX accessor to the requested band', () => {
    // The fallback path asks for [0, endCycle) and must select the band out of
    // it — here the filter is doing the whole job, not deduplicating.
    const { collectFn } = createSongCollector(IR, {
      getTimelineEvents: () => [ev(0), ev(1), ev(5), ev(6)],
    })
    expect(collectFn!(4, 8).map((e) => e.begin)).toEqual([5, 6])
  })

  it('serves a window at a NON-ZERO origin — the paging case (#1201)', () => {
    // The whole point of the extraction: `analyzeWindow` asks for a band that
    // does not start at 0, through this same one definition.
    const seen: Array<[number, number]> = []
    const { collectFn } = createSongCollector(IR, {
      getTimelineEventsBand: (a, b) => {
        seen.push([a, b])
        return [ev(256), ev(300)]
      },
    })
    expect(collectFn!(256, 288).map((e) => e.begin)).toEqual([256])
    expect(seen).toEqual([[256, 288]]) // asked the BAND, not a prefix from 0
  })
})

describe('the shared song collector — what it reports about tracks (#1201)', () => {
  it('answers "unheard" from the CAPTURE key, recorded before the remap', () => {
    const { collectFn, hasUnheardTrack } = createSongCollector(IR, {
      getTimelineEventsBand: () => [ev(0, '$0')],
      getSongTrackIds: () => ['$0', '$1'],
    })

    expect(hasUnheardTrack!()).toBe(true) // nothing collected yet
    collectFn!(0, 4) // hears $0 only
    expect(hasUnheardTrack!()).toBe(true) // $1 still unheard
  })

  it('stops claiming an unheard track once every registered id has sounded', () => {
    const { collectFn, hasUnheardTrack } = createSongCollector(IR, {
      getTimelineEventsBand: () => [ev(0, '$0'), ev(1, '$1')],
      getSongTrackIds: () => ['$0', '$1'],
    })
    collectFn!(0, 4)
    expect(hasUnheardTrack!()).toBe(false)
  })

  it('stays SILENT about unheard tracks when no event source is threaded', () => {
    // A registered set with no collector would report every track unheard and
    // stall every document at the cap.
    const { collectFn, hasUnheardTrack } = createSongCollector(IR, {
      getSongTrackIds: () => ['$0'],
    })
    expect(collectFn).toBeUndefined()
    expect(hasUnheardTrack).toBeUndefined()
  })

  it('is PER RUN — a fresh collector has heard nothing', () => {
    const accessors = {
      getTimelineEventsBand: () => [ev(0, '$0')],
      getSongTrackIds: () => ['$0'],
    }
    const a = createSongCollector(IR, accessors)
    a.collectFn!(0, 4)
    expect(a.hasUnheardTrack!()).toBe(false)

    // A second run must not inherit the first's hearing, or a previous
    // document's onsets would decide this one's period.
    const b = createSongCollector(IR, accessors)
    expect(b.hasUnheardTrack!()).toBe(true)
  })
})
