import { describe, it, expect, vi } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import {
  accumulateLanes,
  cycleFingerprints,
  detectPeriod,
  detectDisplayPeriod,
  computeSections,
  analyzeEvents,
  analyzeSong,
  displayPeriodRule,
  signalDimensionsOf,
  laneKeyOf,
} from '../songAnalysis'

// Minimal IREvent fixture — only the fields songAnalysis reads matter.
function ev(begin: number, lane: string, note: number | string | null = null): IREvent {
  return {
    begin,
    end: begin + 0.25,
    endClipped: begin + 0.25,
    note,
    freq: null,
    s: lane,
    gain: 1,
    velocity: 1,
    color: null,
    trackId: lane,
  }
}

describe('laneKeyOf', () => {
  it('prefers trackId, falls back to s, then $default', () => {
    expect(laneKeyOf({ ...ev(0, 'bd'), trackId: 'd1' })).toBe('d1')
    expect(laneKeyOf({ ...ev(0, 'bd'), trackId: undefined })).toBe('bd')
    expect(laneKeyOf({ ...ev(0, 'bd'), trackId: undefined, s: null })).toBe('$default')
  })
  it('treats an empty-string trackId as present (?? only falls through on null/undefined)', () => {
    expect(laneKeyOf({ ...ev(0, 'bd'), trackId: '' })).toBe('')
  })
})

describe('accumulateLanes', () => {
  it('buckets onsets per integer cycle in first-seen lane order', () => {
    const events = [ev(0, 'bd'), ev(0.5, 'bd'), ev(1, 'hh'), ev(0, 'hh')]
    const lanes = accumulateLanes(events, 2)
    expect(lanes.map((l) => l.laneKey)).toEqual(['bd', 'hh']) // first-seen
    expect(lanes[0].onsetsByCycle).toEqual([2, 0]) // bd: two in cycle 0
    expect(lanes[1].onsetsByCycle).toEqual([1, 1]) // hh: one each cycle
  })

  it('ignores events outside [0, horizon)', () => {
    const lanes = accumulateLanes([ev(-1, 'bd'), ev(5, 'bd'), ev(1, 'bd')], 2)
    expect(lanes[0].onsetsByCycle).toEqual([0, 1])
  })
})

describe('cycleFingerprints + detectPeriod', () => {
  it('detects a period-4 pattern (note varies by cycle % 4)', () => {
    const events: IREvent[] = []
    for (let c = 0; c < 8; c++) events.push(ev(c, 'bd', c % 4))
    expect(detectPeriod(cycleFingerprints(events, 8))).toBe(4)
  })

  it('detects period 1 when every cycle is identical', () => {
    const events: IREvent[] = []
    for (let c = 0; c < 6; c++) events.push(ev(c, 'bd', 60))
    expect(detectPeriod(cycleFingerprints(events, 6))).toBe(1)
  })

  it('returns null when no period repeats twice within the window', () => {
    const events: IREvent[] = []
    for (let c = 0; c < 8; c++) events.push(ev(c, 'bd', c)) // all distinct
    expect(detectPeriod(cycleFingerprints(events, 8))).toBeNull()
  })

  it('requires two full repetitions (a one-off prefix is not a period)', () => {
    // [a, b, a] — p=2 would need fp[0]===fp[2] (a===a ✓) but len(3) < 2*2,
    // so p=2 is out of range; p=1 fails (a!==b). No period.
    const events = [ev(0, 'bd', 1), ev(1, 'bd', 2), ev(2, 'bd', 1)]
    expect(detectPeriod(cycleFingerprints(events, 3))).toBeNull()
  })

  it('quantises within-cycle offset so float noise does not break matching', () => {
    const a = [ev(0.3333333, 'bd', 1), ev(1.3333334, 'bd', 1)]
    // both round to the same offset → period 1
    expect(detectPeriod(cycleFingerprints(a, 2))).toBe(1)
  })
})

