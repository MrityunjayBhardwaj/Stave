/**
 * _1007-subdivide-locality.spec.ts — THROWAWAY INSTRUMENT. Does subdividing AUTHOR
 * notation, or does it splice locally?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1007-subdivide-locality.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE QUESTION. #1007's "honest irreducible" #1 says: "Replacing an existing `~` is
 * surgery; subdividing is not." P4e then measured a subdivide+place as reaching NO
 * surviving `reemit*` site (934 asks, 0 hits) — answered by the part rebuild inside
 * the splice path and by `rebuildGrid`. Those two statements are in tension and
 * NEITHER settles it, because "reaches no re-emit site" is not the same as "does not
 * author": the splice path's own comment says it re-reads the part at a finer width
 * and spells ONE element as a group, which is authoring at a smaller scale.
 *
 * ⚠⚠ THIS PROBE DRIVES ONE OF TWO ROUTES, AND IT IS NOT THE SHIPPED ONE (#1300 —
 * measured after this file was written, by `_1007-subdivide-route.spec.ts`). It reaches
 * the refined model through `scaleStepGrid(model, 'double')`, a model-space rescale
 * that no production code outside `resolution.ts` calls. The panel takes the other
 * road: a refined VIEW, `parseStepGrid(mini, k)`, whose model still carries the source
 * regions — and on that road the same 934 asks move p50 0.298 of a document >= 40 chars
 * rather than 0.987, leaving every neighbouring part byte-identical. Every figure below
 * is SOUND and is scoped to the model-rescale road. Read the paired run for the
 * product's cost; read this one for what a writer does once the source description is
 * gone.
 *
 * WHAT IS MEASURED, and why it is not a second oracle. Not "did it author" — that
 * would be a rule of my own, re-deciding what the writer decided ([[P519]]). Only the
 * DOCUMENT: how many bytes moved, as the span between the common prefix and the common
 * suffix. Same `changedWidth` as `_1233-byte-change.spec.ts`, deliberately, so the two
 * runs are comparable.
 *
 * THE DISCRIMINATOR, both columns written BEFORE the run ([[P527]], [[PV347]]):
 *
 *                              AUTHORING                 LOCAL
 *   changed/len                ~1.0, whole part          small, near the leaf anchor
 *   vs the leaf anchor         far above                 comparable
 *   vs the rebuild anchor      comparable                far below
 *
 * TWO ANCHORS, MEASURED IN THE SAME RUN ON THE SAME UNITS so neither is quoted and
 * neither can silently be the same arm twice ([[P546]]):
 *   - `leaf`    — a delete answered by byte surgery. The most local write there is.
 *   - `rebuild` — a write that re-derived the line from the model. Pure authoring.
 *
 * ⚠ THE GESTURE IS GUARDED, because this is exactly where P4e lost one ([[P606]]):
 * `scaleStepGrid` takes `'double' | 'halve'` and vitest does not typecheck, so a wrong
 * literal runs, falls to the halve branch and reports a silent zero. `posed` counts
 * only asks where the model VERIFIABLY doubled, and it is asserted non-zero.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import { scaleStepGrid, canDoubleStepGrid } from '../../../editor/src/codeView/notation/resolution'
import { serializeStepGridWithExtent } from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

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

/**
 * ⚠ REVISED AFTER THE FIRST RUN REFUTED THE FIRST DESIGN, both halves recorded rather
 * than quietly replaced:
 *
 * 1. THE REBUILD ANCHOR CAME BACK EMPTY (n=0). A delete never takes that path, so the
 *    AUTHORING end of the scale did not exist and "0.833 is near authoring" would have
 *    been an unanchored claim. Replaced by a strictly better discriminator: split the
 *    SAME gesture on the SAME units by the writer that answered it. `splice` vs
 *    `rebuild` then differ only by the writer, which is the whole question.
 * 2. THE RATIO IS CONFOUNDED BY DOCUMENT LENGTH. The leaf anchor — pure byte surgery —
 *    reported "whole document moved" on 251 of 685 units, which cannot be right for a
 *    write that copies every byte it did not edit. The corpus median mini is ~16 chars,
 *    where ONE element IS most of the document. So absolute bytes and the document
 *    length are reported beside the ratio, and a LONG-DOC row (>= 40 chars) is printed
 *    where the ratio can actually discriminate.
 */
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
    // "the whole document moved" — the authoring signature
    ge90: s.ratios.filter((v) => v >= 0.9).length,
  }
}

