/**
 * writer-reach.test.ts — the committed FLOOR on how much of the real-world corpus
 * the behaviour projection makes EDITABLE, not merely parseable.
 *
 * PARSE-reach (edit-coverage.spec.ts) counts units whose SYNTAX we model. This
 * gate counts WRITER-reach: units the syntactic model REFUSES, that the inherited
 * projection (#922 grid / #924 roll) opens by showing what they PLAY, AND that
 * survive an edit — the write-back re-emits a pattern the ENGINE plays as intended.
 * The two diverge by roughly 40%: a pattern can parse-open and still corrupt on the
 * first click (the #904 class), so "can be viewed" is not "can be edited".
 *
 * WHAT IS MEASURED, through the REAL shipped code — never an inline re-implementation
 * of the projection, which would be a second oracle that can only agree with itself:
 *   refused   — `parse{StepGrid,PianoRoll}Core` says .ok = false (the denominator)
 *   projected — `parse{StepGrid,PianoRoll}` (core → projection fallback) says .ok
 *   editOk    — a modeled edit round-trips: the serialized document, RE-QUERIED
 *               through the real engine, plays exactly the edited note set
 *
 * THE ORACLE is the engine on BOTH sides: expected = what the original pattern plays
 * MINUS the deleted note; got = what the edited document plays. Never a re-parsed
 * column grid — `[~ 1@2]` and `[~ ~ 1@4]` are the same music at two resolutions, and
 * a column compare would false-flag a faithful re-spelling.
 *
 * The compare spans every axis the DOCUMENT carries, on both surfaces. This paragraph
 * used to say the opposite — that the grid is an onset instrument, that "a nested
 * `[hh ~]!16` shows sixteen faithful onsets and its per-cell duration is not the grid's
 * to preserve", and that its probe therefore compares (onset, atom). The first clause is
 * true and the conclusion does not follow (#1026): what the grid PANEL can draw does not
 * bound what the grid WRITER may alter, because "edits locally / no silent data loss" is
 * a property of the file. `[hh ~]!16` is one of the units that made the point — deleting
 * one hit rewrote it to sixteen flat cells and doubled every surviving note's length,
 * and the gate called it reach.
 *
 * THE EDIT PROBE ITSELF LIVES IN `engineEditOracle.ts` (#1009) — the writer census
 * asks the same question of a different writer, and two copies of an edit oracle are
 * two oracles that can only agree with themselves ([[PV192]]). This gate's numbers
 * are what pins that extraction: 131 / 73 with losses `[]`, unchanged BY IT. They are not
 * the current numbers — see the floor below, which has moved twice since, both times
 * because the oracle's sight changed rather than the writers'.
 *
 * THE ASSERTION is a FLOOR, not a snapshot: editOk must not fall below the reach
 * observed when this gate was written. A grammar/subset change that quietly closes
 * units the projection used to open turns this red. The per-reason breakdown is
 * printed as diagnostics — it says WHICH refusals the projection is buying back.
 *
 * DISTRIBUTION, not a hand-picked window: the full committed mini-corpus (1500 real
 * harvested units), both surfaces, is swept.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
} from '../../../editor/src/codeView/notation/parse'
import type {
  ParseResult,
  PianoRollModel,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import {
  serializePianoRollWithExtent,
  serializeStepGridWithExtent,
} from '../../../editor/src/codeView/notation/serialize'
import {
  GRID_SURFACE,
  ROLL_SURFACE,
  probeEdit,
  type Surface as EditSurface,
} from './engineEditOracle'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * The reach FLOOR — the writer-reach observed when this gate was written, over the
 * committed corpus. editOk must never fall below it; a projection that closes units
 * it used to open turns this red. Raise it (never lower it silently) when a genuine
 * reach gain is shipped and re-observed.
 *
 * ⚠ RAISED 131/73 → 155/75 at #1022, and NOT because the writers reach further. They
 * are untouched. What this gate counts is VERIFIED reach, and the probe used to read
 * cycle 0 and nothing else — so an alternation whose first arm is a rest (`<- c5>`,
 * `<~ sd ~ sd ~>`) came back empty and its unit was filed unverified rather than
 * counted. The probe now advances to the first bar the model spans that actually
 * sounds. The units were always editable; the oracle could not see them.
 *
 * Worth stating because the distinction is invisible in the number: this is a gain in
 * MEASUREMENT, not in product surface, and must not be quoted as reach the projections
 * bought.
 *
 * ⚠ LOWERED 155 → 126 at #1026, and the same caveat runs the other way. The writers are
 * again untouched. The oracle's grid arm compared ONSETS ONLY, so 29 units whose edit
 * silently changed a surviving note's LENGTH were counted as reach. Restoring the axis
 * removes them from the count; nothing about the product got worse on the day this
 * number fell. It is a loss in FICTION, not in surface, and must not be quoted as a
 * regression the projections caused.
 *
 * The floor returns when #1010 lands — see `DURATION_LOSSES` below for why that is a
 * prediction with a mechanism behind it rather than a hope.
 *
 * ⚠ RE-BASED 126 -> 123 STEP and 75 -> 85 ROLL at #1037, and the writers are again
 * untouched. The CORPUS changed: the harvester now asks the transpiler which
 * strings become patterns instead of approximating it with a regex, so it gained
 * backtick minis (the multi-line, multi-cycle material) and lost commented-out
 * code the text scan could not tell from live code.
 *
 * Decomposed, because a net delta over two opposite effects is not a finding
 * (measured by re-running this gate on the intermediate corpus):
 *
 *     corpus                              step  losses   roll
 *     1500  committed                      126      29     75
 *     1406  minus commented-out code       119      24     70
 *     1535  plus backtick + chained        123      30     85
 *
 * So **seven step units and five roll units of the old floors were code nobody
 * runs** — a `//sound("…")` line the regex harvested as if it were an ask. That
 * part of the floor was fiction, and removing it is a correction, not a
 * regression. Real material then buys +4 step and +15 roll. The roll gains far
 * more because backticks are how people write long melodic and chord patterns,
 * which is the roll's material.
 *
 * Neither number may be quoted against a pre-#1037 one without saying so: they are
 * over different populations ([[P343]]).
 *
 * ⚠ RAISED 141 -> 153 at #1225, and this one IS reach the product bought — the first
 * of these notes that is. P4c set 141; roughly a dozen commits landed real reach in
 * `visualEdit` after it (#1053/#1146 note length from the step grid, #1061/#1144
 * coarsening holding a note, #1137/#1150, #1151/#1153, #1154/#1162, #1160/#1165,
 * #1163/#1170, #1066/#1184) and not one of them raised the number that protects it.
 * This is also the "returns toward 155" predicted in `DURATION_LOSSES` below: P4c
 * emptied that array, and the reach came back as the mechanism said it would.
 *
 * THE ASYMMETRY IS THE DEFECT, and it is worth more than the twelve units. The rule
 * above — "raise it, never lower it silently" — polices one direction. Nothing
 * polices the other, and a floor protects only as well as it is CURRENT: every unit
 * of slack between the floor and the observed reach is a unit that can go dark with
 * the gate still green. Raise it in the SAME commit as the gain, or the gain quietly
 * buys nothing but headroom for a future regression.
 *
 * ⚠ RAISED 153 -> 161 STEP and 85 -> 95 ROLL at #1273, and this is the rule directly
 * above catching its own file. Neither writer moved. The CORPUS did, at #1242, and both
 * floors stayed where the 1535-unit corpus left them.
 *
 * The step floor had lost the exact catch the paragraph below demonstrates. Dropping
 * `LEAF_PROJECT_BARS.grid` 12 -> 8 still costs six units, but from a higher base —
 * 161 -> 155 — and 155 clears 153, so the gate passed on the one regression it was
 * calibrated to redden on. Slack does not degrade a floor gradually; it removes a
 * specific catch, and which catch it removes is not visible from the slack alone.
 *
 * The roll floor was worse than loose: it never fired at all. Sweeping
 * `LEAF_PROJECT_BARS.roll` down to 1 leaves reach at 89, still above 85. Those runs DO
 * go red below cap 4 — on the SURGERY floor, a tighter neighbour — so this floor's
 * protection was entirely borrowed, and there was no value of the constant it names at
 * which it fired. A floor that cannot be made to redden by moving its own subject is
 * decoration, and a green run past it says nothing. #1270 raised this same quantity —
 * the same 1180 core-refused asks, the same 95 — in `roll-cap-sweep.test.ts`; this copy
 * is the one that was left behind, because a floor does not look like a consumer.
 *
 * DEMONSTRATED, not asserted, because a raise you cannot show catching something is
 * just a larger number. Paired differentials on one tree in one session, each with the
 * other surface as its control:
 *
 *     STEP: `LEAF_PROJECT_BARS.grid` 12 -> 8 costs six units (161 -> 155). At floor 153
 *     the gate PASSES on it; at 161 it reddens — "155 fell below floor 161". The roll
 *     arm reads 95 at grid 12, 8, 6 and 4 alike: the break is grid-only.
 *
 *     ROLL: `LEAF_PROJECT_BARS.roll` 4 -> 3 costs two units (95 -> 93). At floor 85 this
 *     assertion PASSES while the surgery floor does the reddening; at 95 it reddens on
 *     its own terms. The step arm reads 161 at roll 4, 3, 2 and 1 alike, so the control
 *     closes in both directions.
 */