describe('computeSections', () => {
  it('cuts a section wherever the active-lane set changes', () => {
    // cycles 0,1 = {bd}; cycles 2,3 = {bd, hh}
    const events = [
      ev(0, 'bd'),
      ev(1, 'bd'),
      ev(2, 'bd'),
      ev(2, 'hh'),
      ev(3, 'bd'),
      ev(3, 'hh'),
    ]
    const lanes = accumulateLanes(events, 4)
    const sections = computeSections(lanes, 4)
    expect(sections).toEqual([
      { startCycle: 0, endCycle: 2, laneKeys: ['bd'] },
      { startCycle: 2, endCycle: 4, laneKeys: ['bd', 'hh'] },
    ])
  })

  it('treats a silent run as its own empty-lane section', () => {
    const events = [ev(0, 'bd'), ev(2, 'bd')] // cycle 1 silent
    const lanes = accumulateLanes(events, 3)
    const sections = computeSections(lanes, 3)
    expect(sections.map((s) => [s.startCycle, s.endCycle, s.laneKeys.length])).toEqual([
      [0, 1, 1],
      [1, 2, 0],
      [2, 3, 1],
    ])
  })

  it('returns [] for a zero horizon', () => {
    expect(computeSections([], 0)).toEqual([])
  })
})

describe('analyzeEvents', () => {
  it('composes lanes + period + sections', () => {
    const events: IREvent[] = []
    for (let c = 0; c < 4; c++) {
      events.push(ev(c, 'bd', 60))
      if (c % 2 === 0) events.push(ev(c, 'hh', 70))
    }
    const a = analyzeEvents(events, 4)
    expect(a.horizonCycles).toBe(4)
    expect(a.periodCycles).toBe(2) // hh every other cycle → period 2
    expect(a.lanes.map((l) => l.laneKey)).toEqual(['bd', 'hh'])
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 2 })
  })

  it('uses the LONGEST single lane (max), not the global lcm, for differing lengths (#488)', () => {
    // Lane 'a' loops every 5; lane 'b' loops every 4. Global combined period
    // would be lcm(5,4)=20, but the DAW-idiomatic display span is the longest
    // single loop = 5 (the 4-cycle lane phases inside it).
    const events: IREvent[] = []
    for (let c = 0; c < 16; c++) {
      events.push(ev(c, 'a', c % 5))
      events.push(ev(c, 'b', c % 4))
    }
    // Global (lcm) detection can't even resolve at horizon 16 — it needs 2×lcm=40
    // cycles to confirm period 20; the per-lane max resolves at 2×5=10. Cheaper.
    expect(detectPeriod(cycleFingerprints(events, 16))).toBeNull()
    const a = analyzeEvents(events, 16)
    expect(a.periodCycles).toBe(5) // the NEW (max-track) basis
  })
})

describe('detectDisplayPeriod (#488 — max single-lane, not lcm)', () => {
  // Build events where each lane loops at its own period (note = cycle % p).
  const lanesOf = (specs: Array<[string, number]>, horizon: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = 0; c < horizon; c++) for (const [lane, p] of specs) out.push(ev(c, lane, c % p))
    return out
  }

  it('returns the MAX of per-lane periods (5 vs 4 → 5, not lcm 20)', () => {
    expect(detectDisplayPeriod(lanesOf([['a', 5], ['b', 4]], 16), 16)).toBe(5)
  })

  it('equals lcm when lengths are equal or divisible (no divergence)', () => {
    expect(detectDisplayPeriod(lanesOf([['a', 4], ['b', 4]], 16), 16)).toBe(4) // equal
    expect(detectDisplayPeriod(lanesOf([['a', 4], ['b', 2]], 16), 16)).toBe(4) // divisible
  })

  it('matches detectPeriod for a single lane', () => {
    const single = lanesOf([['a', 5]], 16)
    expect(detectDisplayPeriod(single, 16)).toBe(detectPeriod(cycleFingerprints(single, 16)))
  })

  it('returns null until every lane has looped twice within the horizon', () => {
    // Lane 'a' (period 5) needs ≥10 cycles to confirm; at horizon 8 it cannot.
    expect(detectDisplayPeriod(lanesOf([['a', 5], ['b', 4]], 8), 8)).toBeNull()
    // Grow to 16 → both resolve → 5.
    expect(detectDisplayPeriod(lanesOf([['a', 5], ['b', 4]], 16), 16)).toBe(5)
  })
})

