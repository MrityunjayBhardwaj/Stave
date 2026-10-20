import { describe, it, expect } from 'vitest'

import { cellOn, isCellOn } from '../model'
import { parseStepGrid, parsePianoRoll, applyStepGain, applyRollGain } from '../parse'
import {
  serializeStepGrid,
  serializePianoRoll,
  serializeStepGain,
  serializeRollGain,
} from '../serialize'
import {
  scaleStepGrid,
  scalePianoRoll,
  canDoubleStepGrid,
  canHalveStepGrid,
  canDoublePianoRoll,
  canHalvePianoRoll,
  scaleStepGridTo,
  scalePianoRollTo,
  canScaleStepGridTo,
  canScalePianoRollTo,
  quantizeStepGridTo,
  quantizePianoRollTo,
  stepResolutionEffect,
  rollResolutionEffect,
  stepSlotState,
  rollSlotState,
  RESOLUTION_PRESETS,
  MAX_RESOLUTION_STEPS,
  freeZoneScale,
  collapseStepGridToDocument,
  collapsePianoRollToDocument,
} from '../resolution'
import { setColumnGain, setGroupGain } from '../../../visualEdit/panels/inspector'
import { toggleCell } from '../place'
import {
  MAX_VIEW_STEPS,
  UNREFINED,
  absorbViewScale,
  documentSteps,
} from '../viewResolution'
import type { StepGridModel, PianoRollModel, StepCell } from '../model'

/** serialize → assert the writer did not decline → return the string */
function ser(m: StepGridModel): string {
  const s = serializeStepGrid(m)
  expect(s, 'expected the grid writer not to decline').not.toBeNull()
  return s as string
}

/** parse → assert ok → return model */
function step(s: string): StepGridModel {
  const r = parseStepGrid(s)
  expect(r.ok, `expected ${s} to parse`).toBe(true)
  if (!r.ok) throw new Error('unreachable')
  return r.model
}
function roll(s: string): PianoRollModel {
  const r = parsePianoRoll(s)
  expect(r.ok, `expected ${s} to parse`).toBe(true)
  if (!r.ok) throw new Error('unreachable')
  return r.model
}

describe('#479 resolution — step grid ×2 / ÷2', () => {
  it('×2 splits each column, inserting empty odd columns (timing preserved)', () => {
    const m = scaleStepGrid(step('bd ~ sn ~ bd'), 'double')
    expect(m.steps).toBe(10)
    // `bd _`, not `bd ~` (#1010 P4c). ×2 promises "every hit keeps its position", and
    // [[PV240]] reads the length rule off that promise: the length SCALES with the grid, so
    // a note that was one of 5 columns is two of 10 — the same 1/5 of a cycle. The trailing
    // `_` is the printer spelling that sustain. The old `bd ~` re-derived the length from
    // the column and quietly halved every note the op claimed to leave alone.
    expect(serializeStepGrid(m)).toBe('bd _ ~ ~ sn _ ~ ~ bd _')
  })

  it('÷2 is NOT offered on a source-authored grid — it would lengthen every note', () => {
    // This used to halve `bd ~ ~ ~ sn ~ ~ ~ bd ~` to `bd ~ sn ~ bd` and call it the lossless
    // inverse. It is not the inverse of anything: the source wrote ten columns, so each note
    // sounds 1/10 of a cycle, and a 5-column grid can only spell 1/5. The old answer doubled
    // every note's length — invisibly, since the panel draws no duration axis (#1026).
    //
    // So the op is not offered here. The INVERSE claim is real and lives where it is true:
    // the acceptance test below round-trips ×2 then ÷2, because ×2 makes the notes two
    // columns long and ÷2 takes them back to one. `op-admissibility.test.ts` asserts that
    // over the whole corpus — every one of the 884 units ×2 applies to can be undone.
    const doubled = step('bd ~ ~ ~ sn ~ ~ ~ bd ~')
    expect(canHalveStepGrid(doubled)).toBe(false)
    expect(scaleStepGrid(doubled, 'halve')).toBe(doubled) // same reference → mutate skips
  })

  it('×2 then ÷2 returns the byte-identical source (acceptance)', () => {
    const src = 'bd ~ sn ~ bd'
    const round = serializeStepGrid(scaleStepGrid(scaleStepGrid(step(src), 'double'), 'halve'))
    expect(round).toBe(src)
  })

  it('×2 round-trips through parse (stable expanded form)', () => {
    const m = scaleStepGrid(step('bd hh sn'), 'double')
    const reparsed = step(ser(m))
    expect(serializeStepGrid(reparsed)).toBe(serializeStepGrid(m))
  })

  it('preserves multiple lanes when scaling', () => {
    const m = scaleStepGrid(step('bd hh bd hh'), 'double')
    expect(serializeStepGrid(m)).toBe('bd _ hh _ bd _ hh _') // lengths scale with the grid
  })
})

describe('#479 resolution — step grid ÷2 guards (honest, lossless-only)', () => {
  it('disables ÷2 when an odd column carries a hit (would drop it)', () => {
    expect(canHalveStepGrid(step('bd sn'))).toBe(false) // sn on col 1
    expect(canHalveStepGrid(step('bd hh sn hh'))).toBe(false)
  })

  it('an empty odd column is NECESSARY but no longer SUFFICIENT for ÷2', () => {
    // Structure alone used to decide, and `bd ~ sn ~` halved to `bd sn`. Both notes then
    // sounded twice as long, which is the one thing an op may not do to an axis the panel
    // cannot show (#1026). Admissibility is now asked of the real writer, so the structural
    // check is only half of it — see `ifGridSpellable`.
    expect(canHalveStepGrid(step('bd ~ sn ~'))).toBe(false)
    // …and it is TRUE exactly where halving does not lengthen anything: after a ×2, every
    // note is two columns long, so ÷2 returns it to one.
    expect(canHalveStepGrid(scaleStepGrid(step('bd ~ sn ~'), 'double'))).toBe(true)
    expect(
      serializeStepGrid(scaleStepGrid(scaleStepGrid(step('bd ~ sn ~'), 'double'), 'halve')),
    ).toBe('bd ~ sn ~')
  })

  it('disables ÷2 on an odd column count', () => {
    expect(canHalveStepGrid(step('bd ~ sn'))).toBe(false) // 3 columns
  })

  it('a non-applicable direction returns the SAME model (mutate skips the write)', () => {
    const m = step('bd sn')
    expect(scaleStepGrid(m, 'halve')).toBe(m)
  })

  it('caps ×2 at the column ceiling', () => {
    const wide: StepGridModel = {
      steps: MAX_RESOLUTION_STEPS,
      lanes: [{ sound: 'bd', cells: Array<StepCell>(MAX_RESOLUTION_STEPS).fill(false) }],
    }
    expect(canDoubleStepGrid(wide)).toBe(false)
    expect(scaleStepGrid(wide, 'double')).toBe(wide)
    expect(canDoubleStepGrid(step('bd ~ sn ~'))).toBe(true)
  })
})

