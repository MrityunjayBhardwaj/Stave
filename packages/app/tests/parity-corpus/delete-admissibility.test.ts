/**
 * #1160 — THE DELETE A LEAF SURFACE REFUSES, PINNED ON BOTH SURFACES.
 *
 * `placement-admissibility.test.ts` states its axis as "PLACEMENT only (OFF→ON).
 * Deletes, resizes and velocity are different ops with their own write paths and are
 * not gated here." That was accurate and it left the delete ungated, which is how a
 * refusal affecting half of every leaf ask went four issues without a number.
 *
 * WHAT IS PINNED, and why a pin rather than a bound: about half of every delete
 * offered on a leaf surface is refused, and that is CORRECT — one token backing
 * several columns cannot be made to say two things at once, and letting the last
 * writer win would silently blank cells the user never touched. The refusal is not a
 * defect to be driven to zero. It is a stated property of the surface, and what a
 * stated property needs is an arm that notices when it changes SIZE, in either
 * direction. A `toBeLessThan` would let the rate double unnoticed; a `toBeGreaterThan`
 * would let the refusals quietly vanish into a writer that started guessing.
 *
 * POPULATION (per this boundary's rule that a gate names its population, its axes and
 * its depth):
 *   - every mini in `mini-corpus.json` that opens a step grid with a lane, or a piano
 *     roll with a note;
 *   - split by WRITE PATH — `leafSource` / `altSource` / `source` — because the same
 *     gesture has a different answer per path and nothing in the model surfaces which
 *     one is serving it (#1070);
 *   - grid: every SOUNDING cell of every lane, cleared one at a time. Roll: every CELL
 *     holding a note — a (pitch, start) — cleared one at a time, which removes every note
 *     there. One ask = one delete a user could actually pose, and that is a CLICK, so both
 *     surfaces are posed the way their panel poses them (#1168). The roll was posed by
 *     note index until then, which is not a gesture `PianoRollGrid` performs and differs
 *     from it on exactly the unisons — 14 asks, and the whole of the falsified #1164.
 *   - the axis is DELETE only. Placement is gated next door; resize and velocity have
 *     their own write paths and are not gated here either.
 *
 * THE COUNT IS NOT ASSERTED ALONE. Pinning 275 lets the same 275 arrive from a
 * different cause and read as unchanged — the failure mode the placement gate names in
 * its own docstring. So each refusal is also checked against an INDEPENDENT arm: the
 * shared-leaf predicate recomputed from `leafSource` directly, never from the writer's
 * answer. If the writer ever refuses for a new reason the count can stay put and this
 * still breaks.
 *
 * ⚠ THE ROLL'S HALF WAS UNMEASURED WHEN #1160 WAS FILED, and its scope line said so.
 * It turns out to carry the same branch at the same rate, so the population is 563
 * asks across the two surfaces rather than the 275 the issue records (551 while the roll
 * was posed by note; 563 once it is posed by cell, which refuses 12 of the 14 it had been
 * counting as accepted).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll, parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'
import {
  serializePianoRoll,
  serializeStepGrid,
} from '../../../editor/src/codeView/notation/serialize'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = [
  ...new Set(
    (corpus.minis as { mini: string }[]).map((o) => o.mini.trim()).filter((m: string) => m !== ''),
  ),
]

type Path = 'leaf' | 'alt' | 'source'
const pathOf = (m: { leafSource?: unknown; altSource?: unknown; source?: unknown }): Path =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : 'source'

interface Tally {
  units: number
  asks: number
  refused: number
  /** refusals whose cell/note sits on a leaf backing more than one column — the cause */
  refusedShared: number
  /** accepted deletes on a shared leaf — see the note at the assertion */
  wroteShared: number
  /**
   * of those, the ones a same-(start, pitch) twin survives. Was #1164's residue tracker;
   * now a STRUCTURAL check that the ask still models a click, because a click clears the
   * whole cell and so cannot leave a twin. Must read 0 — see the assertion.
   */
  wroteSharedTwin: number
  /** of those, the ones whose document comes back byte-identical to its source */
  wroteSharedNoOp: number
}
const zero = (): Tally => ({
  units: 0,
  asks: 0,
  refused: 0,
  refusedShared: 0,
  wroteShared: 0,
  wroteSharedTwin: 0,
  wroteSharedNoOp: 0,
})
const get = (m: Map<Path, Tally>, p: Path): Tally => {
  const t = m.get(p) ?? zero()
  m.set(p, t)
  return t
}