describe('#2109 — at the limit, a lane that has not come round leaves the song "N+"', () => {
  const run = (collect: (s: number, e: number) => IREvent[], capCycles: number, ir: unknown = null) =>
    analyzeSong(ir as never, { collectFn: collect, yieldFn: async () => {}, capCycles })
  const lanes = (specs: Array<[string, number]>, lfo = false) => (s: number, e: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = s; c < e; c++) {
      for (const [lane, p] of specs) out.push(ev(c, lane, c % p))
      // A control that changes every cycle and never repeats — the real mechanism.
      if (lfo) out.push({ ...ev(c, 'lfo'), gain: 0.1 + c / 512 })
    }
    return out
  }

  it('a lane that never repeats beside one that loops: no loop inside the limit, not the loop beside it', async () => {
    // #1104 drew this as the 8-cycle loop, the never-repeating lane abstaining.
    const a = await run(lanes([['a', 8]], true), 64)
    expect(a.periodCycles).toBeNull()
    expect(a.displaySpan).toEqual({ kind: 'capped', cycles: 64 })
  })

  it('the control: with every lane coming round, the longest loop is the span', async () => {
    const a = await run(lanes([['hh', 4], ['pad', 12]]), 64)
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 12 })
  })

  it('a fast lane still cannot answer before a slow one resolves, below the cap', async () => {
    // `hh` confirms at 8, `pad` not until 24: the veto below the cap is what lets `pad`
    // resolve. With the never-repeating lane beside them the answer is "N+", not 4.
    const a = await run(lanes([['hh', 4], ['pad', 12]], true), 64)
    expect(a.displaySpan).toEqual({ kind: 'capped', cycles: 64 })
  })

  it('a loop is found once the limit holds it twice: 40 at a limit of 128, "N+" at 64', async () => {
    expect((await run(lanes([['pad', 40]]), 128)).displaySpan).toEqual({ kind: 'loop', cycles: 40 })
    expect((await run(lanes([['pad', 40]]), 64)).displaySpan).toEqual({ kind: 'capped', cycles: 64 })
  })

  it('an arrangement longer than the limit reads "N+", not the loop its first section plays', async () => {
    const ir = parseStrudel('$: arrange([80, s("bd*2")], [20, s("hh*4")])')
    // 80 cycles of `bd`, then `hh`: the first 64 repeat every cycle.
    const collect = (s: number, e: number): IREvent[] => {
      const out: IREvent[] = []
      for (let c = s; c < e; c++) out.push(ev(c, c < 80 ? 'bd' : 'hh', 0))
      return out
    }
    expect((await run(collect, 64, ir)).displaySpan).toEqual({ kind: 'capped', cycles: 64 })
    // The control: inside the limit it spans its declared end, as it always has.
    expect((await run(collect, 128, ir)).displaySpan).toEqual({ kind: 'arranged', cycles: 100 })
  })
})

