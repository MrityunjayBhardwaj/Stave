/**
 * _1235-lost-placements.spec.ts — INSTRUMENT. WHICH leaf placements the length refusal
 * took, and — the question that decides whether the refusal is right — whether the write
 * they USED to produce actually matched the model the user was shown.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1235-lost-placements.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * `placement-admissibility` moved 3834 → 3860 refused and 20 → 18 placing leaf grids.
 *
 * ⚠ THE FIRST VERSION OF THIS PROBE ANSWERED "0 caused by the length check" AND WAS
 * VACUOUS TWICE OVER. It hand-rolled the placement without `clampLane`, so it never
 * built the model the panel builds; and its control forced each cell's length onto its
 * anchor's, which is where the lengths already came from — an intervention that changed
 * nothing, reading exactly like one that did ([[P525]]). It uses the real ungated op now,
 * and the control is the WRITTEN DOCUMENT re-parsed: if the bytes the old writer produced
 * do not project back to the model the user was looking at, the refusal is a fix and not
 * a reach loss.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { ungatedToggle } from './ungatedOps'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** what the panel shows, as a comparable string: each lane's sound and its cell lengths */
const shape = (m: StepGridModel): string =>
  m.lanes
    .map((l) => `${l.sound}[${l.cells.map((c) => (isCellOn(c) ? c.duration : '.')).join(' ')}]`)
    .sort()
    .join(' ')

describe('#1235 instrument — the leaf placements the length refusal took', () => {
  it('names them, and asks whether the write they used to produce matched the model', () => {
    let asks = 0
    let refusedNow = 0
    let lengthChanged = 0
    let wouldHaveDiverged = 0
    let wouldHaveMatched = 0
    const rows: string[] = []

    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      const ls = m.leafSource
      if (!ls) continue
      for (let lane = 0; lane < m.lanes.length; lane++)
        for (let col = 0; col < m.steps; col++) {
          if (isCellOn(m.lanes[lane].cells[col])) continue
          asks++
          const next = ungatedToggle(m, lane, col, true) as StepGridModel
          if (serializeStepGrid(next) !== null) continue
          refusedNow++
          // did the placement move any EXISTING note's length? (`clampLane` shortens a
          // neighbour that was sustaining through the clicked column)
          const moved = m.lanes.some((l, i) =>
            l.cells.some((c, j) => {
              if (!isCellOn(c)) return false
              const n = next.lanes[i].cells[j]
              return !(i === lane && j === col) && (!isCellOn(n) || n.duration !== c.duration)
            }),
          )
          if (!moved) continue // refused by one of the older rules, not by this one
          lengthChanged++
          // THE CONTROL: what the writer produced for this ask BEFORE the length check —
          // the same byte replacement, since the only new refusal is the length one. Take
          // the rest's bytes for the placed sound and re-parse the result.
          const rest = ls.rests?.[col]
          if (!rest) continue
          const out =
            ls.src.slice(0, rest.start) + m.lanes[lane].sound + ls.src.slice(rest.end)
          const back = parseStepGrid(out)
          const same = back.ok && shape(back.model as StepGridModel) === shape(next)
          if (same) wouldHaveMatched++
          else wouldHaveDiverged++
          if (rows.length < 30)
            rows.push(
              [
                `  ${same ? 'MATCHED ' : 'DIVERGED'}  ${JSON.stringify(mini)}`,
                `      place ${m.lanes[lane].sound} at col ${col}`,
                `      old write  ${JSON.stringify(out)}`,
                `      model says ${shape(next)}`,
                `      doc says   ${back.ok ? shape(back.model as StepGridModel) : '(does not parse as a grid)'}`,
              ].join('\n'),
            )
        }
    }
    console.log(`\n===== #1235 · leaf placements, and what the old write really said =====`)
    console.log(`  leaf placement asks:                       ${asks}`)
    console.log(`  refused by the writer now:                 ${refusedNow}`)
    console.log(`  ...of which moved an existing note's LENGTH ${lengthChanged}`)
    console.log(`       the old write DIVERGED from the model:  ${wouldHaveDiverged}`)
    console.log(`       the old write matched the model:        ${wouldHaveMatched}`)
    rows.forEach((r) => console.log(r))
  })
})