// ⚠ LOWERED 161 -> 159 at #1849, and not by slack: the population moved. Four grids whose `,`-parts the flat reading refused now open through the core, so they left population A (A.opened 201 -> 197) and their asks with them — A.transfers 161 -> 159, B.transfers 727 -> 729, conserved. RE-PROVED as a paired differential on this tree (`cap-sweep.mjs grid`): cap 12 (shipped) 159, 10 -> 158, 8 -> 153, 6 and 4 -> 142 — every lower cap reddens at 159.
// ⚠ FLOOR 159 -> 158 at #1849's `<…>` half, a MOVE not a loss (paired differential from the re-taken sweep): population A (core refused) loses 3 asks / 1 transfer / 2 opens and population B (core served) gains exactly 3 / 1 / 2 — the 3 grids the core now reads bar by bar.
// ⚠ FLOOR 158 -> 157 at #1974, a CHANGE OF WRITER and the one unit it costs here (paired per-unit run, store probes/timing-facts-1974/wr-before.txt, wr-after.txt): `[c eb g <f bb>](3,8,<0 1>)` was served by the element writer, whose only way to delete one hit is to respell the whole pattern as a two-bar alternation (38.7 of its 26 bytes per delete). With its hits anchored on their notes the leaf writer owns it: a delete is 1.5 bytes, and the two notes both bars share are DECLINED rather than respelled — which this gate's single probe lands on. Nothing is written wrong on either side (every-note delete, both trees, 0 wrong).
const FLOOR_STEP = 157
// ⚠ LOWERED 95 -> 89 at #1849, and not by slack: the population moved. Eighteen rolls whose `,`-parts the flat reading refused, or whose parts differ in width, now open through the core, so they left population A (A.opened 145 -> 127) and their asks with them — A.transfers 97 -> 89, B.transfers 369 -> 377, conserved. RE-PROVED as a paired differential on this tree (`cap-sweep.mjs`): cap 4 (shipped) 89, 3 -> 87, 1 -> 84 — every lower cap reddens at 89.
// ⚠ FLOOR 89 -> 90 at #1974: `<0 4 2>*[<3 2>/32]` opens on the leaf writer and its delete round-trips (same paired run).
const FLOOR_ROLL = 90

