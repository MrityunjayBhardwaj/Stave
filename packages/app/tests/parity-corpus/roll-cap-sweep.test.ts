/**
 * roll-cap-sweep.test.ts — the piano roll's leaf period cap, measured on BOTH of the
 * populations it governs, reported separately and never netted (#1020).
 *
 * WHY THIS FILE EXISTS. `LEAF_PROJECT_BARS.roll` was set to 4 by a sweep at 4/6/8/12/16
 * that showed exactly zero gain at every value. That sweep ran through
 * `writer-reach.test.ts`, whose population is one line — `if (core.ok) continue`. So it
 * asked "does raising the roll's cap help the patterns the syntactic core REFUSES?" and
 * the honest answer was no. **A gate defined as another gate's complement carries a
 * population restriction that none of its numbers mention** ([[P345]]): the other half —
 * the 414 roll asks the core SERVES — was never swept, and there the same cap is the
 * single largest blocker on the reach the core is the sole provider of.
 *
 * So this gate sweeps both:
 *
 *   POPULATION A — core-REFUSED (`parsePianoRollCore` says no).  `writer-reach`'s
 *                  population. What a cap raise BUYS on top of what already ships.
 *   POPULATION B — core-SERVED (`parsePianoRollCore` says yes).  The writer census's
 *                  population. What a cap raise SAVES when the core is deleted (#1012).
 *
 * They are reported as two numbers with their populations named. A single netted figure
 * is the exact error this file was filed to undo, and it would hide the finding: the two
 * populations move in opposite directions because they are made of different notation —
 * A's long-period roll patterns are `!n`/`@n` REPETITIONS whose notes share one source
 * atom, B's are branch ALTERNATIONS whose notes each own their token.
 *
 * REACH IS NOT ENOUGH, AND THAT IS THE OTHER HALF OF THE ORIGINAL DECISION. The cap was
 * left at 4 partly because the views a raise opened were only **13–58% live** — a roll
 * where almost nothing the user drags moves reads as broken, which is worse than an
 * honest refusal ([[PV222]]). So every view this reports carries `liveness` (the
 * fraction of its cleanly-singleton notes whose own delete round-trips through the
 * engine) and `structured` (more than one note — a one-note roll is a correct model and
 * a useless surface). `liveness` comes from `engineEditOracle.ts`, so the sweep and the
 * reach gate cannot disagree about what "an edit survived" means; `structured` comes
 * from `notation/model.ts`'s `hasStructure`, so this sweep and the writer census cannot
 * disagree about what "worth showing" means (#1259 — it used to be spelled here, which
 * is what that sentence originally papered over by naming one source for both).
 *
 * HOW A SWEEP IS RUN. The cap is a module constant, deliberately — it is a shipped
 * bound, not a knob, and threading a parameter through the writer to sweep it would mean
 * measuring a code path production never takes. To sweep, set the constant, run this
 * file, repeat. `scripts/cap-sweep.mjs` drives that and diffs the emitted rows PER
 * ASK, which is what makes "additive only" checkable rather than assertable.
 *
 * The cap this run measured is READ BACK OUT OF THE SHIPPED REFUSAL SENTENCE rather than
 * taken from the environment: a sweep that labels its rows from its own driver can
 * silently attribute one cap's numbers to another, and an instrument's label is exactly
 * the kind of claim that has been wrong here before ([[P347]]).
 *
 * ⚠ THE MACHINERY MOVED TO `capSweep.ts` AT #1041, when the grid got the same treatment.
 * Nothing about this measurement changed in that move — the sweep, the report, the
 * artifact and the table are the same code, now taking a surface. What did NOT move is
 * the reading: the two halves of `LEAF_PROJECT_BARS` govern populations that respond to
 * it differently, so the sentences interpreting these numbers live below rather than in
 * the shared module. See the population-B floor in particular.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROJECTION_PERIOD_BOUNDS,
  parsePianoRoll,
  parsePianoRollCore,
  projectPianoRollDerived,
} from '../../../editor/src/codeView/notation/parse'
import { ROLL_SURFACE } from './engineEditOracle'
import {
  readObservation,
  report,
  shippedCap,
  sweep,
  writeRunArtifact,
  type CapSurface,
  type Row,
} from './capSweep'
import {
  assertSweepObservationCoherent,
  assertSweepObservationCurrent,
  readSweep,
  renderSweepTable,
  spliceSweepBlock,
} from './capSweepTable'
import { blockMarkers } from './generatedDoc'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

const ROLL: CapSurface = {
  cap: 'roll',
  parse: (m) => parsePianoRoll(m),
  core: (m) => parsePianoRollCore(m),
  derived: (m, fallback) => projectPianoRollDerived(m, fallback),
  oracle: ROLL_SURFACE,
  // period 26 — past `PERIOD_SEARCH`, so past every admissible cap at every sweep value.
  // Numbers, because that is the roll's own vocabulary; the grid needs a different probe
  // for exactly that reason ([[PK99]]).
  capProbe: '<0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25>',
  runsDir: '.roll-cap-runs',
  doc: 'ROLL-CAP-SWEEP.md',
  observation: 'ROLL-CAP-SWEEP.json',
  block: blockMarkers('SWEEP-TABLE', '#1270', 'roll-cap-sweep.test.ts'),
  script: 'node scripts/cap-sweep.mjs 4 6 8 12',
  asksNoun: 'roll asks',
  unitNoun: 'note',
  aNote:
    'It is the population production reaches today, and it is the ' +
    'reason the cap has not been raised: the gain there is a rounding error.',
  bNote:
    'every one served by the leaf writer, which is the writer this ' +
    'cap governs. B is a counterfactual until the core is deleted.',
}

const CAP = shippedCap(ROLL)
const rowsA = sweep(ROLL, 'A-core-refused', minis)
const rowsB = sweep(ROLL, 'B-core-served', minis)

describe(`the roll's leaf period cap at ${CAP}, on both populations it governs`, () => {
  it('reports each population separately, and neither may corrupt', () => {
    report(ROLL, rowsA, 'A-core-refused', CAP)
    report(ROLL, rowsB, 'B-core-served', CAP)
    writeRunArtifact(ROLL, corpusDir, CAP, [...rowsA, ...rowsB])

    // THE MUST-NOT, at every cap: a derived view that mis-writes is worse than no view.
    for (const rows of [rowsA, rowsB])
      expect(
        rows.filter((r) => r.outcome === 'view-corrupts').map((r) => r.mini),
        'a derived roll view corrupts on edit',
      ).toEqual([])

    // …and the stronger form the reach gates cannot state, because they verify ONE note
    // per view: over EVERY cleanly-singleton note of every bar, nothing mis-writes. A
    // note may be declined — that is a dead cell, and the liveness figure above is what
    // reports it — but no note may write the document back wrong.
    for (const rows of [rowsA, rowsB])
      expect(
        rows.filter((r) => (r.liveCorrupt ?? 0) > 0).map((r) => r.mini),
        'a note this view offers mis-writes, and the one-note probe does not reach it',
      ).toEqual([])
  })

  it('holds both populations at or above the reach they had when the cap was last decided', () => {
    // FLOORS, not snapshots — the same contract `writer-reach` uses. They are stated per
    // POPULATION on purpose: a single netted figure is what let one population's null
    // result decide this cap for both of them ([[P345]]), and these two move
    // independently. Raise them (never lower them silently) when a gain is shipped and
    // re-observed on the population it belongs to.
    const transfers = (rows: Row[]): number => rows.filter((r) => r.outcome === 'transfers').length

    // Population A is the one production reaches today. Its reach is `writer-reach`'s
    // roll floor and must agree with it — two gates disagreeing about the same number
    // over the same population would mean one of them is measuring something else.
    // ⚠ 75 -> 85 at #1037 (corpus rebuilt: backtick minis in, commented-out code
    // out). No runtime code changed in that diff, so the move is the population's.
    // ⚠⚠ 85 -> 95 at #1270, and the raise is that issue's point rather than a side
    // effect of it. #1242 widened the corpus 1535 -> 1633 and the observed value went to
    // 95 while this line stayed at 85 — ten units of headroom a real regression could
    // have consumed with the gate still green ([[P541]]).
    //
    // PROVED AS A PAIRED DIFFERENTIAL, not typed in. The regression this floor exists to
    // catch is this cap going backwards, and it lands exactly where a differential needs
    // it to: LEAF_PROJECT_BARS.roll 4 -> 3 or 2 gives **93**, and 4 -> 1 gives **89** —
    // every one of them PASSES at the old 85 and REDDENS at the new 95. Raised in the
    // same change as the measurement that found the gap.
    // ⚠ LOWERED 95 -> 89 at #1849, and not by slack: the population moved. Eighteen rolls whose `,`-parts the flat reading refused, or whose parts differ in width, now open through the core, so they left population A (A.opened 145 -> 127) and their asks with them — A.transfers 97 -> 89, B.transfers 369 -> 377, conserved. RE-PROVED as a paired differential on this tree (`cap-sweep.mjs`): cap 4 (shipped) 89, 3 -> 87, 1 -> 84 — every lower cap reddens at 89.
    expect(transfers(rowsA), 'population A reach fell below the committed roll floor').toBeGreaterThanOrEqual(89)

    // Population B's is what the core's deletion would inherit (#1012). It is a floor
    // and not a target: it only becomes user-facing when the core stops answering first.
    // ⚠ 347 -> 339 at #1037, same cause and the opposite direction: population B is
    // the core-SERVED arm, and the commented-out strings this corpus stopped
    // harvesting were disproportionately simple ones the core served and the
    // projection transferred. Losing fiction lowers a count; it does not lower reach.
    // ⚠⚠ 339 -> 369 at #1270 — thirty units of headroom, the wider of the two, opened by
    // #1242's corpus widening and never closed.
    //
    // ⚠⚠ AND THE DIFFERENTIAL THAT PROVES THE OTHER FLOOR CANNOT BE BUILT FOR THIS ONE —
    // the inability is the finding ([[P532]]). Population B reads **369 at cap 4, 3, 2 AND
    // 1**, and 370 with `PERIOD_PROBE` cut from 24 to 8. Nothing this file's own constant
    // can do moves it DOWN; the only direction it moves is up (386 at cap 12). The reason
    // is in the run's own report: of B's 415 opened views at the shipped cap, **399 are
    // served by the ELEMENT writer and 16 by the leaf writer** — and this cap governs only
    // the leaf. So this floor, unlike A's, is not a guard on the constant this file
    // sweeps. It guards the element writer, which nothing here varies.
    //
    // ⚠ THIS SENTENCE IS ABOUT THE ROLL AND DOES NOT TRAVEL. The grid's population B has
    // 74 of 820 leaf-served rather than 16 of 415, and it DOES move with the cap — its
    // floor in `grid-cap-sweep.test.ts` carries a real differential. Sibling surfaces do
    // not share a constant's sensitivity even where they share the constant (#1041).
    //
    // It is raised anyway, because a floor thirty below its observation is headroom
    // whatever it guards. But do not read a green run here as evidence about the roll's
    // period cap: the number is real and the cap is not what it is sensitive to. A
    // regression that would redden it has to come from `projectPianoRollDerived`'s element
    // path or from the corpus, and neither is exercised by this sweep.
    expect(transfers(rowsB), 'population B transfer count fell').toBeGreaterThanOrEqual(369)
  })

  it('never admits a period it has not verified — the cap stays within half the probe window', () => {
    // `detectPeriod` confirms period p by finding a repeat among the probed cycles, so p
    // is only VERIFIED once 2p cycles were probed. At p = 16 against a 24-cycle probe,
    // cycles 8–15 are checked against nothing and a period-32 pattern masquerades as
    // period-16 — a view that silently stops being true one cycle past its own width.
    //
    // Taken from the shipped bound rather than written out as `12` (#1025). The literal
    // could not track `PERIOD_PROBE`, so raising the probe would have left this
    // stale-but-GREEN — a guard observable only in the passing state.
    expect(CAP).toBeLessThanOrEqual(PROJECTION_PERIOD_BOUNDS.maxVerifiedBars)

    // and the label is not a misattribution: nothing refused for period has a period
    // the cap would have admitted
    for (const rows of [rowsA, rowsB]) {
      const within = rows
        .filter((r) => r.gate === 'unstable-period' && r.period! > 0 && r.period! <= CAP)
        .map((r) => `period=${r.period} ${r.mini}`)
      expect(within, 'refused for period, but the period is within the cap').toEqual([])
    }
  })

  /**
   * THE SWEEP TABLE IS GENERATED, NOT TRANSCRIBED (#1270).
   *
   * `ROLL-CAP-SWEEP.md`'s headline table was typed out of a run on the 1535-unit corpus
   * and #1242 moved the world underneath it. Every figure had drifted: populations
   * 1086/414 against 1180/453, A reach 85/85/86/86 against 95/95/96/96, B transfers
   * 339/340/352/355 against 369/371/383/386.
   *
   * ⚠ AND THE CLAIMS AROUND IT SURVIVED THE DRIFT INTACT — "A's reach moves by exactly one
   * ask", "zero asks moved to a worse outcome" — so the DECISION the document reaches was
   * still right while all four of the numbers under it were wrong. A conclusion that
   * outlives its evidence is the worst thing to leave transcribed, because nothing about
   * it looks stale. Nothing here asserts the document's text; splicing removes the drift
   * by construction, and the splice throws rather than silently appending ([[P497]]).
   *
   * Only at the shipped cap: a sweep run at 6, 8 or 12 has a live column for a cap this
   * tree does not ship, and writing that into the document as "shipped" is the
   * mislabelling this gate reads its own cap back out of the refusal sentence to avoid.
   */
  it('generates the sweep table into its document rather than letting it transcribe one', () => {
    const obs = readObservation(ROLL, corpusDir)
    if (CAP !== obs.companion.cap) {
      console.log(`  (cap ${CAP} is not the shipped ${obs.companion.cap} — not splicing a sweep run into the document)`)
      return
    }
    const at = path.join(corpusDir, ROLL.doc)
    const body = renderSweepTable(ROLL, obs, readSweep([...rowsA, ...rowsB], CAP))
    fs.writeFileSync(at, spliceSweepBlock(ROLL, fs.readFileSync(at, 'utf8'), body))
  })

  /**
   * THE THREE COLUMNS NO RUN CAN PRODUCE, AND THEIR EXPIRY (#1270).
   *
   * Caps 6, 8 and 12 are observations: the cap is a module constant, so reading the sweep
   * at any of them means rewriting `parse.ts` and running again, which no gate can do.
   * What every run DOES produce is the shipped cap's reading, recorded beside them by the
   * same sweep — so when that stops matching this tree, the three observed columns are
   * stale and this says so.
   *
   * ⚠ Necessary, not sufficient: a change touching only patterns whose period falls in
   * (4, 12] moves the observed columns and leaves this green. The limit travels with the
   * mechanism in `generatedDoc.ts`.
   */
  it('the committed sweep observation is still about this tree', () => {
    const obs = readObservation(ROLL, corpusDir)
    assertSweepObservationCoherent(ROLL, obs)
    assertSweepObservationCurrent(ROLL, obs, [...rowsA, ...rowsB], CAP)
  })
})
