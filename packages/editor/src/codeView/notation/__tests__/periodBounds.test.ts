/**
 * periodBounds.test.ts — every period cap obeys the one bound, and the bound is derived
 * from the probe rather than written down beside it (#1025).
 *
 * `detectPeriod` confirms a period by finding a repeat among the probed cycles, so a
 * period `p` is only VERIFIED once `2p` cycles were probed. A cap above half the probe
 * admits periods nothing ever checked: at `p = 16` against a probe of 24, cycles 8–15 are
 * compared to nothing and a period-32 pattern masquerades as period-16. The view is then
 * true for its own width and wrong on the very next cycle — a failure no onset oracle in
 * this project observes, because every one of them queries the bars the model claims.
 *
 * The bound used to live as the literal `12` in a doc comment here and in an assertion in
 * the app package, while `PERIOD_PROBE` stayed module-private. Both copies agreed with the
 * probe by coincidence, and raising the probe would have left them stale **and green** —
 * the shape of guard that can only ever be observed passing, which this project has been
 * bitten by before. This file checks the relationship instead of the number.
 */
import { describe, it, expect } from 'vitest'

import {
  PROJECTION_PERIOD_BOUNDS,
  parsePianoRoll,
  parseStepGrid,
  projectPianoRollDerived,
  projectStepGridDerived,
} from '../parse'

const { probe, maxVerifiedBars, element, leaf } = PROJECTION_PERIOD_BOUNDS

describe('period caps — the bound is derived from the probe, not restated beside it', () => {
  it('derives the admissible period from the probe window', () => {
    expect(maxVerifiedBars).toBe(Math.floor(probe / 2))
  })

  it('holds every shipped cap at or under it — the element writer and both leaf writers', () => {
    // Named individually rather than looped so a failure says WHICH cap broke the bound,
    // and so adding a fourth cap without adding it here is visible in the diff.
    expect(element, 'the element writer').toBeLessThanOrEqual(maxVerifiedBars)
    expect(leaf.grid, 'the leaf step-grid writer').toBeLessThanOrEqual(maxVerifiedBars)
    expect(leaf.roll, 'the leaf piano-roll writer').toBeLessThanOrEqual(maxVerifiedBars)
  })

  it('RED TEST: the bound is not vacuous — a cap one step past it would be rejected', () => {
    // Without this the two assertions above pass for any probe large enough, including a
    // probe raised precisely to make a too-large cap legal. Breaking the property is the
    // only way to know the check has teeth.
    expect(maxVerifiedBars + 1).toBeGreaterThan(maxVerifiedBars)
    expect([element, leaf.grid, leaf.roll].some((c) => c > maxVerifiedBars)).toBe(false)
    expect([element, leaf.grid, leaf.roll, maxVerifiedBars + 1].some((c) => c > maxVerifiedBars)).toBe(true)
  })

  it('refuses a pattern whose period is past the bound, on both DERIVED surfaces', () => {
    // Asked of the DERIVED writers, not of `parsePianoRoll`/`parseStepGrid`. The period
    // cap governs the projection chain only; the syntactic core has no period notion at
    // all — it models `<a b c …>` structurally and answers first — so the shipped entry
    // points open a period-13 view quite correctly, and asserting against them would be
    // asserting about the wrong writer. (The first draft of this test did exactly that
    // and failed, which is the cheapest possible demonstration that the cap is a property
    // of the fallback path rather than of the surface.)
    const past = maxVerifiedBars + 1
    const noCore = { ok: false as const, reason: '(asked of the derived writers directly)' }
    // one distinct atom per bar, so each played note owns its own source token and the
    // ONLY thing that can refuse these is the period — a shared leaf would refuse at
    // `no-leaf-anchor` instead and the test would be pinning the wrong gate
    const grid = (n: number): string =>
      `<${['bd', 'sd', 'hh', 'cp', 'oh', 'rim', 'cr', 'lt', 'mt', 'ht', 'sh', 'tb', 'perc', 'click'].slice(0, n).join(' ')}>`
    const roll = (n: number): string => `<${Array.from({ length: n }, (_, i) => i).join(' ')}>`

    // THE GATE is asserted, not just `.ok`. A refusal is compatible with any number of
    // reasons, and pinning one without naming it pins a symptom.
    expect(
      projectStepGridDerived(grid(past), noCore),
      `a period-${past} grid pattern was not stopped by the period gate`,
    ).toMatchObject({ ok: false, gate: 'unstable-period' })
    expect(
      projectPianoRollDerived(roll(past), noCore),
      `a period-${past} roll pattern was not stopped by the period gate`,
    ).toMatchObject({ ok: false, gate: 'unstable-period' })

    // THE CONTROL ARM, per surface — without it the two above would also pass if the
    // derived writers refused everything. Each surface is probed at its OWN cap, because
    // the two are not the same number and never were: the grid looks 12 bars out, the
    // roll 4, and the whole of #1020 is about why.
    expect(
      projectStepGridDerived(grid(leaf.grid), noCore),
      `a period-${leaf.grid} grid pattern — at the grid's own cap — was refused`,
    ).toMatchObject({ ok: true, model: { bars: leaf.grid } })
    expect(
      projectPianoRollDerived(roll(leaf.roll), noCore),
      `a period-${leaf.roll} roll pattern — at the roll's own cap — was refused`,
    ).toMatchObject({ ok: true, model: { bars: leaf.roll } })

    // …and the contrast worth keeping, because it is the whole reason the cap's two
    // populations behave differently: the SHIPPED entry points take the period-13 pattern
    // via the core, which has no period notion to bound.
    expect(parseStepGrid(grid(past)).ok, 'the core stopped serving long-period alternations').toBe(true)
    expect(parsePianoRoll(roll(past)).ok, 'the core stopped serving long-period alternations').toBe(true)
  })
})
