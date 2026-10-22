/**
 * eventValueKey — the key's claim is that it reads the WHOLE value partition.
 * These arms are what make the claim checkable rather than aspirational: a
 * drift gate against the adapter's own field set, one arm per axis the old
 * three-field token was blind to, and the exclusions asserted as exclusions.
 */
import { describe, it, expect } from 'vitest'
import { eventValueKey, VALUE_SLOTS, PROVENANCE_FIELDS, TIME_FIELDS } from '../eventValueKey'
import { KNOWN_VALUE_FIELDS } from '../../../engine/NormalizedHap'
import type { IREvent } from '../IREvent'

const base = (over: Partial<IREvent> = {}): IREvent => ({
  begin: 0,
  end: 0.25,
  endClipped: 0.25,
  note: null,
  freq: null,
  s: null,
  gain: 1,
  velocity: 1,
  color: null,
  ...over,
})

describe('drift against the adapter that defines the partition', () => {
  it('reads every dedicated slot the normaliser fills, and only those', () => {
    // `n` is read through its fold into `note` (`value?.note ?? value?.n`), not
    // through its own slot — see `VALUE_SLOTS`. `type` is a declared IREvent
    // slot no producer writes yet, and is read anyway so it starts counting the
    // day one does.
    const fromAdapter = [...KNOWN_VALUE_FIELDS].filter((f) => f !== 'n').sort()
    const fromKey = [...VALUE_SLOTS].filter((f) => f !== 'type').sort()
    expect(fromKey).toEqual(fromAdapter)
  })

  it('excludes time and provenance by name, so an exclusion is never a forgotten field', () => {
    const key = eventValueKey(base())
    for (const f of [...TIME_FIELDS, ...PROVENANCE_FIELDS]) expect(key).not.toContain(`${f}=`)
  })
})

describe('the axes the three-field token was blind to', () => {
  it('separates two sounds', () => {
    expect(eventValueKey(base({ s: 'bd' }))).not.toBe(eventValueKey(base({ s: 'hh' })))
  })

  it('separates two params — the ~250 off-list controls route here', () => {
    expect(eventValueKey(base({ s: 'bd', params: { speed: 1 } }))).not.toBe(
      eventValueKey(base({ s: 'bd', params: { speed: 2 } })),
    )
  })

  it('separates two gains', () => {
    expect(eventValueKey(base({ s: 'bd', gain: 0.3 }))).not.toBe(
      eventValueKey(base({ s: 'bd', gain: 0.9 })),
    )
  })

  it('still separates values several steps apart — rounding merges noise, not music (#1617)', () => {
    // Ten steps of the 1e-6 grid, so the arm is not balanced on a single grid line.
    expect(eventValueKey(base({ params: { cutoff: 1000 } }))).not.toBe(eventValueKey(base({ params: { cutoff: 1000.00001 } })))
    expect(eventValueKey(base({ gain: 0.5 }))).not.toBe(eventValueKey(base({ gain: 0.50001 })))
  })

  it('still separates two notes — the axis that already worked', () => {
    expect(eventValueKey(base({ note: 'c4' }))).not.toBe(eventValueKey(base({ note: 'e4' })))
  })
})

describe('what must stay the SAME, or every cycle differs and no period is ever found', () => {
  it('two identical sounds at different times agree', () => {
    expect(eventValueKey(base({ s: 'bd', begin: 0, end: 0.5, endClipped: 0.5 }))).toBe(
      eventValueKey(base({ s: 'bd', begin: 7.25, end: 7.75, endClipped: 7.75 })),
    )
  })

  it('two identical sounds from different source positions agree', () => {
    expect(
      eventValueKey(
        base({ s: 'bd', loc: [{ start: 0, end: 4 }], trackId: 'd1', irNodeId: 'a', armIndex: 0 }),
      ),
    ).toBe(
      eventValueKey(
        base({ s: 'bd', loc: [{ start: 90, end: 94 }], trackId: 'd2', irNodeId: 'b', armIndex: 3 }),
      ),
    )
  })

  // #1617 — a continuous signal sampled on the same beat in two passes differs in its last
  // bits; a key that kept them made every cycle of a swept track differ.
  it('two values that differ only by float noise agree, in a param, a gain and a nested array', () => {
    expect(0.1 + 0.2).not.toBe(0.3) // the noise is real
    expect(eventValueKey(base({ params: { cutoff: 0.1 + 0.2 } }))).toBe(eventValueKey(base({ params: { cutoff: 0.3 } })))
    expect(eventValueKey(base({ gain: 0.1 + 0.2 }))).toBe(eventValueKey(base({ gain: 0.3 })))
    expect(eventValueKey(base({ params: { x: ['bd', 0.1 + 0.2] } }))).toBe(eventValueKey(base({ params: { x: ['bd', 0.3] } })))
  })

  it('near zero, the step is absolute: a value a few bits off zero agrees with zero, and -0 with 0', () => {
    expect(eventValueKey(base({ params: { pan: 1.2246467991473532e-16 } }))).toBe(eventValueKey(base({ params: { pan: 0 } })))
    expect(eventValueKey(base({ params: { pan: -0 } }))).toBe(eventValueKey(base({ params: { pan: 0 } })))
  })

  it('param order does not decide identity', () => {
    expect(eventValueKey(base({ params: { speed: 2, room: 0.4 } }))).toBe(
      eventValueKey(base({ params: { room: 0.4, speed: 2 } })),
    )
  })
})

describe('shapes that would otherwise collide', () => {
  it('the number 3 and the string "3" are different sounds', () => {
    expect(eventValueKey(base({ note: 3 }))).not.toBe(eventValueKey(base({ note: '3' })))
  })

  it('null is not the string "null", and absent is not null', () => {
    expect(eventValueKey(base({ s: null }))).not.toBe(eventValueKey(base({ s: 'null' })))
    expect(eventValueKey(base({ params: { x: null } }))).not.toBe(
      eventValueKey(base({ params: {} })),
    )
  })

  it("a `:`-variant's N-element array is not its own string spelling", () => {
    // krill lowers `bd:3` to the ARRAY ["bd", 3]; a stringly key would fold it
    // onto the literal text and lose the member count.
    expect(eventValueKey(base({ params: { x: ['bd', 3] } }))).not.toBe(
      eventValueKey(base({ params: { x: 'bd,3' } })),
    )
  })

  it('never throws on a value JSON refuses — it degrades to one token', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => eventValueKey(base({ params: { x: cyclic } }))).not.toThrow()
    expect(eventValueKey(base({ params: { x: cyclic } }))).toContain('[unserializable]')
  })

  it('a function is not a value that sounded', () => {
    expect(() => eventValueKey(base({ params: { x: () => 1 } }))).not.toThrow()
  })
})
