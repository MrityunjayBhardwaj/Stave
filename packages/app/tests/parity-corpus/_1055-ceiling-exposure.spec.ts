/**
 * _1055-ceiling-exposure.spec.ts — scratch probe for #1055's ceiling decision.
 *
 * A `.spec.ts`, so neither runner collects it (#1111). Run with:
 *   SWEEP='tests/parity-corpus/_1055-ceiling-exposure.spec.ts' npx vitest run --config vitest.sweep.config.ts
 *
 * THE QUESTION #1055 OWES A DECISION ON: `MAX_STEPS = 64` gates `perBar * bars` at
 * every projection entry. Scaling `perBar` for a finer VIEW walks into that ceiling,
 * so "a view action could make a pattern un-openable — the panel closes because the
 * user asked to look more closely".
 *
 * Before choosing a mechanism, price the exposure ([[P407]]): how many corpus units
 * would actually cross the ceiling at each refine factor, and how much headroom does
 * the population have today?
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const MAX_STEPS = 64

describe('#1055 probe — how much of the corpus does a view refine push past the ceiling?', () => {
  it('measures headroom per surface', () => {
    for (const [label, parse] of [
      ['step grid', parseStepGrid],
      ['piano roll', parsePianoRoll],
    ] as const) {
      const steps: number[] = []
      for (const mini of minis) {
        const r = parse(mini)
        if (!r.ok || !r.model) continue
        steps.push(r.model.steps)
      }
      steps.sort((a, b) => a - b)
      const over = steps.filter((x) => x > MAX_STEPS)
      console.log(`\n  [${label}] models ALREADY over MAX_STEPS(64): ${over.length} -> ${JSON.stringify(over)}`)
      const crossesAt = (k: number): number => steps.filter((s) => s * k > MAX_STEPS).length
      const pct = (n: number): string => `${((n / steps.length) * 100).toFixed(1)}%`
      console.log(
        [
          `\n===== CEILING EXPOSURE: ${label} =====`,
          `  units opening                 ${steps.length}`,
          `  steps  min/median/max         ${steps[0]} / ${steps[Math.floor(steps.length / 2)]} / ${steps[steps.length - 1]}`,
          `  ALREADY at the ceiling (=64)  ${steps.filter((s) => s === MAX_STEPS).length}`,
          `  would cross 64 at ×2          ${crossesAt(2)}  (${pct(crossesAt(2))})`,
          `  would cross 64 at ×4          ${crossesAt(4)}  (${pct(crossesAt(4))})`,
          `  would cross 64 at ×8          ${crossesAt(8)}  (${pct(crossesAt(8))})`,
          `  distribution of steps:`,
          ...Object.entries(
            steps.reduce<Record<number, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {}),
          )
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([s, n]) => `     ${String(s).padStart(4)} cols  ${n}`),
        ].join('\n'),
      )
    }
  }, 600_000)
})
