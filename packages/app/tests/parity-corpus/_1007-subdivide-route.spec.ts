/**
 * _1007-subdivide-route.spec.ts — THROWAWAY INSTRUMENT. Does "subdividing authors"
 * depend on the ROUTE, rather than on the gesture?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1007-subdivide-route.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE QUESTION, and why the previous answer is not yet safe to quote.
 * `_1007-subdivide-locality.spec.ts` measured "subdivide, then place into a slot the
 * source never indexed" and found the write moves p50 0.987 of a document >= 40 chars.
 * That probe reaches the refined model through `scaleStepGrid(model, 'double')` — and
 * `scaleStepGrid` HAS NO PRODUCTION CALLER outside `resolution.ts` itself. The panel
 * takes a different road: `SequencerGrid.tsx:99` wires `collapseToDocument`, and
 * `ResolutionControl` puts every target at or above the document count in a FREE ZONE
 * where nothing is written at all (#1057).
 *
 * So there are two roads to the same musical result, and only one is shipped:
 *
 *   ROUTE A (shipped)   parseStepGrid(mini, k)   -> toggleCell -> collapseStepGridToDocument
 *                       -> serializeStepGridWithExtent
 *                       The refined model is a VIEW of the document and carries the
 *                       source description with it.
 *   ROUTE B (probe)     scaleStepGrid(m,'double') -> toggleCell
 *                       -> serializeStepGridWithExtent
 *                       A model-space rescale. No collapse guard is asked, and the
 *                       source description does not survive the rescale.
 *
 * A cost measured on B is a fact about B. Whether it is also a fact about the product
 * is exactly what nothing on hand can say, because both existing instruments are
 * scoped to one road: the locality probe only ever drove B, and
 * `1058-refined-placement.test.ts` only ever drives A — and it EXCLUDES the population
 * where the whole line is re-derived (`:409-413`, `regions > 1` only), because that is
 * "the element writer's known bound rather than this phase's property". Neither is
 * wrong; neither answers this. [[P608]]'s shape one level down: a cost quoted about a
 * GESTURE, measured through a MECHANISM.
 *
 * WHAT IS MEASURED. Only the document, and with the SAME `changedWidth` the locality
 * probe and `_1233-byte-change.spec.ts` use — copied rather than re-derived so the
 * three runs are directly comparable. Never "did it author", which would re-decide
 * what the writer decided ([[P519]]).
 *
 * THE DISCRIMINATOR, both columns written BEFORE the run ([[P527]], [[PV347]]):
 *
 *                          ROUTE IS THE CAUSE          GESTURE IS THE CAUSE
 *   A vs B, same units     A far below B               A comparable to B
 *   A vs leaf anchor       comparable                  far above
 *
 * PAIRED, NOT TWO SWEEPS. Only units where BOTH routes posed the gesture are compared,
 * so the difference cannot be a population difference ([[P546]] — an anchor taken on
 * other units is not an anchor). The unpaired remainder is reported, never dropped.
 *
 * CALIBRATION BEFORE ANYTHING IS READ OFF THIS ([[PK103]] step 7). Route B is re-derived
 * here and must reproduce the committed probe EXACTLY — 934 posed / 873 splice /
 * 61 rebuild — and Route A's identity base must reproduce `1058-refined-placement`'s
 * asserted 1013. Both are asserted below. If either moves, this instrument is wrong
 * and its treatment column means nothing.
 *
 * ⚠ THE FIRST RUN FAILED THAT SECOND ANCHOR — 1021 against 1013 — and the cause was a
 * POPULATION difference I had assumed away, not a behavioural one. The two reference
 * probes do not share a corpus list: `1058` dedupes (`[...new Set(...)]`, :73) while
 * `_1007-subdivide-locality` does not, and Route B's 934 is only reproducible on the
 * UNDEDUPED list. Recorded rather than swapped, because the failure is the evidence
 * that the anchor is live: the sweep therefore runs undeduped (so B calibrates) and
 * counts DISTINCT identity-base minis alongside (so A calibrates). Relaxing either
 * assertion would have been the cheap move and would have left the instrument unpinned
 * at exactly the end being read.
 *
 * GUARD, because this is where P4e lost a gesture ([[P606]]): `scaleStepGrid` takes
 * `'double' | 'halve'` and vitest does not typecheck. `posedB` counts only asks where
 * the model VERIFIABLY doubled, and every denominator is printed and asserted.
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
  scaleStepGrid,
  canDoubleStepGrid,
  collapseStepGridToDocument,
} from '../../../editor/src/codeView/notation/resolution'
import {
  serializeStepGrid,
  serializeStepGridWithExtent,
} from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * how many bytes actually moved: the range between the common prefix and common suffix.
 * IDENTICAL to `_1007-subdivide-locality.spec.ts:58` and `_1233-byte-change.spec.ts`,
 * on purpose — a second definition would make the runs incomparable.
 */
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

