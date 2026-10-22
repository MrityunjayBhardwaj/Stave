/**
 * _1059-multiplier-vocabulary.spec.ts — WHAT SHOULD THE SLOTS PICKER OFFER?
 *
 * #1059 pre-registers one measurement and says to take it BEFORE designing the
 * control states:
 *
 *   > Measure how many of the 334 grid offers currently classed `quantize` convert
 *   > to free-zone offers if the picker offers MULTIPLIERS (×1, ×2, ×4) against the
 *   > derived resolution instead of absolute counts. Then decide the vocabulary on
 *   > that number.
 *
 * `RESOLUTION_PRESETS = [4, 8, 16, 32, 64]` are absolute counts — the right
 * vocabulary for a document op ("make this pattern 16 elements"), the wrong one for
 * a view derived from the pattern's own resolution. A 3-element pattern's clean
 * finer views are 6, 12, 24 and none of them is a preset, so every preset it is
 * offered is a rewrite.
 *
 * ── WHY THIS IS A VOCABULARY QUESTION AND NOT A ZONE QUESTION ─────────────────
 * `freeZoneScale` is ALREADY general: its only shape test is `target % docSteps`,
 * so it admits any whole multiple and would hand back ×2 on a 3-element pattern
 * today if anything ever asked it for 6. Nothing does — `RESOLUTION_PRESETS` is the
 * only thing that names targets. So the free/writes split needs no change at all
 * and this measures the PICKER, which is the one layer that still speaks absolutes.
 *
 * ── EVERY STATE COMES FROM THE CONTROL ITSELF ─────────────────────────────────
 * `stepSlotState(model, target, canDrawView)` with the REAL prover, which is the
 * same call `SequencerGrid.tsx:229` renders the button from — never a re-derivation
 * of what it would have said. A gate that reconstructs a module's own decision from
 * its inputs is wrong in the permissive direction and its output cannot show it
 * ([[P433]] — this arc's most recent instance cost 208 mislabelled asks).
 *
 * ⚠ NOT A GATE. An instrument: it reports numbers for a product call. Its `expect`s
 * pin only what must not silently move under it.
 *
 * ⚠ THE SUITE DOES NOT RUN THIS FILE, and that is deliberate — `vitest.config.ts`
 * includes `*.test.ts` only, so the `_`-prefixed instruments stay out of the gate
 * run. To take the measurement again, point vitest at it with an include override:
 *
 *     pnpm --filter @stave/app exec vitest run \
 *       --config <(echo "export default {test:{include:['tests/parity-corpus/_1059-*.spec.ts'],environment:'jsdom'}}") \
 *       --minWorkers=1 --maxWorkers=3
 *
 * or copy `vitest.config.ts`, swap its `include`, and delete the copy afterwards.
 * ⚠ `--maxWorkers` WITHOUT `--minWorkers` aborts with a RangeError and collects
 * nothing, and `pnpm --filter X test --minWorkers=1` passes the flag to PNPM rather
 * than vitest — exit 1, zero tests. Grep the POSITIVE total; exit 0 proves nothing.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  RESOLUTION_PRESETS,
  freeZoneScale,
  stepSlotState,
  rollSlotState,
  collapseStepGridToDocument,
  type SlotState,
} from '../../../editor/src/codeView/notation/resolution'
import {
  documentSteps,
  MAX_VIEW_STEPS,
} from '../../../editor/src/codeView/notation/viewResolution'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/**
 * The multipliers a view picker could offer. POWERS OF TWO, and that bound is not a
 * stylistic choice — `descaleSource` (resolution.ts:510) states that every `k` it
 * can see today is a power of two "a property of the offers rather than of this
 * code", and that a non-power-of-two view would decline the collapse and write the
 * finer spelling instead. So ×3 is not a free offer on the shipped tree; it is
 * untested surface. Measured separately below rather than folded in.
 */
const MULTIPLIERS = [2, 4, 8] as const
const UNTESTED_MULTIPLIER = 3

/** the prover the panel uses: ask the parser, never predict it (`useViewProver`) */
const proverFor = (mini: string) => (scale: number) => parseStepGrid(mini, scale).ok

interface Offer {
  mini: string
  docSteps: number
  target: number
  state: SlotState
  /** a refine is a target ABOVE the document's own count; #1052 scopes to these */
  refine: boolean
}

