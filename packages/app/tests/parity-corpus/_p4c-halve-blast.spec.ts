/**
 * P4c ↔ ÷2: does the length-preserving printer break the resolution ops, and how widely?
 *
 * The editor's own unit tests say `serializeStepGrid(halveStepGrid(step('bd ~ sn ~')))` is
 * now null where it used to be `bd sn`. Before treating that as an expectation to refresh
 * OR as a defect to fix, observe the mechanism and measure the blast radius — no corpus
 * gate reaches "apply an op, then serialize", which is why nothing caught it ([[PK64]]:
 * the op A/B compared the op layer to ITSELF).
 *
 * Not a gate. `.spec.ts` so the normal run skips it.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'
import {
  canHalveStepGrid,
  canDoubleStepGrid,
  scaleStepGrid,
} from '../../../editor/src/codeView/notation/resolution'

import { parseStepGrid as baseParseStepGrid } from './__p4c_base__/parse'
import { serializeStepGrid as baseSerializeStepGrid } from './__p4c_base__/serialize'
import {
  canHalveStepGrid as baseCanHalve,
  canDoubleStepGrid as baseCanDouble,
  scaleStepGrid as baseScale,
} from './__p4c_base__/resolution'

const halveStepGrid = (m: StepGridModel) => scaleStepGrid(m, 'halve')
const doubleStepGrid = (m: StepGridModel) => scaleStepGrid(m, 'double')

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = corpus.minis.map((o: { mini: string }) => o.mini)

const durs = (m: StepGridModel): number[] =>
  m.lanes.flatMap((l) => l.cells.filter(isCellOn).map((c) => c.duration))

describe('P4c ↔ the resolution ops', () => {
  it('MECHANISM: what ÷2 does to a length, observed on the canonical case', () => {
    for (const src of ['bd ~ sn ~', 'bd ~ sn ~ bd', 'bd sn', 'bd ~ ~ ~ sn ~ ~ ~']) {
      const r = parseStepGrid(src)
      if (!r.ok) {
        console.log(`${JSON.stringify(src)}  UNPARSED`)
        continue
      }
      const m = r.model
      const line = [
        `${JSON.stringify(src)}`,
        `  parsed   steps=${m.steps} durs=[${durs(m).join(',')}]  -> ${JSON.stringify(serializeStepGrid(m))}`,
      ]
      if (canHalveStepGrid(m)) {
        const h = halveStepGrid(m)
        line.push(
          `  HALVED   steps=${h.steps} durs=[${durs(h).join(',')}]  -> ${JSON.stringify(serializeStepGrid(h))}`,
        )
      } else line.push('  HALVED   canHalveStepGrid = false')
      const d = doubleStepGrid(m)
      line.push(
        `  DOUBLED  steps=${d.steps} durs=[${durs(d).join(',')}]  -> ${JSON.stringify(serializeStepGrid(d))}`,
      )
      console.log(line.join('\n'))
    }
  })

  it('BLAST RADIUS: over the whole corpus, how many admissible ÷2 / ×2 now decline', () => {
    let gridViews = 0
    let canHalve = 0
    let halveDeclines = 0
    let doubleDeclines = 0
    let baseDeclines = 0
    const halveExamples: string[] = []
    const doubleExamples: string[] = []
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      gridViews++
      if (serializeStepGrid(r.model) === null) {
        baseDeclines++
        continue // already unwritable unedited — not this question
      }
      const d = canDoubleStepGrid(r.model) ? doubleStepGrid(r.model) : null
      if (d !== null && serializeStepGrid(d) === null) {
        doubleDeclines++
        if (doubleExamples.length < 10) doubleExamples.push(mini.trim())
      }
      if (!canHalveStepGrid(r.model)) continue
      canHalve++
      const h = halveStepGrid(r.model)
      if (serializeStepGrid(h) === null) {
        halveDeclines++
        if (halveExamples.length < 10) halveExamples.push(mini.trim())
      }
    }
    console.log(
      [
        `\n===== BLAST RADIUS =====`,
        `  units with a grid view                 ${gridViews}`,
        `  ...unwritable already, unedited        ${baseDeclines}   (excluded below)`,
        `  ...where canHalveStepGrid says YES     ${canHalve}`,
        `  ...of those, ÷2 then DECLINES          ${halveDeclines}`,
        `  ...×2 then DECLINES                    ${doubleDeclines}`,
      ].join('\n'),
    )
    console.log('\n  ÷2 examples:')
    for (const m of halveExamples) console.log(`     ${JSON.stringify(m)}`)
    console.log('\n  ×2 examples:')
    for (const m of doubleExamples) console.log(`     ${JSON.stringify(m)}`)
  })

  it('BASE ARM: did the same op-then-serialize succeed before this phase?', () => {
    // The question the blast radius cannot answer on its own. An UNEDITED model serializes
    // by copying the source verbatim, so it never reaches the printer — which is why the
    // "already unwritable" control above reads 0 and certifies nothing ([[P352]]). The
    // comparison that means something is the same op, the same corpus, the OLD printer.
    // `resolution.ts` is byte-identical between the two commits, so this isolates the
    // printer and nothing else.
    let base = { canHalve: 0, halveNull: 0, canDouble: 0, doubleNull: 0 }
    let head = { canHalve: 0, halveNull: 0, canDouble: 0, doubleNull: 0 }
    for (const mini of minis) {
      const b = baseParseStepGrid(mini)
      if (b.ok) {
        if (baseCanHalve(b.model)) {
          base.canHalve++
          if (baseSerializeStepGrid(baseScale(b.model, 'halve')) === null) base.halveNull++
        }
        if (baseCanDouble(b.model)) {
          base.canDouble++
          if (baseSerializeStepGrid(baseScale(b.model, 'double')) === null) base.doubleNull++
        }
      }
      const h = parseStepGrid(mini)
      if (h.ok) {
        if (canHalveStepGrid(h.model)) {
          head.canHalve++
          if (serializeStepGrid(halveStepGrid(h.model as never)) === null) head.halveNull++
        }
        if (canDoubleStepGrid(h.model)) {
          head.canDouble++
          if (serializeStepGrid(doubleStepGrid(h.model as never)) === null) head.doubleNull++
        }
      }
    }
    console.log(
      [
        `\n===== OP THEN SERIALIZE: base vs HEAD =====`,
        `           canHalve  ÷2 null   canDouble  ×2 null`,
        `  base     ${String(base.canHalve).padEnd(9)} ${String(base.halveNull).padEnd(9)} ${String(base.canDouble).padEnd(10)} ${base.doubleNull}`,
        `  HEAD     ${String(head.canHalve).padEnd(9)} ${String(head.halveNull).padEnd(9)} ${String(head.canDouble).padEnd(10)} ${head.doubleNull}`,
      ].join('\n'),
    )
  })
})