interface Sample {
  ratios: number[]
  abs: number[]
  lens: number[]
  longRatios: number[]
  paths: Map<string, number>
}
const blank = (): Sample => ({ ratios: [], abs: [], lens: [], longRatios: [], paths: new Map() })
const bump = (s: Sample, p: string) => s.paths.set(p, (s.paths.get(p) ?? 0) + 1)
function record(s: Sample, before: string, after: string) {
  const w = changedWidth(before, after)
  const len = Math.max(before.length, after.length)
  s.abs.push(w)
  s.lens.push(len)
  s.ratios.push(w / len)
  if (before.length >= 40) s.longRatios.push(w / len)
}
const med = (r: number[]) => (r.length === 0 ? NaN : [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)])
function stats(s: Sample) {
  return {
    n: s.ratios.length,
    p50: med(s.ratios),
    absP50: med(s.abs),
    lenP50: med(s.lens),
    longN: s.longRatios.length,
    longP50: med(s.longRatios),
    ge90: s.ratios.filter((v) => v >= 0.9).length,
  }
}

/** the first empty ODD column, scanned col-then-lane — the SAME order on both routes */
function firstOddPlacement(m: StepGridModel): StepGridModel | null {
  for (let col = 1; col < m.steps; col += 2)
    for (let lane = 0; lane < m.lanes.length; lane++) {
      if (isCellOn(m.lanes[lane].cells[col])) continue
      const next = toggleCell(m, lane, col, true)
      if (next !== m) return next
    }
  return null
}

