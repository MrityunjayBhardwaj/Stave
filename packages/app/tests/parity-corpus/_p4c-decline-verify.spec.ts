/**
 * THE DECISIVE EXPERIMENT for P4c's decline set (#1010).
 *
 * The alternation stress sweep declines on 18 units where 1 was predicted. A count
 * cannot tell an over-broad guard from a correct refusal: both look like "the writer
 * said no". The question that separates them is counterfactual —
 *
 *   for each declined (unit, lane, column) toggle, emit it THE OLD WAY (the writer at
 *   `studio_v0.2.0` @ 5f008316, which re-derived every length from the columns) and ask
 *   the ENGINE whether the notes the user did not touch still play the same.
 *
 *     they differ    → the refusal is correct. Those are losses the one-note probe
 *                      never saw, and the decline is the printer refusing to corrupt.
 *     they are equal → `sustainTokens` is refusing an edit the old writer got right,
 *                      and the guard needs narrowing.
 *
 * THE OLD WRITER IS THE OLD WRITER, not a reconstruction. `__p4c_base__/` holds
 * `model.ts` / `parse.ts` / `serialize.ts` copied verbatim from 5f008316 (only the two
 * relative imports in `parse.ts` re-pointed at the shared `euclid`/`pitch`, which this
 * phase did not touch). Regenerate with:
 *   for f in model parse serialize; do
 *     git show 5f008316:packages/editor/src/visualEdit/notation/$f.ts \
 *       > packages/app/tests/parity-corpus/__p4c_base__/$f.ts; done
 *   # then re-point '../../ir/euclid' and './pitch' as above
 *
 * COMPARISON: the engine on both sides ([[P301]]) — never re-parsed columns, since
 * `[~ 1@2]` and `[~ ~ 1@4]` are the same music at two resolutions. Restricted to the
 * notes at positions OTHER than the toggled column, because those are exactly the ones
 * the edit must not change; the toggled position itself legitimately gains or loses a
 * note and carries no information about corruption.
 *
 * Not a gate. `.spec.ts` so the normal run skips it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { cellOn, clampLane, isCellOn } from '../../../editor/src/codeView/notation/model'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'
import { parseStepGrid as baseParseStepGrid } from './__p4c_base__/parse'
import {
  cellOn as baseCellOn,
  clampLane as baseClampLane,
  isCellOn as baseIsCellOn,
} from './__p4c_base__/model'
import { serializeStepGrid as baseSerializeStepGrid } from './__p4c_base__/serialize'
import { enginePlayedCycle, sig, HRES, type Note } from './engineEditOracle'

const here = path.dirname(fileURLToPath(import.meta.url))
type Row = {
  mini: string
  lane: number
  col: number
  laneToken: string
  steps: number
  bars: number
  turningOn: boolean
}
const rows: Row[] = JSON.parse(fs.readFileSync(path.join(here, '_p4c-declines.json'), 'utf8'))

/** every note the mini plays across the bars the model spans */
function playedAcross(src: string, bars: number): Note[] | null {
  const out: Note[] = []
  for (let b = 0; b < bars; b++) {
    const here = enginePlayedCycle(src, b)
    if (here === null) return null
    out.push(...here)
  }
  return out
}

/** the notes the edit must not touch: everything not at the toggled column's instant */
const away = (ns: Note[], pos: number): Note[] =>
  ns.filter((n) => Math.round(n.pos * HRES) !== Math.round(pos * HRES))

/** (onset, atom) only — equal here but unequal on the full key means a LENGTH moved */
const sigNoDur = (ns: Note[]): string =>
  JSON.stringify(ns.map((n) => `${Math.round(n.pos * HRES)}|${n.atom}`).sort())

