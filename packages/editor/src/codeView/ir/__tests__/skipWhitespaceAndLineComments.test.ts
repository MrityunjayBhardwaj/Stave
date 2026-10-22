/**
 * skipWhitespaceAndLineComments.test.ts — PV49 shared primitive (20-15 α-2).
 *
 * The primitive MUST be byte-for-byte equivalent to the reference regex
 * `INTER_METHOD_SEP = /^(?:\s+|\/\/[^\n]*\n?)+/` that `applyChain`
 * already uses (the proven-tolerant chain walker). This test pins that
 * equivalence: for each input the consumed length
 * (`returned - pos`) must equal the regex's match length on
 * `src.slice(pos)`. The `${` case is an explicit no-consume assertion
 * (PV49 scope: `${}` is real JS, never whitespace).
 */
import { describe, it, expect } from 'vitest'
import { skipWhitespaceAndLineComments } from '../parseStrudel'

// Mirror of applyChain's INTER_METHOD_SEP (the reference behaviour).
const INTER_METHOD_SEP = /^(?:\s+|\/\/[^\n]*\n?)+/

function refConsumed(src: string, pos: number): number {
  const m = src.slice(pos).match(INTER_METHOD_SEP)
  return m ? m[0].length : 0
}

describe('skipWhitespaceAndLineComments — regex equivalence (PV49)', () => {
  const table: Array<{ name: string; src: string; pos: number }> = [
    { name: 'leading ws + inline // comment then token', src: '  // c\n  x', pos: 0 },
    { name: 'stacked blank lines + two // comments', src: '\n\n//a\n//b\nx', pos: 0 },
    { name: 'no-op (token at cursor)', src: 'x', pos: 0 },
    { name: 'trailing // comment with NO newline', src: '  // c', pos: 0 },
    { name: 'pure whitespace incl tabs/newlines', src: ' \t\n \r\n x', pos: 0 },
    { name: 'cursor mid-string at a comment', src: 'a.foo() // bar\n.baz()', pos: 7 },
    { name: 'CRLF + comment', src: '\r\n// win\r\nx', pos: 0 },
    { name: 'empty input', src: '', pos: 0 },
    { name: 'pos past end', src: 'abc', pos: 3 },
    { name: 'division operator is NOT a comment', src: ' a / b', pos: 0 },
  ]

  for (const { name, src, pos } of table) {
    it(`equals INTER_METHOD_SEP match length :: ${name}`, () => {
      const ret = skipWhitespaceAndLineComments(src, pos)
      expect(ret - pos).toBe(refConsumed(src, pos))
      // Returned index is absolute and within [pos, src.length].
      expect(ret).toBeGreaterThanOrEqual(pos)
      expect(ret).toBeLessThanOrEqual(src.length)
    })
  }

  it('does NOT consume `${` (PV49 scope — `${}` is real JS, not whitespace)', () => {
    expect(skipWhitespaceAndLineComments('${x}', 0)).toBe(0)
    // Leading whitespace IS consumed, but the scan stops AT `${`.
    expect(skipWhitespaceAndLineComments('  ${x}', 0)).toBe(2)
    expect(skipWhitespaceAndLineComments('  // c\n${x}', 0)).toBe(7)
  })

  it('trailing `\\n` of a `//` comment IS consumed (matches the regex `\\n?`)', () => {
    // "//c\n" -> all 4 chars consumed.
    expect(skipWhitespaceAndLineComments('//c\nX', 0)).toBe(4)
    expect(refConsumed('//c\nX', 0)).toBe(4)
  })

  it('non-zero pos is honoured as the absolute start (offset-additive contract)', () => {
    const src = 'root  // c\n  .chain()'
    const pos = 4 // index of the first space after "root"
    const ret = skipWhitespaceAndLineComments(src, pos)
    expect(ret - pos).toBe(refConsumed(src, pos))
    expect(src.slice(ret).startsWith('.chain()')).toBe(true)
  })
})