describe('analyzeSong (budgeted progressive horizon)', () => {
  // A period-4 collector: every cycle's note = cycle % 4 → periodic.
  const periodicCollect = (s: number, e: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = s; c < e; c++) out.push(ev(c, 'bd', c % 4))
    return out
  }
  // A never-repeating collector: note = cycle (all distinct) → no period.
  const uniqueCollect = (s: number, e: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = s; c < e; c++) out.push(ev(c, 'bd', c))
    return out
  }

  it('finds the period at the hint horizon and trims the view to one loop', async () => {
    const a = await analyzeSong(null, {
      hintCycles: 8,
      collectFn: periodicCollect,
      yieldFn: async () => {},
    })
    expect(a.periodCycles).toBe(4)
    // The view is trimmed to exactly one loop so displayCycles === period
    // (cells, playhead wrap, and audible loop all coincide).
    expect(a.horizonCycles).toBe(4)
    expect(a.lanes[0]?.onsetsByCycle.length).toBe(4)
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 4 })
  })

  it('doubles the horizon to the cap when no period is found, reporting a capped span', async () => {
    const a = await analyzeSong(null, {
      hintCycles: 4,
      capCycles: 16,
      collectFn: uniqueCollect,
      yieldFn: async () => {},
    })
    expect(a.periodCycles).toBeNull()
    expect(a.horizonCycles).toBe(16)
    expect(a.displaySpan).toEqual({ kind: 'capped', cycles: 16 })
  })

  it('yields to the event loop when a slice exceeds the time budget', async () => {
    const yieldFn = vi.fn(async () => {})
    // now() always jumps 100ms per call → every slice exceeds the 10ms budget.
    let t = 0
    const now = () => (t += 100)
    // period-2 collector so analysis stops at the hint (no growth) → 4 cycles.
    const collectFn = (s: number, e: number): IREvent[] => {
      const out: IREvent[] = []
      for (let c = s; c < e; c++) out.push(ev(c, 'bd', c % 2))
      return out
    }
    await analyzeSong(null, {
      hintCycles: 4,
      sliceCycles: 1,
      sliceBudgetMs: 10,
      collectFn,
      now,
      yieldFn,
    })
    // Slices fill [0,4): yields after cycles 1,2,3 (not the final one).
    expect(yieldFn).toHaveBeenCalledTimes(3)
  })

  it('returns a partial analysis when aborted mid-collection', async () => {
    const signal = { aborted: false }
    let collected = 0
    const collectFn = (s: number, e: number): IREvent[] => {
      collected = e
      if (e >= 4) signal.aborted = true // abort after 4 cycles
      return uniqueCollect(s, e)
    }
    const a = await analyzeSong(null, {
      hintCycles: 32,
      sliceCycles: 2,
      collectFn,
      yieldFn: async () => {},
      signal,
    })
    expect(collected).toBeLessThan(32) // stopped early
    expect(a.horizonCycles).toBeLessThanOrEqual(collected)
  })

  // #1712 — a song whose music starts after the first look. The origin of this
  // loop (#385) already said "a silent intro must not stop growth"; the empty
  // short-circuit ended it anyway whenever the intro was at least the hint long.
  // `arrange([lead, silence], [16, x])` repeats every lead+16 cycles, so the
  // collector below is that song: silent for `lead`, then one onset per cycle.
  const lateEntry = (lead: number) => (s: number, e: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = s; c < e; c++) if (c % (lead + 16) >= lead) out.push(ev(c, 'lead', 'c3'))
    return out
  }
  for (const lead of [0, 7, 8, 12]) {
    it(`finds a song whose first note is at cycle ${lead} (#1712)`, async () => {
      const a = await analyzeSong(null, { collectFn: lateEntry(lead), yieldFn: async () => {} })
      expect(a.lanes.map((l) => l.laneKey)).toEqual(['lead'])
      expect(a.horizonCycles).toBeGreaterThan(0)
      expect(a.periodCycles).toBe(lead === 0 ? 1 : lead + 16)
    })
  }

  it('still ends empty for a song that never sounds, having looked to the cap (#1712)', async () => {
    const asked: number[] = []
    const a = await analyzeSong(null, {
      capCycles: 64,
      collectFn: (_s, e) => { asked.push(e); return [] },
      yieldFn: async () => {},
    })
    expect(a.lanes).toEqual([])
    expect(a.horizonCycles).toBe(0)
    // It gave up only after the whole capped window was empty, not after the first look.
    expect(Math.max(...asked)).toBe(64)
  })

  it('yields an empty analysis for a null IR and no collector', async () => {
    const a = await analyzeSong(null, { yieldFn: async () => {} })
    expect(a.lanes).toEqual([])
    expect(a.sections).toEqual([])
  })

  // NOTE: the previous "integration via real collectCycles" block exercised
  // analyzeSong's DEFAULT collector. There is no default collector any more —
  // `collectFn` defaults to `() => []` and production injects the eval-backed
  // queryArc hap stream (MusicalTimeline.tsx). The analysis logic is covered by
  // the injected-collector arms above; the eval wiring is covered end-to-end by
  // the app's `full-song-analysis-eval` e2e.
})

