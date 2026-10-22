/**
 * _sweep-1034c — the #1034 sweep re-run over the DOC population (the 889 musical
 * units / 150 tunes), because arm (a) swept `mini-corpus.json` and that is a
 * DIFFERENT population: 1500 distinct minis harvested from 360 tunes by the regex
 * `\b(?:s|sound|note|n)\(\s*"([^"\\]*)"`. Reporting arm (a)'s count as an answer
 * about "the 889" would be [[P343]] exactly — two adjacent numbers over different
 * populations, read as one.
 *
 * The unit model is IMPORTED (`unitsWithStatus`), never re-derived — a second copy
 * of it would answer confidently and diverge silently.
 *
 * Measurement only. Excluded from the gate once renamed back to `.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import { readGridOnsets, tailToken } from '../../../editor/src/codeView/notation/parse'
import { unitsWithStatus } from './editCoverage'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.bakery-runs')

/** the 150-tune population: the three most recent 50-tune runs, offsets 0/250/500 */
const RUNS = [
  'edit-samples-2026-07-24T17-49-00-172Z.json',
  'edit-samples-offset250-2026-07-24T17-49-04-301Z.json',
  'edit-samples-offset500-2026-07-24T17-49-08-639Z.json',
]

const CYCLES = Array.from({ length: 16 }, (_, i) => i) // widened: 4 was hiding a unit that first collides at cycle 12

/** identical detector to arm (a); duplicated here only because arm (a) is a spec */
function collapses(mini: string, cyc: number): { token: string; durs: number[] }[] | null {
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
  const cols = new Map<number, Map<string, number[]>>()
  for (const h of haps) {
    if (!(h.hasOnset?.() ?? false) || !h.whole) continue
    const v = h.value as string | number | unknown[] | { s?: unknown; n?: unknown } | null
    let token: string
    if (typeof v === 'string') token = v
    else if (typeof v === 'number') return null
    else if (Array.isArray(v)) {
      const t = tailToken(v)
      if (t === null) return null
      token = t
    } else if (v && typeof v === 'object' && typeof v.s === 'string') {
      token = v.s + (v.n != null ? ':' + String(v.n) : '')
    } else return null
    const begin = h.whole.begin.valueOf()
    const key = Math.round((begin - cyc) * 720720)
    const col = cols.get(key) ?? new Map<string, number[]>()
    col.set(token, [...(col.get(token) ?? []), h.whole.end.valueOf() - begin])
    cols.set(key, col)
  }
  const out: { token: string; durs: number[] }[] = []
  for (const col of cols.values()) {
    for (const [token, ds] of col) {
      const d: number[] = []
      for (const x of ds) if (!d.some((y) => Math.abs(y - x) < 1e-9)) d.push(x)
      if (d.length > 1) out.push({ token, durs: d.sort((a, b) => a - b) })
    }
  }
  return out
}

describe('#1034 doc arm — the 889-unit / 150-tune population', () => {
  it('counts colliding UNITS, with per-unit rows', () => {
    const docs: { hash: string; code: string }[] = []
    for (const f of RUNS) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      docs.push(...(j.samples as { hash: string; code: string }[]))
    }

    let musicalUnits = 0
    let unitsWithMini = 0
    let gridReadable = 0
    const hitRows: string[] = []
    const hitUnits = new Set<string>()
    const hitTunes = new Set<string>()

    for (const d of docs) {
      let units: ReturnType<typeof unitsWithStatus>
      try {
        units = unitsWithStatus(d.code)
      } catch {
        continue
      }
      for (const { unit, status } of units) {
        if (status.status === 'setup' || status.status === 'non-musical') continue
        musicalUnits++
        const mini = unit.miniString
        if (mini == null) continue
        unitsWithMini++
        let readableHere = false
        const found: string[] = []
        for (const cyc of CYCLES) {
          const c = collapses(mini, cyc)
          if (c == null) continue
          readableHere = true
          for (const h of c) {
            found.push(`cyc${cyc} ${JSON.stringify(h.token)} durs=[${h.durs.map((x) => x.toFixed(4)).join(', ')}]`)
          }
        }
        if (readableHere) gridReadable++
        if (found.length) {
          hitUnits.add(`${d.hash}::${mini}`)
          hitTunes.add(d.hash)
          hitRows.push(`  ${d.hash}  ${JSON.stringify(mini)}\n      ${found.slice(0, 4).join('\n      ')}`)
        }
      }
    }

    console.log(`\n===== #1034 DOC ARM (150 tunes, offsets 0/250/500) =====`)
    console.log(`tunes (docs) loaded:                 ${docs.length}`)
    console.log(`musical units:                       ${musicalUnits}`)
    console.log(`  of those, carrying a mini string:  ${unitsWithMini}`)
    console.log(`  of those, grid-READABLE (≥1 cyc):  ${gridReadable}`)
    console.log(`\nUNITS EXHIBITING THE COLLAPSE:       ${hitUnits.size}`)
    console.log(`TUNES AFFECTED:                      ${hitTunes.size}`)
    console.log(`\n--- PER-UNIT ROWS ---`)
    console.log(hitRows.length ? hitRows.join('\n') : '  (none)')
    expect(docs.length).toBe(150)
  })
})
