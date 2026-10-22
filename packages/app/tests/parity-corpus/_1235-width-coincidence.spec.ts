/**
 * _1235-width-coincidence.spec.ts — INSTRUMENT. Is [[PV319]]'s ÷2 coincidence reachable
 * on the overlay as it ships today, or only under #1233's core attachment?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1235-width-coincidence.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE MECHANISM. `anchorsDescribe` admits an overlay when the anchored width equals the
 * model's — two numbers derived by different code from different premises. A restructure
 * that lands the model's width ON the overlay's therefore passes a guard that was meant
 * to say "this is still the model those spans were read from". The write then puts the
 * PRE-restructure bytes back and the user's ÷2 silently does nothing.
 *
 * A HIT is: the resolution op applies (the model's width changes), the leaf writer
 * answers, and the bytes it returns are the ORIGINAL document. Asked of the real ops
 * (`scaleStepGrid` / `scalePianoRoll`, which are what the ÷2 control calls) and the real
 * writers, over three carriers, so the answer separates "ships today" from "#1233 only".
 *
 * ⚠ THE SIMULATED ARM MODELS THE ATTACHMENT `withSurgery` PERFORMS, which RE-STAMPS the
 * attached width for the model the spans are landing on. Attaching naively — spreading
 * the leaf projection's source through unchanged — leaves the field describing the LEAF
 * model and reintroduces exactly the defect, which is why both arms are reported: the
 * gap between them is the measure of how load-bearing the re-stamp is, and it is the one
 * thing #1233 must not get wrong when it attaches on the core path.
 *
 * ⚠⚠ SINCE #1233 SHIPPED, THE `simulated` AND `naive` ARMS ARE VACUOUS AND THE `shipping`
 * ARM IS THE MEASUREMENT. Every model now carries an overlay, so the `else if (spans)`
 * branch those two arms live in is never reached and they print `0 of 0` — which reads
 * like "nothing swallowed" and means "nothing asked". Read the DENOMINATOR, not the count.
 *
 * ⚠⚠ AND THE SIMULATION UNDER-REPORTED WHILE IT WAS LIVE. It attached spans fetched from
 * `projectStepGridDerived`, which carry the DERIVED path's `attachedSteps` — a stamp that
 * usually disagrees with the core model they were being pasted onto, so the simulated
 * overlay was refused for a reason the real attachment never has. It read 2 grid + 2 roll;
 * breaking the re-stamp on the BUILT change reads 13 + 2. The lesson outlives this file: a
 * simulation that does not reproduce the field the guard reads is not measuring the guard,
 * and the number it produces is confidently wrong rather than obviously missing.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parsePianoRoll,
  projectStepGridDerived,
  projectPianoRollDerived,
} from '../../../editor/src/codeView/notation/parse'
import type {
  LeafSource,
  RollLeafSource,
  PianoRollModel,
  StepGridModel,
  SurgicalOverlay,
} from '../../../editor/src/codeView/notation/model'
import { scaleStepGrid, scalePianoRoll } from '../../../editor/src/codeView/notation/resolution'
import {
  serializeStepGridWithExtent,
  serializePianoRollWithExtent,
} from '../../../editor/src/codeView/notation/serialize'

/**
 * Wrap resolved spans as an OVERLAY the writer will accept (#1233 made the field lazy).
 * The width is re-stamped for the model the spans land on, which is what `withSurgery`
 * does — an instrument that attached naively would measure a change nobody proposed.
 */
const asOverlay = <S>(spans: S, attachedSteps: number): SurgicalOverlay<S> => ({
  attachedSteps,
  spans: () => spans,
})


const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

const gridSpans = (mini: string): LeafSource | undefined => {
  const d = projectStepGridDerived(mini, { ok: false, reason: 'probe' })
  if (!d.ok) return undefined
  return (d.model as StepGridModel).surgical?.spans() ?? (d.model as StepGridModel).leafSource
}
const rollSpans = (mini: string): RollLeafSource | undefined => {
  const d = projectPianoRollDerived(mini, { ok: false, reason: 'probe' })
  if (!d.ok) return undefined
  return (d.model as PianoRollModel).surgical?.spans() ?? (d.model as PianoRollModel).leafSource
}

