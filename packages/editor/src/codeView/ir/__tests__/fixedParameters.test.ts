/**
 * #1600 — fixed values, through the REAL parser (the stepped reader's discipline).
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { fixedParameters, fixedToStepsEdit } from '../fixedParameters'
import { steppedAutomations } from '../steppedAutomation'

const read = (src: string) => fixedParameters(parseStrudel(src) as never)
const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('fixedParameters — reads one number, as spelled', () => {
  it.each([
    ['$: s("bd*2").gain(0.8)', '0.8'],
    ['$: s("bd*2").gain(.8)', '.8'],
    ['$: s("bd*2").gain("0.8")', '0.8'],
    ['$: s("bd*2").gain(".8")', '.8'],
    ["$: s(\"bd*2\").gain('0.80')", '0.80'],
    ['$: s("bd*2").gain( 1 )', '1'],
  ])('%s', (src, text) => {
    const [f] = read(src)
    expect(f).toMatchObject({ trackId: 'd1', paramKey: 'gain', method: 'gain', valueText: text, sectionCycles: null })
    expect(f.value).toBe(Number(text))
  })

  it('keys by the canonical control and keeps the typed method', () => {
    expect(read('$: s("bd*2").lpf(800)')[0]).toMatchObject({ paramKey: 'cutoff', method: 'lpf' })
  })

  it('declines what is not one number', () => {
    for (const src of [
      '$: s("bd*2").gain("<0.2 0.8>")',
      '$: s("bd*2").gain("<0.8>")',
      '$: s("bd*2").gain("0.2 0.8")',
      '$: s("bd*2").gain(sine)',
      '$: s("bd*2").gain(0.8, 1)',
      '$: s("bd*2").gain(1e3)',
      '$: s("bd*2").gain("0.8" + "")',
    ]) expect(read(src), src).toEqual([])
  })

  it('declines under anything that moves time, and an overridden value', () => {
    for (const warp of ['.slow(2)', '.fast(2)', '.late(1)']) {
      expect(read(`$: s("bd*2").gain(0.8)${warp}`), warp).toEqual([])
    }
    // Control: the same value under nothing IS offered, so the warp is what declines.
    expect(read('$: s("bd*2").gain(0.8)')).toHaveLength(1)
    expect(read('$: s("bd*2").gain(0.8).gain(0.5)').map((f) => f.value)).toEqual([0.5])
  })

  it('an arranged value counts its section; two sections of different lengths decline', () => {
    expect(read('arrange([4, s("bd*2").gain(0.8)], [2, s("hh*4")])')[0].sectionCycles).toBe(4)
    expect(read('const a = s("bd*2").gain(0.8)\narrange([4, a], [2, s("hh*4")], [2, a])')).toEqual([])
    expect(read('const a = s("bd*2").gain(0.8)\narrange([4, a], [2, s("hh*4")], [4, a])')[0]?.sectionCycles).toBe(4)
    // A nested section counts the INNERMOST window's cycles.
    expect(read('arrange([2, arrange([1, s("bd*4").gain(0.8)], [1, s("sd*4")])], [1, s("hh*4")])')[0]?.sectionCycles).toBe(1)
  })
})

describe('fixedToStepsEdit — one edit, the argument only', () => {
  it.each([
    ['$: s("bd*2").gain(0.8)', 4, '$: s("bd*2").gain("<0.8 0.8 0.8 0.8>")'],
    ['$: s("bd*2").gain(.8).room(0.2)', 2, '$: s("bd*2").gain("<.8 .8>").room(0.2)'],
    ["$: s(\"bd*2\").gain('0.80')", 3, "$: s(\"bd*2\").gain('<0.80 0.80 0.80>')"],
    ['$: s("bd*2").gain( 1 )', 1, '$: s("bd*2").gain( "<1>" )'],
  ])('%s × %i', (src, n, want) => {
    // By key, not position: the walk meets the OUTER call of a chain first.
    const f = read(src).find((p) => p.paramKey === 'gain')!
    expect(apply(src, fixedToStepsEdit(f, n, src)!)).toBe(want)
  })

  it('the stepped reader reads the result back as N steps of v', () => {
    for (const n of [1, 2, 3, 4, 8]) {
      const src = '$: s("bd*2").gain(.8)'
      const out = apply(src, fixedToStepsEdit(read(src)[0], n, src)!)
      const [a] = steppedAutomations(parseStrudel(out) as never)
      expect(a.steps.map((s) => s.value), `n=${n}`).toEqual(Array(n).fill(0.8))
      expect(a.periodCycles).toBe(n)
    }
  })

  it('writes nothing for a bad count or a source that moved', () => {
    const src = '$: s("bd*2").gain(0.8)'
    const [f] = read(src)
    for (const n of [0, -1, 1.5, NaN]) expect(fixedToStepsEdit(f, n, src), `n=${n}`).toBeNull()
    expect(fixedToStepsEdit(f, 4, '$: s("bd*2").gain(0.5)')).toBeNull()
  })
})
