/**
 * #1599 — the AUTHORITY arm for the whole-song repeat: a song played through the
 * real transpiler, its haps normalised the way production normalises them, fed to
 * the real `analyzeSong`. The analysis must say the view spans 4 and the audio
 * repeats at 12 — and the engine's own cycles must agree: cycle 4 is not cycle 0,
 * cycle 12 is.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong } from '../songAnalysis'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

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

describe('#1599 — what the engine plays, and what the analysis says about it', () => {
  it('a 4-cycle track beside a hi-hat whose gain has 3 steps: view 4, repeat 12', async () => {
    const patterns = await evaluate({ d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8 0.5>")' })
    const collect = collectorFor(patterns)

    // The engine's own cycles, as the fingerprint sees them — the ground truth.
    const cycle = (c: number) => JSON.stringify(collect(c, c + 1).map((e) => [e.trackId, e.begin - c, e.s, e.gain]))
    expect(cycle(4), 'cycle 4 should differ from cycle 0').not.toBe(cycle(0))
    expect(cycle(12)).toBe(cycle(0))

    const a = await analyzeSong(null, { collectFn: collect, yieldFn: async () => {} })
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 4 })
    expect(a.repeatCycles).toBe(12)
  }, 60_000)

  // #1617 — a continuous signal is sampled on the same beat each pass and still differs in
  // its last bits, so identity has to round. Each arm checks the engine's own cycles first.
  it('a 16-bar sine sweep beside a 4-bar line repeats at 16, not the 4 the line alone gives', async () => {
    const patterns = await evaluate({ d1: 's("bd*8").cutoff(sine.slow(16).range(200, 2000))', d2: 's("<hh cp sd rim>")' })
    const collect = collectorFor(patterns)
    const cutoffsAt = (c: number) => collect(c, c + 1).filter((e) => e.trackId === 'd1').map((e) => Math.round((e.params?.cutoff as number) * 1e6))
    expect(cutoffsAt(16), 'the sweep comes back at 16').toEqual(cutoffsAt(0))
    expect(cutoffsAt(4), 'and not at 4').not.toEqual(cutoffsAt(0))

    const a = await analyzeSong(null, { collectFn: collect, yieldFn: async () => {} })
    expect(a.repeatCycles).toBe(16)
  }, 60_000)

  it('a 1-bar sine beside the same line repeats with the line, at 4', async () => {
    const patterns = await evaluate({ d1: 's("bd*8").cutoff(sine.range(200, 2000))', d2: 's("<hh cp sd rim>")' })
    const a = await analyzeSong(null, { collectFn: collectorFor(patterns), yieldFn: async () => {} })
    expect(a.repeatCycles).toBe(4)
  }, 60_000)

  it('noise beside the same line still has no whole-song repeat', async () => {
    const patterns = await evaluate({ d1: 's("bd*8").cutoff(perlin.slow(16).range(200, 2000))', d2: 's("<hh cp sd rim>")' })
    const a = await analyzeSong(null, { collectFn: collectorFor(patterns), yieldFn: async () => {} })
    expect(a.repeatCycles).toBeNull()
  }, 60_000)

  it('the control: the same tracks with a 2-step gain repeat where they view, at 4', async () => {
    const patterns = await evaluate({ d1: 's("<bd sd cp hh>")', d2: 's("hh*4").gain("<0.2 0.8>")' })
    const a = await analyzeSong(null, { collectFn: collectorFor(patterns), yieldFn: async () => {} })
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 4 })
    expect(a.repeatCycles).toBe(4)
  }, 60_000)
})
