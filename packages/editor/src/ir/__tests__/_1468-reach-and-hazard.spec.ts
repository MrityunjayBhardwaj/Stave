/**
 * _1468-reach-and-hazard.spec.ts — THROWAWAY. Size the change BEFORE writing it.
 *
 * `collectTopLevelBindings` takes bindings as a LEADING RUN: it walks from the
 * top and stops at the first statement that is not a binding. JavaScript has no
 * such rule. Lifting it is the remaining cause of #1468.
 *
 * Two numbers decide whether that is safe, and they pull in opposite directions:
 *
 *   REACH  — documents with a top-level binding OUTSIDE the leading run. These
 *            are the ones the change can help.
 *   HAZARD — of those, ones whose late binding NAMES A STRUDEL FUNCTION the
 *            document also calls (`let s = …`, `let n = …`). Collecting those
 *            would substitute a pattern where a call is meant. This risk is
 *            named in advance and looked for, not waited for.
 *
 * ⚠ Asks the PRODUCTION splitter and BINDING_RE, never a fresh regex — an
 * instrument that re-implements the dispatch differs from it on exactly the
 * documents the measurement is about.
 */

import { describe, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  stripParserPrelude,
  splitTopLevelStatements,
  stripSideEffectStatements,
  collectTopLevelBindings,
  extractTracks,
  BINDING_RE,
} from '../parseStrudel'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

/** Names that mean something in Strudel and must not be silently rebound. */
const STRUDEL_NAMES = new Set([
  's', 'n', 'note', 'sound', 'stack', 'cat', 'seq', 'arrange', 'slider',
  'freq', 'gain', 'pan', 'speed', 'room', 'lpf', 'hpf', 'rev', 'jux', 'off',
])

function loadEveryDocument(): { name: string; code: string }[] {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of fs.readdirSync(CORPUS_DIR).filter((x) => x.endsWith('.json') && !isOutput(x)).sort()) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code !== 'string') continue
      const sha = crypto.createHash('sha256').update(s.code).digest('hex')
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ name: `${j.offset}/${s.hash}`, code: s.code })
    }
  }
  return out
}

describe('#1468 — reach and hazard of lifting the leading-run rule', () => {
  it('counts both, and names the members', () => {
    const docs = loadEveryDocument()
    const reach: string[] = []
    const hazard: string[] = []
    const rescuable: string[] = []
    const wouldDecline: string[] = []
    const lateNames = new Map<string, number>()

    for (const d of docs) {
      const bare = extractTracks(d.code).length === 0
      const stripped = stripParserPrelude(d.code)
      if (!stripped.body.trim()) continue
      const stmts = stripSideEffectStatements(
        splitTopLevelStatements(stripped.body, stripped.offset),
      )
      // The leading run, as the engine currently defines it.
      let lead = 0
      while (lead < stmts.length && BINDING_RE.test(stmts[lead].text)) lead += 1
      const late = stmts.slice(lead).filter((s) => BINDING_RE.test(s.text))
      if (late.length === 0) continue
      reach.push(d.name)
      // ⚠ REGRESSION RISK, measured before it is taken. The dup-name check
      // returns null. Today it only sees the LEADING run; scanning the whole
      // document makes it STRICTER, so a document whose duplicate lives outside
      // the leading run resolves today and would decline after the change.
      const allNames = stmts.filter((x) => BINDING_RE.test(x.text)).map((x) => x.text.match(BINDING_RE)![1])
      const leadNames = stmts.slice(0, lead).map((x) => x.text.match(BINDING_RE)![1])
      const dupAll = allNames.length !== new Set(allNames).size
      const dupLead = leadNames.length !== new Set(leadNames).size
      if (dupAll && !dupLead) {
        const counts = new Map<string, number>()
        for (const n of allNames) counts.set(n, (counts.get(n) ?? 0) + 1)
        wouldDecline.push(`${d.name}  dup=${JSON.stringify([...counts].filter(([, c]) => c > 1).map(([n]) => n))}`)
      }
      const names = late.map((s) => s.text.match(BINDING_RE)![1])
      for (const n of names) lateNames.set(n, (lateNames.get(n) ?? 0) + 1)
      if (names.some((n) => STRUDEL_NAMES.has(n))) {
        hazard.push(`${d.name}  binds ${JSON.stringify(names.filter((n) => STRUDEL_NAMES.has(n)))}`)
      }
      // Would lifting the rule actually rescue it? Only if the engine declines
      // TODAY and the document is bare (the branch that loses everything).
      if (bare && collectTopLevelBindings(stripped.body, stripped.offset) === null) {
        rescuable.push(`${d.name}  lead=${lead} late=${late.length} names=${JSON.stringify(names.slice(0, 4))}`)
      }
    }

    console.log(`examined=${docs.length} documents (sha256 of code)`)
    console.log(`REACH  — a top-level binding outside the leading run: ${reach.length}`)
    console.log(`HAZARD — a late binding NAMING a Strudel function   : ${hazard.length}`)
    for (const h of hazard) console.log(`   ⚠ ${h}`)
    console.log(`RESCUABLE — bare AND the engine declines today      : ${rescuable.length}`)
    for (const r of rescuable) console.log(`   ${r}`)
    console.log(`⚠ WOULD NEWLY DECLINE — dup outside the leading run: ${wouldDecline.length}`)
    for (const w of wouldDecline) console.log(`   ⚠ ${w}`)
    const top = [...lateNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    console.log(`late-bound names, most common first: ${JSON.stringify(top)}`)
  })
})
