/** PROBE #1548 — what does the argument splitter actually return? */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
const tags = (n: unknown, a: Record<string, number> = {}): Record<string, number> => {
  if (!n || typeof n !== 'object') return a
  if (Array.isArray(n)) { n.forEach(x => tags(x, a)); return a }
  const r = n as Record<string, unknown>
  if (typeof r.tag === 'string') a[r.tag] = (a[r.tag] ?? 0) + 1
  for (const [k, v] of Object.entries(r)) { if (k === 'loc' || k === 'tag') continue; tags(v, a) }
  return a
}
const CASES: Array<[string, string]> = [
  ['A arrange, plain',            `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n)`],
  ['B arrange, trailing comma',   `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n)`],
  ['C arrange, comment between',  `$: arrange(\n  [8, s("bd")],\n  // [4, s("x")],\n  [8, s("hh")]\n)`],
  ['D arrange, comma + comment',  `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n  // [4, s("x")]\n)`],
  ['E arrange, comment no comma', `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")]\n  // [4, s("x")]\n)`],
  ['F cat, comma + comment',      `$: cat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`],
  ['G stack, comma + comment',    `$: stack(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`],
  ['H stack, comma + BLOCK cmt',  `$: stack(\n  s("bd"),\n  s("hh"),\n  /* s("x") */\n)`],
  ['I arrange, comma + BLOCK',    `$: arrange(\n  [8, s("bd")],\n  [8, s("hh")],\n  /* [4, s("x")] */\n)`],
  ['J fastcat, comma + comment',  `$: fastcat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`],
  ['K slowcat, comma + comment',  `$: slowcat(\n  s("bd"),\n  s("hh"),\n  // s("x")\n)`],
  ['L stack, DOUBLE comma',       `$: stack(\n  s("bd"),\n  ,\n  s("hh")\n)`],
]
describe('#1548 probe', () => {
  it('prints the census for each argument-list shape', () => {
    for (const [label, code] of CASES) {
      let t = 'THREW'
      try { t = JSON.stringify(tags(parseStrudel(code))) } catch (e) { t = 'THREW ' + (e as Error).message }
      console.log(label.padEnd(30), t)
    }
    expect(CASES.length).toBe(12)
  })
})
