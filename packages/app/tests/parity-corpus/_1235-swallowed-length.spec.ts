/**
 * _1235-swallowed-length.spec.ts — INSTRUMENT, not a gate. How many length edits the
 * leaf writer reports as a successful write while returning the source bytes unchanged.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1235-swallowed-length.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * WHAT IT ASKS. `spliceByLeaf` decides what changed by comparing TOKENS, and `LeafAnchor`
 * is `{ atom, span }` — no length. So a note the user lengthened or shortened is invisible
 * to it: it finds no difference, writes the source back, and returns it as a write. This
 * counts that population directly, on three carriers, because the answer differs per
 * carrier and "is it live today?" is the question that decides the fix's urgency:
 *
 *   leafSource   the leaf projection OWNS the view (terminal, no fallback)
 *   surgical     P4d's overlay on the DERIVED element path — SHIPPING TODAY
 *   simulated    the same overlay on the CORE element path — what #1233 would add
 *
 * ⚠ IT ASKS THE MECHANISM. The resize comes from `resizeCell`/`resizeNote` (the panel's
 * own ops) run against a model with the overlay STRIPPED, so the op's own perceptibility
 * guard cannot hide the case ([[#1053]]: `resizeCell` returns its input when the document
 * would not move, which is exactly what a swallow looks like from outside). The verdict
 * comes from `serializeStepGridWithExtent` / `serializePianoRollWithExtent`, the writers
 * themselves. Only the ATTACHMENT is modelled here, and that is the candidate change.
 *
 * A SWALLOW is: the control arm (no overlay) writes DIFFERENT bytes, and the treatment arm
 * answers `path: 'leaf'` with bytes IDENTICAL to the source. Anything else — a refusal, a
 * genuine agreement, a decline — is not this defect.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
  projectStepGridDerived,
  projectPianoRollDerived,
} from '../../../editor/src/codeView/notation/parse'
import type {
  LeafSource,
  RollLeafSource,
  StepGridModel,
  PianoRollModel,
  SurgicalOverlay,
} from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { resizeCell, resizeNote } from '../../../editor/src/codeView/notation/place'
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

/** the grid spans the leaf projection reads for this mini, however the derived path carries them */
function gridSpans(mini: string): LeafSource | undefined {
  const d = projectStepGridDerived(mini, { ok: false, reason: 'probe' })
  if (!d.ok) return undefined
  const m = d.model as StepGridModel
  return m.surgical?.spans() ?? m.leafSource
}

function rollSpans(mini: string): RollLeafSource | undefined {
  const d = projectPianoRollDerived(mini, { ok: false, reason: 'probe' })
  if (!d.ok) return undefined
  const m = d.model as PianoRollModel
  return m.surgical?.spans() ?? m.leafSource
}

interface Tally {
  asked: number
  swallowed: number
  refusedToLeaf: number
  agreed: number
  examples: string[]
}
const blank = (): Tally => ({ asked: 0, swallowed: 0, refusedToLeaf: 0, agreed: 0, examples: [] })

function record(t: Tally, mini: string, control: string | null, out: string | null, path_: string) {
  t.asked++
  if (control === null || control === mini) {
    t.asked-- // the control arm did not move the document either — nothing to swallow
    return
  }
  if (path_ !== 'leaf') {
    t.refusedToLeaf++
    return
  }
  if (out === mini) {
    t.swallowed++
    if (t.examples.length < 12) t.examples.push(`${JSON.stringify(mini)}  →  (unchanged)`)
  } else if (out === control) t.agreed++
  else t.agreed++ // wrote something, and something is not the defect this probe counts
}

