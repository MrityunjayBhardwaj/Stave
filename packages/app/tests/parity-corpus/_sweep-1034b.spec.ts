/**
 * _sweep-1034b — the COST arm of the #1034 sweep. Measurement only.
 *
 * The first arm found WHICH units collapse (4 of 1169 grid-readable). This arm
 * asks the only question that can move a number: are those units currently
 * COUNTED as writer-reach? Option (a) — record the multiset, writer refuses on
 * disagreement — turns every counted one into a refusal, and "writer-reach moves"
 * is a declared stop condition. A choice made without this is a choice made blind.
 */
import { describe, it } from 'vitest'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
} from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'
import { GRID_SURFACE, ROLL_SURFACE, probeEdit } from './engineEditOracle'

/** the 4 units the first arm found, verbatim */
const HITS = [
  '<eb@12, gb@10, bb@8> <a@6, c@4, e@2>, eb g [c a]!2 <bb>!2',
  '[C G], <D Fb B C A>*[0.5,2]',
  '[C3 G3], <D Fb B C A>*[0.5,2]',
  'hh,hh oh sd',
  // the fifth, found only past cycle 11 once the window was widened
  'bd*2,[- sd]*2,[- hh]*4, <-!7 oh>, <-!12 bd*4 bd*8 bd*16!2>',
]

describe('#1034 cost arm — do the colliding units currently count as reach?', () => {
  it('reports core/projection/edit verdict per unit, per surface', () => {
    for (const mini of HITS) {
      console.log(`\n  ${JSON.stringify(mini)}`)
      for (const [key, core, full, surf] of [
        ['step', parseStepGridCore, parseStepGrid, GRID_SURFACE],
        ['roll', parsePianoRollCore, parsePianoRoll, ROLL_SURFACE],
      ] as const) {
        const c = core(mini)
        const f = full(mini)
        let verdict = '(not projected)'
        if (f.ok) {
          const m = f.model as StepGridModel & PianoRollModel
          const p = probeEdit(mini, m, surf)
          verdict = `${p.verdict}${m.leafSource ? ' [leaf]' : ' [element]'}`
        }
        console.log(
          `    ${key}: core.ok=${c.ok}${c.ok ? '' : ` (${(c as { reason?: string }).reason})`}` +
            ` projected=${f.ok}${f.ok ? '' : ` (gate=${(f as { gate?: string }).gate})`}` +
            ` edit=${verdict}`,
        )
        console.log(
          `        → counts toward writer-reach: ${!c.ok && f.ok && verdict.startsWith('ok')}`,
        )
      }
    }
  })
})
