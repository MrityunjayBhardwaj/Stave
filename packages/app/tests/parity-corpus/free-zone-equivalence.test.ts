/**
 * free-zone-equivalence.test.ts — #1057's done-when, as an EQUIVALENCE rather than
 * an absence.
 *
 * The phase's claim is that refining the grid stopped rewriting the document. The
 * tempting gate for that is "the document did not change" — and it is worthless on
 * its own, because a control that does nothing at all satisfies it perfectly. This
 * codebase has already shipped exactly that failure once: after #1010 P4c the ÷2
 * button stayed clickable and inert on 24 of 24 units with the whole suite green,
 * because the control's state was PREDICTED instead of asked. So the issue states
 * two clauses and calls the second non-optional:
 *
 *   1. the document is byte-identical before and after, AND
 *   2. the rendered layout EQUALS what the old rewriting path would have produced.
 *
 * Clause 2 is what makes clause 1 mean something. Together they say: you see the
 * same grid you always saw, and your file was not touched to give it to you.
 *
 * ── HOW EACH CLAUSE IS ACTUALLY OBSERVED ──────────────────────────────────────
 * Clause 1 is asserted with its own control arm. "Nothing was written" is only
 * informative where there WAS a write to prevent, so every unit counted must be
 * shown to have been rewritten by the old path — `serialize(oldPath(model))` differs
 * from the source mini. A unit whose old path happened to be a no-op proves nothing
 * and is excluded by name rather than silently passing.
 *
 * Clause 2 compares LAYOUTS, not references: the model the panel now draws
 * (`parse(mini, scale)`) against the model the old path would have written
 * (`scaleTo(model, target)`), canonicalized so lane order and absent optionals
 * cannot make two identical grids compare unequal.
 *
 * ── THE THREE BUCKETS, AND WHY `gained` IS NOT SWEPT UNDER `equivalent` ────────
 * The old path can DECLINE (`ifGridSpellable`) where the view draws happily. Those
 * units have no old layout to be equivalent to, so folding them into the pass count
 * would be counting a missing comparison as a successful one. They are reported
 * separately as reach the free zone adds.
 *
 *   equivalent — old path wrote a layout, and the view draws that same layout
 *   gained     — old path declined; the view draws something it could not
 *   divergent  — old path wrote a layout and the view draws a DIFFERENT one  ← must be 0
 *
 * ⚠ POPULATION. Element units only, matching the denominator #1057 is scoped
 * against ([[PV261]]: the leaf path offers no resolution op at all, and the user's
 * call was to leave it disabled). Pinned on this tree at grid 2967 / roll 1241
 * free-zone offers — re-measured, not inherited ([[P416]]).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import {
  RESOLUTION_PRESETS,
  freeZoneScale,
  scaleStepGridTo,
  scalePianoRollTo,
  stepSlotState,
  rollSlotState,
} from '../../../editor/src/codeView/notation/resolution'
import { documentSteps } from '../../../editor/src/codeView/notation/viewResolution'
import type {
  PianoRollModel,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/**
 * The lossless-refine offers this phase is scoped against, RE-MEASURED on this tree
 * rather than inherited ([[P416]] — #1057's own body quotes ~3006, which reproduces on
 * no tree we have). Element units, `target > model.steps`, control state `lossless`.
 * `_1057-denominator-base.spec.ts` is the instrument that produces them.
 *
 * THE IDENTITY THIS GATE CLOSES, on both surfaces with no residue:
 *
 *     free-zone offers + refused-view − old-path-declined = denominator
 *
 * The subtraction is not a fudge. The denominator counts asks whose control state is
 * `lossless`, and an ask whose op DECLINES is not lossless — so it was never in that
 * count, while the free zone serves it anyway. On the roll that term is exactly 4,
 * which is the same 4-ask gap (free zone 1245 vs denominator 1241) that was derived
 * by hand when the denominator was pinned. Two independent routes to one number.
 */
// ⚠ 2973/1241 -> 3082/1361 at #1242 — the corpus widened 1535 -> 1633 units.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
// ⚠ 3099 -> 3094 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const GRID_DENOMINATOR = 3094
// ⚠ 1361 -> 1364 at #1312: three more asks reconstruct the denominator because the roll
// writer answers them instead of declining. The identity this arm checks — offers plus
// refusals minus old-path declines equals the denominator — is what moved with them, and
// it still closes exactly, which is the property rather than the number.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
const ROLL_DENOMINATOR = 1414

