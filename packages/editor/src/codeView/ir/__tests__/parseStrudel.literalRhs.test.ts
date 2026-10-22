import { describe, it, expect } from 'vitest'
import { classifyLiteralRhs } from '../parseStrudel'

/**
 * Phase 20-17 G3 (D-02 CORRECTION) — STRICT literal recognition contract.
 *
 * This spec PINS the matcher line that `classifyLiteralRhs` enforces. The
 * Wave-E bounded fixpoint loop will consume the helper post-parse; the
 * matcher line is what keeps "substitute a literal as term-splicing" from
 * silently becoming "evaluate an expression on the parser side".
 *
 * The matcher-line guarantee (still LOCKED — substitute, NEVER evaluate):
 *   - `via.raw` is byte-equal to the TRIMMED RHS for every literal case
 *     (term-splicing, never evaluation — `172/4` stays the string, we
 *     never compute `43`)
 *   - templates / calls / arrays / arrow / concat / operand-idents → null
 *
 * Phase 20-22 D-02 (the verdict lever) WIDENED the matcher to an
 * ENUMERATED arithmetic grammar: number literals joined by exactly the
 * four operators `/ * + -` (optional inter-token spaces) now classify as
 * literals whose `via.raw` is the verbatim source. So `4 + 1`, `4+1`,
 * `1 - 1`, `172/4` moved from negative → positive (the arithmetic arm).
 * The grammar stays CLOSED: parens, calls, operand identifiers (`bpm/2`),
 * `${}`-templates, and operators outside the set (`**`/`%`/`<<`) remain
 * null. THAT closure is now the matcher-line guarantee these tests pin.
 *
 * D-1a ships the type widen + this helper. D-1b (this file) locks the
 * contract. E-1 wires it into buildBindingMap. The single named home
 * is `classifyLiteralRhs` in parseStrudel.ts (alongside `wrapAsOpaque`).
 */

