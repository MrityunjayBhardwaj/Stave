import { describe, it, expect } from 'vitest'

import { detectAllChunks } from '../../chunkDetect'
import { parseManagedGain, scaleManagedGain, readGainState } from '../gain'

/** detect the single chunk in a one-statement doc */
function chunkOf(src: string) {
  const chunks = detectAllChunks(src)
  expect(chunks).toHaveLength(1)
  return chunks[0]
}

describe('parseManagedGain', () => {
  it('reads a per-column velocity string and its ceiling', () => {
    const mg = parseManagedGain('"0.5 1 0.8"')
    expect(mg).not.toBeNull()
    expect(mg!.tokens).toEqual(['0.5', '1', '0.8'])
    expect(mg!.ceiling).toBe(1)
    expect(mg!.quote).toBe('"')
  })

  it('ignores ~ rests when finding the ceiling', () => {
    expect(parseManagedGain('"0.5 ~ 0.9"')!.ceiling).toBe(0.9)
  })

  it('rejects a single-token broadcast and a foreign shape', () => {
    expect(parseManagedGain('"0.7"')).toBeNull() // single token = broadcast
    expect(parseManagedGain('"0.5 sine"')).toBeNull() // a token we didn't author
    expect(parseManagedGain('0.7')).toBeNull() // not quoted
  })
})

describe('scaleManagedGain', () => {
  it('rescales every column proportionally, keeping the shape and @holds', () => {
    const mg = parseManagedGain('"0.5 1 0.8@2"')!
    // drag the ceiling (1) down to 0.5 → factor 0.5
    expect(scaleManagedGain(mg, 0.5)).toBe('"0.25 0.5 0.4@2"')
  })

  it('preserves ~ rests', () => {
    const mg = parseManagedGain('"0.4 ~ 0.8"')!
    expect(scaleManagedGain(mg, 0.4)).toBe('"0.2 ~ 0.4"')
  })
})

describe('readGainState', () => {
  it('classifies a scalar gain', () => {
    const g = readGainState(chunkOf('$: s("bd").gain(0.85)'))
    expect(g.kind).toBe('scalar')
    if (g.kind === 'scalar') expect(g.value).toBe(0.85)
  })

  it('classifies a managed per-column gain at its ceiling', () => {
    const g = readGainState(chunkOf('$: s("bd sn").gain("0.5 1")'))
    expect(g.kind).toBe('managed')
    if (g.kind === 'managed') expect(g.ceiling).toBe(1)
  })

  it('classifies a signal/expression gain as foreign', () => {
    expect(readGainState(chunkOf('$: s("bd").gain(sine)')).kind).toBe('foreign')
  })

  it('classifies a missing gain as absent', () => {
    expect(readGainState(chunkOf('$: s("bd")')).kind).toBe('absent')
  })

  // #668 — a pick*/combinator group carries its levels on its CHILDREN, so the
  // outer strip can't show one scalar. When a child has `.gain`, report `foreign`
  // (honest read-only) rather than `absent` (a false unity 1 / 0.0 dB fader).
  it('a pickRestart with per-section gains reads foreign, not a false unity', () => {
    const src =
      'hats: "<a@4 b@4>".pickRestart({ a: s("hh").gain(1.36), b: s("oh").gain(0.5) })'
    expect(readGainState(chunkOf(src)).kind).toBe('foreign')
  })

  it('a pick group with NO child gain stays absent (outer .gain() still insertable)', () => {
    const src = 'hats: "<a@4 b@4>".pickRestart({ a: s("hh"), b: s("oh") })'
    expect(readGainState(chunkOf(src)).kind).toBe('absent')
  })

  it('a stack whose voices carry gains reads foreign', () => {
    expect(readGainState(chunkOf('$: stack(s("bd").gain(0.5), s("hh").gain(0.3))')).kind).toBe(
      'foreign',
    )
  })

  it('an outer .gain still wins over child gains (explicit outer level)', () => {
    const src = 'hats: "<a@4 b@4>".pickRestart({ a: s("hh").gain(1.36) }).gain(0.8)'
    const g = readGainState(chunkOf(src))
    expect(g.kind).toBe('scalar')
    if (g.kind === 'scalar') expect(g.value).toBe(0.8)
  })
})