describe('#1235 instrument — is the width coincidence reachable?', () => {
  it('grid: ÷2 and ×2 on every carrier, looking for a restructure the writer swallows', () => {
    const tally = { shipping: 0, simulated: 0, naive: 0, shippingAsks: 0, simulatedAsks: 0, naiveAsks: 0 }
    const rows: string[] = []
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      const spans = gridSpans(mini)
      const arms: Array<['shipping' | 'simulated' | 'naive', StepGridModel]> = []
      if (m.leafSource || m.surgical) arms.push(['shipping', m])
      else if (spans) {
        arms.push(['simulated', {
          ...m,
          surgical: asOverlay({ ...spans, attachedSteps: m.steps }, m.steps),
        } as StepGridModel])
        arms.push(['naive', { ...m, surgical: asOverlay(spans, spans.attachedSteps) } as StepGridModel])
      }
      for (const [arm, model] of arms)
        for (const dir of ['halve', 'double'] as const) {
          const next = scaleStepGrid(model, dir)
          if (next === model || next.steps === model.steps) continue
          tally[`${arm}Asks` as 'shippingAsks']++
          const got = serializeStepGridWithExtent(next)
          if (got.extent.path === 'leaf' && got.mini === mini) {
            tally[arm]++
            if (rows.length < 15)
              rows.push(
                `  ${arm}  ${dir}  ${JSON.stringify(mini).slice(0, 80)}\n      steps ${model.steps} -> ${next.steps}, anchored width ${(model.leafSource ?? model.surgical!.spans()!).cols.length}, wrote the source back`,
              )
          }
        }
    }
    console.log(`\n===== #1235 · GRID width coincidence =====`)
    console.log(`  shipping carriers: ${tally.shipping} swallowed of ${tally.shippingAsks} restructures`)
    console.log(`  #1233, re-stamped:  ${tally.simulated} swallowed of ${tally.simulatedAsks} restructures`)
    console.log(`  #1233, attached NAIVELY: ${tally.naive} swallowed of ${tally.naiveAsks}  <-- what the re-stamp is worth`)
    rows.forEach((r) => console.log(r))
  })

  it('roll: the same, on the surface [[PV319]] was observed on', () => {
    const tally = { shipping: 0, simulated: 0, naive: 0, shippingAsks: 0, simulatedAsks: 0, naiveAsks: 0 }
    const rows: string[] = []
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      const spans = rollSpans(mini)
      const arms: Array<['shipping' | 'simulated' | 'naive', PianoRollModel]> = []
      if (m.leafSource || m.surgical) arms.push(['shipping', m])
      else if (spans) {
        arms.push(['simulated', {
          ...m,
          surgical: asOverlay({ ...spans, attachedSteps: m.steps }, m.steps),
        } as PianoRollModel])
        arms.push(['naive', { ...m, surgical: asOverlay(spans, spans.attachedSteps) } as PianoRollModel])
      }
      for (const [arm, model] of arms)
        for (const dir of ['halve', 'double'] as const) {
          const next = scalePianoRoll(model, dir)
          if (next === model || next.steps === model.steps) continue
          tally[`${arm}Asks` as 'shippingAsks']++
          const got = serializePianoRollWithExtent(next)
          if (got.extent.path === 'leaf' && got.mini === mini) {
            tally[arm]++
            if (rows.length < 15)
              rows.push(
                `  ${arm}  ${dir}  ${JSON.stringify(mini).slice(0, 80)}\n      steps ${model.steps} -> ${next.steps}, anchored width ${(model.leafSource ?? model.surgical!.spans()!).steps}, wrote the source back`,
              )
          }
        }
    }
    console.log(`\n===== #1235 · ROLL width coincidence =====`)
    console.log(`  shipping carriers: ${tally.shipping} swallowed of ${tally.shippingAsks} restructures`)
    console.log(`  #1233, re-stamped:  ${tally.simulated} swallowed of ${tally.simulatedAsks} restructures`)
    console.log(`  #1233, attached NAIVELY: ${tally.naive} swallowed of ${tally.naiveAsks}  <-- what the re-stamp is worth`)
    rows.forEach((r) => console.log(r))
  })
})
