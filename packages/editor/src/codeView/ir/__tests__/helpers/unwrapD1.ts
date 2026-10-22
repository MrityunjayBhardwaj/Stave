/**
 * Phase 20-11 test helper — drill through the synthetic d1 Track wrapper
 * that parseStrudel adds at the root of any non-`$:` input.
 *
 * After 20-11, `parseStrudel('s("bd")')` returns Track('d1', Param(...))
 * instead of the bare Param. Tests that assert on the inner shape (the
 * vast majority of pre-20-11 tests) call this helper to drill through one
 * level.
 *
 * Returns the input UNCHANGED if the root tag is anything other than
 * Track-with-trackId-`d1`-and-no-userMethod (i.e. preserves `.p()`-derived
 * Track wrappers, multi-`$:` Stack roots, and Code-fallback paths).
 *
 * Standalone module — NOT inline in any *.test.ts file (P52 lesson from
 * 20-10 γ-2: importing from another *.test.ts file makes vitest's
 * discovery treat the importing test as part of the imported file's
 * suite, doubling the test count). Mirrors helpers/collectCycles.ts.
 */
import type { PatternIR } from '../../PatternIR'

export function unwrapD1(ir: PatternIR): PatternIR {
  if (
    ir.tag === 'Track' &&
    (ir as { trackId: string }).trackId === 'd1' &&
    (ir as { userMethod?: string }).userMethod === undefined
  ) {
    return (ir as { body: PatternIR }).body
  }
  return ir
}
