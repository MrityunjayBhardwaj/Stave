/**
 * capSweep.ts — one leaf period cap sweep, parameterised by the surface it measures.
 * Extracted at its SECOND use (#1041), the move `generatedDoc.ts` made at #1270.
 *
 * WHAT WAS DUPLICATED. `LEAF_PROJECT_BARS` is one declaration with two fields, and only
 * the roll's had a sweep: a driver that sets the real constant, a gate that reads its own
 * cap back out of the shipped refusal sentence, two populations reported alone, a per-ask
 * artifact, and a generated table with an expiry stamp. The grid's justification was a
 * figure in a comment, and that figure was wrong by nearly a factor of two the one time
 * anyone re-took it (#1038). Everything in this file is the part of that machinery that
 * does not care which surface it is pointed at.
 *
 * ⚠⚠ WHAT IS DELIBERATELY *NOT* HERE, AND WHY THE DESCRIPTOR CARRIES PROSE ([[PV338]]).
 * The two halves of one constant govern populations that respond to it completely
 * differently. The roll's core-SERVED population reads 369 transfers at cap 4, 3, 2 AND 1
 * — only 16 of its 415 opened views are leaf-served, so the constant barely reaches it,
 * and #1270 had to record that the roll's B floor "is not a guard on the constant this
 * file sweeps". The grid's B has 74 of 820 leaf-served and moves 717 → 727. Copying that
 * sentence into the grid arm would understate a guard that works.
 *
 * So the SHAPE is shared and the READING is not. Every number below is derived from the
 * run; every sentence that interprets one is supplied by the surface. A finding about one
 * half transfers to the other only by measurement.
 */
