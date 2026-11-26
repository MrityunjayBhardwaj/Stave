/**
 * PROBE — how many real documents does the staged parser leave WHOLLY opaque,
 * and does the "bare document + a binding + several trailing expressions"
 * shape explain any of them?
 *
 * ⚠ The census is taken with the CODE's own oracle (run the parser), not with a
 * regex over source, because the question is reachability and reachability is
 * control flow. The regex reading is printed alongside only as a cross-check.
 */
import { describe, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { IR, type PatternIR } from '../PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../parseStrudelStages'

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

function staged(code: string): PatternIR {
  let ir: PatternIR = IR.code(code)
  for (const s of [runRawStage, runMiniExpandedStage, runChainAppliedStage, runFinalStage]) ir = s(ir)
  return ir
}

/** A document is WHOLLY opaque when its only content is a give-up Code node. */
function whollyOpaque(ir: PatternIR): boolean {
  let sawStructure = false
  let sawBareCode = false
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as { tag?: string; via?: unknown }
    if (node.tag === 'Code' && node.via === undefined) sawBareCode = true
    else if (node.tag && node.tag !== 'Track' && node.tag !== 'Stack' && node.tag !== 'Pure') {
      sawStructure = true
    }
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(ir)
  return sawBareCode && !sawStructure
}

const isBare = (c: string): boolean => !/^\s*(\$|[A-Za-z_$][\w$]*)\s*:\s/m.test(c)
const hasBinding = (c: string): boolean => /^\s*(let|const|var)\s/m.test(c)

describe('#1514 follow-up census', () => {
  it('counts wholly-opaque documents and the shape that explains them', () => {
    const docs = loadCorpus()
    let opaque = 0
    let opaqueBareBinding = 0
    let bareBinding = 0
    for (const code of docs) {
      const bb = isBare(code) && hasBinding(code)
      if (bb) bareBinding += 1
      if (whollyOpaque(staged(code))) {
        opaque += 1
        if (bb) opaqueBareBinding += 1
      }
    }
    console.log(`corpus ${docs.length} documents (sha256 of the \`code\` field)`)
    console.log(`  WHOLLY opaque through the staged parser: ${opaque}`)
    console.log(`  bare document + a top-level binding:     ${bareBinding}`)
    console.log(`  ...and wholly opaque:                    ${opaqueBareBinding}`)
    console.log(`  => that shape explains ${opaque ? ((opaqueBareBinding / opaque) * 100).toFixed(0) : '0'}% of the opaque documents`)
  })
})
