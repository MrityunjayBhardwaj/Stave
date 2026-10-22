import { describe, it } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGridOnsets } from '../../../editor/src/codeView/notation/parse'

const dir = path.dirname(fileURLToPath(import.meta.url))
const minis: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'))
  .minis.map((o: { mini: string }) => o.mini.trim())
  .filter((m: string) => m !== '')
const sp = (s: { start: number; end: number } | null) => (s ? `${s.start},${s.end}` : 'null')

describe('#1034 — what the 44 dropped occurrences were carrying', () => {
  it('splits them by whether the length and the anchor differed', () => {
    let dropped = 0, durDiff = 0, spanDiff = 0, bothSame = 0
    const spanRows: string[] = []
    const durUnits = new Set<string>(), spanUnits = new Set<string>(), anyUnits = new Set<string>()
    for (const m of minis) {
      for (let cyc = 0; cyc < 16; cyc++) {
        let pat: unknown
        try { pat = reifyMini(m) } catch { continue }
        const r = readGridOnsets(miniPattern(m), cyc) as { ok: boolean; onsets?: any[] }
        if (!r.ok) continue
        for (const o of r.onsets!) {
          const seen = new Map<string, any>()
          for (const c of o.occ) {
            const kept = seen.get(c.token)
            if (!kept) { seen.set(c.token, c); continue }
            dropped++
            anyUnits.add(m)
            const dDiff = Math.abs((kept.dur ?? 0) - (c.dur ?? 0)) > 1e-9
            const sDiff = sp(kept.span) !== sp(c.span)
            if (dDiff) { durDiff++; durUnits.add(m) }
            if (sDiff) {
              spanDiff++
              spanUnits.add(m)
              if (spanRows.length < 8) {
                spanRows.push(
                  `  ${JSON.stringify(m)} @cyc${cyc} pos=${o.pos.toFixed(4)} tok=${c.token} ` +
                  `kept span=${sp(kept.span)} dropped span=${sp(c.span)} ` +
                  `durs=${kept.dur?.toFixed(4)}/${c.dur?.toFixed(4)}`,
                )
              }
            }
            if (!dDiff && !sDiff) bothSame++
          }
        }
      }
    }
    console.log(`\n  occurrences dropped by the OLD guard: ${dropped}`)
    console.log(`    ...whose DURATION differed from the kept one: ${durDiff}`)
    console.log(`    ...whose ANCHOR (span) differed:              ${spanDiff}`)
    console.log(`    ...identical on both axes (a true duplicate): ${bothSame}`)
    console.log(`\n  DISTINCT UNITS: any drop=${anyUnits.size}  duration-losing=${durUnits.size}  anchor-losing=${spanUnits.size}`)
    console.log(`\n  ANCHOR-LOSS ROWS:\n${spanRows.join('\n') || '  (none)'}`)
  })
})
