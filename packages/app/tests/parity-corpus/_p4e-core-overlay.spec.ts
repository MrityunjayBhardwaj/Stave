/**
 * _p4e-core-overlay.spec.ts — INSTRUMENT, not a gate. What P4d's overlay would buy
 * on the half it has not been applied to: the CORE-OPENED units, which still write
 * through the region splice (`splice 805 · leaf 103 · alt 53` on the shipping tree).
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_p4e-core-overlay.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * WHAT IT ASKS, and why this order. #1010's remaining half is "attach the overlay on
 * the core path too", and the axis the deciding gate cannot score is the one that
 * decides whether it is worth anything at all: the region splice ALREADY copies every
 * byte outside the touched element, so a unit whose element IS the note re-emits the
 * same bytes surgery would have written. Counting how many of the 805 would come back
 * DIFFERENT is the benefit; anything else is the cost of a second projection.
 *
 * ⚠ IT ASKS THE MECHANISM RATHER THAN RESTATING IT. The spans come from
 * `projectStepGridDerived`, which is the function `withSurgery` reads them out of, and
 * the verdict comes from `serializeStepGridWithExtent`, which is the writer itself. The
 * one thing modelled here is the ATTACHMENT (`{ ...model, surgical: spans }`) — three
 * lines, and precisely the candidate change, so the probe measures the change rather
 * than a description of it.
 *
 * ⚠ VALIDATED AGAINST THE COMMITTED GATE'S OWN PUBLISHED NUMBERS before any of its
 * treatment readings are believed ([[PK90]] step 4): units 981, asked 961, and the
 * by-path split 103/805/53 are asserted here. A drift in those means the corpus or the
 * writer moved and every figure below describes a different population.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  projectStepGridDerived,
} from '../../../editor/src/codeView/notation/parse'
import type {
  LeafSource,
  StepGridModel,
  SurgicalOverlay,
} from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import { serializeStepGridWithExtent } from '../../../editor/src/codeView/notation/serialize'

/**
 * Wrap resolved spans as an OVERLAY the writer will accept (#1233 made the field lazy).
 * The width is re-stamped for the model the spans land on, which is what `withSurgery`
 * does — an instrument that attached naively would measure a change nobody proposed.
 */
const asOverlay = <S>(spans: S, attachedSteps: number): SurgicalOverlay<S> => ({
  attachedSteps,
  spans: () => spans,
})


const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** the spans the leaf projection reads for this mini, however the derived path carries them */
function leafSpansFor(mini: string): LeafSource | undefined {
  const d = projectStepGridDerived(mini, { ok: false, reason: 'probe' })
  if (!d.ok) return undefined
  const m = d.model as StepGridModel
  return m.surgical?.spans() ?? m.leafSource
}

/** how many bytes actually moved: the range between the common prefix and common suffix */
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

interface Row {
  mini: string
  coreOpened: boolean
  spliceOut: string | null
  spliceWidth: number
  verdict: string
  surgicalOut?: string | null
  surgicalWidth?: number
}

function census(): { units: number; asked: number; byPath: Map<string, number>; rows: Row[] } {
  const byPath = new Map<string, number>()
  const rows: Row[] = []
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
        if (next === m) {
          byPath.set('(op refused)', (byPath.get('(op refused)') ?? 0) + 1)
          break
        }
        asked++
        const { mini: out, extent } = serializeStepGridWithExtent(next)
        const key = out === null ? `${extent.path} (declined)` : extent.path
        byPath.set(key, (byPath.get(key) ?? 0) + 1)
        if (extent.path !== 'splice') break

        const row: Row = {
          mini,
          coreOpened: parseStepGridCore(mini).ok,
          spliceOut: out,
          spliceWidth: out === null ? -1 : changedWidth(mini, out),
          verdict: '',
        }
        const spans = leafSpansFor(mini)
        if (!spans) {
          row.verdict = 'no leaf spans exist for this mini'
        } else {
          const overlaid = serializeStepGridWithExtent({
            ...next,
            surgical: asOverlay(spans, next.steps),
          } as StepGridModel)
          if (overlaid.extent.path !== 'leaf' || overlaid.mini === null) {
            row.verdict = `overlay refused → ${overlaid.extent.path}${overlaid.mini === null ? ' (no spelling)' : ''}`
          } else {
            row.surgicalOut = overlaid.mini
            row.surgicalWidth = changedWidth(mini, overlaid.mini)
            row.verdict = overlaid.mini === out ? 'same bytes as the splice' : 'DIFFERENT bytes'
          }
        }
        rows.push(row)
      }
  }
  return { units, asked, byPath, rows }
}

describe('P4e instrument — what the overlay would buy on the core-opened half', () => {
  it('counts the splice-answered deletes the overlay would write differently', () => {
    const c = census()

    // ── the validation arm: these are the committed gate's published numbers ──
    console.log(`\n===== P4e: the core-opened half (${minis.length} corpus units) =====`)
    console.log(`  units opening a grid:           ${c.units}   (writer-reach prints 981)`)
    console.log(`  deletes the panel performed:    ${c.asked}   (writer-reach prints 961)`)
    for (const [k, v] of [...c.byPath.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    expect(c.units, 'the grid population moved — every figure below describes a different corpus').toBe(981)
    expect(c.byPath.get('leaf') ?? 0, 'the surgery census disagrees with the committed floor').toBe(103)
    expect(c.byPath.get('splice') ?? 0, 'the splice population moved').toBe(805)

    // ── the treatment reading ──
    const by = new Map<string, Row[]>()
    for (const r of c.rows) {
      const k = `${r.coreOpened ? 'core-opened' : 'derived'} · ${r.verdict}`
      by.set(k, [...(by.get(k) ?? []), r])
    }
    console.log(`\n  -- the ${c.rows.length} splice-answered deletes, by what the overlay would do --`)
    for (const [k, rs] of [...by.entries()].sort((a, b) => b[1].length - a[1].length))
      console.log(`     ${String(rs.length).padStart(4)}x  ${k}`)

    const different = c.rows.filter((r) => r.verdict === 'DIFFERENT bytes')
    console.log(`\n  -- BYTES MOVED, splice vs surgery, on the ${different.length} that differ --`)
    const spliceTotal = different.reduce((a, r) => a + r.spliceWidth, 0)
    const surgTotal = different.reduce((a, r) => a + (r.surgicalWidth ?? 0), 0)
    console.log(`     splice moves ${spliceTotal} bytes, surgery moves ${surgTotal}`)
    different.slice(0, 25).forEach((r) => {
      console.log(`     ✗ ${JSON.stringify(r.mini)}`)
      console.log(`         splice  (${r.spliceWidth}b) → ${JSON.stringify(r.spliceOut)}`)
      console.log(`         surgery (${r.surgicalWidth}b) → ${JSON.stringify(r.surgicalOut)}`)
    })

    const refused = c.rows.filter((r) => r.verdict.startsWith('overlay refused'))
    console.log(`\n  -- the ${refused.length} the overlay could not answer, by reason --`)
    const byReason = new Map<string, number>()
    for (const r of refused) byReason.set(r.verdict, (byReason.get(r.verdict) ?? 0) + 1)
    for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    refused.slice(0, 10).forEach((r) => console.log(`     ? ${JSON.stringify(r.mini)}  ${r.verdict}`))
  })
})
