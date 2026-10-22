/**
 * #1464 — the AUTHORITY arm for the shape menu: every swap `shapeAlternatives` offers
 * plays inside the bounds the caption shows and repeats at the rate it shows, through
 * the real transpiler. The rival — a swap across polarity, which the table refuses —
 * is run beside them, so an input that stops telling the two apart fails.
 *
 * Setup mirrors `signalAutomation.engine.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { shapeAlternatives, type SignalKind } from '../signalAutomation'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The cutoff at every onset in [0, cycles), in onset order, via the real engine. */
async function cutoffs(code: string, cycles: number): Promise<number[]> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    return pat
      .queryArc(0, cycles)
      .filter((h: any) => h.hasOnset?.() ?? true)
      .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf())
      .map((h: any) => Math.round(h.value.cutoff * 1000) / 1000)
  } finally {
    clearStringParser({ core })
  }
}

const song = (kind: string) => `s("bd*8").cutoff(${kind}.slow(4).range(200, 2000))`

describe('#1464 — an offered shape plays inside the caption\'s bounds, at its rate', () => {
  it.each(['sine', ...shapeAlternatives('sine')])('%s stays inside 200..2000 and repeats every 4 bars, not 2', async (kind) => {
    const xs = await cutoffs(song(kind), 12)
    expect(xs.length).toBe(96)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(200)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2000)
    const bar = (c: number) => xs.slice(c * 8, (c + 1) * 8)
    expect(bar(4), 'repeats at 4').toEqual(bar(0))
    expect(bar(2), 'does not repeat at 2').not.toEqual(bar(0))
  })

  it.each(['perlin', ...shapeAlternatives('perlin')])('%s stays inside 200..2000', async (kind) => {
    const xs = await cutoffs(song(kind), 12)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(200)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2000)
    // The instrument moves: noise that read as a constant would pass the bounds for free.
    expect(new Set(xs).size).toBeGreaterThan(10)
  })

  it('the rival, a swap across polarity, leaves the bounds — which is why none is offered', async () => {
    const xs = await cutoffs(song('sine2'), 12)
    expect(Math.min(...xs)).toBeLessThan(200)
    expect(shapeAlternatives('sine')).not.toContain('sine2' as SignalKind)
  })

  it.each(['sine2', ...shapeAlternatives('sine2')])('bipolar %s stays inside the same 2·lo−hi..hi as sine2', async (kind) => {
    const xs = await cutoffs(song(kind), 12)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1600)
    expect(Math.min(...xs)).toBeLessThan(200)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2000)
  })
})
