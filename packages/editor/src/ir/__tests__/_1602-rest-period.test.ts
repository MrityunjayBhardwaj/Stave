/**
 * #1602 PROBE (untracked, not a gate) — is a step-count preview computable from the
 * analysis without evaluating the edit?
 *
 * Claim under test: the repeat after changing lane L's stepped parameter to a new
 * song period Q is lcm(other lanes' periods, L's period WITHOUT its stepped keys, Q).
 * Rival: lcm(every lane's CURRENT period, Q) — the formula the plan's wording implies.
 * The rival must predict a different number on this input, or the probe proves nothing.
 *
 * Copy into packages/editor/src/ir/__tests__/ and run with the editor probe config.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong, cycleFingerprints, detectPeriod, laneKeyOf, withoutKeys } from '../songAnalysis'
import { normalizeStrudelHap } from '../../engine/NormalizedHap'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function evaluate(tracks: Record<string, string>): Promise<Record<string, any>> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out: Record<string, any> = {}
    for (const [id, code] of Object.entries(tracks)) {
      const r = await core.evaluate(code, transpiler)
      out[id] = r.pattern ?? r
    }
    return out
  } finally {
    clearStringParser({ core })
  }
}

function collectorFor(patterns: Record<string, any>) {
  return (start: number, end: number): IREvent[] => {
    const out: IREvent[] = []
    for (const [trackId, pat] of Object.entries(patterns)) {
      for (const hap of pat.queryArc(start, end)) {
        if (!(hap.hasOnset?.() ?? true)) continue
        const ev = normalizeStrudelHap(hap, trackId)
        if (Math.floor(ev.begin) >= start && Math.floor(ev.begin) < end) out.push(ev)
      }
    }
    return out
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const lcm = (...xs: number[]) => xs.reduce((a, b) => (a * b) / gcd(a, b), 1)

function lanePeriod(events: IREvent[], lane: string, horizon: number, strip?: Set<string>): number | null {
  const mine = events.filter((e) => laneKeyOf(e) === lane).map((e) => (strip ? withoutKeys(e, strip) : e))
  return detectPeriod(cycleFingerprints(mine, horizon))
}

describe('#1602 probe — the preview needs the lane period without its stepped keys', () => {
  it.each([
    // [steps written, true repeat the engine should give]
    ['<0.2 0.8>', 2],
    ['<0.2 0.8 0.5 0.3>', 4],
    ['<0.2 0.8 0.5 0.3 0.9>', 5],
  ])('shrinking/growing the hat gain %s', async (edited, newStepPeriod) => {
    const H = 64
    const before = { d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8 0.5>")' }
    const beforeEvents = collectorFor(await evaluate(before))(0, H)
    const p1 = lanePeriod(beforeEvents, 'd1', H)!
    const p2 = lanePeriod(beforeEvents, 'd2', H)!
    const rest2 = lanePeriod(beforeEvents, 'd2', H, new Set(['gain']))!
    const claim = lcm(p1, rest2, newStepPeriod)
    const rival = lcm(p1, p2, newStepPeriod)

    const after = { d1: before.d1, d2: `s("hh*4").gain("${edited}")` }
    const a = await analyzeSong(null, { collectFn: collectorFor(await evaluate(after)), yieldFn: async () => {} })
    console.log(`[probe] ${edited}: p1=${p1} p2=${p2} rest2=${rest2} claim=${claim} rival=${rival} engine=${a.repeatCycles}`)
    expect(a.repeatCycles, 'the claim').toBe(claim)
    if (rival !== claim) expect(a.repeatCycles, 'the rival').not.toBe(rival)
  }, 120_000)
})