describe('classifyLiteralRhs — STRICT literal recognition (20-17 G3 / D-02 CORRECTION)', () => {
  describe('positives — bare literals classify and round-trip via.raw byte-equal', () => {
    const positives: Array<{ rhs: string; expectedRaw: string }> = [
      // Numbers — ANY JS numeric literal (`isNumericLiteral`, #957). The token
      // is no longer transcribed as a regex, so every spelling JS allows is
      // admitted and `via.raw` still splices byte-verbatim.
      { rhs: '4', expectedRaw: '4' },
      { rhs: '-3', expectedRaw: '-3' },
      { rhs: '0.5', expectedRaw: '0.5' },
      { rhs: '-12.75', expectedRaw: '-12.75' },
      // Leading decimal — the #957 regression. `const beat = .5` previously
      // returned null, which bails the WHOLE binding map and bare-Codes the
      // program even when the binding is unreferenced.
      { rhs: '.5', expectedRaw: '.5' },
      { rhs: '-.5', expectedRaw: '-.5' },
      { rhs: '5.', expectedRaw: '5.' },
      // Hex / exponent — moved up from the negatives list, where they were
      // described as cases "the strict regex rejects". That described the
      // implementation, not a requirement.
      { rhs: '0x10', expectedRaw: '0x10' },
      { rhs: '1e3', expectedRaw: '1e3' },
      { rhs: '1e-3', expectedRaw: '1e-3' },
      // Plain double-quoted — `^"[^"]*"$`
      { rhs: '"bd"', expectedRaw: '"bd"' },
      // Plain single-quoted — `^'[^']*'$`
      { rhs: "'<sd hh>'", expectedRaw: "'<sd hh>'" },
      // Phase 20-22 D-02 — enumerated arithmetic arm (`/ * + -` between
      // number tokens; raw is verbatim, NEVER evaluated to a result).
      { rhs: '172/4', expectedRaw: '172/4' },
      { rhs: '121.9/60/4', expectedRaw: '121.9/60/4' },
      { rhs: '4 + 1', expectedRaw: '4 + 1' },
      { rhs: '4+1', expectedRaw: '4+1' },
      { rhs: '1 - 1', expectedRaw: '1 - 1' },
      { rhs: '2*3', expectedRaw: '2*3' },
    ]

    for (const { rhs, expectedRaw } of positives) {
      it(`classifies "${rhs}" as a literal Code-with-via node`, () => {
        const node = classifyLiteralRhs(rhs)
        expect(node).not.toBeNull()
        if (!node) return
        // Tag + lang shape
        expect(node.tag).toBe('Code')
        expect(node.lang).toBe('strudel')
        // `code` is the trimmed RHS (mirrors `via.raw`)
        expect(node.code).toBe(expectedRaw)
        // via shape — literal arm
        expect(node.via).toBeDefined()
        expect(node.via.literal).toBe(true)
        // Round-trip assertion (the matcher's term-splicing contract):
        // via.raw is byte-equal to the trimmed RHS — NEVER coerced.
        // `4` stays the string "4", NOT the number 4.
        expect(node.via.raw).toBe(expectedRaw)
        expect(typeof node.via.raw).toBe('string')
      })
    }

    it('trims surrounding whitespace before matching (raw is the trimmed text)', () => {
      const node = classifyLiteralRhs('  4  ')
      expect(node).not.toBeNull()
      if (!node) return
      // The trim is part of the contract — `raw` is the TRIMMED RHS, not
      // the source-leading-whitespace version. This mirrors buildBindingMap's
      // existing `bm[2].trim()` call site so a literal classification on a
      // pre-trimmed RHS is byte-stable.
      expect(node.via.raw).toBe('4')
    })
  })

  describe('negatives — non-literal RHS returns null (caller keeps bare Code → opaque fence fires)', () => {
    const negatives: string[] = [
      // Phase 20-22 D-02 — the CLOSED-grammar boundary (these stay null;
      // admitting any of them would be the interpreter scope-creep trap):
      //   - operand identifier (would be a second binding ref, recursive)
      'bpm/2',
      'n / 4',
      //   - parenthesised grouping
      '(1+2)/3',
      '(4)',
      //   - operators outside the enumerated `/ * + -` set
      '2**3',
      '10%3',
      '1<<2',
      //   - leading / trailing / lone operator
      '/4',
      '4/',
      '*',
      // String concatenation (operands are quoted strings, not NUM tokens)
      '"a" + "b"',
      // Template literal
      '`x${n}`',
      // Function call
      'makeBass()',
      // Arrow function
      '() => x',
      'x => x + 1',
      // Array literal
      '[1,2]',
      '[1, 2, 3]',
      // Mini pattern call (a wrapped string, NOT a bare string literal)
      'n("0")',
      // Identifier reference (E-1 G2 territory — handled by bound-ident-root, not by literal classification)
      'numChords',
      // Empty / whitespace-only
      '',
      '   ',
      // Object literal
      '{a:1}',
      // NOTE (#957): `0x10` and `1e3` used to be listed here, described as
      // "edge cases that the strict regex rejects". That was a statement about
      // the IMPLEMENTATION, not a requirement — and it was the transcribed
      // number token's blind spot, the same one that made `.gain(.8)` opaque.
      // They are genuine JS numeric literals, `via.raw` is spliced BYTE-VERBATIM
      // (never evaluated), and Strudel evaluates the spliced text natively:
      // `const n = 0x10 … .slow(n)` now yields a structured Slow node where it
      // previously bailed the whole binding map and bare-Coded the program.
      // They moved to the positives list. Verified end-to-end, not assumed.
      // Concatenated strings that LOOK plain but contain interior unescaped quotes
      '"a"b"',
      // Single-quote with interior unescaped single quote
      "'a'b'",
    ]

    for (const rhs of negatives) {
      it(`rejects "${rhs}" (returns null)`, () => {
        expect(classifyLiteralRhs(rhs)).toBeNull()
      })
    }
  })

  describe('term-splicing contract — via.raw is NEVER evaluated', () => {
    it('a numeric literal stays a string in via.raw (no JS Number coercion)', () => {
      const node = classifyLiteralRhs('4')
      expect(node).not.toBeNull()
      if (!node) return
      // The classifier MUST NOT do `Number(t)` — that would erase the
      // string/number distinction Wave E's substitution depends on.
      // Splicing the term `4` into `.slow(numChords)` produces `.slow(4)`
      // verbatim; evaluating it would produce `.slow(4)` *as a JS number*
      // and break the round-trip byte-fidelity.
      expect(node.via.raw).toBe('4')
      expect(typeof node.via.raw).toBe('string')
      // Defensive: the node carries no `as unknown as number` coercion
      // anywhere in the via object.
      expect(node.via).toEqual({ literal: true, raw: '4' })
    })

    it('a quoted-string literal preserves both quote style and contents byte-verbatim', () => {
      const dq = classifyLiteralRhs('"bd"')
      expect(dq).not.toBeNull()
      if (!dq) return
      // Quote style is preserved — `"bd"` stays double-quoted, never
      // re-emitted as `'bd'` or as the bare token `bd`. This is the
      // P62 code-invariance contract for the round-trip path.
      expect(dq.via.raw).toBe('"bd"')

      const sq = classifyLiteralRhs("'sd'")
      expect(sq).not.toBeNull()
      if (!sq) return
      expect(sq.via.raw).toBe("'sd'")
    })
  })
})
