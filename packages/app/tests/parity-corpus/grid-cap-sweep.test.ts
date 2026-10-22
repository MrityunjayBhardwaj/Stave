/**
 * grid-cap-sweep.test.ts — the step grid's leaf period cap, measured on BOTH of the
 * populations it governs, reported separately and never netted (#1041).
 *
 * WHY THIS FILE EXISTS. `LEAF_PROJECT_BARS` is one declaration with two fields and only
 * the roll's half had a gate. The grid's 12 was justified by a figure in a doc comment —
 * "+17 writer-reach over the 1500-unit corpus (109 → 126)" — and every time anyone
 * re-took that figure it had moved: it was recorded at #991 as "+9 (95 → 104)".
 *
 * ⚠⚠ AND THE HEADLINE WAS STILL EXACT WHILE BOTH FIGURES UNDER IT HAD DRIFTED. Re-measured
 * on this tree the GAIN is still the same digit and neither endpoint is. A delta is
 * precisely the shape a population change preserves — #1242 moved both terms by nearly the
 * same amount — so the number most likely to be quoted is the one least likely to look
 * stale, and a reader who spot-checks the gain walks away having certified two wrong
 * endpoints. That is why the comment on the constant now points at this gate instead of
 * carrying the number, and why today's pair is not written out here either: the floor
 * below is asserted, and the rest is in the generated table.
 *
 * THE TWO POPULATIONS, the same carve the roll sweep uses:
 *
 *   POPULATION A — core-REFUSED (`parseStepGridCore` says no).  `writer-reach`'s
 *                  population. What the cap BUYS on top of what already ships.
 *   POPULATION B — core-SERVED (`parseStepGridCore` says yes).  The writer census's
 *                  population. What the cap SAVES when the core is deleted (#1012).
 *
 * They are reported as two numbers with their populations named. A single netted figure is
 * the error that set the ROLL's cap to 4 on one population's null result read as general
 * ([[P345]]), and it is cheap enough to repeat that this file refuses to net them.
 *
 * ⚠⚠ BOTH OF THIS SURFACE'S POPULATIONS MOVE, AND THE ROLL'S B DOES NOT — do not carry the
 * roll's reading across. `roll-cap-sweep.test.ts` records that its own B floor "is not a
 * guard on the constant this file sweeps", because only 16 of the roll's 415 opened B views
 * are leaf-served and this cap governs only the leaf writer. The grid's B has **74 of 820**
 * leaf-served, and it moves. Both floors below therefore carry a real paired differential,
 * which the roll's B floor could not ([[PV338]]).
 *
 * HOW A SWEEP IS RUN. The cap is a module constant, deliberately — it is a shipped bound,
 * not a knob, and threading a parameter through the writer to sweep it would mean measuring
 * a code path production never takes. To sweep, set the constant, run this file, repeat.
 * `scripts/cap-sweep.mjs grid 4 6 8 10 12` drives that and diffs the emitted rows PER
 * ASK, which is what makes "additive only" checkable rather than assertable.
 *
 * The cap this run measured is READ BACK OUT OF THE SHIPPED REFUSAL SENTENCE rather than
 * taken from the environment ([[P347]]) — and the grid needs its own probe pattern for it,
 * because the roll's plays numbers and this surface refuses those before the period gate is
 * ever reached ([[PK99]]).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROJECTION_PERIOD_BOUNDS,
  parseStepGrid,
  parseStepGridCore,
  projectStepGridDerived,
} from '../../../editor/src/codeView/notation/parse'
import { GRID_SURFACE } from './engineEditOracle'
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

/**
 * 26 DISTINCT sound names, and every word of that is load-bearing ([[PK99]]).
 *
 * The roll's probe is `<0 1 … 25>`, which this surface refuses for `wrong-surface` — it
 * plays numbers, so it routes to the roll. Twenty-five identical `bd` alternatives get as
 * far as `edit-unsafe`, which claims them before the period gate. Distinct sounds reach
 * `unstable-period`, which is the gate whose sentence names the cap. Verified by asserting
 * the GATE the probe stops at, not merely that it refuses — `shippedCap` throws on any
 * other gate rather than mislabelling the run's rows.
 */
const GRID_CAP_PROBE =
  '<bd sd hh oh cp rim lt mt ht rd cr sh tb misc perc can metal east crow click hand numbers space wind jazz jvbass>'

