/**
 * Section names, read off the user's own source (#1391).
 *
 * ── THE RANGES ARE REAL, NOT HAND-WRITTEN ────────────────────────────────────
 * Every arm range below comes from the REAL `parseStrudel` walking the document
 * in the same test — never a literal offset I typed. A hand-written `[125, 135]`
 * would pin this module to my arithmetic rather than to what `ArrangeArm.loc`
 * actually spans, and the whole premise of #1391 is that the IR's own
 * provenance already points at the name. If that stops being true, these arms
 * must fail; with typed offsets they would sail through.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '@stave/editor'
import type { PatternIR } from '@stave/editor'
import { resolveSectionName, positionalSectionName } from '../sectionLabel'
// The reader is the editor's since #1921 — the same rule a track label uses.
import { sectionNameAt as sectionNameAtRange } from '@stave/editor'

/** The `Arrange` node anywhere in a parsed document. */
function findArrange(n: PatternIR | null | undefined): PatternIR | null {
  if (!n || typeof n !== 'object') return null
  if (n.tag === 'Arrange') return n
  for (const v of Object.values(n as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      for (const c of v) {
        const r = findArrange(c as PatternIR)
        if (r) return r
      }
    } else if (v && typeof v === 'object') {
      const r = findArrange(v as PatternIR)
      if (r) return r
    }
  }
  return null
}

/** Each arm's real source range, straight off the parsed IR. */
function armRanges(code: string): Array<readonly [number, number]> {
  const arr = findArrange(parseStrudel(code))
  expect(arr, 'no Arrange in the document — the fixture is wrong').not.toBeNull()
  const arms = (arr as unknown as {
    arms: Array<{ loc?: Array<{ start: number; end: number }> }>
  }).arms
  return arms.map((a) => {
    const l = a.loc?.[0]
    expect(l, 'an arm carried no loc — nothing to read a name from').toBeDefined()
    return [l!.start, l!.end] as const
  })
}

const NAMED = `setcps(0.5)

const intro = s("bd ~ ~ ~")
const verse = stack(s("bd*2 sd*2"), s("hh*8"))
const outro = s("bd ~ ~ ~")

arrange([4, intro], [8, verse], [4, outro])
`

describe('the name a musician already wrote', () => {
  it('reads intro / verse / outro off the arms of a real document', () => {
    const ranges = armRanges(NAMED)
    expect(ranges).toHaveLength(3)
    expect(ranges.map((r) => sectionNameAtRange(NAMED, r))).toEqual([
      'intro',
      'verse',
      'outro',
    ])
  })

  it('the ranges really are the tuples — the premise, checked', () => {
    // If this fails, `ArrangeArm.loc` has stopped spanning `[n, pat]` and the
    // name is no longer where this module looks for it. Better to fail here,
    // saying exactly that, than to silently start returning positional names.
    const ranges = armRanges(NAMED)
    expect(ranges.map((r) => NAMED.slice(...r))).toEqual([
      '[4, intro]',
      '[8, verse]',
      '[4, outro]',
    ])
  })

  it('any identifier is a name, as it is for a track label (#1921)', () => {
    const code = 'const 前奏 = s("bd")\nconst café = s("hh")\narrange([4, 前奏], [8, café])'
    const ranges = armRanges(code)
    expect(ranges.map((r, i) => resolveSectionName(i, r, code))).toEqual(['前奏', 'café'])
  })

  it('a cat/slowcat arm is the pattern expression alone, not a tuple', () => {
    const code = 'const a = s("bd")\nconst b = s("hh")\ncat(a, b)'
    const ranges = armRanges(code)
    expect(ranges.map((r) => sectionNameAtRange(code, r))).toEqual(['a', 'b'])
  })
})

describe('an arm with no name in it', () => {
  it('an inline expression has no name to read', () => {
    const code = 'arrange([4, s("bd*4")], [8, s("hh*8").gain(0.7)])'
    const ranges = armRanges(code)
    expect(ranges.map((r) => sectionNameAtRange(code, r))).toEqual([null, null])
  })

  it('named and inline arms in ONE arrangement resolve independently', () => {
    // The mixed case, deliberately in one document rather than two fixtures:
    // a fallback that only works when every arm is unnamed would pass separate
    // fixtures and fail here.
    const code = 'const verse = s("bd*2")\narrange([4, s("bd")], [8, verse], [4, s("hh")])'
    const ranges = armRanges(code)
    expect(
      ranges.map((r, i) => resolveSectionName(i, r, code)),
    ).toEqual(['§1', 'verse', '§3'])
  })
})

describe('resolveSectionName — the fallback is an ordinal, never the music', () => {
  it('falls back when there is no code, no range, or a bad range', () => {
    expect(resolveSectionName(0, [0, 5], null)).toBe('§1')
    expect(resolveSectionName(1, null, NAMED)).toBe('§2')
    expect(resolveSectionName(2, undefined, NAMED)).toBe('§3')
    // Ranges that cannot be sliced must fall back rather than throw or return ''.
    expect(resolveSectionName(0, [-1, 5], NAMED)).toBe('§1')
    expect(resolveSectionName(0, [5, 5], NAMED)).toBe('§1')
    expect(resolveSectionName(0, [0, NAMED.length + 10], NAMED)).toBe('§1')
    expect(resolveSectionName(0, [Number.NaN, 5], NAMED)).toBe('§1')
  })

  it('the positional name is ONE definition, shared by both producers', () => {
    // The collector names an arm without holding the source; the resolver names
    // it with the source. If those two ever disagreed, a clip would be captioned
    // one way before the code arrived and another way after.
    for (const i of [0, 1, 7, 41]) {
      expect(resolveSectionName(i, null, null)).toBe(positionalSectionName(i))
    }
    expect(positionalSectionName(0)).toBe('§1')
  })

  it('a real name wins over the ordinal', () => {
    const ranges = armRanges(NAMED)
    expect(ranges.map((r, i) => resolveSectionName(i, r, NAMED))).toEqual([
      'intro',
      'verse',
      'outro',
    ])
  })
})

describe('it is a range reader, not a parser', () => {
  it('refuses anything that is not a bare identifier', () => {
    // Widening this to understand expressions would make it a second oracle for
    // a grammar `parseStrudel` already owns.
    for (const text of [
      's("bd")',
      'intro.fast(2)',
      'a + b',
      '4',
      '"verse"',
      'intro, verse',
      '',
      '   ',
    ]) {
      const code = `[4, ${text}]`
      expect(sectionNameAtRange(code, [0, code.length]), text).toBeNull()
    }
  })

  it('accepts the identifier shapes JS actually allows', () => {
    for (const name of ['intro', '_verse', '$hook', 'part2', 'A']) {
      const code = `[4, ${name}]`
      expect(sectionNameAtRange(code, [0, code.length])).toBe(name)
    }
  })

  it('tolerates whitespace the way a musician writes it', () => {
    expect(sectionNameAtRange('[ 4 ,   verse  ]', [0, 16])).toBe('verse')
  })
})
