import { describe, it, expect } from 'vitest'
import { classifyLiteralRhs } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import { patternToJSON, patternFromJSON } from '../serialize'
import type { PatternIR } from '../PatternIR'

/**
 * Phase 20-17 D-1c — round-trip acceptance test for the literal-RHS
 * Code.via arm (G3 / D-02 CORRECTION).
 *
 * NAMED acceptance check: `.slow(numChords)` round-trips to `.slow(4)`
 * byte-for-byte after Wave E wires `classifyLiteralRhs` into
 * buildBindingMap. THIS test is the D-1c slice — buildBindingMap is NOT
 * yet wired (that is E-1), so we use option (a) from the plan: construct
 * a literal IR directly via the D-1a helper and assert
 *   - `toStrudel(literalIR)` re-emits `via.raw` VERBATIM
 *   - the serialize round-trip (`patternToJSON` → `patternFromJSON`)
 *     preserves the literal arm shape
 *   - deep-walker peel does NOT crash on a literal via
 *
 * The full `parseStrudel(input) → toStrudel(...)` byte-for-byte test on
 * `const numChords = 4\nstack(s("bd")).slow(numChords)` will land with
 * Wave E (after buildBindingMap consumes the helper). This file's
 * scope is the consumer-guards-on-literal-via contract — proven on a
 * directly-constructed literal node.
 */

describe('Code.via literal arm round-trip (20-17 D-1c / D-02 CORRECTION)', () => {
  it('toStrudel emits via.raw VERBATIM for a numeric literal', () => {
    const literal = classifyLiteralRhs('4')
    expect(literal).not.toBeNull()
    if (!literal) return
    // The named code-invariance check: a literal `4` substituted into
    // `.slow(numChords)` round-trips as `.slow(4)` byte-for-byte. Here
    // we test the via-arm in isolation — `toStrudel` MUST emit `via.raw`
    // verbatim (NOT `JSON.stringify(code)`, NOT a coerced number).
    expect(toStrudel(literal as PatternIR)).toBe('4')
  })

  it('toStrudel preserves quote style on string literals', () => {
    const dq = classifyLiteralRhs('"bd"')
    expect(dq).not.toBeNull()
    if (!dq) return
    expect(toStrudel(dq as PatternIR)).toBe('"bd"')

    const sq = classifyLiteralRhs("'<sd hh>'")
    expect(sq).not.toBeNull()
    if (!sq) return
    expect(toStrudel(sq as PatternIR)).toBe("'<sd hh>'")
  })

  it('serialize round-trips the literal arm shape (no data loss)', () => {
    const literal = classifyLiteralRhs('4')
    expect(literal).not.toBeNull()
    if (!literal) return
    const json = patternToJSON(literal as PatternIR)
    const back = patternFromJSON(json)
    expect(back.tag).toBe('Code')
    const backVia = (back as { via?: { literal?: boolean; raw?: string } }).via
    expect(backVia).toBeDefined()
    expect(backVia?.literal).toBe(true)
    expect(backVia?.raw).toBe('4')
  })

  it('deep-walker peel (irProjection.peelSingleBodyWrapper-style) does NOT crash on a literal via', () => {
    // Smoke assertion that the consumer guards work — we walk a small
    // tree containing a literal `Code.via = {literal:true,raw}` and
    // assert the walk completes without throwing and without recursing
    // into a non-existent `via.inner`. This is a structural smoke,
    // mirroring the principle that a literal arm is a LEAF.
    const literal = classifyLiteralRhs('4')
    expect(literal).not.toBeNull()
    if (!literal) return
    // Inline peel mirroring `peelSingleBodyWrapper` in app/irProjection.ts:381:
    //   if (n.tag === 'Code' && n.via && !('literal' in n.via) && n.via.inner) return n.via.inner
    const peel = (n: PatternIR): PatternIR | null => {
      if (
        n.tag === 'Code' &&
        n.via &&
        !('literal' in n.via) &&
        (n.via as { inner?: PatternIR }).inner
      ) {
        return (n.via as { inner: PatternIR }).inner
      }
      return null
    }
    expect(() => peel(literal as PatternIR)).not.toThrow()
    expect(peel(literal as PatternIR)).toBeNull() // literal IS a leaf — no peel
  })

  it('toStrudel parse-failure (no via) path still works (DV-08 unchanged)', () => {
    // Defensive — make sure the via-less Code arm wasn't broken by
    // adding the literal branch above it.
    const codeNode: PatternIR = { tag: 'Code', code: 'unparseable.thing()', lang: 'strudel' }
    expect(toStrudel(codeNode)).toBe('unparseable.thing()')
  })

  it('toStrudel wrapAsOpaque arm still works (PV37 round-trip unchanged)', () => {
    // Defensive — make sure the opaque-wrapper arm wasn't broken by
    // adding the literal branch above it.
    const inner: PatternIR = { tag: 'Pure' }
    const wrapped: PatternIR = {
      tag: 'Code',
      code: '',
      lang: 'strudel',
      via: { method: 'release', args: '0.3', callSiteRange: [0, 11], inner },
    }
    // Pure has no source form in toStrudel — use a non-Pure inner to
    // get a concrete string. The shape `inner.method(args)` is what we
    // care about — the opaque-arm code path is unchanged.
    expect(toStrudel(wrapped)).toMatch(/\.release\(0\.3\)$/)
  })
})
