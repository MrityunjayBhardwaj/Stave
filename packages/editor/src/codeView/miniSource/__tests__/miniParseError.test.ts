// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { locateMiniParseError } from '../miniParseError'
import { miniParseFailure } from '../../strudelMini/tree'

/** the text a location points at in `doc`, one character */
const at = (doc: string, loc: { line: number; column: number } | null) =>
  loc ? doc.split('\n')[loc.line - 1][loc.column - 1] : null

const msg = (line: number) => `[mini] parse error at line ${line}: Expected something`

describe('miniParseFailure (#2174)', () => {
  it('is null for a string krill reads', () => {
    expect(miniParseFailure('bd [sd hh]*2 <a b>')).toBeNull()
  })
  it('is the offset of a stray character', () => {
    expect(miniParseFailure('bd sd]')).toBe(5)
  })
  it('is the end of the string when krill runs out of it', () => {
    expect(miniParseFailure('hh bd [sd')).toBe(9)
    expect(miniParseFailure('bd*')).toBe(3)
  })
})

describe('locateMiniParseError (#2174)', () => {
  it('finds the string Strudel’s own transpiler rejects, from its real message', async () => {
    const { transpiler } = await import('@strudel/transpiler')
    const doc = '$: s("bd")\n\n// hats\n$: s("hh bd sd]")'
    let message = ''
    try { transpiler(doc, { wrapAsync: true, addReturn: true, emitMiniLocations: true }) } catch (e) { message = (e as Error).message }
    expect(message).toMatch(/^\[mini\] parse error at line 4:/)
    const loc = locateMiniParseError(message, doc)
    expect(loc).toEqual({ line: 4, column: 15 })
    expect(at(doc, loc)).toBe(']')
  })

  it('an unclosed bracket lands on the closing quote', () => {
    const doc = '$: s("bd")\n$: s("hh [sd")'
    const loc = locateMiniParseError(msg(2), doc)
    expect(at(doc, loc)).toBe('"')
    expect(loc).toEqual({ line: 2, column: 13 })
  })

  it('never marks a single-quoted string, which Stave reads as a plain value when it is not mini', () => {
    // `'a]'` would fail krill, and it comes first on the line — but it is a plain
    // sound name in the app, so the error is the double-quoted string after it.
    const doc = "$: s('a]').n(\"0 1]\")"
    expect(at(doc, locateMiniParseError(msg(1), doc))).toBe(']')
    expect(locateMiniParseError(msg(1), doc)).toEqual({ line: 1, column: 18 })
    expect(locateMiniParseError(msg(1), "$: s('hh [sd')")).toBeNull()
  })

  it('with two rejected strings, takes the one on the reported line', () => {
    const doc = '$: s("bd]")\n$: s("hh]")'
    expect(locateMiniParseError(msg(2), doc)).toEqual({ line: 2, column: 9 })
    expect(locateMiniParseError(msg(1), doc)).toEqual({ line: 1, column: 9 })
  })

  it('with two rejected strings and none on the reported line, marks nothing', () => {
    const doc = '$: s("bd]")\n$: s("hh]")\n$: s("cp")'
    expect(locateMiniParseError(msg(3), doc)).toBeNull()
  })

  it('marks nothing when no string is rejected at all', () => {
    expect(locateMiniParseError(msg(1), '$: s("bd sd")')).toBeNull()
  })

  it('reads a template without ${…}, and leaves out one with it', () => {
    expect(locateMiniParseError(msg(1), '$: s(`bd sd]`)')).toEqual({ line: 1, column: 12 })
    expect(locateMiniParseError(msg(2), 'const n = 2\n$: s(`bd*${n}]`)')).toBeNull()
  })

  it('answers only a mini parse error, and only for a document that parses', () => {
    expect(locateMiniParseError('Unexpected token (1:3)', '$: s("hh]")')).toBeNull()
    expect(locateMiniParseError(undefined, '$: s("hh]")')).toBeNull()
    expect(locateMiniParseError(msg(1), '$: s("hh]"')).toBeNull()
  })
})
