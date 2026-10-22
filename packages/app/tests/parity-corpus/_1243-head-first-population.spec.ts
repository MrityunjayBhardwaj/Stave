/**
 * _1243-head-first-population.spec.ts — INSTRUMENT for #1243.
 *
 * THE QUESTION THE ISSUE ASKS, VERBATIM: "how many units repo-wide have a
 * content head, a surface that declines them, and a sibling surface that would
 * accept." If it is a handful, head-first stands and #1243 closes.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1243-head-first-population.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ── WHY THIS IS RE-MEASURED RATHER THAN READ OFF THE ISSUE ────────────────
 * #1243 was filed while each grid still re-derived its own eligibility from the
 * HEAD (#1250), so "the grid would draw it" was not yet true for anything the
 * panel routed by content. That is fixed, which changes what the narrow fix
 * would BUY, though not the population itself — the corpus arithmetic below
 * runs through `parseStepGrid`/`parsePianoRoll`, which #1250 did not touch.
 * Stated so the two are not confused.
 *
 * ── NO SECOND COPY OF ANY RULE ────────────────────────────────────────────
 * Units and their statuses come from `unitsWithStatus` (the harness oracle the
 * corpus gates use); acceptance comes from the shipped parsers. The head→surface
 * mapping is the one thing spelled here, because `routeSurface` answers the
 * SILENT-head question and this probe is about the loud-head one — so it is
 * cross-checked against `unitsWithStatus`'s own verdict per unit, and the run
 * fails loudly if the two disagree.
 *
 * ⚠ NOT EVERY REFUSAL IS A ROUTING REFUSAL. A `note(...)` unit the roll declines
 * for `unstable-period` or a cap is a CAPACITY refusal — the grid accepting it
 * does not mean the grid is the right editor, it means the grid asks less. The
 * dump is therefore bucketed by the OWN surface's gate, because the narrow fix
 * ("fall through to the content check when the head's own surface declines") is
 * defensible for `wrong-surface` and indefensible for the rest.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus } from './editCoverage'
import { chunkSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'

const ROLL_HEADS = new Set(['note', 'n'])
const STEP_HEADS = new Set(['s', 'sound'])

type Row = {
  doc: string
  head: string
  via: string
  mini: string
  ownGate: string
  siblingOk: boolean
  siblingGate: string
  status: string
  statement: string
  siblingSteps?: number
  siblingLanes?: string[]
}

/** the lane names the accepting surface would draw — the KIND evidence, not the count */
function drawn(r: { ok: boolean } & Record<string, unknown>): { steps?: number; lanes?: string[] } {
  const m = (r as { model?: { steps?: number; lanes?: { name?: string; sound?: string; label?: string }[] } }).model
  if (!m) return {}
  return { steps: m.steps, lanes: m.lanes?.map((l) => l.name ?? l.sound ?? l.label ?? '(unnamed)') }
}

function measure(docs: { name: string; code: string }[]) {
  let contentHeadUnits = 0
  let served = 0
  let duplicates = 0
  let rescued = 0
  const refused: Row[] = []
  const disagreements: string[] = []

  for (const doc of docs) {
    // ⚠ THE HARNESS COLLECTS SOME UNITS TWICE. `unitsWithStatus` unions an
    // argument walk with `detectAllChunks`, and a document can yield two
    // entries for one span (visible in the raw dump as identical rows).
    // Counting them twice inflates every figure below in the direction that
    // makes the population look larger, so spans are deduped per document and
    // the duplicate count is reported rather than quietly dropped.
    const seen = new Set<string>()
    for (const { unit, status } of unitsWithStatus(doc.code)) {
      const head = unit.headFn
      const mini = unit.miniString
      if (mini === null || head === null) continue
      const toRoll = ROLL_HEADS.has(head)
      const toStep = STEP_HEADS.has(head)
      if (!toRoll && !toStep) continue
      const key = `${unit.miniRange?.join(':') ?? unit.exprRange.join(':')}|${head}`
      if (seen.has(key)) {
        duplicates++
        continue
      }
      seen.add(key)
      contentHeadUnits++

      const own = toRoll ? parsePianoRoll(mini) : parseStepGrid(mini)
      const sibling = toRoll ? parseStepGrid(mini) : parsePianoRoll(mini)

      // SECOND READING THAT MUST AGREE: the harness's own classification of the
      // same unit. If the two disagree, this probe is measuring something other
      // than what the gates score.
      //
      // ⚠ COMPARED AGAINST THE *ROUTED* SURFACE, NOT THE HEAD'S NOMINAL ONE, and
      // that distinction is the whole point of this file. The first version
      // asked whether the harness agreed with `own` — the parse of the surface
      // the HEAD names — which was the same question only while the head decided
      // everything. It stopped being so the moment a `note()` chord chart could
      // route to the grid, and this assertion then failed on exactly the unit
      // the measurement had argued about. The probe's own subject
      // (`own`/`sibling`, keyed on the head) is deliberately unchanged, because
      // "what would the head's surface have done" is the question #1243 asks.
      const routed = chunkSurface(unit)
      const routedParse = routed === null ? null : routed === 'roll' ? parsePianoRoll(mini) : parseStepGrid(mini)
      const harnessSaysServed = status.status === 'note'
      if (harnessSaysServed !== (routedParse?.ok ?? false)) {
        disagreements.push(
          `${doc.name} head=${head} status=${status.status} routed=${routed} routedOk=${routedParse?.ok} :: ${mini}`,
        )
      }
      // What the shipped router RESCUES: the head's own surface declined and a
      // view opens anyway. Zero before #1243, and the arithmetic below is
      // unchanged by it — `own`/`sibling` read the parsers directly.
      if (!own.ok && routedParse?.ok) rescued++

      if (own.ok) {
        served++
        continue
      }
      refused.push({
        doc: doc.name,
        head,
        via: unit.miniVia ?? '(none)',
        mini,
        ownGate: (own as { gate?: string; reason: string }).gate ?? (own as { reason: string }).reason,
        siblingOk: sibling.ok,
        siblingGate: sibling.ok
          ? '(accepts)'
          : ((sibling as { gate?: string; reason: string }).gate ?? (sibling as { reason: string }).reason),
        status: status.status,
        statement: doc.code.slice(unit.statementRange[0], Math.min(unit.statementRange[1], unit.statementRange[0] + 240)),
        ...(sibling.ok ? { siblingSteps: drawn(sibling).steps, siblingLanes: drawn(sibling).lanes } : {}),
      })
    }
  }
  return { contentHeadUnits, served, refused, disagreements, duplicates, rescued }
}

