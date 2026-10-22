/**
 * _1052-resolution-truth.spec.ts — THROWAWAY INSTRUMENT. Does the grid behave the way
 * a DAW's grid is supposed to behave?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1052-resolution-truth.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE SPEC, in the product's own terms (#1052), as three separable claims:
 *
 *   1. FREE      changing the grid alone changes only the VIEW. Your file is not
 *                touched. (Ableton's Narrow/Widen Grid: you zoom, your MIDI does not
 *                move.)
 *   2. TRUE      the finer view is a faithful picture of the document underneath. A
 *                note occupying one cell at 8 occupies two at 16 — same music, drawn
 *                at twice the density, nothing invented and nothing lost.
 *   3. HONEST    mutating AT the finer grid may legitimately change the code, because
 *                the user asked for something the old resolution cannot say. What it
 *                may NOT do is disturb anything they did not touch.
 *
 * 1 and 2 are about looking. 3 is about writing, and it is the one with teeth: a write
 * that spells the finer grid is CORRECT, and a write that also re-spells the notes
 * either side of it is the failure #1052 exists to prevent.
 *
 * ── WHY THIS IS NOT ANSWERED BY WHAT IS ALREADY HERE ──────────────────────────
 * `free-zone-equivalence.test.ts` gates claim 1 and `cell-coverage.test.ts` gates a
 * piece of claim 2, both over their own populations. Claim 3 has only ever been
 * measured in BYTES (`_1007-subdivide-route.spec.ts`: the shipped route moves p50
 * 0.298 of a long document against a leaf delete's 0.036). Bytes cannot say whether
 * the notes that moved still PLAY the same — a faithful re-spelling at a finer
 * resolution moves bytes and changes no music, and that is precisely the case the
 * byte metric cannot tell from destruction. So the arm that matters here is the one
 * nobody has run: the ENGINE on both sides of the shipped write.
 *
 * ── THE ORACLE, AND WHAT COUNTS AS DAMAGE ─────────────────────────────────────
 * `enginePlayedCycle` on the source and on the emitted document, every bar the model
 * spans, keyed (onset, duration, atom) — the project's one definition, never a
 * re-parsed column grid ([[P301]]: `[~ 1@2]` and `[~ ~ 1@4]` are the same music).
 *
 * The verdict is deliberately ASYMMETRIC, because the two directions mean different
 * things:
 *   added   — the note the user just placed. Exactly 1 is the whole point of the
 *             gesture, so this is the SUCCESS axis.
 *   removed — a note that was in the document before and is not in it now, or is
 *             now at a different instant/length/value.
 * A byte ratio cannot separate these two and this can.
 *
 * ⚠ AND "removed" IS STILL TOO COARSE FOR DAMAGE — re-cut after the first run, which
 * read 835 of 934 as damaged. Almost all of it is the PLACEMENT CLAMP: put a hit in
 * the second half of a cell and the note already there must shorten to make room, so
 * `bd - - -` becomes `[bd bd] - - -`, removing `bd@0.25` and adding `bd@0.125`. The
 * note did not go anywhere; it got shorter, and that is the gesture working (#1064
 * made it sanctioned, and `1058` counts it the same way). So the verdict splits:
 *   CLAMPED  — something in the result still starts at that instant with that value
 *   VANISHED — nothing does. The note stopped sounding, and this is the real loss.
 * Reporting one number for both would have called the feature a defect on 89% of the
 * corpus.
 *
 * ⚠ AND THE COMPARISON MUST COLLAPSE, for the same reason `GRID_SURFACE.collapses` is
 * `true`. Both units the re-cut still flagged were the documented collapse rather than
 * loss — `[d4,f4,d4]` and `hh(<3,7>,16)` — so the surface's own rule is applied to
 * both sides instead of an exception being carved for the two that tripped it.
 *
 * ── CALIBRATION BEFORE ANYTHING IS READ ([[PK103]] step 7) ────────────────────
 * Three figures already known from other instruments are re-derived here and
 * asserted: 1021 units opening a step grid, 1013 DISTINCT units with an identity base
 * (`1058-refined-placement`), and 934 route-A placements posed
 * (`_1007-subdivide-route`). If any moves, this instrument is measuring a different
 * population and its treatment columns mean nothing.
 *
 * ── CONTROLS, AND THE DISTINCTION CALIBRATION DOES NOT COVER ──────────────────
 * The three anchors above prove the POPULATION is the one other instruments measured.
 * They say nothing about whether the CHECKS work — and claims 2 and 3 both come back
 * clean, which is exactly the shape that cannot be told from a check that never looked
 * ([[P525]]). So each is put in a position where it must fail:
 *
 *   claim 2  asked of a x3 view while still expecting a x2 doubling
 *            -> fires 935 of 935 (100%)
 *   claim 3  the identical engine check run on ROUTE B, the model-rescale road
 *            -> fires: 72 units lose 568 notes outright
 *
 * THE SECOND CONTROL IS ALSO A FINDING, and a larger one than the byte ratio it was
 * built to check. Route B does not merely move more of the document (p50 0.988 against
 * route A's 0.298) — it DESTROYS MUSIC: 72 of 934 units come back with notes that no
 * longer sound at all, where the shipped road loses none. So the two roads differ in
 * SAFETY and not only in tidiness, and "the subdivide is destructive" is true of the
 * road nobody ships and false of the one everybody uses.
 *
 * ⚠ ONE ASK PER UNIT, first admissible odd column, scanned col-then-lane — the SAME
 * order the route probe uses, so the two runs describe the same 934 asks. This is a
 * SYSTEMATIC position, not a sample of where users click: the first empty odd column
 * sits early in the document, usually inside the first element. Damage that only
 * appears at later positions would not be seen here.
 *
 * ⚠ SCOPE, stated rather than implied: x2 only, GRID only, mini strings rather than
 * whole documents, and the engine window is the model's own `bars` — a pattern whose
 * period exceeds that is compared on a PREFIX of its denotation. The corpus is 1633
 * entries / 1625 distinct (duplication is negligible), p50 16 chars, and only 17% are
 * >= 40 chars, so the long-doc rows quoted elsewhere rest on n=84 of 934.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import {
  collapseStepGridToDocument,
  stepSlotState,
  scaleStepGrid,
  canDoubleStepGrid,
} from '../../../editor/src/codeView/notation/resolution'
import {
  serializeStepGrid,
  serializeStepGridWithExtent,
} from '../../../editor/src/codeView/notation/serialize'
import { enginePlayedCycle, HRES, type Note } from './engineEditOracle'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** the equivalence key — identical to `engineEditOracle`'s and `1058`'s, on purpose */
const key = (n: Note): string => `${Math.round(n.pos * HRES)}|${Math.round(n.dur * HRES)}|${n.atom}`