/**
 * A grid's LAYOUT as a comparable string: what the user sees, and nothing else.
 * Lanes are sorted so two identical grids that merely enumerate their voices in a
 * different order do not read as divergent.
 */
function gridLayout(m: StepGridModel): string {
  const lanes = m.lanes
    .map(
      (l) =>
        `${l.sound}#${l.part ?? 0}:` +
        l.cells
          .map((c) => (isCellOn(c) ? `${c.duration}` : '.'))
          .join(','),
    )
    .sort()
  return `steps=${m.steps} bars=${m.bars ?? 1} gains=${(m.gains ?? []).join(',')} | ${lanes.join(' | ')}`
}

function rollLayout(m: PianoRollModel): string {
  const notes = m.notes
    .map((n) => `${n.pitch}@${n.start}+${n.duration}g${n.gain ?? 1}`)
    .sort()
  return `steps=${m.steps} bars=${m.bars ?? 1} | ${notes.join(' | ')}`
}

interface Tally {
  offers: number
  equivalent: number
  gained: number
  divergent: number
  /** old path was already a no-op → clause 1 has nothing to prove here */
  noRewriteToPrevent: number
  /**
   * Arithmetically free, but the parser REFUSES to draw it (#1117's four
   * bar-expanding projections). Counted rather than skipped: `offers + refusedView`
   * must reconstruct the pinned denominator exactly, or the population this phase
   * serves has an unexplained hole in it.
   */
  refusedView: number
  examples: string[]
}

function sweep<M extends { steps: number; viewScale?: number; leafSource?: unknown }>(
  parse: (mini: string, scale?: number) => { ok: boolean; model?: M },
  serialize: (m: M) => string | null,
  scaleTo: (m: M, target: number) => M,
  slotState: (m: M, target: number, prove?: (s: number) => boolean) => string,
  layout: (m: M) => string,
): Tally {
  const t: Tally = {
    offers: 0,
    equivalent: 0,
    gained: 0,
    divergent: 0,
    noRewriteToPrevent: 0,
    refusedView: 0,
    examples: [],
  }
  for (const mini of minis) {
    const base = parse(mini)
    if (!base.ok || !base.model || base.model.leafSource != null) continue
    const model = base.model
    const docSteps = documentSteps(model)

    // the panel's own prover: ask the real parser, never predict it
    const prove = (scale: number): boolean => parse(mini, scale).ok

    for (const target of RESOLUTION_PRESETS) {
      const scale = freeZoneScale(docSteps, target)
      if (scale === null) continue
      if (!prove(scale)) {
        // arithmetically free, but the parser will not draw it (#1117). NOT offered —
        // and named, so the gap against the denominator has an owner.
        if (target !== model.steps) t.refusedView++
        continue
      }
      // the offer must actually BE the free zone, from the same authority the UI uses
      expect(
        slotState(model, target, prove),
        `${JSON.stringify(mini)} @ ${target}: expected the free zone`,
      ).toBe(target === model.steps ? 'active' : 'view')
      if (target === model.steps) continue
      t.offers++

      const drawn = parse(mini, scale)
      expect(drawn.ok && drawn.model, `${mini} must draw at ×${scale}`).toBeTruthy()
      if (!drawn.model) continue

      // CLAUSE 2 — against what the OLD path would have written
      const rewritten = scaleTo(model, target)
      if (rewritten === model) {
        // the old path declined; there is no layout to be equivalent to
        t.gained++
        continue
      }
      // CLAUSE 1's control arm: prove there really was a rewrite to prevent
      const oldMini = serialize(rewritten)
      if (oldMini === null || oldMini === mini) {
        t.noRewriteToPrevent++
        continue
      }
      if (layout(drawn.model) === layout(rewritten)) {
        t.equivalent++
      } else {
        t.divergent++
        if (t.examples.length < 8) {
          t.examples.push(
            `${JSON.stringify(mini)} @${target} (×${scale})\n` +
              `      view: ${layout(drawn.model)}\n` +
              `      old : ${layout(rewritten)}`,
          )
        }
      }
    }
  }
  return t
}

