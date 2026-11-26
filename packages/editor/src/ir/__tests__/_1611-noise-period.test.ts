/**
 * #1611 noise-period probe — does Strudel noise come back round, and at what span?
 *
 * (1) SIGNAL: each noise kind's value at t and t+S for candidate spans S, at 40 sample
 *     times — how many of the 40 are equal (to 1e-9).
 * (2) SONG: production analysis length of `s("bd*8").cutoff(K.slow(r).range(400,3000))`
 *     alone, for several rates r — and the lane's own period.
 *
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1611-noise-period.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong, signalDimensionsOf } from '../songAnalysis'
import { parseStrudel } from '../parseStrudel'
import { normalizeStrudelHap } from '../../engine/NormalizedHap'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function boot() {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  return { core, mini }
}

async function evaluate(code: string): Promise<any> {
  const { core, mini } = await boot()
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const r = await core.evaluate(code, transpiler)
    return r.pattern ?? r
  } finally {
    clearStringParser({ core })
  }
}

const valueAt = (pat: any, t: number): number => {
  const haps = pat.queryArc(t, t + 1e-9)
  return haps.length ? Number(haps[0].value) : NaN
}

describe('#1611 noise period', () => {
  it('signal: equal values a span apart', async () => {
    const { core } = await boot()
    const out: Record<string, Record<number, number>> = {}
    for (const kind of ['rand', 'perlin', 'brand', 'berlin', 'sine']) {
      const sig = core[kind]
      if (!sig) { out[kind] = { [-1]: -1 }; continue }
      out[kind] = {}
      for (const S of [1, 100, 150, 299, 300, 301, 600]) {
        let eq = 0
        for (let i = 0; i < 40; i++) {
          const t = 0.137 + i * 3.71
          if (Math.abs(valueAt(sig, t) - valueAt(sig, t + S)) < 1e-9) eq++
        }
        out[kind][S] = eq
      }
    }
    console.log('SIG', JSON.stringify(out))
    expect(Object.keys(out).length).toBe(5)
  }, 120_000)

  it.each([['perlin', 0.015], ['perlin', 0.05], ['perlin', 1], ['rand', 0.015], ['rand', 0.1]])('song: %s.slow(%s)', async (kind, rate) => {
    const body = `s("bd*8").cutoff(${kind}.slow(${rate}).range(400, 3000))`
    const pat = await evaluate(body)
    const collectFn = (a: number, b: number): IREvent[] =>
      pat.queryArc(a, b).map((h: any) => normalizeStrudelHap(h, 'd1')).filter((e: IREvent) => Math.floor(e.begin) >= a && Math.floor(e.begin) < b)
    const ir = parseStrudel(`$: ${body}`) as never
    const an = await analyzeSong(ir, { collectFn, yieldFn: async () => {}, signals: signalDimensionsOf(ir) })
    console.log('SONG', JSON.stringify({ kind, rate, span: an.displaySpan, repeat: an.repeatCycles, lanes: an.lanePeriods, expected300: 300 * Number(rate) }))
    expect(an).toBeDefined()
  }, 120_000)
})
