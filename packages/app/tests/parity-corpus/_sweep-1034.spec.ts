/**
 * _sweep-1034.spec.ts — MEASUREMENT ONLY, no product code, excluded from the gate
 * (`vitest.config.ts` includes `*.test.ts` only; `_`-prefixed specs are one-shot
 * sweeps kept as artifacts).
 *
 * QUESTION (#1034): how many real corpus units have ONE sound token at ONE column
 * with TWO OR MORE DIFFERENT lengths — the case `readGridOnsets`' atom-identity
 * guard silently collapses to whichever hap arrived first?
 *
 *     if (!cell.atoms.includes(token)) { atoms.push; spans.push; durs.push }
 *
 * Atoms collapse at a column (a cell shows a sound once). Durations do not.
 *
 * ⚠ THIS ARM ANSWERS THE FILED QUESTION, WHICH TURNED OUT TO BE THE SMALLER HALF.
 * It detects columns where a token carries two different LENGTHS. The same guard
 * was also discarding the write-back ANCHOR, four times as often (32 occurrences
 * / 9 units against 8 / 4), including in units where the two lengths AGREE and
 * this detector is therefore silent. See `_sweep-1034f.spec.ts` for that split and
 * `SWEEP-1034.md` for the whole picture; do not quote this arm's count as the size
 * of the defect.
 *
 * HOW THIS AVOIDS BEING A SECOND ORACLE ([[PV192]]). It does not re-implement the
 * reader. It asks the ENGINE for the same haps the reader sees, and then asserts
 * that its own per-column DISTINCT-TOKEN sets are identical to the shipped
 * `readGridOnsets`' `atoms` for every unit swept. If those ever disagree, the
 * instrument is faulty and no number from it may be quoted ([[P337]] — an
 * instrument is verified by disagreement). The only thing this sweep adds is the
 * multiset the guard throws away.
 *
 * CONTROLS ([[P353]] — a zero from a detector that cannot fire is not evidence):
 *   POSITIVE  `bd*2, bd`   MUST be detected (bd@0 at 0.5 and at 1.0)
 *   NEGATIVE  `[bd@2, bd]` MUST NOT be — a `,`-stack normalizes each part to the
 *             full cycle, so both read 1.0. This is the probe that was WRONG last
 *             session; it stays in as a negative so the mistake cannot recur.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import { readGridOnsets, tailToken, type Onset } from '../../../editor/src/codeView/notation/parse'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** a WINDOW, not cycle 0 — 100% and 0% are both numbers to distrust */
const CYCLES = [0, 1, 2, 3]

interface Hit {
  mini: string
  cyc: number
  /** column position, cycle-relative */
  pos: number
  token: string
  /** every distinct length observed for this token at this column */
  durs: number[]
  /** the raw hap begins behind those lengths — distinct values ⇒ ROUNDING collision */
  begins: number[]
}

/**
 * Read the column→token→durations multiset straight off the engine's haps, using
 * the reader's own value-shape rules (the exported `tailToken` for a `:`-variant).
 * Returns null when the shipped reader declines — its gate, not ours, decides the
 * population, so `NUMERIC`/`wrong-surface` never has to be re-implemented here.
 */
function multisets(
  mini: string,
  cyc: number,
): { cols: Map<number, Map<string, { durs: number[]; begins: number[] }>>; shipped: Onset[] } | null {
  let pat: unknown
  try {
    pat = reifyMini(mini)
  } catch {
    return null
  }
  const r = readGridOnsets(miniPattern(mini), cyc)
  if (!r.ok) return null

  let haps: Array<{
    hasOnset?: () => boolean
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
    value: unknown
  }>
  try {
    haps = (pat as { queryArc(a: number, b: number): typeof haps }).queryArc(cyc, cyc + 1)
  } catch {
    return null
  }

  const cols = new Map<number, Map<string, { durs: number[]; begins: number[] }>>()
  for (const h of haps) {
    if (!(h.hasOnset?.() ?? false) || !h.whole) continue
    const v = h.value as string | number | unknown[] | { s?: unknown; n?: unknown } | null
    let token: string
    if (typeof v === 'string') token = v
    else if (typeof v === 'number') return null // wrong-surface; reader would have declined
    else if (Array.isArray(v)) {
      const t = tailToken(v)
      if (t === null) return null
      token = t
    } else if (v && typeof v === 'object' && typeof v.s === 'string') {
      token = v.s + (v.n != null ? ':' + String(v.n) : '')
    } else return null

    const begin = h.whole.begin.valueOf()
    const pos = begin - cyc
    const key = Math.round(pos * 720720)
    const col = cols.get(key) ?? new Map()
    const cell = col.get(token) ?? { durs: [], begins: [] }
    cell.durs.push(h.whole.end.valueOf() - begin)
    cell.begins.push(begin)
    col.set(token, cell)
    cols.set(key, col)
  }
  return { cols, shipped: r.onsets as Onset[] }
}