/**
 * THE OTHER HALF OF THE SCORE: how many deletes are written as BYTE SURGERY (#1010 P4d).
 *
 * WHY THIS FLOOR HAD TO EXIST BEFORE P4d COULD SHIP. Everything above scores what a
 * write-path change COSTS — reach is the engine on both sides, so a document that comes
 * back hap-equivalent and notation-destroyed scores exactly like one that comes back
 * untouched. `[bd@0.5 - - - …]` re-emitted as forty-eight flat cells is a clean
 * round-trip by that oracle. So the gate that P4d is judged by was blind to the whole
 * of P4d's benefit, and the only number anyone could quote for it came from a
 * throwaway. A change measured only by its cost will always look like a loss.
 *
 * WHAT IT COUNTS, and why the writer's own report rather than a byte comparison: a
 * document diff can only say the bytes moved, not that they moved LOCALLY, and any rule
 * written here for "local enough" would be a second copy of what the writer already
 * decided. `serializeStepGridWithExtent` reports which path answered, and `path: 'leaf'`
 * means the write was a splice at the edited note's own span — every other byte copied,
 * by construction. That is the property, stated by the only thing that knows it.
 *
 * POPULATION: every corpus mini that opens a step grid with a sounding cell, at the
 * DOCUMENT's own resolution — 981 units, far wider than the reach sweep above (which
 * asks only about units the syntactic core refused), because surgery is not a property
 * of the derived path. One ask per unit: clear the first sounding cell, through the
 * production toggle.
 *
 * ⚠ A FLOOR, AND IT IS RAISED IN THE SAME COMMIT AS THE GAIN — the discipline this file
 * learned the expensive way at #1225, where twelve units of slack accumulated under a
 * rule that policed only lowering. The margin is printed beside the bound on every run
 * so the slack is readable rather than inferred.
 *
 * SET FROM THE OBSERVATION, and proven as a paired differential on one tree in one
 * session rather than quoted — a floor you cannot show catching something is just a
 * number. Same denominator on both arms (981 units open a grid, 961 deletes performed,
 * the same 19 the panel refuses), so the whole delta is which writer answered:
 *
 *     arm                                  surgery   splice   alt
 *     studio tip (element re-emit)              64      838    59
 *     P4d (surgery tried first)                103      805    53
 *
 * The 39 are deletes that used to re-spell a whole element and now replace the note's
 * own bytes. Reverting the overlay attachment reads 64 and reddens here; reverting the
 * splice reads 0. Nothing else in the suite moves on either break, which is what makes
 * this figure attributable to the write path rather than to the corpus.
 *
 * ⚠⚠ #1233 TOOK THIS TO 657, AND THE JUMP IS MOSTLY NOT A GAIN ([[PV320]]). Attaching the
 * overlay on the CORE-opened half as well moves 554 more deletes onto the leaf writer —
 * but the region splice already copies every byte outside the touched element, so most of
 * those were already writing the bytes surgery writes. Asked as a paired A/B per unit
 * (`_1233-byte-change.spec.ts`, the same model with `surgical` stripped), the overlay
 * changes the OUTPUT of 775 grid deletes, 444 of them on the core-opened half this issue
 * added; document churn on those falls from 14,980 bytes to 1,715.
 *
 * So this number is a FLOOR and not the claim. It is still worth holding — it reddens if
 * the attachment is unwired — but it can rise while the writer swallows edits, which is
 * exactly what happened at #1235, and no figure that only goes up can catch that. The
 * claim lives in the byte-change sweep, and what asks "did the document actually move?"
 * is `op-admissibility`'s handle count.
 *
 * ⚠ RAISED 657 -> 685 at #1273, with the rest of this file's floors, and not because
 * anything was gained: the observation has been 685 since the corpus widened at #1242
 * and this floor stayed where #1233 left it. The slack was load-bearing. At 657 the only
 * grid cap that reddens it is 4 (655); at 685 the drop from 12 to 10 does (684) — a
 * one-unit regression the old floor slept through by twenty-eight.
 */