function report(label: string, t: Tally, denominator: number): void {
  console.log(
    `\n════ ${label} ════\n` +
      `  free-zone offers        ${t.offers}\n` +
      `    equivalent to old     ${t.equivalent}\n` +
      `    gained (old declined) ${t.gained}\n` +
      `    no rewrite to prevent ${t.noRewriteToPrevent}\n` +
      `    DIVERGENT             ${t.divergent}\n` +
      `  refused view (#1117)    ${t.refusedView}\n` +
      `  ── offers + refused − declined = ${t.offers + t.refusedView - t.gained}` +
      ` vs pinned denominator ${denominator}` +
      `  → residue ${denominator - (t.offers + t.refusedView - t.gained)}`,
  )
  if (t.examples.length) console.log('  examples:\n    ' + t.examples.join('\n    '))
}

describe('#1057 — a finer view renders what the rewrite used to, without the rewrite', () => {
  it('step grid', () => {
    const t = sweep(
      parseStepGrid as never,
      serializeStepGrid as never,
      scaleStepGridTo as never,
      stepSlotState as never,
      gridLayout as never,
    )
    report('STEP GRID', t, GRID_DENOMINATOR)
    // the population must be real — a silent zero here would make every other
    // assertion vacuously true
    expect(t.offers, 'free-zone offers must be a non-trivial population').toBeGreaterThan(2000)
    expect(t.equivalent, 'most offers must have an old layout to match').toBeGreaterThan(2000)
    expect(t.divergent, 'a view must never draw something the rewrite did not').toBe(0)
    // THE ARITHMETIC CLOSES: every offer the denominator counted is either served
    // here or refused by a named path. A residue would be a population this phase
    // silently dropped.
    expect(
      t.offers + t.refusedView - t.gained,
      'offers + refused − old-path-declined must reconstruct the denominator',
    ).toBe(
      GRID_DENOMINATOR,
    )
  })

  it('piano roll', () => {
    const t = sweep(
      parsePianoRoll as never,
      serializePianoRoll as never,
      scalePianoRollTo as never,
      rollSlotState as never,
      rollLayout as never,
    )
    report('PIANO ROLL', t, ROLL_DENOMINATOR)
    expect(t.offers, 'free-zone offers must be a non-trivial population').toBeGreaterThan(900)
    expect(t.equivalent, 'most offers must have an old layout to match').toBeGreaterThan(900)
    expect(t.divergent, 'a view must never draw something the rewrite did not').toBe(0)
    expect(
      t.offers + t.refusedView - t.gained,
      'offers + refused − old-path-declined must reconstruct the denominator',
    ).toBe(
      ROLL_DENOMINATOR,
    )
  })

  it('THE REPORTED DEFECT no longer writes, and still draws the same grid', () => {
    const mini = 'bd ~ sn ~'
    const base = parseStepGrid(mini)
    expect(base.ok).toBe(true)
    if (!base.ok) return
    // What the old path writes TODAY. ⚠ This is NOT the string #1057 quotes: the
    // issue was filed before #1010 P4c taught the printer to preserve length, so the
    // rewrite now spells the held columns `_` instead of leaving them silent. The
    // defect is unchanged — a view preference still rewrites the file — and only its
    // spelling moved. Asserted as observed rather than as quoted, because a gate that
    // agrees with a stale issue body is agreeing with the wrong thing.
    const rewritten = scaleStepGridTo(base.model, 16)
    expect(serializeStepGrid(rewritten)).toBe('bd _ _ _ ~ ~ ~ ~ sn _ _ _ ~ ~ ~ ~')
    expect(serializeStepGrid(rewritten)).not.toBe(mini) // there IS a rewrite to prevent
    // what the panel does now: a view, no write, and the SAME layout
    const prove = (s: number): boolean => parseStepGrid(mini, s).ok
    expect(stepSlotState(base.model, 16, prove)).toBe('view')
    const drawn = parseStepGrid(mini, 4)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    expect(gridLayout(drawn.model)).toBe(gridLayout(rewritten))
  })
})
