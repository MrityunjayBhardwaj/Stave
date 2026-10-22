import { describe, it, expect } from 'vitest'
import { fnv1a } from '../nodeIdentity'

describe('20-05 — fnv1a (PV38 D-02 hash)', () => {
  it('is deterministic — same input twice yields same digest', () => {
    expect(fnv1a('5:10:Play:0')).toBe(fnv1a('5:10:Play:0'))
  })
  it('returns 8-char hex digest', () => {
    const out = fnv1a('5:10:Play:0')
    expect(out).toMatch(/^[0-9a-f]{8}$/)
  })
  it('different inputs yield different digests (sanity, not pairwise-distinct)', () => {
    expect(fnv1a('5:10:Play:0')).not.toBe(fnv1a('5:10:Play:1'))
    expect(fnv1a('5:10:Play:0')).not.toBe(fnv1a('5:11:Play:0'))
    expect(fnv1a('5:10:Play:0')).not.toBe(fnv1a('5:10:Pure:0'))
  })
})
