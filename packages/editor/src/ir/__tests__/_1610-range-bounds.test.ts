/**
 * #1610 probe — is a curve's reported range what the engine plays?
 *
 * P1  engine vs reader on the cases where `.range()`'s arguments and its result can differ.
 * P2  archive census (558 docs): how many drawable curves sit in each of those cases.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations } from '../signalAutomation'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

/* eslint-disable @typescript-eslint/no-explicit-any */

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
      .map((h: any) => Math.round(h.value.cutoff * 1000) / 1000)
  } finally {
    clearStringParser({ core })
  }
}

const CASES: [string, string][] = [
  ['unipolar control', 'sine.slow(4).range(200, 2000)'],
  ['bipolar under range', 'sine2.slow(4).range(200, 2000)'],
  ['bipolar tri2', 'tri2.slow(4).range(200, 2000)'],
  ['bipolar range(0,1)', 'sine2.slow(4).range(0, 1)'],
  ['nested, inner 0..1 (control)', 'sine.slow(4).range(0, 1).range(2, 3)'],
  ['nested, inner 0..2', 'sine.slow(4).range(0, 2).range(2, 3)'],
  ['bipolar, inserted range(-1,0.5)', 'sine2.slow(4).range(-1, 0.5)'],
  ['inverted range', 'sine.slow(4).range(2000, 200)'],
  ['time under range', 'time.range(200, 800)'],
]

describe('#1610 probe', () => {
  it.each(CASES)('P1 %s', async (label, expr) => {
    const code = `s("bd*16").cutoff(${expr})`
    const xs = await cutoffs(code, 16)
    const [a] = signalAutomations(parseStrudel(`$: ${code}`) as never)
    console.log('P1', JSON.stringify({ label, expr, engine: [Math.min(...xs), Math.max(...xs)], reader: a ? [a.lo, a.hi, a.ranged] : null, n: xs.length }))
    expect(xs.length).toBe(256)
  })

  it.skipIf(!hasCorpusArchive())('P2 archive census', async () => {
    const corpus = await loadEveryCorpusDocument()
    let curves = 0
    const bucket: Record<string, string[]> = { bipolarRanged: [], bipolarUnranged: [], nestedRange: [], invertedRange: [], unboundedRanged: [], noChainSlice: [] }
    for (const { name, code } of corpus) {
      let found
      try {
        found = signalAutomations(parseStrudel(code) as never)
      } catch {
        continue
      }
      for (const a of found) {
        curves++
        const s = a.spans.shape
        const end = a.spans.chainEnd
        const text = s && end !== null ? code.slice(s.start, end) : null
        const tag = `${name} ${text ?? a.kind}`
        if (text === null) bucket.noChainSlice.push(tag)
        const bipolar = a.kind.endsWith('2')
        if (bipolar && a.ranged) bucket.bipolarRanged.push(tag)
        if (bipolar && !a.ranged) bucket.bipolarUnranged.push(tag)
        if (text && (text.match(/\.range\(/g) ?? []).length > 1) bucket.nestedRange.push(tag)
        if (a.ranged && a.lo > a.hi) bucket.invertedRange.push(tag)
        if (['time', 'cyclesPer', 'per', 'perCycle', 'perx'].includes(a.kind)) bucket.unboundedRanged.push(tag)
      }
    }
    console.log('P2 documents', corpus.length, 'curves', curves)
    for (const [k, v] of Object.entries(bucket)) console.log('P2', k, v.length, JSON.stringify(v.slice(0, 8)))
    expect(corpus.length).toBe(558)
  })
})
