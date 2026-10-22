/**
 * #1197 — the song collector's BAND vs PREFIX shapes.
 *
 * `analyzeSong`'s collector interface is band-limited, but until the engine
 * gained `getTimelineEventsBand` the app could only ask for `[0, endCycle)` and
 * filter down to the band. These arms pin the two properties that make the swap
 * a fix rather than a rewrite:
 *
 *   VERDICT (the control arm) — both collectors produce an IDENTICAL analysis.
 *     Without this the cost figure below would be comparing two different
 *     analyses, and a cheaper wrong answer is not an improvement.
 *   COST — the prefix shape queries dramatically more cycles for that same
 *     answer, and the band shape queries each cycle exactly once.
 *
 * Both arms drive the REAL `analyzeSong` loop rather than re-deriving its
 * hint/doubling/cap schedule here — a second copy of that schedule would agree
 * with itself while diverging from the code under test.
 */
import { describe, it, expect } from 'vitest'
import { analyzeSong } from '../songAnalysis'
import type { IREvent } from '../IREvent'

/**
 * An aperiodic song: one onset per cycle whose VALUE never repeats, so period
 * detection cannot resolve and the horizon runs all the way to the 256 cap.
 * That is the case #1108 is about and the case that costs the most to analyse.
 */
function onsetsIn(startCycle: number, endCycle: number): IREvent[] {
  const out: IREvent[] = []
  for (let c = Math.max(0, Math.floor(startCycle)); c < Math.ceil(endCycle); c++) {
    out.push({ begin: c, end: c + 0.25, trackId: '$0', s: 'bd', note: `n${c}` } as IREvent)
  }
  return out
}

interface ArmResult {
  readonly cyclesQueried: number
  readonly calls: number
  readonly periodCycles: number | null
  readonly horizonCycles: number
  readonly reachedCap: boolean
  readonly laneKeys: readonly string[]
  readonly onsetTotal: number
}

/** Run `analyzeSong` with a counting collector of the given shape. */
async function runArm(
  shape: 'prefix' | 'band',
  opts: { readonly ignoreStart?: boolean } = {},
): Promise<ArmResult> {
  let cyclesQueried = 0
  let calls = 0

  const collectFn = (startCycle: number, endCycle: number): IREvent[] => {
    calls += 1
    // The band the collector actually QUERIES — a prefix collector must ask
    // from 0 every time, which is the whole cost being measured.
    // `ignoreStart` is the break-test lever: a "band" accessor that quietly
    // drops its start argument behaves exactly like the prefix one.
    const queryFrom = shape === 'prefix' || opts.ignoreStart ? 0 : startCycle
    cyclesQueried += Math.max(0, Math.ceil(endCycle) - Math.floor(queryFrom))
    return onsetsIn(queryFrom, endCycle).filter((ev) => {
      // The attribution filter the production collector keeps on BOTH paths:
      // an onset belongs to the band containing `floor(begin)`, and queryArc
      // returns overlaps, so without this a straddling onset is counted twice.
      const c = Math.floor(ev.begin)
      return c >= startCycle && c < endCycle
    })
  }

  const result = await analyzeSong({} as never, { collectFn, yieldFn: async () => {} })
  return {
    cyclesQueried,
    calls,
    periodCycles: result.periodCycles,
    horizonCycles: result.horizonCycles,
    reachedCap: result.displaySpan.kind === 'capped',
    laneKeys: result.lanes.map((l) => l.laneKey),
    onsetTotal: result.lanes.reduce(
      (s, l) => s + l.onsetsByCycle.reduce((a, b) => a + b, 0),
      0,
    ),
  }
}

