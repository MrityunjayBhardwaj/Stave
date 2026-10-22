import { describe, it, expect } from 'vitest'
import { runPasses, type Pass } from '../passes'

describe('runPasses', () => {
  it('empty pipeline returns []', () => {
    const out = runPasses(42, [])
    expect(out).toEqual([])
  })

  it('single identity pass over number labels and returns the value', () => {
    const id: Pass<number> = { name: 'id', run: (x) => x }
    const out = runPasses(42, [id])
    expect(out).toEqual([{ name: 'id', ir: 42 }])
  })

  it('multi-pass composition: each pass sees previous pass output', () => {
    const double: Pass<number> = { name: 'double', run: (x) => x * 2 }
    const plusOne: Pass<number> = { name: 'plusOne', run: (x) => x + 1 }
    const out = runPasses(1, [double, plusOne])
    expect(out).toEqual([
      { name: 'double', ir: 2 },
      { name: 'plusOne', ir: 3 },
    ])
  })

  it('generic IR shape — string', () => {
    const upper: Pass<string> = { name: 'upper', run: (s) => s.toUpperCase() }
    const out = runPasses('hi', [upper])
    expect(out).toEqual([{ name: 'upper', ir: 'HI' }])
  })

  it('generic IR shape — record/object', () => {
    type Rec = { value: number; tagged?: boolean }
    const tag: Pass<Rec> = { name: 'tag', run: (o) => ({ ...o, tagged: true }) }
    const out = runPasses<Rec>({ value: 7 }, [tag])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('tag')
    expect(out[0].ir).toEqual({ value: 7, tagged: true })
  })

  it('identity pass preserves referential equality (UV6 spirit — no unnecessary copies)', () => {
    const arr = [1, 2, 3]
    const id: Pass<number[]> = { name: 'id', run: (x) => x }
    const out = runPasses(arr, [id])
    expect(out[0].ir).toBe(arr)
  })

  it('runner does not mutate input', () => {
    const input = { value: 7, nested: [1, 2, 3] }
    const before = JSON.parse(JSON.stringify(input))
    const id: Pass<typeof input> = { name: 'id', run: (x) => x }
    runPasses(input, [id])
    expect(input).toEqual(before)
  })
})
