// @vitest-environment node
/**
 * arrange-materialize-haps.test.ts — #489 HAPS GROUNDING.
 *
 * The `materializeBareDelete` serializer rewrites a bare loop `s("bd*4")` into
 *   `arrange([i, pat], [1, silence], [span−i−1, pat])`
 * to carve a one-cycle gap at bar `i`. Before the app builds on that shape, we
 * GROUND its runtime semantics against the REAL Strudel evaluator (parity-style:
 * evalScope + miniAllStrings, then evaluate/queryArc per cycle) — observe, don't
 * infer. We assert the carved gap actually lands where the serializer claims.
 *
 * Boot + kabelsalat stub: inherited from vitest.config.ts (see parity.test.ts
 * header). We import the evaluator package roots, never the dist barrel (P172).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'

beforeAll(async () => {
  await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
  miniAllStrings()
})

type StrudelHap = { value?: { s?: string }; whole?: { begin?: { valueOf(): number } } }
type StrudelPattern = { queryArc: (begin: number, end: number) => StrudelHap[] }

/** Count of sounding haps (deduped by whole.begin) in each cycle [0, cycles). */
async function hapsPerCycle(code: string, cycles: number): Promise<number[]> {
  const { pattern } = (await evaluate(code)) as { pattern: StrudelPattern }
  const counts: number[] = []
  for (let c = 0; c < cycles; c++) {
    const haps = pattern.queryArc(c, c + 1)
    // dedupe boundary-clipped copies by un-clipped onset
    const begins = new Set(haps.map((h) => h.whole?.begin?.valueOf()))
    counts.push(begins.size)
  }
  return counts
}

describe('#489 materializeBareDelete — runtime gap (haps grounding)', () => {
  it('bare s("bd*4") loops bd*4 in every cycle (4 kicks/cycle)', async () => {
    const counts = await hapsPerCycle('s("bd*4")', 4)
    expect(counts).toEqual([4, 4, 4, 4])
  })

  it('delete bar 2 of a 4-bar arrangement → bd*4 at cycles 0,1,3, SILENCE at 2', async () => {
    // The exact shape materializeBareDelete emits for barIndex=2, span=4.
    const code = 'arrange([2, s("bd*4")], [1, silence], [1, s("bd*4")])'
    const counts = await hapsPerCycle(code, 4)
    expect(counts).toEqual([4, 4, 0, 4])
  })

  it('delete bar 0 → leading pat dropped, silence at cycle 0', async () => {
    // barIndex=0, span=4 → no leading arm: arrange([1, silence], [3, pat])
    const code = 'arrange([1, silence], [3, s("bd*4")])'
    const counts = await hapsPerCycle(code, 4)
    expect(counts).toEqual([0, 4, 4, 4])
  })

  it('delete last bar (3) → trailing pat dropped, silence at cycle 3', async () => {
    // barIndex=3, span=4 → no trailing arm: arrange([3, pat], [1, silence])
    const code = 'arrange([3, s("bd*4")], [1, silence])'
    const counts = await hapsPerCycle(code, 4)
    expect(counts).toEqual([4, 4, 4, 0])
  })

  it('SPLIT a bare loop is sonically IDENTICAL — two arms, no gap', async () => {
    // materializeBareSplit(barIndex=2, span=4) → arrange([2, pat], [2, pat]).
    // The split-first reframe requires zero audible change: a uniform loop tiled
    // across 4 cycles plays the same whether bare or split into two arms.
    const split = await hapsPerCycle('arrange([2, s("bd*4")], [2, s("bd*4")])', 4)
    expect(split).toEqual([4, 4, 4, 4])
  })
})