describe('displayPeriodRule (#1107 — a period that leaves a track empty is not this song\'s loop)', () => {
  /** A lane that repeats every `p` cycles, entering at `from`. */
  const lane = (key: string, p: number, from: number, to: number): IREvent[] => {
    const out: IREvent[] = []
    for (let c = from; c < to; c++) out.push(ev(c, key, c % p))
    return out
  }

  // ── clause (b): the accepted span must contain every lane it knows about ──
  //
  // A lane that ANSWERS the period question always has an onset inside the span:
  // its fingerprints repeat with its own period q, the span is the max over
  // answering lanes so q <= span, and a repeating non-empty lane therefore sounds
  // somewhere in [0, q). So the clause can only ever fire on an ABSTAINING lane —
  // and since #2109 no lane abstains at any horizon, so the veto refuses first
  // everywhere and the clause guards only an injected `detectPeriodFn`.
  it('a late-entering lane abstains, so below the cap the veto refuses first', () => {
    const events = [...lane('early', 4, 0, 64), ...lane('late', 4, 4, 64)]
    expect(detectDisplayPeriod(events, 64)).toBeNull()
    expect(displayPeriodRule(events, 64, 256, false)).toBeNull()
  })

  it('refuses AT the cap too, where #1104 let the late lane abstain (#2109)', () => {
    const events = [...lane('early', 4, 0, 256), ...lane('late', 4, 4, 256)]
    expect(detectDisplayPeriod(events, 256)).toBeNull()
    expect(displayPeriodRule(events, 256, 256, false)).toBeNull()
  })

  it('accepts at the cap when the span does reach every lane', () => {
    const events = [...lane('early', 4, 0, 256), ...lane('late', 2, 0, 256)]
    expect(displayPeriodRule(events, 256, 256, false)).toBe(4)
  })

  // ── clause (a): an unheard declared track blocks acceptance while it can grow ──
  it('refuses a period while the caller reports an unheard track', () => {
    const events = lane('drums', 1, 0, 8)
    expect(displayPeriodRule(events, 8, 256, false)).toBe(1)
    expect(displayPeriodRule(events, 8, 256, true)).toBeNull()
  })

  it('lets an unheard track through AT the cap, so a silent track cannot stall forever', () => {
    const events = lane('drums', 1, 0, 256)
    expect(displayPeriodRule(events, 256, 256, true)).toBe(1)
  })

  // ── the composed loop: what the corpus documents actually do ──
  it('a track entering after the accepted period stops being erased from the analysis', async () => {
    // `bass` first sounds at cycle 8, so period 1 is confirmable at horizon 8 and
    // ships a one-cycle view with `bass` absent from `lanes` ENTIRELY — not empty,
    // gone — which is the defect: the row is then rebuilt from the document and
    // draws unmarked. This is `0/-Hx1rNCmeyD8`'s shape in miniature.
    const all = [...lane('drums', 1, 0, 256), ...lane('bass', 1, 8, 256)]
    const collect = (a: number, b: number) => all.filter((e) => e.begin >= a && e.begin < b)

    const before = await analyzeSong(null, { yieldFn: async () => {}, collectFn: collect })
    expect(before.periodCycles).toBe(1)
    expect(before.lanes.map((l) => l.laneKey)).toEqual(['drums'])

    const declared = ['drums', 'bass']
    const heard = new Set<string>()
    const after = await analyzeSong(null, {
      yieldFn: async () => {},
      collectFn: (a, b) => {
        const evs = collect(a, b)
        for (const e of evs) if (e.trackId !== undefined) heard.add(e.trackId)
        return evs
      },
      hasUnheardTrack: () => declared.some((id) => !heard.has(id)),
    })
    expect(after.lanes.map((l) => l.laneKey).sort()).toEqual(['bass', 'drums'])
    // Honest outcome, and the one the corpus documents take: a track with a
    // silent intro never repeats inside the horizon, so the song has no loop —
    // it is drawn aperiodic (#1105) with every track present, rather than as a
    // one-cycle loop with six of seven tracks erased.
    expect(after.periodCycles).toBeNull()
    expect(after.displaySpan.kind).toBe('capped')
  })

  it('every shipped lane has an onset inside the span (what accumulateLanes relies on)', async () => {
    // `b` enters at cycle 4, exactly the span the at-cap combine rule would
    // accept — so WITHOUT clause (b) this analysis ships one lane where the
    // document has two, which is the whole defect. Both assertions are load-
    // bearing: the count catches the erasure, the sum catches an empty row.
    const all = [...lane('a', 4, 0, 256), ...lane('b', 4, 4, 256)]
    const a = await analyzeSong(null, {
      yieldFn: async () => {},
      collectFn: (x, y) => all.filter((e) => e.begin >= x && e.begin < y),
    })
    expect(a.lanes.map((l) => l.laneKey).sort()).toEqual(['a', 'b'])
    for (const l of a.lanes) {
      expect(l.onsetsByCycle.reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0)
    }
  })
})

