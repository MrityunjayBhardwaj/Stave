/**
 * onsetGrid — the snap grid can express every resolution the gate will accept (#1066).
 *
 * `denom(x, MAX_STEPS)` is the acceptance test every projection runs: an onset is
 * editable iff some `d <= MAX_STEPS` makes `x·d` integral. `readGridOnsets` snaps
 * each onset onto `ONSET_GRID` BEFORE that test sees it. So any position the grid
 * cannot express exactly is rejected by a test it was never able to pass, and the
 * refusal blames the pattern — `irrational-onset` — for a perfectly rational
 * position the snapping made irrational.
 *
 * The old value was `720720` (`LCM(1..16)`), which carries only 2^4, so 32 and 64
 * did not divide it while `MAX_STEPS` was 64. The grid writer's own output after
 * three subdivisions needs thirty-seconds, which is how it came to emit documents
 * its own reader refused to open.
 */
import { describe, it, expect } from 'vitest'
import { parseStepGrid, ONSET_GRID, MAX_STEPS } from '../parse'

/** the value `ONSET_GRID` replaced — kept so "this is a widening" stays checkable */
const PREVIOUS_GRID = 720720

describe('#1066 — the snap grid vs the acceptance test', () => {
  it('the finest uniform grid the system permits is exactly expressible', () => {
    expect(
      ONSET_GRID % MAX_STEPS,
      `ONSET_GRID (${ONSET_GRID}) cannot express 1/${MAX_STEPS}, so an onset at that ` +
        'resolution snaps to a neighbour and is then refused as irrational — by the ' +
        'same MAX_STEPS test it was supposed to pass.',
    ).toBe(0)
  })

  it('every power of two up to the ceiling divides the grid', () => {
    // The ladder is what a subdividing writer walks: 8 -> 16 -> 32 -> 64. The old
    // grid stopped at 16 and the writer did not.
    const bad: number[] = []
    for (let d = 1; d <= MAX_STEPS; d *= 2) if (ONSET_GRID % d !== 0) bad.push(d)
    expect(bad, `these power-of-two resolutions are not expressible: ${bad.join(', ')}`).toEqual([])
  })

  it('the change is a WIDENING — nothing expressible before was lost', () => {
    // A stricter statement than "32 now works": every position the previous grid
    // could express must still be expressible, or some document that opened would
    // start refusing.
    expect(
      ONSET_GRID % PREVIOUS_GRID,
      `ONSET_GRID must be a multiple of ${PREVIOUS_GRID}; otherwise this trades one ` +
        'set of refusals for another instead of removing them.',
    ).toBe(0)
  })

  it('the reported document opens — the writer\'s own output after three subdivisions', () => {
    // `bd ~ sn ~` subdivided three times. Refused before this fix; the panel closed
    // on notation the grid writer had just emitted.
    const r = parseStepGrid('bd [~ bd bd _ bd _ _ _] sn ~')
    expect(r.ok, `refused: ${(r as { reason?: string }).reason ?? ''}`).toBe(true)
    expect((r as { model: { steps: number } }).model.steps).toBe(32)
  })

  it('control arm: a resolution the grid genuinely cannot express is STILL refused', () => {
    // Without this, widening the grid could not be distinguished from disabling the
    // gate. 27 = 3^3 and ONSET_GRID carries only 3^2, so a 27th must still say no —
    // the gate is narrower, not gone. Both the old grid and this one stop at 3^2, so
    // nothing about this verdict changed; it is here to pin that it did not.
    expect(ONSET_GRID % 27).not.toBe(0)

    // ⚠ THE FIXTURE HAS TO REACH THE SNAP GRID, which is why it is not `bd*27`:
    // that stays inside the SYNTACTIC core, which derives columns from the source
    // and never snaps anything, so it opens at 27 steps and would have made this arm
    // pass while testing a mechanism it does not name. The `_` inside the group is
    // what pushes the document onto the behaviour path.
    const r = parseStepGrid('bd [~ bd bd _ bd bd bd bd bd] sn')
    expect(r.ok).toBe(false)

    // …and the syntactic path really does still take the other one, so the comment
    // above is checked rather than asserted in prose.
    expect(parseStepGrid('bd*27').ok).toBe(true)
  })
})
