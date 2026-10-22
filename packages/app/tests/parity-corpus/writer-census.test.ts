/**
 * writer-census.test.ts — WHICH WRITER SERVES EACH SURFACE-ASK, and what would
 * serve it if the syntactic core were deleted (#1009, epic #1007 phase P3).
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────
 * `notation/parse.ts`'s syntactic core (M2 — krill AST → cells) is the largest
 * block of meaning re-derivation left in the editing path. It cannot simply be
 * deleted: it serves surface-asks that NEITHER derived projection serves, and
 * deleting it today deletes those views. So the question is not "can we remove
 * it" but "how much of its reach TRANSFERS to the derived projections" — and the
 * answer has to be per ask, because an aggregate that stays flat hides a large
 * re-routing in both directions ([[PK58]]).
 *
 * ── THE MEASUREMENT IS A COUNTERFACTUAL, RUN AS EQUAL-AND-OPPOSITE MOVES ──────
 * For every ask the core serves, BOTH writers are put through the SAME edit probe
 * (`engineEditOracle.ts`, the one `writer-reach.test.ts` uses):
 *
 *   incumbent    — the core's own model. VERIFIED, never assumed: an ask whose
 *                  core edit corrupts was never reach on either side, and
 *                  charging it to the projection would be a free win for the
 *                  incumbent.
 *   counterfactual — `project{StepGrid,PianoRoll}Derived`, the real writer chain
 *                  below the core, asked in the real order. Never re-derived
 *                  here: the order is the contract and a local copy of it is a
 *                  second oracle ([[PV192]]).
 *
 * ── WHAT IS COUNTED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
 * Four outcomes per ask, and the third is not a failure:
 *   transfers        — a derived writer opens it AND the edit survives the engine
 *   no-view          — no derived writer opens it at all (untransferable, parse)
 *   view-corrupts    — a derived writer opens it and the edit corrupts
 *                      (untransferable, edit — and the worse of the two, because
 *                      the view looks fine)
 *   no-probe         — opened, but no clean single-note delete exists. UNVERIFIED,
 *                      neither transferred nor untransferable ([[PK59]] step 5).
 *
 * ── WHY THE ASK COUNT IS NOT A MINI COUNT ─────────────────────────────────────
 * A mini can be core-served on BOTH surfaces, so 2 asks can be 1 string. Both
 * figures are printed and the distinct-mini count is the one to quote when the
 * question is "how much TEXT loses its view" ([[PV231]] clause 3).
 *
 * ── THE ASSERTIONS ────────────────────────────────────────────────────────────
 * The denominator is pinned to `writer-reach`'s complement (803 grid / 414 roll,
 * both derived from the same corpus by the same core functions), so this census
 * and that gate cannot drift apart silently. The transfer figures are pinned as
 * a BAND, not a floor: this is a measurement, and a number that moves in either
 * direction is a finding either way.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
  projectStepGridDerived,
  projectPianoRollDerived,
  tailToken,
  PROJECTION_PERIOD_BOUNDS,
} from '../../../editor/src/codeView/notation/parse'
import { hasStructure } from '../../../editor/src/codeView/notation/model'
import { assertRatchet } from '../../../editor/src/modellingRatchet/ratchet'
import type {
  ParseResult,
  PianoRollModel,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import {
  GRID_SURFACE,
  ROLL_SURFACE,
  probeEdit,
  type NoProbeReason,
  type Surface as EditSurface,
} from './engineEditOracle'
import { truePeriod } from './enginePeriod'
import {
  assertObservationCoherent,
  assertObservationCurrent,
  p6Columns,
  readP6,
  renderP6Table,
  spliceP6Block,
  type P6CapObservation,
} from './p6Table'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * What `projectXDerived` should say when nothing below the core opened the ask.
 *
 * In the census's world the core SUCCEEDED, so there is no core refusal to report
 * — and `refused` returns the passed reason verbatim for `not-a-pattern`, which is
 * how a mini that will not reify at all shows up distinctly instead of borrowing
 * some other writer's gate.
 */
const NO_CORE_REFUSAL = { ok: false as const, reason: '(core served this — no refusal)' }

type Outcome = 'transfers' | 'no-view' | 'view-corrupts' | 'no-probe'
type Writer = 'leaf' | 'element'

interface Ask {
  mini: string
  surface: 'step' | 'roll'
  outcome: Outcome
  /** which derived writer answered, when one did */
  writer?: Writer
  /** the gate that stopped every derived writer, when none did */
  gate?: string
  /** why there was no clean probe, when that is the outcome */
  noProbe?: NoProbeReason
  /** whether the INCUMBENT (the core's own model) survives the same probe */
  coreProbe: 'ok' | 'corrupt' | 'no-probe'
  /** does the derived view have STRUCTURE — more than one cell/note ([[P338]] cl.2) */
  structured?: boolean
  /** does the derived view show the same shape the core's does */
  sameShape?: boolean
  /** the structural feature of the MINI, for classifying the residual by mechanism */
  shape: string
  /**
   * Does this mini play a `word:index` ARRAY value (krill's `bd:3`)?
   *
   * Recorded because it WAS the dominant untransferable mechanism and was never
   * structural: `readGridOnsets` named a string, a number and an `{s,n}` object, and
   * krill hands it `["bd", 3]` for a `:`-variant, which fell through to
   * `no-note-content`. Split out here so the residual separates "the projection has
   * a hole" from "the bijection genuinely fails" — the difference between a fix and
   * a bound.
   *
   * #1019 HAS LANDED and the readers now name the array, so this flag no longer
   * marks a hole. It is kept because it is still the axis that keeps the two classes
   * apart: the count behind it fell 101 → 7 while the structural count stayed at
   * exactly 50, and that pair is what shows the classes were independent. The 7 that
   * remain carry a `:` AND a second real blocker — asserted below.
   */
  arrayValue: boolean
  /** does the CORE's own view have structure — i.e. is the view being lost worth keeping */
  coreStructured: boolean
}

/**
 * THE MECHANISM CLASSIFIER — a property of the mini's own text, asked
 * independently of any refusal label.
 *
 * The labels have overstated the opportunity every time they have been counted
 * ([[P328]]: the reason string names the wrong subsystem; [[P335]]: it names the
 * wrong size). So the residual is cross-tabbed against what the notation actually
 * IS, and the label is carried alongside rather than trusted.
 *
 * `shared-leaf` is first because it is the predicted dominant class: one source
 * atom that plays several onsets (`bd*2`, `bd!3`, `bd(3,8)`, `hh@2`) is exactly
 * where the cell↔leaf-span bijection fails ([[PV218]]) — the core models it
 * syntactically, a behaviour projection sees N onsets with one span to write to.
 * Order matters: the first matching clause wins, so a mini with both `*n` and a
 * `<…>` is filed under `shared-leaf`.
 */
