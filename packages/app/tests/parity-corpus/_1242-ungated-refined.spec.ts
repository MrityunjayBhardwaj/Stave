/**
 * _1242-ungated-refined.spec.ts — throwaway. WHICH strings produce the 8 ungated
 * refined refusals the widened corpus exposed, and is each one new?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1242-ungated-refined.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const rows = corpus.minis as { mini: string; tunes: number; via: string }[]
const viaOf = new Map(rows.map((r) => [r.mini.trim(), r.via]))
const minis = rows.map((o) => o.mini.trim()).filter((m) => m !== '')

const SCALES = [2, 4, 8, 16] as const

describe('#1242 — the ungated refined refusals', () => {
  it('names them, with the proposer that admitted each', () => {
    const out: string[] = []
    for (const mini of minis) {
      for (const k of SCALES) {
        for (const [surface, r] of [
          ['step', parseStepGrid(mini, k)],
          ['roll', parsePianoRoll(mini, k)],
        ] as const) {
          if (r.ok || r.gate) continue
          out.push(
            `  via=${(viaOf.get(mini) ?? '?').padEnd(7)} k=${String(k).padStart(2)} ${surface}  ` +
              `${r.reason}\n      ${JSON.stringify(mini.length > 120 ? mini.slice(0, 117) + '...' : mini)}`,
          )
        }
      }
    }
    console.log(`\n===== UNGATED REFINED REFUSALS: ${out.length} =====`)
    console.log(out.join('\n'))
    const distinct = new Set(
      minis.filter((m) =>
        SCALES.some((k) => {
          const a = parseStepGrid(m, k)
          const b = parsePianoRoll(m, k)
          return (!a.ok && !a.gate) || (!b.ok && !b.gate)
        }),
      ),
    )
    console.log(`\ndistinct minis involved: ${distinct.size}`)
    for (const m of distinct) console.log(`  via=${viaOf.get(m)}  ${JSON.stringify(m)}`)
  })
})
