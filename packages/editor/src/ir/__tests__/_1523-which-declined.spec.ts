/**
 * #1523 CONFIRMATION PROBE — which gate declines, and does the weight matter?
 *
 * The issue states its mechanism as a TRACE, not a finding, and says plainly:
 * "I have not run both branches on the failing document and printed which one
 * declined. Someone picking this up should do that before writing a fix."
 *
 * That is what this file does, and nothing else. Two candidate gates:
 *
 *   G1  `buildBindingMap` (parseStrudel.ts:907) — wants `bindings*, ONE expr`
 *   G2  the #1096 bare multi-statement split (parseStrudel.ts:1054) — guarded
 *       to documents where NO statement is a binding
 *
 * If the trace is right, BOTH decline for `let M = 2 / s("cp") / arrange(…)`
 * and the document falls to the whole-program `parseExpression`, which gives up.
 *
 * ⚠ P761 — assert on a positive artefact. Every arm below asserts a NAMED
 * value, never emptiness.
 */

import { describe, it, expect } from 'vitest'
import {
  parseStrudel,
  buildBindingMap,
  collectTopLevelBindings,
  splitTopLevelStatements,
  stripSideEffectStatements,
  BINDING_RE,
} from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

const ARRANGE = 'arrange([2, s("bd")], [2, s("hh")])'

/** A — control, the shape the issue says works: binding + ONE trailing expr. */
const A = `let M = 2\n${ARRANGE}`
/** B — the failing document: binding + TWO trailing exprs, LITERAL weights. */
const B = `let M = 2\ns("cp")\n${ARRANGE}`
/** C — control, TWO trailing exprs and NO binding (the #1096 population). */
const C = `s("cp")\n${ARRANGE}`
/** D — B with an IDENTIFIER weight. If B and D behave alike the weight is not the cause. */
const D = `let M = 2\ns("cp")\narrange([M, s("bd")], [M, s("hh")])`

function census(n: PatternIR): Record<string, number> {
  const counts: Record<string, number> = {}
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const rec = node as Record<string, unknown>
    if (typeof rec.tag === 'string') counts[rec.tag] = (counts[rec.tag] ?? 0) + 1
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'loc' || k === 'tag') continue
      visit(v)
    }
  }
  visit(n)
  return counts
}

/** Does this tree contain an Arrange node? That is the property the song path needs. */
function hasArrange(n: PatternIR): boolean {
  return (census(n).Arrange ?? 0) > 0
}

function gates(code: string) {
  const g1 = buildBindingMap(code, 0)
  const engine = collectTopLevelBindings(code, 0)
  const stmts = stripSideEffectStatements(splitTopLevelStatements(code, 0))
  const hasBinding = stmts.some((s) => BINDING_RE.test(s.text))
  return {
    g1: g1 === null ? 'DECLINED' : `applied(final=${JSON.stringify(g1.finalExpr)})`,
    g2:
      stmts.length > 1 && !hasBinding
        ? `applied(${stmts.length} statements)`
        : `DECLINED(stmts=${stmts.length}, hasBinding=${hasBinding})`,
    engine:
      engine === null
        ? 'DECLINED'
        : `applied(bindings=[${[...engine.bindings.keys()].join(',')}], tail=${engine.tail.length})`,
    stmtCount: stmts.length,
    hasBinding,
  }
}

describe('#1523 — which gate declines on a bare document with a binding and two trailing expressions', () => {
  it('prints both gates, both parsers, for all four documents', () => {
    for (const [name, code] of [
      ['A control  (binding + 1 expr)', A],
      ['B FAILING  (binding + 2 exprs, literal weight)', B],
      ['C control  (no binding + 2 exprs)', C],
      ['D          (binding + 2 exprs, IDENTIFIER weight)', D],
    ] as const) {
      const g = gates(code)
      const mono = parseStrudel(code)
      const staged = stripStageMeta(pipeline(code))
      console.log(
        [
          `--- ${name}`,
          `    G1 buildBindingMap        : ${g.g1}`,
          `    G2 #1096 multi-stmt split : ${g.g2}`,
          `    engine collectTopLevel…   : ${g.engine}`,
          `    monolithic : tag=${mono.tag} hasArrange=${hasArrange(mono)} census=${JSON.stringify(census(mono))}`,
          `    staged     : tag=${staged.tag} hasArrange=${hasArrange(staged)} census=${JSON.stringify(census(staged))}`,
        ].join('\n'),
      )
    }

    // ── The claims, most-discriminating first (PV423) ────────────────────────
    // 1. The failing document loses its arrangement in BOTH parsers.
    expect(hasArrange(parseStrudel(B))).toBe(false)
    expect(hasArrange(stripStageMeta(pipeline(B)))).toBe(false)
    // 2. The control with ONE trailing expression keeps it in both.
    expect(hasArrange(parseStrudel(A))).toBe(true)
    expect(hasArrange(stripStageMeta(pipeline(A)))).toBe(true)
    // 3. The control with TWO trailing expressions and NO binding keeps it.
    expect(hasArrange(parseStrudel(C))).toBe(true)
    // 4. The weight spelling is IRRELEVANT — D behaves exactly like B.
    expect(hasArrange(parseStrudel(D))).toBe(false)

    // ── Which gate declined ─────────────────────────────────────────────────
    const gB = gates(B)
    expect(gB.g1).toBe('DECLINED')
    expect(gB.g2).toBe('DECLINED(stmts=3, hasBinding=true)')
    // …and the ENGINE beneath G1 does NOT decline: it resolves the binding and
    // reports a 2-statement tail. The material for a fix is already present.
    expect(gB.engine).toBe('applied(bindings=[M], tail=2)')

    // Control that the two gates are genuinely independent: C is refused by G1
    // (no binding to resolve) and ACCEPTED by G2.
    const gC = gates(C)
    expect(gC.g1).toBe('DECLINED')
    expect(gC.g2).toBe('applied(2 statements)')
  })
})
