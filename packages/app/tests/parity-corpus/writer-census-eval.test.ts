/**
 * writer-census-eval.test.ts — THE WIDENED DENOMINATOR for the reach transfer
 * (#1009, epic #1007 phase P3).
 *
 * ── WHY THIS ARM EXISTS ───────────────────────────────────────────────────────
 * `writer-census.test.ts` measures the transfer over `mini-corpus.json`: 1500 real
 * minis, harvested under the OLD parse-side admission. That population is
 * comparable to the committed floors and to the 234 the epic quotes, which is
 * exactly why it is the calibrated arm — and exactly why it cannot be the only one.
 *
 * A re-measurement over the same population as before can only confirm. The rule
 * ([[PK59]] step 1, as amended) is to ask what the instrument EXCLUDES, widen to
 * the whole population the code serves, and **write the prediction against the
 * widened set expecting the number to fall** — the excluded cases are excluded
 * because they are hard.
 *
 * What the mini-corpus excludes: it is a snapshot of the strings the parse-side
 * walk found. The eval-first resolver (#1006) picks the content span from
 * EVALUATION, so for the same documents it can hand a writer a different string —
 * a binding's initialiser, a chained argument, a root literal. This arm re-derives
 * the ask population that way, from the 150 real tunes, and asks the same
 * counterfactual.
 *
 * PREDICTION, written before the run: the transfer rate FALLS here, because the
 * spans eval newly admits are bound references and chained arguments, which is
 * where shared leaves and long periods live. **If it comes back HIGHER, the
 * widening did not reach the hard cases and what it excluded has to be found**
 * ([[P343]]) — a gate that gets stronger when the hard cases are added was not
 * measuring them.
 *
 * ── WHAT ACTUALLY HAPPENED, AND THE CORRECTION IT FORCED ──────────────────────
 * The rate came back HIGHER: **82.6%** (413/500) against the mini-corpus arm's
 * 79.3%. The pre-committed response was to find what the widening excluded, and it
 * did: **this arm is not a superset of the mini-corpus arm — it is SMALLER.** 671
 * distinct minis against 1500, because the resolver answers exactly ONCE PER UNIT
 * (the content span) while the corpus harvest collected every mini it could find.
 *
 * So "widen the denominator" was the wrong description of this arm from the start.
 * It is not wide-vs-narrow; it is two differently-drawn samples of the same corpus,
 * and what it therefore buys is a ROBUSTNESS check rather than a harder test:
 *
 *   mini-corpus (parse-side harvest)  965/1217 = 79.3%
 *   eval-first, all resolved minis    413/500  = 82.6%
 *   eval-first, ONLY the 275 minis the parse snapshot does not contain
 *                                      73/93   = 78.5%
 *
 * ⚠ THOSE THREE FIGURES ARE PRE-#1019 AND ARE KEPT ONLY TO PRESERVE THE REASONING
 * ABOVE. Naming the `:`-variant (#1019) moved BOTH arms, because both run the same
 * writers over differently-drawn ask populations.
 *
 * ⚠ AND THE "current values" THAT USED TO SIT HERE — 1058/1217, 430/500, 75/93 —
 * HAD THEMSELVES DRIFTED, to 1055/1217, 427/500 and 76/93, because the duration
 * axis (#1026) moved both arms again. That is the third time this file's headline
 * figures went stale in prose while the test stayed green. They are no longer
 * written here: every one of them is now a pinned constant at the foot of this
 * file, asserted exactly, so it cannot move without failing (#1031).
 *
 * And it cost this file its headline conclusion: the eval arm no longer scores
 * HIGHER than the harvest arm, it scores marginally lower. So that ordering was
 * never a population effect — it was one naming hole falling differently across two
 * heavily-overlapping samples. What survives is the weaker, real claim: the two large
 * populations agree inside ~1pp and the new slice sits ~6pp below them.
 *
 * NOTE FOR WHOEVER CHANGES THE WRITERS NEXT — REVERSED AT #1031. This file used to
 * assert only loose bounds (`> 200`, `>= 142`), so it did not turn red when the
 * rate moved; it did not turn red for #1019, and it did not turn red for #1026
 * either. Every printed headline is now pinned to an exact literal. If you have
 * changed a writer, a reader or the oracle, EXPECT this file to fail — that is the
 * point of it. Re-derive the numbers (measure the new value, then re-measure the
 * OLD value on the current tree, because the difference from the recorded figure
 * is someone else's drift and belongs to them), and update the pins in the same
 * commit that moves them, saying which direction and why.
 *
 * The transfer rate is close to a property of the corpus, not of how the
 * asks were drawn. That is a weaker claim than the prediction wanted and a more
 * useful one than either arm alone could support.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus, hasKnownContent } from './editCoverage'
import {
  boot,
  evalLocations,
  hasCorpusArchive,
  loadCorpus,
} from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'
import {
  admitProposals,
  QUERY_CYCLES,
} from '../../../editor/src/codeView/miniSource/evalProposals'
import { resolveMiniSource } from '../../../editor/src/codeView/miniSource/resolveMiniSource'
import { SpanIndex } from '../../../editor/src/codeView/miniSource/spanRole'
import {
  parseStepGridCore,
  parsePianoRollCore,
  projectStepGridDerived,
  projectPianoRollDerived,
} from '../../../editor/src/codeView/notation/parse'
import type { PianoRollModel, StepGridModel } from '../../../editor/src/codeView/notation/model'
import { GRID_SURFACE, ROLL_SURFACE, probeEdit } from './engineEditOracle'

const NO_CORE_REFUSAL = { ok: false as const, reason: '(core served this — no refusal)' }

/**
 * The mini-corpus arm's headline, READ from the artifact that arm emits rather
 * than transcribed into a comment here (#1031).
 *
 * It used to be a hand-copied literal, and it said `965/1217 = 79.3%` for three
 * merges after the real value had moved to 1055/1217 — a pre-fix number printed
 * one line away from post-fix ones, which is exactly the side-by-side-populations
 * error this whole comparison exists to guard against. The objection to deriving
 * it was that importing the other TEST file would make each unrunnable alone.
 * That objection does not apply to its committed OUTPUT: `WRITER-CENSUS.json` is
 * a file, reading it couples nothing, and a stale read is now impossible because
 * the figure IS the other arm's own output rather than a copy of it.
 */