const GRID: CapSurface = {
  cap: 'grid',
  parse: (m) => parseStepGrid(m),
  core: (m) => parseStepGridCore(m),
  derived: (m, fallback) => projectStepGridDerived(m, fallback),
  oracle: GRID_SURFACE,
  capProbe: GRID_CAP_PROBE,
  runsDir: '.grid-cap-runs',
  doc: 'GRID-CAP-SWEEP.md',
  observation: 'GRID-CAP-SWEEP.json',
  block: blockMarkers('GRID-SWEEP-TABLE', '#1041', 'grid-cap-sweep.test.ts'),
  script: 'node scripts/cap-sweep.mjs grid 4 6 8 10 12',
  asksNoun: 'grid asks',
  unitNoun: 'cell',
  aNote:
    'It is the population production reaches today, and unlike the roll it is the whole ' +
    'justification for the shipped value: this is the gain the comment on ' +
    '`LEAF_PROJECT_BARS` used to carry as a number, and now defers to this gate for.',
  bNote:
    'served by the leaf writer, which is the writer this cap governs. Unlike the roll — ' +
    'where only 16 of 415 opened B views are leaf-served, so its B floor guards nothing ' +
    'this constant can move — the grid has 74 of 820, and B moves with the cap. Do not ' +
    'read the roll\'s note across. B is a counterfactual until the core is deleted (#1012).',
}

const CAP = shippedCap(GRID)
const rowsA = sweep(GRID, 'A-core-refused', minis)
const rowsB = sweep(GRID, 'B-core-served', minis)