/**
 * #1465 — the corpus sweep proves this rule over 142 real documents, but it
 * takes ~144 seconds and reports aggregates. These are the mechanism at unit
 * speed, and the first one is the issue's own example: the difference between
 * `.gain(0.5)` and `.gain(sine.slow(4).range(0.05, 1))` on the same document.
 */
describe('displayPeriodRule — source-informed exclusion + fold (#1465)', () => {
  const CAP = 64
  /** A lane whose structure repeats every `p` cycles. */
  const structural = (lane: string, p: number, horizon = CAP): IREvent[] =>
    Array.from({ length: horizon }, (_, c) => ev(c, lane, c % p))
  /** The same lane with a control sweeping over it — a value that differs every
   *  cycle, which is what an LFO actually does to a cycle fingerprint. */
  const modulate = (events: IREvent[]): IREvent[] =>
    events.map((e, i) => ({ ...e, gain: 0.1 + i / 1000 }))

  const dims = (periods: number[], keys = ['gain'], noise = false) => ({ keys: new Set(keys), periods, noise })

  it("the issue's example: a swept gain costs the period, and the rule gives it back", () => {
    // `s("bd*8")` — one lane, identical every cycle — with a 4-cycle gain LFO.
    const events = modulate(structural('bd', 1))
    // Every cycle genuinely differs, so the lane is aperiodic in the only sense
    // this module measures. This is the reported defect.
    expect(displayPeriodRule(events, CAP, CAP, false)).toBeNull()
    // Told what the SOURCE says is modulated, it reads the structure through the
    // sweep and folds the LFO's own rate back in: a 4-cycle song.
    expect(displayPeriodRule(events, CAP, CAP, false, dims([4]))).toBe(4)
  })

  it('FOLDS to the period the audio repeats at, not the structural one', () => {
    // Structure repeats every 2; the LFO does not come back until 4. The honest
    // answer is 4 — a bounce of 2 would cut the sweep in half.
    expect(displayPeriodRule(modulate(structural('bd', 2)), CAP, CAP, false, dims([4]))).toBe(4)
    // Coprime rates take the least common multiple, not the larger one.
    expect(displayPeriodRule(modulate(structural('bd', 3)), CAP, CAP, false, dims([4]))).toBe(12)
  })

  it('leaves an already-commensurate period alone', () => {
    // 8 is already a whole number of 4-cycle LFO periods; the fold is a no-op.
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([4]))).toBe(8)
    // A signal FASTER than a cycle repeats within any integer span (`.fast(3)`).
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([1 / 3]))).toBe(8)
  })

  it('returns the structural span when the modulation has no period to fold', () => {
    // `rand`/`perlin`: the keys are excluded, but nothing repeats, so there is
    // no rate to fold and the structural span is the only answer available.
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([]))).toBe(8)
  })

  it('has no period when the honest fold would exceed the cap: the song pages (#2109)', () => {
    // lcm(8, 63) = 504, far past the cap: the song does not come back round within
    // the limit. Until #2109 this answered the unfolded 8 — a span the audio does
    // not repeat at, kept only because the alternative was a 256-cycle sliver.
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([63]))).toBeNull()
    // The control: a fold that fits the cap is still taken.
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([3]))).toBe(24)
  })

  it('has no period when a control moves by noise, which never comes back (#2109)', () => {
    // The same structure and the same sweep, with noise beside it on the document.
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([4]))).toBe(8)
    expect(displayPeriodRule(modulate(structural('bd', 8)), CAP, CAP, false, dims([4], ['gain'], true))).toBeNull()
  })

  it('can only ADD — it never touches a document that already answered', () => {
    // A plain, unmodulated document resolves the same with and without signals.
    const plain = structural('bd', 8)
    expect(displayPeriodRule(plain, CAP, CAP, false)).toBe(8)
    expect(displayPeriodRule(plain, CAP, CAP, false, dims([4]))).toBe(8)
  })

  it('stays silent below the cap, where a null is what buys the next doubling', () => {
    const events = modulate(structural('bd', 1, 16))
    expect(displayPeriodRule(events, 16, CAP, false, dims([4]))).toBeNull()
  })

  it('does nothing when the document declares no modulated control', () => {
    const events = modulate(structural('bd', 1))
    expect(displayPeriodRule(events, CAP, CAP, false, dims([4], []))).toBeNull()
  })
})