function miniCorpusArm(): { transfers: number; asks: number; pct: string } {
  const j = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'WRITER-CENSUS.json'),
      'utf8',
    ),
  ) as { rows: { outcome: string }[] }
  const transfers = j.rows.filter((r) => r.outcome === 'transfers').length
  return {
    transfers,
    asks: j.rows.length,
    pct: ((100 * transfers) / j.rows.length).toFixed(1) + '%',
  }
}

const SURFACES = [
  {
    key: 'step' as const,
    core: parseStepGridCore,
    derived: (m: string) => projectStepGridDerived(m, NO_CORE_REFUSAL),
    edit: GRID_SURFACE,
  },
  {
    key: 'roll' as const,
    core: parsePianoRollCore,
    derived: (m: string) => projectPianoRollDerived(m, NO_CORE_REFUSAL),
    edit: ROLL_SURFACE,
  },
]

describe('the reach transfer over the EVAL-FIRST ask population', () => {
  // `.bakery-runs/` is gitignored — unreviewed third-party tunes (#1307). On a
  // machine without it this SKIPS and vitest reports it as skipped, rather than
  // dying on an ENOENT naming a path git refuses to track. The rule is imported,
  // never restated, so it cannot drift from the read it guards.
  it.skipIf(!hasCorpusArchive())('re-derives the ask population from evaluation and reports how the rate moves', async () => {
    const docs = await loadCorpus()
    expect(docs.length).toBe(150)
    const { missingModules } = (await boot()) as { missingModules: string[] }

    /** every mini the eval-first resolver hands a writer, across all 150 documents */
    const resolved = new Set<string>()
    /** …and only the ones for units the parse-side walk did NOT already offer */
    const newlyAdmitted = new Set<string>()
    let evalOk = 0
    let units = 0
    let resolvedUnits = 0

    for (const doc of docs) {
      const us = unitsWithStatus(doc.code)
      const ev = await evalLocations(doc.code, QUERY_CYCLES)
      if (ev.ok) evalOk++
      if (us.length === 0) continue
      const index = SpanIndex.build(doc.code)
      const proposals = admitProposals({
        miniLocations: ev.declared,
        locations: ev.seen,
      }).proposals

      for (const { unit, status } of us) {
        units++
        const r = resolveMiniSource(doc.code, unit, { proposals, index })
        if (!r.ok) continue
        resolvedUnits++
        const text = r.text.trim()
        if (text === '') continue
        resolved.add(text)
        // A unit the coverage harness offers no view for today: its mini is not in
        // the parse-side snapshot, so this is the part of the population the
        // mini-corpus excludes.
        //
        // `!hasKnownContent`, not `!== 'note'` — the same string until #1260,
        // and this arm means the first. A view DOES open on a single-note unit,
        // so term 3 declining to count it in the coverage fraction must not push
        // it into "no view opens on this": that would have grown this set by
        // exactly the 154 units term 3 excluded and read as a reach REGRESSION
        // in the one field of this population a reach change is allowed to move.
        if (!hasKnownContent(status)) newlyAdmitted.add(text)
      }
    }

    /** run the census counterfactual over an arbitrary set of minis */
    const rate = (set: Set<string>) => {
      let coreServed = 0
      let transfers = 0
      let untransferable = 0
      let unverified = 0
      for (const mini of set) {
        for (const s of SURFACES) {
          const core = s.core(mini)
          if (!core.ok) continue
          coreServed++
          const d = s.derived(mini)
          if (!d.ok) {
            untransferable++
            continue
          }
          const v = probeEdit(mini, d.model as StepGridModel & PianoRollModel, s.edit).verdict
          if (v === 'ok') transfers++
          else if (v === 'corrupt') untransferable++
          else unverified++
        }
      }
      return { coreServed, transfers, untransferable, unverified }
    }

    const all = rate(resolved)
    const fresh = rate(newlyAdmitted)
    const otherArm = miniCorpusArm()
    const pct = (a: number, b: number) => (b === 0 ? 'n/a' : ((100 * a) / b).toFixed(1) + '%')

    console.log(
      [
        `\n─── reach transfer over the EVAL-FIRST ask population ───`,
        `eval coverage        ${evalOk}/${docs.length}  — the population this arm could reach at all`,
        `units                ${units}, of which ${resolvedUnits} got a span`,
        `distinct minis        ${resolved.size}  (of these, ${newlyAdmitted.size} are for units no view is offered for today)`,
        ``,
        `ALL eval-resolved minis:`,
        `  core-served asks    ${all.coreServed}`,
        `  transfers           ${all.transfers}  (${pct(all.transfers, all.coreServed)})`,
        `  untransferable      ${all.untransferable}  (${pct(all.untransferable, all.coreServed)})`,
        `  unverified          ${all.unverified}`,
        ``,
        `ONLY the newly-admitted minis — the slice mini-corpus.json excludes:`,
        `  core-served asks    ${fresh.coreServed}`,
        `  transfers           ${fresh.transfers}  (${pct(fresh.transfers, fresh.coreServed)})`,
        `  untransferable      ${fresh.untransferable}  (${pct(fresh.untransferable, fresh.coreServed)})`,
        `  unverified          ${fresh.unverified}`,
        ``,
        // DERIVED from `WRITER-CENSUS.json`, that arm's own committed output — no
        // longer transcribed, so it cannot disagree with the arm it reports on.
        `mini-corpus arm, for comparison: ${otherArm.transfers}/${otherArm.asks} = ${otherArm.pct} transfer`,
        `modules NOT registered ${missingModules.length ? missingModules.join('; ') : 'none'}`,
      ].join('\n'),
    )

    /* ── the bounds that express INTENT ──────────────────────────────────────── */

    // The arm has to contain minis the parse-side snapshot does not, or it is
    // measuring the same thing twice and its agreement means nothing. Note this is
    // NOT a superset check — see the header: this population is smaller overall,
    // and that is the correction the run forced.
    expect(newlyAdmitted.size).toBeGreaterThan(200)
    // Eval coverage belongs beside every figure computed from an eval sweep: this
    // arm is over the documents that evaluated, and the floor is #1008's.
    expect(evalOk).toBeGreaterThanOrEqual(142)
    // Both arms must find a non-trivial core-served population, or the comparison
    // of their rates is between two numbers one of which is noise.
    expect(all.coreServed).toBeGreaterThan(200)

    /* ── the PINS (#1031) ────────────────────────────────────────────────────────
     * Every figure the report above prints, asserted exactly. The bounds alone let
     * this file print three generations of stale headlines while staying green;
     * they say what must never be true, and say nothing about what IS true.
     *
     * A bound and a pin answer different questions and this file needs both: the
     * bound survives an intended change, the pin makes an unintended one loud.
     */
    expect({
      evalOk,
      docs: docs.length,
      units,
      resolvedUnits,
      resolvedMinis: resolved.size,
      newlyAdmitted: newlyAdmitted.size,
    }).toEqual(POPULATION)

    expect(all).toEqual(ALL_RESOLVED)
    expect(fresh).toEqual(NEWLY_ADMITTED)
    expect({ transfers: otherArm.transfers, asks: otherArm.asks }).toEqual(MINI_CORPUS_ARM)

    // A module that stops registering silently shrinks the population every figure
    // above is computed over — a restriction that would otherwise appear only as a
    // number moving for no visible reason. Pinned by NAME so a NEW one fires while
    // the known-broken one stays quiet.
    expect(missingModules.map((m) => m.split(':')[0]).sort()).toEqual(MISSING_MODULES)
  }, 900_000)
})