describe(`the grid's leaf period cap at ${CAP}, on both populations it governs`, () => {
  it('reports each population separately, and neither may corrupt', () => {
    report(GRID, rowsA, 'A-core-refused', CAP)
    report(GRID, rowsB, 'B-core-served', CAP)
    writeRunArtifact(GRID, corpusDir, CAP, [...rowsA, ...rowsB])

    // THE MUST-NOT, at every cap: a derived view that mis-writes is worse than no view.
    for (const rows of [rowsA, rowsB])
      expect(
        rows.filter((r) => r.outcome === 'view-corrupts').map((r) => r.mini),
        'a derived grid view corrupts on edit',
      ).toEqual([])

    // …and the stronger form the reach gates cannot state, because they verify ONE cell
    // per view: over EVERY cleanly-singleton cell of every bar, nothing mis-writes. A cell
    // may be declined — that is a dead cell, and the liveness figure above is what reports
    // it — but no cell may write the document back wrong.
    for (const rows of [rowsA, rowsB])
      expect(
        rows.filter((r) => (r.liveCorrupt ?? 0) > 0).map((r) => r.mini),
        'a cell this view offers mis-writes, and the one-cell probe does not reach it',
      ).toEqual([])
  })

  it('holds both populations at or above the reach they had when the cap was last decided', () => {
    // FLOORS, not snapshots — the same contract `writer-reach` and the roll sweep use.
    // Stated per POPULATION on purpose: a single netted figure is what let one
    // population's null result decide the roll's cap for both of them ([[P345]]).
    const transfers = (rows: Row[]): number => rows.filter((r) => r.outcome === 'transfers').length

    // Population A is the one production reaches today. Its reach is `writer-reach`'s STEP
    // floor and must agree with it — two gates disagreeing about the same number over the
    // same population would mean one of them is measuring something else. `FLOOR_STEP`
    // reads 161 there, having been pinned to this same observation at #1273.
    //
    // PROVED AS A PAIRED DIFFERENTIAL, not typed in. The regression this floor exists to
    // catch is this cap going backwards, and it lands where a differential needs it:
    // LEAF_PROJECT_BARS.grid 12 -> 10 gives **160**, 12 -> 8 gives **155**, and 12 -> 6 or
    // 4 gives **144**. Every one of them REDDENS this floor, and the nearest is a single
    // ask at the very next value the constant can take — which is what says the floor is
    // pinned to its observation rather than sitting above a comfortable margin. Slack does
    // not weaken a floor by a proportion; it removes one named catch, and which one is not
    // recoverable from the margin ([[P593]]).
    // ⚠ LOWERED 161 -> 159 at #1849, and not by slack: the population moved. Four grids whose `,`-parts the flat reading refused now open through the core, so they left population A (A.opened 201 -> 197) and their asks with them — A.transfers 161 -> 159, B.transfers 727 -> 729, conserved. RE-PROVED as a paired differential on this tree (`cap-sweep.mjs grid`): cap 12 (shipped) 159, 10 -> 158, 8 -> 153, 6 and 4 -> 142 — every lower cap reddens at 159.
    // ⚠ FLOOR 159 -> 158 at #1849's `<…>` half, a MOVE not a loss (paired differential from the re-taken sweep): population A (core refused) loses 3 asks / 1 transfer / 2 opens and population B (core served) gains exactly 3 / 1 / 2 — the 3 grids the core now reads bar by bar.
    // ⚠ FLOOR 158 -> 157 at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move: the same unit and the same reason as `FLOOR_STEP` in writer-reach.test.ts — `[c eb g <f bb>](3,8,<0 1>)` changed writer and the probe's delete is one the leaf writer declines.
    expect(transfers(rowsA), 'population A reach fell below the committed grid floor').toBeGreaterThanOrEqual(157)

    // Population B's is what the core's deletion would inherit (#1012). It is a floor and
    // not a target: it only becomes user-facing when the core stops answering first.
    //
    // ⚠⚠ AND UNLIKE THE ROLL'S B FLOOR, THIS ONE IS A GUARD ON THE CONSTANT THIS FILE
    // SWEEPS. `roll-cap-sweep.test.ts` records that its own is not — its population B reads
    // 369 at caps 4, 3, 2 AND 1, because only 16 of its 415 opened views are leaf-served
    // and this cap governs only the leaf writer. The grid's B has **74 of 820** leaf-served
    // and the differential exists: grid 12 -> 8 gives **725** and 12 -> 6 gives **722**,
    // both of which redden this floor. That sentence was measured here, not inherited —
    // sibling surfaces do not share a constant's sensitivity even where they share the
    // constant ([[PV338]]).
    //
    // ⚠ STATED LIMIT, and it is why the differential above is quoted at cap 8 rather than
    // at cap 10: 12 -> 10 leaves B UNMOVED at 727. So the nearest value this floor catches
    // is two steps down, where population A's is one. The floor is still pinned to its
    // observation; what it cannot do is detect the smallest possible regression of the
    // constant. That is a property of the population, not slack in the floor.
    //
    // Cross-checked by a second instrument on a different route: the writer census's grid
    // control arm in `P6-CAP12.json` reaches the same 820 asks / 727 transfers.
    expect(transfers(rowsB), 'population B transfer count fell').toBeGreaterThanOrEqual(727)
  })

  it('never admits a period it has not verified — the cap stays within half the probe window', () => {
    // `detectPeriod` confirms period p by finding a repeat among the probed cycles, so p is
    // only VERIFIED once 2p cycles were probed. At p = 16 against a 24-cycle probe, cycles
    // 8–15 are checked against nothing and a period-32 pattern masquerades as period-16 — a
    // view that silently stops being true one cycle past its own width.
    //
    // ⚠ THE GRID SHIPS AT THIS BOUND, WHICH THE ROLL DOES NOT. 12 is exactly
    // `maxVerifiedBars`, so this is not headroom here — it is the binding constraint, and
    // raising `PERIOD_PROBE` is the only change that could ever move this cap up. Taken
    // from the shipped bound rather than written out as `12` (#1025): a literal could not
    // track `PERIOD_PROBE`, and would have left this stale-but-GREEN.
    expect(CAP).toBeLessThanOrEqual(PROJECTION_PERIOD_BOUNDS.maxVerifiedBars)

    // and the label is not a misattribution: nothing refused for period has a period the
    // cap would have admitted
    for (const rows of [rowsA, rowsB]) {
      const within = rows
        .filter((r) => r.gate === 'unstable-period' && r.period! > 0 && r.period! <= CAP)
        .map((r) => `period=${r.period} ${r.mini}`)
      expect(within, 'refused for period, but the period is within the cap').toEqual([])
    }
  })

  /**
   * THE SWEEP TABLE IS GENERATED, NOT TRANSCRIBED (#1041, the discipline from #1046/#1270).
   *
   * The figure this document replaces drifted twice before anyone re-took it, and the
   * second time it drifted while its own headline stayed exact. Nothing here asserts the
   * document's text: a test that writes a file and then checks it is circular. Splicing
   * removes the drift by construction, and the splice throws rather than silently appending
   * when an anchor has gone ([[P497]]).
   *
   * Only at the shipped cap: a sweep run at 4, 6, 8 or 10 has a live column for a cap this
   * tree does not ship, and writing that into the document as "shipped" is the mislabelling
   * this gate reads its own cap back out of the refusal sentence to avoid.
   */
  it('generates the sweep table into its document rather than letting it transcribe one', () => {
    const obs = readObservation(GRID, corpusDir)
    if (CAP !== obs.companion.cap) {
      console.log(`  (cap ${CAP} is not the shipped ${obs.companion.cap} — not splicing a sweep run into the document)`)
      return
    }
    const at = path.join(corpusDir, GRID.doc)
    const body = renderSweepTable(GRID, obs, readSweep([...rowsA, ...rowsB], CAP))
    fs.writeFileSync(at, spliceSweepBlock(GRID, fs.readFileSync(at, 'utf8'), body))
  })

  /**
   * THE FOUR COLUMNS NO RUN CAN PRODUCE, AND THEIR EXPIRY (#1041).
   *
   * Caps 4, 6, 8 and 10 are observations: the cap is a module constant, so reading the
   * sweep at any of them means rewriting `parse.ts` and running again, which no gate can
   * do. What every run DOES produce is the shipped cap's reading, recorded beside them by
   * the same sweep — so when that stops matching this tree, the four observed columns are
   * stale and this says so.
   *
   * ⚠ Necessary, not sufficient: a change touching only patterns whose period falls in
   * [4, 12) moves the observed columns and leaves this green. The limit travels with the
   * mechanism in `generatedDoc.ts`.
   */
  it('the committed sweep observation is still about this tree', () => {
    const obs = readObservation(GRID, corpusDir)
    assertSweepObservationCoherent(GRID, obs)
    assertSweepObservationCurrent(GRID, obs, [...rowsA, ...rowsB], CAP)
  })
})
