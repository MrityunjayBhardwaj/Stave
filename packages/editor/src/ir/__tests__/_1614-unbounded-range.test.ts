/**
 * PROBE (untracked) — #1614. Three measurements before any design:
 *  (1) what the engine plays for a ranged `time`, vs what the reader reports;
 *  (2) what the lane draws (phase wrapped to one cycle) vs the engine, at a few times;
 *  (3) whether the shape-swap preview already misses an UNBOUNDED writer on the same
 *      control — bare `time` and ranged `time` beside a perlin curve, swapped to sine.
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1614-unbounded-range.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import { analyzeSong, previewShapeSwap, signalDimensionsOf, type SongAnalysis } from '../songAnalysis'
import { signalAutomations, type SignalKind } from '../signalAutomation'
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

const NO_YIELD = async () => {}
const docOf = (tracks: readonly string[]) => tracks.map((t) => `$: ${t}`).join('\n')
const idsOf = (tracks: readonly string[]) => Object.fromEntries(tracks.map((t, i) => [`d${i + 1}`, t]))
async function analyseSource(tracks: readonly string[]): Promise<SongAnalysis> {
  const ir = parseStrudel(docOf(tracks)) as never
  const patterns = await evaluate(idsOf(tracks))
  return analyzeSong(ir, { collectFn: collectorFor(patterns), yieldFn: NO_YIELD, signals: signalDimensionsOf(ir) })
}
const lengthOf = (a: SongAnalysis | null) =>
  a === null ? 'no preview' : a.displaySpan.kind === 'loop' && a.displaySpan.cycles > 0 ? (a.repeatCycles ?? a.displaySpan.cycles) : 'unknown'

describe('#1614 probe', () => {
  it('(1)+(2) ranged time: engine vs reader vs lane', async () => {
    const code = 's("bd*16").cutoff(time.range(200, 800))'
    const { d1 } = await evaluate({ d1: code })
    const haps = d1.queryArc(0, 16).filter((h: any) => h.hasOnset?.() ?? true)
    const vals = haps.map((h: any) => ({ t: h.whole.begin.valueOf(), v: h.value.cutoff }))
    const all = vals.map((x: any) => x.v)
    const autos = signalAutomations(parseStrudel(`$: ${code}`) as never)
    console.log('P1', JSON.stringify({ n: vals.length, engineMin: Math.min(...all), engineMax: Math.max(...all), reader: autos.map((a) => ({ kind: a.kind, lo: a.lo, hi: a.hi, ranged: a.ranged, period: a.periodCycles, asWritten: a.boundsAsWritten })) }))
    const a = autos[0]
    // The lane: signalUnit wraps phase to [0,1) and `time` is t → t, then lo + (hi-lo)·unit.
    const lane = (t: number) => a.lo + (a.hi - a.lo) * ((t / a.periodCycles) - Math.floor(t / a.periodCycles))
    const at = [0, 0.5, 1, 1.5, 4, 8.25, 15.9375]
    console.log('P2', JSON.stringify(at.map((t) => ({ t, engine: vals.find((x: any) => x.t === t)?.v, lane: lane(t) }))))
    expect(true).toBe(true)
  }, 120_000)

  it.each([
    ['bare time', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(time))'],
    ['ranged time', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(time.range(0.2, 0.8)))'],
    ['CONTROL another perlin', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(perlin.slow(4)))'],
  ] as const)('(3) %s on the same control, perlin → sine', async (label, d1) => {
    const LOOP4 = 's("<hh cp sd rim>")'
    const tracks = [d1, LOOP4]
    const code = docOf(tracks)
    const ir = parseStrudel(code) as never
    const autos = signalAutomations(ir)
    const a = autos.find((x) => x.trackId === 'd1' && x.kind === 'perlin' && x.spans.shape !== null)!
    const patterns = await evaluate(idsOf(tracks))
    const preview = await previewShapeSwap(ir, a, 'sine' as SignalKind, { collectFn: collectorFor(patterns), yieldFn: NO_YIELD })
    const span = a.spans.shape!
    const swappedCode = code.slice(0, span.start) + 'sine' + code.slice(span.end)
    const truth = await analyseSource(swappedCode.split('\n').map((l) => l.slice(3)))
    const current = await analyseSource(tracks)
    console.log('P3', JSON.stringify({
      label,
      readerWriters: autos.filter((x) => x.trackId === 'd1' && x.paramKey === 'gain').map((x) => x.kind),
      current: lengthOf(current),
      truth: lengthOf(truth),
      preview: lengthOf(preview),
      previewSpan: preview?.displaySpan, truthSpan: truth.displaySpan,
    }))
    expect(true).toBe(true)
  }, 180_000)
})
