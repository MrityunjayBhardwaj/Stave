/**
 * #1087 — the roll draws enough columns to show every note it carries.
 *
 * `@n` is a relative WEIGHT, so a pattern's length is under no obligation to be a whole
 * number of columns. The panel counted cells with `Array.from({ length: model.steps })`,
 * and `Array.from` FLOORS its length — so a fractional length silently dropped the last
 * column, and at `0.9999999999999998` it dropped all of them while five notes sounded.
 */
import { describe, it, expect } from 'vitest'

import { parsePianoRoll } from '../parse'
import { serializePianoRoll } from '../serialize'
import { columnCount, tailColumn } from '../model'
import type { PianoRollModel } from '../model'

function roll(mini: string): PianoRollModel {
  const r = parsePianoRoll(mini)
  expect(r.ok, `expected the roll to open "${mini}"`).toBe(true)
  return (r as { ok: true; model: PianoRollModel }).model
}

/** What the panel actually renders — `Array.from`, not a re-derivation of it. */
const drawn = (n: number): number => Array.from({ length: n }).length

describe('columnCount — the roll draws every note it carries (#1087)', () => {
  /**
   * The consequence, asked as the consequence. Not "is `steps` a whole number?" —
   * `0.9999999999999998` passes any integrality tolerance a reasonable person writes and
   * still floors to zero.
   */
  it.each([
    // mini                                  steps (as parsed)     columns that must be drawn
    ['c4@0.2 e4@0.2 g4@0.2 b4@0.2 c5@0.2', 0.9999999999999998, 1],
    ['c4@1.5 e4 g4@0.2', 2.7, 3],
    ['c4@0.5 e4', 1.5, 2],
    ['c4@1.5 e4@1.2', 2.7, 3],
  ])('covers every note of %s', (mini, steps, expected) => {
    const model = roll(mini)
    // the length really is fractional — the premise of the defect, pinned so this test
    // cannot quietly start passing because the reader began rounding
    expect(model.steps).toBe(steps)
    expect(columnCount(model)).toBe(expected)
    // and the count the panel hands the renderer survives `Array.from`
    const needed = Math.max(...model.notes.map((n) => tailColumn(n) + 1))
    expect(drawn(columnCount(model))).toBeGreaterThanOrEqual(needed)
    // the defect itself, stated as the control: the old count did NOT cover it
    expect(drawn(model.steps)).toBeLessThan(needed)
  })

  it('leaves a whole-numbered pattern exactly as it drew before', () => {
    for (const mini of ['c4 e4 g4 b4 c5', 'c4@2 e4', 'c4@2.5 e4@1.5', 'c4 ~ ~']) {
      const model = roll(mini)
      expect(columnCount(model), mini).toBe(model.steps)
      expect(drawn(columnCount(model)), mini).toBe(drawn(model.steps))
    }
  })

  /**
   * The two terms are independently load-bearing, which is the reason both are written
   * out rather than one being inferred from the other. Break either and a real pattern
   * loses a column.
   */
  it('counts trailing rests — the LENGTH term, which no note reaches into', () => {
    const model = roll('c4 ~ ~')
    expect(Math.max(...model.notes.map((n) => tailColumn(n) + 1))).toBe(1) // notes say 1
    expect(columnCount(model)).toBe(3) // the length says 3
  })

  it('counts a partial tail column a note sounds in — the NOTE term', () => {
    const model = roll('c4@1.5 e4@1.2')
    expect(Math.floor(model.steps)).toBe(2) // whole columns say 2
    expect(columnCount(model)).toBe(3) // the note sounding through column 2 says 3
  })

  it('leaves a partial tail column holding only a REST undrawn', () => {
    // 1.5 long, so column 1 is half a column — nothing can be placed in it (the writer
    // refuses a note running past `steps`) and no note sounds there, so drawing it would
    // add an empty cell that only declines.
    const model = roll('c4 ~@0.5')
    expect(model.steps).toBe(1.5)
    expect(columnCount(model)).toBe(1)
  })

  it('does not claim a phantom column for a sliver either side of a whole number', () => {
    // the mirror of the defect — the same sliver `columnOverlap` refuses to call a column
    expect(columnCount({ steps: 3.0000000000000004 })).toBe(3)
    expect(columnCount({ steps: 2.9999999999999996 })).toBe(3)
    expect(columnCount({ steps: 3 })).toBe(3)
    expect(columnCount({ steps: 0 })).toBe(0)
  })

  /**
   * THE ARM THAT PINS WHY THE FIX IS NOT IN THE READER.
   *
   * #1087 proposed rounding the reader's `steps` up. Measured, that corrupts the writer:
   * `steps` is what the music is spelled from, so widening it appends a rest the user
   * never wrote and lengthens the pattern. The drawn column count and the pattern length
   * are two different questions and only the first may be rounded.
   *
   * ⚠ THE DAMAGE CHANGED SHAPE WHEN #1092 LANDED, AND THE CONCLUSION DID NOT.
   * This arm pins a COUNTERFACTUAL — what rounding would have produced — so it is a
   * reading of the writer, and #1092 taught the writer to spell a rest at its true
   * width. Before, rounding produced `c4@1.5 e4@1.2000000000000002 ~`: a distorted
   * weight plus a whole-column rest. Now it produces `c4@1.5 e4@1.2 ~@0.3`, which is
   * spelled correctly and is still wrong, because the pattern still goes from 2.7
   * columns to 3 and `e4` still moves from [0.5556, 1.0000) to [0.5000, 0.9000) —
   * Strudel scales each comma-lane to its own total, so a rest nobody asked for
   * retimes a note nobody touched.
   *
   * So the string below was re-argued rather than re-numbered: rounding the model
   * field is still forbidden, and what a passing spelling proves is only that the
   * writer got better at saying something it should never be asked to say.
   */
  it('does not touch what the writer spells', () => {
    const model = roll('c4@1.5 e4@1.2')
    expect(serializePianoRoll(model)).toBe('c4@1.5 e4@1.2')
    // what rounding `steps` in the reader would have produced instead
    expect(serializePianoRoll({ ...model, steps: columnCount(model) })).toBe(
      'c4@1.5 e4@1.2 ~@0.3',
    )
  })
})
