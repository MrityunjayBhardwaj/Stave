import { describe, it, expect } from 'vitest'
import { detectAllChunks } from '../../../codeView/chunkDetect'
import { knobsFromChunk } from '../MixerBody'
import { customRange } from '../knobRanges'

/**
 * Guardrail invariant (#847): code the Mixer UI doesn't model must stay INERT —
 * an unsupported effect or a malformed range in the text must never crash the
 * panel, spawn phantom dials, produce a NaN/Infinity dial, or let the range
 * popup clobber code it can't understand. The strip is a projection; unmodelled
 * input projects to "hands off", not to a broken control.
 */
function knobsFor(doc: string) {
  return knobsFromChunk(detectAllChunks(doc)[0])
}

describe('guardrails — unsupported code stays inert (#847)', () => {
  it('an unsupported CONTROL with extra args gets ONE dial, not phantom dials', () => {
    // chorus/detune are real Strudel controls but not in the effect catalog.
    // They are unary → their extra args are runtime-ignored → one dial each.
    expect(knobsFor('$: s("bd").chorus(0.5, 0, 100)').filter((k) => k.method === 'chorus')).toHaveLength(1)
    expect(knobsFor('$: note("c").detune(12, 3)').filter((k) => k.method === 'detune')).toHaveLength(1)
  })

  it('a signal in a range slot → no custom range and NOT range-editable (never clobbered)', () => {
    const [k] = knobsFor('$: s("bd").room(0.4, sine, 100)')
    expect(k.method).toBe('room')
    expect(k.value).toBe(0.4)
    expect(k.customRange).toBeUndefined()
    expect(k.rangeEditable).toBe(false)
  })

  it('extra (3+) args beyond the range slots → inert: one dial, no range, not editable', () => {
    const [k] = knobsFor('$: s("bd").room(0.4, 0, 100, 999)')
    expect(k.value).toBe(0.4)
    expect(k.customRange).toBeUndefined()
    expect(k.rangeEditable).toBe(false)
  })

  it('a lone extra arg is ambiguous → no custom range, not editable', () => {
    const [k] = knobsFor('$: s("bd").room(0.4, 50)')
    expect(k.customRange).toBeUndefined()
    expect(k.rangeEditable).toBe(false)
  })

  it('a non-finite range bound → no custom range, not editable (never a NaN/∞ dial)', () => {
    const [k] = knobsFor('$: s("bd").room(0.4, 0, 1e999)')
    expect(k.customRange).toBeUndefined()
    expect(k.rangeEditable).toBe(false)
  })

  it('a value ABOVE its custom range widens the max so the dial stays accurate', () => {
    const [k] = knobsFor('$: s("bd").room(150, 0, 100)')
    expect(k.customRange).toEqual({ min: 0, max: 100 })
    // the render widens to include the authored value
    const r = customRange(k.customRange!.min, k.customRange!.max, k.value)
    expect(r.max).toBeGreaterThanOrEqual(150)
    expect(r.min).toBe(0) // the bound it did NOT violate is left alone
  })

  it('a value BELOW its custom range widens the min — the dial floor is the value, not the authored min', () => {
    // The mirror of the case above, and the one that reads as a bug if you only
    // know the authored text: `.room(0.4, 10, 90)` declares a floor of 10, but 0.4
    // sits under it, so the dial's floor is 0.4. Pinning to 10 would make the dial
    // misreport the code — and the first drag would silently rewrite the value.
    const [k] = knobsFor('$: s("bd").room(0.4, 10, 90)')
    expect(k.customRange).toEqual({ min: 10, max: 90 })
    const r = customRange(k.customRange!.min, k.customRange!.max, k.value)
    expect(r.min).toBe(0.4)
    expect(r.max).toBe(90) // the bound it did NOT violate is left alone
  })

  it('a value INSIDE its custom range leaves both bounds exactly as authored', () => {
    const [k] = knobsFor('$: s("bd").room(50, 10, 90)')
    const r = customRange(k.customRange!.min, k.customRange!.max, k.value)
    expect(r.min).toBe(10)
    expect(r.max).toBe(90)
  })

  it('a genuinely multi-arg NON-control keeps its dials and is not range-editable', () => {
    const knobs = knobsFor('$: s("bd").euclid(3, 8)')
    expect(knobs).toHaveLength(2)
    expect(knobs.every((k) => k.rangeEditable === false)).toBe(true)
  })

  it('a foreign (signal) value on a control → no dial at all (hands off)', () => {
    const knobs = knobsFor('$: s("bd").room(sine)')
    expect(knobs.filter((k) => k.method === 'room')).toHaveLength(0)
  })
})
