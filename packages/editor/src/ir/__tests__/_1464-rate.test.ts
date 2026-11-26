/**
 * #1464 Stage 3 probe — what a rate edit may write, asked of the real engine BEFORE
 * designing the control. Each claim is paired with the rival reading it must beat.
 *
 * C1  `.slow(4)` placed after `.range()` plays the same as before it (insert at chainEnd).
 * C2  `.fast(n)` respelled as `.slow(1/n)` plays the same (a replacement may change method).
 * C3  under a whole-track `.slow(2)`, the curve's period on the song axis is the signal's
 *     own period times 2 — so "every 8 bars" on the lane must write `.slow(4)`.
 *     Rival: the lane period equals the signal's period (would write `.slow(8)`).
 * C4  the reader reads each written spelling back as the period it was written for.
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

/** The cutoff at every onset over `cycles`, rounded so float noise cannot fake a difference. */
async function cutoffs(code: string, cycles: number): Promise<number[]> {
  const pat = await evaluate(code)
  return pat
    .queryArc(0, cycles)
    .filter((h: any) => h.hasOnset?.() ?? true)
    .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf())
    .map((h: any) => Math.round(h.value.cutoff * 1000) / 1000)
}

const periodOf = (code: string) => signalAutomations(parseStrudel(code) as never).map((a) => a.periodCycles)

describe('#1464 Stage 3 probe', () => {
  it('C1 — .slow after .range plays the same as before it', async () => {
    const a = await cutoffs('s("bd*8").cutoff(saw.slow(4).range(200, 2000))', 16)
    const b = await cutoffs('s("bd*8").cutoff(saw.range(200, 2000).slow(4))', 16)
    const rival = await cutoffs('s("bd*8").cutoff(saw.range(200, 2000))', 16)
    expect(a.length).toBe(128)
    expect(b).toEqual(a)
    expect(rival, 'the control: no slow at all must differ, or the instrument is blind').not.toEqual(a)
  })

  it('C2 — .fast(n) respelled as .slow(1/n) plays the same', async () => {
    const fast = await cutoffs('s("bd*8").cutoff(sine.fast(2).range(200, 2000))', 8)
    const slow = await cutoffs('s("bd*8").cutoff(sine.slow(0.5).range(200, 2000))', 8)
    const rival = await cutoffs('s("bd*8").cutoff(sine.slow(2).range(200, 2000))', 8)
    expect(slow).toEqual(fast)
    expect(rival).not.toEqual(fast)
  })

  it('C3 — a whole-track slow multiplies the period the lane shows', async () => {
    // Under `.slow(2)` on the track, the signal `.slow(4)` repeats every 8 song cycles.
    const song = await cutoffs('s("bd*8").cutoff(saw.slow(4).range(200, 2000)).slow(2)', 24)
    const perCycle = song.length / 24
    const at = (cycle: number) => song.slice(cycle * perCycle, (cycle + 1) * perCycle)
    expect(at(8), 'repeats at 8').toEqual(at(0))
    expect(at(4), 'rival: repeats at 4').not.toEqual(at(0))
  })

  it('C4 — each spelling reads back as the period it was written for', () => {
    expect(periodOf('s("bd").cutoff(saw.slow(4).range(200,2000))')).toEqual([4])
    expect(periodOf('s("bd").cutoff(saw.range(200,2000).slow(4))')).toEqual([4])
    expect(periodOf('s("bd").cutoff(saw.slow(1.5).range(200,2000))')).toEqual([1.5])
    expect(periodOf('s("bd").cutoff(saw.fast(3).range(200,2000))')[0]).toBeCloseTo(1 / 3, 12)
    expect(periodOf('s("bd").cutoff(saw.slow(0.5))')).toEqual([0.5])
  })
})
