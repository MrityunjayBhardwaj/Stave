/**
 * #1617 probe — two facts the fix rests on, observed rather than read.
 *
 * H  The COLLECTION horizon `analyzeSong` reaches on `sine.slow(16)` beside a 4-bar line:
 *    the largest `end` it asks the collector for. `horizonCycles` is trimmed to the display
 *    period on return, so it cannot answer this.
 * Q  Whether the rounding quantum matters: the engine's own repeat with control values
 *    rounded to 1e-6 and to 1e-9, on the documents that decide it.
 *
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1617-horizon.test.ts
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

function repeatAt(collect: (a: number, b: number) => IREvent[], quantum: number, window = 128): number | null {
  // quantum 0 means RAW floats — dividing by it would turn every number into NaN, which
  // serialises as null and makes every cycle look alike.
  const q = (x: unknown) => (quantum > 0 && typeof x === 'number' ? Math.round(x / quantum) * quantum : x)
  const keys: string[] = []
  for (let c = 0; c < window; c++) {
    keys.push(collect(c, c + 1).map((e) => {
      const params = Object.fromEntries(Object.entries((e as any).params ?? {}).sort().map(([k, v]) => [k, q(v)]))
      return JSON.stringify([e.trackId, Math.round((e.begin - c) * 1e6), e.s, q(e.gain), params])
    }).sort().join('|'))
  }
  for (let p = 1; p <= window / 2; p++) {
    let ok = true
    for (let c = 0; c + p < window; c++) if (keys[c] !== keys[c + p]) { ok = false; break }
    if (ok) return p
  }
  return null
}

const COMPANION = 's("<hh cp sd rim>")'
const swept = (signal: string) => `s("bd*8").cutoff(${signal}.range(200, 2000))`

describe('#1617 probe — horizon and quantum', () => {
  it.each([
    ['sine.slow(16) + 4-bar', { d1: swept('sine.slow(16)'), d2: COMPANION }],
    ['sine (1 bar) + 4-bar', { d1: swept('sine'), d2: COMPANION }],
    ['pan sine.slow(8) (values near 0) + 4-bar', { d1: 's("bd*8").pan(sine2.slow(8))', d2: COMPANION }],
    ['CONTROL #1599 (known 12)', { d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8 0.5>")' }],
  ] as [string, Record<string, string>][])('%s', async (label, tracks) => {
    const patterns = await evaluate(tracks)
    const collect = collectorFor(patterns)
    let maxEnd = 0
    const doc = Object.values(tracks).map((t) => `$: ${t}`).join('\n')
    const a = await analyzeSong(null, {
      yieldFn: async () => {},
      collectFn: (s, e) => { if (e > maxEnd) maxEnd = e; return collect(s, e) },
      signals: signalDimensionsOf(parseStrudel(doc) as never),
    })
    console.log('P', JSON.stringify({
      label,
      H_collectionHorizon: maxEnd,
      returned: { span: a.displaySpan, horizonCycles: a.horizonCycles, repeat: a.repeatCycles, lanePeriods: a.lanePeriods.map((l) => [l.laneKey, l.periodCycles]) },
      Q_engineRepeat: { q1e6: repeatAt(collect, 1e-6), q1e9: repeatAt(collect, 1e-9), raw: repeatAt(collect, 0 as never) },
    }))
    expect(maxEnd).toBeGreaterThan(0)
  }, 120_000)
})