describe('#1007 irreducible #1 — is a subdivide an authoring write or a local one?', () => {
  it('measures subdivide+place against a leaf anchor and a rebuild anchor', () => {
    // denominators, per [[P606]] — a treatment column means nothing until these are non-zero
    let units = 0
    let doubleable = 0
    let posed = 0 // the model VERIFIABLY doubled
    let wrote = 0 // the writer returned a document

    // the same gesture, split by the writer that answered it — this is the discriminator
    const subjSplice = blank()
    const subjRebuild = blank()
    const leafAnchor = blank()
    const spliceAnchor = blank()
    const exSubj: [string, string][] = []
    const exLeaf: [string, string][] = []

    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      units++

      // ---- ANCHORS: one delete per unit, classified by the writer's own report ----
      let done = false
      for (let col = 0; col < m.steps && !done; col++)
        for (let lane = 0; lane < m.lanes.length && !done; lane++) {
          if (!isCellOn(m.lanes[lane].cells[col])) continue
          done = true
          const next = toggleCell(m, lane, col, false)
          if (next === m) break // the panel refuses the gesture
          const { mini: out, extent } = serializeStepGridWithExtent(next)
          if (out === null) break
          if (extent.path === 'leaf') {
            record(leafAnchor, mini, out)
            bump(leafAnchor, extent.path)
            if (mini.length >= 40 && exLeaf.length < 3) exLeaf.push([mini, out])
          } else if (extent.path === 'splice') {
            // a DELETE answered by the splice path — the same writer as the subject's
            // 873, but on a gesture that has a span. Separates "this writer is local"
            // from "this gesture is local".
            record(spliceAnchor, mini, out)
            bump(spliceAnchor, extent.path)
          }
        }

      // ---- SUBJECT: double the resolution, then place into a slot that did not exist ----
      if (!canDoubleStepGrid(m)) continue
      doubleable++
      const wide = scaleStepGrid(m, 'double')
      // THE GUARD. A wrong literal falls to the halve branch and reads as a dead zero.
      if (wide === m || wide.steps !== m.steps * 2) continue
      // doubling maps old column i -> 2i, so every ODD column is a slot the source
      // never indexed. That is precisely the epic's "adding structure with no leaf".
      let placed: StepGridModel | null = null
      for (let col = 1; col < wide.steps && placed === null; col += 2)
        for (let lane = 0; lane < wide.lanes.length && placed === null; lane++) {
          if (isCellOn(wide.lanes[lane].cells[col])) continue
          const next = toggleCell(wide, lane, col, true)
          if (next !== wide) placed = next
        }
      if (placed === null) continue
      posed++
      const { mini: out, extent } = serializeStepGridWithExtent(placed)
      const bucket = extent.path === 'rebuild' ? subjRebuild : subjSplice
      bump(bucket, out === null ? `${extent.path} (declined)` : extent.path)
      if (out === null) continue
      wrote++
      record(bucket, mini, out)
      if (mini.length >= 40 && extent.path === 'splice' && exSubj.length < 3) exSubj.push([mini, out])
    }

    const show = (name: string, s: Sample) => {
      const t = stats(s)
      console.log(
        `  ${name.padEnd(24)} n=${String(t.n).padStart(4)}  ratio p50=${t.p50.toFixed(3)}` +
          `  bytes p50=${String(t.absP50).padStart(4)} of doc p50=${String(t.lenP50).padStart(4)}` +
          `  whole-doc=${String(t.ge90).padStart(3)}` +
          `  | LONG docs(>=40) n=${String(t.longN).padStart(3)} p50=${t.longP50.toFixed(3)}`,
      )
      for (const [k, v] of [...s.paths.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`       ${String(v).padStart(4)}x  ${k}`)
    }

    console.log(`\n===== #1007 irreducible #1: is subdividing authoring? =====`)
    console.log(`  corpus minis                 ${minis.length}`)
    console.log(`  units opening a step grid    ${units}`)
    console.log(`  can double                   ${doubleable}`)
    console.log(`  subdivide+place POSED        ${posed}   <- denominator; a dead gesture is 0`)
    console.log(`  ...and WROTE a document      ${wrote}`)
    console.log(`  -- bytes moved. THE DISCRIMINATOR is the first two rows: one gesture, two writers --`)
    show('SUBJ subdiv+place SPLICE', subjSplice)
    show('SUBJ subdiv+place REBUILD', subjRebuild)
    show('ANCHOR delete leaf', leafAnchor)
    show('ANCHOR delete splice', spliceAnchor)

    // ---- and the statistic made observable: actual documents, long enough to read ----
    console.log(`\n  -- WHAT IT LOOKS LIKE (long docs, so the change is visible) --`)
    for (const [label, rows] of [
      ['subdivide+place (splice)', exSubj],
      ['delete (leaf surgery)', exLeaf],
    ] as const) {
      console.log(`\n  ${label}:`)
      for (const [b, a] of rows.slice(0, 3)) {
        console.log(`     before  ${JSON.stringify(b)}`)
        console.log(`     after   ${JSON.stringify(a)}`)
      }
    }

    // the gesture must actually have happened — this is the [[P606]] guard, asserted
    expect(posed, 'the subdivide gesture was never posed — check the ResolutionDir literal').toBeGreaterThan(100)
    expect(leafAnchor.ratios.length, 'no leaf anchor — the local end of the scale is missing').toBeGreaterThan(50)
  })
})