/**
 * #1488 — a track that makes no sound must not inform the song's length. The
 * exclusion half could survive being sloppy here (a muted track emits no
 * events, so stripping a key nothing carries is a no-op); the FOLD cannot,
 * because it is arithmetic on the IR and never looks at events.
 */
describe('signalDimensionsOf — a curve inside a section repeats on the song clock, not its own (#1590)', () => {
  // Each value is the period the engine's gains actually repeat at
  // (`signalAutomation.engine.test.ts`); the unsectioned rate is 3, 4, 3.
  const periods = (src: string) => signalDimensionsOf(parseStrudel(src) as never).periods

  it.each([
    ['a later section', '$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])', [4]],
    ['a section\'s second pass', '$: arrange([3, s("bd*8").gain(sine.slow(4))], [1, s("hh*8")])', [16]],
    ['cat', '$: cat(s("hh*8"), s("bd*8").gain(saw.slow(3)))', [6]],
  ])('%s', (_label, src, expected) => {
    expect(periods(src)).toEqual(expected)
  })

  it('a curve the reader declines contributes no period — it still strips its key', () => {
    // `.early` is an opaque call; `.slow` is applied since #1595.
    const d = signalDimensionsOf(parseStrudel('$: s("bd*8").gain(saw.slow(3)).early(0.5)') as never)
    expect(d.periods).toEqual([])
    expect([...d.keys]).toEqual(['gain'])
  })
})

describe('signalDimensionsOf — a whole-track time change stretches the period it repeats at (#1595)', () => {
  const periods = (src: string) => signalDimensionsOf(parseStrudel(src) as never).periods

  it.each([
    ['a slow', '$: s("bd*8").gain(saw.slow(3)).slow(2)', [6]],
    ['a fast', '$: s("bd*8").gain(saw.slow(3)).fast(2)', [1.5]],
    // A shift moves where the curve starts, never how long it takes to come back.
    ['a shift', '$: s("bd*8").gain(saw.slow(3)).late(-0.5)', [3]],
    // Innermost first: the section makes 3 into 9, the slow makes 9 into 18. The
    // other order (slow 3 into 6, then the section) gives 9, and the engine says 18.
    ['a slow around a section', '$: arrange([1, s("hh*8")], [2, s("bd*8").gain(saw.slow(3))]).slow(2)', [18]],
  ])('%s', (_label, src, expected) => {
    expect(periods(src)).toEqual(expected)
  })
})

describe('signalDimensionsOf — muted tracks do not inform the period (#1488)', () => {
  const read = (src: string) => signalDimensionsOf(parseStrudel(src) as never)

  it('reads an audible track', () => {
    const d = read('$: s("bd*4").gain(sine.slow(4))')
    expect([...d.keys]).toEqual(['gain'])
    expect(d.periods).toEqual([4])
  })

  it('reads NOTHING from the same track once it is muted', () => {
    const d = read('_$: s("bd*4").gain(sine.slow(4))')
    expect([...d.keys]).toEqual([])
    expect(d.periods).toEqual([])
  })

  it('the measured case: a silent LFO cannot lengthen an audible song', () => {
    // `0/-9BuEqUq3uzT` in miniature. Before this scoping the muted `.lpq` at
    // period 32 folded the whole document to 32 cycles; its audible content
    // repeats every cycle.
    const d = read([
      '$: s("bd*4").gain(sine)',
      '_$: s("hh*8").lpq(sine.range(2,10).slow(32))',
    ].join('\n'))
    expect([...d.keys]).toEqual(['gain'])
    expect(d.periods).toEqual([1])
  })

  it('a bare expression has no label, so it cannot be muted and is read whole', () => {
    // Muting is a prefix ON a label; a statement with none has nothing to
    // prefix. Returning it unread would silently drop every unwrapped document.
    const d = read('s("bd*4").gain(sine.slow(2))')
    expect([...d.keys]).toEqual(['gain'])
    expect(d.periods).toEqual([2])
  })

  it('keeps a named track and drops only the muted one beside it', () => {
    const d = read([
      'drums: s("bd*4").gain(sine.slow(2))',
      '_bass: s("e1").cutoff(sine.slow(8))',
    ].join('\n'))
    expect([...d.keys]).toEqual(['gain'])
    expect(d.periods).toEqual([2])
  })
})
