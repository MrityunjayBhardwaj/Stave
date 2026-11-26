/** PROBE #1547 — where can a chain argument reach an arrange, and where can a
 *  local scope shadow a document-level name? */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

function brief(n: PatternIR): string {
  const seen = JSON.stringify(n, (k, v) => (k === 'loc' ? undefined : v))
  return seen.length > 200 ? seen.slice(0, 200) + '…' : seen
}
function tags(n: unknown, a: Record<string, number> = {}): Record<string, number> {
  if (!n || typeof n !== 'object') return a
  if (Array.isArray(n)) { n.forEach(x => tags(x, a)); return a }
  const r = n as Record<string, unknown>
  if (typeof r.tag === 'string') a[r.tag] = (a[r.tag] ?? 0) + 1
  for (const [k, v] of Object.entries(r)) { if (k === 'loc' || k === 'tag') continue; tags(v, a) }
  return a
}

const DOCS: Array<[string, string]> = [
  // — can a chain argument reach an arrange at all, and with which method?
  ['.cat arm, ident weight',       `let M = 2\n$: s("cp").cat(arrange([M, s("bd")], [M, s("hh")]))`],
  ['.cat arm, LITERAL weight',     `$: s("cp").cat(arrange([2, s("bd")], [2, s("hh")]))`],
  ['.slowcat arm, ident',          `let M = 2\n$: s("cp").slowcat(arrange([M, s("bd")], [M, s("hh")]))`],
  ['.fastcat arm, ident',          `let M = 2\n$: s("cp").fastcat(arrange([M, s("bd")], [M, s("hh")]))`],
  ['.arp(arrange(...)), ident',    `let M = 2\n$: s("cp").arp(arrange([M, s("bd")], [M, s("hh")]))`],
  ['.chop(arrange(...)), ident',   `let M = 2\n$: s("cp").chop(arrange([M, s("bd")], [M, s("hh")]))`],
  ['.slice index arrange, ident',  `let M = 2\n$: s("cp").slice(4, arrange([M, s("bd")], [M, s("hh")]))`],

  // — the LAMBDA forms. Which even parse?
  ['arrow body is fresh expr',     `let M = 2\n$: s("bd").every(2, M => arrange([M, s("x")], [M, s("y")]))`],
  ['arrow body is param.chain',    `let M = 2\n$: s("bd").every(2, x => x.cat(arrange([M, s("p")], [M, s("q")])))`],
  ['arrow param SHADOWS M',        `let M = 2\n$: s("bd").every(2, M => M.cat(arrange([M, s("p")], [M, s("q")])))`],
  ['arrow param shadows, literal', `$: s("bd").every(2, M => M.cat(arrange([2, s("p")], [2, s("q")])))`],

  // — does the PATTERN map already mis-resolve a shadowed name? (the issue's ⚠)
  ['pattern map, no shadow',       `let p = s("bd")\n$: s("x").every(2, y => y.cat(p))`],
  ['pattern map, param SHADOWS p', `let p = s("bd")\n$: s("x").every(2, p => p.cat(p))`],
]

describe('#1547 probe', () => {
  it('prints what each document parses to, both parsers', () => {
    for (const [label, code] of DOCS) {
      const mono = stripStageMeta(parseStrudel(code))
      const staged = stripStageMeta(pipeline(code))
      const same = JSON.stringify(mono) === JSON.stringify(staged) ? 'SAME' : '**DIVERGE**'
      console.log(`\n${label}\n    ${same}  ${JSON.stringify(tags(mono))}\n    ${brief(mono)}`)
    }
    expect(DOCS.length).toBeGreaterThan(0)
  })
})