const FLOOR_SURGICAL = 685

/**
 * THE ROLL'S HALF OF THE SAME SCORE (#1231), and it starts as a BASELINE rather than
 * as a gain: the roll has never had per-edit byte surgery, so this is what its writers
 * do today, pinned before anything changes them.
 *
 * WHY IT IS SET ON THE UNCHANGED WRITER, deliberately. A floor introduced together
 * with the change it scores cannot show that it would have caught the change's absence
 * — the two arrive as one commit and the gate has no history. Pinning today's number
 * first makes the next commit a paired differential: the census moves, this floor is
 * raised in the same commit as the gain, and a revert reddens exactly here.
 *
 * ⚠ WHAT THIS NUMBER IS NOT. It is not "how much of the roll is written well". A roll
 * whose splice already replaces only the deleted note's bytes is perfectly local and
 * counts as `splice`, not `leaf` — measured over the corpus, 326 of 455 roll deletes
 * are already local. The gap is the 129 that move more, of which 69 have no leaf span
 * to anchor to at all and 25 the leaf writer refuses. So the reachable prize is 35,
 * not 129, and this floor should be read against that ceiling rather than against the
 * denominator.
 *
 * OBSERVED on the merged tip `03a85279`: 545 units open a roll, 478 deletes posed, and
 * the paths that answered them are
 *
 *     splice 384 · alt 49 · leaf 20 · leaf declined 21 · rebuild 2 · rebuild declined 2
 *
 * The 21 declines are the leaf projection's own refusals — a shared leaf it cannot
 * write is left alone rather than re-emitted, which is the promise, not a gap.
 *
 * ⚠⚠ RAISED 20 → 46 BY #1232, in the same commit as the gain, which is what makes the
 * pin above worth having: the baseline was set on the unchanged writer one commit
 * earlier, so this is a paired differential rather than a floor arriving with the change
 * it scores.
 *
 * AND THE DELTA IS NOT THE GAIN — the two differ and the gap has a name. This census
 * counts deletes ANSWERED BY the leaf path; the product claim is deletes whose BYTES
 * change. Measured per unit in `_p4e-roll-overlay.spec.ts`, both arms taken on this tree
 * in one session:
 *
 *     +26 answered by surgery  =  22 whose bytes change  +  4 identical (routing only)
 *
 * So #1232 preserves 22 documents, not 26, and quoting the census delta as documents
 * preserved would overstate it by four. The 4 are deletes the element writer already
 * spelled exactly as surgery does; they change who answered and nothing a user sees.
 *
 * ⚠ THE REMAINING HALF IS NOT REACHED BY THIS CHANGE, and the census cannot show that.
 * `withRollSurgery` attaches on the DERIVED path only, mirroring #1229's placement, so
 * all 69 core-opened non-local deletes still carry no overlay at all. #1232's own "done
 * when" asked for 35; 21 of that 35 was the derived half and is what landed. The other
 * 14 need the overlay on the core-opened path, which is a cost problem rather than a
 * routing one and belongs to #1233.
 *
 * ⚠⚠ RAISED 46 → 334 BY #1233, which attached the overlay on that core-opened path. The
 * same warning as the grid's applies and applies harder here: 288 more deletes are
 * ANSWERED by surgery, and the paired A/B per unit
 * (`_1233-byte-change.spec.ts`) puts the OUTPUT change at 927 roll deletes, 602 of them
 * core-opened. Document churn on the changed ones falls from 19,076 bytes to 1,648.
 *
 * The two figures are not comparable line for line — this census asks one delete per unit
 * and the sweep asks every note — which is itself the reason to keep both and to quote the
 * sweep when the question is what a user's document does.
 *
 * ⚠ RAISED 334 -> 365 at #1273 — and this is the ONE raise in this file with no
 * demonstrated new catch. The roll cap is the only lever that moves this number, and it
 * steps 365 -> 332 at cap 3: straight past the entire band between the old floor and the
 * new one. There is no value of it at which 365 reddens and 334 does not, so the
 * differential the other three raises carry cannot be built for this one.
 *
 * Raised anyway, on the rule rather than on a demonstration: 365 is strictly stronger
 * than 334 and closes thirty-one units of slack. Said out loud rather than glossed,
 * because a raise whose differential is assumed instead of shown is exactly how the other
 * three floors in this file went quiet.
 */
