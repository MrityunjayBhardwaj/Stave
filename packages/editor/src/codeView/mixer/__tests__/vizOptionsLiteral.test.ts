import { describe, it, expect } from 'vitest'
import { readVizOptionsLiteral, resolveVizOptions } from '../vizOptionsLiteral'

// #2385 — the background follows the options the code writes. What can be read
// without running code is read; the rest is named so the last evaluation fills it.

describe('readVizOptionsLiteral', () => {
  it('reads literal values: strings, numbers, booleans, null, negatives, arrays, objects', () => {
    expect(
      readVizOptionsLiteral(`{ delay: 0.8, theme: 'transparent', emit: true, x: null, y: -2, f: [2, 3, 1], o: { a: "b" }, t: \`plain\`, 'q': 1 }`),
    ).toEqual({
      kind: 'literal',
      values: { delay: 0.8, theme: 'transparent', emit: true, x: null, y: -2, f: [2, 3, 1], o: { a: 'b' }, t: 'plain', q: 1 },
      dynamic: [],
    })
  })

  it('names keys whose values only an evaluation can produce', () => {
    expect(readVizOptionsLiteral(`{ theme: 'white', delay: slider(0.8), levels: 0.1 * 3, f: [a, 1], t: \`\${x}\` }`)).toEqual({
      kind: 'literal',
      values: { theme: 'white' },
      dynamic: ['delay', 'levels', 'f', 't'],
    })
  })

  it('a later duplicate key wins, as it does when the code runs', () => {
    expect(readVizOptionsLiteral(`{ theme: pick(), theme: 'white' }`)).toEqual({
      kind: 'literal', values: { theme: 'white' }, dynamic: [],
    })
    expect(readVizOptionsLiteral(`{ theme: 'white', theme: pick() }`)).toEqual({
      kind: 'literal', values: {}, dynamic: ['theme'],
    })
  })

  it('is opaque for what it cannot read as one object: a variable, a spread, a computed key, junk', () => {
    for (const raw of ['opts', '{ ...base, theme: "white" }', '{ [k]: 1 }', '{ theme: ', '{ a: 1 } + 1', '{ m() { return 1 } }']) {
      expect(readVizOptionsLiteral(raw)).toEqual({ kind: 'opaque' })
    }
  })
})

describe('resolveVizOptions', () => {
  const evaluated = { theme: 'transparent', delay: 0.5, levels: 0.3 }

  it('no options argument → none', () => {
    expect(resolveVizOptions(null, evaluated)).toEqual({})
  })

  it('literal values come from the code, even when the last evaluation said otherwise', () => {
    expect(resolveVizOptions({ kind: 'literal', values: { theme: 'white' }, dynamic: [] }, evaluated)).toEqual({ theme: 'white' })
  })

  it('a key removed from the code is gone, not kept from the last evaluation', () => {
    expect(resolveVizOptions({ kind: 'literal', values: { delay: 1 }, dynamic: [] }, evaluated)).toEqual({ delay: 1 })
  })

  it('a dynamic key takes the last evaluated value, or is left out before any', () => {
    const code = { kind: 'literal' as const, values: { theme: 'white' }, dynamic: ['levels'] }
    expect(resolveVizOptions(code, evaluated)).toEqual({ theme: 'white', levels: 0.3 })
    expect(resolveVizOptions(code, null)).toEqual({ theme: 'white' })
  })

  it('opaque falls back to the last evaluation entirely', () => {
    expect(resolveVizOptions({ kind: 'opaque' }, evaluated)).toEqual(evaluated)
    expect(resolveVizOptions({ kind: 'opaque' }, null)).toEqual({})
  })
})
