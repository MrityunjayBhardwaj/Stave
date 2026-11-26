/**
 * PROBE — self-review of #1514. Three claims I made from READING the code and
 * did not observe. Each is a place the fix could be incomplete.
 *
 *  A. The bare-MULTI-STATEMENT branch in RAW gets no numeric meta. I argued it
 *     is unreachable when a binding is present (its own guard rejects any
 *     statement matching BINDING_RE). Argued, not run.
 *  B. `stack(arrange([M*2, …]), …)` — an arrange NESTED inside another
 *     combinator. `parseRoot`'s stack-arg loop calls `parseExpression` without
 *     the numeric map, on BOTH parsers. If real, it is a pre-existing parity
 *     gap, not something this PR introduced — but it is the same defect one
 *     level down and should be filed rather than assumed absent.
 *  C. A binding declared AFTER the call it is used in.
 */
import { describe, it } from 'vitest'
import { IR, type PatternIR } from '../PatternIR'
import {
  runRawStage,
  runMiniExpandedStage,
  runChainAppliedStage,
  runFinalStage,
} from '../parseStrudelStages'
import { parseStrudel } from '../parseStrudel'

function staged(code: string): PatternIR {
  let ir: PatternIR = IR.code(code)
  for (const s of [runRawStage, runMiniExpandedStage, runChainAppliedStage, runFinalStage]) ir = s(ir)
  return ir
}

function arms(ir: PatternIR): string {
  let out = 'NONE'
  const walk = (n: unknown): void => {
    if (out !== 'NONE' || !n || typeof n !== 'object') return
    const node = n as { tag?: string; arms?: { weight: number }[] }
    if (node.tag === 'Arrange') {
      out = `arms=${node.arms?.length} weights=${JSON.stringify(node.arms?.map((a) => a.weight))}`
      return
    }
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(ir)
  return out
}

const CASES: [string, string][] = [
  ['A  bare, several statements + a binding', 'let M = 2\ns("cp")\narrange([M, s("bd")], [M, s("hh")])'],
  ['A  bare, several statements, no binding', 's("cp")\narrange([2, s("bd")], [2, s("hh")])'],
  ['B  arrange NESTED inside stack()      ', 'let M = 2\n$: stack(arrange([M, s("bd")], [M, s("hh")]), s("cp"))'],
  ['B  control: nested, LITERAL weight    ', 'let M = 2\n$: stack(arrange([2, s("bd")], [2, s("hh")]), s("cp"))'],
  ['C  binding declared AFTER the call    ', '$: arrange([M, s("bd")], [M, s("hh")])\nlet M = 2'],
  // THE DISCRIMINATOR for A: same shape, LITERAL weights. If this is also NONE
  // the arrangement is lost to the document SHAPE, not to the weight, and A is
  // a different defect wearing the same symptom.
  ['A? same shape, LITERAL weights        ', 'let M = 2\ns("cp")\narrange([2, s("bd")], [2, s("hh")])'],
  ['A? binding + ONE expression           ', 'let M = 2\narrange([M, s("bd")], [M, s("hh")])'],
  ['B? nested under a `$:` with LITERALS  ', '$: stack(arrange([2, s("bd")], [2, s("hh")]), s("cp"))'],
]

describe('#1514 self-review', () => {
  it('prints staged vs monolithic for each unobserved claim', () => {
    for (const [label, code] of CASES) {
      console.log(`${label}  staged: ${arms(staged(code)).padEnd(34)} mono: ${arms(parseStrudel(code))}`)
    }
  })
})