describe('#1007 — is the subdivide cost a property of the gesture or of the ROUTE?', () => {
  it('poses the same placement through the shipped route and the model-rescale route', () => {
    // denominators first, per [[P606]] — a treatment column means nothing until these are non-zero
    let units = 0
    let identityBase = 0 // Route A's precondition, and 1058's calibration figure
    // 1058 sweeps DISTINCT minis (:73) while route B's 934 needs the undeduped list.
    // Both anchors are kept by counting both, never by relaxing one.
    const identityBaseDistinct = new Set<string>()
    let admitsFinerView = 0
    let posedA = 0
    let wroteA = 0
    let posedB = 0
    let wroteB = 0
    let collapsedToDocument = 0 // Route A asks the guard; how often does it ANSWER?
    const refusals = new Map<string, number>()

    const routeA = blank()
    const routeB = blank()
    const leafAnchor = blank()
    // paired: only units where BOTH routes wrote
    const pairA = blank()
    const pairB = blank()
    // Route A split by the reconciliation hypothesis: does a single-region source
    // explain the whole-document re-derivation?
    const aRegions1 = blank()
    const aRegionsN = blank()
    const exPair: [string, string, string][] = []

    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      units++

      // ---- ANCHOR: the most local write there is, same as the locality probe ----
      let done = false
      for (let col = 0; col < m.steps && !done; col++)
        for (let lane = 0; lane < m.lanes.length && !done; lane++) {
          if (!isCellOn(m.lanes[lane].cells[col])) continue
          done = true
          const next = toggleCell(m, lane, col, false)
          if (next === m) break
          const { mini: out, extent } = serializeStepGridWithExtent(next)
          if (out === null) break
          if (extent.path === 'leaf') {
            record(leafAnchor, mini, out)
            bump(leafAnchor, extent.path)
          }
        }

      // ---- ROUTE B: model-space rescale, no collapse guard (the committed probe) ----
      let outB: string | null = null
      if (canDoubleStepGrid(m)) {
        const wide = scaleStepGrid(m, 'double')
        // THE GUARD. A wrong literal falls to the halve branch and reads as a dead zero.
        if (wide !== m && wide.steps === m.steps * 2) {
          const placed = firstOddPlacement(wide)
          if (placed !== null) {
            posedB++
            const { mini: w, extent } = serializeStepGridWithExtent(placed)
            bump(routeB, w === null ? `${extent.path} (declined)` : extent.path)
            if (w !== null) {
              wroteB++
              outB = w
              record(routeB, mini, w)
            }
          }
        }
      }

      // ---- ROUTE A: the shipped road — a refined VIEW, then the ÷k guard ----
      // The identity base is Route A's own precondition (1058:112): without it
      // "the document did not change" has no meaning, because the writer never
      // reproduced it in the first place.
      let outA: string | null = null
      if (serializeStepGrid(m) === mini) {
        identityBase++
        identityBaseDistinct.add(mini)
        const fine = parseStepGrid(mini, 2)
        if (!fine.ok) {
          const gate = fine.gate ?? 'no-gate'
          refusals.set(gate, (refusals.get(gate) ?? 0) + 1)
        } else {
          admitsFinerView++
          const placed = firstOddPlacement(fine.model as StepGridModel)
          if (placed !== null) {
            posedA++
            // asked of the REAL ÷k guard, the way the panel asks it (#1057)
            const atDocument = collapseStepGridToDocument(placed)
            if (atDocument !== null) collapsedToDocument++
            const { mini: w, extent } = serializeStepGridWithExtent(atDocument ?? placed)
            bump(routeA, w === null ? `${extent.path} (declined)` : extent.path)
            if (w !== null) {
              wroteA++
              outA = w
              record(routeA, mini, w)
              if (extent.path === 'splice')
                record(extent.regions === 1 ? aRegions1 : aRegionsN, mini, w)
            }
          }
        }
      }

      // ---- THE PAIR: same unit, same gesture, two roads ----
      if (outA !== null && outB !== null) {
        record(pairA, mini, outA)
        record(pairB, mini, outB)
        if (mini.length >= 40 && exPair.length < 3) exPair.push([mini, outA, outB])
      }
    }

    const show = (name: string, s: Sample) => {
      const t = stats(s)
      console.log(
        `  ${name.padEnd(26)} n=${String(t.n).padStart(4)}  ratio p50=${t.p50.toFixed(3)}` +
          `  bytes p50=${String(t.absP50).padStart(4)} of doc p50=${String(t.lenP50).padStart(4)}` +
          `  whole-doc=${String(t.ge90).padStart(3)}` +
          `  | LONG docs(>=40) n=${String(t.longN).padStart(3)} p50=${t.longP50.toFixed(3)}`,
      )
      for (const [k, v] of [...s.paths.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`       ${String(v).padStart(4)}x  ${k}`)
    }

    console.log(`\n===== #1007: is the subdivide cost a property of the ROUTE? =====`)
    console.log(`  corpus minis                 ${minis.length}`)
    console.log(`  units opening a step grid    ${units}`)
    console.log(`  ...with an IDENTITY base     ${identityBase}   (DISTINCT ${identityBaseDistinct.size}   <- 1058 asserts 1013)`)
    console.log(`  ...admitting a x2 VIEW       ${admitsFinerView}`)
    console.log(`  ROUTE A posed                ${posedA}   wrote ${wroteA}`)
    console.log(`     of which the ÷k guard could say at document resolution: ${collapsedToDocument}`)
    console.log(`  ROUTE B posed                ${posedB}   wrote ${wroteB}   <- committed probe: 934 / 934`)
    if (refusals.size) {
      console.log(`  finer-view refusals by gate:`)
      for (const [k, v] of [...refusals.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`       ${String(v).padStart(4)}x  ${k}`)
    }
    console.log(`  -- bytes moved --`)
    show('ROUTE A (shipped)', routeA)
    show('ROUTE B (model rescale)', routeB)
    show('ANCHOR delete leaf', leafAnchor)
    console.log(`  -- PAIRED: only units where BOTH routes wrote --`)
    show('PAIRED route A', pairA)
    show('PAIRED route B', pairB)
    console.log(`  -- ROUTE A split by source regions (the reconciliation hypothesis) --`)
    show('A splice, regions == 1', aRegions1)
    show('A splice, regions > 1', aRegionsN)

    console.log(`\n  -- WHAT IT LOOKS LIKE (paired, long docs) --`)
    for (const [b, a, bb] of exPair) {
      console.log(`     before   ${JSON.stringify(b)}`)
      console.log(`     route A  ${JSON.stringify(a)}`)
      console.log(`     route B  ${JSON.stringify(bb)}`)
    }

    // ---- CALIBRATION. Nothing above may be read if these move. ----
    expect(posedB, 'route B must reproduce the committed probe').toBe(934)
    expect(wroteB, 'route B must reproduce the committed probe').toBe(934)
    expect(routeB.paths.get('splice') ?? 0, 'route B splice').toBe(873)
    expect(routeB.paths.get('rebuild') ?? 0, 'route B rebuild').toBe(61)
    expect(identityBaseDistinct.size, 'route A identity base must reproduce 1058').toBe(1013)
    // and the gestures must actually have happened
    expect(posedA, 'route A never posed the gesture').toBeGreaterThan(100)
    expect(pairA.ratios.length, 'nothing paired — the comparison is empty').toBeGreaterThan(100)
  })
})
