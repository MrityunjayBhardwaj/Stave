/**
 * _1309-roll-subdivide-route.spec.ts — THROWAWAY INSTRUMENT. The roll's half of
 * `_1007-subdivide-route.spec.ts`: does subdividing a PIANO ROLL author, and does
 * the cost depend on the ROUTE rather than on the gesture?
 *
 * Run:
 *   npx vitest run --config vitest.sweep.config.ts _1309-roll-subdivide-route
 *
 * WHY THIS EXISTS. Every corpus measurement the subdivide arc has produced was
 * posed of `parseStepGrid`. `_roll-subdivide-denominator.spec.ts` measured what
 * that leaves out: 244 minis (14.9% of the corpus) open as a roll ONLY and can
 * move, so no grid probe reaches them by construction, and a further 296 open as
 * both and were asked a GRID question. This is the first of the arc's three
 * questions posed of the other surface.
 *
 * ⚠ NOT A DEFECT HUNT. Nothing so far has observed the roll behaving wrongly; its
 * arithmetic is unit-tested (`resolution.test.ts`, roll 14). What is being settled
 * is what may be CLAIMED — whether the arc's conclusions generalise across surfaces
 * or are grid-only. If the roll reproduces the grid's answer, that is the finding.
 *
 * THE TWO ROADS, and only one is shipped. Taken from the grid probe's own analysis
 * and re-verified on the roll rather than assumed across surfaces:
 *
 *   ROUTE A (shipped)   parsePianoRoll(mini, k) -> placeNote
 *                       -> collapsePianoRollToDocument -> serializePianoRollWithExtent
 *                       `PianoRollGrid.tsx:184-190` wires exactly this through
 *                       `useGridModel` — parse / serialize / viewScale /
 *                       collapseToDocument — the same contract `SequencerGrid` uses.
 *   ROUTE B (probe)     scalePianoRoll(m,'double') -> placeNote
 *                       -> serializePianoRollWithExtent
 *                       A model-space rescale. `scalePianoRoll` has NO production
 *                       caller outside `resolution.ts`; its only other non-test
 *                       mention in the tree is a comment at `model.ts:617`.
 *
 * The grid arc learned this the expensive way — a cost measured through
 * `scaleStepGrid` was quoted as a fact about the product, and the shipped road
 * moved a fraction of it. So Route A is driven here from the first probe rather
 * than discovered after publishing a number.
 *
 * THE DISCRIMINATOR, both columns written BEFORE the run:
 *
 *                            ROUTE IS THE CAUSE        GESTURE IS THE CAUSE
 *   A vs B, same units       A far below B             A comparable to B
 *   A vs delete anchor       comparable                far above
 *
 * PAIRED, NOT TWO SWEEPS. Only units where BOTH routes wrote are compared, so a
 * difference cannot be a population difference. The unpaired remainder is reported,
 * never dropped.
 *
 * TWO THINGS DIFFER FROM THE GRID PROBE, and both are stated rather than papered over:
 *
 *   1. NO `regions` SPLIT. `GridWriteExtent`'s splice carries `regions` /
 *      `regionsReemitted`; `RollWriteExtent` is `{ path }` alone, deliberately —
 *      `serialize.ts:1506` says giving the roll a `regions: 0` "would state a
 *      measurement nobody took". So the grid's reconciliation split (splice with
 *      one source region vs many) has NO analogue here and is not faked.
 *   2. THE PITCH SET IS A STATED SUBSET of what the panel offers. `viewPlacesNotes`
 *      (`place.ts:138-142`) asks about the model's own pitches PLUS one padded row
 *      below the content. This probe asks only the model's own, so every placement
 *      it finds is one the panel also offers, and it can under-ask but never
 *      over-claim. Re-deriving the padded-row rule here would be a second oracle;
 *      the tree already records that sweeping the full padded range "changes the
 *      answer on 0 of 544 corpus rolls" (`place.ts:127`).
 *
 * GUARD, because this is where the grid arc lost a gesture: `scalePianoRoll` takes
 * `'double' | 'halve'` and vitest does NOT typecheck. `posedB` counts only asks where
 * the model VERIFIABLY doubled, and every denominator is printed.
 *
 * CONTROLS, because a clean reading from a detector never shown to fire is not
 * evidence. Both must fire, and both are asserted below:
 *   C1  the ×2 verification guard, asked of a DOUBLE-doubled (×4) model — must reject
 *       every unit, proving the guard protecting against a dead gesture can say NO.
 *   C2  a LEAF-projected roll offered a placement — must refuse every one, proving
 *       the placement gate discriminates rather than accepting whatever it is handed.
 *       (`place.ts:238` records leaf rolls refusing all 18,386 asks.)
 *
 * ⚠ C2'S FIRST DESIGN WAS REFUTED BY ITS OWN RUN, and it is kept below rather than
 * swapped out, because the refutation is the evidence that the arm is live. It offered
 * `placeNote` the pitch `zz9` on the assumption that an invalid note name would be
 * refused. It was ACCEPTED on all 538 units — correctly. `ifRollSpellable` asks whether
 * the model can be SPELLED, and mini-notation writes `zz9` back as a literal token, so
 * it round-trips. The gate decides structural admissibility (overlap, leaf refusal),
 * never pitch validity — which is the panel's job, via the row set it offers. So the
 * control was testing a proposition nothing in the code claims. It is reported as an
 * OBSERVATION, never asserted on, and it cost one run to learn.
 *
 * CALIBRATION. Nothing below may be read if these move: the population must
 * reproduce the committed denominator probe exactly — 597 rolls opening, 540 able
 * to double. If either moves, this instrument is measuring a different corpus and
 * its treatment columns mean nothing.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'
import {
  placeNote,
  canPlaceNote,
  viewPlacesNotes,
} from '../../../editor/src/codeView/notation/place'
import {
  scalePianoRoll,
  canDoublePianoRoll,
  collapsePianoRollToDocument,
} from '../../../editor/src/codeView/notation/resolution'
import {
  serializePianoRoll,
  serializePianoRollWithExtent,
} from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * how many bytes actually moved: the range between the common prefix and common suffix.
 * IDENTICAL to `_1007-subdivide-route.spec.ts:100` and `_1007-subdivide-locality.spec.ts:58`,
 * on purpose — a second definition would make the grid and roll runs incomparable, which
 * is the entire point of posing this question in the arc's existing shape.
 */
