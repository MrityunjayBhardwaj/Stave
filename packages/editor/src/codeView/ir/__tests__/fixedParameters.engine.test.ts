/**
 * #1600 — the AUTHORITY arm: the rewrite plays the same values in every cycle and
 * the analysis measures the same period, through the real transpiler.
 * Setup mirrors `steppedAutomation.engine.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import { analyzeSong } from '../songAnalysis'
import { fixedParameters, fixedToStepsEdit } from '../fixedParameters'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The value of `key` on every onset event in each cycle [0, cycles), via the real engine. */
async function valuesPerCycle(code: string, key: string, cycles: number): Promise<unknown[][]> {
  const pat = await evaluate(code)
  return Array.from({ length: cycles }, (_, c) =>
    pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true).map((h: any) => h.value?.[key]),
  )
}

const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('#1600 — writing a fixed value as steps changes nothing that plays', () => {
  it.each([1, 2, 3, 4, 8])('%i steps', async (n) => {
    for (const code of ['s("bd*2").gain(0.8)', 's("bd*2").gain(.8)', "s(\"bd*2\").lpf('800')"]) {
      const [f] = fixedParameters(parseStrudel(code) as never)
      const out = apply(code, fixedToStepsEdit(f, n, code)!)
      const cycles = n * 2
      expect(await valuesPerCycle(out, f.paramKey, cycles), `${code} → ${out}`).toEqual(
        await valuesPerCycle(code, f.paramKey, cycles),
      )
    }
  }, 120_000)

  it.each([1, 3, 4, 8])('%i steps measure the same period and repeat', async (n) => {
    for (const code of ['s("bd*2").gain(0.8)', 's("<bd sd cp hh>").gain(.8)']) {
      const [f] = fixedParameters(parseStrudel(code) as never)
      const out = apply(code, fixedToStepsEdit(f, n, code)!)
      const measure = async (src: string) => {
        const a = await analyzeSong(null, { collectFn: collectorFor({ d1: await evaluate(src) }), yieldFn: async () => {} })
        return [a.periodCycles, a.repeatCycles]
      }
      expect(await measure(out), `${code} → ${out}`).toEqual(await measure(code))
    }
  }, 120_000)

  it('the control: steps that differ DO change the period — the measurement can see a change', async () => {
    const a = await analyzeSong(null, {
      collectFn: collectorFor({ d1: await evaluate('s("bd*2").gain("<0.8 0.2 0.8>")') }),
      yieldFn: async () => {},
    })
    expect(a.periodCycles).toBe(3)
  }, 60_000)
})

async function evaluate(code: string): Promise<any> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const r = await core.evaluate(code, transpiler)
    return r.pattern ?? r
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
