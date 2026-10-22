/**
 * #1259 — the structure predicate has one home, and the asymmetry survived the move.
 *
 * `hasStructure` decides whether a view has more than one thing in it: the rule
 * invariant 3's third term is built on (#1256). It was module-private inside
 * `writer-census.test.ts` and had been copied twice by the time anyone counted, so
 * nothing anywhere could fail if the two clauses drifted apart.
 *
 * WHAT THESE ARMS ARE FOR, and it is not "does `> 1` work". The load-bearing part of
 * this predicate is that the two surfaces get DIFFERENT clauses, which reads as an
 * oversight and is the whole point: a single note spanning four columns is structure
 * to a cell instrument and one dot in an empty field to a note instrument. Unify them
 * in either direction and every arm below that names both surfaces reddens.
 *
 * Asked of REAL minis through the shipped parsers wherever a parser can produce the
 * shape, so the arms cannot agree with a hand-made model the product never builds.
 */
import { describe, it, expect } from 'vitest'

import { parseStepGrid, parsePianoRoll } from '../parse'
import { hasStructure, cellOn } from '../model'
import type { PianoRollModel, StepGridModel } from '../model'

function grid(mini: string): StepGridModel {
  const r = parseStepGrid(mini)
  expect(r.ok, `expected the grid to open "${mini}"`).toBe(true)
  return (r as { ok: true; model: StepGridModel }).model
}

function roll(mini: string): PianoRollModel {
  const r = parsePianoRoll(mini)
  expect(r.ok, `expected the roll to open "${mini}"`).toBe(true)
  return (r as { ok: true; model: PianoRollModel }).model
}

describe('hasStructure — is there more than one thing in this view? (#1259)', () => {
  /**
   * The grid clause: more than one column, and at least one hit in them.
   *
   * `s("piano")` is the case the browser observation for #1256 caught — one lane, one
   * grey box, counted by the coverage oracle as a unit with a meaningful editable
   * surface.
   */
  it.each([
    ['piano', false], //          a timbre name, not a pattern
    ['bd', false], //             one column, one hit — round-trips perfectly, useless
    ['bd sd hh cp', true], //     four columns, four hits
    ['bd ~', true], //            two columns, one hit — a rest is still a column to place in
  ])('grid %s → %s', (mini, expected) => {
    expect(hasStructure(grid(mini), 'step')).toBe(expected)
  })

  /**
   * The roll clause: more than one NOTE. Columns do not count — the roll has no columns
   * of its own to be empty, so a wide grid holding one note is a wide empty grid.
   */
  it.each([
    ['c3', false], //             one dot
    ['c3 ~ ~ ~', false], //       still one dot, now with room around it
    ['c3 e3', true], //           two notes
    ['c3 e3 g3 c4', true],
  ])('roll %s → %s', (mini, expected) => {
    expect(hasStructure(roll(mini), 'roll')).toBe(expected)
  })

  /**
   * THE ASYMMETRY, PINNED ON ONE MINI. `c3 ~ ~ ~` opens on BOTH surfaces, and the two
   * clauses disagree about it on purpose: to the grid it is a lane with a hit across
   * four columns (structure), to the roll it is a single note (nothing to edit).
   *
   * This is the arm that reddens if the clauses are ever unified — in either direction,
   * since it asserts both answers. Applying the grid's clause to the roll is the
   * specific mistake the docblock warns about, and it would count a single-note roll
   * spanning sixteen steps as structured.
   */
  it('answers the same mini differently on the two surfaces, and that is the rule', () => {
    const mini = 'c3 ~ ~ ~'
    const g = grid(mini)
    const r = roll(mini)
    // the premise: both surfaces really do open it, and it really is one note over
    // several columns — pinned so the arm cannot pass because the shape changed
    expect(g.steps).toBeGreaterThan(1)
    expect(r.notes.length).toBe(1)
    expect(hasStructure(g, 'step')).toBe(true)
    expect(hasStructure(r, 'roll')).toBe(false)
  })

  /**
   * A grid with columns and no hits at all. Hand-built, and the reason is worth stating:
   * the parsers refuse an all-rest mini (`no-note-content`), so no shipped path produces
   * this model — but the census asks the predicate of models from BOTH derived writers
   * and the term-3 measurement counts "no hit" and "one column" as the same failure, so
   * the clause is real and nothing else covers it.
   */
  it('an empty grid is not structure, however wide', () => {
    const empty: StepGridModel = {
      steps: 8,
      lanes: [{ sound: 'bd', cells: Array.from({ length: 8 }, () => false as const) }],
    }
    expect(hasStructure(empty, 'step')).toBe(false)
    // one hit anywhere in it is enough — the clause is about the LANE's contents, not
    // about how many of the columns are filled
    const one: StepGridModel = {
      ...empty,
      lanes: [{ sound: 'bd', cells: empty.lanes[0].cells.map((c, i) => (i === 3 ? cellOn() : c)) }],
    }
    expect(hasStructure(one, 'step')).toBe(true)
  })
})
