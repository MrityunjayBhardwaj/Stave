/**
 * _p4b-cell-duration.spec.ts — MEASUREMENT ONLY, no product code, excluded from
 * the gate (`vitest.config.ts` includes `*.test.ts` only).
 *
 * QUESTION (#1010 P4b, asked BEFORE writing the product change): when the step
 * cell starts carrying a LENGTH, what lengths will it have to carry?
 *
 * Two things are being observed, and they are different:
 *
 *  1. THE UNIT. `Onset.durs` is in CYCLES. The cell's consumers reason in COLUMNS
 *     (`resolution.ts`, `resize.ts`, and — P4c — the printer), and `RollNote.duration`
 *     is already "length in columns". So the conversion at the read boundary is
 *     `dur_columns = dur_cycles * perBar`. This sweep prints the resulting
 *     distribution: how many cells last exactly their column, how many less, how
 *     many more. A cell population that is entirely `1` would mean the axis is
 *     carrying nothing and P4c has nothing to preserve.
 *
 *  2. THE TWO PATHS. The syntactic core walks the AST and knows a slot's SPAN in
 *     columns; the derived projection reads haps and knows a length in cycles.
 *     If they disagree about the same unit's lengths, they would populate one
 *     field with two different meanings — a finding, not a detail. The sweep
 *     reports them separately so the comparison is possible at all.
 *
 * NOT A SECOND ORACLE ([[PV192]]): the lengths come from the ENGINE (`queryArc`),
 * read exactly the way `readRollNotes` and `Onset.durs` read them
 * (`whole.end - whole.begin`). Nothing here re-implements a reader; the shipped
 * `parseStepGrid` supplies the model and the column count.
 *
 * SAMPLING DEPTH ([[P359]]): 16 cycles, the width the conservation gate converged
 * at. Printed with the figures, and sampled at 8 as well so a depth restriction
 * would show up as a disagreement instead of hiding.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** hap lengths at one cycle, in COLUMNS of a `perBar`-column grid */
function lengthsInColumns(mini: string, perBar: number, cyc: number): number[] {
  let haps: Array<{
    hasOnset?: () => boolean
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
  }>
  try {
    haps = (reifyMini(mini) as { queryArc(a: number, b: number): typeof haps }).queryArc(
      cyc,
      cyc + 1,
    )
  } catch {
    return []
  }
  const out: number[] = []
  for (const h of haps) {
    if (!(h.hasOnset?.() ?? false) || !h.whole) continue
    out.push((h.whole.end.valueOf() - h.whole.begin.valueOf()) * perBar)
  }
  return out
}

/**
 * TOLERANCE, and the first run of this sweep needed it: hap boundaries are Fraction
 * arithmetic converted to float, so a note lasting exactly its column arrives as
 * 0.9999999999999998 about as often as 1. Bucketing on `=== 1` therefore reported
 * 63 syntactic units with sub-column notes while the example arm — which used a
 * tolerance — found 0 of them. Two arms of one sweep disagreeing is what caught it
 * ([[P337]]); the exact comparison was the faulty one.
 */
const EPS = 1e-9
const bucket = (d: number): string =>
  Math.abs(d - 1) < EPS
    ? 'exactly 1 column'
    : d < 1
      ? 'SHORTER than its column'
      : 'LONGER than its column'

/**
 * POPULATION ([[P343]]), and the first version of this sweep got it wrong: a step
 * grid's cells cover exactly `bars` cycles (1 when single-cycle), so a hap at cycle
 * 5 of a single-bar model is a hap NO CELL EXISTS FOR. Sampling a fixed 8/16-cycle
 * window therefore counted lengths the cell will never have to carry, and it
 * reported 87 syntactic-path units with sub-column notes of which **0 are visible at
 * cycle 0**. Depth is the right question for a measurement over a repeating
 * structure ([[P359]]) — but only within the window the READER reads. Here that
 * window is not a free parameter: it is `bars`, and it is per-unit.
 *
 * `extra` samples cycles PAST the model's own window on purpose, to keep the
 * distinction visible rather than assumed: those rows are labelled `out-of-model`.
 */
