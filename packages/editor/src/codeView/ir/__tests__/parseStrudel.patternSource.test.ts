/**
 * Pattern-source root calls, delegated to acorn (#959 category B / #965).
 *
 * `note`/`n`/`s`/`sound`/`mini` applied to one string or backtick literal used
 * to be nine hand-rolled regexes — three name-groups × three quote styles.
 * They are now one acorn extraction (`extractPatternSourceCall`). This pins the
 * contract that collapse had to preserve: every one of the nine shapes still
 * parses to the same kind of node with the same sample-vs-note semantics, the
 * inner mini keeps its byte-exact source offset (loc fidelity, PV49), and every
 * shape the regexes DECLINED still falls through to the loose arm / bareCode.
 *
 * The parity corpus already proves no snapshot moved; this documents WHY, in
 * cases a reader can see, and guards the individual equivalences the corpus
 * happens not to exercise (e.g. `mini('…')` with single quotes).
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

function tags(node: PatternIR): string[] {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (typeof o.tag === 'string') out.push(o.tag)
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(node)
  return out
}
const has = (code: string, tag: string): boolean => tags(parseStrudel(code)).includes(tag)
/** The sample flag is observable through round-trip: `s`/`sound` normalise to
 *  `s("…")`, note-forms to `note("…")`. */
const rt = (code: string): string => toStrudel(parseStrudel(code))

describe('pattern-source root calls (#965)', () => {
  it('parses all three quote styles for note/n', () => {
    for (const code of ['note("0 2 4")', "note('0 2 4')", 'note(`0 2 4`)', 'n("0 2 4")']) {
      expect(has(code, 'Code'), `${code} should not opaque`).toBe(false)
      expect(has(code, 'Seq') || has(code, 'Play'), `${code} should be a pattern`).toBe(true)
    }
  })

  it('parses s/sound with SAMPLE semantics (sound is the alias of s)', () => {
    // Sample semantics survive the round-trip as `s("…")` for every spelling.
    expect(rt('s("bd sd")')).toBe('s("bd sd")')
    expect(rt("s('bd sd')")).toBe('s("bd sd")')
    expect(rt('sound("bd sd")')).toBe('s("bd sd")')
    expect(rt('sound(`bd sd`)')).toBe('s("bd sd")')
  })

  it('parses mini(…) as a value pattern in every quote style', () => {
    for (const code of ['mini("0 1")', "mini('0 1')", 'mini(`0 1`)']) {
      expect(has(code, 'Code'), `${code} should not opaque`).toBe(false)
    }
  })

  it('keeps the inner mini at its byte-exact source offset', () => {
    // The leaf's loc must point at the first atom INSIDE the quotes. In
    // `note("c3 e3")` the `c3` starts at char 6 (n=0 o=1 t=2 e=3 (=4 "=5 c=6).
    const ir = parseStrudel('note("c3 e3")') as unknown as { tracks?: unknown }
    let firstLeafStart: number | undefined
    const walk = (n: unknown): void => {
      if (firstLeafStart !== undefined || !n || typeof n !== 'object') return
      const o = n as Record<string, unknown>
      if (o.tag === 'Play') {
        const loc = (o.loc as Array<{ start?: number }> | undefined)?.[0]
        if (typeof loc?.start === 'number') firstLeafStart = loc.start
      }
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(ir)
    expect(firstLeafStart).toBe(6)
  })

  it('declines a chained inner, falling to the loose arm (#132)', () => {
    // `n("0 2".fast(2))` — the arg is itself a chained expression, so the plain
    // extraction declines and the loose recursive arm parses the chain.
    expect(has('n("0 2".fast(2))', 'Fast')).toBe(true)
  })

  it('declines a `${…}` template, reaching opaque Code as before', () => {
    expect(has('note(`${x}`)', 'Code')).toBe(true)
  })

  it('declines a non-source callee, so the stack arm still owns it', () => {
    // `stack(...)` is not a source call → the extraction declines and the stack
    // arm handles it; the `s("…")` arms inside still parse as samples.
    expect(has('stack(s("bd"),s("cp"))', 'Stack')).toBe(true)
    expect(has('stack(s("bd"),s("cp"))', 'Code')).toBe(false)
  })

  it('tolerates internal whitespace (acorn, like the old `\\s*`)', () => {
    expect(has('note ( "c3" )', 'Code')).toBe(false)
    expect(rt('note ( "c3" )')).toBe('note("c3")')
  })
})