function changedWidth(before: string, after: string): number {
  if (before === after) return 0
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  let s = 0
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  return Math.max(before.length - p - s, after.length - p - s)
}

interface Sample {
  ratios: number[]
  abs: number[]
  lens: number[]
  longRatios: number[]
  paths: Map<string, number>
}
const blank = (): Sample => ({ ratios: [], abs: [], lens: [], longRatios: [], paths: new Map() })
const bump = (s: Sample, p: string) => s.paths.set(p, (s.paths.get(p) ?? 0) + 1)
function record(s: Sample, before: string, after: string) {
  const w = changedWidth(before, after)
  const len = Math.max(before.length, after.length)
  s.abs.push(w)
  s.lens.push(len)
  s.ratios.push(w / len)
  if (before.length >= 40) s.longRatios.push(w / len)
}
const med = (r: number[]) =>
  r.length === 0 ? NaN : [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)]
function stats(s: Sample) {
  return {
    n: s.ratios.length,
    p50: med(s.ratios),
    absP50: med(s.abs),
    lenP50: med(s.lens),
    longN: s.longRatios.length,
    longP50: med(s.longRatios),
    ge90: s.ratios.filter((v) => v >= 0.9).length,
  }
}

/**
 * The first empty ODD column, scanned column-then-pitch — the SAME outer-loop order
 * the grid probe's `firstOddPlacement` uses, so the two are comparable. Odd columns
 * are exactly the slots a ×2 view adds and the source never indexed.
 *
 * Pitches come from the MODEL, never invented: the roll spells bare integers on a
 * numeric pattern and note names otherwise (`model.ts:1169`), so a fabricated pitch
 * would make a SPELLING refusal read as a placement refusal.
 */
function firstOddPlacement(m: PianoRollModel): PianoRollModel | null {
  const pitches = [...new Set(m.notes.map((n) => n.pitch))]
  for (let start = 1; start < m.steps; start += 2)
    for (const pitch of pitches) {
      if (m.notes.some((n) => n.pitch === pitch && n.start === start)) continue
      const next = placeNote(m, pitch, start, 1)
      if (next !== m) return next
    }
  return null
}