import fs from 'node:fs'
import path from 'node:path'
import { hasStructure } from '../../../editor/src/codeView/notation/model'
import type {
  ParseResult,
  PianoRollModel,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import { liveness, probeEdit, type Surface } from './engineEditOracle'
import { truePeriod } from './enginePeriod'
import type { BlockMarkers } from './generatedDoc'
import { readSweep, type SweepObservation } from './capSweepTable'

export type Pop = 'A-core-refused' | 'B-core-served'
export type Outcome = 'transfers' | 'no-view' | 'view-corrupts' | 'no-probe'

/**
 * The model type both readers already agree on.
 *
 * `engineEditOracle.ts` types `probeEdit`/`liveness` against this same intersection, so
 * the cast below is not a new claim — it is the one the oracle has always made about a
 * model it is handed.
 */
export type SweptModel = StepGridModel & PianoRollModel

/** either surface's parse, before the model is narrowed */
export type CapParse = ParseResult<StepGridModel> | ParseResult<PianoRollModel>

/** the census's fallback: population B's asks have no core refusal to carry */
export const NO_CORE_REFUSAL = { ok: false as const, reason: '(core served this — no refusal)' }

export interface Row {
  pop: Pop
  mini: string
  outcome: Outcome
  /** the gate that stopped it, when nothing opened */
  gate?: string
  /** which derived writer served it */
  writer?: 'leaf' | 'element'
  /**
   * More than one unit — a one-unit view is a correct model and a useless surface.
   *
   * SHARED, not restated (#1259). `hasStructure` has one home in `notation/model.ts`, and
   * the surface descriptor's oracle key is the same key it takes, so a sweep cannot
   * disagree with the census about what "worth showing" means.
   */
  structured?: boolean
  /**
   * ⚠ ROLL ONLY — the roll model's note count. A grid model has no equivalent scalar;
   * it carries lanes of cells, so this is absent on every grid row rather than 0. The
   * driver's per-ask diff omits it for that reason, and the surface's `unitNoun` — not
   * this field — is what the shared report should ask for a noun.
   */
  notes?: number
  /** units whose own delete round-trips / units cleanly probeable; null when none are */
  alive?: number
  probed?: number
  /** units that MIS-WRITE — a dead unit and a lying unit are not the same fact */
  liveCorrupt?: number
  /** the engine's own period, for the asks the cap governs */
  period?: number
}

/**
 * One surface's half of `LEAF_PROJECT_BARS`, and everything a sweep of it needs.
 *
 * The three parse entry points are passed rather than switched on, because the whole
 * point of the A/B split is which chain is asked: `parse` is the SHIPPED path (what a
 * user gets), `derived` is the writer chain BELOW the core (what survives the core being
 * deleted), and `core` carves the two populations without reading the cap at all.
 */
export interface CapSurface {
  /** the `LEAF_PROJECT_BARS` field this sweep varies */
  cap: 'grid' | 'roll'
  /** population A's path — core → projection, exactly what production runs */
  parse: (mini: string) => CapParse
  /** carves the populations; must not read the cap, or the two runs are not comparable */
  core: (mini: string) => { ok: boolean }
  /** population B's path — the writer chain below the core */
  derived: (mini: string, fallback: { ok: false; reason: string }) => CapParse
  /** the edit oracle for this surface; its `key` is also `hasStructure`'s */
  oracle: Surface
  /**
   * A pattern whose period is past every admissible cap, in THIS surface's vocabulary.
   *
   * ⚠ It must reach `unstable-period` and not an earlier gate ([[PK99]]). The roll's
   * `<0 1 … 25>` plays numbers, so the grid refuses it for `wrong-surface`; 25 identical
   * alternatives are claimed by `edit-unsafe` before the period gate is reached. The
   * probe's job is to make the writer say its own bound out loud, and a probe that stops
   * early cannot.
   */
  capProbe: string
  /** per-ask rows, one file per cap; gitignored — the driver's input, not an artifact */
  runsDir: string
  /** the document carrying the generated table */
  doc: string
  /** the committed observation at the caps no gate can re-derive */
  observation: string
  /** that document's marker pair */
  block: BlockMarkers
  /** the command that re-takes the observation, for the message when it is missing */
  script: string
  /** what the table calls one ask of this surface: `roll asks` / `grid asks` */
  asksNoun: string
  /**
   * What ONE editable unit of this surface is called, singular: `note` / `cell`.
   *
   * Separate from `asksNoun` because they count different things — an ask is one
   * pattern put to the surface, a unit is one thing inside the view it opened. The
   * report counts units and used to call them notes on both surfaces, which is the
   * roll's vocabulary; a grid model carries lanes of cells (#1279). The counts were
   * right and only the noun was wrong, which is the harder kind to notice.
   */
  unitNoun: string
  /**
   * ⚠ The two clauses [[PV338]] forbids sharing: what population A's movement MEANS for
   * this surface, and what population B's does. The figures around them are generated.
   */
  aNote: string
  bNote: string
}

/**
 * The cap this run actually measured, read out of the shipped code.
 *
 * `gateReason('unstable-period', …)` prints the LEAF cap verbatim, so a pattern whose
 * period is past any plausible cap makes the writer say its own bound out loud. Asked of
 * the writer rather than trusted from `process.env`, because the one thing a sweep must
 * not get wrong is which cap a row belongs to ([[P347]]).
 */
export function shippedCap(s: CapSurface): number {
  const r = s.derived(s.capProbe, NO_CORE_REFUSAL)
  if (r.ok) throw new Error(`${s.cap} cap probe opened a view — the probe pattern is no longer past the cap`)
  if (r.gate !== 'unstable-period')
    throw new Error(
      `${s.cap} cap probe stopped at ${r.gate}, not the period gate — cannot read the cap. ` +
        `A probe must present DISTINCT cycles in this surface's own vocabulary, or an ` +
        `earlier gate claims it first.`,
    )
  const m = /within (\d+) bars/.exec(r.reason)
  if (!m) throw new Error(`${s.cap} cap probe's sentence does not name a bound: ${r.reason}`)
  return Number(m[1])
}

/**
 * One population's rows.
 *
 * `A` asks the SHIPPED path because that is what a user gets. `B` asks the writer chain
 * BELOW the core, because the question there is what survives the core being deleted —
 * asking the shipped path would just return the core's own model and measure nothing.
 */
export function sweep(s: CapSurface, pop: Pop, minis: readonly string[]): Row[] {
  const out: Row[] = []
  for (const mini of minis) {
    const core = s.core(mini)
    if (core.ok !== (pop === 'B-core-served')) continue

    const r = pop === 'A-core-refused' ? s.parse(mini) : s.derived(mini, NO_CORE_REFUSAL)

    if (!r.ok) {
      const gate = r.gate ?? '(no gate — did not reify)'
      out.push({
        pop,
        mini,
        outcome: 'no-view',
        gate,
        // the period is what the cap is ABOUT; computed only where it can decide
        // something, because 48 engine queries per mini over 1600 minis is not free
        ...(gate === 'unstable-period' ? { period: truePeriod(mini) } : {}),
      })
      continue
    }
    const m = r.model as SweptModel
    const writer = m.leafSource ? 'leaf' : 'element'
    const probe = probeEdit(mini, m, s.oracle)
    const live = liveness(mini, m, s.oracle)
    out.push({
      pop,
      mini,
      outcome:
        probe.verdict === 'ok' ? 'transfers' : probe.verdict === 'corrupt' ? 'view-corrupts' : 'no-probe',
      writer,
      structured: hasStructure(m, s.oracle.key),
      notes: m.notes?.length ?? 0,
      ...(live ? { alive: live.alive, probed: live.probed, liveCorrupt: live.corrupt } : {}),
      // a leaf-served view is one the cap could have decided; the element writer's own
      // cap never moves in this sweep, so its rows are carried as the control arm
      ...(writer === 'leaf' ? { period: truePeriod(mini) } : {}),
    })
  }
  return out
}

const pct = (a: number, b: number): string => (b === 0 ? '   n/a' : `${((a / b) * 100).toFixed(1)}%`)

export function report(s: CapSurface, rows: Row[], pop: Pop, cap: number): void {
  const by = (o: Outcome) => rows.filter((r) => r.outcome === o)
  const opened = rows.filter((r) => r.outcome !== 'no-view')
  const leaf = opened.filter((r) => r.writer === 'leaf')
  const gates = new Map<string, number>()
  for (const r of by('no-view')) gates.set(r.gate!, (gates.get(r.gate!) ?? 0) + 1)

  console.log(`\n===== ${s.cap.toUpperCase()} CAP ${cap} — POPULATION ${pop} (${rows.length} asks) =====`)
  console.log(`  opened by a derived writer      ${opened.length}   (${leaf.length} leaf / ${opened.length - leaf.length} element)`)
  console.log(`  transfers (edit survives)       ${by('transfers').length}   ${pct(by('transfers').length, rows.length)}`)
  console.log(`  no view at all                  ${by('no-view').length}`)
  console.log(`  view CORRUPTS                   ${by('view-corrupts').length}   <-- must be 0`)
  console.log(`  unverified (no clean probe)     ${by('no-probe').length}`)
  console.log(`  -- what stopped the ones with no view --`)
  for (const [k, v] of [...gates.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).padStart(4)}x  ${k}`)

  // THE OTHER HALF OF THE DECISION: is the view worth showing? Reported for the LEAF
  // writer only — it is the one this cap governs.
  const withLive = leaf.filter((r) => r.probed !== undefined && r.probed > 0)
  const alive = withLive.reduce((n, r) => n + r.alive!, 0)
  const probed = withLive.reduce((n, r) => n + r.probed!, 0)
  const liveCorrupt = withLive.reduce((n, r) => n + (r.liveCorrupt ?? 0), 0)
  // the noun comes from the surface: a roll model carries notes, a grid model carries
  // lanes of cells. The column width is held so the two surfaces stay comparable.
  const unit = s.unitNoun
  const label = (t: string): string => t.padEnd(29)
  console.log(`  -- LEAF-served views: is the view worth showing --`)
  console.log(`     ${label(`structured (>1 ${unit})`)}${leaf.filter((r) => r.structured).length} of ${leaf.length}`)
  console.log(`     ${label(`${unit}s that respond to a drag`)}${alive} of ${probed}   ${pct(alive, probed)} live`)
  console.log(`     ${label(`${unit}s that MIS-WRITE`)}${liveCorrupt}   <-- the one-${unit} probe cannot see these`)
  if (withLive.length) {
    const per = withLive.map((r) => ({ r, f: r.alive! / r.probed! })).sort((a, b) => a.f - b.f)
    console.log(`     least-live views:`)
    for (const { r } of per.slice(0, 8))
      console.log(
        `       ${pct(r.alive!, r.probed!)} (${r.alive}/${r.probed}) period=${r.period ?? '?'}  ${JSON.stringify(r.mini)}`,
      )
  }
  // the asks the cap is ABOUT, by where their true period falls relative to it
  const periodRows = by('no-view').filter((r) => r.gate === 'unstable-period')
  const within = periodRows.filter((r) => r.period! > 0 && r.period! <= cap)
  const past = periodRows.filter((r) => r.period! > cap)
  const aperiodic = periodRows.filter((r) => r.period === 0)
  console.log(`  -- refused for period: ${past.length} past cap ${cap}, ${aperiodic.length} aperiodic, ${within.length} WITHIN the cap (must be 0) --`)
}

/**
 * The per-ask rows this run emitted, for the driver to diff.
 *
 * Emitted per ask so a sweep across caps can be diffed PER UNIT. "Additive only" is a
 * claim about individual asks and netting two totals cannot check it — an ask lost and an
 * ask gained show up as zero ([[PV233]]).
 *
 * `reading` rides along so the driver can record a cap's answer without deriving one of
 * its own: a driver that re-implements these columns in JS is a second oracle over the
 * same question ([[P519]]), and this table has already been wrong once from having two
 * derivations (#1046).
 */
export function writeRunArtifact(s: CapSurface, dir: string, cap: number, rows: readonly Row[]): void {
  const at = path.join(dir, s.runsDir)
  fs.mkdirSync(at, { recursive: true })
  fs.writeFileSync(
    path.join(at, `cap-${cap}.json`),
    JSON.stringify({ cap, reading: readSweep(rows, cap), rows }, null, 1),
  )
}

export function readObservation(s: CapSurface, dir: string): SweepObservation {
  const at = path.join(dir, s.observation)
  if (!fs.existsSync(at))
    throw new Error(
      `${s.observation} is missing — the non-shipped cap columns have no observation.\n` +
        `  Take one:  ${s.script}\n` +
        `  (the driver reads each run's emitted \`reading\`, so it reaches this point before this throw does)`,
    )
  return JSON.parse(fs.readFileSync(at, 'utf8'))
}