/**
 * How many DISTINCT columns each leaf span backs — recomputed from the source, never
 * from the writer's answer.
 *
 * Two precisions, both of which a coarser count got wrong and the corpus caught:
 *
 *  - DISTINCT columns, not occurrences. A span appearing twice inside ONE column is not
 *    shared in the sense that matters: clearing that column writes `~` through both
 *    occurrences at once, so there is nothing to disagree about.
 *  - the anchor must be the deleted cell's OWN. `cols[c]` holds every atom sounding at
 *    column `c` ACROSS LANES, so asking "is anything here shared" answers for notes the
 *    user did not touch. A first cut did exactly that and scored 19 grid / 65 roll
 *    accepted deletes as shared-but-taken, which read like a hole in the property and
 *    was a hole in the question.
 */
const fanoutOf = (perColumn: { start: number; end: number }[][]): Map<string, number> => {
  const cols = new Map<string, Set<number>>()
  perColumn.forEach((spans, c) => {
    for (const s of spans) {
      const k = `${s.start}:${s.end}`
      const seen = cols.get(k) ?? new Set<number>()
      seen.add(c)
      cols.set(k, seen)
    }
  })
  return new Map([...cols].map(([k, seen]) => [k, seen.size]))
}

/**
 * WHERE THE MULTIPLIER LIVES — read from the source adjacent to the span, never from the
 * token, because an anchor's span covers `bd` and the `*4` that does the multiplying sits
 * outside it. This is the number the decision NOT to split shared tokens rests on, so it
 * is pinned rather than left in a comment: a justification nobody re-measures is exactly
 * how a falsified claim survives in prose.
 */
// ⚠ NO DIGIT REQUIRED AFTER THE OPERATOR. A first cut demanded one and came out 2 short
// of the probe on the roll; the two are `*<…>`-style PATTERNED multipliers, where the
// count is itself a mini. The multiplication is still spelt on the token there, which is
// the only thing this predicate is asking. The disagreement is why both exist.
const multiplierOnToken = (src: string, end: number): boolean => /^\s*[*!@]/.test(src.slice(end))

const gridTally = new Map<Path, Tally>()
const rollTally = new Map<Path, Tally>()
/** shared-leaf instances behind the refusals, split by where the multiplier is spelt */
const split = { gridOn: 0, gridOff: 0, rollOn: 0, rollOff: 0 }
/** control arm only — see the note at its increment: the by-index residue the cell gesture replaced */
let byIndexResidue = 0

