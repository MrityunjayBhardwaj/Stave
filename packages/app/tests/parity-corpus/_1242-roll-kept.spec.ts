/**
 * _1242-roll-kept.spec.ts — VERIFY the one figure in #1242 that is not roughly
 * proportional to the population.
 *
 * `reader-conservation.test.ts` pins `ROLL_KEPT` — notes the roll reader kept,
 * summed over 16 cycles across every unit×cycle pair it accepted. The widening
 * moved it 72920 -> 162336, +123%, against a +6.4% population and a +10.7% move
 * in `ROLL_ACCEPTED`. Every other figure in the PR moved roughly with the
 * population. This one did not, so it is either a real property of the arrivals
 * or an artefact, and a pin nobody can explain is a pin nobody can defend.
 *
 * THE CONTROL THAT DECIDES IT: run the SAME sweep twice — once over the rows the
 * committed corpus held BEFORE the widening (`git show HEAD~1`), once over the
 * rows it holds now. If the old-rows total reproduces 72920 exactly, the whole
 * delta is attributable to the 98 arrivals and nothing about the survivors
 * changed. Then NAME the arrivals that carry it, because "a handful of long
 * multi-cycle chord charts" is a story until the handful is enumerated.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1242-roll-kept.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import { rollOnsets } from '../../../editor/src/codeView/notation/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const CYCLES = Array.from({ length: 16 }, (_, i) => i)

/** identical to reader-conservation's ROLL arm and its `playedCount` */
function keptFor(mini: string): { accepted: number; kept: number } {
  let pat: unknown
  try {
    pat = reifyMini(mini)
  } catch {
    return { accepted: 0, kept: 0 }
  }
  let accepted = 0
  let kept = 0
  for (const cyc of CYCLES) {
    const r = rollOnsets(miniPattern(mini), cyc)
    if (r === null) continue
    let played: number
    try {
      const haps = (pat as any).queryArc(cyc, cyc + 1) as any[]
      played = haps.filter((h) => (h.hasOnset?.() ?? false) && h.whole != null).length
    } catch {
      continue
    }
    void played
    accepted++
    kept += r.length
  }
  return { accepted, kept }
}

describe('#1242 — where ROLL_KEPT +123% actually comes from', () => {
  it('attributes the move to the arrivals, and names the units that carry it', () => {
    const nowRaw = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
    const oldRaw = JSON.parse(
      execFileSync('git', ['show', 'HEAD~1:packages/app/tests/parity-corpus/mini-corpus.json'], {
        cwd: path.resolve(here, '../../../..'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    )

    const clean = (rows: { mini: string }[]) =>
      rows.map((o) => o.mini.trim()).filter((m) => m !== '')
    const nowMinis = clean(nowRaw.minis)
    const oldMinis = clean(oldRaw.minis)
    const viaOf = new Map<string, string>(
      (nowRaw.minis as { mini: string; via: string }[]).map((r) => [r.mini.trim(), r.via]),
    )

    const oldSet = new Set(oldMinis)
    const arrivals = nowMinis.filter((m) => !oldSet.has(m))
    const departures = oldMinis.filter((m) => !new Set(nowMinis).has(m))

    const per = new Map<string, { accepted: number; kept: number }>()
    for (const m of new Set([...nowMinis, ...oldMinis])) per.set(m, keptFor(m))

    const sum = (list: string[]) =>
      list.reduce(
        (a, m) => {
          const r = per.get(m)!
          return { accepted: a.accepted + r.accepted, kept: a.kept + r.kept }
        },
        { accepted: 0, kept: 0 },
      )

    const oldT = sum(oldMinis)
    const nowT = sum(nowMinis)
    const arrT = sum(arrivals)

    console.log(`\n===== #1242 ROLL_KEPT ATTRIBUTION =====`)
    console.log(`corpus rows      : old ${oldMinis.length}  now ${nowMinis.length}`)
    console.log(`arrivals         : ${arrivals.length}   departures: ${departures.length}`)
    console.log(`OLD rows  accepted ${oldT.accepted}  kept ${oldT.kept}   <- must reproduce 12230 / 72920`)
    console.log(`NOW rows  accepted ${nowT.accepted}  kept ${nowT.kept}   <- must reproduce 13539 / 162336`)
    console.log(`ARRIVALS  accepted ${arrT.accepted}  kept ${arrT.kept}`)
    console.log(
      `notes per accepted pair: old ${(oldT.kept / oldT.accepted).toFixed(1)}` +
        `  arrivals ${(arrT.kept / Math.max(1, arrT.accepted)).toFixed(1)}`,
    )

    // WHO CARRIES IT — enumerated, because "a handful of long chord charts" is a
    // story until the handful has names and the tail has a size.
    const ranked = [...per.entries()]
      .filter(([m]) => arrivals.includes(m))
      .sort((a, b) => b[1].kept - a[1].kept)
    console.log(`\n-- top 15 arrivals by kept (of ${ranked.length}) --`)
    let running = 0
    for (const [m, r] of ranked.slice(0, 15)) {
      running += r.kept
      console.log(
        `  kept ${String(r.kept).padStart(6)}  acc ${String(r.accepted).padStart(3)}` +
          `  via ${(viaOf.get(m) ?? '?').padEnd(7)} ${JSON.stringify(m.length > 70 ? m.slice(0, 67) + '...' : m)}`,
      )
    }
    console.log(`  top-15 carry ${running} of the ${arrT.kept} the arrivals add`)

    const byVia = new Map<string, number>()
    for (const m of arrivals) byVia.set(viaOf.get(m) ?? '?', (byVia.get(viaOf.get(m) ?? '?') ?? 0) + per.get(m)!.kept)
    console.log(`\n-- arrivals' kept by proposer --`)
    for (const [k, v] of [...byVia.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}`)

    // THE CONTROL. If the old rows no longer reproduce the old pins, the delta is
    // NOT the arrivals and the whole reading above is about something else.
    expect([oldT.accepted, oldT.kept], 'the OLD rows must reproduce the OLD pins').toEqual([
      12230, 72920,
    ])
    expect([nowT.accepted, nowT.kept], 'the NOW rows must reproduce the NEW pins').toEqual([
      13539, 162336,
    ])
    expect(departures, 'a departure would make the delta un-attributable').toEqual([])
  })
})
