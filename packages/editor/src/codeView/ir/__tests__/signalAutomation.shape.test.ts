/**
 * `shapeAlternatives` — which shapes a curve can be switched to by its identifier alone
 * (#1464). The engine arm beside this (`signalAutomation.shape.engine.test.ts`) checks
 * that a swap it offers keeps the range and the rate; this pins the table itself.
 */
import { describe, it, expect } from 'vitest'
import { shapeAlternatives, hasTruePeriod, type SignalKind } from '../signalAutomation'
import { CHAIN_ROOT_RECOGNISER } from '../parseStrudel'
import { signalDimensionsOf } from '../songAnalysis'
import { parseStrudel } from '../parseStrudel'

/** Every signal kind the parser recognises — read from the recogniser, never listed here. */
const ALL_KINDS: readonly SignalKind[] = [...CHAIN_ROOT_RECOGNISER.values()]
  .filter((d): d is { tag: 'Signal'; kind: SignalKind } => d.tag === 'Signal')
  .map((d) => d.kind)

describe('shapeAlternatives', () => {
  it('offers the other repeating shapes, most used first, never the current one', () => {
    expect(shapeAlternatives('sine')).toEqual(['tri', 'saw', 'cosine', 'square', 'isaw', 'itri'])
    expect(shapeAlternatives('saw')).toEqual(['sine', 'tri', 'cosine', 'square', 'isaw', 'itri'])
  })

  it('keeps a bipolar curve bipolar', () => {
    expect(shapeAlternatives('sine2')).toEqual(['tri2', 'saw2', 'cosine2', 'square2', 'isaw2', 'itri2'])
  })

  it('switches noise to noise', () => {
    expect(shapeAlternatives('perlin')).toEqual(['rand'])
    expect(shapeAlternatives('rand')).toEqual(['perlin'])
    expect(shapeAlternatives('berlin')).toEqual(['perlin', 'rand'])
  })

  it('offers nothing where no other shape keeps the class', () => {
    for (const k of ['time', 'mousex', 'mouseY', 'rand2', 'cyclesPer'] as SignalKind[]) {
      expect(shapeAlternatives(k), k).toEqual([])
    }
  })

  it('never crosses polarity or periodicity, for any kind the parser reads', () => {
    expect(ALL_KINDS.length).toBeGreaterThan(20)
    for (const k of ALL_KINDS) {
      for (const j of shapeAlternatives(k)) {
        expect(ALL_KINDS, `${k} offers ${j}, which the parser does not read`).toContain(j)
        expect(hasTruePeriod(j), `${k} → ${j} changes periodicity`).toBe(hasTruePeriod(k))
        expect(j.endsWith('2'), `${k} → ${j} changes polarity`).toBe(k.endsWith('2'))
      }
    }
  })

  it('offers every repeating kind from somewhere, so the table cannot fall behind the periodic set', () => {
    const offered = new Set(ALL_KINDS.flatMap((k) => shapeAlternatives(k)))
    for (const k of ALL_KINDS.filter(hasTruePeriod)) expect(offered, k).toContain(k)
  })

  it('leaves the periods the song folds in unchanged; the rival, a swap to noise, does not', () => {
    const periods = (kind: string) =>
      signalDimensionsOf(parseStrudel(`s("bd*8").cutoff(${kind}.slow(4).range(200, 2000))`) as never).periods
    for (const k of shapeAlternatives('sine')) expect(periods(k), k).toEqual(periods('sine'))
    expect(periods('sine')).toEqual([4])
    expect(periods('perlin')).not.toEqual(periods('sine'))
  })
})
