/**
 * _1242-raw-vs-cooked.spec.ts — throwaway. How many content literals does the
 * EDITOR read differently from the ENGINE, because one takes the document slice
 * and the other takes the JS-cooked value?
 *
 * ⚠ CLOSED BY #1254 — READ THIS AS A DATED INVESTIGATION, NOT AS CURRENT STATE.
 * The divergence below is real and still described correctly, but the anonymous
 * refusal it ends on is gone: an escaped literal now refuses through the
 * `escaped-source` gate, named from the string alone. What has NOT changed is
 * which string the editor models — it still reads the document slice, because
 * that is what makes byte surgery possible. The line reference below has also
 * drifted; the double-quoted reification is `transpiler.mjs:85`/`:88` in
 * `@strudel/transpiler@1.2.6`, and the backtick case is `:76-77`.
 *
 * Found while widening the harvest (#1242): one corpus string arrives with a
 * stray backslash and both surfaces refuse it as "unsupported mini-notation
 * syntax", while Strudel plays it perfectly.
 *
 *   source      note("<…[e3,g3,b3]!2 \<newline>    [a3,c4,e4]!2 …>")
 *   transpiler  `node.value`  — the JS line continuation is REMOVED (transpiler.mjs:84)
 *   product     `doc.slice(miniRange)` — the backslash and newline SURVIVE
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1242-raw-vs-cooked.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus } from './editCoverage'
import { parseTopLevel } from '../../../editor/src/codeView/chunkDetect'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'

/* eslint-disable @typescript-eslint/no-explicit-any */

const here = path.dirname(fileURLToPath(import.meta.url))
const runsDir = path.join(here, '.bakery-runs')

function loadDocs(): string[] {
  const byHash = new Map<string, string>()
  for (const f of fs.readdirSync(runsDir).filter((f) => f.startsWith('edit-samples-') && f.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'))
    for (const s of raw.samples ?? raw) if (s.hash && !byHash.has(s.hash)) byHash.set(s.hash, String(s.code))
  }
  return [...byHash.values()]
}

function walkAst(node: any, fn: (n: any) => void): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) return void node.forEach((n) => walkAst(n, fn))
  if (typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
    walkAst(node[k], fn)
  }
}

const verdict = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : (r.reason ?? '?'))

describe('#1242 — the editor reads the document, the engine reads the cooked value', () => {
  it('counts every literal where the two disagree, and what it costs', () => {
    const docs = loadDocs()
    /** interior span key -> what the TRANSPILER would hand to mini */
    let literalsSeen = 0
    const rows: { raw: string; cooked: string; stepRaw: string; stepCooked: string; rollRaw: string; rollCooked: string }[] = []
    let unitsChecked = 0
    let unitsDiverging = 0

    for (const code of docs) {
      const stmts = parseTopLevel(code)
      if (!stmts) continue
      const cookedOf = new Map<string, string>()
      for (const stmt of stmts) {
        walkAst(stmt, (n) => {
          if (n.type === 'Literal' && typeof n.value === 'string' && n.raw?.[0] === '"') {
            literalsSeen++
            cookedOf.set(`${n.start + 1}-${n.end - 1}`, n.value)
          } else if (n.type === 'TemplateLiteral' && n.expressions.length === 0) {
            literalsSeen++
            // the transpiler takes `quasis[0].value.raw` for backticks, which IS
            // the document text — so these can never diverge. Recorded anyway so
            // the denominator is the whole population, not the half that can move.
            cookedOf.set(`${n.start + 1}-${n.end - 1}`, n.quasis[0].value.raw)
          }
        })
      }
      for (const { unit, status } of unitsWithStatus(code)) {
        if (status.status !== 'note' && status.status !== 'note-broken') continue
        if (unit.miniString === null || unit.miniRange === null) continue
        const key = `${unit.miniRange[0]}-${unit.miniRange[1]}`
        const cooked = cookedOf.get(key)
        if (cooked === undefined) continue
        unitsChecked++
        if (cooked === unit.miniString) continue
        unitsDiverging++
        rows.push({
          raw: unit.miniString,
          cooked,
          stepRaw: verdict(parseStepGrid(unit.miniString)),
          stepCooked: verdict(parseStepGrid(cooked)),
          rollRaw: verdict(parsePianoRoll(unit.miniString)),
          rollCooked: verdict(parsePianoRoll(cooked)),
        })
      }
    }

    console.log(`\n===== RAW (editor) vs COOKED (engine) =====`)
    console.log(`documents                 : ${docs.length}`)
    console.log(`reifiable literals seen   : ${literalsSeen}`)
    console.log(`surface-routed units      : ${unitsChecked}`)
    console.log(`DIVERGING                 : ${unitsDiverging}`)
    const worse = rows.filter((r) => (r.stepRaw !== 'ok' && r.stepCooked === 'ok') || (r.rollRaw !== 'ok' && r.rollCooked === 'ok'))
    console.log(`of those, the EDITOR REFUSES what the ENGINE PLAYS: ${worse.length}`)
    for (const r of rows) {
      console.log(`\n  raw    ${JSON.stringify(r.raw.length > 100 ? r.raw.slice(0, 97) + '...' : r.raw)}`)
      console.log(`  cooked ${JSON.stringify(r.cooked.length > 100 ? r.cooked.slice(0, 97) + '...' : r.cooked)}`)
      console.log(`  step   raw=${r.stepRaw}  |  cooked=${r.stepCooked}`)
      console.log(`  roll   raw=${r.rollRaw}  |  cooked=${r.rollCooked}`)
    }
  })
})
