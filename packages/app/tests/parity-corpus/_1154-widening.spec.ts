/**
 * _1154-widening.spec.ts — PROBE. How far does indexing rests actually reach?
 *
 * The round-trip fix cannot be scoped to "the `~` we wrote", because the model is
 * re-read from the document after every write and nothing distinguishes a rest this
 * writer produced from one the user typed. So allowing the undo necessarily allows
 * placing on ANY indexed rest. This measures that consequence on PRISTINE documents —
 * no delete first — which is what the panel offers a user opening a file.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { canToggleCell } from '../../../editor/src/codeView/notation/place'
import { isCellOn } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

describe('#1154 — the widening, on pristine documents', () => {
  it('measures it', () => {
    let leafUnits = 0
    let unitsOfferingSomething = 0
    let asks = 0
    let offers = 0
    const samples: string[] = []
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok || !r.model.leafSource) continue
      leafUnits++
      let here0 = 0
      for (let lane = 0; lane < r.model.lanes.length; lane++)
        for (let col = 0; col < r.model.steps; col++) {
          if (isCellOn(r.model.lanes[lane].cells[col])) continue
          asks++
          if (canToggleCell(r.model, lane, col, true)) {
            offers++
            here0++
          }
        }
      if (here0 > 0) {
        unitsOfferingSomething++
        if (samples.length < 10) samples.push(`${String(here0).padStart(3)} cells  ${mini.slice(0, 70)}`)
      }
    }
    console.log(`\n  leaf units: ${leafUnits}`)
    console.log(`  empty-cell asks on them: ${asks}`)
    console.log(
      `  now ACCEPTED: ${offers} (${((offers / asks) * 100).toFixed(1)}%), across ${unitsOfferingSomething} units`,
    )
    console.log(
      `  view-level: ${unitsOfferingSomething} of ${leafUnits} leaf units would need the panel to stop`,
    )
    console.log(`              saying "this view places nothing" for the whole grid.\n`)
    for (const s of samples) console.log(`    ${s}`)
  })
})
