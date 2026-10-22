/**
 * cellResize.test.ts — the step grid's per-note LENGTH gesture (#1053).
 *
 * The model has carried a cell's length since #1010 P4b, the printer has preserved it
 * since P4c, and #1056 put it on screen. `resizeCell` is the missing verb: the one place
 * that says what "make this note longer" means on the grid, so the panel and every sweep
 * ask the same function rather than each modelling the edit ([[#1048]]).
 *
 * ── WHY EVERY DECLINE ARM HERE CARRIES A LIVE CONTROL ─────────────────────────
 * `resizeCell` signals "could not apply" by returning its input, so `expect(op(m)).toBe(m)`
 * is satisfied by an op that declines EVERYTHING — including one broken to `return model`
 * on its first line. Each decline is therefore paired with a case that must still apply,
 * chosen so a blanket break cannot pass both. Verified rather than assumed: breaking
 * `resizeCell` to `return model` reddens EVERY arm in this file.
 *
 * ⚠ The pair used to be `bd ~ sn ~` against `[bd ~ sn ~]` — the same four columns, one
 * spelling accepted and the other refused. #1146 removed that difference on purpose (the
 * writer now absorbs the rest a sustain needs), so the live/decline pairs here are drawn
 * on whether there is a REST IN REACH at all: `bd ~ sn ~` accepts, `bd*4` cannot.
 *
 * ── THE ONE THAT WAS FOUND BY FIXTURE, NOT BY REASONING ───────────────────────
 * `[bd ~ ~ ~, hh ~ hh ~]` projects cells that are HALF a column, and setting one to a
 * whole column changes the model while serializing to the very same bytes. `useGridModel`
 * keeps a model whose serialization is unchanged, so that would have redrawn the note
 * longer while the document said nothing happened. It is pinned here as a decline because
 * it is the only arm in this file that no amount of reading the op would have produced.
 */
import { describe, it, expect } from 'vitest'
import { parseStepGrid } from '../parse'
import { serializeStepGrid } from '../serialize'
import { cellOn, isCellOn, laneCoverage } from '../model'
import type { StepGridModel } from '../model'
import { canResizeCell, resizeCell } from '../place'

const grid = (mini: string): StepGridModel => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}

/** the lane index carrying `sound` */
const laneOf = (m: StepGridModel, sound: string): number => {
  const i = m.lanes.findIndex((l) => l.sound === sound)
  if (i < 0) throw new Error(`no lane ${sound}`)
  return i
}

const lengthAt = (m: StepGridModel, sound: string, col: number): number | null => {
  const c = m.lanes[laneOf(m, sound)].cells[col]
  return isCellOn(c) ? c.duration : null
}