function diffNotes(want: Note[], got: Note[]): { added: Note[]; removed: Note[] } {
  const counts = new Map<string, number>()
  for (const n of want) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1)
  const added: Note[] = []
  for (const n of got) {
    const kk = key(n)
    const c = counts.get(kk) ?? 0
    if (c > 0) counts.set(kk, c - 1)
    else added.push(n)
  }
  const removed: Note[] = []
  for (const n of want) {
    const kk = key(n)
    const c = counts.get(kk) ?? 0
    if (c > 0) {
      counts.set(kk, c - 1)
      removed.push(n)
    }
  }
  return { added, removed }
}

/** the grid's collapse: identical events at one instant are ONE cell (GRID_SURFACE) */
function collapse(rows: Note[]): Note[] {
  const seen = new Set<string>()
  return rows.filter((n) => {
    const k = key(n)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** the first empty ODD column, scanned col-then-lane — same order as the route probe */
function firstOddPlacement(m: StepGridModel): StepGridModel | null {
  for (let col = 1; col < m.steps; col += 2)
    for (let lane = 0; lane < m.lanes.length; lane++) {
      if (isCellOn(m.lanes[lane].cells[col])) continue
      const next = toggleCell(m, lane, col, true)
      if (next !== m) return next
    }
  return null
}


/* ── THE WINDOW HOLE ──────────────────────────────────────────────────────────
 *
 * Every engine comparison in this file — and in `writer-reach`, `1058` and the rest —
 * runs over the model's own `bars`. That is a claim about a PREFIX of what the pattern
 * plays, not about what it plays. `<a b c>` against `<x y>` repeats every 6 cycles; a
 * one-bar window sees a sixth of it. This is not a randomness problem (Strudel's RNG is
 * deterministic per time, so a given cycle always plays the same thing) — it is a
 * COVERAGE problem, which is worse, because it fails silently and identically on every
 * run.
 *
 * PERIOD IS OBSERVED, NOT INFERRED. Deriving it from `<>` nesting would be a second
 * model of Strudel's own semantics ([[PV192]]) and would be wrong exactly where the
 * grammar is subtle. Instead: query cycles 0..15, take each cycle's signature with
 * onsets normalised into [0,1), and find the smallest p for which cycle k and cycle k+p
 * agree for every k in view. No such p means the pattern does not repeat inside 16
 * cycles, and that is reported as UNVERIFIABLE rather than folded into either verdict.
 */
const MAX_CYCLES = 16
/** escalation bound — paid only by the units the cheap pass cannot settle */
const DEEP_CYCLES = 72

/** one cycle's content, onsets normalised into [0,1) so two cycles can be compared */
function cycleSig(src: string, c: number): string | null {
  const rows = enginePlayedCycle(src, c)
  if (rows === null) return null
  return collapse(rows)
    .map((n) => `${Math.round((n.pos - c) * HRES)}|${Math.round(n.dur * HRES)}|${n.atom}`)
    .sort()
    .join(',')
}

/**
 * smallest p with cycle k === cycle k+p for every visible k; null = none within view.
 *
 * ⚠ A NULL HERE MEANS "PERIOD EXCEEDS THE SEARCH BOUND", NOT "APERIODIC" — and the two
 * read identically unless the bound is named. The first pass ran at 16 cycles (so
 * p <= 8) and returned null for 9 units; every one was a long `<...>` alternation —
 * `<c4 ~ ~ e4 ~ g4 ~ ~ b4 ~ g4 ~ e4 ~>` has 14 arms and therefore period 14, which is
 * perfectly periodic and simply larger than the window looking for it. Calling those
 * "no period" would have been a fact about the instrument reported as a fact about the
 * music. So the bound is explicit and the escalation is paid only by the units the
 * cheap pass cannot settle.
 */
function periodWithin(src: string, span: number): number | null {
  const sigs: (string | null)[] = []
  for (let c = 0; c < span; c++) {
    const s = cycleSig(src, c)
    if (s === null) return null
    sigs.push(s)
  }
  for (let p = 1; p <= span / 2; p++) {
    let ok = true
    for (let k = 0; k + p < span && ok; k++) if (sigs[k] !== sigs[k + p]) ok = false
    if (ok) return p
  }
  return null
}

function periodOf(src: string): number | null {
  return periodWithin(src, MAX_CYCLES) ?? periodWithin(src, DEEP_CYCLES)
}

describe('#1052 — is the grid FREE to look at, TRUE to the document, and HONEST when written?', () => {
  it('measures all three claims over the corpus', () => {
    let units = 0
    const identityDistinct = new Set<string>()

    // ---- CLAIM 1: is a x2 resolution change free? ----
    const slot = new Map<string, number>()

    // ---- CLAIM 2: is the x2 view a faithful picture? ----
    let truthAsked = 0
    let truthExact = 0
    let truthShapeMismatch = 0
    const truthWrong: string[] = []
    const exTruth: string[] = []

    // ---- CLAIM 3: does the write disturb anything untouched? ----
    let posed = 0
    let wrote = 0
    let queried = 0
    let cleanOne = 0 // exactly the placed note added, nothing touched at all
    let clamped = 0 // a neighbour SHORTENED to make room — sanctioned by #1064
    let vanished = 0 // a note stopped sounding at its instant entirely — real loss
    let oddAdds = 0 // wrote, played, but did not add exactly one
    let unqueryable = 0
    let vanishedNotes = 0
    const exVanish: [string, string, string][] = []
    // ---- CONTROLS. A detector that has never been shown to FIRE cannot tell a clean
    // result from one that was never looked at ([[P525]]). Calibration proves the
    // POPULATION is right; it says nothing about whether the check works.
    let ctlTruthFired = 0 // claim 2 asked with the WRONG expectation — must fail widely
    let ctlTruthAsked = 0
    let ctlBqueried = 0
    let ctlBvanished = 0 // claim 3's check run on route B — the verbose road
    let ctlBvanishedNotes = 0
    let ctlBclamped = 0
    let ctlBclean = 0

    for (const mini of minis) {
      const base = parseStepGrid(mini)
      if (!base.ok) continue
      const m = base.model as StepGridModel
      units++
      const identity = serializeStepGrid(m) === mini
      if (identity) identityDistinct.add(mini)

      // ── CLAIM 1 ── what does the shipped control say about doubling?
      // `canDrawView` PROVES the view draws by asking the parser, which is how the
      // panel proves it — never a prediction of the parser's answer.
      const st = stepSlotState(m, m.steps * 2, (scale) => parseStepGrid(mini, scale).ok)
      slot.set(st, (slot.get(st) ?? 0) + 1)

      const fine = parseStepGrid(mini, 2)
      if (!fine.ok) continue
      const f = fine.model as StepGridModel

      // ── CLAIM 2 ── one cell at N must be exactly two cells at 2N, same music.
      truthAsked++
      if (f.steps !== m.steps * 2 || f.lanes.length !== m.lanes.length) {
        truthShapeMismatch++
      } else {
        let ok = true
        for (let lane = 0; lane < m.lanes.length && ok; lane++)
          for (let i = 0; i < m.steps && ok; i++) {
            const b = m.lanes[lane].cells[i]
            const a0 = f.lanes[lane].cells[2 * i]
            const a1 = f.lanes[lane].cells[2 * i + 1]
            if (isCellOn(b)) {
              // the note moves to column 2i and doubles in width; the slot the
              // refinement created beside it must be EMPTY, not a second onset
              if (!isCellOn(a0) || a0.duration !== b.duration * 2 || isCellOn(a1)) ok = false
            } else if (isCellOn(a0) || isCellOn(a1)) {
              ok = false // silence at N became sound at 2N — invented content
            }
          }
        // CONTROL: the same check, asked of a x3 view while still expecting a x2
        // doubling. A checker that cannot distinguish these two is not checking.
        const wrong = parseStepGrid(mini, 3)
        if (wrong.ok) {
          const w = wrong.model as StepGridModel
          ctlTruthAsked++
          let wok = w.steps === m.steps * 2 && w.lanes.length === m.lanes.length
          if (wok)
            for (let lane = 0; lane < m.lanes.length && wok; lane++)
              for (let i = 0; i < m.steps && wok; i++) {
                const b = m.lanes[lane].cells[i]
                const a0 = w.lanes[lane].cells[2 * i]
                const a1 = w.lanes[lane].cells[2 * i + 1]
                if (isCellOn(b)) {
                  if (!isCellOn(a0) || a0.duration !== b.duration * 2 || isCellOn(a1)) wok = false
                } else if (isCellOn(a0) || isCellOn(a1)) wok = false
              }
          if (!wok) ctlTruthFired++
        }
        if (ok) truthExact++
        else {
          truthWrong.push(mini)
          if (mini.length >= 40 && exTruth.length < 3) exTruth.push(mini)
        }
      }

      // ── CLAIM 3 ── mutate at the finer grid, then ask the ENGINE what survived.
      if (!identity) continue
      const placed = firstOddPlacement(f)
      if (placed === null) continue
      posed++
      const atDocument = collapseStepGridToDocument(placed)
      const { mini: out } = serializeStepGridWithExtent(atDocument ?? placed)
      if (out === null) continue
      wrote++

      const bars = f.bars ?? 1
      let added: Note[] = []
      let removed: Note[] = []
      let queryable = true
      for (let b = 0; b < bars; b++) {
        const want = enginePlayedCycle(mini, b)
        const got = enginePlayedCycle(out, b)
        if (want === null || got === null) {
          queryable = false
          break
        }
        // THE GRID COLLAPSES, and the comparison must too — `GRID_SURFACE.collapses`
        // is `true` because a cell holds a hit or it does not, so it cannot carry two
        // IDENTICAL events at one instant. `hh(<3,7>,16)` plays 10 haps at 7 distinct
        // instants and a FAITHFUL re-emit plays 7; `[d4,f4,d4]` sounds d4 twice at one
        // onset and re-emits as `[d4,f4]`. Diffing as a raw multiset reports both as
        // lost notes, which is the false flag `engineEditOracle`'s `collapses` flag
        // exists to prevent. Applying the surface's own documented rule, never an
        // exception carved for the two units that tripped it.
        const d = diffNotes(collapse(want), collapse(got))
        added = added.concat(d.added)
        removed = removed.concat(d.removed)
      }
      if (!queryable) {
        unqueryable++
        continue
      }
      queried++
      // ⚠ RE-CUT AFTER THE FIRST RUN. "removed > 0" read as damage on 835 of 934, and
      // inspecting the examples showed almost all of it is the PLACEMENT CLAMP: place a
      // hit into the second half of a cell and the note already there must shorten to
      // make room. `bd - - -` becoming `[bd bd] - - -` removes `bd@0.25` and adds
      // `bd@0.125` — the note did not go anywhere, it got shorter, and that is the
      // gesture working. #1064 made it the sanctioned behaviour and `1058` counts it
      // the same way (net one new row). A metric that cannot tell a shortened
      // neighbour from a deleted note is not measuring damage.
      //
      // So: a removed note is VANISHED only if nothing in the result starts at its
      // instant with its value. If something does, the note is still there and only
      // its length moved — that is the clamp.
      const gone = removed.filter(
        (r) => !added.some((a) => Math.round(a.pos * HRES) === Math.round(r.pos * HRES) && a.atom === r.atom),
      )
      if (gone.length > 0) {
        vanished++
        vanishedNotes += gone.length
        if (exVanish.length < 4) exVanish.push([mini, out, `vanished ${gone.length}: ${gone.map((g) => g.atom).join(' ')}`])
      } else if (removed.length > 0) clamped++
      else if (added.length === 1) cleanOne++
      else oddAdds++

      // ---- CONTROL ARM: the SAME engine check on ROUTE B, the road that moves 0.988
      // of the document. This is the control the claim-3 zero needs. Two outcomes and
      // both are informative: if route B destroys notes, the detector is proven able to
      // fire and route A's zero means something; if route B destroys nothing either,
      // then the byte difference between the roads is TIDINESS and not safety, and the
      // word "destructive" has to come off both of them.
      if (canDoubleStepGrid(m)) {
        const wide = scaleStepGrid(m, 'double')
        if (wide !== m && wide.steps === m.steps * 2) {
          const placedB = firstOddPlacement(wide)
          if (placedB !== null) {
            const { mini: outB } = serializeStepGridWithExtent(placedB)
            if (outB !== null) {
              let addedB: Note[] = []
              let removedB: Note[] = []
              let qb = true
              for (let b = 0; b < bars; b++) {
                const want = enginePlayedCycle(mini, b)
                const got = enginePlayedCycle(outB, b)
                if (want === null || got === null) { qb = false; break }
                const d = diffNotes(collapse(want), collapse(got))
                addedB = addedB.concat(d.added)
                removedB = removedB.concat(d.removed)
              }
              if (qb) {
                ctlBqueried++
                const goneB = removedB.filter(
                  (r) => !addedB.some((a) => Math.round(a.pos * HRES) === Math.round(r.pos * HRES) && a.atom === r.atom),
                )
                if (goneB.length > 0) { ctlBvanished++; ctlBvanishedNotes += goneB.length }
                else if (removedB.length > 0) ctlBclamped++
                else if (addedB.length === 1) ctlBclean++
              }
            }
          }
        }
      }
    }

    const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)

    console.log(`\n===== #1052: free to look at, true to the document, honest when written? =====`)
    console.log(`  corpus minis                  ${minis.length}`)
    console.log(`  units opening a step grid     ${units}      <- calibration: 1021`)
    console.log(`  ...DISTINCT, identity base    ${identityDistinct.size}      <- calibration: 1013`)

    console.log(`\n  -- CLAIM 1: is doubling the grid FREE? (the shipped control's own verdict) --`)
    for (const [k, v] of [...slot.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(5)}  ${k.padEnd(10)} ${pct(v, units)}`)
    console.log(`     'view' means the panel redraws and the file is NOT touched.`)

    console.log(`\n  -- CLAIM 2: is the x2 view TRUE to the document? --`)
    console.log(`     asked (admits a x2 view)   ${truthAsked}`)
    console.log(`     one cell -> exactly two    ${truthExact}   ${pct(truthExact, truthAsked)}`)
    console.log(`     shape mismatch             ${truthShapeMismatch}`)
    console.log(`     cell mismatch              ${truthWrong.length}`)

    console.log(`\n  -- CLAIM 3: does writing at the finer grid disturb anything untouched? --`)
    console.log(`     placements posed           ${posed}      <- calibration: 934`)
    console.log(`     ...wrote a document        ${wrote}`)
    console.log(`     ...engine answered         ${queried}   (unqueryable ${unqueryable})`)
    console.log(`     VANISHED: a note stopped sounding entirely  ${vanished}   ${pct(vanished, queried)}   (${vanishedNotes} notes)`)
    console.log(`     clamped: a neighbour shortened for room     ${clamped}   ${pct(clamped, queried)}   <- sanctioned (#1064)`)
    console.log(`     clean:   nothing else touched at all        ${cleanOne}   ${pct(cleanOne, queried)}`)
    console.log(`     other:   played but not exactly one added   ${oddAdds}   ${pct(oddAdds, queried)}`)
    console.log(`     -> UNDISTURBED (clean + clamped) = ${cleanOne + clamped}   ${pct(cleanOne + clamped, queried)}`)

    console.log(`\n  -- CONTROLS: is each check able to FIRE? --`)
    console.log(`     claim 2 asked of a x3 view expecting x2:  fired ${ctlTruthFired} of ${ctlTruthAsked}   ${pct(ctlTruthFired, ctlTruthAsked)}`)
    console.log(`     claim 3 run on ROUTE B (the 0.988 road), engine answered ${ctlBqueried}:`)
    console.log(`        VANISHED ${ctlBvanished}  (${ctlBvanishedNotes} notes)   clamped ${ctlBclamped}   clean ${ctlBclean}`)

    if (exTruth.length) {
      console.log(`\n  -- where the x2 VIEW is not a faithful doubling --`)
      for (const s of exTruth) console.log(`     ${JSON.stringify(s)}`)
    }
    if (exVanish.length) {
      console.log(`\n  -- where a note VANISHED (not merely shortened) --`)
      for (const [b, a, why] of exVanish) {
        console.log(`     ${why}`)
        console.log(`       before  ${JSON.stringify(b)}`)
        console.log(`       after   ${JSON.stringify(a)}`)
      }
    }

    // ---- CALIBRATION. Nothing above may be read if these move. ----
    expect(units, 'units opening a step grid').toBe(1021)
    expect(identityDistinct.size, 'distinct identity base — 1058').toBe(1013)
    expect(posed, 'route-A placements posed — _1007-subdivide-route').toBe(934)
    // and the engine must have answered for a real share, or claim 3 is vacuous
    expect(queried, 'engine answered too few asks to read claim 3').toBeGreaterThan(300)
    // ---- and the CONTROLS must have run on a real population ----
    expect(ctlTruthAsked, 'claim 2 control never ran').toBeGreaterThan(100)
    expect(ctlBqueried, 'claim 3 control never ran on route B').toBeGreaterThan(300)
  })

  it('CLOSES THE WINDOW HOLE — re-asks claim 3 over each pattern own period', () => {
    // POSITIVE CONTROL FIRST, on patterns whose period is known by construction. A
    // period detector that cannot be shown to read a known answer is not evidence.
    expect(periodOf('bd sd'), 'a plain sequence repeats every cycle').toBe(1)
    expect(periodOf('<bd sd>'), 'a two-arm alternation').toBe(2)
    expect(periodOf('<bd sd cp>'), 'a three-arm alternation').toBe(3)
    // ⚠ THE CONTROL CAUGHT THE CONTROL. This line first read `<bd sd> <cp cp cp>`
    // expecting 6, and the detector answered 2 — correctly. Three arms all spelling
    // `cp` are indistinguishable cycle to cycle, so that element has period 1 and the
    // pair has period 2. The arms must differ for the alternation to have a period at
    // all, which is a fact about what PLAYS rather than about what is written.
    expect(periodOf('<bd sd> <cp hh sd>'), 'lcm(2,3)').toBe(6)
    // and the escalation must actually reach past the cheap bound
    expect(periodWithin('<a b c d e f g h i j k>', MAX_CYCLES), 'past the cheap bound').toBe(null)
    expect(periodOf('<a b c d e f g h i j k>'), 'eleven arms, found by escalating').toBe(11)

    let posed = 0
    let unverifiable = 0
    let windowWasShort = 0
    // WHY the window is never short is the part worth measuring. If `bars` already
    // equals the period, the old arm was total by construction rather than by luck —
    // and that is a fact about the bar-expanded projection (#930), not a coincidence.
    let barsEqPeriod = 0
    let barsGtPeriod = 0
    let nonTrivialPeriod = 0
    const periodDist = new Map<number, number>()
    const exUnverifiable: string[] = []

    let queried = 0
    let vanished = 0
    let vanishedNotes = 0
    let clamped = 0
    let clean = 0
    let other = 0
    let shortQueried = 0
    let shortVanished = 0
    const exShort: [string, string, string][] = []

    for (const mini of minis) {
      const base = parseStepGrid(mini)
      if (!base.ok) continue
      const m = base.model as StepGridModel
      if (serializeStepGrid(m) !== mini) continue
      const fine = parseStepGrid(mini, 2)
      if (!fine.ok) continue
      const f = fine.model as StepGridModel
      const placed = firstOddPlacement(f)
      if (placed === null) continue
      posed++

      const period = periodOf(mini)
      if (period === null) {
        unverifiable++
        if (exUnverifiable.length < 5) exUnverifiable.push(mini)
        continue
      }
      periodDist.set(period, (periodDist.get(period) ?? 0) + 1)
      const bars = f.bars ?? 1
      const short = period > bars
      if (short) windowWasShort++
      if (bars === period) barsEqPeriod++
      else if (bars > period) barsGtPeriod++
      if (period > 1) nonTrivialPeriod++

      const atDocument = collapseStepGridToDocument(placed)
      const { mini: out } = serializeStepGridWithExtent(atDocument ?? placed)
      if (out === null) continue

      // THE WIDENED WINDOW: every cycle of the pattern's own period, and never fewer
      // than the model's bars, so this can only ever see MORE than the old arm did.
      const W = Math.max(bars, period)
      let added: Note[] = []
      let removed: Note[] = []
      let queryable = true
      for (let b = 0; b < W; b++) {
        const want = enginePlayedCycle(mini, b)
        const got = enginePlayedCycle(out, b)
        if (want === null || got === null) { queryable = false; break }
        const d = diffNotes(collapse(want), collapse(got))
        added = added.concat(d.added)
        removed = removed.concat(d.removed)
      }
      if (!queryable) continue
      queried++
      if (short) shortQueried++
      const gone = removed.filter(
        (r) => !added.some((a) => Math.round(a.pos * HRES) === Math.round(r.pos * HRES) && a.atom === r.atom),
      )
      if (gone.length > 0) {
        vanished++
        vanishedNotes += gone.length
        if (short) {
          shortVanished++
          if (exShort.length < 4) exShort.push([mini, out, `period ${period} > bars ${bars}, vanished ${gone.length}`])
        }
      } else if (removed.length > 0) clamped++
      else if (added.length === 1) clean++
      else other++
    }

    const pc = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)
    console.log(`\n===== #1052 window hole: does claim 3 survive a window as wide as the period? =====`)
    console.log(`  placements posed                              ${posed}`)
    console.log(`  period exceeds ${DEEP_CYCLES} cycles -> UNVERIFIABLE       ${unverifiable}   ${pc(unverifiable, posed)}`)
    console.log(`  OLD window (bars) SHORTER than the period     ${windowWasShort}   ${pc(windowWasShort, posed)}`)
    console.log(`  period distribution:  ${[...periodDist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  ')}`)
    console.log(`  ...of which period > 1 (a real alternation)   ${nonTrivialPeriod}`)
    console.log(`  bars == period  ${barsEqPeriod}     bars > period  ${barsGtPeriod}     bars < period  ${windowWasShort}`)
    console.log(`     -> the model's own bars is the bar-expanded projection (#930), so the`)
    console.log(`        old window already covered the period. Total by construction, not luck.`)
    if (exUnverifiable.length) {
      console.log(`  -- period exceeds ${DEEP_CYCLES} cycles (a finite window cannot settle these) --`)
      for (const s of exUnverifiable) console.log(`       ${JSON.stringify(s.slice(0, 110))}`)
    }
    console.log(`\n  -- claim 3, re-asked over max(bars, period) --`)
    console.log(`     engine answered                  ${queried}`)
    console.log(`     VANISHED                         ${vanished}   ${pc(vanished, queried)}   (${vanishedNotes} notes)`)
    console.log(`     clamped                          ${clamped}   ${pc(clamped, queried)}`)
    console.log(`     clean                            ${clean}   ${pc(clean, queried)}`)
    console.log(`     other                            ${other}   ${pc(other, queried)}`)
    console.log(`  -- the subset the OLD window under-covered --`)
    console.log(`     re-asked wide                    ${shortQueried}`)
    console.log(`     VANISHED among them              ${shortVanished}   ${pc(shortVanished, shortQueried)}`)
    for (const [b, a, why] of exShort) {
      console.log(`     ${why}`)
      console.log(`       before  ${JSON.stringify(b)}`)
      console.log(`       after   ${JSON.stringify(a)}`)
    }

    // ⚠ THE HOLE IS EMPTY, AND THAT IS THE RESULT — not a reason to weaken the arm.
    // This assertion first read `windowWasShort > 0`, written on the assumption that
    // the hole was real. It is 0: for every unit posed, the model's `bars` already
    // covers the pattern's observed period, because `bars` IS the bar-expanded
    // projection of the alternation (#930). So every engine comparison in this file
    // and its siblings was TOTAL over the grid population, by construction.
    // What must be asserted instead is NON-VACUITY — that the detector saw patterns
    // whose period is genuinely greater than one, so "never short" is a finding about
    // the population and not about a detector that only ever answered 1.
    expect(nonTrivialPeriod, 'every unit had period 1 — the check could not have seen a short window').toBeGreaterThan(50)
    expect(windowWasShort, 'a unit whose period outruns its bars would break the totality claim').toBe(0)
    expect(queried, 'too few asks answered to read the widened arm').toBeGreaterThan(300)
  })
})