function shapeOf(mini: string): string {
  const bare = mini.replace(/\s+/g, '')
  if (bare === '' || /^[~-]+$/.test(bare)) return 'rests-only'
  // one source atom, several onsets — the predicted dominant untransferable class
  if (/[*!@]\s*\d/.test(mini) || /\(\s*<?\d/.test(mini)) return 'shared-leaf'
  if (/\?/.test(mini)) return 'degrade-random'
  if (/<|>/.test(mini)) return 'alternation'
  if (/,/.test(mini)) return 'stack'
  if (/\[|\]/.test(mini)) return 'nested-group'
  if (/^[^\s]+$/.test(mini)) return 'single-atom'
  return 'flat-sequence'
}

/**
 * Does any hap this mini plays carry an ARRAY value?
 *
 * krill lowers `bd:3` to the value `["bd", 3]` — the sample-index pair a control
 * resolves. Asked of the ENGINE rather than by grepping for `:`, because `:` also
 * appears inside `sd:1:.5` and in note names, and a text test would be a second
 * oracle for a question the engine answers directly ([[PV192]]).
 *
 * PROBED OVER A WINDOW, not cycle 0. `<- cp:1>` rests in cycle 0 and plays its
 * `:`-variant in cycle 1, so a single-cycle probe classifies it as array-free and
 * files it under the structural residual — the window-dependence [[PV229]] names,
 * arriving here as a misclassification rather than a miscount. 24 cycles covers
 * every period the surface caps admit (max 12) with a doubling for confirmation.
 */
const ARRAY_PROBE_CYCLES = 24
function playsArrayValue(m: string): boolean {
  try {
    const pat = reifyMini(m) as { queryArc(a: number, b: number): { value: unknown }[] }
    for (let c = 0; c < ARRAY_PROBE_CYCLES; c++) {
      if (pat.queryArc(c, c + 1).some((h) => Array.isArray(h.value))) return true
    }
    return false
  } catch {
    return false
  }
}

/*
 * "More than one cell / note" — `hasStructure`, now imported from
 * `notation/model.ts` rather than defined here (#1259).
 *
 * It lived here, module-private, and was copied twice because of that: into
 * `roll-cap-sweep.test.ts` and into the #1256 kind census. Its docblock — including
 * why the two surfaces get different clauses — moved with it to the one home.
 */

const shapeKey = (m: StepGridModel & PianoRollModel, key: 'step' | 'roll'): string =>
  key === 'roll'
    ? `${m.steps}/${m.bars ?? 1}/${m.notes?.length ?? 0}`
    : `${m.steps}/${m.bars ?? 1}/${m.lanes.length}`

/*
 * The pattern's TRUE cycle period — the independent answer the `unstable-period`
 * label is checked against — now lives in `enginePeriod.ts`, because the cap sweep
 * (#1020) asks the same question and two copies would be two oracles ([[PV192]]).
 * The assertions below are what pin the extraction: 31 past the cap, 2 aperiodic,
 * 0 within it.
 */

interface Surface {
  key: 'step' | 'roll'
  core: (m: string) => ParseResult<StepGridModel | PianoRollModel>
  derived: (
    m: string,
    fallback: { ok: false; reason: string },
  ) => ParseResult<StepGridModel | PianoRollModel>
  edit: EditSurface
}

const SURFACES: Surface[] = [
  { key: 'step', core: parseStepGridCore, derived: projectStepGridDerived, edit: GRID_SURFACE },
  { key: 'roll', core: parsePianoRollCore, derived: projectPianoRollDerived, edit: ROLL_SURFACE },
]

function census(s: Surface): Ask[] {
  const out: Ask[] = []
  for (const mini of minis) {
    const core = s.core(mini)
    if (!core.ok) continue // the core does NOT serve this — that is writer-reach's population
    const coreModel = core.model as StepGridModel & PianoRollModel

    // THE INCUMBENT, MEASURED. Held to the same probe as the challenger, because
    // "the core serves it" is a parse claim and this census is about reach.
    const coreProbe = probeEdit(mini, coreModel, s.edit).verdict
    const shape = shapeOf(mini)
    const arrayValue = playsArrayValue(mini)
    const coreStructured = hasStructure(coreModel, s.key)

    const derived = s.derived(mini, NO_CORE_REFUSAL)
    if (!derived.ok) {
      out.push({
        mini,
        surface: s.key,
        outcome: 'no-view',
        // The `??` is DEFENSIVE — 0 rows over 1217 asks. `refused` returns the
        // fallback verbatim (gate-less) for `not-a-pattern`, which is reachable in
        // principle: the core parses syntactically and never reifies, so a mini it
        // accepts but `reifyMini` rejects would land here. The corpus contains none.
        gate: derived.gate ?? '(no gate — did not reify)',
        coreProbe,
        shape,
        arrayValue,
        coreStructured,
      })
      continue
    }
    const dm = derived.model as StepGridModel & PianoRollModel
    const writer: Writer = dm.leafSource ? 'leaf' : 'element'
    const structured = hasStructure(dm, s.key)
    const sameShape = shapeKey(dm, s.key) === shapeKey(coreModel, s.key)
    const probe = probeEdit(mini, dm, s.edit)
    out.push({
      mini,
      surface: s.key,
      outcome:
        probe.verdict === 'ok' ? 'transfers' : probe.verdict === 'corrupt' ? 'view-corrupts' : 'no-probe',
      writer,
      noProbe: probe.verdict === 'no-probe' ? probe.why : undefined,
      coreProbe,
      structured,
      sameShape,
      shape,
      arrayValue,
      coreStructured,
    })
  }
  return out
}

const tallyBy = <K extends string>(rows: Ask[], f: (a: Ask) => K | undefined): Map<K, number> => {
  const m = new Map<K, number>()
  for (const r of rows) {
    const k = f(r)
    if (k === undefined) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

const show = (m: Map<string, number>, pad = 5): string[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `     ${String(v).padStart(pad)}  ${k}`)

function report(name: string, rows: Ask[]): void {
  const n = rows.length
  const by = (o: Outcome) => rows.filter((r) => r.outcome === o)
  const transfers = by('transfers')
  const noView = by('no-view')
  const corrupt = by('view-corrupts')
  const noProbe = by('no-probe')
  const untransferable = [...noView, ...corrupt]
  const pct = (a: number) => ((100 * a) / n).toFixed(1)

  console.log(`\n===== WRITER CENSUS: ${name} — asks the syntactic core serves =====`)
  console.log(`  core-served asks                 ${n}   (distinct minis ${new Set(rows.map((r) => r.mini)).size})`)
  console.log(`  -- the INCUMBENT, put through the same probe --`)
  console.log(...show(tallyBy(rows, (r) => `core edit ${r.coreProbe}`)))
  console.log(`  -- the COUNTERFACTUAL: core deleted, who serves and does the edit hold --`)
  console.log(`  transfers (view + edit survives) ${transfers.length}  (${pct(transfers.length)}%)`)
  console.log(`      by derived writer`)
  console.log(...show(tallyBy(transfers, (r) => r.writer)))
  console.log(`      of these, view has STRUCTURE  ${transfers.filter((r) => r.structured).length}`)
  console.log(`      of these, SAME shape as core  ${transfers.filter((r) => r.sameShape).length}`)
  console.log(`  UNTRANSFERABLE                   ${untransferable.length}  (${pct(untransferable.length)}%)`)
  console.log(`      no derived writer opens it    ${noView.length}`)
  console.log(...show(tallyBy(noView, (r) => `gate: ${r.gate}`)))
  console.log(`      opens but the edit CORRUPTS   ${corrupt.length}`)
  console.log(...show(tallyBy(corrupt, (r) => `writer: ${r.writer}`)))
  console.log(`  UNVERIFIED (no clean probe)      ${noProbe.length}  (${pct(noProbe.length)}%)`)
  console.log(...show(tallyBy(noProbe, (r) => `why: ${r.noProbe}`)))
  console.log(`  -- the untransferable set BY MECHANISM (the mini's own shape, not the label) --`)
  console.log(...show(tallyBy(untransferable, (r) => r.shape)))
  console.log(`  -- and for contrast, the TRANSFERRED set by the same mechanism axis --`)
  console.log(...show(tallyBy(transfers, (r) => r.shape)))

  // THE SPLIT THAT DECIDES WHETHER THIS IS A FIX OR A BOUND. An ask that fails only
  // because the projection cannot NAME a `word:index` value is a hole in one
  // function (#1019); an ask that fails because several onsets share one source
  // atom is the bijection ([[PV218]]) and no amount of patching moves it.
  // Counted by `p6Columns`, not re-filtered here (#1046). This block used to hold its own
  // copy of the same four filters, and so did the pin below — so breaking the shared rule
  // reddened nothing, which is a test that cannot fail on its own subject ([[P519]]).
  const cols = p6Columns(rows)
  const structural = untransferable.filter((r) => !r.arrayValue)
  console.log(`  -- the untransferable set SPLIT BY WHETHER IT IS A HOLE OR A BOUND --`)
  console.log(`      word:index array value (a naming hole, #1019)  ${cols.arrayValue}`)
  console.log(`      everything else (candidate structural bound)   ${cols.structural}`)
  console.log(...show(tallyBy(structural, (r) => `${r.shape}  /  gate ${r.gate}`)))
  // AND WHETHER THE VIEW BEING LOST IS WORTH KEEPING. A one-cell view of an
  // instrument name is a CORRECT model and a useless surface ([[P338]] clause 2),
  // and counting it as a blocker for deleting the core is the same error as
  // counting it as reach.
  // A TRANSFER THAT CHANGES THE VIEW IS NOT A CLEAN TRANSFER. Reach moved, the
  // verdict did not, and the user sees a different grid — the silent re-routing
  // [[PK58]] exists to catch. Enumerated, because at this size it can be read.
  const reshaped = transfers.filter((r) => !r.sameShape)
  if (reshaped.length) {
    console.log(`  -- transfers whose VIEW SHAPE differs from the core's (${reshaped.length}) --`)
    reshaped.forEach((r) => console.log(`     ${r.writer}  ${JSON.stringify(r.mini).slice(0, 80)}`))
  }
  console.log(`  -- of the untransferable, what the core's OWN view is --`)
  console.log(`      core view has STRUCTURE     ${cols.coreStructured}`)
  console.log(`      core edit VERIFIED ok       ${cols.coreEdits}`)
  console.log(
    `      structural AND structured AND core-edit-verified  ${cols.blocker}` +
      `   <-- the set that actually blocks deleting the core`,
  )
}

describe('writer census — how much of the syntactic core transfers to the derived projections', () => {
  const grid = census(SURFACES[0])
  const roll = census(SURFACES[1])

  /**
   * Hoisted so the three things that read this run can be three ARMS rather than one.
   *
   * They were one arm first, and a break matrix could not tell them apart: a stale
   * observation, a document that had lost its markers, and a broken conjunction in the
   * derivation all reddened the same `it` and differed only in their message. Splitting
   * by DECISION is what makes the break signatures disjoint ([[P558]]) — and the middle
   * one is the load-bearing case, because a generation step that silently stopped
   * generating is the failure this whole issue is about.
   */
  const allAsks = [...grid, ...roll]
  const p6 = readP6(allAsks, PROJECTION_PERIOD_BOUNDS.leaf.roll)

  it('counts every core-served ask, and enumerates the untransferable with a mechanism', () => {
    report('step grid', grid)
    report('piano roll', roll)

    const all = allAsks
    const untransferable = all.filter(
      (r) => r.outcome === 'no-view' || r.outcome === 'view-corrupts',
    )
    console.log(
      [
        `\n===== BOTH SURFACES =====`,
        `  core-served asks      ${all.length}   over ${new Set(all.map((r) => r.mini)).size} distinct minis`,
        `  transfers             ${all.filter((r) => r.outcome === 'transfers').length}`,
        `  UNTRANSFERABLE        ${untransferable.length}   over ${new Set(untransferable.map((r) => r.mini)).size} distinct minis`,
        `  unverified            ${all.filter((r) => r.outcome === 'no-probe').length}`,
      ].join('\n'),
    )

    // THE P6 BLOCKER, PRINTED BEFORE ANYTHING IS ASSERTED. It is the number #1012 is
    // scoped against and it has been re-based four times; a figure that exists only as a
    // literal inside an `expect` cannot be read without a green run, which is how the
    // sibling document ended up quoting a stale one ([[P366]]). Printing it up here also
    // makes it readable when a pin BELOW is red — including the deliberate red of running
    // this census with `LEAF_PROJECT_BARS.roll = 12` to measure the figure at the other
    // cap, which is otherwise unobservable because the cap-4 pins fail first.
    //
    // DERIVED ONCE (#1046). This block used to compute the columns inline and the two
    // documents retyped them; now the print, the emitted artifact, the generated document
    // sections and the cap-12 script all read `readP6`, so none of them can come to a
    // different view of the same run.
    console.log(
      [
        `\n===== THE P6 BLOCKER   (roll cap ${p6.cap}) =====`,
        `  structural untransferable        ${p6.both.structural}`,
        `  ...core view has STRUCTURE       ${p6.both.coreStructured}`,
        `  ...core edit VERIFIED ok         ${p6.both.coreEdits}`,
        `  ...BOTH (blocks deleting core)   ${p6.both.blocker}` +
          `   [grid ${p6.grid.blocker} + roll ${p6.roll.blocker}]`,
      ].join('\n'),
    )

    // Dump the enumeration so it can be hand-read and quoted per entry. The
    // deliverable of this phase is the NAMED residual, not the count — a count
    // without a classification is the error the previous phase corrected.
    //
    // `p6` and `cap` ride along so `scripts/p6-cap-census.mjs` can read a run's answer
    // without deriving anything of its own: a driver that re-implements the columns in
    // JS to sweep them is a second oracle over the same question ([[P519]]), and the one
    // thing this table must not have is two derivations.
    fs.writeFileSync(
      path.join(corpusDir, 'WRITER-CENSUS.json'),
      JSON.stringify(
        {
          note: 'Generated by writer-census.test.ts (#1009). One row per surface-ask the syntactic core serves.',
          corpusUnits: minis.length,
          coreServed: { grid: grid.length, roll: roll.length },
          p6,
          rows: all,
        },
        null,
        2,
      ) + '\n',
    )

    // THE DENOMINATOR IS PINNED TO writer-reach's COMPLEMENT. That gate sweeps the
    // asks the core REFUSES (744 grid / 1122 roll of 1535); this one sweeps the
    // asks it SERVES. If these two stop summing to the corpus, one of them is
    // asking a different question and neither number is readable.
    //
    // ⚠ the corpus itself moved at #1037 — 1500 -> 1535 units, as the harvester
    // stopped approximating the transpiler with a regex. Every figure in this file
    // is therefore over a different population than a pre-#1037 one and the two
    // must never be quoted side by side.
    // ⚠ THE CORPUS MOVED AGAIN at #1242 — 1535 -> 1633 units, as the harvest gained
    // the product's own resolver (98 arrivals, 0 departures). Same warning as #1037
    // below: every figure in this file is over a wider population than a pre-#1242 one
    // and the two must never be quoted side by side.
    // ⚠ 813 -> 812 core-refused grid units at #1827 (each bar drawn at its own step
    // count): `<~ ~ bd*3 bd*4 bd*3 bd*4 bd*4 bd*4>` used to exceed 64 shared columns and
    // is now served by the core, drawn per bar. Likewise 1180 -> 1179 on the roll, for
    // `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>`. The derived projections still cap at
    // 64 shared columns, so both arrive UNTRANSFERABLE (core-structured), which is the
    // +1/+1 the P6 table shows.
    // ⚠ 812 -> 805 / 1179 -> 1158 core-refused at #1849: a `,`-part the flat reading refused is now read as it is alone, so 7 grid and 21 roll units are served by the core (4 + 18 that were leaf-read, 3 + 3 that were refused).
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    expect(grid.length).toBe(1633 - 802)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    expect(roll.length).toBe(1633 - 1158)

    // A BAND, NOT A FLOOR. This is a measurement, so a move in EITHER direction is
    // a finding and should turn this red rather than pass quietly upward.
    //
    // ⚠ MOVED 1066 → 1055 / 57 → 68 at #1026, and the mechanism is the ORACLE, not the
    // writers. Its grid arm compared onsets only, so 11 grid asks whose write silently
    // changed a surviving note's LENGTH were scored as clean transfers. Restoring the
    // axis reclassifies exactly those 11 from `transfers` to `view-corrupts`; every
    // other row is byte-identical and `unverified` does not move at all. The roll is
    // unchanged on every figure — it was already duration-aware, which is what makes it
    // this change's control arm. All 11 come from the element re-emit; the leaf adapter
    // produces 0, here and in `writer-reach`'s 29.
    const why = ' — a MOVE, not a regression: re-read WRITER-CENSUS.md and update it and this number together, stating which mechanism moved'
    // ⚠ MOVED AGAIN 1055 → 1026 / 68 → 78 at #1037, and this time the mechanism is
    // the CORPUS: it gained backtick minis (long, multi-cycle, the hard material)
    // and shed commented-out code that was never an ask. A rate computed over the
    // two is not comparable — 1055/1217 = 86.7% against 1026/1204 = 85.2%.
    //
    // ⚠ MOVED A THIRD TIME 1026 → 1035 / 78 → 69 at #1010 P4c, and this mechanism is a
    // WRITER at last: the printer preserves a note's length instead of re-deriving it, so
    // the eleven fidelity failures #1026 exposed are gone. Attributed row by row against
    // the census JSON this file generated at `studio_v0.2.0`, and it is the eleven and
    // nothing else — 1204 rows on both sides, no row appearing or disappearing,
    // `no-probe` unmoved at 100:
    //   - 9 `view-corrupts → transfers`, the writes that now keep the length they always
    //     kept the onsets for (`<c2*2 g2*5 [a g]>`, `sd*2 sd*4 sd*8`, …);
    //   - 2 `view-corrupts → no-view`, gate `view-unusable` — `[bd ~]*2` and `[- - sd -]*2`,
    //     where the resolution cannot spell the length at all, so the writer declines and
    //     the view is no longer offered. That is the ranking this project already held:
    //     a view that never opens beats one that opens and mis-writes.
    // So transfers gains 9 while untransferable loses 9 (its no-view half rises 67 → 69,
    // its corrupting half falls 11 → 0). The rate was 1035/1204 = 86.0%, over the SAME
    // population as 1026/1204 = 85.2%, so those two ARE comparable — unlike the #1037 pair.
    //
    // ⚠ THE MECHANISM THAT MOVED NEXT: the ONSET SNAP GRID (#1066). It was
    // `LCM(1..16)`, which carries only 2^4, so it could not express a thirty-second —
    // a rational onset was rounded into an irrational one and refused by the very
    // MAX_STEPS test it should have passed. Widening it to `2^6·3^2·5·7·11·13` admits
    // 6 more rows, all `no-view/irrational-onset → transfers`, and they are ordinary
    // sixteenth-note patterns in a two-bar alternation rather than exotica.
    // Transfers 1035 → 1041, untransferable 69 → 63; the rate is 1041/1204 = 86.5%,
    // again over the same 1204 population, so it remains comparable to both figures
    // above. No row moved the other way, which is what says this is a widening and not
    // a trade.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // Folded so the WHOLE census reports in one run. These three partition the
    // population, so a corpus change moves all of them together — asserted apart,
    // each round of the gate reveals exactly one and hides the partition, which is
    // the only thing that makes the three numbers mean anything.
    expect(
      {
        transfers: all.filter((r) => r.outcome === 'transfers').length,
        untransferable: untransferable.length,
        unverified: all.filter((r) => r.outcome === 'no-probe').length,
      },
      'the census partition' + why,
      // ⚠ untransferable 68 -> 70 at #1827 (each bar drawn at its own step count), the other
      // two UNMOVED. The mechanism is `core-structured`: two units the core now serves drawn
      // per bar (`<~ ~ bd*3 bd*4 …>`, `<[36 48]*2 [34 46]*3 …>`) need 96 shared columns, and
      // the derived projections still cap at 64, so neither has a derived view to transfer to.
    // ⚠ 1096/70/109 -> 1106/76/121 at #1849: 28 asks the core newly serves — 10 transfer, 6 are untransferable (`no-leaf-anchor`: a `,`-stack the leaf writer cannot anchor), 12 have no probe to verify them.
    // ⚠ 1106/76/121 -> 1107/77/122 at #1849's `<…>` half: the 3 asks the core newly serves, one per bucket —
    // `bd bd bd bd, - sd - sd, <[cr oh …] [hh oh]*4!3>` transfers; `c2 c2 c2 c2 , < [~ g1 ~ ~] [~ ~ ~ g1] >` is
    // untransferable (`view-unusable`: no derived projection opens it, the core edits it ok); `<G4 A4 Bb4 A4>,Bb3,D3`
    // is unverified (`fully-chorded`: no singleton onset to probe).
    // ⚠ 1107/77/122 -> 1108/76/122 at #1974 (hits are anchored on their written note): one roll ask that had no derived
    // writer now transfers — the leaf writer can anchor it. Untransferable only fell.
    ).toEqual({ transfers: 1108, untransferable: 76, unverified: 122 })
    // The partition above may be re-pinned by any change — which is how untransferable went
    // 68 → 77 across #1827 and #1849. The ratchet (#1866) lets it only FALL: a rise needs an
    // exemption naming an issue, appended to modellingRatchet/ledger.json.
    assertRatchet('writer-census.untransferable', untransferable.length)
    // …and so may the asks nothing has verified, or an ask could leave `untransferable` by
    // losing its probe and read as progress (#1872).
    assertRatchet('writer-census.unverified', all.filter((r) => r.outcome === 'no-probe').length)
    // The reclassification is asserted by MECHANISM as well as by total, so that a
    // future change cannot hold the totals steady while moving asks between buckets.
    // ⚠ 11 → 0 at #1010 P4c. The printer preserves lengths, so nothing in the census
    // opens a view and then mis-writes it. This is BACK to the zero the block below
    // describes as the original state — but it is a different zero and the difference
    // matters: the first was an oracle that could not see duration, this one is a writer
    // that does not lose it, measured by an oracle that compares (onset, duration, atom)
    // on every surface. Kept as an exact `0` rather than deleted, because "nothing
    // corrupts" is the census's headline and it must fail loudly if it stops being true.
    expect(
      all.filter((r) => r.outcome === 'view-corrupts').length,
      'view-corrupts' + why,
    ).toBe(0)
    expect(
      all.filter((r) => r.outcome === 'view-corrupts' && r.writer === 'leaf'),
      'a leaf-adapter write corrupted — byte surgery is supposed to make that impossible',
    ).toEqual([])

    // THE GAIN THAT COUNTS, PINNED SEPARATELY FROM RAW REACH. #1019 moved 93 asks
    // from "no derived view at all" to a verified transfer — but only 32 of them
    // have more than one cell. The other 61 are a single atom: a CORRECT model of a
    // bare instrument name and a useless surface ([[P338]] clause 2). Quoting 93 as
    // the product gain would repeat the error this census exists to stop, so the
    // structured count is pinned beside the total and is the one to quote.
    // ⚠ 648 → 637 at #1026. All ELEVEN reclassified asks were structured, which is not a
    // coincidence worth glossing: the writes that lose duration are re-emits of
    // multi-element patterns, so the ones the axis catches are exactly the views that
    // were worth quoting. The structured count therefore falls by the full 11 while the
    // total falls by 11 too — the loss lands entirely on the half of the number this
    // line exists to keep honest.
    // ⚠ 624 → 633 at #1010 P4c, and the +9 is the whole of the transfers gain: all nine
    // asks the length-preserving printer recovered are STRUCTURED. That is the mirror of
    // the #1026 note above — the writes that lose a duration are re-emits of multi-element
    // patterns, so fixing the printer returns exactly the views worth quoting, just as
    // breaking the oracle had removed exactly those. The half of the number this line
    // exists to keep honest is the half that moved, in the good direction this time.
    // ⚠ 684 → 694 at #1849: the ten asks the core newly serves that transfer are all STRUCTURED (`,`-stacks with written steps). WRITER-CENSUS.md's #1849 note says so.
    // ⚠ 694 → 695 at #1849's `<…>` half: the one new transfer (`bd bd bd bd, - sd - sd, <[cr oh …] [hh oh]*4!3>`) is structured.
    // ⚠ 695 → 696 at #1974: the one roll ask that newly transfers (see the partition above) is a structured one.
    expect(all.filter((r) => r.outcome === 'transfers' && r.structured).length, 'structured transfers' + why).toBe(696)

    // THIS USED TO SAY "NOTHING CORRUPTS", and it said why that mattered: both derived
    // writers refuse rather than mis-write, which is what made the untransferable set
    // readable as an ADMISSION result rather than a fidelity one — and that if it ever
    // became non-zero, the census's headline would change meaning entirely, because a
    // view that opens and corrupts is worse than one that never opened.
    //
    // It became non-zero at #1026, and not because a writer changed. The zero was the
    // ORACLE's: its grid arm compared onsets only, so eleven writes that keep every atom
    // at every instant and hold one of them for a different length were scored clean.
    // The headline does change meaning, exactly as this comment warned it would, and the
    // honest reading is now: the untransferable set is an admission result PLUS eleven
    // fidelity failures, all on the grid, all from the element re-emit.
    //
    // What survives as an invariant is the sharper claim, and it is asserted rather than
    // narrated below: the ROLL still corrupts nowhere, and the LEAF ADAPTER corrupts
    // nowhere on either surface. Byte surgery copies every structural byte it was not
    // asked to change, so it cannot lose a length; the element re-emit re-derives every
    // length from a cell model that has none. The remaining zero is the one with a
    // mechanism behind it.
    //
    // ⚠ AND AT #1010 P4c THE ELEVEN ARE GONE — the element re-emit no longer re-derives a
    // length, so `view-corrupts` is 0 again and the narration above is now HISTORY rather
    // than the current reading. Keep it: it is the record of a headline that changed
    // meaning twice for two different reasons, which is the thing a bare number cannot
    // carry. But read the two assertions below for what they now are — with the total at
    // 0 they are satisfied by an EMPTY input, so they no longer discriminate anything on
    // their own ([[P352]]). What still discriminates is the exact `0` pinned above and the
    // row-by-row attribution in its comment; these two are kept as the shape that must
    // hold the moment the total is ever non-zero again.
    expect(
      all.filter((r) => r.outcome === 'view-corrupts' && r.surface === 'roll'),
      'the roll arm was already duration-aware — it is this change\'s control and must stay empty',
    ).toEqual([])
    expect(
      all.filter((r) => r.outcome === 'view-corrupts' && r.writer !== 'element'),
      'every known duration loss is the element re-emit; a different writer here is a new finding',
    ).toEqual([])

    // THE SPLIT IS THE DELIVERABLE, AND #1019 HAS NOW LANDED ON IT. It was 101
    // naming hole / 50 candidate structural; naming the `:`-variant took the first
    // column to 7 and left the second EXACTLY where it was. That the structural
    // column did not move is the load-bearing half of this assertion: a fix that
    // also moved it would mean the two classes were never independent, and the
    // whole hole-versus-bound split would need re-deriving.
    //
    // The 7 that remain play an array value AND have a second, real blocker (six
    // `,`-stacks with no leaf anchor, one past the period cap) — so they are
    // structural residual that happens to contain a `:`, not naming failures.
    //
    // ⚠ the structural column moved 50 → 61 at #1026, and that move is NOT a change in
    // the split's meaning. The 11 are the duration reclassification above; none of them
    // plays an array value, so they land wholly in the second column. The claim this
    // assertion protects — that naming the `:`-variant did not touch the structural
    // column — is about #1019 and still holds, because the array column is still 7.
    //
    // ⚠ THEN 61 → 70 at #1037 (the corpus) and 70 → 61 at #1010 P4c (the printer, giving
    // back the 9 asks it recovered). The trail is recorded because the column has now
    // been 61 TWICE for unrelated reasons, and the #1037 leg went unwritten at the time —
    // so for one phase the prose said "61" beside a pin that read 70. A figure only named
    // in a comment has no gate on it ([[P356]]); the pin is the record and the comment
    // must be re-read whenever the pin moves, in both directions.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures):
    // array 8 → 9, structural 55 → 59, summing to `untransferable` = 68. BOTH
    // columns moved this time, which is the honest reading of a POPULATION change
    // and not of a mechanism change — the widening adds material of both kinds,
    // so the #1019 claim above (that naming the `:`-variant left the structural
    // column alone) is untouched: it is about a code change holding one column
    // still, and nothing here re-tests it.
    // Folded into one array assertion so BOTH columns report in a single run —
    // `expect` aborts a test at its first failure, and the whole point of this
    // pair is the split between the columns, which one value cannot show.
    // ⚠ structural 59 -> 61 at #1827 (each bar drawn at its own step count): the two core-served units that need 96 shared columns.
    // ⚠ [9, 61] -> [12, 64] at #1849: the three grids it newly opens, each an array-value `no-leaf-anchor` structural ask (WRITER-CENSUS.md).
    // ⚠ [12, 64] -> [12, 65] at #1849's `<…>` half: `c2 c2 c2 c2 , < [~ g1 ~ ~] [~ ~ ~ g1] >`, untransferable (`view-unusable`), is structural and not an array value.
    // ⚠ [12, 65] -> [12, 64] at #1974: the one roll ask that now transfers was a structural one.
    expect([p6.both.arrayValue, p6.both.structural]).toEqual([12, 64])

    // THE NUMBER P6 IS SCOPED AGAINST, and it is a CONJUNCTION. "46 have a
    // structured core view" and "45 have a verified core edit" are different
    // filters over the same 50, and quoting either alone overstates the blocker
    // set. The set that actually blocks deleting the core is both at once.
    //
    // ⚠ 41 → 45 and so 40 → 44 at #1022, with the untransferable set UNCHANGED at 50.
    // Nothing became harder to replace; the INCUMBENT became more testable. The probe
    // used to read cycle 0 only, so a core view whose pattern rests in bar 0 counted as
    // unverified rather than as verified — and this column is the core's own probe.
    // The cost of deleting the core did not rise, our measurement of it did.
    //
    // ⚠ 44 → 46 at #1026, and the small size of that move is the interesting part.
    // Eleven asks were reclassified from `transfers` to `view-corrupts`, so the
    // structural set grew by eleven — but the blocker set grew by only TWO, because
    // this column holds the INCUMBENT to the same restored axis. Eight of the eleven
    // are asks where the CORE's own write loses the same duration; those were never
    // reach on either side and charging them to the projection would be a free win for
    // the incumbent, which is exactly what this conjunction exists to prevent. Only the
    // three the core writes faithfully are a real cost, and two of those have a
    // structured core view.
    //
    // ⚠ 46 → 54 at #1037, and the mechanism is again the CORPUS rather than any
    // writer: it gained the backtick material and shed commented-out code. This is
    // the number P6 is scoped against, so it must not be carried across that change
    // silently — 46 was over 1500 harvested units, 54 is over 1535 differently
    // harvested ones.
    //
    // ⚠ AND AT #1010 P4c IT DID NOT MOVE — 54 still, grid 24 + roll 30, while the
    // structural set fell 70 → 61 and its `coreStructured` column fell 65 → 56. That
    // pairing is the finding, not a coincidence: all 9 asks the length-preserving printer
    // recovered had a STRUCTURED core view and NONE had a verified core edit
    // (`coreProbe === 'ok'` is unmoved at 55). The core could not write them faithfully
    // either, so they were never part of what blocks deleting it. P4c recovered 9 views
    // and reduced the P6 blocker by ZERO, and #1012 stays scoped against 54 — a phase
    // that improves reach is not thereby a phase that shrinks this conjunction, which is
    // exactly the confusion this filter was built to prevent.
    //
    // MEASURED AT THE OTHER CAP TOO, since P6 carries `LEAF_PROJECT_BARS.roll = 12` in
    // its own diff — but the figure does NOT live in this comment any more (#1046).
    // ⚠ It used to, and it read "39 (grid 24 + roll 15)" while the observation had moved
    // to 35 (grid 18 + roll 17): a fifth transcribed copy, sitting in the file that gates
    // the shipped-cap half of the same pair. It is now `P6-CAP12.json`, taken by
    // `scripts/p6-cap-census.mjs`, checked for currency by the arm below, and spliced into
    // both documents. Read it from there — and note the reason it stayed an OBSERVATION
    // rather than becoming a subtraction, which the deleted text was right about and is
    // now written down in `p6Table.ts` instead of here.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures):
    // coreStructured 50 -> 53, coreEdits 49 -> 53, the conjunction 48 -> 51. All
    // three rise together and the mechanism is the CORPUS, exactly as at #1037 —
    // the widening admits structural units of the same kinds already present, not a
    // new kind.
    //
    // ⚠⚠ THE PROSE ABOVE IS A HISTORICAL TRAIL AND ITS "54" IS TWO CHANGES BEHIND
    // THIS PIN — already wrong BEFORE #1242. Re-measured on `studio_v0.2.0` over the
    // unchanged 1535-row corpus, the P6 blocker reads 48 (grid 18 + roll 30).
    //
    // ⚠ AND THE HONEST DIAGNOSIS IS NOT "UNGATED". The blocker IS this file's
    // `coreStructured && coreProbe === 'ok'` pin, which read `toBe(54)` from #1015
    // until #1066 (the onset snap grid, `44a97960`) moved it to `toBe(48)` — and
    // that PR updated the pin while leaving the doc's table saying "54 | 54 |
    // unmoved". So the failure is a DOCUMENT TRANSCRIBING A GATED FIGURE and then
    // drifting from it, which is what #1046 (open, filed 2026-07-26 about the
    // sibling sweep doc) already names and already prescribes the fix for: derive
    // the table, do not transcribe it. **Do not scope #1012 against 54.**
    //
    // #1242 then moves the blocker 48 -> 51, and the shape of that move is the
    // finding: the GRID half is UNMOVED at 18 across the whole widening and all
    // three new blockers are roll asks. The grid's irreplaceable set did not grow
    // with the corpus, which is evidence it is a property of the notation rather
    // than of how much of it we happened to harvest. Measured as a paired
    // differential in WRITER-CENSUS.md's #1242 section.
    // Folded into one object so all three report in a single run: the CONJUNCTION is
    // the number P6 is scoped against, and it only means anything read beside its two
    // conjuncts. Asserted apart, a population change reports the first and hides
    // whether the conjunction moved with it or independently of it.
    //
    // ⚠ READ FROM `p6`, NOT RE-FILTERED HERE (#1046). This pin held its own copy of the
    // three filters, and the break matrix for that issue is what showed what that cost:
    // corrupting the shared rule's conjunction reddened the staleness arm and left THIS
    // one green, so the number in the documents and the number in the pin were free to
    // drift apart — which is the disease this issue exists to cure, reproduced one level
    // in. A pin that cannot be made to fail by breaking the rule it pins is not a pin on
    // that rule ([[P519]]).
    expect({
      coreStructured: p6.both.coreStructured,
      coreEdits: p6.both.coreEdits,
      both: p6.both.blocker,
      // ⚠ 53/53/51 -> 55/55/53 at #1827 (each bar drawn at its own step count): the two units the
      // core newly serves per bar have structure AND a core edit the engine oracle verifies —
      // once the oracle measures a per-bar model with its own ruler (`barRuler`). Before
      // that fix the drum grid's edit was filed `corrupt`: the probe deleted the wrong cell.
    // ⚠ 55/55/53 -> 58/56/54 at #1849, from the stacks it opens. Of the new structural rows, the two without a verified core edit are the rolls `0,.1` and `0,.1,7, 6.9` — `no-probe`, decimal `n` values; the blocker set moves by one, on the roll.
    // ⚠ 58/56/54 -> 59/57/55 at #1849's `<…>` half: `c2 c2 c2 c2 , < [~ g1 ~ ~] [~ ~ ~ g1] >` has structure and a core edit the engine oracle verifies, once the writer and the oracle agree on what a delete in a repeated part does. First measured with linked repeats and a repeat-aware oracle; unchanged under bar-by-bar edits with the oracle back to "every other bar untouched".
    // ⚠ 59/57/55 -> 58/56/54 at #1974: the one roll ask the leaf writer can now anchor leaves all three — it transfers, so it is no longer a row here.
    }).toEqual({ coreStructured: 58, coreEdits: 56, both: 54 })
    // …and the set that blocks P6 may only fall (#1866): 51 → 55 happened one re-pin at a time.
    assertRatchet('writer-census.p6-blocker', p6.both.blocker)

    // …and the split the whole conjunction exists to keep visible. Asserted here rather
    // than left to the generated document, because the document is an OUTPUT of this run
    // and cannot testify about it.
    // ⚠ [18, 33] -> [19, 34] at #1827 — one per surface, the two units the core newly serves per bar.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ [19, 35] -> [20, 35] at #1849's `<…>` half — grid only: the `c2 … < … >` unit above.
    // ⚠ [20, 35] -> [20, 34] at #1974 — roll only: that same ask, which the leaf writer can anchor now.
    expect([p6.grid.blocker, p6.roll.blocker]).toEqual([20, 34])
  }, 900_000)

  /**
   * THE TWO DOCUMENTS ARE GENERATED, NOT TRANSCRIBED (#1046).
   *
   * Both carry a P6 section, both were typed out by hand from a run, and by the time this
   * was written three of the four rows in each had drifted while one was right by
   * accident. Nothing here ASSERTS the documents' contents — a test that writes a file and
   * then checks it is [[P578]]'s circularity in another costume, and there would be
   * nothing left for the assertion to catch anyway. Splicing removes the drift by
   * construction.
   *
   * What CAN still fail is the splice silently doing nothing, which is the same class as
   * the defect it replaces: an anchored edit whose anchor has gone appends instead, and
   * every count-the-token check still passes ([[P497]]). So `writeGeneratedBlock` throws
   * on a missing, duplicated or inverted marker, and this arm is where that lands.
   */
  it('generates the P6 table into both documents rather than letting them transcribe it', () => {
    const observationPath = path.join(corpusDir, 'P6-CAP12.json')
    if (!fs.existsSync(observationPath))
      throw new Error(
        'P6-CAP12.json is missing — the cap-12 column has no observation to splice.\n' +
          '  Take one:  node scripts/p6-cap-census.mjs 12\n' +
          '  (that script runs this census twice, so it reaches this point before this throw does)',
      )
    const observation: P6CapObservation = JSON.parse(fs.readFileSync(observationPath, 'utf8'))
    const section = renderP6Table(observation, p6, minis.length)
    for (const doc of ['ROLL-CAP-SWEEP.md', 'WRITER-CENSUS.md']) {
      const at = path.join(corpusDir, doc)
      fs.writeFileSync(at, spliceP6Block(fs.readFileSync(at, 'utf8'), section, doc))
    }
  })

  /**
   * THE ONE COLUMN NO RUN CAN PRODUCE, AND ITS EXPIRY (#1046).
   *
   * The cap-12 figure is an observation taken with `LEAF_PROJECT_BARS.roll` rewritten, so
   * it cannot be re-derived here and must not be — a subtraction standing in for a
   * measurement is the same defect inverted, and that was refused when it was first
   * proposed. What CAN be re-derived is the cap-4 reading recorded beside it by the same
   * run. When that stops matching this tree the observation is stale, and this reddens
   * with the script to re-take it.
   *
   * ⚠ Necessary, not sufficient — a change touching only periods in (4, 12] moves the
   * observed column and leaves this green. The limit is stated in `p6Table.ts` and is why
   * the roll's period gate is named there as a "re-run regardless" trigger.
   */
  it('the committed cap-12 observation is still about this tree', () => {
    const observation: P6CapObservation = JSON.parse(
      fs.readFileSync(path.join(corpusDir, 'P6-CAP12.json'), 'utf8'),
    )
    assertObservationCoherent(observation)
    assertObservationCurrent(observation, allAsks, p6.cap, minis.length)
  })

  /**
   * MECHANISM, NOT LABEL. The refusal label has overstated the opportunity every
   * time it has been counted, so each claim about WHY an ask is untransferable is
   * asserted here against something other than the label — the engine's own period
   * for the first, a rewrite experiment with a control arm for the second.
   *
   * These live in the committed gate rather than in a probe that gets deleted,
   * because they are the evidence for this phase's conclusion. A future change that
   * quietly breaks the mechanism should fail a test, not survive until someone
   * re-derives it.
   */
  describe('the untransferable set, by verified mechanism', () => {
    const structural = [...grid, ...roll].filter(
      (r) => (r.outcome === 'no-view' || r.outcome === 'view-corrupts') && !r.arrayValue,
    )

    it('every unstable-period ask really does have a period past its surface cap', () => {
      // the shipped caps, taken from the writer rather than copied beside it (#1025)
      const CAP = { step: PROJECTION_PERIOD_BOUNDS.leaf.grid, roll: PROJECTION_PERIOD_BOUNDS.leaf.roll } as const
      const rows = structural.filter((r) => r.gate === 'unstable-period')
      // 36 → 35 (#1066), and this one falls rather than rises, which is worth a word.
      // Period detection compares cycles through the same snap grid. When the grid
      // could not express a position exactly, the SAME musical instant in two cycles
      // could round to two different keys, and a periodic pattern read as aperiodic.
      // One unit was being refused that way; an exact grid lets its cycles compare
      // equal. So the widening repaired a detection error as well as a resolution one.
      // ⚠ 35 -> 39 at #1242 — the corpus widened 1535 -> 1633 units
      // (98 arrivals, 0 departures): the harvest gained the product's own
      // resolver, so every figure here is over a wider population. Upward only.
      expect(rows.length).toBe(39)

      const withinCap: string[] = []
      let past = 0
      let aperiodic = 0
      let rollBlockedByItsOwnCap = 0
      for (const r of rows) {
        const p = truePeriod(r.mini)
        if (p === 0) aperiodic++
        else if (p > CAP[r.surface]) {
          past++
          // The finding that gates the epic's deletion phase (#1020): the ROLL's cap
          // of 4 — not the grid's 12 — is what stops these. Measured, not argued.
          if (r.surface === 'roll' && p <= 12) rollBlockedByItsOwnCap++
        } else withinCap.push(`${r.surface} period=${p} ${r.mini}`)
      }
      console.log(
        `\n  unstable-period: ${past} past the cap, ${aperiodic} aperiodic, ` +
          `${rollBlockedByItsOwnCap} roll asks with period in (4, 12] — cleared by the grid's existing cap`,
      )
      // THE MUST-NOT: an ask refused for the period cap whose period is WITHIN the
      // cap would mean the gate is misattributing, and the whole mechanism claim
      // (and #1020 with it) would be wrong.
      expect(withinCap, withinCap.join('\n')).toEqual([])
      // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
      // Folded into one array assertion so all three report in a single run.
      expect([past, aperiodic, rollBlockedByItsOwnCap]).toEqual([36, 3, 24])
    }, 900_000)

    it('naming a `:`-variant is the exact INVERSE of krill lowering it, and the whole tail is load-bearing', () => {
      // THE MECHANISM, ASSERTED AFTER THE FIX. Before #1019 the evidence was a
      // rewrite experiment — turn `word:index` into `word_index`, watch the verdict
      // flip. That experiment cannot outlive the fix, because the rows it filtered
      // are no longer refused. So the claim it stood for is asserted directly:
      // joining krill's array value on `:` reconstructs the token it was lowered
      // FROM, which is what makes the token safe to write back verbatim.
      //
      // GROUNDED, not inferred: `tail` is the only op that builds an array value and
      // it ACCRETES (`@strudel/mini/mini.mjs:50-52` —
      // `Array.isArray(a) ? [...a, b] : [a, b]`).
      const played = (src: string): unknown[] => {
        try {
          return (src === '' ? [] : (reifyMini(src) as { queryArc(a: number, b: number): { value: unknown }[] }).queryArc(0, 1))
        } catch {
          return []
        }
      }
      let checked = 0
      let headWouldBeWrong = 0
      const wrong: string[] = []
      for (const m of minis) {
        for (const h of played(m)) {
          const v = (h as { value: unknown }).value
          if (!Array.isArray(v)) continue
          const token = tailToken(v)
          if (token === null) {
            wrong.push(`unnameable array value in ${JSON.stringify(m)}: ${JSON.stringify(v)}`)
            continue
          }
          checked++
          // Re-reify the reconstructed token ON ITS OWN and require the SAME value
          // back. This is the round trip the write-back depends on.
          const back = played(token).map((x) => (x as { value: unknown }).value)
          if (back.length !== 1 || JSON.stringify(back[0]) !== JSON.stringify(v)) {
            wrong.push(`${JSON.stringify(m)}: ${JSON.stringify(v)} named ${JSON.stringify(token)} re-plays ${JSON.stringify(back)}`)
          }
          // THE RED TEST, run as arithmetic rather than by breaking the source: a
          // `v[0] + ':' + v[1]` naming — the shape the reference notes described,
          // and the one I would have written from memory — silently drops the tail.
          if (v.length > 2) headWouldBeWrong++
        }
      }
      console.log(`\n  ':'-variant naming: ${checked} array values round-tripped, ${wrong.length} wrong; head-only naming would corrupt ${headWouldBeWrong}`)
      expect(wrong.slice(0, 5), wrong.slice(0, 5).join('\n')).toEqual([])
      // The corpus must actually EXERCISE this, or the assertion above is vacuous.
      expect(checked).toBeGreaterThan(300)
      // And the join must be doing real work: if this is ever 0, the corpus stopped
      // covering 3-member variants (`sd:0:0.5`) and the round trip above would pass
      // for a head-only naming too — the assertion would still be green and would
      // no longer be evidence for anything.
      expect(headWouldBeWrong).toBeGreaterThan(0)
    }, 900_000)

    it('the 7 remaining array-value asks are held by a SECOND blocker, not by naming', () => {
      // The counterpart to the test above, and the reason the residual can still be
      // called structural: every untransferable ask that still plays a `:`-variant
      // must be stopped by a gate that has nothing to do with naming. If one ever
      // shows up refused for want of note content again, the naming regressed.
      const rows = [...grid, ...roll].filter(
        (r) => (r.outcome === 'no-view' || r.outcome === 'view-corrupts') && r.arrayValue,
      )
      console.log(
        `\n  array-value asks still untransferable (${rows.length}):\n` +
          rows.map((r) => `     ${r.surface}  ${r.gate}  ${JSON.stringify(r.mini).slice(0, 70)}`).join('\n'),
      )
      // ⚠ 8 -> 9 at #1242 — the corpus widened 1535 -> 1633 units
      // (98 arrivals, 0 departures): the harvest gained the product's own
      // resolver, so every figure here is over a wider population. Upward only.
      // ⚠ 9 -> 12 at #1849: the three grids it newly opens (`bd, [- - [sd:1]]`, `[bd@4 bd] cp:3:1, hh*8:.1:0.6`, `bd(10,16)/2, …`) — all `no-leaf-anchor`, none refused for want of note content.
      expect(rows.length).toBe(12)
      expect(rows.filter((r) => r.gate === 'no-note-content')).toEqual([])
      // six `,`-stacks with no leaf anchor, one past the period cap — both are the
      // SAME bounds the non-array residual is made of, which is what makes these
      // structural residual that happens to contain a `:` rather than naming misses.
      // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      expect(rows.filter((r) => r.gate === 'no-leaf-anchor').length).toBe(11)
      expect(rows.filter((r) => r.gate === 'unstable-period').length).toBe(1)
    }, 900_000)

    it('the census population IS the population the shipped path serves via the core', () => {
      // THE OTHER SIDE OF THE BOUNDARY. Every number in this file rests on "the asks
      // this census sweeps are exactly the asks the core serves in production", and
      // that rests in turn on `parseStepGrid` handing back the core's own result
      // whenever the core succeeds. That is one line of `parse.ts` — and reading a
      // line is inference. Verify it against the real entry point instead.
      const mismatches: string[] = []
      const missingOverlay: string[] = []
      let checked = 0
      let overlaid = 0
      for (const s of [
        { k: 'grid', core: parseStepGridCore, full: parseStepGrid },
        { k: 'roll', core: parsePianoRollCore, full: parsePianoRoll },
      ]) {
        for (const mini of minis) {
          const core = s.core(mini)
          if (!core.ok) continue
          checked++
          const full = s.full(mini)
          if (!full.ok) {
            mismatches.push(`${s.k}: shipped path REFUSED a core-served ask: ${mini}`)
            continue
          }
          const fm = full.model as StepGridModel & PianoRollModel
          // a projection answered where the core should have — the census would then
          // be measuring a counterfactual against the wrong incumbent
          if (fm.leafSource) mismatches.push(`${s.k}: leaf writer answered a core-served ask: ${mini}`)
          else {
            // ⚠ SINCE #1233 THE SHIPPED PATH ADDS EXACTLY ONE FIELD: the surgical overlay,
            // attached at the public entry so that the CORE stays a pure description of what
            // the syntactic core read. So the comparison is "identical apart from `surgical`",
            // and both halves of that are asserted — the field must BE there, and everything
            // else must match.
            //
            // ⚠⚠ STRIPPING ALONE WOULD BE A GATE GOING BLIND. `surgical.spans` is a function
            // and `JSON.stringify` drops function-valued properties, so a comparison that
            // merely ignored the field would also stop being able to see an overlay that was
            // never attached — it would go green for the change AND for the change being
            // unwired. The presence check is what keeps it honest, and `overlaid` below is
            // asserted against the same denominator the population count uses.
            if (!fm.surgical) missingOverlay.push(`${s.k}: no overlay on a core-served ask: ${mini}`)
            else overlaid++
            const { surgical: _f, ...fmBare } = fm
            const { surgical: _c, ...coreBare } = core.model as StepGridModel & PianoRollModel
            if (JSON.stringify(fmBare) !== JSON.stringify(coreBare))
              mismatches.push(`${s.k}: shipped model differs from the core's: ${mini}`)
          }
        }
      }
      console.log(
        `\n  shipped path vs core over ${checked} core-served asks: ${mismatches.length} mismatches,` +
          ` ${overlaid} carrying #1233's overlay`,
      )
      expect(mismatches, mismatches.slice(0, 5).join('\n')).toEqual([])
      expect(missingOverlay, missingOverlay.slice(0, 5).join('\n')).toEqual([])
      // ⚠ 1204 -> 1273 at #1242 — the corpus widened 1535 -> 1633 units
      // (98 arrivals, 0 departures): the harvest gained the product's own
      // resolver, so every figure here is over a wider population. Upward only.
      // ⚠ 1273 -> 1275 at #1827: the two units the core newly serves per bar (see the
      // population pins above).
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      expect(checked).toBe(1306)
      // the field the comparison above is allowed to ignore must be on EVERY one of them —
      // otherwise "identical apart from `surgical`" is satisfied by never attaching it
      // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      expect(overlaid, 'the overlay is not reaching the core-served asks').toBe(1306)
    }, 900_000)

    it('RED TEST: the census distinguishes the two writers — it is not measuring one twice', () => {
      // The census's whole content is that the core's model and the derived model
      // can disagree. If `probeEdit` gave the same verdict for both on every ask,
      // the counterfactual would be vacuous and every number above would be an
      // elaborate restatement of the incumbent. Require the DISAGREEMENT.
      let disagree = 0
      for (const s of SURFACES) {
        for (const mini of minis) {
          const core = s.core(mini)
          if (!core.ok) continue
          const derived = s.derived(mini, NO_CORE_REFUSAL)
          const coreV = probeEdit(mini, core.model as StepGridModel & PianoRollModel, s.edit).verdict
          const derV = derived.ok
            ? probeEdit(mini, derived.model as StepGridModel & PianoRollModel, s.edit).verdict
            : 'no-view'
          if (coreV !== derV) disagree++
        }
      }
      console.log(`\n  asks where the two writers' probes DISAGREE: ${disagree}`)
      // THE THRESHOLD MOVED WITH #1019, AND DOWNWARD IS THE EXPECTED DIRECTION.
      // It was >100 when 101 asks were untransferable purely because the derived
      // projection could not name a `:`-variant — much of that "disagreement" was
      // the naming hole, not a real difference between the writers. Naming it
      // removed 93 of those disagreements and the figure fell to 63.
      //
      // The test's PURPOSE is unchanged and still met: the two writers must not be
      // the same measurement twice. 63 genuine disagreements over 1217 asks is that
      // proof, and the bound is re-pinned rather than deleted so a future change
      // that collapses the counterfactual entirely still turns this red.
      expect(disagree).toBeGreaterThan(50)
    }, 900_000)
  })
})
