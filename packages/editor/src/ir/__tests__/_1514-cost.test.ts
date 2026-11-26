/**
 * PROBE (#1514) — what the added acorn parse costs, as a FRACTION of the stage
 * it was added to. An absolute millisecond figure is a property of this laptop;
 * the ratio is the thing that transfers.
 */
import { describe, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { IR, type PatternIR } from '../PatternIR'
import { runRawStage } from '../parseStrudelStages'
import { collectNumericBindings } from '../parseStrudel'

const CORPUS = join(homedir(), '.anvideck/projects/stave/ref/bakery-runs-inputs')

function loadCorpus(): string[] {
  const bySha = new Map<string, string>()
  for (const f of readdirSync(CORPUS).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(CORPUS, f), 'utf8')) as { samples?: { code?: string }[] }
    for (const s of j.samples ?? []) {
      if (typeof s.code !== 'string') continue
      bySha.set(createHash('sha256').update(s.code).digest('hex'), s.code)
    }
  }
  return [...bySha.values()]
}

describe('#1514 cost', () => {
  it('times the added collector against the whole RAW stage', () => {
    const docs = loadCorpus()
    // warm
    for (const c of docs) { runRawStage(IR.code(c) as PatternIR); collectNumericBindings(c) }
    const t0 = performance.now()
    for (const c of docs) runRawStage(IR.code(c) as PatternIR)
    const rawMs = performance.now() - t0
    const t1 = performance.now()
    for (const c of docs) collectNumericBindings(c)
    const collectMs = performance.now() - t1
    let withNumbers = 0
    for (const c of docs) if (collectNumericBindings(c)) withNumbers += 1
    console.log(`over ${docs.length} corpus documents:`)
    console.log(`  whole RAW stage (collector INCLUDED): ${rawMs.toFixed(1)} ms  (${(rawMs / docs.length).toFixed(3)} ms/doc)`)
    console.log(`  the added collector alone:            ${collectMs.toFixed(1)} ms  (${(collectMs / docs.length).toFixed(3)} ms/doc)`)
    console.log(`  => the collector is ${((collectMs / rawMs) * 100).toFixed(1)}% of the stage it was added to`)
    console.log(`  documents that actually have a numeric binding: ${withNumbers}/${docs.length}`)
  })
})