describe('resizeCell — setting a note’s length in columns', () => {
  it('LENGTHENS a note, and the printer spells the extra columns as sustain', () => {
    const m = grid('[bd ~ ~ ~]')
    expect(lengthAt(m, 'bd', 0)).toBe(1)

    const two = resizeCell(m, laneOf(m, 'bd'), 0, 2)
    expect(two).not.toBe(m)
    expect(serializeStepGrid(two)).toBe('bd _ ~ ~')
    expect(lengthAt(two, 'bd', 0)).toBe(2)

    const three = resizeCell(m, laneOf(m, 'bd'), 0, 3)
    expect(serializeStepGrid(three)).toBe('bd _ _ ~')

    // CONTROL: the length it already has is not an edit. Without this, an op that
    // returned a fresh model unconditionally would pass every arm above.
    expect(resizeCell(m, laneOf(m, 'bd'), 0, 1)).toBe(m)
  })

  it('SHORTENS a held note back down, which is the direction the grid could never reach', () => {
    const m = grid('bd _ sn ~')
    expect(lengthAt(m, 'bd', 0)).toBe(2)

    const one = resizeCell(m, laneOf(m, 'bd'), 0, 1)
    expect(serializeStepGrid(one)).toBe('bd ~ sn ~')
    expect(lengthAt(one, 'bd', 0)).toBe(1)
  })

  it('CAPS at the room the note has — the next hit in its own lane, then the grid end', () => {
    const m = grid('[bd ~ sn ~]')
    // bd is followed by sn at column 2, so two columns is all the room there is…
    expect(serializeStepGrid(resizeCell(m, laneOf(m, 'bd'), 0, 2))).toBe('bd _ sn ~')
    // …and asking for more lands on the same maximum rather than declining, so a drag
    // held past the next hit does not stall.
    expect(serializeStepGrid(resizeCell(m, laneOf(m, 'bd'), 0, 9))).toBe('bd _ sn ~')

    // sn has the grid's end as its only bound
    expect(serializeStepGrid(resizeCell(m, laneOf(m, 'sn'), 2, 9))).toBe('bd ~ sn _')
  })

  it('FLOORS at one column — below that the grid has no spelling at all', () => {
    const m = grid('bd _ sn ~')
    const zero = resizeCell(m, laneOf(m, 'bd'), 0, 0)
    expect(lengthAt(zero, 'bd', 0)).toBe(1)
    expect(serializeStepGrid(zero)).toBe('bd ~ sn ~')

    // CONTROL: flooring is not "any request collapses to 1" — a real length still lands.
    expect(lengthAt(resizeCell(grid('[bd ~ ~ ~]'), 0, 0, 3), 'bd', 0)).toBe(3)
  })

  it('THE CAP AND THE DRAWING ARE ONE RULE — the note covers exactly what it was given', () => {
    // `resizeCell` clamps with `clampLane`; `laneCoverage` READS the same rule to decide
    // how much of each column to fill. Asserting them together is what keeps the handle
    // from ending up somewhere the note is not drawn.
    const m = grid('[bd ~ sn ~]')
    const grown = resizeCell(m, laneOf(m, 'bd'), 0, 9)
    const cov = laneCoverage(grown.lanes[laneOf(grown, 'bd')].cells, grown.steps)
    expect(cov[0]).toEqual({ start: 0, extent: 1 })
    expect(cov[1]).toEqual({ start: 0, extent: 1 }) // carried
    expect(cov[2]).toBeUndefined() // sn's column — bd stopped
  })

  it('DECLINES a sustain that would land in a neighbouring element’s bytes', () => {
    // ⚠ THIS ARM USED TO ASSERT THE OPPOSITE, and the change is #1146. Spelled flat, each
    // column was its own source element, so the `_` had to be written into the NEXT
    // element's bytes and the writer declined — while the SAME four columns inside one
    // `[…]` group accepted. Two spellings that sound identical behaved differently for a
    // reason no user could see. The writer now widens who owns the bytes rather than
    // refusing, so both spellings accept, and this file records the new rule instead of
    // keeping a pin on the old limit.
    const flat = grid('bd ~ sn ~')
    expect(serializeStepGrid(resizeCell(flat, laneOf(flat, 'bd'), 0, 2))).toBe('bd _ sn ~')

    const grouped = grid('[bd ~ sn ~]')
    expect(serializeStepGrid(resizeCell(grouped, laneOf(grouped, 'bd'), 0, 2))).toBe('bd _ sn ~')

    // ABSORPTION IS BOUNDED BY THE NOTE'S REACH, which is the whole difference between
    // this and re-laying the part: `sn` and the rests after it keep their own bytes, so a
    // document loses nothing the edit did not actually need.
    const wide = grid('bd ~ ~ ~ sn ~ ~ ~')
    expect(serializeStepGrid(resizeCell(wide, laneOf(wide, 'bd'), 0, 4))).toBe('bd _ _ _ sn ~ ~ ~')

    // …including the SPACING of the elements it did not swallow.
    const spaced = grid('bd    ~    sn ~')
    expect(serializeStepGrid(resizeCell(spaced, laneOf(spaced, 'bd'), 0, 2))).toBe('bd _    sn ~')

    // …and their REST SPELLING, which is the arm that isolates the reach bound.
    //
    // ⚠ THIS FIXTURE EXISTS BECAUSE THE OTHERS COULD NOT TELL. Absorption is bounded
    // twice — by the note's reach, and by the guard that refuses to swallow an unchanged
    // region carrying notes — and on every pattern above the two stop it at the SAME
    // place, so breaking either one alone changed no output at all. `-` and `~` are the
    // same rest to the engine and different bytes on the page: the writer emits `~`, so a
    // `-` survives only by being copied verbatim. Absorb one rest too many and it turns
    // into a `~` the user never typed.
    const dashes = grid('bd - - -')
    expect(serializeStepGrid(resizeCell(dashes, laneOf(dashes, 'bd'), 0, 2))).toBe('bd _ - -')
  })

  it('STILL DECLINES where there are no rests to absorb', () => {
    // Absorption only takes bytes that say "nothing starts here". Where every column in
    // the note's reach carries one, there is nothing to take and the write is still
    // refused — which is what keeps this from becoming "re-emit whatever is nearby".
    const dense = grid('bd*4')
    expect(resizeCell(dense, 0, 0, 2)).toBe(dense)

    const busy = grid('bd hh*2 sn cp')
    expect(resizeCell(busy, laneOf(busy, 'bd'), 0, 2)).toBe(busy)

    // CONTROL: the same op on a grid that HAS a rest in reach applies, so the two
    // declines above are facts about the material and not about a dead op.
    const roomy = grid('bd ~ sn ~')
    expect(resizeCell(roomy, laneOf(roomy, 'bd'), 0, 2)).not.toBe(roomy)
  })

  it('DECLINES an edit the document would not record, even though the model moved', () => {
    // Half-column cells: setting one to a whole column changes the model and serializes
    // to identical bytes. Offering it would redraw the note longer while the code stood
    // still — found by fixture, and the reason the op compares the WRITTEN document.
    const m = grid('[bd ~ ~ ~, hh ~ hh ~]')
    const before = serializeStepGrid(m)
    for (const li of [0, 1]) {
      for (let si = 0; si < m.lanes[li].cells.length; si++) {
        if (!isCellOn(m.lanes[li].cells[si])) continue
        for (const d of [1, 2, 3]) expect(resizeCell(m, li, si, d)).toBe(m)
      }
    }
    // CONTROL: the guard is about THIS notation, not about every grouped pattern.
    //
    // ⚠ Bound to ONE model deliberately. Written first as
    // `expect(resizeCell(grid(…), …)).not.toBe(grid(…))`, it compared two separately
    // parsed objects — never identical whatever the op does — and was the single arm in
    // this file that survived breaking `resizeCell` to `return model` on its first line.
    // A control that cannot fail is not a control ([[PV275]]).
    const live = grid('[bd ~ ~ ~]')
    expect(resizeCell(live, 0, 0, 2)).not.toBe(live)
    expect(serializeStepGrid(m)).toBe(before) // the op mutated nothing
  })

  it('DECLINES on a cell that carries no note, and past the end of the lane', () => {
    const m = grid('[bd ~ sn ~]')
    expect(resizeCell(m, laneOf(m, 'bd'), 1, 2)).toBe(m) // a rest
    expect(resizeCell(m, laneOf(m, 'bd'), 99, 2)).toBe(m) // off the end
    expect(resizeCell(m, 99, 0, 2)).toBe(m) // no such lane

    // CONTROL: the real cell in the same grid still resizes.
    expect(resizeCell(m, laneOf(m, 'bd'), 0, 2)).not.toBe(m)
  })

  it('ABSORPTION NEVER SWALLOWS AN UNCHANGED REGION THAT CARRIES NOTES', () => {
    // ⚠ HAND-BUILT, because `resizeCell` cannot reach this on its own: `partRoom` caps a
    // length at the next onset in the part, so a sustain the op produces never runs into
    // a region carrying a note. The guard is there for the write path, not for this op,
    // and a guard whose zero has never been shown reachable certifies nothing — so the
    // model is constructed directly rather than pretending an op-level arm covers it.
    //
    // Two regions changed at once (a lengthened `bd` AND a deleted `sn`) is the shape a
    // future batched edit would produce. The deleted region is going to be re-emitted
    // anyway, so absorbing it costs nothing and the write must SUCCEED — that is the half
    // an over-strict guard breaks.
    const m = grid('bd ~ sn ~')
    const bd = laneOf(m, 'bd')
    const sn = laneOf(m, 'sn')
    const both: StepGridModel = {
      ...m,
      lanes: m.lanes.map((l, i) =>
        i === bd
          ? { ...l, cells: l.cells.map((c, j) => (j === 0 ? cellOn(3) : c)) }
          : i === sn
            ? { ...l, cells: l.cells.map(() => false as const) }
            : l,
      ),
    }
    expect(serializeStepGrid(both)).toBe('bd _ _ ~')

    // CONTROL: the same reach WITHOUT the second change stops at `sn`'s own bytes, so the
    // widening above is about that region having been edited and not about absorption
    // simply running as far as it likes.
    const one: StepGridModel = {
      ...m,
      lanes: m.lanes.map((l, i) =>
        i === bd ? { ...l, cells: l.cells.map((c, j) => (j === 0 ? cellOn(3) : c)) } : l,
      ),
    }
    expect(serializeStepGrid(one)).toBeNull()
  })

  it('canResizeCell IS the op, not a predicate beside it', () => {
    // Derived rather than reasoned, so the handle cannot promise a drag the writer
    // declines ([[PV241]]). Asserted over a grid with one of each verdict.
    for (const mini of ['[bd ~ sn ~]', 'bd ~ sn ~', 'bd _ sn ~', '[bd ~ ~ ~, hh ~ hh ~]']) {
      const m = grid(mini)
      for (let li = 0; li < m.lanes.length; li++) {
        for (let si = 0; si < m.lanes[li].cells.length; si++) {
          for (const d of [0, 1, 2, 3, 9]) {
            expect(canResizeCell(m, li, si, d)).toBe(resizeCell(m, li, si, d) !== m)
          }
        }
      }
    }
    // CONTROL: the agreement above is not vacuous — both verdicts occur in that set.
    // (`bd ~ sn ~` was the `false` half until #1146 taught the writer to absorb the rest
    // it needed; `bd*4` has no rest to absorb and is the honest decline now.)
    expect(canResizeCell(grid('[bd ~ sn ~]'), 0, 0, 2)).toBe(true)
    expect(canResizeCell(grid('bd*4'), 0, 0, 2)).toBe(false)
  })
})
