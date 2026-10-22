/**
 * _1041-grid-cap-probe.spec.ts — SCRATCH. Measure the grid side before building the arm.
 *
 * Two questions, both of which the real gate will depend on and neither of which should be
 * assumed:
 *   1. Is there a grid pattern past every admissible cap that stops at `unstable-period`?
 *      The roll's probe is `<0 1 … 25>`, which the GRID refuses for `wrong-surface` — it
 *      plays numbers. So the grid needs its own, in sound names.
 *   2. What do the two populations look like on the grid at the shipped cap? The roll's
 *      A/B split is 1180/453; the grid's is a different carve and nothing says it is
 *      similar.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROJECTION_PERIOD_BOUNDS,
  parseStepGrid,
  parseStepGridCore,
  projectStepGridDerived,
} from '../../../editor/src/codeView/notation/parse'
import { hasStructure } from '../../../editor/src/codeView/notation/model'
import type { PianoRollModel, StepGridModel } from '../../../editor/src/codeView/notation/model'
import { GRID_SURFACE, liveness, probeEdit } from './engineEditOracle'
import { truePeriod } from './enginePeriod'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

const NO_CORE_REFUSAL = { ok: false as const, reason: '(core served this — no refusal)' }

/** 26 alternatives, so the period is past every admissible cap; sound names, so it is the GRID's */
const PAST = `<${[...Array(25).fill('bd'), 'sd'].join(' ')}>`

describe('#1041 grid cap probe', () => {
  it('reads the grid cap out of the shipped refusal sentence', () => {
    const sounds = ['bd','sd','hh','oh','cp','rim','lt','mt','ht','rd','cr','sh','tb','misc','perc','can','metal','east','crow','click','hand','numbers','space','wind','jazz','jvbass']
    const candidates: [string, string][] = [
      ['25xbd+sd', `<${[...Array(25).fill('bd'), 'sd'].join(' ')}>`],
      ['26 distinct', `<${sounds.slice(0, 26).join(' ')}>`],
      ['26 distinct, 2 lanes', `<${sounds.slice(0, 26).join(' ')}> , hh*2`],
      ['growing groups', `<${Array.from({ length: 26 }, (_, i) => (i === 0 ? 'bd' : `[${Array(i + 1).fill('bd').join(' ')}]`)).join(' ')}>`],
      ['alt of pairs', `<${Array.from({ length: 26 }, (_, i) => `[bd ${sounds[(i + 1) % sounds.length]}]`).join(' ')}>`],
      ['slow 26', `bd sd hh oh`],
    ]
    console.log('\n=== grid cap probe candidates ===')
    for (const [name, pat] of candidates) {
      const r = projectStepGridDerived(pat, NO_CORE_REFUSAL)
      if (r.ok) { console.log(`  ${name.padEnd(22)} OPENED A VIEW`); continue }
      const m = /within (\d+) bars/.exec(r.reason ?? '')
      console.log(`  ${name.padEnd(22)} gate=${String(r.gate).padEnd(18)} cap=${m ? m[1] : '-'}   ${JSON.stringify(pat).slice(0, 60)}`)
    }
    console.log(`  shipped leaf caps: ${JSON.stringify(PROJECTION_PERIOD_BOUNDS.leaf)}`)
  })

  it('sizes both grid populations at the shipped cap', () => {
    for (const pop of ['A-core-refused', 'B-core-served'] as const) {
      let asks = 0
      const outcome = { transfers: 0, 'no-view': 0, 'view-corrupts': 0, 'no-probe': 0 }
      const gates = new Map<string, number>()
      let leaf = 0
      let element = 0
      let structured = 0
      let alive = 0
      let probed = 0
      for (const mini of minis) {
        const core = parseStepGridCore(mini)
        if (core.ok !== (pop === 'B-core-served')) continue
        asks++
        const r =
          pop === 'A-core-refused' ? parseStepGrid(mini) : projectStepGridDerived(mini, NO_CORE_REFUSAL)
        if (!r.ok) {
          outcome['no-view']++
          const g = r.gate ?? '(no gate)'
          gates.set(g, (gates.get(g) ?? 0) + 1)
          continue
        }
        // the intersection the oracle types its own parameters against; a grid model has
        // no `notes`, so the plain `StepGridModel` does not satisfy it
        const m = r.model as StepGridModel & PianoRollModel
        if ((m as { leafSource?: unknown }).leafSource) leaf++
        else element++
        if (hasStructure(m, 'step')) structured++
        const probe = probeEdit(mini, m, GRID_SURFACE)
        outcome[
          probe.verdict === 'ok' ? 'transfers' : probe.verdict === 'corrupt' ? 'view-corrupts' : 'no-probe'
        ]++
        const live = liveness(mini, m, GRID_SURFACE)
        if (live) {
          alive += live.alive
          probed += live.probed
        }
      }
      console.log(`\n===== GRID — POPULATION ${pop} (${asks} asks) =====`)
      console.log(`  transfers     ${outcome.transfers}`)
      console.log(`  no view       ${outcome['no-view']}`)
      console.log(`  CORRUPTS      ${outcome['view-corrupts']}`)
      console.log(`  no clean probe ${outcome['no-probe']}`)
      console.log(`  writers: ${leaf} leaf / ${element} element`)
      console.log(`  structured: ${structured}`)
      console.log(`  liveness: ${alive}/${probed}`)
      console.log(`  -- gates --`)
      for (const [k, v] of [...gates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
        console.log(`     ${String(v).padStart(4)}x  ${k}`)
    }
  })

  it('counts how many period-refused grid asks the cap actually governs', () => {
    let past = 0
    let within = 0
    let aperiodic = 0
    const cap = PROJECTION_PERIOD_BOUNDS.leaf.grid
    for (const mini of minis) {
      const core = parseStepGridCore(mini)
      if (core.ok) continue
      const r = parseStepGrid(mini)
      if (r.ok || r.gate !== 'unstable-period') continue
      const p = truePeriod(mini)
      if (p === 0) aperiodic++
      else if (p > cap) past++
      else within++
    }
    console.log(`\n=== population A, refused for period (cap ${cap}) ===`)
    console.log(`  past the cap : ${past}`)
    console.log(`  aperiodic    : ${aperiodic}`)
    console.log(`  WITHIN cap   : ${within}   <-- must be 0`)
  })
})