/** distinct within a tight epsilon — float noise must not manufacture a hit */
const distinct = (xs: number[]): number[] => {
  const out: number[] = []
  for (const x of xs) if (!out.some((y) => Math.abs(y - x) < 1e-9)) out.push(x)
  return out.sort((a, b) => a - b)
}

function sweepOne(mini: string, cyc: number): { hits: Hit[]; agreed: boolean; swept: boolean } {
  const m = multisets(mini, cyc)
  if (!m) return { hits: [], agreed: true, swept: false }

  // INSTRUMENT VALIDATION — our distinct-token set per column must equal the
  // shipped reader's `atoms`. Anything else means we are reading a different
  // pattern than the code under test and every number below is void.
  const mineKeyed = [...m.cols.entries()]
    .map(([k, col]) => [k, [...col.keys()].sort()] as const)
    .sort((a, b) => a[0] - b[0])
  const shippedKeyed = m.shipped
    .map((o) => [Math.round(o.pos * 720720), [...o.atoms].sort()] as const)
    .sort((a, b) => a[0] - b[0])
  const agreed = JSON.stringify(mineKeyed) === JSON.stringify(shippedKeyed)

  const hits: Hit[] = []
  for (const [key, col] of m.cols) {
    for (const [token, cell] of col) {
      const d = distinct(cell.durs)
      if (d.length > 1) {
        hits.push({ mini, cyc, pos: key / 720720, token, durs: d, begins: distinct(cell.begins) })
      }
    }
  }
  return { hits, agreed, swept: true }
}

describe('#1034 sweep — one sound, one column, two lengths', () => {
  it('CONTROL: the detector fires on a known positive and stays silent on the known negative', () => {
    const pos = sweepOne('bd*2, bd', 0)
    expect(pos.agreed).toBe(true)
    console.log('\n  POSITIVE CONTROL `bd*2, bd` →', JSON.stringify(pos.hits))
    expect(pos.hits.length).toBeGreaterThan(0)
    expect(pos.hits[0].durs.length).toBeGreaterThan(1)

    const neg = sweepOne('[bd@2, bd]', 0)
    expect(neg.agreed).toBe(true)
    console.log('  NEGATIVE CONTROL `[bd@2, bd]` →', JSON.stringify(neg.hits))
    expect(neg.hits).toHaveLength(0)
  })

  it('sweeps the corpus and prints PER-UNIT rows', () => {
    const allHits: Hit[] = []
    const disagreements: string[] = []
    const sweptUnits = new Set<string>()
    let sweptPairs = 0

    for (const mini of minis) {
      for (const cyc of CYCLES) {
        const { hits, agreed, swept } = sweepOne(mini, cyc)
        if (!swept) continue
        sweptPairs++
        sweptUnits.add(mini)
        if (!agreed) disagreements.push(`${mini} @cyc${cyc}`)
        allHits.push(...hits)
      }
    }

    console.log(`\n===== #1034 SWEEP =====`)
    console.log(`population 1 — corpus minis (all):            ${minis.length}`)
    console.log(`population 2 — grid-READABLE units (≥1 cyc):  ${sweptUnits.size}`)
    console.log(`             (unit×cycle pairs swept):        ${sweptPairs}`)
    console.log(`INSTRUMENT disagreements vs readGridOnsets:   ${disagreements.length}`)
    if (disagreements.length) console.log(disagreements.slice(0, 20).join('\n'))

    const byMini = new Map<string, Hit[]>()
    for (const h of allHits) byMini.set(h.mini, [...(byMini.get(h.mini) ?? []), h])

    console.log(`\nUNITS EXHIBITING THE COLLAPSE:               ${byMini.size}`)
    console.log(`COLUMN×TOKEN INSTANCES (across the window):  ${allHits.length}`)

    console.log(`\n--- PER-UNIT ROWS ---`)
    for (const [mini, hits] of byMini) {
      // a ROUNDING collision (distinct begins) is a different defect from a stack
      // collapse (one begin, several lengths) — never merge the two counts
      const rounding = hits.filter((h) => h.begins.length > 1).length
      console.log(
        `\n  ${JSON.stringify(mini)}\n    instances=${hits.length} rounding-collisions=${rounding}`,
      )
      for (const h of hits.slice(0, 6)) {
        console.log(
          `      cyc${h.cyc} pos=${h.pos.toFixed(4)} token=${JSON.stringify(h.token)} ` +
            `durs=[${h.durs.map((d) => d.toFixed(4)).join(', ')}] begins=${h.begins.length}`,
        )
      }
      if (hits.length > 6) console.log(`      … ${hits.length - 6} more`)
    }
    if (byMini.size === 0) console.log('  (none)')

    expect(disagreements).toHaveLength(0)
  })
})
