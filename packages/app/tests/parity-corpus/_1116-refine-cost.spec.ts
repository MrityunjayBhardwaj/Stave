/**
 * _1116-refine-cost.spec.ts — PROBE (inert). Self-review question: routing at the
 * identity value means a REFINED ask parses twice — once to decide ownership, once to
 * draw. #1057 calls this on every resolution change in the panel, so the doubling is a
 * real cost and not a theoretical one. Price it before assuming it is fine.
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

function time(label: string, f: () => void) {
  f() // warm
  const t0 = performance.now()
  f()
  const ms = performance.now() - t0
  console.log(`${label.padEnd(34)} ${ms.toFixed(0)} ms`)
  return ms
}

describe('#1116 refine cost', () => {
  it('prices an unrefined sweep against a refined one, both surfaces', () => {
    const gridOpens = minis.filter((m) => parseStepGrid(m).ok)
    const rollOpens = minis.filter((m) => parsePianoRoll(m).ok)
    console.log(`grid units ${gridOpens.length} · roll units ${rollOpens.length}`)

    const g1 = time('grid  @UNREFINED', () => gridOpens.forEach((m) => parseStepGrid(m)))
    const g2 = time('grid  @k=2', () => gridOpens.forEach((m) => parseStepGrid(m, 2)))
    const r1 = time('roll  @UNREFINED', () => rollOpens.forEach((m) => parsePianoRoll(m)))
    const r2 = time('roll  @k=2', () => rollOpens.forEach((m) => parsePianoRoll(m, 2)))

    console.log(`grid ratio ${(g2 / g1).toFixed(2)}x  ·  per-unit refined ${(g2 / gridOpens.length).toFixed(2)} ms`)
    console.log(`roll ratio ${(r2 / r1).toFixed(2)}x  ·  per-unit refined ${(r2 / rollOpens.length).toFixed(2)} ms`)
  })
})
