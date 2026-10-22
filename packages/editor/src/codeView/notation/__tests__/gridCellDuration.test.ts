/**
 * gridCellDuration.test.ts — the step CELL carries how long its note sounds
 * (#1010 P4b), and the grid ops keep that length meaning what it says.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE COVERAGE GATES. P4b is a representation
 * change: it must move no number anywhere, and "no number moved" is exactly as
 * consistent with the new field being correctly populated as with it being silently
 * empty — nothing consumes it until P4c. So the field is asserted DIRECTLY, on values
 * a degenerate reader could not produce:
 *
 *   - lengths UNEQUAL to each other in one pattern (`bd hh*2 sd cp` → 2 and 1)
 *   - lengths GREATER than a column (`bd [sd sd sd]` → 3)
 *   - lengths SMALLER than a column (`[hh ~]!16` → 0.5 — a reader returning the
 *     column width cannot produce this, and neither can one returning a slot span)
 *   - a length that is neither (`[bd@0.5 - - -]` → 1/7)
 *
 * A reader that answered "1" for everything passes any test built from evenly spaced
 * single-column notes, which is most of the corpus. These are the cases that fail it.
 *
 * The sibling of `gridOnsetDuration.test.ts` (P4a, the same discipline one layer up,
 * where the axis first reached `Onset.durs`). Corpus-wide agreement with the engine
 * for every ON cell is `cell-duration.test.ts` in the app package; this file pins the
 * hand-checked cases and the ops' semantics.
 */
import { describe, it, expect } from 'vitest'
import { parseStepGrid } from '../parse'
import { cellOn, isCellOn } from '../model'
import type { StepCell, StepGridModel } from '../model'
import { scaleStepGrid, quantizeStepGridTo, stepResolutionEffect } from '../resolution'
import { serializeStepGrid } from '../serialize'
import { resizeGrid } from '../resize'

/** the lengths of one lane's cells, `null` where the cell is off */
const lens = (m: StepGridModel, sound: string): (number | null)[] => {
  const lane = m.lanes.find((l) => l.sound === sound)
  if (!lane) throw new Error(`no lane ${sound}`)
  return lane.cells.map((c) => (isCellOn(c) ? c.duration : null))
}

const grid = (mini: string): StepGridModel => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}

describe('a step cell carries its note’s length, in columns', () => {
  it('a plain step lasts exactly its column', () => {
    expect(lens(grid('bd ~ bd ~'), 'bd')).toEqual([1, null, 1, null])
  })

  it('a step beside a subdivided one lasts the columns it OWNS', () => {
    // `bd hh*2 sd cp` is four steps on eight columns: `bd`, `sd` and `cp` each own
    // two, the two `hh` one each. Nothing in the view showed this before — the cell
    // was one bit and the writer re-derived every length as one column.
    const m = grid('bd hh*2 sd cp')
    expect(m.steps).toBe(8)
    expect(lens(m, 'bd')).toEqual([2, null, null, null, null, null, null, null])
    expect(lens(m, 'hh')).toEqual([null, null, 1, 1, null, null, null, null])
    expect(lens(m, 'sd')).toEqual([null, null, null, null, 2, null, null, null])
    expect(lens(m, 'cp')).toEqual([null, null, null, null, null, null, 2, null])
  })

  it('a step beside a three-way group owns three columns', () => {
    expect(lens(grid('bd [sd sd sd]'), 'bd')).toEqual([3, null, null, null, null, null])
  })

  it('a note shorter than its column now costs the VIEW, not the length', () => {
    // The case the phase was named after: `[hh ~]!16` is sixteen notes of 1/32 cycle on a
    // 1/16 grid. The READER has read them as 0.5 columns since P4b and still does — what
    // changed at P4c is the WRITER. It preserves lengths now, the grid can only spell a
    // whole number of columns, and prove-before-offer therefore refuses the view rather
    // than opening one whose every edit would double sixteen notes.
    //
    // So this asserts the refusal, by its reason. The reader's sub-column correctness has
    // not gone untested: `cell-duration.test.ts` checks every ON cell against the engine
    // corpus-wide (4718 cells, 0 mismatches, ~206 units carrying a length that is not 1),
    // and the leaf-anchored case below still projects because byte surgery never spells a
    // length at all.
    const r = parseStepGrid('[hh ~]!16')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('nothing in this view could be edited on its own')
  })

  it('a length that is neither a column nor half of one', () => {
    // `[bd@0.5 - - -]` is one seventh of a cycle on a one-column grid. No rounding
    // to the grid, and nothing a span-shaped reader would produce.
    const [only] = lens(grid('[bd@0.5 - - -]'), 'bd')
    expect(only).toBeCloseTo(1 / 7, 12)
  })

  it('a `,`-stack part coarser than the shared grid is scaled to it', () => {
    // `sd` is one note over the whole cycle while `bd bd` sets the grid to two
    // columns, so `sd` lasts TWO of them. The first cut of P4b left it at one — the
    // part's own column count — and `cell-duration.test.ts` caught it on its first
    // run, over 69 cells in 14 units.
    const m = grid('bd bd, sd')
    expect(m.steps).toBe(2)
    expect(lens(m, 'bd')).toEqual([1, 1])
    expect(lens(m, 'sd')).toEqual([2, null])
  })

  it('an elongation read through the leaf projection keeps its length', () => {
    // `bd _sd` — bd held over two of three slots. The syntactic core refuses `_`
    // elongation outright, so this is the projected path, and it agrees with the
    // core's own arithmetic about what a held note lasts.
    const m = grid('bd _sd')
    expect(lens(m, 'bd')).toEqual([2, null, null])
    expect(lens(m, 'sd')).toEqual([null, null, 1])
  })
})

