/**
 * #1464 shape-stage probe — what a shape swap may write, asked of the real engine
 * BEFORE designing the menu. Each claim is paired with the rival reading it must beat.
 *
 * S1  `spans.shape` covers exactly the identifier (`sine`), so replacing it is the
 *     whole of a shape change.
 * S2  under an explicit `.range(200,2000)`, a unipolar swap (sine → saw/tri/square/
 *     cosine/isaw/perlin) keeps the output inside 200..2000.
 *     Rival: a bipolar swap (sine → sine2) does NOT — `range` assumes 0..1 input.
 * S3  what does the engine play for `sine2.range(200,2000)`? (the lane labels 200→2000)
 * S4  a unipolar swap keeps the rate: `tri.slow(4)` repeats at 4 like `sine.slow(4)`.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations } from '../signalAutomation'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
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

async function cutoffs(code: string, cycles: number): Promise<number[]> {
  const pat = await evaluate(code)
  return pat
    .queryArc(0, cycles)
    .filter((h: any) => h.hasOnset?.() ?? true)
    .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf())
    .map((h: any) => Math.round(h.value.cutoff * 1000) / 1000)
}

const span = (xs: number[]) => [Math.min(...xs), Math.max(...xs)]

describe('#1464 shape probe', () => {
  it('S1 — the shape span is exactly the identifier', () => {
    for (const code of [
      's("bd").cutoff(sine.slow(4).range(200,2000))',
      's("bd").cutoff(perlin.range(200,2000))',
      's("bd").gain(saw)',
      's("bd").pan(  tri2 .slow(2))',
    ]) {
      const [a] = signalAutomations(parseStrudel(code) as never)
      const s = a.spans.shape
      expect(s, code).not.toBeNull()
      console.log('S1', JSON.stringify(code), '→', JSON.stringify(code.slice(s!.start, s!.end)))
      expect(code.slice(s!.start, s!.end)).toBe(a.kind)
    }
  })

  it('S2/S3 — output bounds per swapped shape under range(200,2000)', async () => {
    const out: Record<string, number[]> = {}
    for (const k of ['sine', 'cosine', 'saw', 'isaw', 'tri', 'itri', 'square', 'perlin', 'rand', 'sine2', 'saw2', 'tri2', 'square2']) {
      out[k] = span(await cutoffs(`s("bd*16").cutoff(${k}.slow(4).range(200, 2000))`, 16))
    }
    console.log('S2/S3', JSON.stringify(out))
    for (const k of ['sine', 'cosine', 'saw', 'isaw', 'tri', 'itri', 'square', 'perlin', 'rand']) {
      expect(out[k][0], k).toBeGreaterThanOrEqual(200)
      expect(out[k][1], k).toBeLessThanOrEqual(2000)
    }
    expect(out.sine2[0], 'rival: bipolar under range escapes the floor').toBeLessThan(200)
  })

  it('S4 — a periodic unipolar swap keeps the period', async () => {
    for (const k of ['sine', 'tri', 'square', 'saw', 'cosine']) {
      const xs = await cutoffs(`s("bd*8").cutoff(${k}.slow(4).range(200, 2000))`, 12)
      const at = (c: number) => xs.slice(c * 8, (c + 1) * 8)
      expect(at(4), `${k} repeats at 4`).toEqual(at(0))
      expect(at(2), `${k} rival: not at 2`).not.toEqual(at(0))
    }
  })
})
