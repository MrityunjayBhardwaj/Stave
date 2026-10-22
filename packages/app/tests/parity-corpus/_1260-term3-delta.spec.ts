/**
 * _1260-term3-delta.spec.ts — MEASURE THE WIRING BEFORE PRODUCTION MOVES (#1260).
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1260-term3-delta.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * #1256 sized term 3 (154 units on the 150-tune corpus, 15 on the vendored one).
 * This file answers the two questions that sizing does not, and that the wiring
 * cannot be judged without:
 *
 *  1. WHAT EACH GATE READS. Three `.test.ts` gates ask `status === 'note'` and
 *     mean three different questions by it — "the coverage number's numerator",
 *     "this unit's content span is known", "no view opens on this unit". Term 3
 *     belongs to the first and to neither of the others, so the per-gate
 *     direction has to be predicted per QUESTION, not per status string
 *     ([[P572]]: ask what each rule is indexed by before agreeing they are two
 *     versions of one thing). The table below is that prediction, computed.
 *
 *  2. WHAT THE PREDICATE OVER-EXCLUDES. `hasStructure`'s grid clause is
 *     `steps > 1 && hits >= 1`, so a grid with SIX lanes in ONE column —
 *     `sound("hh, hh, hh, bd, hh, rd")` — is called unstructured while offering
 *     six togglable cells. That is more than one thing to edit by any reading.
 *     The count is reported here rather than assumed to be zero, because a
 *     stated limit with no number beside it is the shape #1046 is about.
 *
 * ⚠ IT SURVIVES ITS OWN SUBJECT, and that took one deliberate decision. The
 * population is selected with `hasKnownContent` — "a view opened and the string
 * round-tripped" — not with `status === 'note'`. Written the second way this
 * file would have measured 154 units before the wiring and 0 after, and the
 * zero would have read as a clean result rather than as the instrument losing
 * the ability to disagree. Holding the population fixed is what makes the
 * before/after a pair: every figure below must be IDENTICAL on both sides of
 * the change, and the last block asserts the oracle's own count against it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus, measureDocs, aggregate, hasKnownContent } from './editCoverage'
import { chunkSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { hasStructure, isCellOn } from '../../../editor/src/codeView/notation/model'
import { loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'

interface Fail {
  doc: string
  surface: 'step' | 'roll'
  mini: string
  steps: number
  lanes: number
  hits: number
  notes: number
}

function survey(docs: { name: string; code: string }[]) {
  const fails: Fail[] = []
  let note = 0
  /** the three questions the gates ask, counted separately over the same walk */
  let knownContent = 0 // miniSource-calibration's `known`
  let noViewOpens = 0 // writer-census-eval's `newlyAdmitted` membership test
  let routed = 0 // the harvest's ASKED set — chunkSurface(u) !== null

  for (const doc of docs) {
    for (const { unit, status } of unitsWithStatus(doc.code)) {
      if (status.status === 'note' || status.status === 'note-single' || status.status === 'note-broken') routed++
      if (hasKnownContent(status)) {
        note++
        if (unit.miniRange) knownContent++
      } else noViewOpens++
      if (!hasKnownContent(status)) continue
      const mini = unit.miniString
      if (mini === null) continue
      const surface = chunkSurface(unit)
      if (surface === 'roll') {
        const r = parsePianoRoll(mini)
        if (r.ok && !hasStructure(r.model, 'roll')) {
          fails.push({
            doc: doc.name, surface: 'roll', mini, steps: r.model.steps,
            lanes: 0, hits: 0, notes: r.model.notes.length,
          })
        }
        continue
      }
      const g = parseStepGrid(mini)
      if (!g.ok || hasStructure(g.model, 'step')) continue
      const hits = g.model.lanes.reduce(
        (n, l) => n + l.cells.filter((c) => isCellOn(c as never)).length,
        0,
      )
      fails.push({
        doc: doc.name, surface: 'step', mini, steps: g.model.steps,
        lanes: g.model.lanes.length, hits, notes: 0,
      })
    }
  }
  return { fails, note, knownContent, noViewOpens, routed }
}

