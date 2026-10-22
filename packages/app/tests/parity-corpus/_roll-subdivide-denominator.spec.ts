/**
 * DENOMINATOR-FIRST probe: how much of the corpus even OPENS as a roll, and how
 * much of that can be subdivided at all?
 *
 * The subdivide arc measured the GRID over this corpus five times
 * (`_1007-subdivide-locality`, `_1007-subdivide-route`, `_1052-resolution-truth`,
 * `_1301-floor-and-witness`, `_p4c-halve-blast`) and the roll zero times. Before
 * posing any of those questions of the roll, ask what population would answer:
 * a treatment column means nothing until the denominator is non-zero, and a
 * measurement over 12 units is not the same instrument as one over 800.
 *
 * Hand-run: `npx vitest run --config vitest.sweep.config.ts _roll-subdivide-denominator`
 *
 * Reads the TRACKED `mini-corpus.json` and nothing else — no `.bakery-runs/`
 * archive — so unlike the hand-run probes #1307 surveyed, this one runs on a
 * fresh clone. That matters because it is the provenance of a quoted figure.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  canDoubleStepGrid,
  canHalveStepGrid,
  canDoublePianoRoll,
  canHalvePianoRoll,
} from '../../../editor/src/codeView/notation/resolution'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORPUS = path.join(HERE, 'mini-corpus.json')

describe('roll subdivide — the denominator', () => {
  it('counts what opens and what can move, on both surfaces', () => {
    if (!fs.existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS}`)
    const minis: string[] = JSON.parse(fs.readFileSync(CORPUS, 'utf8')).minis.map(
      (r: { mini: string }) => r.mini,
    )

    const c = {
      total: minis.length,
      gridOpens: 0, rollOpens: 0, bothOpen: 0, neitherOpens: 0, rollOnly: 0, gridOnly: 0,
      gridDouble: 0, gridHalve: 0, rollDouble: 0, rollHalve: 0,
      rollDoubleOrHalve: 0, gridDoubleOrHalve: 0, rollOnlyMovable: 0, bothMovable: 0,
    }

    for (const mini of minis) {
      const g = parseStepGrid(mini)
      const r = parsePianoRoll(mini)
      const go = g.ok === true
      const ro = r.ok === true
      if (go) c.gridOpens++
      if (ro) c.rollOpens++
      if (go && ro) c.bothOpen++
      if (!go && !ro) c.neitherOpens++
      if (ro && !go) c.rollOnly++
      if (go && !ro) c.gridOnly++

      if (go && g.ok) {
        const d = canDoubleStepGrid(g.model)
        const h = canHalveStepGrid(g.model)
        if (d) c.gridDouble++
        if (h) c.gridHalve++
        if (d || h) c.gridDoubleOrHalve++
      }
      if (ro && r.ok) {
        const d = canDoublePianoRoll(r.model)
        const h = canHalvePianoRoll(r.model)
        if (d) c.rollDouble++
        if (h) c.rollHalve++
        if (d || h) c.rollDoubleOrHalve++
        // the population NO grid probe can reach: opens as a roll, not as a
        // grid, and can actually move. This is the honest "unmeasured" figure.
        if (!go && (d || h)) c.rollOnlyMovable++
        if (go && (d || h)) c.bothMovable++
      }
    }

    const pct = (n: number) => `${((n / c.total) * 100).toFixed(1)}%`
    console.log(`
  corpus minis                    ${c.total}

  OPENS AS...                     grid            roll
  parses                          ${String(c.gridOpens).padEnd(6)} ${pct(c.gridOpens).padEnd(8)} ${String(c.rollOpens).padEnd(6)} ${pct(c.rollOpens)}
  can double                      ${String(c.gridDouble).padEnd(6)} ${pct(c.gridDouble).padEnd(8)} ${String(c.rollDouble).padEnd(6)} ${pct(c.rollDouble)}
  can halve                       ${String(c.gridHalve).padEnd(6)} ${pct(c.gridHalve).padEnd(8)} ${String(c.rollHalve).padEnd(6)} ${pct(c.rollHalve)}
  can move at all (double|halve)  ${String(c.gridDoubleOrHalve).padEnd(6)} ${pct(c.gridDoubleOrHalve).padEnd(8)} ${String(c.rollDoubleOrHalve).padEnd(6)} ${pct(c.rollDoubleOrHalve)}

  OVERLAP
  both surfaces open              ${c.bothOpen}
  grid only                       ${c.gridOnly}
  roll only                       ${c.rollOnly}
  neither                         ${c.neitherOpens}

  THE UNMEASURED POPULATION
  roll-only AND can move          ${c.rollOnlyMovable}   ${pct(c.rollOnlyMovable)} of corpus
    -> no grid probe can reach these at all
  both-open AND roll can move     ${c.bothMovable}
    -> a grid probe saw these, but as a GRID, asking a different question
`)
  })
})