describe('the grid ops keep a length meaning what it says', () => {
  it('×2 doubles every length — the note keeps its time, at a finer resolution', () => {
    const m = scaleStepGrid(grid('bd hh*2 sd cp'), 'double')
    expect(m.steps).toBe(16)
    expect(lens(m, 'bd')[0]).toBe(4)
    expect(lens(m, 'hh').filter((d) => d !== null)).toEqual([2, 2])
  })

  it('÷2 DOES need a guard — and it is about spelling, not about integrality', () => {
    // This test used to assert the opposite, and the reasoning was right about the model and
    // wrong about the notation. The roll refuses an odd length (`structurallyCanHalveRoll`
    // wants every start and duration even, so the halved grid still lands on whole columns);
    // a CELL's length is fractional by design, so 1 → 0.5 represents exactly — and the
    // conclusion drawn from that was that the grid needs no guard at all.
    //
    // The roll's half of that used to be justified as "`RollNote.duration` counts whole `@n`
    // steps", which is not true and is worth not repeating: `@n` is a relative WEIGHT, not a
    // count, `duration` is that weight in columns, and it is fractional all over the corpus.
    // The roll's guard is a structural choice about staying on whole columns.
    //
    // Representing it was never the question. SPELLING it is: the grid emits one token per
    // column and a sustain as `_`, so it can write a whole number of columns and nothing
    // else. 0.5 has no spelling, and until P4c that did not show because the printer threw
    // the length away. So both surfaces need a guard, derived from different things — the
    // roll's from staying on whole columns, the grid's from its notation — which is
    // [[PV240]]'s corollary standing, with its example corrected.
    const m4 = grid('bd ~ sd ~')
    expect(scaleStepGrid(m4, 'halve')).toBe(m4) // refused: 1 column → half a column
    // …and where the lengths CAN survive the halving, it still applies and still halves:
    const doubled = scaleStepGrid(m4, 'double') // lengths now 2 columns
    const back = scaleStepGrid(doubled, 'halve')
    expect(back.steps).toBe(4)
    expect(lens(back, 'bd')).toEqual([1, null, null, null])
    expect(lens(back, 'sd')).toEqual([null, null, 1, null])
  })

  it('spread scales lengths with the grid; pad keeps them', () => {
    // The two modes hold opposite things fixed, and each is now consistent about
    // lengths as well as positions: spread preserves musical time, pad preserves
    // step indices and lets the groove stretch.
    const m: StepGridModel = { steps: 2, lanes: [{ sound: 'bd', cells: [cellOn(), false] }] }
    expect(lens(resizeGrid(m, 4, 'spread'), 'bd')).toEqual([2, null, null, null])
    expect(lens(resizeGrid(m, 4, 'pad'), 'bd')).toEqual([1, null, null, null])
  })

  it('quantize keeps the count when refining, and FLOORS a length coarsening would sink', () => {
    const m = grid('bd hh*2 sd cp')
    // 8 → 16: the note keeps its COLUMN count rather than stretching (#607, the rule
    // the roll already follows), so it occupies less of the cycle than before
    expect(lens(quantizeStepGridTo(m, 16), 'bd')[0]).toBe(2)
    // 8 → 4 halves every length, which is right, and lands the one-column `hh`s on half a
    // column — which the grid cannot spell. This USED to make the whole op decline. It now
    // holds those notes at ONE column instead (#1061): nothing is lost, a length grows to
    // the coarsest thing the new grid can say, and the panel draws that growth (#1056) so
    // it is a change the user watches happen rather than one made behind their back.
    expect(serializeStepGrid(quantizeStepGridTo(m, 4))).toBe('bd hh [hh,sd] cp')
    // …and the op SAYS so, which is what the control's copy is built from. Exactly the two
    // one-column `hh`s were floored; `bd`/`sd`/`cp` each had two columns and scaled cleanly.
    expect(stepResolutionEffect(m, 4).lengthened).toBe(2)
    // CONTROL — the floor must fire ONLY where the length would sink below a column. A
    // grid whose lengths all survive the halving has to come out byte-identical to what it
    // produced before this change, and report NOTHING. Without this arm, a regression that
    // floored every note would satisfy the assertion above.
    const even: StepGridModel = {
      steps: 4,
      lanes: [{ sound: 'bd', cells: [cellOn(2), false, cellOn(2), false] }],
    }
    expect(lens(quantizeStepGridTo(even, 2), 'bd')).toEqual([1, 1])
    expect(stepResolutionEffect(even, 2)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
    // CONTROL — and the floor is not a licence to write anything. A length that scales to a
    // NON-INTEGER number of columns (3 of 8 → 1.5 of 4) still has no spelling and is still
    // refused, rather than rounded into a different pattern.
    const odd = grid('bd _ _ ~ sn ~ ~ ~')
    expect(quantizeStepGridTo(odd, 4)).toBe(odd)
    expect(stepResolutionEffect(odd, 4)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('quantize MERGING is reachable again, and the merge rule still keeps the SHORTEST', () => {
    // This branch was dead for the whole of P4c, and the reason is worth keeping because it
    // explains why the floor brings it back. Two hits share a bucket only if they are within
    // `from / target` columns of each other, and hits that close cannot be longer than that
    // gap without overlapping — so a merging pair is always about ONE column long, and
    // coarsening scaled one column to less than one, which was never spellable. Every input
    // that could merge was therefore refused before it ever reached the merge.
    //
    // #1061's floor is exactly what removes that: those one-column notes are now held at one
    // column of the new grid, so the merge is live and its rule has to be right again.
    const m: StepGridModel = {
      steps: 4,
      lanes: [{ sound: 'bd', cells: [cellOn(3), cellOn(1), false, cellOn(1)] }],
    }
    // `bd@3` scales to 1.5 and needs no floor; the two one-column hits are floored to 1 and
    // land in the same bucket, where the merge keeps the SHORTEST of the two. `clampLane`
    // then cuts the first note back to the column before the next hit — so the merged grid
    // says `bd bd` and not a note sounding through a strike. That cut is a cost the control
    // reports (#1948): `bd@3` should have been 1.5 columns and is written as 1.
    expect(serializeStepGrid(quantizeStepGridTo(m, 2))).toBe('bd bd')
    // Both one-column hits are floored, but only ONE of them is written: the other merged
    // into it. So one note got longer, not two (#1968) — the count is taken on the note the
    // column keeps, and the hit that merged away is `merged` and nothing else.
    expect(stepResolutionEffect(m, 2)).toEqual({ lengthened: 1, snapped: 2, merged: 1, shortened: 1 })
    // CONTROL — a merge is reported only where one happens. The same shape with its hits
    // far enough apart to keep their own buckets floors identically and merges nothing, so
    // a regression that reported `merged` for every coarsening cannot pass both arms.
    const apart: StepGridModel = {
      steps: 4,
      lanes: [{ sound: 'bd', cells: [cellOn(1), false, cellOn(1), false] }],
    }
    expect(serializeStepGrid(quantizeStepGridTo(apart, 2))).toBe('bd bd')
    expect(stepResolutionEffect(apart, 2)).toEqual({ lengthened: 2, snapped: 0, merged: 0, shortened: 0 })
  })

  it('a length that is one column but for a rounding error is not reported as made longer (#1968)', () => {
    // Lengths reach the cell through float arithmetic, so "two columns" routinely arrives as
    // `1.9999999999999996`. Halved, that is a hair under one column and the floor rounds it
    // up to one — a write the user cannot tell from the exact one. Counting it would put
    // "makes 1 note longer" on a press that changes no length (seen on real 24- and 48-step
    // patterns). The second note is exactly two columns and is the control for the first.
    const m: StepGridModel = {
      steps: 4,
      lanes: [{ sound: 'bd', cells: [cellOn(1.9999999999999996), false, cellOn(2), false] }],
    }
    expect(serializeStepGrid(quantizeStepGridTo(m, 2))).toBe('bd bd')
    expect(stepResolutionEffect(m, 2)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('a length is clamped to the grid it lands on, in resize as in quantize', () => {
    // pad TRUNCATING: a 3-column note on a grid cut to 2 columns cannot keep reaching
    // past the end. `resizeRoll` has always clamped here (`Math.min(duration,
    // nextSteps - start)`); the grid could not, because a cell had no length.
    const long: StepGridModel = { steps: 4, lanes: [{ sound: 'bd', cells: [cellOn(3), false, false, false] }] }
    expect(lens(resizeGrid(long, 2, 'pad'), 'bd')).toEqual([2, null])
    // spread DOWNSAMPLING: two hits collapse toward each other, so the first may not
    // keep a length that now runs into the second
    const two: StepGridModel = {
      steps: 4,
      lanes: [{ sound: 'bd', cells: [cellOn(2), false, cellOn(2), false] }],
    }
    expect(lens(resizeGrid(two, 2, 'spread'), 'bd')).toEqual([1, 1])
  })

  it('an off cell is `false`, so every "is anything here?" reader still works', () => {
    const cells: StepCell[] = grid('bd ~ bd ~').lanes[0].cells
    expect(cells.filter(Boolean).length).toBe(2)
    expect(cells.some(Boolean)).toBe(true)
    expect(cells[1]).toBe(false)
  })
})