describe('#1235 instrument — length edits the leaf writer returns unchanged', () => {
  it('counts the swallowed grid resizes, per carrier', () => {
    const own = blank() // the model as it ships (leafSource OR P4d's derived surgical)
    const shipping = blank()
    const simulated = blank() // #1233: the same overlay on core-opened units
    let units = 0
    let coreUnits = 0

    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      units++
      const core = parseStepGridCore(mini).ok
      if (core) coreUnits++
      const carried = m.leafSource ?? m.surgical
      const spans = gridSpans(mini)

      for (let col = 0; col < m.steps; col++) {
        for (let lane = 0; lane < m.lanes.length; lane++) {
          const cell = m.lanes[lane].cells[col]
          if (!isCellOn(cell)) continue
          // the control arm: the same op on a model carrying NO leaf spans at all
          const bare = { ...m }
          delete bare.leafSource
          delete bare.surgical
          const grown = resizeCell(bare, lane, col, cell.duration + 1)
          const shrunk = resizeCell(bare, lane, col, Math.max(1, cell.duration - 1))
          for (const next of [grown, shrunk]) {
            if (next === bare) continue
            const control = serializeStepGridWithExtent(next).mini
            if (carried) {
              const t = m.leafSource
                ? { ...next, leafSource: m.leafSource }
                : { ...next, surgical: m.surgical }
              const got = serializeStepGridWithExtent(t as StepGridModel)
              record(m.leafSource ? own : shipping, mini, control, got.mini, got.extent.path)
            }
            if (core && spans) {
              const got = serializeStepGridWithExtent({
                ...next,
                surgical: asOverlay(spans, next.steps),
              } as StepGridModel)
              record(simulated, mini, control, got.mini, got.extent.path)
            }
          }
        }
      }
    }

    const show = (label: string, t: Tally) => {
      console.log(
        `  ${label.padEnd(34)} asked ${String(t.asked).padStart(5)}   SWALLOWED ${String(t.swallowed).padStart(5)}   refused-to-other ${String(t.refusedToLeaf).padStart(5)}   wrote ${String(t.agreed).padStart(5)}`,
      )
      t.examples.forEach((e) => console.log(`        ✗ ${e}`))
    }
    console.log(`\n===== #1235 · GRID length edits (${units} grid units, ${coreUnits} core-opened) =====`)
    show('leafSource (projection owns)', own)
    show('surgical — derived, SHIPPING', shipping)
    show('surgical — core, #1233 would add', simulated)
    expect(units, 'the grid population moved').toBe(981)
  })

  it('counts the swallowed roll resizes, per carrier', () => {
    const own = blank()
    const shipping = blank()
    const simulated = blank()
    let units = 0
    let coreUnits = 0

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      units++
      const core = parsePianoRollCore(mini).ok
      if (core) coreUnits++
      const carried = m.leafSource ?? m.surgical
      const spans = rollSpans(mini)

      // ⚠ THE INSTRUMENT NEEDS THIS AND `resizeCell` DOES NOT. `resizeCell` returns its
      // INPUT when the length or the document would not move; `resizeNote` has no such
      // guard, so a drag clamped back onto its own length returns a fresh object whose
      // notes are identical. Without this the control arm's re-emit (which normalises
      // spelling) reads as "the document moved" and the leaf writer's correct unchanged
      // bytes read as a swallow — 516 phantom swallows in this probe's first run.
      const key = (mm: PianoRollModel): string =>
        mm.notes
          .map((x) => `${x.start}:${x.pitch}:${x.duration}`)
          .sort()
          .join('|')
      const before = key(m)
      for (const n of m.notes) {
        const bare = { ...m }
        delete bare.leafSource
        delete bare.surgical
        const grown = resizeNote(bare, n.start, n.pitch, n.duration + 1)
        const shrunk = resizeNote(bare, n.start, n.pitch, Math.max(1, n.duration - 1))
        for (const next of [grown, shrunk]) {
          if (next === bare || key(next) === before) continue
          const control = serializePianoRollWithExtent(next).mini
          if (carried) {
            const t = m.leafSource
              ? { ...next, leafSource: m.leafSource }
              : { ...next, surgical: m.surgical }
            const got = serializePianoRollWithExtent(t as PianoRollModel)
            record(m.leafSource ? own : shipping, mini, control, got.mini, got.extent.path)
          }
          if (core && spans) {
            const got = serializePianoRollWithExtent({
              ...next,
              surgical: asOverlay(spans, next.steps),
            } as PianoRollModel)
            record(simulated, mini, control, got.mini, got.extent.path)
          }
        }
      }
    }

    const show = (label: string, t: Tally) => {
      console.log(
        `  ${label.padEnd(34)} asked ${String(t.asked).padStart(5)}   SWALLOWED ${String(t.swallowed).padStart(5)}   refused-to-other ${String(t.refusedToLeaf).padStart(5)}   wrote ${String(t.agreed).padStart(5)}`,
      )
      t.examples.forEach((e) => console.log(`        ✗ ${e}`))
    }
    console.log(`\n===== #1235 · ROLL length edits (${units} roll units, ${coreUnits} core-opened) =====`)
    show('leafSource (projection owns)', own)
    show('surgical — derived + roll #1232', shipping)
    show('surgical — core, #1233 would add', simulated)
  })

  it('prices the swallow in HANDLES — what #1053 offers, with and without the spans', () => {
    // The user-visible half. `resizeCell` returns its input when the document would not
    // move, so a swallowed length is not corruption — it is a length handle that silently
    // stops being drawn. This counts the handle exactly as `op-admissibility` does (the
    // same two targets, the same `!== m` test), on three trees that differ ONLY in which
    // spans the model carries. A paired A/B on one tree, so neither arm is quoted from
    // elsewhere and the difference is the spans and nothing else.
    const count = (attach: (m: StepGridModel, mini: string) => StepGridModel): number => {
      let offered = 0
      for (const mini of minis) {
        const r = parseStepGrid(mini)
        if (!r.ok) continue
        const m = attach(r.model as StepGridModel, mini)
        for (let li = 0; li < m.lanes.length; li++)
          for (let si = 0; si < m.lanes[li].cells.length; si++) {
            const c = m.lanes[li].cells[si]
            if (!isCellOn(c)) continue
            const d = Math.round(c.duration)
            if (
              resizeCell(m, li, si, d + 1) !== m ||
              resizeCell(m, li, si, d - 1) !== m
            )
              offered++
          }
      }
      return offered
    }

    const shipping = count((m) => m)
    const stripped = count((m) => {
      const b = { ...m }
      delete b.leafSource
      delete b.surgical
      return b
    })
    const withCore = count((m, mini) => {
      if (m.leafSource || m.surgical) return m
      const spans = gridSpans(mini)
      return spans ? ({ ...m, surgical: asOverlay(spans, m.steps) } as StepGridModel) : m
    })

    console.log(`\n===== #1235 · #1053 LENGTH HANDLES OFFERED, one tree, three attachments =====`)
    console.log(`  as it ships (leafSource + P4d's derived overlay)   ${shipping}`)
    console.log(`  every leaf span stripped                           ${stripped}`)
    console.log(`  ...plus #1233's core overlay                       ${withCore}`)
    console.log(`  cost of the spans today: ${stripped - shipping} handles`)
    console.log(`  cost #1233 would add:    ${shipping - withCore} handles`)
  })
})
