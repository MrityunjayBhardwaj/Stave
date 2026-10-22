/**
 * _p4e-core-cost.spec.ts — INSTRUMENT. What attaching P4d's overlay to the CORE path
 * would cost per parse, measured as a paired A/B on one tree in one session.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_p4e-core-cost.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ⚠ THE INTERVENTION PRINTS ITS OWN EFFECT, and that line is read BEFORE the timing
 * ([[P546]]: a control arm that silently did not intervene reads exactly like one that
 * did, and reported +0.6% for a change that costs +59%). `overlays attached` is 0 on
 * the control tree and non-zero on the treatment tree; two arms with the same count
 * measured the same code and the timing below means nothing.
 *
 * The population is the CORE-OPENED units — the ones `parseStepGridCore` answers, which
 * is the hot path (783 of 958 corpus units, re-parsed on every edit), and the half P4d
 * did not touch.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

describe('P4e instrument — the core path with and without the overlay', () => {
  it('times parseStepGrid over the core-opened units', () => {
    const core = minis.filter((m) => parseStepGridCore(m).ok)

    // ── the intervention's own effect, read first ──
    let overlays = 0
    for (const m of core) {
      const r = parseStepGrid(m)
      if (r.ok && (r.model as StepGridModel).surgical) overlays++
    }
    console.log(`\n===== P4e COST: core-opened parse (${core.length} units) =====`)
    console.log(`  overlays attached:  ${overlays}   <-- 0 = control arm, >0 = treatment arm`)

    const REPS = 20
    for (let w = 0; w < 3; w++) for (const m of core) parseStepGrid(m)
    const t0 = performance.now()
    for (let i = 0; i < REPS; i++) for (const m of core) parseStepGrid(m)
    const t1 = performance.now()
    const perParse = ((t1 - t0) * 1000) / (REPS * core.length)
    console.log(`  per parse:          ${perParse.toFixed(1)}us   (${REPS} reps over ${core.length} units)`)
    expect(core.length).toBeGreaterThan(700)
  })
})