describe('#1309 — does subdividing a ROLL author, and is the cost a property of the ROUTE?', () => {
  it('poses the same placement through the shipped route and the model-rescale route', () => {
    // denominators first — a treatment column means nothing until these are non-zero
    let units = 0 // rolls that open at all
    let canDouble = 0 // the denominator probe's 540
    let identityBase = 0 // Route A's precondition
    let admitsFinerView = 0
    let posedA = 0
    let wroteA = 0
    let posedB = 0
    let wroteB = 0
    let collapsedToDocument = 0 // Route A asks the ÷k guard; how often does it ANSWER?
    let deletable = 0
    const refusals = new Map<string, number>()

    // controls, both of which MUST fire
    let c1Asked = 0
    let c1Rejected = 0 // ×3 rescale rejected by the ×2 guard
    let c2Asked = 0 // leaf rolls, the documented refusing population
    let c2Refused = 0 // ...that refuse every placement
    // the REFUTED first design, reported and never asserted on
    let zzAsked = 0
    let zzAccepted = 0
    // two counts of 56 show up below (leaf rolls, and no-finer-view refusals).
    // Equal counts are not set identity, so the overlap is COUNTED, never inferred.
    const leafRolls = new Set<string>()
    const noFinerView = new Set<string>()

    const routeA = blank()
    const routeB = blank()
    const deleteAnchor = blank()
    const leafAnchor = blank()
    const pairA = blank()
    const pairB = blank()
    const exPair: [string, string, string][] = []

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model
      units++
      if (canDoublePianoRoll(m)) canDouble++

      // ---- CONTROL C2: a LEAF-projected roll must refuse every placement.
      // Measured over ALL opening rolls, not over Route A's population — a surface
      // that refuses everything never reaches Route A, so asking there would be
      // asking only the units that already said yes.
      if (m.leafSource !== undefined) {
        c2Asked++
        leafRolls.add(mini)
        if (!viewPlacesNotes(m)) c2Refused++
      }

      // ---- ANCHOR: the most local write there is — delete one note.
      // The panel's own gesture, filtering the note out of the model
      // (`PianoRollGrid.tsx:328-330`), not a re-derived rule.
      if (m.notes.length > 0) {
        const first = m.notes[0]
        const without = {
          ...m,
          notes: m.notes.filter((n) => !(n.pitch === first.pitch && n.start === first.start)),
        }
        const { mini: out, extent } = serializePianoRollWithExtent(without)
        if (out !== null) {
          deletable++
          record(deleteAnchor, mini, out)
          bump(deleteAnchor, extent.path)
          if (extent.path === 'leaf') record(leafAnchor, mini, out)
        }
      }

      // ---- ROUTE B: model-space rescale, no collapse guard ----
      let outB: string | null = null
      if (canDoublePianoRoll(m)) {
        const wide = scalePianoRoll(m, 'double')
        // THE GUARD. A wrong literal falls to the halve branch and reads as a dead zero.
        if (wide !== m && wide.steps === m.steps * 2) {
          const placed = firstOddPlacement(wide)
          if (placed !== null) {
            posedB++
            const { mini: w, extent } = serializePianoRollWithExtent(placed)
            bump(routeB, w === null ? `${extent.path} (declined)` : extent.path)
            if (w !== null) {
              wroteB++
              outB = w
              record(routeB, mini, w)
            }
          }
        }

        // ---- CONTROL C1: the same guard asked of a DOUBLE-doubled model. Must reject.
        // Asked ONLY where the second double genuinely reached ×4 — otherwise the
        // rescale silently stays at ×2, the guard correctly accepts it, and the
        // control would be vacuous on exactly the units it was meant to test.
        // This is the guard being tested, not ×4 as a measurement axis (out of scope).
        const wider = scalePianoRoll(wide, 'double')
        if (wider.steps === m.steps * 4) {
          c1Asked++
          if (!(wider !== m && wider.steps === m.steps * 2)) c1Rejected++
        }
      }

      // ---- ROUTE A: the shipped road — a refined VIEW, then the ÷k guard ----
      let outA: string | null = null
      if (serializePianoRoll(m) === mini) {
        identityBase++
        const fine = parsePianoRoll(mini, 2)
        if (!fine.ok) {
          const gate = fine.gate ?? 'no-gate'
          refusals.set(gate, (refusals.get(gate) ?? 0) + 1)
          noFinerView.add(mini)
        } else {
          admitsFinerView++
          const placed = firstOddPlacement(fine.model)
          if (placed !== null) {
            posedA++
            // asked of the REAL ÷k guard, the way the panel asks it
            const atDocument = collapsePianoRollToDocument(placed)
            if (atDocument !== null) collapsedToDocument++
            const { mini: w, extent } = serializePianoRollWithExtent(atDocument ?? placed)
            bump(routeA, w === null ? `${extent.path} (declined)` : extent.path)
            if (w !== null) {
              wroteA++
              outA = w
              record(routeA, mini, w)
            }

            // the REFUTED control, kept as an observation. `zz9` is spellable as a
            // literal token, so this is expected to be ACCEPTED, not refused.
            zzAsked++
            if (canPlaceNote(fine.model, 'zz9', 1, 1)) zzAccepted++
          }
        }
      }

      // ---- THE PAIR: same unit, same gesture, two roads ----
      if (outA !== null && outB !== null) {
        record(pairA, mini, outA)
        record(pairB, mini, outB)
        if (mini.length >= 40 && exPair.length < 3) exPair.push([mini, outA, outB])
      }
    }

    const show = (name: string, s: Sample) => {
      const t = stats(s)
      console.log(
        `  ${name.padEnd(26)} n=${String(t.n).padStart(4)}  ratio p50=${t.p50.toFixed(3)}` +
          `  bytes p50=${String(t.absP50).padStart(4)} of doc p50=${String(t.lenP50).padStart(4)}` +
          `  whole-doc=${String(t.ge90).padStart(3)}` +
          `  | LONG docs(>=40) n=${String(t.longN).padStart(3)} p50=${t.longP50.toFixed(3)}`,
      )
      for (const [k, v] of [...s.paths.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`       ${String(v).padStart(4)}x  ${k}`)
    }

    console.log(`\n===== #1309: is the ROLL's subdivide cost a property of the ROUTE? =====`)
    console.log(`  corpus minis                 ${minis.length}`)
    console.log(`  units opening a piano roll   ${units}    <- denominator probe: 597`)
    console.log(`  ...that can double           ${canDouble}    <- denominator probe: 540`)
    console.log(`  ...with an IDENTITY base     ${identityBase}`)
    console.log(`  ...admitting a x2 VIEW       ${admitsFinerView}`)
    console.log(`  ...with a deletable note     ${deletable}`)
    console.log(`  ROUTE A posed                ${posedA}   wrote ${wroteA}`)
    console.log(`     of which the ÷k guard could say at document resolution: ${collapsedToDocument}`)
    console.log(`  ROUTE B posed                ${posedB}   wrote ${wroteB}`)
    if (refusals.size) {
      console.log(`  finer-view refusals by gate:`)
      for (const [k, v] of [...refusals.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`       ${String(v).padStart(4)}x  ${k}`)
    }
    {
      const both = [...leafRolls].filter((k) => noFinerView.has(k)).length
      console.log(
        `  leaf rolls ${leafRolls.size} · refuse a finer view ${noFinerView.size} · SAME minis ${both}` +
          `   <- counted, not inferred from equal totals`,
      )
    }
    console.log(`  -- CONTROLS (both must fire) --`)
    console.log(`  C1  x2 guard asked of a x4 model     rejected ${c1Rejected} of ${c1Asked}`)
    console.log(`  C2  leaf rolls offered a placement   refused  ${c2Refused} of ${c2Asked}`)
    console.log(
      `  --  REFUTED control, observation only: pitch 'zz9' ACCEPTED ${zzAccepted} of ${zzAsked}` +
        ` (spellable as a literal token — the gate never claimed to validate pitches)`,
    )
    console.log(`  -- bytes moved --`)
    show('ROUTE A (shipped)', routeA)
    show('ROUTE B (model rescale)', routeB)
    show('ANCHOR delete note', deleteAnchor)
    show('ANCHOR delete (leaf only)', leafAnchor)
    console.log(`  -- PAIRED: only units where BOTH routes wrote --`)
    show('PAIRED route A', pairA)
    show('PAIRED route B', pairB)

    console.log(`\n  -- WHAT IT LOOKS LIKE (paired, long docs) --`)
    for (const [b, a, bb] of exPair) {
      console.log(`     before   ${JSON.stringify(b)}`)
      console.log(`     route A  ${JSON.stringify(a)}`)
      console.log(`     route B  ${JSON.stringify(bb)}`)
    }

    // ---- CALIBRATION. Nothing above may be read if these move. ----
    expect(units, 'roll population must reproduce the denominator probe').toBe(597)
    expect(canDouble, 'roll doubling population must reproduce the denominator probe').toBe(540)

    // ---- CONTROLS. A detector never shown to fire is not evidence. ----
    expect(c1Asked, 'C1 never ran').toBeGreaterThan(0)
    expect(c1Rejected, 'C1 did not fire — the x2 guard accepts a x4 model').toBe(c1Asked)
    expect(c2Asked, 'C2 never ran — no leaf rolls in the population').toBeGreaterThan(0)
    expect(c2Refused, 'C2 did not fire — a leaf roll accepted a placement').toBe(c2Asked)

    // ---- and the gestures must actually have happened ----
    expect(posedA, 'route A never posed the gesture').toBeGreaterThan(0)
    expect(posedB, 'route B never posed the gesture').toBeGreaterThan(0)
  })
})