for (const mini of minis) {
  let g: StepGridModel | null = null
  try {
    const r = parseStepGrid(mini)
    g = r.ok ? r.model : null
  } catch {
    g = null
  }
  if (g && g.lanes.length > 0) {
    const t = get(gridTally, pathOf(g))
    t.units++
    const ls = g.leafSource
    const fan = ls ? fanoutOf(ls.cols.map((col) => col.map((a) => a.span))) : null
    for (let li = 0; li < g.lanes.length; li++) {
      for (let c = 0; c < g.steps; c++) {
        if (!isCellOn(g.lanes[li].cells[c])) continue
        t.asks++
        const lanes = g.lanes.map((l, i) =>
          i === li ? { ...l, cells: l.cells.map((cell, j) => (j === c ? false : cell)) } : l,
        )
        // the cell's own anchor: `columnAtoms` keys a lane's contribution by `sound`,
        // so that is what pairs this lane's cell with the leaf it was read from
        const shared =
          fan !== null &&
          (ls?.cols[c] ?? [])
            .filter((a) => a.atom === g!.lanes[li].sound)
            .some((a) => (fan.get(`${a.span.start}:${a.span.end}`) ?? 0) > 1)
        if (serializeStepGrid({ ...g, lanes }) === null) {
          t.refused++
          if (shared) t.refusedShared++
          if (ls && fan)
            for (const a of ls.cols[c] ?? []) {
              if ((fan.get(`${a.span.start}:${a.span.end}`) ?? 0) < 2) continue
              if (multiplierOnToken(ls.src, a.span.end)) split.gridOn++
              else split.gridOff++
            }
        } else if (shared) t.wroteShared++
      }
    }
  }

  let p: PianoRollModel | null = null
  try {
    const r = parsePianoRoll(mini)
    p = r.ok ? r.model : null
  } catch {
    p = null
  }
  if (p && p.notes.length > 0) {
    const t = get(rollTally, pathOf(p))
    t.units++
    const ls = p.leafSource
    // the roll's column key is the note's START — a chord contributes several anchors
    // there, each with its own disjoint leaf, so the buckets are per start
    const byStart = new Map<number, { start: number; end: number }[]>()
    for (const a of ls?.anchors ?? [])
      byStart.set(a.start, [...(byStart.get(a.start) ?? []), a.span])
    const fan = ls ? fanoutOf([...byStart.values()]) : null
    // ONE ASK = ONE CLICK, WHICH IS ONE CELL AND NOT ONE NOTE (#1168). `PianoRollGrid`
    // deletes by cell — `notes.filter((n) => !(n.pitch === sel.pitch && n.start ===
    // sel.start))` — so it removes EVERY note at the (pitch, start) the user clicked.
    // Posing this by note index instead measured a gesture the panel never performs, and
    // the two differ exactly where two notes share one cell: a unison. That gap is the
    // whole of #1164, which reported 24 accepted-but-byte-unchanged deletes that no click
    // can reach; on the panel's gesture the same corpus yields none, because removing both
    // twins lets the pitch leave the comparison normally.
    //
    // The GRID half above needs no equivalent change — it already clears by (lane, step),
    // which is exactly `toggleCell`'s signature.
    const cells = new Map<string, { start: number; pitch: string }>()
    for (const n of p.notes) cells.set(`${n.start}\0${n.pitch}`, { start: n.start, pitch: n.pitch })
    for (const cell of cells.values()) {
      t.asks++
      // the cell's own anchor — same start AND same pitch, so a chord member's
      // neighbour is not mistaken for this cell's leaf
      const shared =
        fan !== null &&
        (ls?.anchors ?? [])
          .filter((a) => a.start === cell.start && a.pitch === cell.pitch)
          .some((a) => (fan.get(`${a.span.start}:${a.span.end}`) ?? 0) > 1)
      const dropped = {
        ...p,
        notes: p.notes.filter((n) => !(n.pitch === cell.pitch && n.start === cell.start)),
      }
      const out = serializePianoRoll(dropped)
      if (out === null) {
        t.refused++
        if (shared) t.refusedShared++
        if (ls && fan)
          for (const a of ls.anchors) {
            if (a.start !== cell.start) continue
            if ((fan.get(`${a.span.start}:${a.span.end}`) ?? 0) < 2) continue
            if (multiplierOnToken(ls.src, a.span.end)) split.rollOn++
            else split.rollOff++
          }
      } else if (shared) {
        t.wroteShared++
        // Kept as a CONTROL rather than as the residue tracker it used to be. Under the
        // panel's gesture a same-(start, pitch) twin cannot survive — the click takes every
        // note at that cell — so this must read 0, and a non-zero would mean the ask stopped
        // modelling the click. The `unchanged` counter beside it is the one that mattered:
        // it was 24 by index and is 0 by cell.
        if (dropped.notes.some((n) => n.start === cell.start && n.pitch === cell.pitch))
          t.wroteSharedTwin++
        if (ls && out === ls.src) t.wroteSharedNoOp++
      }

      // ── THE POSITIVE CONTROL FOR EVERY ZERO ABOVE ────────────────────────────
      // Moving to the cell gesture drove the roll's shared-leaf residue to 0, which is the
      // right answer and costs the GRID's own `wroteShared === 0` its control arm: that
      // assertion was justified by "the identical measurement on the roll returns 24, so
      // a zero here is a fact about the grid and not a counter that never increments."
      // With both at 0 nothing proves either counter can move.
      //
      // So the by-index gesture is kept — the very model this issue removed — purely as
      // that control. It is NOT a user gesture and its number is not a property of the
      // product; it exists so the zeros are measurements rather than dead counters. If it
      // ever reads 0 too, the sweep has stopped reaching this branch and every zero in
      // this file is worthless.
      if (shared) {
        const ni = p.notes.findIndex(
          (n) => n.pitch === cell.pitch && n.start === cell.start,
        )
        const byIndex = serializePianoRoll({ ...p, notes: p.notes.filter((_, i) => i !== ni) })
        if (byIndex !== null && ls && byIndex === ls.src) byIndexResidue++
      }
    }
  }
}