function sweep(): { presets: Offer[]; multiples: Offer[]; units: number } {
  const presets: Offer[] = []
  const multiples: Offer[] = []
  let units = 0
  for (const mini of minis) {
    const r = parseStepGrid(mini)
    if (!r.ok || !r.model) continue
    const model = r.model
    const docSteps = documentSteps(model)
    const canDrawView = proverFor(mini)
    units++
    for (const target of RESOLUTION_PRESETS) {
      presets.push({
        mini,
        docSteps,
        target,
        state: stepSlotState(model, target, canDrawView),
        refine: target > docSteps,
      })
    }
    for (const k of MULTIPLIERS) {
      const target = docSteps * k
      if (target > MAX_VIEW_STEPS) continue
      multiples.push({
        mini,
        docSteps,
        target,
        state: stepSlotState(model, target, canDrawView),
        refine: true,
      })
    }
  }
  return { presets, multiples, units }
}

/**
 * THE SAME SWEEP ON THE ROLL, and it is not a formality — the two surfaces differ on
 * the one axis the vocabulary question turns on. #1052 measured the grid offering
 * coarsening ZERO times and the roll offering it 329 times, and scoped coarsening
 * OUT ("refining is a view change, coarsening edits your document"). So a picker
 * that spoke only multipliers would silently delete a live roll affordance, and
 * #1060 names that outcome a defect rather than a pleasant surprise. Measuring the
 * grid alone would have recommended a vocabulary for half the surface.
 */
function sweepRoll(): { presets: Offer[]; multiples: Offer[]; units: number } {
  const presets: Offer[] = []
  const multiples: Offer[] = []
  let units = 0
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok || !r.model) continue
    const model = r.model
    const docSteps = documentSteps(model)
    const canDrawView = (scale: number) => parsePianoRoll(mini, scale).ok
    units++
    for (const target of RESOLUTION_PRESETS) {
      presets.push({
        mini,
        docSteps,
        target,
        state: rollSlotState(model, target, canDrawView),
        refine: target > docSteps,
      })
    }
    for (const k of MULTIPLIERS) {
      const target = docSteps * k
      if (target > MAX_VIEW_STEPS) continue
      multiples.push({
        mini,
        docSteps,
        target,
        state: rollSlotState(model, target, canDrawView),
        refine: true,
      })
    }
  }
  return { presets, multiples, units }
}

const SWEPT = sweep()
const ROLL = sweepRoll()

const tally = (offers: Offer[]): Record<string, number> => {
  const t: Record<string, number> = {}
  for (const o of offers) t[o.state] = (t[o.state] ?? 0) + 1
  return t
}
const unitsOf = (offers: Offer[]): Set<string> => new Set(offers.map((o) => o.mini))