/* ── PINNED FIGURES (#1031) ───────────────────────────────────────────────────
 * Observed 2026-07-27. These are the numbers the header used to carry as prose
 * and get wrong three times running. Moving one is a real event: re-derive it,
 * establish whether the movement is yours or drift someone else's change left
 * behind, and update it here in the commit that causes it.
 */

/** the ask population this arm draws, before any writer is asked anything */
const POPULATION = {
  evalOk: 142,
  docs: 150,
  units: 1039,
  resolvedUnits: 898,
  resolvedMinis: 671,
  // ⚠⚠ newlyAdmitted MOVED 269 → 220 at #1240, and again it is the only field of this
  // population that moved — the same slice, moved by the same mechanism from the other
  // direction. `status.status !== 'note'` means "the coverage harness offers this unit no
  // note view today", so WIRING the resolver into `chunkDetect` is precisely the thing
  // that empties this set: 49 distinct minis stopped qualifying because a view now opens
  // on them. The drop IS the deliverable, and it is the only pin here that a reach change
  // should ever move. Its counterpart figures live in `miniSource-calibration`
  // (known-content 534 → 600) and are asserted in this same commit.
  //
  // ⚠ Do NOT read 269 - 220 = 49 as "49 units gained a view": this arm counts DISTINCT
  // MINIS, the calibration counts UNITS, and one mini can serve several units. Both
  // denominators are named because a figure quoted without one is how this file's own
  // header went wrong three times ([[P549]]).
  //
  // ⚠ newlyAdmitted MOVED 266 → 269 at #1010 P4c, and it was the only field of this
  // population that moved. The mechanism is the PRINTER, reaching a population figure
  // through the parse side: `status.status !== 'note'` means "the coverage harness offers
  // this unit no note view today", and the parser asks the writer before it offers one
  // (`parse.ts:1638`). Once the printer preserves lengths, 10 units whose length the
  // column resolution cannot spell stop being offered a derived grid — and exactly 3 of
  // those 10 are in this arm's eval-resolved set, so they cross into `newlyAdmitted`:
  // `[hh ~]!16`, `lp:6/4`, `~ ~ ~ bd(<2 4!2>, 8)`. Observed by intersecting this set with
  // the 10 the attribution sweep named, not deduced from the delta being 3.
  // ⚠ UNMOVED AT #1260, AND THAT IS THE RESULT, NOT A NON-EVENT. That change
  // split `note` into two statuses, so the two notes above — both of which
  // explain this field in terms of the literal string `status.status !== 'note'`
  // — describe a test the code no longer spells that way. The membership rule is
  // now `!hasKnownContent(status)`, which is what those notes always MEANT: "no
  // view opens on this unit". Reading the old spelling forward would have grown
  // this set by 154 and reported a reach regression from a change that touched
  // no resolver. Left at 220, verified in the same run as the wiring.
  // ⚠ 220 -> 217 at #1849: three units on which no view opened now open (the stacks it reads
  // part by part), so they leave the set of units only evaluation admits.
  // ⚠ newlyAdmitted 217 -> 215 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
  // ⚠ newlyAdmitted 215 -> 201 at #2142 (a progression written in `chord("…")` opens in the
  // Pattern tab): fourteen distinct `chord` strings now open a chord chart, so they leave the
  // set of units only evaluation admits. Only this field moved, as at #1240 and #1849.
  newlyAdmitted: 201,
}

