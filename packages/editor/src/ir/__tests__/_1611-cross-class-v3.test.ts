/**
 * #1611 probe v3 — the ground truth v2 could not see, and why a swept lane reads no period.
 *
 * v2's engine columns read `e.cutoff`, which a normalised event never has: controls live
 * under `event.params` (`NormalizedHap.ts:146`). So its "every cycle equals cycle 0" for a
 * 16-bar sweep was the instrument, not the audio.
 *
 * v3, per document, over a 64-cycle window:
 *  E  the ENGINE's own repeat: smallest p with every cycle c equal to c+p, keys built from
 *     trackId, offset, s, gain and every param (rounded to 1e-6, so float noise cannot
 *     fake a difference) — plus the unrounded version, to see whether noise alone breaks it.
 *  L  each lane's period through PRODUCTION `cycleFingerprints` + `detectPeriod` over 64
 *     cycles — the rule `lanePeriodsOf` applies, given a horizon long enough to find it.
 *  A  what `analyzeSong` (with signals) actually reports, for comparison.
 * The #1599 control and the 4-bar companion alone go first: their answers are known.
 *
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1611-cross-class-v3.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong, signalDimensionsOf, cycleFingerprints, detectPeriod } from '../songAnalysis'
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

const WINDOW = 64
const r6 = (x: unknown) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)

/** Smallest p in [1, len/2] with key[c] === key[c+p] for every c, else null. */
function repeatOfKeys(keys: readonly string[]): number | null {
  for (let p = 1; p <= Math.floor(keys.length / 2); p++) {
    let ok = true
    for (let c = 0; c + p < keys.length; c++) if (keys[c] !== keys[c + p]) { ok = false; break }
    if (ok) return p
  }
  return null
}

function cycleKeys(collect: (a: number, b: number) => IREvent[], round: boolean): string[] {
  const keys: string[] = []
  for (let c = 0; c < WINDOW; c++) {
    const evs = collect(c, c + 1).map((e) => {
      const params = Object.fromEntries(Object.entries((e as any).params ?? {}).sort().map(([k, v]) => [k, round ? r6(v) : v]))
      return JSON.stringify([e.trackId, Math.round((e.begin - c) * 1e6), e.s, round ? r6(e.gain) : e.gain, params])
    })
    keys.push(evs.sort().join('|'))
  }
  return keys
}

const COMPANION = 's("<hh cp sd rim>")'
const swept = (signal: string) => `s("bd*8").cutoff(${signal}.range(200, 2000))`

const DOCS: [string, Record<string, string>][] = [
  ['CONTROL #1599 (known repeat 12)', { d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8 0.5>")' }],
  ['CONTROL companion alone (known 4)', { d2: COMPANION }],
  ['sine.slow(16) + 4-bar', { d1: swept('sine.slow(16)'), d2: COMPANION }],
  ['perlin.slow(16) + 4-bar', { d1: swept('perlin.slow(16)'), d2: COMPANION }],
  ['sine (1 bar) + 4-bar', { d1: swept('sine'), d2: COMPANION }],
  ['perlin (1 bar) + 4-bar', { d1: swept('perlin'), d2: COMPANION }],
  ['sine.slow(16) alone', { d1: swept('sine.slow(16)') }],
  ['perlin.slow(16) alone', { d1: swept('perlin.slow(16)') }],
]

describe('#1611 probe v3', () => {
  it.each(DOCS)('%s', async (label, tracks) => {
    const patterns = await evaluate(tracks)
    const collect = collectorFor(patterns)
    const all = collect(0, WINDOW)

    const engineRepeat = { rounded: repeatOfKeys(cycleKeys(collect, true)), unrounded: repeatOfKeys(cycleKeys(collect, false)) }
    const laneRule = Object.fromEntries(Object.keys(tracks).map((id) => [id, detectPeriod(cycleFingerprints(all.filter((e) => e.trackId === id), WINDOW))]))
    const firstCutoffs = collect(0, 2).filter((e) => e.trackId === 'd1').slice(0, 10).map((e) => r6((e as any).params?.cutoff))

    const doc = Object.values(tracks).map((t) => `$: ${t}`).join('\n')
    const signals = signalDimensionsOf(parseStrudel(doc) as never)
    const a = await analyzeSong(null, { collectFn: collect, yieldFn: async () => {}, signals })
    const songLength = a.displaySpan.kind === 'loop' ? (a.repeatCycles ?? a.displaySpan.cycles) : 'unknown'

    console.log('P', JSON.stringify({
      label,
      E_engineRepeat: engineRepeat,
      L_lanePeriodOver64: laneRule,
      A_analysis: { span: a.displaySpan, horizon: a.horizonCycles, repeat: a.repeatCycles, lanePeriods: a.lanePeriods.map((l) => [l.laneKey, l.periodCycles]), songLength },
      firstCutoffs,
    }))
    expect(all.length).toBeGreaterThan(0)
  }, 120_000)
})
