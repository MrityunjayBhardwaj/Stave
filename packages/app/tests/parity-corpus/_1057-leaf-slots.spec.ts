/**
 * _1057-leaf-slots.spec.ts — SCRATCH PROBE for #1057's design call. NOT A GATE.
 *
 * `_*.spec.ts` in this directory is genuinely inert: `vitest.config.ts` includes only
 * `*.test.ts` and playwright ignores the directory via `VITEST_ONLY` ([[P409]]).
 * Run it on demand:
 *   SWEEP=tests/parity-corpus/_1057-leaf-slots.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * TWO QUESTIONS:
 *
 * (1) THE LEAF PATH. #1055 shipped the view-resolution parameter on the ELEMENT path
 *     only; the LEAF path (#986) anchors each note to its own source span, so a finer
 *     view has no span to subdivide. Measure what the Slots control offers on leaf units
 *     TODAY — the answer decides whether Phase 4 has anything to change there.
 *
 * (2) THE DENOMINATOR. #1057's done-when is stated against "~3006 lossless-refine offers
 *     on the grid". That figure appears nowhere in the repo or the catalogues — only in
 *     the issue body. Before a gate is written against it, decompose the candidate
 *     definitions and see which one it is, and where they disagree. A denominator that
 *     nobody can reproduce turns a gate green over material it never covered ([[P343]]).
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  RESOLUTION_PRESETS,
  stepSlotState,
  rollSlotState,
  type SlotState,
} from '../../../editor/src/codeView/notation/resolution'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

type Ask = {
  mini: string
  steps: number
  bars: number
  leaf: boolean
  target: number
  state: SlotState
  refine: boolean
  multiple: boolean
}

function asks(
  parse: (m: string) => { ok: boolean; model?: unknown },
  slot: (model: never, t: number) => SlotState,
): Ask[] {
  const out: Ask[] = []
  for (const mini of minis) {
    const r = parse(mini) as {
      ok: boolean
      model?: { steps: number; bars?: number; leafSource?: unknown }
    }
    if (!r.ok || !r.model) continue
    const { steps, bars = 1 } = r.model
    for (const target of RESOLUTION_PRESETS) {
      out.push({
        mini,
        steps,
        bars,
        leaf: r.model.leafSource != null,
        target,
        state: slot(r.model as never, target),
        refine: target > steps,
        multiple: target > steps && target % steps === 0,
      })
    }
  }
  return out
}

function report(all: Ask[], label: string): void {
  const leaf = all.filter((a) => a.leaf)
  const elem = all.filter((a) => !a.leaf)
  const units = (as: Ask[]): number => new Set(as.map((a) => a.mini)).size

  console.log(`\n════════ ${label} ════════`)
  console.log(`units ${units(all)}  (leaf ${units(leaf)} / element ${units(elem)})`)

  /* ── (1) the leaf question ── */
  const byState = (as: Ask[]): string =>
    (['active', 'lossless', 'quantize', 'disabled'] as SlotState[])
      .map((s) => `${s} ${as.filter((a) => a.state === s).length}`)
      .join('  ')
  console.log(`LEAF    asks ${leaf.length}  ${byState(leaf)}`)
  console.log(`ELEMENT asks ${elem.length}  ${byState(elem)}`)

  /* ── (2) the denominator: four candidate definitions, ELEMENT units ── */
  const A = elem.filter((a) => a.state === 'lossless')
  const B = elem.filter((a) => a.state === 'lossless' && a.refine)
  const C = elem.filter((a) => a.multiple)
  const D = elem.filter((a) => a.state === 'lossless' && a.multiple)
  // the same four, but over ALL units (leaf contributes 0 lossless, so only C moves)
  const Call = all.filter((a) => a.multiple)

  console.log(`\ncandidate denominators (ELEMENT units):`)
  console.log(`  A  lossless, any direction          ${A.length}`)
  console.log(`  B  lossless AND refine              ${B.length}`)
  console.log(`  C  free zone (finer + int multiple) ${C.length}`)
  console.log(`  D  lossless AND free zone           ${D.length}`)
  console.log(`  C over ALL units (incl. leaf)       ${Call.length}`)

  /* where the two headline definitions disagree — enumerated, not excused ([[P411]]) */
  const inBnotC = B.filter((a) => !a.multiple)
  const inCnotB = C.filter((a) => a.state !== 'lossless')
  console.log(`\nB \\ C  (lossless refine, NOT an integer multiple): ${inBnotC.length}`)
  for (const a of inBnotC.slice(0, 12)) {
    console.log(`    steps ${a.steps} bars ${a.bars} → ${a.target}   ${JSON.stringify(a.mini).slice(0, 70)}`)
  }
  console.log(`C \\ B  (free zone, NOT offered as lossless): ${inCnotB.length}`)
  const cnb = new Map<string, number>()
  for (const a of inCnotB) {
    const k = `${a.state} bars=${a.bars > 1 ? '>1' : '1'}`
    cnb.set(k, (cnb.get(k) ?? 0) + 1)
  }
  console.log(`    by (state, bars): ${[...cnb.entries()].map(([k, n]) => `${k}:${n}`).join('  ')}`)
  for (const a of inCnotB.slice(0, 12)) {
    console.log(`    steps ${a.steps} bars ${a.bars} → ${a.target} [${a.state}]  ${JSON.stringify(a.mini).slice(0, 60)}`)
  }
}

describe('#1057 probe: leaf exposure + the done-when denominator', () => {
  it('grid', () => {
    report(asks(parseStepGrid as never, stepSlotState as never), 'STEP GRID')
  })

  it('roll', () => {
    report(asks(parsePianoRoll as never, rollSlotState as never), 'PIANO ROLL')
  })
})