/**
 * the counterfactual over every eval-resolved mini
 *
 * ⚠ MOVED 427/33 → 431/29 at #1010 P4c. The length-preserving printer recovers 4 of this
 * arm's asks from untransferable to transfers; `coreServed` (500) and `unverified` (40) do
 * not move at all, which is what says the population is the same and only fidelity
 * changed. The sibling arm's equivalent move is +9 over its 1204 asks — a different
 * number over a different population, as it should be, and neither is the other's check.
 */
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
// ⚠ transfers 439 -> 440, untransferable 28 -> 27 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const ALL_RESOLVED = { coreServed: 509, transfers: 440, untransferable: 27, unverified: 42 }

/**
 * the counterfactual over ONLY the slice `mini-corpus.json` does not contain
 *
 * ⚠⚠ MOVED 93/78/5/10 → 32/22/1/9 at #1240, and the SHAPE of that move is the
 * finding. The slice itself shrank only 18% (269 → 220 minis), but `coreServed`
 * fell 65% and `transfers` 72% — so the minis that left are overwhelmingly the
 * ones a writer could already serve. That is the wiring working exactly as
 * intended: "a writer can serve this" and "a view now opens on it" are close to
 * the same predicate, so admitting them into the product is precisely what
 * removes them from a slice defined as "no note view today". The residual is
 * the harder tail, which is why its rate is worse and should be.
 *
 * ⚠ It is NOT evidence that anything got worse. The check that says so is
 * `ALL_RESOLVED` directly above: over every eval-resolved mini it is UNMOVED
 * (500/435/25/40). Same writers, same answers, same population — only the
 * partition between "already offered" and "newly admitted" moved. A drop here
 * with `ALL_RESOLVED` also moving would be a regression; a drop here alone is
 * the transfer this issue exists to cause. Read the pair, never this line
 * alone.
 *
 * ⚠ MOVED 76/7 → 77/6 at #1010 P4c — one of the four above falls in this slice.
 *
 * ⚠ MOVED 32/22/1/9 → 21/12/1/8 at #2142, the same shape as #1240 and for the same
 * reason: `chord("…")` literals now open the chord chart, so fourteen minis left this
 * slice (215 → 201), and they were mostly ones a writer already serves. `ALL_RESOLVED`
 * above is UNMOVED in the same run (509/440/27/42), so only the partition moved.
 */