const FLOOR_ROLL_SURGICAL = 365

/**
 * The units whose edit survives the engine on every axis EXCEPT duration.
 *
 * Enumerated rather than counted, and asserted as a set rather than as a ceiling, so
 * that a thirtieth cannot arrive unnoticed and a fix cannot quietly trade one for
 * another. Every entry is a real loss: the emitted document plays the right atoms at
 * the right instants and holds one of them for a different length.
 *
 * WHY THIS SET HAS A MECHANISM AND NOT JUST A SIZE — measured per unit across both
 * populations (#1026): all 29 here, and all 11 on the census's counterfactual arm,
 * come from the ELEMENT RE-EMIT. The leaf adapter produces **0 of 40**. That is not a
 * coincidence to be re-checked each time; it follows from what the two writers are.
 * Leaf surgery replaces the edited note's own source bytes and COPIES everything else,
 * so the structural bytes that carry duration — `@n`, `!n`, `*n`, nesting, spacing —
 * ride back out verbatim and it is incapable of changing a length it was not asked to
 * change. The element re-emit re-spells the whole element from a cell model, and a cell
 * model has no duration in it, so it re-spells at the grid's resolution and every
 * length in the element is re-derived from scratch. `[hh ~]!16` → `~ hh hh …` is that
 * in one line.
 *
 * SO THIS LIST IS #1010's SCORECARD. Retiring the element re-emit in favour of surgery
 * wherever a span exists empties it — the ones with a span become clean splices, the
 * ones without (a shared leaf, `!16`) become honest refusals. Either outcome removes
 * the silent rewrite, which is the whole point. When that lands, this array goes to
 * empty and `FLOOR_STEP` returns toward 155.
 *
 * ⚠ RESOLVED AHEAD OF #1010, and left in future tense here for two sessions. P4c already
 * emptied this array, and `FLOOR_STEP` did not merely return toward 155 — it is 161 as
 * of #1273, past the predicted mark, with #1010 still open. A prediction that has come
 * true reads exactly like one still pending, so it goes on collecting agreement from
 * every reader who checks the mechanism and not the tense.
 *
 * ⚠ 29 -> 30 at #1037, again a corpus change and not a writer change: five of the
 * 29 were commented-out code and six real ones arrived with the backtick material.
 * Still 0 leaf, 30 element — the mechanism claim below is unaffected, which is the
 * point of asserting it separately from the membership.
 */
