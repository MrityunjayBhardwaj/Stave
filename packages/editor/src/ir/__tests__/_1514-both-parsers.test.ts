/**
 * PROBE (#1514) — run BOTH parsers on the SAME document and print the arms.
 *
 * The mechanism was TRACED by reading (parseStrudelStages never threads the
 * numeric bindings map) and a traced mechanism that matches the symptom is
 * still inference. This prints what each parser actually returns.
 *
 * ⚠ A differential between these two proves AGREEMENT, never correctness —
 * so the useful reading here is the DISAGREEMENT, plus the literal-weight
 * control which must agree.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../parseStrudelStages'
import { IR } from '../PatternIR'
import type { PatternIR } from '../PatternIR'

/** The app's own pipeline: seed a Code node with the raw source, run 4 stages. */
function staged(code: string): PatternIR {
  let ir: PatternIR = IR.code(code)
  for (const run of [runRawStage, runMiniExpandedStage, runChainAppliedStage, runFinalStage]) {
    ir = run(ir)
  }
  return ir
}

function findArrange(ir: PatternIR): PatternIR | null {
  let found: PatternIR | null = null
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== 'object') return
    const node = n as { tag?: string }
    if (node.tag === 'Arrange') { found = n as PatternIR; return }
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(ir)
  return found
}

function describeArrange(label: string, ir: PatternIR): void {
  const arr = findArrange(ir) as { mode?: string; arms?: { weight: number }[] } | null
  if (!arr) {
    // print the top tags so an opaque result is legible, not just "null"
    const t = (ir as { tag?: string }).tag
    const body = (ir as { body?: { tag?: string } }).body?.tag
    console.log(`${label}: NO Arrange NODE  (root tag=${t} body tag=${body})`)
    return
  }
  console.log(
    `${label}: Arrange mode=${arr.mode} arms=${arr.arms?.length} weights=${JSON.stringify(arr.arms?.map(a => a.weight))}`,
  )
}

const LITERAL = 'let M = 1\n$: arrange([2, s("bd")], [2, s("hh")])'
const EXPRESSION = 'let M = 1\n$: arrange([M*2, s("bd")], [2, s("hh")])'

describe('#1514 probe — both parsers, one document', () => {
  it('prints the arms each parser reports', () => {
    console.log('--- CONTROL: literal weights (both must agree) ---')
    describeArrange('  parseStrudel     ', parseStrudel(LITERAL))
    describeArrange('  parseStrudelStages', staged(LITERAL))
    console.log('--- SUBJECT: expression weight `M*2` ---')
    describeArrange('  parseStrudel     ', parseStrudel(EXPRESSION))
    describeArrange('  parseStrudelStages', staged(EXPRESSION))
  })
})