const NEWLY_ADMITTED = { coreServed: 21, transfers: 12, untransferable: 1, unverified: 8 }

/**
 * The sibling arm's headline, pinned here too even though it is DERIVED from
 * `WRITER-CENSUS.json`. Deriving stops the two disagreeing; pinning is what makes
 * the sibling's own movement visible from this side, which is the failure that
 * started this — 965/1217 sat here across three merges of someone else's change.
 */
// ⚠ asks 1273 -> 1275 at #1827, transfers UNMOVED: the two units the core newly serves
// drawn per bar are untransferable (the derived projections still cap at 64 columns).
// ⚠ 1096/1275 -> 1106/1303 at #1849 — writer-census.test.ts's own figures, which this arm must equal.
// ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
// ⚠ transfers 1107 -> 1108 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const MINI_CORPUS_ARM = { transfers: 1108, asks: 1306 }
// ⚠ MOVED 1041/1204 -> 1096/1273 at #1242, when the harvest gained the product's own
// resolver and the corpus went 1535 -> 1633 units. The pin FIRED again, which is what
// it is for: +69 asks and +55 transfers, both upward, so the rate falls 86.5% -> 86.1%
// on a wider population rather than on worse writers.
// ⚠ MOVED 1055/1217 -> 1026/1204 at #1037, when the harvester was rebuilt and the
// corpus went 1500 -> 1535 units. This pin FIRED on that change, which is the whole
// reason it exists: the sibling arm moved and this side found out immediately
// instead of three merges later. Note what did NOT move — this arm's own
// population is derived from EVALUATION, and evaluation never sees commented-out
// code, so shedding the 94 dead-code strings changed the sibling without touching
// the 266 newly-admitted here.
//
// ⚠ MOVED AGAIN 1026 -> 1035 at #1010 P4c (asks unchanged at 1204): the sibling's eleven
// duration failures are gone, 9 to `transfers` and 2 to `no-view`. This pin FIRED a second
// time, and it caught something better than drift on the way — it briefly read **1051**,
// because measuring the P6 blocker at `LEAF_PROJECT_BARS.roll = 12` re-runs the sibling
// harness and rewrites `WRITER-CENSUS.json` on disk. This arm DERIVES from that file, so a
// throwaway measurement had left a cap-12 figure sitting in a committed artifact. Anything
// that runs the sibling with a constant changed must regenerate the JSON at the shipped
// constant afterwards, and this pin is what makes forgetting loud instead of silent.

/**
 * Known-unregistered modules. `@strudel/soundfonts` fails on a CommonJS interop
 * problem with `soundfont2` and has done throughout; it is pinned rather than
 * fixed so that a SECOND module joining it turns this red instead of quietly
 * removing documents from every figure above.
 */
const MISSING_MODULES = ['@strudel/soundfonts']