/**
 * EMPTY as of #1010 P4c — the printer preserves lengths instead of re-deriving them.
 *
 * All 30 were duration-only: the emitted document agreed with the expectation on
 * every onset and every atom and differed only in how long a note sounded. 24 are
 * now spelled — a held note's covered columns come out as `_` (sustain), which is
 * what the grid's own resolution can say. The other 6 have lengths it cannot say at
 * all (a note shorter than a column, or a column another note already starts in),
 * and those are REFUSED rather than shortened: the writer declines, the projection
 * stops offering the view, and the document is left alone. A derived view that
 * mis-writes is worse than one that declines, and it is not a close call here —
 * across those 6 units the one-note-per-onset probe found 49 of 50 notes already
 * mis-writing, so what a refusal costs is one live note, not six live views.
 *
 * Kept as an exact set rather than deleted: a thirty-first loss arriving is what
 * this assertion exists to catch, and `[]` states that more loudly than no list.
 */
const DURATION_LOSSES: string[] = []

/* ── the sweep ──────────────────────────────────────────────────────────────── */

/**
 * A surface = the two writers to compare plus how the shared edit oracle drives it.
 * `core`/`full` are this gate's question (does the PROJECTION buy back what the
 * syntactic model refused); `edit` is the probe, imported so the census can hold a
 * different writer to exactly the same standard.
 */
interface Surface {
  key: 'step' | 'roll'
  core: (m: string) => ParseResult<StepGridModel | PianoRollModel>
  full: (m: string) => ParseResult<StepGridModel | PianoRollModel>
  edit: EditSurface
}

const SURFACES: Surface[] = [
  { key: 'step', core: parseStepGridCore, full: parseStepGrid, edit: GRID_SURFACE },
  { key: 'roll', core: parsePianoRollCore, full: parsePianoRoll, edit: ROLL_SURFACE },
]

interface Tally {
  refused: number
  projected: number
  editOk: number
  refusedReasons: Map<string, number>
  reachByReason: Map<string, number>
  /** for units NO writer opened: the gate that actually stopped them (#990) */
  unopenedGates: Map<string, number>
  /**
   * Every unit whose edit corrupts — the mini it came from and the document the
   * writer emitted, plus which writer emitted it.
   *
   * UNCAPPED, deliberately. This used to stop recording at 20 while the report
   * printed `LOSSES sample (${t.losses.length})`, so a run with 29 losses said 20
   * and read as the whole set. A bound on coverage that does not announce itself is
   * indistinguishable from complete coverage, which is the whole failure this gate
   * exists to catch, committed by the gate. The report still prints a SAMPLE — it
   * just says how many it is a sample of.
   */
  losses: { mini: string; out: string; writer: 'leaf' | 'element' }[]
}
const blank = (): Tally => ({
  refused: 0,
  projected: 0,
  editOk: 0,
  refusedReasons: new Map(),
  reachByReason: new Map(),
  unopenedGates: new Map(),
  losses: [],
})

function sweep(s: Surface): Tally {
  const t = blank()
  for (const mini of minis) {
    const core = s.core(mini)
    if (core.ok) continue // the core writer's surface — tested elsewhere
    const reason = core.reason
    const r = s.full(mini)
    t.refused++
    t.refusedReasons.set(reason, (t.refusedReasons.get(reason) ?? 0) + 1)
    if (!r.ok) {
      // Nothing opened it — record the gate that actually stopped it, not the
      // core's syntactic message (#990). This is the residual bucketed by CAUSE,
      // which is what a reach lever has to be sized against: `unstable-period`
      // is the period cap, `wrong-surface` is a unit that was never this view's
      // to open and should not be read as a gap at all.
      const g = r.gate ?? '(core syntax)'
      t.unopenedGates.set(g, (t.unopenedGates.get(g) ?? 0) + 1)
      continue
    }
    const m = r.model as StepGridModel & PianoRollModel
    t.projected++

    // The edit round-trip, verified through the real engine on both sides, by the
    // ONE shared probe (`engineEditOracle.ts`). A `no-probe` verdict — fully
    // chorded, a non-integer per-bar width, or a writer that declined — is
    // UNVERIFIED and counts as neither reach nor a loss, exactly as it always did
    // when these were four separate `continue`s.
    const probe = probeEdit(mini, m, s.edit)
    if (probe.verdict === 'ok') {
      t.editOk++
      t.reachByReason.set(reason, (t.reachByReason.get(reason) ?? 0) + 1)
    } else if (probe.verdict === 'corrupt') {
      t.losses.push({ mini, out: probe.out, writer: m.leafSource ? 'leaf' : 'element' })
    }
  }
  return t
}

