/**
 * binding-arithmetic.test.ts — Phase 20-22 permanent verdict wall (D-02 + D-01).
 *
 * MUST be named `*.test.ts` (NOT `.spec.ts`, no `_` prefix). The vitest
 * default-gate include glob is `tests/parity-corpus/**\/*.test.{ts,tsx}`
 * and `exclude` lists `tests/*.spec.ts`; the `_`-prefixed `.spec.ts` files
 * (`_bakery-classify`, …) run ONLY under the separate `test:proto` config.
 * A `.spec.ts` here would SILENTLY never run in the default gate — the
 * inert-wall trap. WHY this belongs in the always-on gate (not maintainer-
 * gated like `_bakery-classify.spec.ts`): `_bakery-classify` is gated
 * because it does a NON-DETERMINISTIC live Supabase network pull. These
 * assertions are the opposite — fixed vendored `.strudel` fixtures + inline
 * source strings, pure `parseStrudel`, fully deterministic, no network.
 * Deterministic fixed-fixture parser verdicts belong in the default gate.
 *
 * Locks two Phase 20-22 wins:
 *   D-02 (the verdict lever): `let bpm = 172/4` resolves in buildBindingMap's
 *     fixpoint so the program structures instead of bareCoding (the
 *     occurs-check terminal no longer bails). Proven by BOTH a referenced
 *     and an UNREFERENCED case (the unreferenced one isolates the terminal
 *     fix, not a ref-site fix — RESEARCH Obs 4).
 *   D-01 (round-trip fidelity): a numeric/literal binding referenced as a
 *     method arg round-trips its RAW RHS, not the ident — `.slow(n)` with
 *     `var n=4` emits the value `4`; opaque `.cpm(bpm)` with `let bpm=172/4`
 *     carries `via.args="172/4"` (NEVER evaluated to `43` — matcher line).
 *
 * Negative controls keep the D-02 grammar CLOSED (the P70 / #140 γ-4
 * scope-creep-into-interpreter boundary): operand-idents, parens, and
 * calls stay bareCode. Kept as INLINE source strings (NOT vendored
 * `.strudel`) so a deliberate-bareCode fixture doesn't auto-snapshot into
 * the parity corpus and muddy the structured-% reading.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** Canonical bakery verdict discriminator (mirrors _bakery-classify.spec.ts:32):
 *  descend the synthetic Track; a Code body with `via === undefined` is the
 *  whole-program bareCode fallback. A `via`-carrying Code (or any other tag)
 *  is structured. */
function isCodeFallback(ir: unknown): boolean {
  if (!ir || typeof ir !== 'object') return false
  const node = ir as Record<string, unknown>
  const body =
    node.tag === 'Track' && node.body && typeof node.body === 'object'
      ? (node.body as Record<string, unknown>)
      : node
  return body.tag === 'Code' && (body as { via?: unknown }).via === undefined
}

function parseFixture(name: string) {
  const code = fs.readFileSync(path.join(dir, name), 'utf8')
  return parseStrudel(code)
}

/** Unwrap the synthetic Track to reach the musical body. */
function body(ir: unknown): any {
  const n = ir as any
  return n && n.tag === 'Track' ? n.body : n
}

describe('Phase 20-22 — binding-ref arithmetic + raw-RHS round-trip (D-02 + D-01)', () => {
  describe('D-02 — arithmetic RHS resolves (occurs-check terminal fix)', () => {
    it('bakery-141-arith-rhs (let bpm=172/4, referenced) structures', () => {
      const ir = parseFixture('bakery-141-arith-rhs.strudel')
      expect(isCodeFallback(ir)).toBe(false)
    })

    it('bakery-141-arith-unreferenced (let bpm=172/4, UNREFERENCED) structures — proves the TERMINAL fix, not a ref-site fix', () => {
      const ir = parseFixture('bakery-141-arith-unreferenced.strudel')
      expect(isCodeFallback(ir)).toBe(false)
    })
  })

  describe('D-01 — raw-RHS round-trip fidelity', () => {
    it('bakery-141-binding-arg-text (.slow(n) with var n=4) structures AND resolves the arg to 4', () => {
      const ir = parseFixture('bakery-141-binding-arg-text.strudel')
      expect(isCodeFallback(ir)).toBe(false)
      const b = body(ir)
      // The numeric arg resolves: .slow(n) becomes a Slow tag with factor 4
      // (NOT an opaque Code with args="n").
      expect(b.tag).toBe('Slow')
      expect(b.factor).toBe(4)
    })

    it('opaque .cpm(bpm) with let bpm=172/4 carries via.args="172/4" (raw, NEVER evaluated to 43)', () => {
      const ir = parseStrudel('let bpm = 172/4\nstack(s("bd").cpm(bpm))')
      const b = body(ir)
      expect(b.tag).toBe('Code')
      expect(b.via).toBeDefined()
      expect(b.via.method).toBe('cpm')
      expect(b.via.args).toBe('172/4')
    })
  })

  describe('negative controls — the D-02 grammar stays CLOSED (P70 / #140 γ-4 boundary)', () => {
    it('call operand (let x = foo(2)) stays bareCode (call OUT)', () => {
      const ir = parseStrudel('let x = foo(2)\nstack(s("bd").cpm(x))')
      expect(isCodeFallback(ir)).toBe(true)
    })

    it('operand identifier (let x = bpm/2) stays bareCode (ident OUT)', () => {
      const ir = parseStrudel('let x = bpm/2\nstack(s("bd").cpm(x))')
      expect(isCodeFallback(ir)).toBe(true)
    })

    it('parenthesised arithmetic (let x = (1+2)/3) stays bareCode (parens OUT)', () => {
      const ir = parseStrudel('let x = (1+2)/3\nstack(s("bd").cpm(x))')
      expect(isCodeFallback(ir)).toBe(true)
    })
  })
})
