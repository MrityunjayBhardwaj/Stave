/** PROBE #1522 — does a NESTED arrange() lose its arrangement when a weight
 *  is an expression? Both parsers, one pass. */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

function census(n: PatternIR): Record<string, number> {
  const counts: Record<string, number> = {}
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
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

const DOCS: Array<[string, string]> = [
  ['root / literal weight', `$: arrange([2, s("bd")], [2, s("hh")])`],
  ['root / ident weight', `let M = 2\n$: arrange([M, s("bd")], [M, s("hh")])`],
  ['root / arith weight', `let M = 2\n$: arrange([M*2, s("bd")], [M*2, s("hh")])`],
  ['nested in stack / literal', `$: stack(arrange([2, s("bd")], [2, s("hh")]), s("cp"))`],
  ['nested in stack / ident', `let M = 2\n$: stack(arrange([M, s("bd")], [M, s("hh")]), s("cp"))`],
  ['nested in stack / arith', `let M = 2\n$: stack(arrange([M*2, s("bd")], [M*2, s("hh")]), s("cp"))`],
  ['nested in cat / ident', `let M = 2\n$: cat(arrange([M, s("bd")], [M, s("hh")]), s("cp"))`],
  ['nested in fastcat / ident', `let M = 2\n$: fastcat(arrange([M, s("bd")], [M, s("hh")]), s("cp"))`],
  ['arrange ARM holds arrange / ident', `let M = 2\n$: arrange([M, arrange([M, s("bd")], [M, s("hh")])], [M, s("cp")])`],
  ['CONTROL unknowable weight root', `$: arrange([f(), s("bd")], [2, s("hh")])`],
  ['CONTROL unknowable weight nested', `$: stack(arrange([f(), s("bd")], [2, s("hh")]), s("cp"))`],
  ['CONTROL member-expr weight nested', `let o = 1\n$: stack(arrange([o.x, s("bd")], [2, s("hh")]), s("cp"))`],
  ['bare doc nested / ident', `let M = 2\nstack(arrange([M, s("bd")], [M, s("hh")]), s("cp"))`],
  ['binding RHS arrange / ident', `let M = 2\nlet p = arrange([M, s("bd")], [M, s("hh")])\n$: stack(p, s("cp"))`],
  ['binding RHS arrange / literal', `let p = arrange([2, s("bd")], [2, s("hh")])\n$: stack(p, s("cp"))`],
  ['deep: stack in stack / ident', `let M = 2\n$: stack(stack(arrange([M, s("bd")], [M, s("hh")]), s("x")), s("cp"))`],
  ['chain on nested arrange / ident', `let M = 2\n$: stack(arrange([M, s("bd")], [M, s("hh")]).fast(2), s("cp"))`],
  ['method .cat arm arrange / ident', `let M = 2\n$: s("cp").cat(arrange([M, s("bd")], [M, s("hh")]))`],
  ['slowcat nested / ident', `let M = 2\n$: slowcat(arrange([M, s("bd")], [M, s("hh")]), s("cp"))`],
]

describe('#1522 probe', () => {
  it('prints Arrange/Code census for each document, both parsers', () => {
    const rows: string[] = []
    for (const [label, code] of DOCS) {
      const mono = stripStageMeta(parseStrudel(code))
      const staged = stripStageMeta(pipeline(code))
      const cm = census(mono)
      const cs = census(staged)
      const parity = JSON.stringify(mono) === JSON.stringify(staged) ? 'SAME' : '**DIVERGE**'
      const brief = (n: PatternIR): string => {
        const seen = JSON.stringify(n, (k, v) => (k === 'loc' ? undefined : v))
        return seen.length > 260 ? seen.slice(0, 260) + '…' : seen
      }
      rows.push(
        `${label.padEnd(34)} ${parity}\n    mono census ${JSON.stringify(cm)}\n    staged census ${JSON.stringify(cs)}\n    mono ${brief(mono)}`,
      )
    }
    console.log('\n' + rows.join('\n') + '\n')
    expect(rows.length).toBe(DOCS.length)
  })
})