describe('#479 resolution — step grid velocity scales with the grid', () => {
  it('×2 keeps each hit gain and inserts neutral odd columns', () => {
    // bd on cols 0 and 2, soft (0.5) and loud — a per-column .gain string.
    const base = applyStepGain(step('bd ~ bd ~'), { mini: '0.5 ~ 1 ~', numeric: null, foreign: false })
    const doubled = scaleStepGrid(base, 'double')
    expect(doubled.steps).toBe(8)
    expect(serializeStepGrid(doubled)).toBe('bd _ ~ ~ bd _ ~ ~') // lengths scale (#1010 P4c)
    // each hit keeps its gain (soft 0.5, neutral 1); the mini realigns to the
    // doubled columns, the inserted odd columns are rests.
    //
    // The SUSTAIN column carries a neutral `1` rather than `~`, because `serializeStepGain`
    // emits per COLUMN and a `_` is neither a hit nor a rest to it. Harmless — `.gain`
    // combines with `appLeft`, so it is sampled at the note's ONSET and the value under a
    // sustain is never read — and the round-trip below recovers `0.5 ~ 1 ~` exactly. Filed
    // as its own cleanup rather than fixed here: it is the gain writer's alignment rule, not
    // the resolution op's, and touching it would put this phase inside another gate.
    const g = serializeStepGain(doubled)
    expect(g.kind).toBe('write')
    if (g.kind === 'write') expect(g.value).toBe('0.5 1 ~ ~ 1 1 ~ ~')
  })

  it('÷2 round-trips a velocity grid back to source', () => {
    const base = applyStepGain(step('bd ~ bd ~'), { mini: '0.5 ~ 1 ~', numeric: null, foreign: false })
    const round = scaleStepGrid(scaleStepGrid(base, 'double'), 'halve')
    expect(serializeStepGrid(round)).toBe('bd ~ bd ~')
    expect(canHalveStepGrid(scaleStepGrid(base, 'double'))).toBe(true)
  })
})

describe('#479 resolution — piano roll ×2 / ÷2', () => {
  it('×2 scales start AND duration so onsets are preserved', () => {
    const m = scalePianoRoll(roll('c3 e3 g3'), 'double')
    expect(m.steps).toBe(6)
    expect(serializePianoRoll(m)).toBe('c3@2 e3@2 g3@2')
  })

  it('×2 doubles a held note span (@n → @2n)', () => {
    const m = scalePianoRoll(roll('c3@2 e3'), 'double')
    expect(serializePianoRoll(m)).toBe('c3@4 e3@2')
  })

  it('×2 then ÷2 returns the byte-identical source (acceptance)', () => {
    for (const src of ['c3 e3 g3', 'c3@2 e3', '~ c3 ~ e3']) {
      const round = serializePianoRoll(
        scalePianoRoll(scalePianoRoll(roll(src), 'double'), 'halve'),
      )
      expect(round, src).toBe(src)
    }
  })

  it('keeps a rest-led pattern aligned', () => {
    const m = scalePianoRoll(roll('~ c3'), 'double')
    expect(serializePianoRoll(m)).toBe('~ ~ c3@2')
  })
})

describe('#479 resolution — piano roll ÷2 guards', () => {
  it('disables ÷2 when a note starts on an odd column', () => {
    expect(canHalvePianoRoll(roll('~ c3'))).toBe(false) // starts at col 1
  })

  it('disables ÷2 when a note spans an odd number of columns', () => {
    // c3 dur 1, e3 dur 1 over 2 steps → durations odd → not halvable
    expect(canHalvePianoRoll(roll('c3 e3'))).toBe(false)
  })

  it('enables ÷2 when every note is even-aligned and even-length', () => {
    expect(canHalvePianoRoll(roll('c3@2 e3@2'))).toBe(true)
    expect(serializePianoRoll(scalePianoRoll(roll('c3@2 e3@2'), 'halve'))).toBe('c3 e3')
  })

  it('a non-applicable direction returns the SAME model', () => {
    const m = roll('c3 e3')
    expect(scalePianoRoll(m, 'halve')).toBe(m)
  })

  it('caps ×2 at the column ceiling', () => {
    const wide: PianoRollModel = { steps: MAX_RESOLUTION_STEPS, notes: [] }
    expect(canDoublePianoRoll(wide)).toBe(false)
    expect(scalePianoRoll(wide, 'double')).toBe(wide)
  })

  it('×2 carries per-note velocity unchanged', () => {
    const base = applyRollGain(roll('c3 e3'), { mini: '0.5 1', numeric: null, foreign: false })
    const doubled = scalePianoRoll(base, 'double')
    expect(doubled.notes.map((n) => n.gain ?? 1)).toEqual([0.5, 1])
    expect(serializePianoRoll(doubled)).toBe('c3@2 e3@2')
  })
})

describe('#479 resolution — absolute slot targets (the 4/8/16/32 control)', () => {
  it('the preset list is 4 / 8 / 16 / 32 / 64', () => {
    expect([...RESOLUTION_PRESETS]).toEqual([4, 8, 16, 32, 64])
  })

  it('step grid: scaling to a higher power-of-2 target doubles repeatedly', () => {
    const m4 = step('bd ~ sn ~') // 4 columns
    expect(serializeStepGrid(scaleStepGridTo(m4, 8))).toBe('bd _ ~ ~ sn _ ~ ~') // lengths scale
    expect(scaleStepGridTo(m4, 16).steps).toBe(16) // ×4
  })

  it('step grid: scaling DOWN a source-authored grid is not offered', () => {
    // Same reason ÷2 is not: 8→4 would double every note's length and 8→2 quadruple it,
    // on an axis the panel cannot show (#1026). Coarsening a grid the user WROTE is
    // therefore refused; coarsening one this control previously widened is not — the
    // round-trip case is asserted in the ×2/÷2 block above and corpus-wide in
    // `op-admissibility.test.ts`.
    const m8 = step('bd ~ ~ ~ sn ~ ~ ~') // 8 columns, hits on 0 and 4
    expect(canScaleStepGridTo(m8, 4)).toBe(false)
    expect(scaleStepGridTo(m8, 4)).toBe(m8)
    expect(scaleStepGridTo(m8, 2)).toBe(m8)
  })

  it('step grid: a non-power-of-2 ratio is unreachable (no re-timing)', () => {
    const m5 = step('bd ~ sn ~ bd') // 5 columns
    // 5 → 4 / 8 / 16 / 32 are none a power-of-2 ratio → every preset disabled
    for (const target of RESOLUTION_PRESETS) {
      expect(canScaleStepGridTo(m5, target), `5→${target}`).toBe(false)
      expect(scaleStepGridTo(m5, target)).toBe(m5)
    }
  })

  it('step grid: the current count is never offered (active, not clickable)', () => {
    const m8 = step('bd ~ ~ ~ sn ~ ~ ~')
    expect(canScaleStepGridTo(m8, 8)).toBe(false)
    expect(canScaleStepGridTo(m8, 16)).toBe(true)
    // 4 was `true` until #1010 P4c. Coarsening a SOURCE-authored grid would double every
    // note's length, so it is not offered — the case this test is about (the current count
    // being excluded) is the `8` above, and the widening `16` is its live counterpart.
    expect(canScaleStepGridTo(m8, 4)).toBe(false)
  })

  it('step grid: a target below a LOSSY column is disabled', () => {
    const dense = step('bd sd hh cp bd sd hh cp') // 8 cols, every column filled
    expect(canScaleStepGridTo(dense, 4)).toBe(false) // halving would drop hits
    expect(canScaleStepGridTo(dense, 16)).toBe(true) // doubling up is fine
    expect(scaleStepGridTo(dense, 4)).toBe(dense) // aborts to original
  })

  it('piano roll: scale up then back to source is byte-identical', () => {
    const m4 = roll('c3 e3 g3 a3') // 4 columns
    expect(serializePianoRoll(scalePianoRollTo(m4, 8))).toBe('c3@2 e3@2 g3@2 a3@2')
    const round = serializePianoRoll(scalePianoRollTo(scalePianoRollTo(m4, 8), 4))
    expect(round).toBe('c3 e3 g3 a3')
  })

  it('piano roll: a 3-note melody (non-power-of-2) disables every preset', () => {
    const m3 = roll('c3 e3 g3') // 3 columns
    for (const target of RESOLUTION_PRESETS) {
      expect(canScalePianoRollTo(m3, target), `3→${target}`).toBe(false)
    }
  })

  it('caps an upward target at the column ceiling', () => {
    const wide: StepGridModel = {
      steps: MAX_RESOLUTION_STEPS / 2,
      lanes: [{ sound: 'bd', cells: Array<StepCell>(MAX_RESOLUTION_STEPS / 2).fill(false) }],
    }
    // 128 → 256 is fine (== cap), but the doubling that would exceed it aborts.
    expect(scaleStepGridTo(wide, MAX_RESOLUTION_STEPS).steps).toBe(MAX_RESOLUTION_STEPS)
    expect(scaleStepGridTo(wide, MAX_RESOLUTION_STEPS * 2)).toBe(wide)
  })
})