function sweep(extra: number): Map<string, { units: Set<string>; occ: number }> {
  const out = new Map<string, { units: Set<string>; occ: number }>()
  const add = (key: string, mini: string): void => {
    const e = out.get(key) ?? { units: new Set<string>(), occ: 0 }
    e.units.add(mini)
    e.occ += 1
    out.set(key, e)
  }
  for (const mini of minis) {
    const r = parseStepGrid(mini)
    if (!r.ok) continue
    const m = r.model
    const bars = Math.max(1, m.bars ?? 1)
    const perBar = m.steps / bars
    if (!Number.isFinite(perBar) || perBar <= 0) continue
    const path = parseStepGridCore(mini).ok
      ? 'syntactic'
      : m.leafSource
        ? 'derived+leaf'
        : 'derived'
    for (let cyc = 0; cyc < bars + extra; cyc++) {
      const scope = cyc < bars ? 'in-model' : 'out-of-model'
      for (const d of lengthsInColumns(mini, perBar, cyc)) {
        add(`${path} / ${scope} / ${bucket(d)}`, mini)
      }
    }
  }
  return out
}

describe('P4b — what lengths will the step cell have to carry?', () => {
  it('reports the length distribution, by read path, at two sampling depths', () => {
    for (const extra of [0, 8]) {
      const res = sweep(extra)
      const keys = [...res.keys()].sort()
      console.log(`\n===== CELL LENGTHS, bars + ${extra} cycles =====`)
      for (const k of keys) {
        const e = res.get(k)!
        console.log(`  ${k.padEnd(42)} ${String(e.occ).padStart(6)} occ  ${e.units.size} units`)
      }
    }
  })

  /**
   * The first sweep REFUTED the prediction that a syntactic-path note lasts its
   * slot's SPAN: 87 units carry notes SHORTER than one column, and a span is ≥1
   * column by construction. This asks what those units are — the answer decides
   * whether the syntactic path may compute a length at all.
   */
  it.each([
    ['syntactic', 'SHORTER'],
    ['syntactic', 'LONGER'],
    ['derived', 'SHORTER'],
    ['derived', 'LONGER'],
  ])('shows %s-path units whose notes are %s than a column', (want, dir) => {
    const hits: Array<{ mini: string; steps: number; lens: number[] }> = []
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const isCore = parseStepGridCore(mini).ok
      if ((want === 'syntactic') !== isCore) continue
      const m = r.model
      const bars = Math.max(1, m.bars ?? 1)
      const perBar = m.steps / bars
      const lens: number[] = []
      for (let cyc = 0; cyc < bars; cyc++) lens.push(...lengthsInColumns(mini, perBar, cyc))
      const hit = dir === 'SHORTER' ? lens.some((d) => d < 1 - EPS) : lens.some((d) => d > 1 + EPS)
      if (hit) hits.push({ mini, steps: m.steps, lens })
    }
    console.log(`\n===== ${want}, ${dir} than a column, IN MODEL SCOPE: ${hits.length} units =====`)
    for (const h of hits.slice(0, 12)) {
      const uniq = [...new Set(h.lens.map((d) => Number(d.toFixed(4))))].sort((a, b) => a - b)
      console.log(
        `  steps=${String(h.steps).padStart(3)} lens=${JSON.stringify(uniq).padEnd(28)} ${h.mini.replace(/\s+/g, ' ').slice(0, 90)}`,
      )
    }
  })

  it('prints the hand-picked cases P4b is predicted against', () => {
    const cases = ['bd ~ sd ~', '[hh ~]!16', 'bd*2 sd sd sd', '[bd@0.5 - - -]', 'bd [sd sd sd]']
    for (const mini of cases) {
      const r = parseStepGrid(mini)
      if (!r.ok) {
        console.log(`  ${mini.padEnd(18)} REFUSED (${JSON.stringify(r).slice(0, 60)})`)
        continue
      }
      const m = r.model
      const perBar = (m.bars ?? 1) > 1 ? m.steps / (m.bars ?? 1) : m.steps
      const lens = lengthsInColumns(mini, perBar, 0)
      console.log(
        `  ${mini.padEnd(18)} steps=${String(m.steps).padStart(3)} ` +
          `path=${parseStepGridCore(mini).ok ? 'syntactic' : m.leafSource ? 'derived+leaf' : 'derived'} ` +
          `lengths(cols)=[${lens.map((d) => Number(d.toFixed(4))).join(', ')}]`,
      )
    }
  })
})
