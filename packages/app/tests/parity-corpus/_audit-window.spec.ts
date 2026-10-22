/** GAP 1 — how much does the 4-cycle window hide? Measurement only. */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import { readGridOnsets, type Onset } from '../../../editor/src/codeView/notation/parse'

const dir = path.dirname(fileURLToPath(import.meta.url))
const minis: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'))
  .minis.map((o: { mini: string }) => o.mini.trim())
  .filter((m: string) => m !== '')

function scan(width: number) {
  let accepted = 0, kept = 0
  const collisionUnits = new Set<string>()
  const durDisagreeUnits = new Set<string>()
  let collisionOcc = 0
  const firstSeenAtCycle = new Map<string, number>()
  for (const m of minis) {
    let pat: unknown
    try { pat = reifyMini(m) } catch { continue }
    for (let cyc = 0; cyc < width; cyc++) {
      const r = readGridOnsets(miniPattern(m), cyc)
      if (!r.ok) continue
      accepted++
      for (const o of r.onsets as Onset[]) {
        kept += o.occ.length
        const byTok = new Map<string, number[]>()
        for (const c of o.occ) byTok.set(c.token, [...(byTok.get(c.token) ?? []), c.dur ?? 0])
        for (const [, ds] of byTok) {
          if (ds.length < 2) continue
          collisionOcc += ds.length - 1
          collisionUnits.add(m)
          if (!firstSeenAtCycle.has(m)) firstSeenAtCycle.set(m, cyc)
          const distinct: number[] = []
          for (const x of ds) if (!distinct.some((y) => Math.abs(y - x) < 1e-9)) distinct.push(x)
          if (distinct.length > 1) durDisagreeUnits.add(m)
        }
      }
    }
  }
  return { accepted, kept, collisionUnits, collisionOcc, durDisagreeUnits, firstSeenAtCycle }
}

describe('GAP 1 — cycle-window sensitivity', () => {
  it('compares windows 4 / 8 / 16 / 32', () => {
    const base = scan(4)
    console.log(`\n  window | accepted | kept   | collision units | collision occ | dur-disagree units`)
    let last = base
    for (const w of [4, 8, 16, 32]) {
      const r = scan(w)
      console.log(
        `  ${String(w).padStart(6)} | ${String(r.accepted).padStart(8)} | ${String(r.kept).padStart(6)}` +
        ` | ${String(r.collisionUnits.size).padStart(15)} | ${String(r.collisionOcc).padStart(13)}` +
        ` | ${String(r.durDisagreeUnits.size).padStart(18)}`,
      )
      last = r
    }
    const newUnits = [...last.collisionUnits].filter((u) => !base.collisionUnits.has(u))
    console.log(`\n  UNITS a 4-cycle window NEVER REACHES (${newUnits.length}):`)
    for (const u of newUnits.slice(0, 15)) {
      console.log(`    first collides at cycle ${last.firstSeenAtCycle.get(u)}  ${JSON.stringify(u)}`)
    }
  })
})
