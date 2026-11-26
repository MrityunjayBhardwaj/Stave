/**
 * #1613 probe — which way does an inverted range play, and what does the reader say?
 *
 * For each expression: the engine's gain at the signal's natural LOW point and HIGH point
 * (tri: phase 0 and 0.5 of its period; sine: 0.75 and 0.25), next to the reader's lo/hi.
 * The lane plots the natural shape with the band's top as the high point, so an inverted
 * range is drawn the right way up only if gain at the natural high is the LARGER one.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations } from '../signalAutomation'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function gainsAt(code: string, cycles: number): Promise<Map<number, number>> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    const m = new Map<number, number>()
    for (const h of pat.queryArc(0, cycles)) {
      if (!(h.hasOnset?.() ?? true)) continue
      m.set(Math.round(h.whole.begin.valueOf() * 1000) / 1000, Math.round(h.value.gain * 1e6) / 1e6)
    }
    return m
  } finally {
    clearStringParser({ core })
  }
}

// [label, expression, period in cycles, phase of natural LOW, phase of natural HIGH]
const CASES: [string, string, number, number, number][] = [
  ['tri normal', 'tri.slow(4).range(0.3, 0.7)', 4, 0, 0.5],
  ['tri inverted', 'tri.slow(4).range(0.7, 0.3)', 4, 0, 0.5],
  ['sine normal', 'sine.slow(4).range(0.25, 1)', 4, 0.75, 0.25],
  ['sine inverted', 'sine.slow(4).range(1, 0.25)', 4, 0.75, 0.25],
  ['saw inverted', 'saw.slow(4).range(0.9, 0.1)', 4, 0, 0.9375],
]

describe('#1613 probe', () => {
  it.each(CASES)('%s', async (label, expr, period, lowPhase, highPhase) => {
    const code = `s("bd*16").gain(${expr})`
    const g = await gainsAt(code, period)
    const [a] = signalAutomations(parseStrudel(`$: ${code}`) as never)
    const atLow = g.get(Math.round(lowPhase * period * 1000) / 1000)
    const atHigh = g.get(Math.round(highPhase * period * 1000) / 1000)
    const values = [...g.values()]
    console.log('P', JSON.stringify({
      label, expr,
      engine: { atNaturalLow: atLow, atNaturalHigh: atHigh, min: Math.min(...values), max: Math.max(...values) },
      reader: a ? { lo: a.lo, hi: a.hi, boundsAsWritten: a.boundsAsWritten } : null,
      upright: atHigh !== undefined && atLow !== undefined ? atHigh > atLow : null,
    }))
    expect(g.size).toBe(16 * period)
  })
})
