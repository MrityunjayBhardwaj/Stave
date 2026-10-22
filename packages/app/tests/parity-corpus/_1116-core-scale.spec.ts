/**
 * _1116-core-scale.spec.ts — SCRATCH PROBE. NOT A GATE. ([[P409]]: `_*.spec.ts` inert here.)
 *
 *   SWEEP=tests/parity-corpus/_1116-core-scale.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * Observing #1116 through the PUBLIC entry `parseStepGrid(mini, scale)` — the ordering
 * #1055's gate did not exercise, because it called `projectStepGridDerived` directly.
 *
 * Three questions, all asked of the whole corpus:
 *   1. INERT — is an explicit `UNREFINED` indistinguishable from omitting the argument?
 *   2. LIVE  — does a scale actually reach the CORE-parsed units now, and by exactly k?
 *   3. FAITHFUL — is a refine a pure magnification: same notes, same musical positions,
 *      every onset column multiplied by k and nothing else moved?
 *
 * (3) is the one that matters. (2) alone is satisfied by a projection that draws k×
 * the columns and puts the notes anywhere.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'
import { documentSteps } from '../../../editor/src/codeView/notation/viewResolution'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** the ON columns per lane sound — the musical content, independent of column count */
function onsets(m: StepGridModel): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const lane of m.lanes) {
    const cols: number[] = []
    lane.cells.forEach((c, i) => {
      if (isCellOn(c)) cols.push(i)
    })
    out.set(`${lane.sound}#${lane.part ?? 0}`, cols)
  }
  return out
}

describe('#1116 probe: the scale through the public entry', () => {
  it('inert / live / faithful', () => {
    let opened = 0
    let coreOpened = 0
    let inertMismatch = 0
    const liveByK = new Map<number, number>()
    const refusedByK = new Map<number, number>()
    let stepsWrong = 0
    let docStepsWrong = 0
    let contentWrong = 0
    const contentExamples: string[] = []

    for (const mini of minis) {
      const base = parseStepGrid(mini)
      if (!base.ok) continue
      opened++
      if (parseStepGridCore(mini).ok) coreOpened++

      // 1. INERT — explicit UNREFINED must be byte-identical to the default
      const explicit = parseStepGrid(mini, 1)
      if (JSON.stringify(explicit) !== JSON.stringify(base)) inertMismatch++

      const baseOn = onsets(base.model)
      for (const k of [2, 4]) {
        const r = parseStepGrid(mini, k)
        if (!r.ok) {
          refusedByK.set(k, (refusedByK.get(k) ?? 0) + 1)
          continue
        }
        liveByK.set(k, (liveByK.get(k) ?? 0) + 1)

        // 2. LIVE — exactly k times the columns, and the document width recoverable
        if (r.model.steps !== base.model.steps * k) stepsWrong++
        if (documentSteps(r.model) !== base.model.steps) docStepsWrong++

        // 3. FAITHFUL — same lanes, every onset at k× its old column, nothing else
        const got = onsets(r.model)
        let bad = got.size !== baseOn.size
        if (!bad) {
          for (const [lane, cols] of baseOn) {
            const g = got.get(lane)
            if (!g || g.length !== cols.length || g.some((c, i) => c !== cols[i] * k)) {
              bad = true
              break
            }
          }
        }
        if (bad) {
          contentWrong++
          if (contentExamples.length < 8) {
            contentExamples.push(
              `k=${k} ${JSON.stringify(mini).slice(0, 56)}  ` +
                `base=${JSON.stringify([...baseOn.entries()]).slice(0, 60)}  ` +
                `got=${JSON.stringify([...got.entries()]).slice(0, 60)}`,
            )
          }
        }
      }
    }

    console.log(`\n════════ STEP GRID via parseStepGrid(mini, k) ════════`)
    console.log(`units opening            : ${opened}  (core-parsed ${coreOpened})`)
    console.log(`INERT   explicit k=1 differs from default : ${inertMismatch}   ← must be 0`)
    for (const k of [2, 4]) {
      console.log(
        `LIVE    k=${k}: opened ${liveByK.get(k) ?? 0}  refused ${refusedByK.get(k) ?? 0}`,
      )
    }
    console.log(`FAITHFUL steps !== base*k                 : ${stepsWrong}    ← must be 0`)
    console.log(`         documentSteps !== base.steps      : ${docStepsWrong}    ← must be 0`)
    console.log(`         content moved                     : ${contentWrong}    ← must be 0`)
    for (const e of contentExamples) console.log(`    ${e}`)

    // the canonical case, named rather than averaged away
    console.log(`\n"bd ~ sn ~" columns by k:`)
    for (const k of [1, 2, 4, 8]) {
      const r = parseStepGrid('bd ~ sn ~', k)
      console.log(
        `  k=${k} → ${r.ok ? `${(r as { model: StepGridModel }).model.steps} columns` : 'refused'}`,
      )
    }
  })
})