describe('song collector — band vs prefix (#1197)', () => {
  it('THE CONTROL ARM: both collector shapes produce an identical analysis', async () => {
    const prefix = await runArm('prefix')
    const band = await runArm('band')

    // Every field of the verdict, not just the period — a band that dropped or
    // duplicated onsets could keep `periodCycles` null while corrupting the
    // lane counts the heatmap is drawn from.
    expect(band.periodCycles).toBe(prefix.periodCycles)
    expect(band.horizonCycles).toBe(prefix.horizonCycles)
    expect(band.reachedCap).toBe(prefix.reachedCap)
    expect(band.laneKeys).toEqual(prefix.laneKeys)
    expect(band.onsetTotal).toBe(prefix.onsetTotal)

    // And the fixture really is the expensive case, or the cost arm below
    // would be measuring a short analysis that never grows.
    expect(band.reachedCap).toBe(true)
    expect(band.horizonCycles).toBe(256)
    expect(band.onsetTotal).toBe(256)
  })

  it('THE COST ARM: the band shape queries each cycle exactly once; the prefix shape re-queries the whole prefix', async () => {
    const prefix = await runArm('prefix')
    const band = await runArm('band')

    // Both make the SAME number of collector calls — the schedule is identical,
    // only the arc asked for differs. This is what rules out "the band arm is
    // cheaper because it ran a shorter analysis".
    expect(band.calls).toBe(prefix.calls)

    // A band collector queries the horizon exactly once, end to end.
    expect(band.cyclesQueried).toBe(256)

    // The prefix collector pays the sum of every slice's prefix. Pinned as an
    // exact figure rather than a ratio so a change to the hint/doubling/cap
    // schedule shows up here as a deliberate decision instead of drifting.
    expect(prefix.cyclesQueried).toBe(8320)
    expect(prefix.cyclesQueried / band.cyclesQueried).toBeCloseTo(32.5, 5)
  })

  it('THE BREAK TEST: a band accessor that ignores its start argument reads as the prefix path', async () => {
    // Proves the cost arm has teeth. If `getTimelineEventsBand` were wired to
    // `queryArc(0, end)` — the easiest possible mistake, and invisible in every
    // verdict assertion — the cost arm reddens...
    const broken = await runArm('band', { ignoreStart: true })
    expect(broken.cyclesQueried).toBe(8320)

    // ...while the verdict stays exactly right, which is precisely why the
    // verdict arm alone could never catch it.
    const band = await runArm('band')
    expect(broken.periodCycles).toBe(band.periodCycles)
    expect(broken.horizonCycles).toBe(band.horizonCycles)
    expect(broken.onsetTotal).toBe(band.onsetTotal)
  })

  it('an onset straddling a band boundary is counted once, not once per overlapping band', async () => {
    // queryArc returns every hap OVERLAPPING the arc, so a hap beginning at 3.5
    // comes back from both [0,4) and [4,8). The attribution filter is what keeps
    // it in one bucket; this arm pins that, since deleting the filter as
    // "redundant with the band" is the natural next cleanup.
    const straddler: IREvent = { begin: 3.5, end: 4.5, trackId: '$0', s: 'bd' } as IREvent
    let seen = 0
    const collectFn = (startCycle: number, endCycle: number): IREvent[] => {
      // Every band that the straddler overlaps returns it, as queryArc would.
      const overlaps = straddler.begin < endCycle && straddler.end > startCycle
      const raw = overlaps ? [straddler] : []
      return raw.filter((ev) => {
        const c = Math.floor(ev.begin)
        return c >= startCycle && c < endCycle
      })
    }
    const counting = (startCycle: number, endCycle: number): IREvent[] => {
      const got = collectFn(startCycle, endCycle)
      seen += got.length
      return got
    }

    const result = await analyzeSong({} as never, {
      collectFn: counting,
      yieldFn: async () => {},
    })

    // Collected exactly once despite overlapping two adjacent 4-cycle bands.
    expect(seen).toBe(1)
    const total = result.lanes.reduce(
      (s, l) => s + l.onsetsByCycle.reduce((a, b) => a + b, 0),
      0,
    )
    expect(total).toBe(1)
  })
})
