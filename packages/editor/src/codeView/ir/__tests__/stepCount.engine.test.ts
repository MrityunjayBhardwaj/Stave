/**
 * #1602 — the AUTHORITY arms: a step-count change heard through the real transpiler,
 * and the song length previewed before it measured against the analysis of what the
 * edited song actually plays. Setup mirrors `songAnalysis.repeat.engine.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import { analyzeSong, previewRepeat, songPeriodOf } from '../songAnalysis'
import { steppedAutomations } from '../steppedAutomation'
import { stepCountEdit } from '../stepCount'
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

/** A two-track document, parsed whole (so its track ids are `d1`, `d2`) and
 *  evaluated track by track under those ids — the shape production collects. */
const doc = (d1: string, d2: string) => `$: ${d1}\n$: ${d2}`
async function analyse(d1: string, d2: string) {
  const code = doc(d1, d2)
  const patterns = await evaluate({ d1, d2 })
  const analysis = await analyzeSong(parseStrudel(code) as never, { collectFn: collectorFor(patterns), yieldFn: async () => {} })
  return { code, patterns, analysis }
}

const gainsPerCycle = (pat: any, cycles: number) =>
  Array.from({ length: cycles }, (_, c) => pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true).map((h: any) => h.value?.gain))

describe('#1602 — growing by repeating the steps changes nothing that plays', () => {
  it.each([
    ['<0.2 0.8>', 4],
    ['<0.2 0.8 0.5>', 6],
    ['<0.2@2 0.8>', 4],
    ['<0.2 0.8>/2', 6],
  ])('%s grown to %i', async (steps, n) => {
    const d2 = `s("hh*4").gain("${steps}")`
    const [a] = steppedAutomations(parseStrudel(`$: ${d2}`) as never)
    const src = `$: ${d2}`
    const r = stepCountEdit(a, n, src)!
    expect(r.keepsSound).toBe(true)
    const after = src.slice(0, r.edit.range[0]) + r.edit.text + src.slice(r.edit.range[1])
    const before = await evaluate({ x: d2 })
    const edited = await evaluate({ x: after.slice(3) })
    expect(gainsPerCycle(edited.x, 24)).toEqual(gainsPerCycle(before.x, 24))
  }, 120_000)
})

describe('#1602 — the preview says what the edited song will repeat at', () => {
  const D1 = 's("<bd sd cp hh>")'
  it.each([
    // [hat gain before, new count, the repeat the engine gives after]
    ['<0.2 0.8 0.5>', 2, 4],
    ['<0.2 0.8 0.5>', 4, 4],
    ['<0.2 0.8 0.5>', 5, 20],
    ['<0.2 0.8>', 3, 12],
    ['<0.2 0.8>', 4, 4],
  ])('hat gain %s changed to %i steps', async (steps, n, expected) => {
    const { code, analysis } = await analyse(D1, `s("hh*4").gain("${steps}")`)
    const a = steppedAutomations(parseStrudel(code) as never).find((x) => x.trackId === 'd2')!
    const r = stepCountEdit(a, n, code)!
    const preview = previewRepeat(analysis, 'd2', [songPeriodOf({ periodCycles: r.periodCycles, placements: a.placements })!])

    const out = code.slice(0, r.edit.range[0]) + r.edit.text + code.slice(r.edit.range[1])
    const [, d2After] = out.split('\n').map((l) => l.slice(3))
    const measured = (await analyse(D1, d2After)).analysis.repeatCycles
    expect(measured, 'the engine').toBe(expected)
    expect(preview, `preview for ${out}`).toBe(measured)
  }, 120_000)

  it('the control: the lane\'s own period, not its rest, would preview the old steps back in', async () => {
    const { analysis } = await analyse(D1, 's("hh*4").gain("<0.2 0.8 0.5>")')
    const hat = analysis.lanePeriods.find((l) => l.laneKey === 'd2')!
    expect(hat).toEqual({ laneKey: 'd2', periodCycles: 3, restCycles: 1 })
    // What the preview would say for 2 steps if it started from the lane's own period.
    const kick = analysis.lanePeriods.find((l) => l.laneKey === 'd1')!.periodCycles!
    const lanesOwn: number[] = [kick, hat.periodCycles!, 2]
    expect(lanesOwn.reduce((x, y) => (x * y) / gcd(x, y))).toBe(12)
  }, 120_000)
})

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
