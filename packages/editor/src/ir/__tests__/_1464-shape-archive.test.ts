/**
 * #1464 shape stage — two claims the menu's scope rests on.
 *
 * A1  archive census: how many drawable curves are a BIPOLAR kind under an explicit
 *     `.range()` (the lane labels lo→hi; the engine plays 2·lo−hi..hi) — and the kind
 *     histogram over all 558 documents.
 * A2  a swap inside one class (repeating ↔ repeating, same polarity) leaves the song
 *     periods the analysis folds in unchanged; the rival, a swap to noise, does not.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations, shapeAlternatives } from '../signalAutomation'
import { signalDimensionsOf } from '../songAnalysis'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

describe('#1464 shape archive probe', () => {
  it.skipIf(!hasCorpusArchive())('A1 — kinds, and bipolar kinds under a range', async () => {
    const corpus = await loadEveryCorpusDocument()
    const byKind: Record<string, number> = {}
    const bipolarRanged: string[] = []
    let curves = 0
    let docsWithCurves = 0
    let withShapeSpan = 0
    let menuOpens = 0
    const spanMismatch: string[] = []
    for (const { name, code } of corpus) {
      let found
      try {
        found = signalAutomations(parseStrudel(code) as never)
      } catch {
        continue
      }
      if (found.length) docsWithCurves++
      for (const a of found) {
        curves++
        if (a.spans.shape) withShapeSpan++
        if (a.spans.shape && shapeAlternatives(a.kind).length > 0) menuOpens++
        if (a.spans.shape && code.slice(a.spans.shape.start, a.spans.shape.end) !== a.kind) spanMismatch.push(`${name} @${a.spans.shape.start}`)
        byKind[a.kind] = (byKind[a.kind] ?? 0) + 1
        if (a.kind.endsWith('2') && a.ranged) {
          const s = a.spans.shape
          bipolarRanged.push(`${name} ${s ? code.slice(s.start, s.end + 30) : a.kind}`)
        }
      }
    }
    console.log('A1 documents', corpus.length, 'withCurves', docsWithCurves, 'curves', curves)
    console.log('A1 byKind', JSON.stringify(Object.entries(byKind).sort((x, y) => y[1] - x[1])))
    console.log('A1 withShapeSpan', withShapeSpan, 'menuOpens', menuOpens, 'spanMismatch', spanMismatch.length, JSON.stringify(spanMismatch.slice(0, 10)))
    console.log('A1 bipolarRanged', bipolarRanged.length, JSON.stringify(bipolarRanged.slice(0, 20)))
    expect(corpus.length).toBe(558)
  })

  it('A2 — a same-class swap keeps the folded periods; a swap to noise does not', () => {
    const periods = (kind: string) =>
      signalDimensionsOf(parseStrudel(`s("bd*8").cutoff(${kind}.slow(4).range(200, 2000))`) as never).periods
    const sine = periods('sine')
    console.log('A2', JSON.stringify({ sine, tri: periods('tri'), square: periods('square'), perlin: periods('perlin'), rand: periods('rand') }))
    expect(sine).toEqual([4])
    for (const k of ['cosine', 'saw', 'isaw', 'tri', 'itri', 'square']) expect(periods(k), k).toEqual(sine)
    expect(periods('perlin'), 'rival: noise folds nothing in').not.toEqual(sine)
    expect(periods('rand')).toEqual(periods('perlin'))
  })
})