describe('P4c — is the decline a correct refusal or an over-broad guard?', () => {
  it('CONTROL: the base parser reads the same grid HEAD does', () => {
    const bad: string[] = []
    for (const mini of new Set(rows.map((r) => r.mini))) {
      const a = parseStepGrid(mini)
      const b = baseParseStepGrid(mini)
      if (!a.ok || !b.ok) {
        bad.push(`PARSE ${JSON.stringify(mini)} head=${a.ok} base=${b.ok}`)
        continue
      }
      if (a.model.steps !== b.model.steps || a.model.lanes.length !== b.model.lanes.length) {
        bad.push(`SHAPE ${JSON.stringify(mini)}`)
        continue
      }
      for (let l = 0; l < a.model.lanes.length; l++) {
        if (a.model.lanes[l].sound !== b.model.lanes[l].sound) bad.push(`SOUND ${JSON.stringify(mini)} lane ${l}`)
        for (let c = 0; c < a.model.steps; c++) {
          const x = a.model.lanes[l].cells[c]
          const y = b.model.lanes[l].cells[c]
          if (isCellOn(x) !== baseIsCellOn(y)) bad.push(`ON ${JSON.stringify(mini)} ${l}/${c}`)
          else if (isCellOn(x) && baseIsCellOn(y) && Math.abs(x.duration - y.duration) > 1e-9)
            bad.push(`DUR ${JSON.stringify(mini)} ${l}/${c} ${x.duration} vs ${y.duration}`)
        }
      }
    }
    // Same grid, same lengths → the (lane, column) toggle is the SAME edit on both
    // sides, which is what makes the counterfactual a counterfactual.
    expect(bad.slice(0, 10), bad.join('\n')).toEqual([])
  })

  it('CONTROL: the comparison is silent on an unchanged document and fires on a shortened one', () => {
    // NEGATIVE — the machinery must not report a difference where there is none.
    const noise: string[] = []
    // POSITIVE ([[P353]]) — drop every length back to one column, which is precisely
    // what the old printer did, and require the comparison to SEE it wherever the unit
    // actually carries a length. A control arm that cannot fire certifies nothing.
    let couldFire = 0
    let fired = 0
    for (const mini of new Set(rows.map((r) => r.mini))) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const bars = r.model.bars ?? 1
      const want = playedAcross(mini, bars)
      if (want === null) continue
      if (sig(want, false) !== sig(playedAcross(mini, bars) ?? [], false)) noise.push(mini)

      const hasLength = r.model.lanes.some((l) => l.cells.some((c) => isCellOn(c) && c.duration !== 1))
      if (!hasLength) continue
      const flat = {
        ...r.model,
        lanes: r.model.lanes.map((l) => ({
          ...l,
          cells: l.cells.map((c) => (isCellOn(c) ? cellOn(1) : c)),
        })),
      }
      const out = serializeStepGrid(flat)
      if (out === null) continue
      couldFire++
      const got = playedAcross(out, bars)
      if (got === null || sig(got, false) !== sig(want, false)) fired++
    }
    expect(noise, noise.join('\n')).toEqual([])
    expect(couldFire, 'the positive control must have units to run on').toBeGreaterThan(0)
    expect(fired, 'a length dropped to one column must be VISIBLE to this comparison').toBe(couldFire)
  })

  it('VERDICT: emit each declined toggle the old way and ask the engine', () => {
    const buckets: Record<string, number> = {
      'base-also-declined': 0,
      'base-output-unreifiable': 0,
      'DIFFERS-duration-only': 0,
      'DIFFERS-structural': 0,
      'IDENTICAL-guard-suspect': 0,
      'no-engine-read': 0,
    }
    const suspects: string[] = []
    const perUnit = new Map<string, Record<string, number>>()

    for (const row of rows) {
      const b = baseParseStepGrid(row.mini)
      if (!b.ok) continue
      const cells0 = [...b.model.lanes[row.lane].cells]
      cells0[row.col] = baseIsCellOn(cells0[row.col]) ? false : baseCellOn()
      const cells = baseClampLane(cells0, b.model.steps)
      const edited = {
        ...b.model,
        lanes: b.model.lanes.map((l, li) => (li === row.lane ? { ...l, cells } : l)),
      }
      const oldOut = baseSerializeStepGrid(edited)

      let verdict: string
      if (oldOut === null) {
        // the OLD writer refused too — P4c did not introduce this refusal
        verdict = 'base-also-declined'
      } else {
        const bars = row.bars
        const want = playedAcross(row.mini, bars)
        const got = playedAcross(oldOut, bars)
        if (want === null) verdict = 'no-engine-read'
        else if (got === null) verdict = 'base-output-unreifiable'
        else {
          const pos = row.col / (row.steps / bars)
          const w = away(want, pos)
          const g = away(got, pos)
          if (sig(g, false) === sig(w, false)) {
            verdict = 'IDENTICAL-guard-suspect'
            if (suspects.length < 12)
              suspects.push(
                `${JSON.stringify(row.mini)} lane ${row.lane} col ${row.col} -> ${JSON.stringify(oldOut)}`,
              )
          } else verdict = sigNoDur(g) === sigNoDur(w) ? 'DIFFERS-duration-only' : 'DIFFERS-structural'
        }
      }
      buckets[verdict]++
      const u = perUnit.get(row.mini) ?? {}
      u[verdict] = (u[verdict] ?? 0) + 1
      perUnit.set(row.mini, u)
    }

    console.log(`\nPOPULATION: ${rows.length} declined toggles over ${perUnit.size} units`)
    console.log(JSON.stringify(buckets, null, 1))
    // THE COST, at the granularity the user experiences ([[PK65]] step 3): a decline is
    // per EDIT, so the denominator is every toggle these units offer, not the units.
    let offered = 0
    console.log('\nPER UNIT  (declined / offered toggles):')
    for (const [mini, u] of [...perUnit].sort()) {
      const r = parseStepGrid(mini)
      const total = r.ok ? r.model.lanes.length * r.model.steps : NaN
      offered += total
      console.log(`  ${JSON.stringify(mini)}  ${JSON.stringify(u)}  of ${total}`)
    }
    console.log(
      `\nCOST: ${rows.length} declined of ${offered} toggles these 18 units offer` +
        ` — and ${buckets['IDENTICAL-guard-suspect']} of the declined would have been written correctly the old way.`,
    )
    if (suspects.length) console.log('\nSUSPECTS:\n' + suspects.join('\n'))
    expect(rows.length).toBeGreaterThan(0)
  })
})