describe('#1059 — the picker vocabulary, measured before the states are designed', () => {
  it('CENSUS: what the ABSOLUTE presets offer today', () => {
    const refines = SWEPT.presets.filter((o) => o.refine)
    const coarsens = SWEPT.presets.filter((o) => !o.refine && o.state !== 'active')
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── ABSOLUTE PRESETS [4, 8, 16, 32, 64] ───────────────────────',
        `  grid units                       ${SWEPT.units}`,
        `  offers                           ${SWEPT.presets.length}`,
        `  refine offers                    ${refines.length}   ${JSON.stringify(tally(refines))}`,
        `  coarsen offers                   ${coarsens.length}   ${JSON.stringify(tally(coarsens))}`,
        '',
        '  THE RESIDUAL #1059 IS ABOUT — a refine that still writes your file:',
        `    quantize                       ${refines.filter((o) => o.state === 'quantize').length}` +
          `  over ${unitsOf(refines.filter((o) => o.state === 'quantize')).size} units`,
        `    lossless                       ${refines.filter((o) => o.state === 'lossless').length}` +
          `  over ${unitsOf(refines.filter((o) => o.state === 'lossless')).size} units`,
        `    disabled                       ${refines.filter((o) => o.state === 'disabled').length}`,
        `    view (free)                    ${refines.filter((o) => o.state === 'view').length}`,
      ].join('\n'),
    )
    expect(SWEPT.units, 'the grid population must be non-trivial').toBeGreaterThan(500)
  })

  it('CENSUS: what MULTIPLIERS against the derived resolution would offer', () => {
    const byK = MULTIPLIERS.map((k) => {
      const at = SWEPT.multiples.filter((o) => o.target === o.docSteps * k)
      return `    ×${k}                             ${at.length}   ${JSON.stringify(tally(at))}`
    })
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── MULTIPLIERS ×2 / ×4 / ×8 against documentSteps ────────────',
        `  offers                           ${SWEPT.multiples.length}`,
        `  overall                          ${JSON.stringify(tally(SWEPT.multiples))}`,
        ...byK,
      ].join('\n'),
    )
    expect(SWEPT.multiples.length, 'multiplier offers must be a real population').toBeGreaterThan(
      500,
    )
  })

  it('THE CONVERSION — how much of the writing residual a multiplier picker takes off the write path', () => {
    // The two vocabularies do NOT put offers in bijection: a 3-element unit is
    // offered 4/8/16/32/64 by one and 6/12/24 by the other. So "converts" is only
    // honest per UNIT — does this pattern gain a free finer view it does not have
    // today? — and the offer counts are reported beside it as context, never as a
    // ratio between two different denominators.
    const writingRefine = SWEPT.presets.filter(
      (o) => o.refine && (o.state === 'quantize' || o.state === 'lossless'),
    )
    const writingUnits = unitsOf(writingRefine)

    const freeUnderMultiples = unitsOf(SWEPT.multiples.filter((o) => o.state === 'view'))
    const freeUnderPresets = unitsOf(SWEPT.presets.filter((o) => o.refine && o.state === 'view'))

    // units whose only refine today is a WRITE, and which a multiplier picker
    // would serve for free
    const converted = [...writingUnits].filter(
      (m) => freeUnderMultiples.has(m) && !freeUnderPresets.has(m),
    )
    // units that keep a writing-only refine even under multipliers
    const stranded = [...writingUnits].filter((m) => !freeUnderMultiples.has(m))

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── THE CONVERSION ───────────────────────────────────────────',
        `  units with a WRITING refine today      ${writingUnits.size}`,
        `    …gaining a FREE refine under ×k      ${converted.length}`,
        `    …already free at some preset         ${[...writingUnits].filter((m) => freeUnderPresets.has(m)).length}`,
        `    …still writing-only under ×k         ${stranded.length}`,
        '',
        `  units with ANY free refine — presets   ${freeUnderPresets.size}`,
        `  units with ANY free refine — ×k        ${freeUnderMultiples.size}`,
        `  units ×k serves that presets cannot    ${[...freeUnderMultiples].filter((m) => !freeUnderPresets.has(m)).length}`,
        '',
        '  stranded examples:',
        ...stranded.slice(0, 8).map((m) => `    ${JSON.stringify(m)}`),
      ].join('\n'),
    )
    expect(writingUnits.size, 'there must be a residual to convert').toBeGreaterThan(0)
  })

  it('THE ROLL — where coarsening is live, and a multiplier-only picker would delete it', () => {
    const refines = ROLL.presets.filter((o) => o.refine)
    const coarsens = ROLL.presets.filter((o) => !o.refine && o.state !== 'active')
    const coarsenLive = coarsens.filter((o) => o.state !== 'disabled')
    const writingRefine = ROLL.presets.filter(
      (o) => o.refine && (o.state === 'quantize' || o.state === 'lossless'),
    )
    const writingUnits = unitsOf(writingRefine)
    const freeUnderMultiples = unitsOf(ROLL.multiples.filter((o) => o.state === 'view'))
    const freeUnderPresets = unitsOf(ROLL.presets.filter((o) => o.refine && o.state === 'view'))

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── PIANO ROLL ───────────────────────────────────────────────',
        `  roll units                             ${ROLL.units}`,
        `  refine offers                          ${refines.length}   ${JSON.stringify(tally(refines))}`,
        `  coarsen offers                         ${coarsens.length}   ${JSON.stringify(tally(coarsens))}`,
        `  coarsen offers STILL CLICKABLE         ${coarsenLive.length}   ${JSON.stringify(tally(coarsenLive))}`,
        '',
        `  units with a WRITING refine today      ${writingUnits.size}`,
        `    …gaining a FREE refine under ×k      ${[...writingUnits].filter((m) => freeUnderMultiples.has(m) && !freeUnderPresets.has(m)).length}`,
        `    …still writing-only under ×k         ${[...writingUnits].filter((m) => !freeUnderMultiples.has(m)).length}`,
        `  units with ANY free refine — presets   ${freeUnderPresets.size}`,
        `  units with ANY free refine — ×k        ${freeUnderMultiples.size}`,
        '',
        '  ⚠ THE COARSENING THE VOCABULARY MUST NOT DROP:',
        `    live coarsen offers                  ${coarsenLive.length} over ${unitsOf(coarsenLive).size} units`,
      ].join('\n'),
    )
    expect(ROLL.units, 'the roll population must be non-trivial').toBeGreaterThan(300)
  })

  it('THE WALK — ×2 and ÷2 as RELATIVE steps, measured from refined states too', () => {
    // The picker the user asked for steps rather than jumps: ×2 / ÷2, walk 64 → 4 → 16.
    // That cannot be measured from the unrefined model alone, because the interesting
    // half of the walk is the DESCENT THROUGH A REFINED VIEW — and `freeZoneScale`
    // already treats it as free, returning UNREFINED at the document's own count
    // (resolution.ts:396, "refining is reversible"). So the sweep starts from every
    // view scale a user can actually be standing on, not just scale 1.
    //
    // The line that matters for the zones: ÷2 ABOVE the document's own count is a
    // view change; ÷2 BELOW it is a document write. One boundary, both directions.
    const rows: string[] = []
    for (const [label, parse, slot] of [
      ['GRID', parseStepGrid, stepSlotState],
      ['ROLL', parsePianoRoll, rollSlotState],
    ] as const) {
      const up: Record<string, number> = {}
      const downFree: Record<string, number> = {}
      const downWrite: Record<string, number> = {}
      let standings = 0
      for (const mini of minis) {
        const base = (parse as (m: string, k?: number) => { ok: boolean; model?: never })(mini)
        if (!base.ok || !base.model) continue
        const docSteps = documentSteps(base.model)
        const canDrawView = (scale: number) =>
          (parse as (m: string, k?: number) => { ok: boolean })(mini, scale).ok
        for (const s of [1, 2, 4, 8] as const) {
          const drawn = (parse as (m: string, k?: number) => { ok: boolean; model?: never })(
            mini,
            s,
          )
          if (!drawn.ok || !drawn.model) continue
          standings++
          const here = docSteps * s
          const call = slot as (m: never, t: number, c: (k: number) => boolean) => SlotState
          if (here * 2 <= MAX_VIEW_STEPS) {
            const st = call(drawn.model, here * 2, canDrawView)
            up[st] = (up[st] ?? 0) + 1
          }
          if (here / 2 >= 1 && Number.isInteger(here / 2)) {
            const st = call(drawn.model, here / 2, canDrawView)
            const bucket = here / 2 >= docSteps ? downFree : downWrite
            bucket[st] = (bucket[st] ?? 0) + 1
          }
        }
      }
      rows.push(
        `  ${label}  standings (unit × view scale)   ${standings}`,
        `  ${label}  ×2 (up)                         ${JSON.stringify(up)}`,
        `  ${label}  ÷2 staying ≥ document count     ${JSON.stringify(downFree)}`,
        `  ${label}  ÷2 going BELOW document count   ${JSON.stringify(downWrite)}`,
        '',
      )
    }
    // eslint-disable-next-line no-console
    console.log(['', '── THE RELATIVE WALK (×2 / ÷2) ──────────────────────────────', ...rows].join('\n'))
    expect(rows.length).toBeGreaterThan(0)
  })

  it('CONTROL — ×3 is NOT a free offer today, and the instrument can see that', () => {
    // `descaleSource`'s ⚠ says a non-power-of-two view declines the collapse and
    // writes the finer spelling. If that were wrong, the vocabulary could be "every
    // whole multiple" and this measurement's power-of-two bound would be arbitrary.
    // Asked of the real collapse rather than read off the comment ([[P424]] — a
    // documented gap can be right about the symptom and wrong about the cause).
    //
    // ⚠ AND A ZERO HERE IS NOT ABSENCE WITHOUT A CONTROL ARM. "×3 never collapses"
    // and "my probe is broken" produce the same 0. So the SAME probe runs at ×2 —
    // the multiplier #1057 shipped — over the SAME units, and that arm must come
    // back non-zero or this measurement says nothing at all.
    const probe = (k: number): { mini: string; collapsed: boolean }[] => {
      const out: { mini: string; collapsed: boolean }[] = []
      for (const mini of minis) {
        const base = parseStepGrid(mini)
        if (!base.ok || !base.model) continue
        const docSteps = documentSteps(base.model)
        if (docSteps * k > MAX_VIEW_STEPS) continue
        if (freeZoneScale(docSteps, docSteps * k) === null) continue
        const drawn = parseStepGrid(mini, k)
        if (!drawn.ok || !drawn.model) continue
        const back = collapseStepGridToDocument(drawn.model)
        out.push({ mini, collapsed: back !== null && serializeStepGrid(back) === mini })
        if (out.length >= 200) break
      }
      return out
    }
    const odd = probe(UNTESTED_MULTIPLIER)
    const control = probe(2)
    const rt = (p: { collapsed: boolean }[]): number => p.filter((x) => x.collapsed).length
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── ×3 CONTROL (untested surface) ────────────────────────────',
        `  ×3  admissible probes             ${odd.length}`,
        `  ×3  collapse round-trips          ${rt(odd)} of ${odd.length}`,
        `  ×2  admissible probes  [CONTROL]  ${control.length}`,
        `  ×2  collapse round-trips [CONTROL] ${rt(control)} of ${control.length}`,
      ].join('\n'),
    )
    expect(odd.length, 'the ×3 probe population must be non-empty').toBeGreaterThan(0)
    // THE ARM THAT MAKES THE ZERO MEAN SOMETHING
    expect(rt(control), 'the ×2 control must round-trip, or the probe proves nothing').toBeGreaterThan(
      0,
    )
  })
})
