/**
 * #1602 — the step-count edit, through the REAL parser and the real stepped reader.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { steppedAutomations } from '../steppedAutomation'
import { stepCountEdit } from '../stepCount'

const read = (src: string) => steppedAutomations(parseStrudel(src) as never)
const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])
const change = (src: string, n: number) => {
  const r = stepCountEdit(read(src)[0], n, src)
  return r && { ...r, out: apply(src, r.edit) }
}

describe('stepCountEdit — growing', () => {
  it('to a multiple repeats the steps, and keeps the sound', () => {
    const r = change('$: s("bd*2").gain("<0.2 0.8>")', 4)!
    expect(r.out).toBe('$: s("bd*2").gain("<0.2 0.8 0.2 0.8>")')
    expect(r).toMatchObject({ steps: 4, periodCycles: 4, keepsSound: true, dropsWritten: false })
  })

  it('to any other count continues from the start — nothing lost, but the sound changes', () => {
    const r = change('$: s("bd*2").gain("<0.2 0.8>")', 3)!
    expect(r.out).toBe('$: s("bd*2").gain("<0.2 0.8 0.2>")')
    expect(r).toMatchObject({ steps: 3, periodCycles: 3, keepsSound: false, dropsWritten: false })
  })

  it('keeps each step\'s own weight and spelling, and the literal\'s /n', () => {
    expect(change('$: s("bd*2").gain("<0.2@2 .8>")', 4)!.out).toBe('$: s("bd*2").gain("<0.2@2 .8 0.2@2 .8>")')
    expect(change('$: s("bd*2").gain("<0.2@2 .8>")', 4)!.periodCycles).toBe(6)
    expect(change('$: s("bd*2").gain("<0.3!3 0.8>")', 4)!.out).toBe('$: s("bd*2").gain("<0.3!3 0.8 0.3!3 0.8>")')
    const slowed = change('$: s("bd*2").gain("<0.2 0.8>/2")', 4)!
    expect(slowed.out).toBe('$: s("bd*2").gain("<0.2 0.8 0.2 0.8>/2")')
    expect(slowed.periodCycles).toBe(8)
  })

  it('keeps the quotes', () => {
    expect(change("$: s(\"bd*2\").gain('<0.2 0.8>')", 4)!.out).toBe("$: s(\"bd*2\").gain('<0.2 0.8 0.2 0.8>')")
    expect(change('$: s("bd*2").gain(`<0.2 0.8>`)', 4)!.out).toBe('$: s("bd*2").gain(`<0.2 0.8 0.2 0.8>`)')
  })
})

describe('stepCountEdit — shrinking', () => {
  it('to a divisor whose cut steps repeat the kept ones keeps the sound and loses nothing', () => {
    const r = change('$: s("bd*2").gain("<0.2 0.8 0.2 0.8>")', 2)!
    expect(r.out).toBe('$: s("bd*2").gain("<0.2 0.8>")')
    expect(r).toMatchObject({ keepsSound: true, dropsWritten: false })
  })

  it('compares steps by what they hold, not how they are spelled', () => {
    expect(change('$: s("bd*2").gain("<0.2 .8 .2 0.80>")', 2)).toMatchObject({ keepsSound: true, dropsWritten: false })
  })

  it('cutting a value the user wrote reports it', () => {
    const r = change('$: s("bd*2").gain("<0.2 0.8 0.5 0.3>")', 2)!
    expect(r.out).toBe('$: s("bd*2").gain("<0.2 0.8>")')
    expect(r).toMatchObject({ keepsSound: false, dropsWritten: true })
    // A weight that differs is a different step, even with the same number.
    expect(change('$: s("bd*2").gain("<0.2 0.8 0.2@2 0.8>")', 2)).toMatchObject({ dropsWritten: true })
  })

  it('to a non-divisor changes the sound even when every cut step repeats a kept one', () => {
    expect(change('$: s("bd*2").gain("<0.2 0.8 0.2>")', 2)).toMatchObject({ keepsSound: false, dropsWritten: false })
  })
})

describe('stepCountEdit — what it touches', () => {
  it('the stepped reader reads the result back as the new steps', () => {
    const src = '$: s("bd*2").gain("<0.2@2 0.8 0.5>")'
    for (const n of [1, 2, 4, 5, 6, 9]) {
      const r = change(src, n)!
      const [a] = read(r.out)
      expect(a.steps.map((s) => [s.value, s.weight]), `n=${n}`).toEqual(
        Array.from({ length: n }, (_, i) => [[0.2, 2], [0.8, 1], [0.5, 1]][i % 3]),
      )
      expect(a.periodCycles, `n=${n}`).toBe(r.periodCycles)
    }
  })

  it('changes no byte before the first number or after the closing >', () => {
    const src = '$: s("bd*2").gain( "< 0.2 0.8 >/2" ).room(0.3)'
    const r = change(src, 4)!
    expect(r.out.slice(0, r.edit.range[0])).toBe(src.slice(0, r.edit.range[0]))
    expect(r.out.slice(r.edit.range[0] + r.edit.text.length)).toBe(src.slice(r.edit.range[1]))
    expect(r.out).toBe('$: s("bd*2").gain( "< 0.2 0.8 0.2 0.8>/2" ).room(0.3)')
  })

  it('writes nothing for the same count, a bad count, or a source that moved', () => {
    const src = '$: s("bd*2").gain("<0.2 0.8>")'
    const [a] = read(src)
    for (const n of [2, 0, -1, 1.5, NaN]) expect(stepCountEdit(a, n, src), `n=${n}`).toBeNull()
    expect(stepCountEdit(a, 4, '$: s("bd*2").gain("<0.3 0.8>")')).toBeNull()
  })
})
