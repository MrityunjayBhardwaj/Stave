/**
 * _1116-lost-units.spec.ts — PROBE (inert: `_` prefix + `.spec.ts`).
 *
 * THE UNASKED QUESTION from #1057's denominator work: between the pinned pre-#1047 copy
 * and the live tree, the grid's opening population moved 968 → 958, with element
 * 896 → 876 and leaf 72 → 82. An element-only count reports that as "-20" and cannot
 * tell a REALLOCATION (element unit now served by the leaf writer — no reach lost) from
 * a LOSS (unit stops opening at all). The path split says 10 of each. This probe names
 * the 10 losses and asks the live tree WHY it refuses each one.
 *
 * The suspicion on record is that they are the deliberate refusals — `leafViewUsable` /
 * prove-before-offer, i.e. views that opened but offered nothing a user could act on.
 * That is a hypothesis, not a finding, and it is what this measures.
 *
 * ⚠ THE BASE IS A WHOLE-MODULE SNAPSHOT. Everything that landed in parse/model/
 * resolution/serialize since #1047 is folded into any difference, so this attributes to
 * a REASON STRING and a gate, never to a single issue. Naming the reason is what makes
 * the next step decidable.
 *
 *   SWEEP=tests/parity-corpus/_1116-lost-units.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as live from '../../../editor/src/codeView/notation/parse'
import * as base from './__p4c_base__/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

type R = { ok: boolean; reason?: string; gate?: string; model?: { steps: number; leafSource?: unknown; lanes?: unknown[] } }
const where = (r: R) => (!r.ok || !r.model ? 'refused' : r.model.leafSource != null ? 'leaf' : 'element')
const show = (m: string) => JSON.stringify(m.length > 76 ? m.slice(0, 76) + '…' : m)

describe('#1116 / #1057 — the units that stopped opening', () => {
  it('names every grid unit whose verdict moved, and why the live tree refuses it', () => {
    // CONTROL ARM: the two modules must actually differ, or silence means nothing.
    expect(base.parseStepGrid).not.toBe(live.parseStepGrid)

    const counts = { base: { element: 0, leaf: 0, refused: 0 }, live: { element: 0, leaf: 0, refused: 0 } }
    const lost: string[] = []
    const gained: string[] = []
    const moved: string[] = []

    for (const mini of minis) {
      const b = base.parseStepGrid(mini) as R
      const l = live.parseStepGrid(mini) as R
      const wb = where(b)
      const wl = where(l)
      counts.base[wb]++
      counts.live[wl]++
      if (wb === wl) continue
      if (wl === 'refused') {
        lost.push(`${show(mini)}\n        was ${wb} (${b.model?.steps} cols, ${b.model?.lanes?.length ?? 0} lanes)  →  REFUSED: ${l.reason ?? '(no reason)'}${l.gate ? `  [gate ${l.gate}]` : '  [no gate]'}`)
      } else if (wb === 'refused') {
        gained.push(`${show(mini)}  →  now ${wl}`)
      } else {
        moved.push(`${show(mini)}  ${wb} → ${wl}`)
      }
    }

    console.log(`\nBASE  element ${counts.base.element}  leaf ${counts.base.leaf}  refused ${counts.base.refused}  → opens ${counts.base.element + counts.base.leaf}`)
    console.log(`LIVE  element ${counts.live.element}  leaf ${counts.live.leaf}  refused ${counts.live.refused}  → opens ${counts.live.element + counts.live.leaf}`)
    console.log(`\nLOST (opened on base, refused live): ${lost.length}`)
    lost.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s}`))
    console.log(`\nGAINED (refused on base, opens live): ${gained.length}`)
    gained.forEach((s) => console.log(`      ${s}`))
    console.log(`\nMOVED between paths (no reach change): ${moved.length}`)
    moved.forEach((s) => console.log(`      ${s}`))

    // the arithmetic must close, or the three buckets do not account for the delta
    const netOpens =
      counts.live.element + counts.live.leaf - (counts.base.element + counts.base.leaf)
    console.log(`\nnet opens ${netOpens}  =  gained ${gained.length} − lost ${lost.length}`)
  })
})