describe('#479 quantize-set — reduce any pattern to any slot count', () => {
  it('step grid: at a lossless ratio, quantize and ×2 now DIFFER on length', () => {
    // This test used to assert the two agree. They no longer do, and both are right:
    // [[PV240]] reads each op's length rule off the promise that op already made, and the
    // two promises differ. ×2 preserves musical time, so the length SCALES
    // (`bd _ ~ ~ sn _ ~ ~`). Quantize REFINING keeps the slot count (#607: "do not stretch
    // into the widened gap"), so the length is KEPT (`bd ~ ~ ~ sn ~ ~ ~`). Same onsets,
    // different note lengths, from two controls a user might reasonably expect to agree —
    // recorded here rather than smoothed over, and filed for a product call.
    const m4 = step('bd ~ sn ~')
    expect(serializeStepGrid(quantizeStepGridTo(m4, 8))).toBe('bd ~ ~ ~ sn ~ ~ ~') // KEEP
    expect(serializeStepGrid(scaleStepGridTo(m4, 8))).toBe('bd _ ~ ~ sn _ ~ ~') // SCALE
    // COARSENING BACK DOWN is offered again (#1061) and lands on the round trip's start:
    // each note would go half a column, so it is held at one instead. Note this is the
    // inverse of the KEEP line above and not of the SCALE one — the two controls still
    // disagree on length, which is the divergence this test exists to record.
    const m8 = step('bd ~ ~ ~ sn ~ ~ ~')
    expect(serializeStepGrid(quantizeStepGridTo(m8, 4))).toBe('bd ~ sn ~')
    // and it costs LENGTH only: every onset stays exactly where it was, which is what lets
    // the control say "keeps timing" about a target it reaches through the quantize path.
    expect(stepResolutionEffect(m8, 4)).toEqual({ lengthened: 2, snapped: 0, merged: 0, shortened: 0 })
    // CONTROL — ×2 is untouched by the floor. It is the one control the free zone routes
    // through, and if this moved, the round trip above would no longer be a round trip.
    expect(scaleStepGridTo(m8, 4)).toBe(m8)
  })

  it('step grid: a NON-power-of-2 REDUCE is offered, and it DOES lengthen every note', () => {
    // 5 → 4 snaps bd@0→0, sn@2→2, bd@4→3 and emits `bd ~ sn bd`. The onsets move (5/4 is
    // not a whole ratio) and every length would be 4/5 of a column — under P4c that made
    // the op decline; under #1061 each is held at one column instead. The title used to say
    // "it would lengthen every note" as the REASON FOR REFUSING. That is now the feature:
    // the grid cannot say four-fifths of a column, so it says the shortest thing it can and
    // the control tells the user both costs before they press it.
    const m5 = step('bd ~ sn ~ bd')
    expect(serializeStepGrid(quantizeStepGridTo(m5, 4))).toBe('bd ~ sn bd')
    // all three notes floored, and two onsets genuinely moved — so this target is described
    // as changing timing AND lengths, where 8→4 above changes only lengths. The two cases
    // must not collapse into one label.
    expect(stepResolutionEffect(m5, 4)).toEqual({ lengthened: 3, snapped: 2, merged: 0, shortened: 0 })
    // CONTROL — REFINING is unaffected. It keeps the slot count (#607), so no length ever
    // approaches the floor and nothing is reported.
    expect(quantizeStepGridTo(m5, 16)).not.toBe(m5)
    expect(serializeStepGrid(quantizeStepGridTo(m5, 16))).not.toBeNull()
    expect(stepResolutionEffect(m5, 16).lengthened).toBe(0)
  })

  it('step grid: a lossy reduce writes, and every note it floored is reported', () => {
    // The merge rule itself is unchanged and still right (collide → keep the SHORTEST, so a
    // merged note never sounds longer than one it stands for). What changed is the fate of
    // the lengths afterwards: scaled by 4/8 they land at half a column, and rather than
    // declining the whole write, each is held at one column (#1061).
    //
    // This is the most destructive shape the control offers — eight hits into four columns,
    // stacking three sounds in the last — so it is the one that most needs the user warned,
    // and every field of the report is non-zero here except `merged`: the collisions are
    // between DIFFERENT lanes, which stack rather than merge.
    const dense = step('bd sd hh cp bd sd hh cp')
    expect(ser(quantizeStepGridTo(dense, 4))).toBe('bd [sd,hh] [bd,cp] [sd,hh,cp]')
    expect(stepResolutionEffect(dense, 4)).toEqual({ lengthened: 8, snapped: 4, merged: 0, shortened: 0 })
    // CONTROL — REFINING the same grid is still offered and still writes 16 columns.
    expect(ser(quantizeStepGridTo(dense, 16)).split(' ').length).toBe(16)
    expect(stepResolutionEffect(dense, 16).lengthened).toBe(0)
  })

  it('step grid: the floor is COARSENING-ONLY — refining a sub-column note still declines', () => {
    // THE ARM ABOVE CANNOT CATCH A FLOOR THAT LEAKED INTO REFINING, and neither can any
    // assertion of the form `lengthened === 0`: a declined op reports zeros, so a zero is
    // equally consistent with "nothing was floored" and "nothing happened at all". That is
    // the same shape as a `toBeDisabled()` with no live control beside it.
    //
    // So this asserts the DECLINE itself, which a leak turns into an apply: a half-column
    // note has no grid spelling, so refining leaves the model alone; floor it and the
    // result becomes spellable and the op starts writing, which `toBe(sub)` catches.
    //
    // BUILT BY HAND, and that is not laziness. The reader opens a nested `[hh ~]` AT the
    // finer resolution, so a parsed single-bar grid never carries a length below one column
    // — and the minis that do (`@0.5` weights) come back multi-bar, which routes around the
    // floor entirely. The only way to stand this case up is to construct it.
    const sub: StepGridModel = {
      steps: 2,
      lanes: [{ sound: 'bd', cells: [cellOn(0.5), false] }],
    }
    expect(sub.lanes[0].cells.some((c) => isCellOn(c) && c.duration < 1)).toBe(true) // guard
    expect(quantizeStepGridTo(sub, 4)).toBe(sub)
    expect(stepResolutionEffect(sub, 4)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('piano roll: a non-power-of-2 reduce snaps notes and always serializes', () => {
    // 3 → 4 (finer, non-divisor): each note snaps onto the 4-grid
    expect(serializePianoRoll(quantizePianoRollTo(roll('c3 e3 g3'), 4))).not.toBeNull()
  })

  // #1933 — the roll's Slots control asks the same question the step grid's does: what will
  // this press cost? The answer comes from the op the press runs, counted where it happens.
  it('piano roll: a non-power-of-2 reduce reports the onsets it moves and the notes it lengthens', () => {
    // 5 → 4: four of the five onsets fall between the new columns, and every 4/5-column
    // length is held at one column. g3 and a3 share a column as a chord: different
    // pitches, so that is not a merge.
    const m5 = roll('c3 e3 g3 a3 b3')
    expect(serializePianoRoll(quantizePianoRollTo(m5, 4))).toBe('c3 e3 [g3,a3] b3')
    expect(rollResolutionEffect(m5, 4)).toEqual({ lengthened: 5, snapped: 4, merged: 0, shortened: 0 })
  })

  it('piano roll: a reduce that moves no onset reports length only', () => {
    // every note already sits on a column of the 4-grid; each half-column length is held
    // at one, so this target keeps timing and makes notes longer
    const m8 = roll('c3 ~ e3 ~ g3 ~ a3 ~')
    expect(serializePianoRoll(quantizePianoRollTo(m8, 4))).toBe('c3 e3 g3 a3')
    expect(rollResolutionEffect(m8, 4)).toEqual({ lengthened: 4, snapped: 0, merged: 0, shortened: 0 })
  })

  it('piano roll: two notes of one pitch landing on one column are a merge', () => {
    const m = roll('c3 c3 e3 e3')
    expect(serializePianoRoll(quantizePianoRollTo(m, 2))).toBe('c3 [c3,e3]')
    expect(rollResolutionEffect(m, 2)).toEqual({ lengthened: 3, snapped: 2, merged: 1, shortened: 0 })
  })

  it('piano roll: refining keeps each slot count, so it can move onsets but lengthens nothing', () => {
    expect(rollResolutionEffect(roll('c3 e3 g3'), 4)).toEqual({ lengthened: 0, snapped: 2, merged: 0, shortened: 0 })
  })

  // #1948 — a press can also make a note SHORTER, and nothing said so. Counted on the note
  // the column keeps, against the length it should have had on the new grid.
  it('step grid: a note cut to the next onset that snapped closer is reported shorter', () => {
    // 3 → 2: `bd@2` should be 4/3 of a column, the second hit snaps to column 1, and
    // `clampLane` cuts the first note to the one column before it. The other two costs are
    // the second hit's: its onset moved (2/3 → 1) and its 2/3 length was floored to 1.
    const m = step('bd@2 bd')
    expect(ser(quantizeStepGridTo(m, 2))).toBe('bd bd')
    expect(stepResolutionEffect(m, 2)).toEqual({ lengthened: 1, snapped: 1, merged: 0, shortened: 1 })
    // CONTROL — the same press on hits that keep their room cuts nothing: `bd ~ ~ ~ sn ~ ~ ~`
    // above floors both notes and reports `shortened: 0`, so a count that fired on every
    // coarsening could not pass both arms.
  })

  it('piano roll: a length rounded down to whole columns is reported shorter', () => {
    // The issue's own case: `c3@2` scales to 4/3 of a column and is written as 1.
    const m = roll('c3@2 e3')
    expect(serializePianoRoll(quantizePianoRollTo(m, 2))).toBe('c3 e3')
    expect(rollResolutionEffect(m, 2)).toEqual({ lengthened: 1, snapped: 1, merged: 0, shortened: 1 })
  })

  it('piano roll: refining can shorten too — a chord shares its shortest length', () => {
    // 3 → 4 keeps every slot count (#607), but `g3@3` snaps onto `c3`'s column and the
    // chord is written with one length, `c3`'s 1. Nothing is lengthened and the press is a
    // FINER grid, so a count that only ran when coarsening would miss it.
    const m = roll('c3 e3@2, g3@3')
    expect(serializePianoRoll(quantizePianoRollTo(m, 4))).toBe('[c3,g3] e3@2 ~')
    expect(rollResolutionEffect(m, 4)).toEqual({ lengthened: 0, snapped: 1, merged: 0, shortened: 1 })
  })

  it('piano roll: a quantize that moves nothing reports nothing, and still writes', () => {
    // 6 → 4 is not a power-of-2 ratio, so it is a quantize; but both onsets and both
    // lengths land on whole columns of the new grid. The write is asserted, so the zeros
    // are a measurement and not a declined op.
    const m = roll('c3@3 e3@3')
    expect(rollSlotState(m, 4)).toBe('quantize')
    const out = quantizePianoRollTo(m, 4)
    expect(out).not.toBe(m)
    expect(serializePianoRoll(out)).toBe('c3@2 e3@2')
    expect(rollResolutionEffect(m, 4)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('piano roll: a declined op reports nothing', () => {
    const m = roll('c3 e3 g3 a3')
    expect(quantizePianoRollTo(m, 4)).toBe(m)
    expect(rollResolutionEffect(m, 4)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('piano roll: REDUCES the long 64-step choir melody to 16 without dropping the write', () => {
    const choir =
      '~ ~ ~ ~ ~ ~ ~ ~ [e4,d5]@4 d5 ~ ~ ~ [g4,a#4]@2 d5 ~ ~ [f5,c#4] ~ ~ b4@4 g4 ~ ~ ~ [c5,d4]@4 e5 ~ f#5 ~ [b4,d4]@2 f5 ~ ~ c5 ~ ~ [g4,a4]@3 d5 ~ ~ ~ d5 e4@8'
    const m = roll(choir)
    expect(m.steps).toBe(64)
    const out = quantizePianoRollTo(m, 16)
    expect(out.steps).toBe(16)
    const s = serializePianoRoll(out)
    expect(s, 'reduced melody must serialize (no silent drop)').not.toBeNull()
    // every note lands on the 16-grid, in range, no overlap (buildGroups would null otherwise)
    expect(out.notes.every((n) => n.start >= 0 && n.start + n.duration <= 16)).toBe(true)
  })

  it('piano roll: ADDING slots keeps each note a single slot — no stretch (#607)', () => {
    // the old resolution-doubling stretched durations (`c3@2 e3@2 g3@2 a3@2`);
    // now a 1-slot note stays 1 slot, repositioned proportionally — onsets are
    // preserved and the freed grid shows as gaps.
    expect(serializePianoRoll(quantizePianoRollTo(roll('c3 e3 g3 a3'), 8))).toBe(
      'c3 ~ e3 ~ g3 ~ a3 ~',
    )
  })

  it('piano roll: ADDING slots keeps a held note its slot-count, not its proportion (#607)', () => {
    // c3 holds 2 of 3 slots, e3 the last. 3 → 6: c3 stays @2 (does NOT scale to
    // @4), e3 stays 1 slot; both onsets map proportionally (0 and 2/3 → 0 and 4/6).
    const out = quantizePianoRollTo(roll('c3@2 e3'), 6)
    const c3 = out.notes.find((n) => n.pitch === 'c3')!
    const e3 = out.notes.find((n) => n.pitch === 'e3')!
    expect([c3.start, c3.duration]).toEqual([0, 2]) // kept slot-count, onset preserved
    expect([e3.start, e3.duration]).toEqual([4, 1]) // proportional reposition, 1 slot
  })

  it('piano roll: REDUCING slots still scales duration down (stays in range, #607)', () => {
    // the conservative rule is increase-only; a coarsen still shrinks durations
    // so a held note can't run past the smaller grid.
    const out = quantizePianoRollTo(roll('c3@4 e3@4'), 4) // 8 → 4
    expect(out.notes.every((n) => n.start + n.duration <= 4)).toBe(true)
  })

  it('piano roll: ADDING slots on a MULTI-BAR grid is conservative too (#607)', () => {
    const m = roll('<c3 e3>') // multi-bar alternation
    expect((m.bars ?? 1) > 1).toBe(true) // guard: this exercises the multi-bar branch
    const out = quantizePianoRollTo(m, m.steps * 2) // pow-of-2 increase
    expect(out.steps).toBe(m.steps * 2)
    expect(out.bars).toBe(m.bars) // bars preserved
    // every note keeps its slot-count duration (no stretch), starts double, all
    // stay in range, and it still serializes (no off-bar / overlap drop).
    out.notes.forEach((n, i) => {
      expect(n.duration).toBe(m.notes[i].duration)
      expect(n.start).toBe(m.notes[i].start * 2)
    })
    expect(out.notes.every((n) => n.start + n.duration <= out.steps)).toBe(true)
    expect(serializePianoRoll(out)).not.toBeNull()
  })

  it('quantize is a no-op for the current count', () => {
    const m = step('bd ~ sn ~')
    expect(quantizeStepGridTo(m, 4)).toBe(m)
  })

  it('slot state classifies active / lossless / quantize / disabled', () => {
    const m5 = step('bd ~ sn ~ bd') // 5 cols (non-power-of-2)
    expect(stepSlotState(m5, 5)).toBe('active')
    // REFINING at a non-power-of-2 ratio is a quantize and is still offered: it keeps each
    // note's column count (#607), so nothing becomes unspellable.
    expect(stepSlotState(m5, 8)).toBe('quantize')
    // COARSENING is `quantize` again (#1061). It went `disabled` under P4c because 5→4
    // scales every length by 4/5 and the grid can only spell whole columns, so the op
    // declined — and a control whose op declines must not be offered. The floor makes the
    // op apply, so the control is offered again. What has NOT changed is that
    // `stepSlotState` asks the op rather than predicting it: this reads `quantize` because
    // `quantizeStepGridTo` now returns something, not because anything here was widened.
    expect(stepSlotState(m5, 4)).toBe('quantize')
    // CONTROL — a target the op still declines is still `disabled`, so the line above is
    // "the op applies here" and not "coarsening is always offered now". `bd _ _ ~ …` has a
    // three-column note that scales to 1.5, which the floor does not touch and the grid
    // cannot spell.
    expect(stepSlotState(step('bd _ _ ~ sn ~ ~ ~'), 4)).toBe('disabled')
    const m4 = step('bd ~ sn ~')
    expect(stepSlotState(m4, 4)).toBe('active')
    expect(stepSlotState(m4, 8)).toBe('lossless') // power-of-2 ratio
    expect(rollSlotState(roll('c3 e3 g3'), 8)).toBe('quantize') // 3→8 not power-of-2
  })

  it('multi-bar grids stay lossless-only (quantize would not bar-align)', () => {
    const mb = step('<bd sn>') // bars 2
    // a lossy target is disabled rather than quantized for multi-bar
    expect(stepSlotState(mb, 4)).not.toBe('quantize')
  })
})

/* ── the free zone (#1057) ───────────────────────────────────────────────── */

describe('free zone — refining is a view change, not a rewrite', () => {
  /** a prover that says every scale draws — stands in for a cooperative parser */
  const draws = (): boolean => true
  /** a prover that refuses everything — stands in for the projections of #1117 */
  const refuses = (): boolean => false

  it('freeZoneScale admits whole multiples at or above the document, and nothing else', () => {
    expect(freeZoneScale(4, 4)).toBe(UNREFINED) // the document itself — how you come back
    expect(freeZoneScale(4, 8)).toBe(2)
    expect(freeZoneScale(4, 16)).toBe(4)
    expect(freeZoneScale(4, 64)).toBe(16)
    expect(freeZoneScale(4, 2)).toBeNull() // COARSER — this one edits your document
    expect(freeZoneScale(5, 8)).toBeNull() // not a whole multiple: 8/5 is not a view
    expect(freeZoneScale(3, 8)).toBeNull()
    expect(freeZoneScale(4, MAX_VIEW_STEPS * 2)).toBeNull() // past the VIEW ceiling
    expect(freeZoneScale(0, 8)).toBeNull()
  })

  it('THE REPORTED DEFECT: "bd ~ sn ~" + Slots 16 is a view, not a rewrite', () => {
    // The issue's own example. Before #1057 this returned `lossless` and wrote
    // `bd ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~` — fifteen tokens for a preference.
    const m = step('bd ~ sn ~')
    expect(stepSlotState(m, 16, draws)).toBe('view')
    expect(stepSlotState(m, 8, draws)).toBe('view')
    expect(stepSlotState(m, 32, draws)).toBe('view')
    // and the document is untouched by asking: the state is a pure question
    expect(ser(m)).toBe('bd ~ sn ~')
  })

  it('THE PROOF IS REQUIRED: a refused view falls through to the writing path', () => {
    // This is the whole reason `canDrawView` exists. Four projections refuse a finer
    // view (#1117); offering one on arithmetic alone ships a button that does nothing.
    const m = step('bd ~ sn ~')
    expect(stepSlotState(m, 16, refuses)).toBe('lossless')
    // …and with no prover at all, the free zone does not exist — which is what keeps
    // every pre-#1057 caller behaving exactly as it did.
    expect(stepSlotState(m, 16)).toBe('lossless')
  })

  it('the free zone is taken off the writing path BEFORE lossless, not after', () => {
    // Ordering is the phase. `bd ~ sn ~` → 8 is BOTH a whole multiple and a
    // power-of-2 ratio, so whichever branch runs first decides whether the user's
    // file is rewritten. It must be the view.
    const m = step('bd ~ sn ~')
    expect(canScaleStepGridTo(m, 8)).toBe(true) // the writing path would take it…
    expect(stepSlotState(m, 8, draws)).toBe('view') // …and does not get the chance
  })

  it('a target BELOW the document is never a view — the free zone cannot reach it', () => {
    const m8 = step('bd ~ ~ ~ sn ~ ~ ~')
    expect(freeZoneScale(8, 4)).toBeNull()
    // Whatever the writing path decides, it must not be `view`. Note what makes this
    // one a write: `m8` IS the document, so 4 is below its own column count. The rule
    // is NOT "downward is a write" — see the bidirectional test below, where ÷2 from a
    // refined view is free all the way back to the document. The boundary is the
    // document's own count, and direction of travel has nothing to do with it.
    expect(stepSlotState(m8, 4, draws)).not.toBe('view')
    // OBSERVED, and it belongs to #1061 rather than here: this particular coarsening
    // is `disabled`, because halving scales each cell to half a column and P4c's
    // printer preserves length, so the writer declines and an honest control says so.
    // Recorded to show the free zone left this path exactly as it found it.
    expect(stepSlotState(m8, 4, draws)).toBe(stepSlotState(m8, 4))
  })

  it('THE ZONE BOUNDARY DOES NOT MOVE WITH THE USER — it sits at the document count', () => {
    // The half that is easy to get wrong, and the reason ÷2 is not one control but two.
    // "Up is a view, down is a write" is the natural model and it is false: descending
    // through a refined view is free all the way back to the document, and only a target
    // strictly BELOW the document's own count is an edit. So the deciding fact is not
    // which way the user is travelling — it is where they are standing relative to what
    // their file actually spells. Measured over every standing a user can occupy (#1059):
    // ÷2 staying at-or-above the document is 2613 grid / 1438 roll offers, ALL free, not
    // one write leaking into the descent; ÷2 below it is 546 of 546 disabled on the grid.
    const mini = 'bd ~ sn ~' // a 4-column DOCUMENT, whatever we are looking at it through
    const standings = [1, 2, 4].map((k) => {
      const r = parseStepGrid(mini, k)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      return r.model
    })
    // the document never moves, however finely we draw it
    expect(standings.map(documentSteps)).toEqual([4, 4, 4])
    expect(standings.map((m) => m.steps)).toEqual([4, 8, 16])

    for (const m of standings) {
      // BELOW the document: refused from every standing, at the same place each time
      expect(stepSlotState(m, 2, draws)).not.toBe('view')
      // AT or ABOVE it: free from every standing — including 4, which is a DESCENT
      // from the ×2 and ×4 standings and an `active` no-op from the document itself
      expect(stepSlotState(m, 8, draws)).toBe(m.steps === 8 ? 'active' : 'view')
      expect(stepSlotState(m, 4, draws)).toBe(m.steps === 4 ? 'active' : 'view')
    }
  })

  it('a target already being looked at stays `active`, at any scale', () => {
    // `model.steps` is what is DRAWN, so the live preset is the drawn count.
    const drawn = parseStepGrid('bd ~ sn ~', 4)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) throw new Error('unreachable')
    expect(drawn.model.steps).toBe(16)
    expect(documentSteps(drawn.model)).toBe(4) // …but the DOCUMENT still spells 4
    expect(stepSlotState(drawn.model, 16, draws)).toBe('active')
    // and every other preset is reached from the DOCUMENT's 4, not from the drawn 16 —
    // including coming back down, which is why `freeZoneScale(D, D)` is UNREFINED
    expect(stepSlotState(drawn.model, 4, draws)).toBe('view')
    expect(stepSlotState(drawn.model, 8, draws)).toBe('view')
  })

  it('MULTI-BAR GAINS A REFINE it never had (stated, per #1057)', () => {
    const mb = step('<bd sn>')
    // Before: every non-power-of-2 target was `disabled` and refines wrote. A whole
    // multiple is now a view for multi-bar too — the branch that disables it is below
    // the free zone, and only non-multiples still reach it.
    const D = documentSteps(mb)
    expect(freeZoneScale(D, D * 2)).toBe(2)
    expect(stepSlotState(mb, D * 2, draws)).toBe('view')
  })

  it('the roll behaves identically — one rule, both surfaces', () => {
    const r = roll('c3 ~ e3 ~')
    expect(rollSlotState(r, 16, draws)).toBe('view')
    expect(rollSlotState(r, 16, refuses)).toBe('lossless')
    expect(rollSlotState(r, 16)).toBe('lossless')
  })

  it('A WRITE FROM A REFINED VIEW PRODUCES THE DOCUMENT-DERIVED RESULT', () => {
    // The one path where a presentational parameter could still reach a write:
    // coarsening is NOT in the free zone, so it runs the real op against the model
    // the panel is holding — and while refined, that model is the DRAWN one.
    //
    // The claim is that this is safe because a refinement is an exact k× embedding
    // and the ops are ratio-based: a hit at document column c sits at k·c when
    // drawn, and `round(k·c · t / (k·D)) === round(c · t / D)`. Claimed arithmetic is
    // not evidence, so it is asserted — if it were false, which document you got
    // would depend on how closely you were looking when you asked.
    // ⚠ THE FIXTURE IS LOAD-BEARING, AND THE SURFACE IS TOO — both found by measuring
    // rather than by choosing. The first version used the obvious `bd ~ ~ ~ sn ~ ~ ~`
    // and was VACUOUS: its only non-free target is 4, coarsening one-column notes
    // declines (the #1061 class), so the loop compared nothing and passed. The
    // count at the end is what caught it.
    //
    // The repair is not a different grid, because on the GRID the path turns out to
    // be unreachable: a grid with notes long enough to coarsen cleanly is spelled
    // with `_`, and a pattern carrying sustains does not refine at all — so
    // "refinable" and "has a writing coarsening" have empty intersection there. The
    // roll has both, which makes it the honest place to assert this.
    const src = 'c3@2 e3@2 g3@2 a3@2' // 8 columns, notes two columns long
    const doc = roll(src)
    expect(documentSteps(doc)).toBe(8)

    const refined = parsePianoRoll(src, 2)
    expect(refined.ok).toBe(true)
    if (!refined.ok) throw new Error('unreachable')
    expect(refined.model.steps).toBe(16) // drawn twice as finely…
    expect(documentSteps(refined.model)).toBe(8) // …over the same document

    let compared = 0
    for (const target of RESOLUTION_PRESETS) {
      if (freeZoneScale(8, target) !== null) continue // free targets never write
      const fromDoc = quantizePianoRollTo(doc, target)
      const fromView = quantizePianoRollTo(refined.model, target)
      const declinedDoc = fromDoc === doc
      const declinedView = fromView === refined.model
      expect(declinedView, `@${target}: the two paths must agree on whether to write`).toBe(
        declinedDoc,
      )
      if (declinedDoc) continue
      compared++
      expect(
        serializePianoRoll(fromView),
        `@${target}: a write must not depend on the view scale`,
      ).toBe(serializePianoRoll(fromDoc))
    }
    // …and the comparison was actually REACHED. Without this the whole loop passes
    // by declining everything, which is the same vacuous green the corpus gate's
    // population floor exists to prevent.
    expect(compared, 'at least one real write must have been compared').toBeGreaterThan(0)
  })

  it('absorbViewScale drops the marker a write makes untrue, and only then', () => {
    const plain = step('bd ~ sn ~')
    expect(absorbViewScale(plain)).toBe(plain) // nothing to absorb → same reference
    const drawn = parseStepGrid('bd ~ sn ~', 2)
    if (!drawn.ok) throw new Error('unreachable')
    expect(drawn.model.viewScale).toBe(2)
    const written = absorbViewScale(drawn.model)
    expect(written.viewScale).toBeUndefined()
    // the SHAPE is untouched — absorbing is a change of claim, not of content
    expect(written.steps).toBe(drawn.model.steps)
    expect(documentSteps(written)).toBe(written.steps) // …and the claim is now true
    expect(serializeStepGrid(written)).toBe(serializeStepGrid(drawn.model))
  })
})

describe('a write spells the refinement only when it needs to', () => {
  /**
   * The free zone stops a VIEW preference reaching the document. This is the other
   * half: once the user does make a real edit while refined, only an edit that used
   * a column the document does not have may respell the file. A velocity drag must
   * not — it changes `gain` and moves no onset.
   */
  it('THE DEFECT: a gain-only edit at a refined view must not respell the document', () => {
    const drawn = parseStepGrid('bd ~ sn ~', 2)
    if (!drawn.ok) throw new Error('unreachable')
    const gained = setColumnGain(drawn.model, 0, 0.42)

    // ⚠ THIS USED TO BE TWO RANGES AND #1123 CLOSED ONE OF THEM. The uncollapsed write
    // respelled the NOTATION (`bd _ ~ ~ sn _ ~ ~`) *and* widened the `.gain` mini to
    // match. The notation half is now safe on its own — a gain edit no longer costs the
    // splice — so what remains for the collapse to prevent is the gain range alone.
    expect(serializeStepGrid(gained), 'the notation is already safe (#1123)').toBe('bd ~ sn ~')
    expect(serializeStepGain(gained), 'but the gain is still at the DRAWN width').toEqual({
      kind: 'write',
      value: '0.42 1 ~ ~ 1 1 ~ ~',
      quoted: true,
    })

    const atDoc = collapseStepGridToDocument(gained)
    expect(atDoc, 'a gain change stays on the document grid').not.toBeNull()
    expect(serializeStepGrid(atDoc as StepGridModel)).toBe('bd ~ sn ~')
    // the gain range collapses WITH the notation — they must agree about the
    // document's resolution, which is exactly what they did not do
    expect(serializeStepGain(atDoc as StepGridModel)).toEqual(
      serializeStepGain(setColumnGain(step('bd ~ sn ~'), 0, 0.42)),
    )
    // …and the collapsed model no longer claims to be drawn finer than the file
    expect((atDoc as StepGridModel).viewScale).toBeUndefined()
  })

  /**
   * ⚠ EVERY CASE AROUND THIS ONE USES `bd ~ sn ~`, AND THAT IS WHY #1121 SHIPPED.
   * A flat pattern spells its own content uniquely, so flattening it is the identity
   * and a round trip over it cannot fail a spelling assertion even in principle. The
   * cases below use fixtures whose REPRESENTATION can differ from their VALUE —
   * grouping, an operator, a stack, an alternation — which is the only kind of input
   * on which "the document comes back as the user wrote it" says anything at all.
   *
   * What went wrong: the collapse de-scaled the model's cells and left the SOURCE
   * description at the refined resolution, so the writer no longer recognised it and
   * fell to the flat rebuild — right column count, right notes, wrong spelling.
   */
  it.each([
    ['a group', 'bd [hh hh] sn ~'],
    ['an operator', 'bd hh*2 sn cp'],
    ['a repeat', 'bd*3 sn'],
    ['nested rests', '[- - - -] [cp - - -] [- - - -] [~ cp - -]'],
    ['a `,`-stack whose parts have different widths', 'bd sd, hh*4'],
    ['an alternation as an element', '<bd sn> hh'],
  ])('an unmodified round trip returns the document verbatim — %s', (_shape, mini) => {
    const drawn = parseStepGrid(mini, 2)
    if (!drawn.ok) throw new Error('unreachable')
    const atDoc = collapseStepGridToDocument(drawn.model)
    expect(atDoc, 'an untouched refine always collapses').not.toBeNull()
    expect(serializeStepGrid(atDoc as StepGridModel)).toBe(mini)
  })

  it('the roll keeps its own spelling too — one rule, both surfaces', () => {
    const mini = 'c3 [e3 g3] c4@2'
    const drawn = parsePianoRoll(mini, 2)
    if (!drawn.ok) throw new Error('unreachable')
    const atDoc = collapsePianoRollToDocument(drawn.model)
    expect(atDoc).not.toBeNull()
    expect(serializePianoRoll(atDoc as PianoRollModel)).toBe(mini)
  })

  /**
   * The equivalence form #1121 asks for, at module scale: not "the document did not
   * change" — a collapse that did nothing would satisfy that — but "the same edit,
   * made plainly and made through a refined view, writes the same bytes".
   */
  it('the same edit spells the same either way', () => {
    const mini = 'bd [hh hh] sn cp'
    const plain = parseStepGrid(mini)
    const drawn = parseStepGrid(mini, 2)
    if (!plain.ok || !drawn.ok) throw new Error('unreachable')

    // erase the `bd`: document column 0, drawn column 0 — an edit that introduces no
    // length, so it stays on the document's grid at both scales
    const erasedPlain = toggleCell(plain.model, 0, 0, false)
    const erasedDrawn = toggleCell(drawn.model, 0, 0, false)
    expect(erasedPlain).not.toBe(plain.model)
    expect(erasedDrawn).not.toBe(drawn.model)

    const atDoc = collapseStepGridToDocument(erasedDrawn)
    expect(atDoc, 'an erase never needs the finer grid').not.toBeNull()
    expect(serializeStepGrid(atDoc as StepGridModel)).toBe(serializeStepGrid(erasedPlain))
    // and the surviving group is still a group, which is the whole point
    expect(serializeStepGrid(atDoc as StepGridModel)).toContain('[hh hh]')
  })

  it('an edit that USES a view-only column still spells the finer grid', () => {
    const drawn = parseStepGrid('bd ~ sn ~', 2)
    if (!drawn.ok) throw new Error('unreachable')
    // drawn column 1 exists only at ×2 — the whole reason to refine
    const placed = toggleCell(drawn.model, 0, 1, true)
    expect(placed).not.toBe(drawn.model)
    expect(collapseStepGridToDocument(placed), 'this one NEEDS the finer spelling').toBeNull()
    expect(serializeStepGrid(placed)).toBe('[bd bd] ~ sn ~')
  })

  it('NOTE LENGTH is what discriminates, not the column index', () => {
    // drawn column 2 IS a document column boundary (2/8 === 1/4), so an index rule
    // would call this collapsible. It is not: the placed note is one drawn column
    // long, and no column the document can spell is that short.
    const drawn = parseStepGrid('bd ~ sn ~', 2)
    if (!drawn.ok) throw new Error('unreachable')
    const placed = toggleCell(drawn.model, 0, 2, true)
    expect(collapseStepGridToDocument(placed)).toBeNull()
    expect(serializeStepGrid(placed)).toBe('bd [bd ~] sn ~')
  })

  it('an UNREFINED model is returned unchanged — every pre-#1057 caller lands here', () => {
    const plain = step('bd ~ sn ~')
    expect(collapseStepGridToDocument(plain)).toBe(plain) // same reference
    const r = roll('c3 ~ e3 ~')
    expect(collapsePianoRollToDocument(r)).toBe(r)
  })

  it('the roll behaves identically — one rule, both surfaces', () => {
    const drawn = parsePianoRoll('c3 ~ e3 ~', 2)
    if (!drawn.ok) throw new Error('unreachable')
    const gained = setGroupGain(drawn.model, drawn.model.notes[0].start, 0.42)
    // the roll's half of the same split (#1123): notation safe, gain still drawn-width
    expect(serializePianoRoll(gained)).toBe('c3 ~ e3 ~')
    expect(serializeRollGain(gained)).toEqual({
      kind: 'write',
      value: '0.42@2 ~ ~ 1@2 ~ ~',
      quoted: true,
    })
    const atDoc = collapsePianoRollToDocument(gained)
    expect(atDoc).not.toBeNull()
    expect(serializePianoRoll(atDoc as PianoRollModel)).toBe('c3 ~ e3 ~')
    expect((atDoc as PianoRollModel).notes[0].gain).toBe(0.42) // the edit survived

    // a note starting on a view-only column cannot be said at the document's grid
    const odd = {
      ...drawn.model,
      notes: [...drawn.model.notes, { pitch: 'd3', start: 1, duration: 1 }],
    }
    expect(collapsePianoRollToDocument(odd)).toBeNull()
  })

  /**
   * The write half is only sound if the READ half agrees: `.gain` is written at the
   * resolution the notation is written at, so a model drawn k× finer has to expand
   * the document's tokens rather than demand `model.steps` of them. Asking for the
   * drawn count made an ordinary gain FOREIGN the moment the user refined, which
   * retires the velocity lane for as long as they stay zoomed in — and the round
   * trip then silently stops working, because a foreign gain is never written back.
   */
  it('both surfaces read their own `.gain` back while refined', () => {
    const docGain = { mini: '0.5 ~ 1 ~', numeric: null, foreign: false }

    const grid = parseStepGrid('bd ~ sn ~', 2)
    if (!grid.ok) throw new Error('unreachable')
    const gGained = applyStepGain(grid.model, docGain)
    expect(gGained.gainForeign, 'a 4-token gain on an 8-column view is not foreign').toBeUndefined()
    // the value lands on the column that STARTS the note; the rest stay neutral,
    // which is what keeps the model collapsible (a non-neutral sustain column
    // reads to the ÷k guard as data it would drop)
    expect(gGained.gains?.[0]).toBe(0.5)
    expect(gGained.gains?.[1]).toBe(1)
    expect(collapseStepGridToDocument(gGained), 'and it still collapses').not.toBeNull()

    const roll = parsePianoRoll('c3 ~ e3 ~', 2)
    if (!roll.ok) throw new Error('unreachable')
    const rGained = applyRollGain(roll.model, docGain)
    expect(rGained.gainForeign, 'the roll cursor walks in document columns').toBeUndefined()
    // 0.5 belongs to `c3`, and `c3` sits at drawn column 0 — if the cursor stepped
    // by 1 instead of k the gain would land on a column no note starts at, and the
    // whole gain would be handed off as foreign
    expect(rGained.notes[0].gain).toBe(0.5)
    expect(rGained.notes[1].gain).toBeUndefined()
    expect(collapsePianoRollToDocument(rGained)).not.toBeNull()
  })
})

/**
 * #1239 — the resolution fold must REFUSE, never throw.
 *
 * `parsePianoRoll("1*1, 2*2, … 43*43")` used to raise
 * `RangeError: Maximum call stack size exceeded`. `gcd` was recursive Euclid and
 * `lcm` folds across parts; past the safe-integer range the operands stop being
 * exact integers, `a % b` never reaches 0, and the recursion has no base case
 * left to reach. `lcm(1..43)` is 9.4e18.
 *
 * It is not an exotic shape — it came out of a real corpus tune whose root
 * literal is 100 comma-parts of `k*k`, and it is reachable by typing the same
 * string into `note(...)`. Every other unparseable mini gets a quiet refusal;
 * this one got an exception the callers were never told to expect.
 *
 * The boundary is the point of these arms: 1–6 open, 7–42 already refused
 * cleanly, and only 43+ crashed. So the fix has to leave two behaviours alone
 * and change exactly one.
 */
describe('#1239 resolution — an unrepresentable fold refuses instead of throwing', () => {
  /** `"1*1, 2*2, … n*n"` — n comma-parts with n distinct replication factors */
  const parts = (n: number) =>
    Array.from({ length: n }, (_, i) => `${i + 1}*${i + 1}`).join(', ')

  // ⚠ This arm is slow because the piano roll is: nearly all of it is
  // `parsePianoRoll`, about 0.4 s a call at 100 parts. It carries its own timeout.
  // It always took this long: vitest 1 only failed a test when its timer fired, and
  // a synchronous loop never lets it fire, so the 5 s default never applied.
  // Vitest 4 also fails a test that FINISHES past its timeout (vitest#2920).
  //
  // Measured 2026-10-21 (#2159): 21.2 s on an M-series laptop before `rollKey`
  // stopped re-stringifying on every comparison, 15.0 s after. CI's runner took
  // 98.5 s for the 21.2 s version (×4.65), so ~70 s is expected there now; the
  // budget leaves room for a slow runner. What is left is each roll projection
  // querying the pattern on its own.
  it('does not throw at any part count, on either surface', () => {
    for (let n = 1; n <= 100; n++) {
      const mini = parts(n)
      expect(() => parseStepGrid(mini), `step @ ${n} parts`).not.toThrow()
      expect(() => parsePianoRoll(mini), `roll @ ${n} parts`).not.toThrow()
    }
  }, 180_000)

  it('refuses past the cap with a stated gate, not with an exception', () => {
    // 43 is where it used to die; 100 is the real corpus tune's own width.
    //
    // ⚠ THE GATE IS NOT THE SAME ONE AT BOTH ENDS, and that is a property of the
    // notation rather than a gap in the fix. At 43 the onsets are still expressible
    // and it is the fold that goes past the cap, so `resolution` answers. By 100 the
    // parts are coprime enough that some onset lands where no denominator `d ≤ 64`
    // makes `x·d` integral, and `irrational-onset` fires FIRST — inside the same
    // loop, one line before the fold is even consulted. Pinned per count so that a
    // change in which gate answers is visible instead of being absorbed by a
    // permissive "some refusal happened" assertion.
    const expected: [number, string][] = [
      [43, 'resolution'],
      [44, 'resolution'],
      [64, 'resolution'],
      [100, 'irrational-onset'],
    ]
    for (const [n, gate] of expected) {
      const r = parsePianoRoll(parts(n))
      expect(r.ok, `${n} parts must not open a view`).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.gate, `${n} parts must refuse for a stated reason`).toBe(gate)
    }
  })

  it('leaves the two behaviours either side of the boundary exactly as they were', () => {
    // BELOW: these open, and their column counts are the value the exact fold
    // produced — saturation must not disturb anything it can represent.
    const opens: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 6],
      [4, 12],
      [5, 60],
      [6, 60],
    ]
    for (const [n, steps] of opens) {
      const r = parsePianoRoll(parts(n))
      expect(r.ok, `${n} parts used to open`).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      expect(r.model.steps, `${n} parts drew ${steps} columns`).toBe(steps)
    }
    // BETWEEN: already refused cleanly before the fix, and by the same gate.
    for (const n of [7, 20, 42]) {
      const r = parsePianoRoll(parts(n))
      expect(r.ok, `${n} parts already refused`).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.gate, `${n} parts refused for the same reason as before`).toBe('resolution')
    }
  })

  it('leaves a REFINED multi-part stack exact — the fold is capped at the view ceiling', () => {
    // THE ARM THAT WAS MISSING, and its absence is why the first cut of this fix
    // shipped a defect past 3329 green editor arms.
    //
    // Twelve of the thirteen folds in `parse.ts` take unscaled quantities and
    // refuse above `MAX_STEPS`. The shared width across a stack's parts does not:
    // it folds over columns ALREADY multiplied by `viewScale`, so a legitimate
    // refined view reaches well past 64. Capping that fold at 65 does not refuse
    // it — it returns a total the parts do not divide, and the lanes come back
    // wrong. Only the app package's refined-placement and view-scale corpora saw
    // it; nothing here drew a multi-part stack at a scale other than 1.
    const mini = 'bd ~ sn ~, hh*3, cp ~ ~ ~ cp ~ ~ ~'
    const unrefined = parseStepGrid(mini)
    expect(unrefined.ok, 'the stack opens unrefined').toBe(true)
    if (!unrefined.ok) throw new Error('unreachable')

    for (const scale of [2, 4] as const) {
      const r = parseStepGrid(mini, scale)
      expect(r.ok, `the stack opens at ×${scale}`).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      // the drawn width is exactly the document's, scaled — the property the
      // clamp broke, and it breaks it by returning a width no part divides
      expect(r.model.steps, `×${scale} draws the document width scaled`).toBe(
        unrefined.model.steps * scale,
      )
      // every lane is the full width: a fractional `factor` leaves short lanes
      for (const lane of r.model.lanes) {
        expect(lane.cells.length, `lane ${lane.sound} spans the whole grid at ×${scale}`).toBe(
          r.model.steps,
        )
      }
    }
  })

  it('bounds the alternation fold too — a saturating `bars` must refuse, not spin', () => {
    // `bars` is folded with the same `lcm` and then drives `for (b = 0; b < bars; b++)`,
    // which is why the saturation value is finite: an infinite one would hang here
    // rather than reach the refusal one line later. Coprime alternation lengths are
    // what make that fold grow.
    const mini = Array.from({ length: 12 }, (_, i) =>
      `<${Array.from({ length: i + 2 }, (_, k) => `c${(k % 7) + 1}`).join(' ')}>`,
    ).join(' ')
    expect(() => parsePianoRoll(mini)).not.toThrow()
    expect(() => parseStepGrid(mini)).not.toThrow()
  })
})
