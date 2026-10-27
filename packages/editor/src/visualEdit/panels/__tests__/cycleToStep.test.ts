import { describe, it, expect } from 'vitest'
import { cycleToStep, stepToCycle } from '../usePlayingStep'

describe('cycleToStep', () => {
  it('maps a flat-pattern cycle to its step', () => {
    expect(cycleToStep(0, 4, 1, 4)).toBe(0)
    expect(cycleToStep(0.25, 4, 1, 4)).toBe(1)
    expect(cycleToStep(0.5, 4, 1, 4)).toBe(2)
    expect(cycleToStep(0.99, 4, 1, 4)).toBe(3)
    expect(cycleToStep(1, 4, 1, 4)).toBe(0) // wraps each cycle
    expect(cycleToStep(2.5, 4, 1, 4)).toBe(2)
  })

  it('takes the phase mod bars for multi-bar patterns', () => {
    // 8 steps across 2 bars → 4 steps per bar
    expect(cycleToStep(0, 8, 2, 8)).toBe(0)
    expect(cycleToStep(1, 8, 2, 8)).toBe(4) // start of bar 2
    expect(cycleToStep(1.5, 8, 2, 8)).toBe(6)
    expect(cycleToStep(2, 8, 2, 8)).toBe(0) // wraps after 2 bars
  })

  it('is robust to negative cycles', () => {
    expect(cycleToStep(-0.25, 4, 1, 4)).toBe(3)
  })

  it('returns null when not playing or empty', () => {
    expect(cycleToStep(null, 4, 1, 4)).toBeNull()
    expect(cycleToStep(0.5, 0, 1, 0)).toBeNull()
    expect(cycleToStep(Infinity, 4, 1, 4)).toBeNull()
  })

  it('clamps into range', () => {
    expect(cycleToStep(0.999999, 4, 1, 4)).toBe(3)
  })

  /**
   * #1087 — a pattern's length need not be a whole number of columns (`note("c4@1.5
   * e4@1.2")` is 2.7 long). The clamp used to be `steps - 1`, so on such a pattern it
   * returned `1.7` — a value no column index can equal, so the playing highlight simply
   * never fired on the last column. The mapping still divides the true length; only the
   * bound is a column count.
   */
  it('clamps a fractional-length pattern to a real column', () => {
    // `note("c4@1.5 e4@1.2")` — 2.7 long, three columns drawn
    for (const cycle of [0, 0.3, 0.6, 0.9, 0.999999]) {
      const step = cycleToStep(cycle, 2.7, 1, 3)
      expect(Number.isInteger(step), `cycle ${cycle} gave ${step}`).toBe(true)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(2)
    }
    // the position still comes from the true LENGTH, not from the column count:
    // at 70% of a 2.7-column pattern the playhead is in column 1, not column 2
    expect(cycleToStep(0.7, 2.7, 1, 3)).toBe(1)
    expect(cycleToStep(0.999999, 2.7, 1, 3)).toBe(2)
  })

  it('never highlights a column the panel did not draw', () => {
    // `note("c4 ~@0.5")` — 1.5 long, but the fractional tail holds a rest, so only
    // ONE column is drawn. The mapping reaches 1 near the end of the cycle; the bound
    // is what keeps the highlight on a column that exists.
    expect(cycleToStep(0.9, 1.5, 1, 1)).toBe(0)
    expect(cycleToStep(0.999999, 1.5, 1, 1)).toBe(0)
  })

  it('follows each bar at its own count when bars differ (#1827)', () => {
    // `<[a b c] [a b c d]>` drawn as 3 + 4 cells. Read uniformly, 7 cells over 2 cycles
    // puts cycle 0.9 in cell 3 — bar 2's first cell, while bar 1 is still playing.
    const bs = [3, 4]
    expect(cycleToStep(0.9, 7, 2, 7, bs)).toBe(2) // bar 1's last cell, not bar 2
    expect(cycleToStep(0.9, 7, 2, 7)).toBe(3) // the uniform reading this replaces
    expect(cycleToStep(1.0, 7, 2, 7, bs)).toBe(3) // bar 2's downbeat
    expect(cycleToStep(1.3, 7, 2, 7, bs)).toBe(4) // 30% into a bar of 4 → its second cell
    expect(cycleToStep(1.999, 7, 2, 7, bs)).toBe(6)
    expect(cycleToStep(2.1, 7, 2, 7, bs)).toBe(0) // the pattern loops
  })
})

describe('stepToCycle — a column back to its time (#2226)', () => {
  it('inverts cycleToStep on every column start: one bar, several bars, uneven bars', () => {
    for (const [steps, bars, barSteps] of [
      [8, 1, undefined],
      [8, 2, undefined],
      [7, 2, [3, 4]],
    ] as const) {
      for (let col = 0; col < steps; col++) {
        const t = stepToCycle(col, steps, bars, barSteps)
        expect(cycleToStep(t + 1e-9, steps, bars, steps, barSteps), `${steps}/${bars} col ${col}`).toBe(col)
      }
    }
  })

  it('keeps a mid-column start', () => {
    expect(stepToCycle(1.5, 4, 1)).toBe(0.375)
    expect(stepToCycle(4.5, 7, 2, [3, 4])).toBe(1 + 1.5 / 4)
  })
})
