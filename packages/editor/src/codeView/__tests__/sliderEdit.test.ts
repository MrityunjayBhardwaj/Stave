import { describe, it, expect } from 'vitest'
import { sliderEdit } from '../sliderEdit'
import { applyEdits } from '../writeback'

/** #345 — what a slider drag writes over its number. */
describe('sliderEdit', () => {
  const doc = `$: s("bd").gain(slider(0.5, 0, 1))`
  const span: [number, number] = [doc.indexOf('0.5'), doc.indexOf('0.5') + 3]

  it('writes the value over the number, tidied as the knobs write numbers', () => {
    const edit = sliderEdit(doc, span, 0.7300000001)!
    expect(applyEdits(doc, [edit])).toBe(`$: s("bd").gain(slider(0.73, 0, 1))`)
    expect(applyEdits(doc, [sliderEdit(doc, span, 1)!])).toBe(`$: s("bd").gain(slider(1, 0, 1))`)
  })

  it('writes over a negative number too', () => {
    const neg = `$: s("bd").pan(slider(-0.5, -1, 1))`
    const at = neg.indexOf('-0.5')
    expect(applyEdits(neg, [sliderEdit(neg, [at, at + 4], 0.25)!])).toBe(`$: s("bd").pan(slider(0.25, -1, 1))`)
  })

  it('writes nothing when the span no longer holds a number, or the value is not one', () => {
    const moved = `$: s("bd").gain(sl(0.5, 0, 1))`
    expect(sliderEdit(moved, span, 0.7)).toBeNull()
    expect(sliderEdit(doc, [span[0], span[0]], 0.7)).toBeNull()
    expect(sliderEdit(doc, [span[0] - 1, span[1]], 0.7)).toBeNull() // `(0.5`
    expect(sliderEdit(doc, [span[0], doc.length + 1], 0.7)).toBeNull()
    expect(sliderEdit(doc, span, NaN)).toBeNull()
    expect(sliderEdit(doc, span, Infinity)).toBeNull()
  })
})
