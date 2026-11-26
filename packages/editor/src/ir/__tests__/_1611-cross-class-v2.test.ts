/**
 * #1611 probe v2 — what a cross-class shape swap (repeating ↔ noise) does to the song's
 * length, through the real engine and the real `analyzeSong`, with the instrument checked
 * first.
 *
 * v1 read `repeat: null` on every document (even `sine.slow(16)` alone) and short periods
 * for perlin, and its "4-bar" companion `<hh cp hh cp>` repeats at 2. So v2:
 *  - runs the #1599 control FIRST (known: view 4, repeat 12) through the same harness,
 *    with and without `signals`, so a null repeat can be told from a harness that drops it;
 *  - uses a real 4-bar companion, `<hh cp sd rim>`;
 *  - prints `lanePeriods`, and the engine's own cycle comparisons as ground truth;
 *  - prints the swept track's first cutoff values, to see whether perlin varies at all.
 *
 * Harness copied from `songAnalysis.repeat.engine.test.ts`.
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1611-cross-class-v2.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong, signalDimensionsOf } from '../songAnalysis'
import { parseStrudel } from '../parseStrudel'
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

const COMPANION = 's("<hh cp sd rim>")'
const swept = (signal: string) => `s("bd*8").cutoff(${signal}.range(200, 2000))`

// [label, tracks]
const DOCS: [string, Record<string, string>][] = [
  ['CONTROL #1599 (known view 4, repeat 12)', { d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8 0.5>")' }],
  ['companion alone (expect 4)', { d2: COMPANION }],
  ['sine.slow(16) + 4-bar', { d1: swept('sine.slow(16)'), d2: COMPANION }],
  ['perlin.slow(16) + 4-bar', { d1: swept('perlin.slow(16)'), d2: COMPANION }],
  ['sine (1 bar) + 4-bar', { d1: swept('sine'), d2: COMPANION }],
  ['perlin (1 bar) + 4-bar', { d1: swept('perlin'), d2: COMPANION }],
  ['sine.slow(16) alone', { d1: swept('sine.slow(16)') }],
  ['perlin.slow(16) alone', { d1: swept('perlin.slow(16)') }],
]

describe('#1611 probe v2', () => {
  it.each(DOCS)('%s', async (label, tracks) => {
    const patterns = await evaluate(tracks)
    const collect = collectorFor(patterns)
    // Engine ground truth: does cycle c play exactly what cycle 0 plays (every value)?
    const cycle = (c: number) => JSON.stringify(collect(c, c + 1).map((e) => [e.trackId, e.begin - c, e.s, e.gain, (e as any).cutoff]))
    const sameAs0 = Object.fromEntries([1, 2, 4, 8, 12, 16, 32].map((c) => [c, cycle(c) === cycle(0)]))
    const cutoffs = collect(0, 4).filter((e) => e.trackId === 'd1').slice(0, 10).map((e) => Math.round(((e as any).cutoff ?? NaN) * 10) / 10)

    const doc = Object.values(tracks).map((t) => `$: ${t}`).join('\n')
    const signals = signalDimensionsOf(parseStrudel(doc) as never)
    const noSignals = await analyzeSong(null, { collectFn: collect, yieldFn: async () => {} })
    const withSignals = await analyzeSong(null, { collectFn: collect, yieldFn: async () => {}, signals })
    const summary = (a: typeof noSignals) => ({
      span: a.displaySpan, period: a.periodCycles, horizon: a.horizonCycles, repeat: a.repeatCycles, lanePeriods: a.lanePeriods,
    })
    console.log('P', JSON.stringify({
      label,
      signals: { keys: [...signals.keys], periods: signals.periods },
      engineSameAsCycle0: sameAs0,
      firstCutoffs: cutoffs,
      noSignals: summary(noSignals),
      withSignals: summary(withSignals),
    }))
    expect(noSignals.lanes.length).toBeGreaterThan(0)
  }, 120_000)
})
