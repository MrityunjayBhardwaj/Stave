/**
 * PROBE (#1524) — what does the parity gate NOT see?
 *
 * Uses the gate's OWN `parityRow`, not a second comparison, because the defect
 * this whole area measures IS a hand-kept parallel implementation and answering
 * it with a second hand-kept copy reproduces the bug inside its own instrument.
 *
 * Partitions every document in the archive into the gate's current population
 * and the population it has never looked at, and reports divergences in each.
 */
import { describe, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parityRow } from './helpers/stagesParity'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = join(HERE, '../../../../app/tests/parity-corpus/.bakery-runs')

/** The three files `loadCorpus` currently reads. */
const GATE_FILES = [
  'edit-samples-2026-07-24T17-49-00-172Z.json',
  'edit-samples-offset250-2026-07-24T17-49-04-301Z.json',
  'edit-samples-offset500-2026-07-24T17-49-08-639Z.json',
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Every sample-bearing input file. `result-*` files are OUTPUTS, not inputs. */
function inputFiles(): string[] {
  return readdirSync(ARCHIVE).filter(
    (f) =>
      f.endsWith('.json') &&
      !f.startsWith('result-') &&
      !f.startsWith('edit-result-') &&
      !f.startsWith('ir-support-result'),
  )
}

function docsFrom(files: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files) {
    let j: { samples?: { code?: string }[] }
    try {
      j = JSON.parse(readFileSync(join(ARCHIVE, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code === 'string') out.set(sha(s.code), s.code)
    }
  }
  return out
}

describe('#1524 survey', () => {
  it('reports divergences inside and outside the gate population', () => {
    const gate = docsFrom(GATE_FILES)
    const all = docsFrom(inputFiles())
    const unseen = [...all].filter(([h]) => !gate.has(h))

    const tally = (docs: [string, string][]) => {
      let match = 0
      let diverge = 0
      let threw = 0
      const byClass = new Map<string, number>()
      const examples: string[] = []
      for (const [, code] of docs) {
        const r = parityRow(code)
        if (r.match) { match += 1; continue }
        diverge += 1
        if (r.direct?.startsWith('THREW') || r.staged?.startsWith('THREW')) threw += 1
        const c = r.cls ?? 'unclassified'
        byClass.set(c, (byClass.get(c) ?? 0) + 1)
        if (examples.length < 12) {
          examples.push(`      [${c}] ${r.direct?.slice(0, 46)}  ->  ${r.staged?.slice(0, 46)}`)
        }
      }
      return { match, diverge, threw, byClass, examples }
    }

    const g = tally([...gate])
    const u = tally(unseen)

    console.log(`ARCHIVE, deduped by sha256 of the \`code\` field:`)
    console.log(`  gate population (3 files):        ${gate.size}`)
    console.log(`  every input file:                 ${all.size}`)
    console.log(`  NEVER SEEN by the gate:           ${unseen.length}`)
    console.log(``)
    console.log(`INSIDE the gate population:  match ${g.match}  diverge ${g.diverge}  (threw ${g.threw})`)
    for (const [c, n] of [...g.byClass].sort((a, b) => b[1] - a[1])) console.log(`    ${c}: ${n}`)
    console.log(``)
    console.log(`OUTSIDE it (the ${unseen.length} unseen):  match ${u.match}  diverge ${u.diverge}  (threw ${u.threw})`)
    for (const [c, n] of [...u.byClass].sort((a, b) => b[1] - a[1])) console.log(`    ${c}: ${n}`)
    console.log(`  first examples:`)
    for (const e of u.examples) console.log(e)
  })
})
