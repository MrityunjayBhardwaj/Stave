/**
 * STEP 1 of the decline verification (#1010 P4c). Enumerates every (unit, lane,
 * column) toggle the alternation stress sweep DECLINES, and writes them to
 * `_p4c-declines.json` so the OLD writer — checked out separately — can be asked
 * what it would have emitted for exactly those edits.
 *
 * Not a gate. `.spec.ts` so the normal run skips it.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { cellOn, clampLane, isCellOn } from '../../../editor/src/codeView/notation/model'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = corpus.minis.map((o: { mini: string }) => o.mini)

describe('P4c — dump the declined toggles', () => {
  it('writes _p4c-declines.json', () => {
    const rows: {
      mini: string
      lane: number
      col: number
      laneToken: string
      steps: number
      bars: number
      turningOn: boolean
    }[] = []
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok || !r.model.altSource) continue
      for (let lane = 0; lane < r.model.lanes.length; lane++) {
        for (let col = 0; col < r.model.steps; col++) {
          const cells0 = [...r.model.lanes[lane].cells]
          const was = isCellOn(cells0[col])
          cells0[col] = was ? false : cellOn()
          const cells = clampLane(cells0, r.model.steps)
          const edited = {
            ...r.model,
            lanes: r.model.lanes.map((l, li) => (li === lane ? { ...l, cells } : l)),
          }
          if (serializeStepGrid(edited) !== null) continue
          rows.push({
            mini: mini.trim(),
            lane,
            col,
            laneToken: r.model.lanes[lane].sound,
            steps: r.model.steps,
            bars: r.model.bars ?? 1,
            turningOn: !was,
          })
        }
      }
    }
    fs.writeFileSync(path.join(here, '_p4c-declines.json'), JSON.stringify(rows, null, 1))
    const units = new Set(rows.map((r) => r.mini))
    console.log(`DECLINED: ${rows.length} toggles over ${units.size} units`)
  })
})
