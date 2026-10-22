/**
 * _1057-denominator-base.spec.ts — SCRATCH PROBE. NOT A GATE. ([[P409]]: `_*.spec.ts`
 * is inert here — `vitest.config.ts` includes only `*.test.ts`.)
 *
 *   SWEEP=tests/parity-corpus/_1057-denominator-base.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * #1057's done-when is stated against "~3006 lossless-refine offers on the grid". The
 * live tree measures 2967. `__p4c_base__/` is a pinned copy of parse/resolution/
 * serialize/model as of #1047 (P4c), so the same count runs on both.
 *
 * ⚠ THE BASE IS A WHOLE-MODULE SNAPSHOT, NOT A P4c ISOLATE. Everything that landed in
 * those modules since #1047 (#986 leaf work, #1064, #1070, #1086, #1087, #1055 …) is
 * folded into any difference. So a raw base-vs-live delta shows the figure belongs to an
 * older tree and attributes it to NOTHING. Two decompositions are therefore run:
 *
 *   (1) 2×2 FACTORIAL — {base,live} parse × {base,live} slotState. Splits the delta into
 *       "what opens and how it is projected" vs "what the control is willing to offer".
 *   (2) WHERE THE UNITS WENT — element / leaf / refused, both trees. An element unit that
 *       stops opening is a reach loss; one that MOVED to the leaf path is a reallocation.
 *       These read identically in an element-only count, which is how the first version
 *       of this probe would have mis-reported it.
 *
 * CONTROL ARM: the base and live copies must be shown to differ, else the probe compared
 * a module against itself and its silence would mean nothing ([[P410]]).
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as live from '../../../editor/src/codeView/notation/parse'
import * as liveRes from '../../../editor/src/codeView/notation/resolution'
import * as base from './__p4c_base__/parse'
import * as baseRes from './__p4c_base__/resolution'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const PRESETS = [4, 8, 16, 32, 64]

type Parse = (m: string) => { ok: boolean; model?: { steps: number; leafSource?: unknown } }
type Slot = (model: never, t: number) => string

/** lossless-refine offers over ELEMENT units — the quantity #1057's done-when names */
function offers(parse: Parse, slot: Slot): number {
  let n = 0
  for (const mini of minis) {
    const r = parse(mini)
    if (!r.ok || !r.model || r.model.leafSource != null) continue
    for (const t of PRESETS) {
      if (t > r.model.steps && slot(r.model as never, t) === 'lossless') n++
    }
  }
  return n
}

/** where each corpus unit lands: element view, leaf view, or refused */
function paths(parse: Parse): { element: number; leaf: number; refused: number } {
  const p = { element: 0, leaf: 0, refused: 0 }
  for (const mini of minis) {
    const r = parse(mini)
    if (!r.ok || !r.model) p.refused++
    else if (r.model.leafSource != null) p.leaf++
    else p.element++
  }
  return p
}

function surface(label: string, bp: Parse, lp: Parse, bs: Slot, ls: Slot, quoted?: number): void {
  console.log(`\n════════ ${label} ════════`)

  /* (1) the 2×2 */
  const bb = offers(bp, bs)
  const bl = offers(bp, ls)
  const lb = offers(lp, bs)
  const ll = offers(lp, ls)
  console.log(`lossless-refine offers, {parse} × {slotState}:`)
  console.log(`             slotState=BASE   slotState=LIVE`)
  console.log(`  parse=BASE      ${String(bb).padEnd(13)}    ${bl}`)
  console.log(`  parse=LIVE      ${String(lb).padEnd(13)}    ${ll}`)
  console.log(
    `  → offer-side effect (hold parse=LIVE): ${lb} → ${ll}  = ${ll - lb}` +
      `   parse-side effect (hold slotState=LIVE): ${bl} → ${ll}  = ${ll - bl}`,
  )
  if (quoted !== undefined) {
    console.log(`  #1057 quotes ~${quoted}:  vs BASE ${quoted - bb >= 0 ? '+' : ''}${quoted - bb}   vs LIVE ${quoted - ll >= 0 ? '+' : ''}${quoted - ll}`)
  }

  /* (2) where the units went */
  const pb = paths(bp)
  const pl = paths(lp)
  console.log(
    `unit paths   BASE  element ${pb.element}  leaf ${pb.leaf}  refused ${pb.refused}  (total ${pb.element + pb.leaf})`,
  )
  console.log(
    `             LIVE  element ${pl.element}  leaf ${pl.leaf}  refused ${pl.refused}  (total ${pl.element + pl.leaf})`,
  )
  console.log(
    `             Δ     element ${pl.element - pb.element}  leaf ${pl.leaf - pb.leaf}  ` +
      `TOTAL OPENING ${pl.element + pl.leaf - (pb.element + pb.leaf)}` +
      `  ← 0 here means reallocation, not reach loss`,
  )

  /* control arm */
  console.log(`control — the two copies differ on this surface: ${bb !== ll || pb.element !== pl.element}`)
}

describe('#1057 denominator, decomposed', () => {
  it('grid', () => {
    surface(
      'STEP GRID',
      base.parseStepGrid as never,
      live.parseStepGrid as never,
      baseRes.stepSlotState as never,
      liveRes.stepSlotState as never,
      3006,
    )
  })

  it('roll', () => {
    surface(
      'PIANO ROLL',
      base.parsePianoRoll as never,
      live.parsePianoRoll as never,
      baseRes.rollSlotState as never,
      liveRes.rollSlotState as never,
    )
  })
})
