/**
 * #1534 census — WHO takes the bare-binding branch, and what is in their tails.
 *
 * The issue quotes "2 documents take the branch, 1 has a binding in its tail".
 * Re-measured here with the MEMBERS printed, not the totals: an unmoved count
 * cannot say whether nothing changed, two changes cancelled, or the metric
 * cannot reach the change.
 *
 * The number that decides the shape of the fix is the third column: how many
 * documents would drop to EXACTLY ONE surviving expression. That is the case
 * the naive filter breaks, and if it is non-zero in the archive the new
 * single-Track arm is load-bearing rather than defensive.
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

function loadEveryDocument(): { name: string; code: string }[] {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json') && !isOutput(f))
    .sort()
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of files) {
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

describe('#1534 census', () => {
  it('names every document whose bare tail carries a declaration', () => {
    const docs = loadEveryDocument()
    const branch: string[] = []
    const withTrailingBinding: string[] = []
    const dropsToOne: string[] = []
    const dropsToZero: string[] = []
    for (const d of docs) {
      // Ask the PRODUCTION dispatch whether this is a bare document, never a
      // fresh regex — an instrument that re-implements the predicate differs
      // from it on exactly the documents the measurement is about.
      if (extractTracks(d.code).length > 0) continue
      const stripped = stripParserPrelude(d.code)
      if (!stripped.body.trim()) continue
      const bareStmts = stripSideEffectStatements(
        splitTopLevelStatements(stripped.body, stripped.offset),
      )
      const declaresBinding = bareStmts.some((s) => BINDING_RE.test(s.text))
      if (!declaresBinding) continue
      const collected = collectTopLevelBindings(stripped.body, stripped.offset)
      if (!collected) continue
      const tail = collected.tail
      if (tail.length <= 1) continue // not on the split branch
      branch.push(d.name)
      // WIDER predicate: "does this statement DECLARE?", which is a different
      // question from BINDING_RE's "can I resolve this as name = value?".
      const DECL = /^(?:let|const|var)\s/
      const decls = tail.filter((s) => DECL.test(s.text))
      const exprs = tail.filter((s) => !DECL.test(s.text))
      if (decls.length > 0) {
        withTrailingBinding.push(
          `${d.name}  tail=${tail.length} decls=${decls.length} → ${JSON.stringify(decls.map((s) => s.text.slice(0, 48)))}`,
        )
      }
      if (exprs.length === 1) dropsToOne.push(`${d.name}  ${JSON.stringify(exprs[0].text.slice(0, 48))}`)
      if (exprs.length === 0) dropsToZero.push(`${d.name}  tail=${tail.length} ALL declarations`)
    }
    console.log(`examined=${docs.length} documents (sha256 of code)`)
    console.log(`on the bare-binding split branch: ${branch.length}`)
    for (const b of branch) console.log(`   ${b}`)
    console.log(`with a DECLARATION in the tail:   ${withTrailingBinding.length}`)
    for (const b of withTrailingBinding) console.log(`   ${b}`)
    console.log(`would drop to ONE expression:     ${dropsToOne.length}`)
    for (const b of dropsToOne) console.log(`   ${b}`)
    console.log(`would drop to ZERO expressions:   ${dropsToZero.length}`)
    for (const b of dropsToZero) console.log(`   ${b}`)
  })
})
