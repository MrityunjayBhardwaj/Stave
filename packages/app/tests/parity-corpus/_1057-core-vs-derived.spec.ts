/**
 * _1057-core-vs-derived.spec.ts — SCRATCH PROBE. NOT A GATE. ([[P409]]: `_*.spec.ts`
 * is inert here — `vitest.config.ts` includes only `*.test.ts`.)
 *
 *   SWEEP=tests/parity-corpus/_1057-core-vs-derived.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE QUESTION THAT DECIDES #1057's SCOPE. #1055 shipped `ViewScale` into
 * `projectStepGridDerived` / `projectPianoRollDerived`. But `parseStepGrid` tries
 * `parseStepGridCore` FIRST and returns it when it succeeds — and the core takes no
 * scale at all. #1055's own demonstration (`bd ~ sn ~` drawing 4/8/16) called the
 * DERIVED projection directly, so it never exercised this ordering.
 *
 * So: for how many corpus units does the CORE answer? On those, today's seam is
 * unreachable and #1057 would have to reach the core too — which is a different size
 * of phase. Measured, not assumed.
 *
 * CONTROL ARM: `bd ~ sn ~` is #1052's canonical case and is named explicitly, so the
 * headline cannot be a corpus-wide average that hides the one pattern the issue is about.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
} from '../../../editor/src/codeView/notation/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const PRESETS = [4, 8, 16, 32, 64]

type P = (m: string) => { ok: boolean; model?: { steps: number; leafSource?: unknown } }

function split(label: string, parse: P, core: P): void {
  let coreOpens = 0
  let derivedOpens = 0
  let refused = 0
  // free-zone asks that are STRANDED because the core answered (the seam can't reach them)
  let strandedAsks = 0
  let reachableAsks = 0

  for (const mini of minis) {
    const full = parse(mini)
    if (!full.ok || !full.model) {
      refused++
      continue
    }
    const c = core(mini)
    const byCore = c.ok
    if (byCore) coreOpens++
    else derivedOpens++
    const steps = full.model.steps
    const asks = PRESETS.filter((t) => t > steps && t % steps === 0).length
    if (byCore) strandedAsks += asks
    else if (full.model.leafSource == null) reachableAsks += asks
  }

  console.log(`\n════════ ${label} ════════`)
  console.log(`opens via CORE (no scale param)   : ${coreOpens}`)
  console.log(`opens via DERIVED (has the seam)  : ${derivedOpens}`)
  console.log(`refused                            : ${refused}`)
  console.log(`free-zone asks STRANDED at the core: ${strandedAsks}`)
  console.log(`free-zone asks reachable today     : ${reachableAsks}`)
}

describe('#1057 scope: does the core or the derived projection answer?', () => {
  it('grid', () => {
    split('STEP GRID', parseStepGrid as never, parseStepGridCore as never)
    // the canonical case, named — not averaged away
    for (const m of ['bd ~ sn ~', 'bd sd', 'bd*4', 'bd ~ ~ sn']) {
      const c = parseStepGridCore(m)
      const f = parseStepGrid(m)
      console.log(
        `  "${m}"  core=${c.ok ? `OK steps=${(c as { model: { steps: number } }).model.steps}` : 'refused'}` +
          `  full=${f.ok ? `OK steps=${(f as { model: { steps: number } }).model.steps}` : 'refused'}`,
      )
    }
  })

  it('roll', () => {
    split('PIANO ROLL', parsePianoRoll as never, parsePianoRollCore as never)
    for (const m of ['c3 e3 g3', 'c3 ~ e3 ~']) {
      const c = parsePianoRollCore(m)
      console.log(`  "${m}"  core=${c.ok ? 'OK' : 'refused'}`)
    }
  })
})