function report(label: string, docs: { name: string; code: string }[]) {
  const s = survey(docs)
  const shipped = aggregate(measureDocs(docs))
  // The terms-1+2 world, rebuilt by adding the excluded pool back to both sides
  // — the same reconstruction `_1256-kind-census.spec.ts` makes, for the same
  // reason: every label here says "today" and means before term 3.
  const a = {
    ...shipped,
    totalUnits: shipped.totalUnits + shipped.uNoteSingle,
    uStructural: shipped.uStructural + shipped.uNoteSingle,
  }
  const grid = s.fails.filter((f) => f.surface === 'step')
  const roll = s.fails.filter((f) => f.surface === 'roll')
  /** more than one CELL to click, but all in one column — the contested slice */
  const wideOneColumn = grid.filter((f) => f.steps <= 1 && f.hits > 1)
  const trulyOne = grid.filter((f) => !(f.steps <= 1 && f.hits > 1))

  console.log(`\n════════ ${label} — ${docs.length} documents ════════`)
  console.log(`musical units (denominator today) : ${a.totalUnits}`)
  console.log(`structural today                  : ${a.uStructural}  = ${((100 * a.uStructural) / a.totalUnits).toFixed(1)}%`)
  console.log(`term 3 failures                   : ${s.fails.length}  (grid ${grid.length} · roll ${roll.length})`)
  console.log(`  of the grid half, MORE THAN ONE CELL in one column : ${wideOneColumn.length}`)
  console.log(`  of the grid half, genuinely one thing              : ${trulyOne.length}`)
  console.log(`\nSHAPE B — term 3 leaves numerator AND denominator:`)
  const num = a.uStructural - s.fails.length
  const den = a.totalUnits - s.fails.length
  console.log(`  ${num}/${den} = ${((100 * num) / den).toFixed(1)}%   (today ${a.uStructural}/${a.totalUnits} = ${((100 * a.uStructural) / a.totalUnits).toFixed(1)}%)`)

  console.log(`\n─── WHAT EACH CONSUMER'S QUESTION READS ───`)
  console.log(`  (the middle column is what it reads asking the RIGHT question;`)
  console.log(`   the right column is what it would read still spelling 'note')`)
  console.log(`  coverage numerator   measureDocs        ${String(a.uStructural).padStart(4)} -> ${String(num).padStart(4)}   MOVES — this IS the change`)
  console.log(`  known content span   hasKnownContent    ${String(s.knownContent).padStart(4)} -> ${String(s.knownContent).padStart(4)}   (would have been ${s.knownContent - s.fails.length})`)
  console.log(`  no view opens        !hasKnownContent   ${String(s.noViewOpens).padStart(4)} -> ${String(s.noViewOpens).padStart(4)}   (would have been ${s.noViewOpens + s.fails.length})`)
  console.log(`  routed to notation   routesToNotation   ${String(s.routed).padStart(4)} -> ${String(s.routed).padStart(4)}   (would have been ${s.routed - s.fails.length})`)
  console.log(`  ⚠ only the first may move: none of the others asks about structure.`)

  console.log(`\n─── the ${wideOneColumn.length} grids with several cells in ONE column (over-excluded?) ───`)
  for (const f of wideOneColumn.slice(0, 20)) {
    console.log(`  ${f.doc.padEnd(24)} lanes=${String(f.lanes).padStart(2)} hits=${String(f.hits).padStart(2)} steps=${f.steps}  ${JSON.stringify(f.mini.slice(0, 60))}`)
  }
  if (wideOneColumn.length > 20) console.log(`  … ${wideOneColumn.length - 20} more`)

  console.log(`\n  oracle's own exclusion count: ${shipped.uNoteSingle}  (this file finds ${s.fails.length})`)
  return { ...s, a, shipped, grid, roll, wideOneColumn, trulyOne, num, den }
}

describe('#1260 — the term-3 wiring, measured before production moves', () => {
  it('vendored corpus', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.strudel')).sort()
    const docs = files.map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') }))
    const r = report('VENDORED CORPUS', docs)
    expect(docs.length).toBeGreaterThan(0)
    // The floor `edit-parity` keeps is 44. Whether the wiring trips it is the
    // one thing this run has to answer before the change is written.
    console.log(`\n  edit-parity floor: editable ${r.a.uStructural} -> ${r.num}, floor 56 -> ${r.num >= 56 ? 'passes' : 'REDDENS'}`)
    // Non-vacuity: term 3 must bite here, or the vendored-corpus predictions
    // below are about an empty set.
    expect(r.fails.length).toBeGreaterThan(0)
    // …and the oracle must have excluded exactly these.
    expect(r.shipped.uNoteSingle).toBe(r.fails.length)
  })

  it('150 real Bakery tunes', async () => {
    const docs = await loadCorpus()
    const r = report('150 REAL TUNES', docs)
    expect(docs.length).toBe(150)
    // Reconciles with #1256's published sizing, on THIS tree rather than from
    // memory — 72 grid + 82 roll = 154.
    expect(r.grid.length + r.roll.length).toBe(154)
    expect(r.shipped.uNoteSingle).toBe(154)
  })
})