describe('#1160 — a leaf surface refuses the delete when one token backs several columns', () => {
  it('GRID: the leaf path refuses 275 of 581 deletes across 83 units', () => {
    // 82 → 83 units and 557 → 581 asks (#1066): one more document reaches the leaf
    // projection now that the onset snap grid can express a thirty-second, and it
    // brings its own asks with it.
    //
    // `refused` is UNMOVED at 275, and that is the load-bearing half of this arm. A
    // widening that also broke something would show up here as new refusals; instead
    // every added ask is admitted. The rate falls 275/557 → 275/581 purely because the
    // denominator grew.
    const t = gridTally.get('leaf')!
    // ⚠ 83/581/275 -> 86/623/285 at #1242 — the corpus widened 1535 -> 1633 units.
    // `refused` moves with the population for the first time (275 -> 285): the 3 new
    // leaf units bring 42 asks and 10 refusals, which is the same shared-leaf branch,
    // not a new one — the arm below re-derives every refusal from the source.
    expect({ units: t.units, asks: t.asks, refused: t.refused }).toEqual({
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ units 80 -> 82 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      units: 82,
      // ⚠ asks 522 -> 533 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      asks: 533,
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ refused 211 -> 213 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      refused: 213,
    })
  })

  it('ROLL: the leaf path refuses 288 of 577 deletes across 54 units', () => {
    // The half #1160 was filed without. Same branch, same rate — so the property is
    // about the leaf projection itself, not about either surface's edit vocabulary.
    const t = rollTally.get('leaf')!
    // ⚠ 54/577/288 -> 56/659/369 at #1242. The roll moves hardest of anything in
    // this PR: +2 units carry +82 asks and +81 refusals, because the newly admitted
    // melodic strings are long multi-cycle chord charts where one token backs many
    // columns — exactly the shape this arm is about. The rate goes 50% -> 56%.
    // ⚠ MOVED at #1310 (region-local parallel lanes). The roll writer can now spell a
    // region whose same-start notes have different lengths, and `parse.ts` uses the
    // writer as an ADMISSIBILITY ORACLE — so this moves REACH, not spelling: 2 units no
    // longer need the leaf projection (56 -> 54) and take their 24 asks with them
    // (659 -> 635), carrying 7 refusals (369 -> 362). Judged per ask rather than by
    // tally, because 7 fewer refusals reads identically whether asks were admitted or
    // stopped being posed: 0 asks went written -> refused, and the 7 newly written
    // deletes each remove haps of the deleted pitch only and invent none. The refusal
    // was not needed — parallel lanes CAN say two things at once, which is the one
    // thing the old writer could not do and the whole reason this branch refuses.
    expect({ units: t.units, asks: t.asks, refused: t.refused }).toEqual({
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ units 36 -> 38 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      units: 38,
      // ⚠ asks 519 -> 540 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      asks: 540,
      // ⚠ refused 337 -> 351 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      refused: 351,
    })
  })

  it('every refusal is a SHARED leaf, recomputed from the source rather than the writer', () => {
    // The independent arm. `refusedShared` is derived by counting how many columns each
    // span backs — the writer is not consulted — so a refusal arriving from any other
    // branch shows up here even if the totals above are untouched.
    //
    // Its own `it()` on purpose: an assertion after a failing one never runs, so folding
    // this into the counts would make it evidence for nothing on exactly the breaks that
    // matter.
    const g = gridTally.get('leaf')!
    const r = rollTally.get('leaf')!
    // ⚠ 275/288 -> 285/369 at #1242, and this is the load-bearing half: recomputed
    // from the SOURCE without consulting the writer, it still equals the writer's own
    // refusal count on both surfaces. The widening added asks, not a new branch.
    // ⚠ MOVED at #1310, and this arm is why the move is readable rather than alarming:
    // recomputed from the SOURCE without consulting the writer, it STILL equals the
    // writer's own count (362). The 7 that vanished left with their units, so no new
    // refusal branch appeared — had the writer started guessing inside the population,
    // these two numbers would have parted.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    // ⚠ grid 211 -> 213, roll 337 -> 351 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
    expect({ grid: g.refusedShared, roll: r.refusedShared }).toEqual({ grid: 213, roll: 351 })
  })

  it('GRID: sharing is not merely necessary but SUFFICIENT — an exact iff, no residue', () => {
    // Without this, "every refusal is shared" would still be satisfied by a writer that
    // refused everything. Zero accepted deletes on a shared leaf makes the predicate
    // decide the answer both ways, which is what lets the property be stated in the
    // docs as a rule rather than as a tendency.
    //
    // ⚠ ITS POSITIVE CONTROL MOVED (#1168). This used to read "the identical measurement
    // on the roll returns 24, so a zero here is a fact about the grid and not a counter
    // that never increments" — and posing the roll by CELL drove that 24 to 0, which took
    // the control with it. Both surfaces reading 0 proves nothing about either counter.
    // The control is now the by-index arm two tests below, which still reads 24.
    expect(gridTally.get('leaf')!.wroteShared).toBe(0)
  })

  it('ROLL: sharing is SUFFICIENT here too — the residue was the instrument, not the writer (#1164/#1168)', () => {
    // WAS {24, 24, 24}, and every one of those was a delete posed by note index. The panel
    // deletes by CELL, taking every note at the (pitch, start); a unison is two notes
    // sharing exactly that key, so the real click removes both, the pitch leaves the
    // comparison and `gone` fires normally. Posed the way the panel poses it, the roll has
    // the SAME exact-iff property the grid has, and #1164's residue does not exist on any
    // gesture a user can perform — which is why it closed falsified rather than fixed.
    //
    // All three are kept rather than collapsed to one: `unchanged` is the claim (#1164's
    // symptom is gone), `twinSurvives` is a structural check that the ask still models a
    // click (a click cannot leave a twin), and `accepted` ties the roll to the grid's rule.
    const r = rollTally.get('leaf')!
    expect({ accepted: r.wroteShared, twinSurvives: r.wroteSharedTwin, unchanged: r.wroteSharedNoOp })
      .toEqual({ accepted: 0, twinSurvives: 0, unchanged: 0 })
  })

  it('CONTROL — the by-index gesture still finds 12, so the zeros above are measurements', () => {
    // Not a property of the product. This re-poses each shared-leaf ask the way the gate
    // used to — dropping ONE note rather than clearing the cell — purely so that the four
    // zeros above are known to be reachable. Three separate absence claims now rest on this
    // one arm: the grid's `wroteShared`, and the roll's accepted/twin/unchanged triple.
    //
    // If this ever reads 0, the sweep has stopped reaching the branch and every zero in
    // this file is worthless — a different and much worse failure than the count moving.
    //
    // ⚠ 12, NOT #1164's 24, AND THE HALVING IS THE POINT. This counts CELLS; the old
    // framing counted NOTES, and a unison cell holds two, so each was posed twice —
    // once dropping either twin — and the two asks were the same click. #1164's headline
    // population was 12 real asks double-counted. A first cut of this arm asserted 24
    // straight from the issue and this gate caught it, which is the arm doing its job on
    // its first run.
    // ⚠ 12 -> 20 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    expect(byIndexResidue).toBe(20)
  })

  it('only a FIFTH of the sharing is spelt on the token — the figure the design call rests on', () => {
    // #1160 proposes splitting `bd*4` into `bd bd ~ bd` instead of refusing. That is only
    // even expressible where the multiplier sits ON the token; everywhere else the token
    // is multiplied by something enclosing it, and "splitting" would mean re-authoring
    // notation the user wrote — the thing the leaf path exists to avoid.
    //
    // Pinned because it is load-bearing. The recommendation to keep refusing is exactly
    // as good as this ratio, and prose stating it cannot notice when it stops being true.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633). The ratio the design call rests on is
    // essentially unchanged on the grid (77/300 -> 81/306, a fifth either way) and
    // FALLS on the roll (72/303 -> 90/506, 19% -> 15%) — the new material is more
    // enclosing-multiplier, not less, so "keep refusing" reads stronger, not weaker.
    // ⚠ MOVED at #1310: the roll loses 3 on-token and 4 off-token shares with the 2
    // units that left the leaf projection (90/506 -> 87/502). The ratio the design call
    // rests on is unmoved at 15%, and the grid is untouched — this widening is the
    // roll writer's alone.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    // ⚠ gridOff 182 -> 184, rollOff 496 -> 510 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
    expect(split).toEqual({ gridOn: 71, gridOff: 184, rollOn: 68, rollOff: 510 })
  })

  it('POSITIVE CONTROL — the non-leaf paths take the same gesture', () => {
    // A refusal rate means nothing unless the same sweep, through the same call, can be
    // seen ACCEPTING deletes. Pinned per path rather than summed so that one path going
    // silent cannot be absorbed by another.
    const gs = gridTally.get('source')!
    const ga = gridTally.get('alt')!
    const rs = rollTally.get('source')!
    const ra = rollTally.get('alt')!
    expect({
      gridSource: { asks: gs.asks, refused: gs.refused },
      gridAlt: { asks: ga.asks, refused: ga.refused },
      rollAlt: { asks: ra.asks, refused: ra.refused },
    }).toEqual({
      // ⚠ MOVED at #1242 (corpus 1535 -> 1633). Every `refused` stays ZERO, which
      // is what this control exists to show: the widening added asks to the accepting
      // paths too, so the leaf refusal rate above is not an artefact of a shrinking
      // positive control.
      // ⚠ rollAlt MOVED at #1310: 790 -> 874. Two units arrive here — one that stopped
      // needing the leaf projection (`4 ~ ~ <6!3 [6,8 9 10 12]>`) and the one the parser
      // newly opens (`[-7 2,<4 5 6>]*8`) — and `refused` stays ZERO. The accepting paths
      // grew by exactly what the refusing path shed, which is the shape this control
      // exists to make visible. The third mover went to `source`, pinned below.
      // ⚠ gridSource 4443 -> 4465 at #1827 (each bar drawn at its own step count): the
      // newly opened `<~ ~ bd*3 bd*4 bd*3 bd*4 bd*4 bd*4>` brings its 22 hits, and
      // `refused` stays ZERO on every accepting path.
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused). Still refused 0.
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      gridSource: { asks: 4608, refused: 0 },
      // ⚠ asks 619 -> 608 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      gridAlt: { asks: 608, refused: 0 },
      rollAlt: { asks: 874, refused: 0 },
    })
    // The roll's `source` path refuses a little, and it is NOT this issue's branch —
    // these sit outside both leaf splicers. Pinned here so the residue has a number
    // instead of hiding inside a "non-leaf accepts everything" claim that is false.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ MOVED at #1310: 3956 -> 3968. The second unit off the leaf projection
    // (`<[c3, [eb5, eb6, f7] [bb6 d7]] …>`) lands here with its 12 asks. `refused` is
    // UNMOVED at 31 — the widening brought asks to this path and not one new refusal,
    // so the roll's non-leaf residue is the same branch it was, over a wider population.
    // ⚠ 31 -> 29 at #1312, and `asks` is UNMOVED at 3968 — the population is identical and
    // exactly two asks moved from refused to written. Both are on `<~ [~@3.5 d2@2 c#2@2.5]>`,
    // whose fractional bar the per-bar lane form can now spell with weighted rests. Both
    // were judged against this file's own standard by a per-ask diff across the two builds:
    // 2 of 2 remove haps of the deleted pitch and touch nothing else, 0 went written ->
    // refused, and 0 of the previously written deletes changed a single byte.
    // ⚠ asks 3968 -> 3990 at #1827 (each bar drawn at its own step count), `refused` UNMOVED at 29: the newly opened roll's 22 notes.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused). `refused` UNMOVED at 29.
    expect({ asks: rs.asks, refused: rs.refused }).toEqual({ asks: 4118, refused: 29 })
  })
})