function report(name: string, t: Tally, floor: number): void {
  console.log(`\n===== WRITER-REACH: ${name} (${minis.length} corpus units) =====`)
  console.log(`  refused by the syntactic model: ${t.refused}`)
  console.log(`  projected to an editable view:  ${t.projected}`)
  console.log(`  edit round-trips correctly:     ${t.editOk}   (floor ${floor})   <-- writer-reach`)
  console.log(`  -- refused-reason histogram (denominator) --`)
  for (const [k, v] of [...t.refusedReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`     ${String(v).padStart(3)}x  ${k}`)
  console.log(`  -- writer-reach bought back, by refused reason --`)
  for (const [k, v] of [...t.reachByReason.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     +${String(v).padStart(2)}  ${k}`)
  console.log(`  -- units NO writer opened, by the gate that stopped them (#990) --`)
  for (const [k, v] of [...t.unopenedGates.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).padStart(4)}x  ${k}`)
  if (t.losses.length) {
    const SAMPLE = 20
    const byWriter = (w: string) => t.losses.filter((l) => l.writer === w).length
    console.log(
      `  -- LOSSES: ${t.losses.length} total  (leaf ${byWriter('leaf')} / element ${byWriter('element')})` +
        `${t.losses.length > SAMPLE ? `, showing the first ${SAMPLE}` : ''} --`,
    )
    t.losses
      .slice(0, SAMPLE)
      .forEach((l) => console.log(`     ✗ [${l.writer}] ${JSON.stringify(l.mini)}  edit→${JSON.stringify(l.out)}`))
  }
}

/**
 * One delete per grid unit, and WHICH WRITER answered it — the surgery census.
 *
 * The edit is the production toggle, never a hand-modelled one: modelling it here
 * would quietly keep measuring an edit the panel no longer performs.
 */
function surgeryCensus(): { units: number; asked: number; byPath: Map<string, number> } {
  const byPath = new Map<string, number>()
  let units = 0
  let asked = 0
  for (const mini of minis) {
    const r = parseStepGrid(mini)
    if (!r.ok) continue
    const m = r.model as StepGridModel
    units++
    let done = false
    for (let col = 0; col < m.steps && !done; col++)
      for (let lane = 0; lane < m.lanes.length && !done; lane++) {
        if (!isCellOn(m.lanes[lane].cells[col])) continue
        done = true
        const next = toggleCell(m, lane, col, false)
        // the op returns its input by reference when the panel refuses the gesture
        if (next === m) {
          byPath.set('(op refused)', (byPath.get('(op refused)') ?? 0) + 1)
          break
        }
        asked++
        const { mini: out, extent } = serializeStepGridWithExtent(next)
        const key = out === null ? `${extent.path} (declined)` : extent.path
        byPath.set(key, (byPath.get(key) ?? 0) + 1)
      }
  }
  return { units, asked, byPath }
}

/**
 * The same census, the other surface — one delete per roll unit and WHICH WRITER
 * answered it (#1231).
 *
 * ⚠ THE DELETE IS MODELLED HERE, and that is a real difference from the grid's arm
 * above rather than a shortcut. The grid has a production op (`toggleCell`) the census
 * can drive; the roll's delete lives inline in `PianoRollGrid` —
 * `notes.filter((n) => !(n.pitch === sel.pitch && n.start === sel.start))` — with no
 * shared function to call. On a column holding exactly ONE note, which is the only
 * target this census takes, filtering by (pitch, start) and filtering that note out are
 * the same operation, so what is posed here is the panel's gesture. If the roll ever
 * grows a real op, this should call it instead.
 *
 * The target rule is `engineEditOracle.deleteFromRoll`'s: the first column holding
 * exactly one note, so the delete removes exactly one sounding thing.
 */
function rollSurgeryCensus(): { units: number; asked: number; byPath: Map<string, number> } {
  const byPath = new Map<string, number>()
  let units = 0
  let asked = 0
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok) continue
    const m = r.model as PianoRollModel
    units++
    const starts = [...new Set(m.notes.map((n) => n.start))].sort((a, b) => a - b)
    const col = starts.find((c) => m.notes.filter((n) => n.start === c).length === 1)
    if (col === undefined) {
      byPath.set('(no single-note target)', (byPath.get('(no single-note target)') ?? 0) + 1)
      continue
    }
    const gone = m.notes.find((n) => n.start === col)!
    asked++
    const { mini: out, extent } = serializePianoRollWithExtent({
      ...m,
      notes: m.notes.filter((n) => n !== gone),
    })
    const key = out === null ? `${extent.path} (declined)` : extent.path
    byPath.set(key, (byPath.get(key) ?? 0) + 1)
  }
  return { units, asked, byPath }
}

describe('writer-reach — the projection makes real refused units editable, and edits survive', () => {
  const step = sweep(SURFACES[0])
  const roll = sweep(SURFACES[1])

  it('step grid: projection reach holds at or above the floor', () => {
    report('step grid (#922)', step, FLOOR_STEP)
    // Every projected unit that got a clean probe must round-trip, EXCEPT the named
    // duration set — asserted as an exact set, so a thirtieth cannot arrive unnoticed
    // and a fix cannot silently trade one loss for another (#1026).
    expect(
      step.losses.map((l) => l.mini).sort(),
      step.losses.map((l) => `${JSON.stringify(l.mini)}  edit→${JSON.stringify(l.out)}`).join('\n'),
    ).toEqual([...DURATION_LOSSES].sort())
    // …and the mechanism is asserted, not just the membership: the leaf adapter copies
    // every byte it did not edit, so it CANNOT change a length it was not asked to.
    // A leaf-written loss appearing here would mean that reasoning is wrong.
    expect(
      step.losses.filter((l) => l.writer === 'leaf'),
      'a leaf-adapter write lost duration — byte surgery is supposed to make that impossible',
    ).toEqual([])
    expect(step.editOk, `step writer-reach ${step.editOk} fell below floor ${FLOOR_STEP}`).toBeGreaterThanOrEqual(FLOOR_STEP)
  })

  it('piano roll: projection reach holds at or above the floor', () => {
    report('piano roll (#924)', roll, FLOOR_ROLL)
    // The roll's arm was ALREADY duration-aware, so it is the control for #1026: this
    // stays empty and 75 stays 75 across the change. A roll movement would have meant
    // the edit did something other than restore the grid's missing axis.
    expect(roll.losses, roll.losses.map((l) => l.mini).join('\n')).toEqual([])
    expect(roll.editOk, `roll writer-reach ${roll.editOk} fell below floor ${FLOOR_ROLL}`).toBeGreaterThanOrEqual(FLOOR_ROLL)
  })

  it('step grid: deletes written as byte surgery hold at or above the floor', () => {
    const c = surgeryCensus()
    const surgical = c.byPath.get('leaf') ?? 0
    console.log(`\n===== SURGERY: step grid (#1010 P4d) (${minis.length} corpus units) =====`)
    console.log(`  units opening a grid:           ${c.units}`)
    console.log(`  deletes the panel performed:    ${c.asked}`)
    console.log(
      `  written as BYTE SURGERY:        ${surgical}   (floor ${FLOOR_SURGICAL}, margin ${surgical - FLOOR_SURGICAL})   <-- what P4d buys`,
    )
    console.log(`  -- by the path that answered --`)
    for (const [k, v] of [...c.byPath.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    // The denominator is asserted beside the figure: a census that quietly stopped
    // asking would drive the numerator to zero and read as a regression in the writer,
    // while a census that stopped RUNNING would read as nothing at all.
    expect(c.asked, 'the census must actually pose deletes').toBeGreaterThan(400)
    expect(
      surgical,
      `surgical deletes ${surgical} fell below floor ${FLOOR_SURGICAL} — a write path that used to splice the note's own bytes is re-emitting notation again`,
    ).toBeGreaterThanOrEqual(FLOOR_SURGICAL)
  })

  it('piano roll: deletes written as byte surgery hold at or above the floor', () => {
    const c = rollSurgeryCensus()
    const surgical = c.byPath.get('leaf') ?? 0
    console.log(`\n===== SURGERY: piano roll (#1231) (${minis.length} corpus units) =====`)
    console.log(`  units opening a roll:           ${c.units}`)
    console.log(`  deletes the panel performed:    ${c.asked}`)
    console.log(
      `  written as BYTE SURGERY:        ${surgical}   (floor ${FLOOR_ROLL_SURGICAL}, margin ${surgical - FLOOR_ROLL_SURGICAL})`,
    )
    console.log(`  -- by the path that answered --`)
    for (const [k, v] of [...c.byPath.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    expect(c.asked, 'the census must actually pose deletes').toBeGreaterThan(300)
    expect(
      surgical,
      `roll surgical deletes ${surgical} fell below floor ${FLOOR_ROLL_SURGICAL} — a write path that used to splice the note's own bytes is re-emitting notation again`,
    ).toBeGreaterThanOrEqual(FLOOR_ROLL_SURGICAL)
  })
})
