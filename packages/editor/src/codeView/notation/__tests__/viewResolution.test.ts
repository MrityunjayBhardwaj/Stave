/**
 * viewResolution.test.ts — the two decisions #1055 was required to settle, asserted
 * rather than described.
 *
 * Both are design calls that a later phase would otherwise discover as a defect:
 * the REPRESENTATION (a multiplier, so there is no stale state to reset) and the
 * CEILING (the view's is not the document's). A comment stating either would drift;
 * these fail.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_VIEW_STEPS,
  UNREFINED,
  isViewScale,
  viewScaleFits,
  viewSteps,
} from '../viewResolution'
import { MAX_RESOLUTION_STEPS } from '../resolution'
import { projectStepGridDerived } from '../parse'

describe('#1055 — the view resolution contract', () => {
  it('THE CEILING IS DERIVED, not invented: the view ceiling equals the op ceiling', () => {
    // `resolution.ts` already answered "how many columns can a person read and click"
    // for the op path, with a stated rationale. A third constant would be a second
    // oracle for one property. The value is duplicated to keep `viewResolution.ts`
    // dependency-free, so this is the gate that stops the copy drifting.
    expect(MAX_VIEW_STEPS).toBe(MAX_RESOLUTION_STEPS)
  })

  it('THE VIEW CEILING IS ABOVE THE DOCUMENT CEILING — which is what makes this phase inert', () => {
    // `parse.ts` admits no pattern past 64 document columns. If the view ceiling were
    // at or below that, introducing the parameter could refuse a pattern that opens
    // today, and "provably invisible" would be a hope rather than a proof.
    const MAX_STEPS = 64 // parse.ts's document-expansion guard
    expect(MAX_VIEW_STEPS).toBeGreaterThan(MAX_STEPS)
    // …so every admissible document fits the view at the identity scale, exhaustively
    // over the admissible range rather than at a sampled point
    for (let documentCols = 1; documentCols <= MAX_STEPS; documentCols++) {
      expect(viewScaleFits(documentCols, 1, UNREFINED)).toBe(true)
    }
  })

  it('THE REPRESENTATION IS TOTAL: a multiplier is meaningful for every model', () => {
    // The point of the multiplier over an absolute column count, and the reason this
    // phase owes no reset rule. Carrying scale 2 from a 4-column pattern to a 3-column
    // one asks for 6 columns — a real answer. Carrying "8" would ask a 3-column
    // pattern for a ratio it does not have.
    for (const documentSteps of [1, 2, 3, 4, 5, 7, 12, 16, 31]) {
      for (const scale of [1, 2, 4, 8]) {
        const shown = viewSteps(documentSteps, scale)
        expect(Number.isInteger(shown)).toBe(true)
        expect(shown).toBeGreaterThanOrEqual(documentSteps)
        // and it is exactly a whole-number magnification of the document
        expect(shown % documentSteps).toBe(0)
      }
    }
  })

  it('rejects scales that are not whole magnifications', () => {
    expect(isViewScale(UNREFINED)).toBe(true)
    expect(isViewScale(2)).toBe(true)
    // a fractional scale is a COARSENING in disguise, which #1052 scopes out entirely
    expect(isViewScale(0.5)).toBe(false)
    expect(isViewScale(0)).toBe(false)
    expect(isViewScale(-1)).toBe(false)
    expect(isViewScale(1.5)).toBe(false)
    expect(isViewScale(Number.NaN)).toBe(false)
    // and an invalid scale can never be admitted, whatever the pattern
    expect(viewScaleFits(4, 1, 0.5)).toBe(false)
  })

  it('refuses a magnification past the view ceiling, and admits the one just under it', () => {
    // the boundary asserted from BOTH sides, so an off-by-one cannot pass
    expect(viewScaleFits(MAX_VIEW_STEPS / 2, 1, 2)).toBe(true) // exactly at the ceiling
    expect(viewScaleFits(MAX_VIEW_STEPS / 2, 1, 4)).toBe(false) // one doubling past it
    expect(viewScaleFits(32, 2, 4)).toBe(true) // 32 × 2 bars × 4 = 256
    expect(viewScaleFits(33, 2, 4)).toBe(false) // 264
  })

  it('THE SEAM IS LIVE — the projection actually draws more columns at a higher scale', () => {
    // Without this, "inert" and "not wired up" are the same observation, and Phase 4
    // would be the first thing to discover which one shipped. `bd ~ sn ~` is #1052's
    // canonical case: the user asks for a finer grid and today gets the document
    // re-spelled; here it is magnified with no writer involved at all.
    const declined = { ok: false as const, reason: 'not used in this test' }
    for (const [mini, atOne] of [
      ['bd ~ sn ~', 4],
      ['bd sn', 2],
      ['bd hh sn hh', 4],
    ] as const) {
      for (const scale of [1, 2, 4] as const) {
        const r = projectStepGridDerived(mini, declined, scale)
        expect(r.ok, `${mini} @ ${scale} must still open`).toBe(true)
        if (!r.ok) continue
        expect(r.model.steps, `${mini} @ ${scale}`).toBe(atOne * scale)
      }
    }
  })

  it('THE SEAM IS INERT — the identity scale reproduces the default projection exactly', () => {
    // the other half: passing `UNREFINED` explicitly must be indistinguishable from
    // passing nothing, or every existing caller has silently changed behaviour
    const declined = { ok: false as const, reason: 'not used in this test' }
    for (const mini of ['bd ~ sn ~', 'bd sn', 'bd*2 sn', 'bd hh sn hh', '<0 2 5 3>']) {
      const implicit = projectStepGridDerived(mini, declined)
      const explicit = projectStepGridDerived(mini, declined, UNREFINED)
      expect(JSON.stringify(explicit), mini).toBe(JSON.stringify(implicit))
    }
  })

  it('counts BARS, not just columns per bar', () => {
    // `perBar × bars` is the drawn width; a multi-bar pattern reaches the ceiling
    // sooner, and reading only `perBar` here would let an 8-bar pattern past it
    expect(viewScaleFits(16, 8, 2)).toBe(true) // 256
    expect(viewScaleFits(16, 8, 4)).toBe(false) // 512
  })
})