function report(label: string, docs: { name: string; code: string }[]) {
  const { contentHeadUnits, served, refused, disagreements, duplicates, rescued } = measure(docs)
  const population = refused.filter((r) => r.siblingOk)
  const bothRefuse = refused.filter((r) => !r.siblingOk)

  const byGate = new Map<string, Row[]>()
  for (const r of population) {
    const key = `${r.head === 'note' || r.head === 'n' ? 'note→grid' : 's→roll'} | ${r.ownGate}`
    byGate.set(key, [...(byGate.get(key) ?? []), r])
  }

  console.log(`\n════ ${label} — ${docs.length} documents ════`)
  console.log(`content-head units (s/sound/note/n with a mini) : ${contentHeadUnits}`)
  console.log(`  served by their own surface                   : ${served}`)
  console.log(`  refused by their own surface                  : ${refused.length}`)
  console.log(`    ├─ SIBLING WOULD ACCEPT  ← #1243's population: ${population.length}`)
  console.log(`    └─ refused by both (correctly no editor)     : ${bothRefuse.length}`)
  console.log(`    └─ of those, RESCUED by the shipped router  : ${rescued}`)
  console.log(`duplicate spans dropped (harness double-collects)   : ${duplicates}`)
  console.log(`harness/parser disagreements (must be 0)         : ${disagreements.length}`)
  for (const d of disagreements) console.log(`    ⚠ ${d}`)

  console.log(`\n  — #1243's population by direction and own gate —`)
  for (const [k, rows] of [...byGate.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(rows.length).padStart(4)}  ${k}`)
  }

  console.log(`\n  — every row, for hand-reading —`)
  for (const r of population) {
    const mini = r.mini.length > 78 ? `${r.mini.slice(0, 75)}…` : r.mini
    console.log(`  ${r.doc.padEnd(38)} ${r.head.padEnd(5)} via=${r.via.padEnd(9)} ${r.ownGate.padEnd(22)} ${JSON.stringify(mini)}`)
  }

  // ── THE KIND QUESTION, WHICH IS THE ONE THAT DECIDES ────────────────────
  // A count of "the sibling would accept" cannot answer #1243, because the grid
  // accepts nearly every word pattern (#1244) — so "it would draw it" is nearly
  // free and says nothing about whether it SHOULD. What discriminates is the
  // model it would draw. A melody yields one lane per note and a clean diagonal,
  // which is a view of the right SHAPE and the wrong KIND, and no fidelity gate
  // can see the difference. So every `wrong-surface` row prints its statement
  // and the lane names the grid would give it, for hand-reading.
  console.log(`\n  — what the sibling would DRAW, for the routing refusals only —`)
  for (const r of population.filter((p) => p.ownGate === 'wrong-surface')) {
    console.log(`\n  ── ${r.doc}  head=${r.head}  via=${r.via}`)
    console.log(`     mini      : ${JSON.stringify(r.mini)}`)
    console.log(`     statement : ${JSON.stringify(r.statement)}`)
    console.log(`     would draw: steps=${r.siblingSteps} lanes=${r.siblingLanes?.length} names=${JSON.stringify(r.siblingLanes)}`)
  }

  console.log(`\n  — refused by BOTH surfaces (control: this class must be non-empty or the sibling arm is vacuous) —`)
  for (const r of bothRefuse.slice(0, 40)) {
    const mini = r.mini.length > 60 ? `${r.mini.slice(0, 57)}…` : r.mini
    console.log(`  ${r.doc.padEnd(38)} ${r.head.padEnd(5)} own=${r.ownGate.padEnd(22)} sib=${r.siblingGate.padEnd(22)} ${JSON.stringify(mini)}`)
  }
  if (bothRefuse.length > 40) console.log(`  … ${bothRefuse.length - 40} more`)

  return { contentHeadUnits, served, refused, population, bothRefuse, disagreements }
}

describe('#1243 — the head-first population, measured', () => {
  it('vendored corpus', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.strudel')).sort()
    const docs = files.map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') }))
    const r = report('VENDORED CORPUS', docs)
    // Non-vacuity: the probe must see the class at all. `bakery-152-block-comment`
    // is the unit #1240 named as this exact case, so its absence would mean the
    // filter is wrong, not that the class is empty.
    console.log(
      `\n  positive control — bakery-152 rows in the population: ` +
        `${r.population.filter((p) => p.doc.startsWith('bakery-152')).length}`,
    )
    expect(r.disagreements.length).toBe(0)
    expect(docs.length).toBeGreaterThan(0)
  })

  it('150 real Bakery tunes', async () => {
    const docs = await loadCorpus()
    const r = report('150 REAL TUNES', docs)
    expect(r.disagreements.length).toBe(0)
    expect(docs.length).toBe(150)
  })
})
