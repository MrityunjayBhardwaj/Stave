/**
 * P4c SCOPING — is "losses 30 -> 0" reachable by making the printer preserve lengths?
 *
 * Not a gate. For every step-grid loss, re-runs the SAME delete the oracle ran and
 * asks what the emitted document actually got wrong:
 *
 *  - DURATION-ONLY  — the emitted notes agree with the expected ones on (onset, atom)
 *    as a multiset and differ only in length. These are the ones a length-preserving
 *    printer can fix.
 *  - STRUCTURAL     — onsets or atoms differ too. A printer that preserves lengths
 *    does not address these, and counting them in the 30 would overstate P4c.
 *
 * Also reports, per loss, whether the model's own lengths are SPELLABLE column-wise:
 * an integer number of columns (`_` sustain per covered column) versus sub-column
 * (0.5 of a column), which no per-column token can express at the grid's resolution.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'
import {
  probeEdit,
  GRID_SURFACE,
  enginePlayedCycle,
  singletonPos,
  liveness,
  HRES,
  type Note,
} from './engineEditOracle'

const dir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

const onsetKey = (n: Note) => `${Math.round(n.pos * HRES)}|${n.atom}`
const fullKey = (n: Note) => `${onsetKey(n)}|${Math.round(n.dur * HRES)}`
const bag = (rows: Note[], k: (n: Note) => string) => [...new Set(rows.map(k))].sort().join(';')

/** the probe's own choice of bar + position, replayed so we compare the same edit */
function probeTarget(mini: string, bars: number): { bar: number; pos: number } | null {
  for (let b = 0; b < bars; b++) {
    const here = enginePlayedCycle(mini, b)
    if (here === null) return null
    if (here.length > 0) {
      const pos = singletonPos(here)
      return pos === null ? null : { bar: b, pos }
    }
  }
  return null
}

describe('P4c scope — how many of the 30 are duration-only', () => {
  it('classifies every step-grid loss by which axis the emitted document got wrong', () => {
    const tally = { durationOnly: 0, structural: 0, unclassified: 0 }
    const cost = { probed: 0, alive: 0, corrupt: 0 }
    const spell = { integerColumns: 0, subColumn: 0 }
    let n = 0

    for (const mini of minis) {
      if (parseStepGridCore(mini).ok) continue
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      // the probe's parameter is the INTERSECTION so one signature serves both
      // surfaces; the grid arm only ever reaches the grid fields, as elsewhere
      const m = r.model as StepGridModel & PianoRollModel
      const probe = probeEdit(mini, m, GRID_SURFACE)
      if (probe.verdict !== 'corrupt') continue
      n++

      const bars = m.bars ?? 1
      const t = probeTarget(mini, bars)

      // which axis is wrong, bar by bar, against the same expectation the oracle used
      let onsetsAgree = t !== null
      let anyDurDiff = false
      if (t !== null) {
        for (let b = 0; b < bars; b++) {
          const want = enginePlayedCycle(mini, b)
          const got = enginePlayedCycle(probe.out, b)
          if (want === null || got === null) {
            onsetsAgree = false
            break
          }
          const expected =
            b === t.bar
              ? want.filter((x) => Math.round(x.pos * HRES) !== Math.round(t.pos * HRES))
              : want
          if (bag(got, onsetKey) !== bag(expected, onsetKey)) onsetsAgree = false
          if (bag(got, fullKey) !== bag(expected, fullKey)) anyDurDiff = true
        }
      }

      const klass =
        t === null ? 'UNCLASSIFIED' : onsetsAgree && anyDurDiff ? 'DURATION-ONLY' : 'STRUCTURAL'
      if (klass === 'DURATION-ONLY') tally.durationOnly++
      else if (klass === 'STRUCTURAL') tally.structural++
      else tally.unclassified++

      // Can the model's lengths be spelled one-token-per-column? Three conditions,
      // and only the first is about the number: a `_` has to be PLACEABLE too.
      const durs = m.lanes.flatMap((l) => l.cells.filter(isCellOn).map((c) => c.duration))
      const sub = durs.filter((d) => d < 0.999).length
      const nonInt = durs.filter((d) => d >= 0.999 && Math.abs(d - Math.round(d)) > 1e-6).length

      // A covered column that ANOTHER note occupies cannot hold `_` — `[_,b]` is not
      // a sustain, it is a chord with a token that means nothing there.
      // WITHIN THE PART, not across the model: the writer emits each `,`-part from its
      // own lanes (`partColumns`), so a note in part 1 does not block a sustain in
      // part 0 — they are different sequences in the emitted document.
      const perBar = m.steps / (m.bars ?? 1)
      let blocked = 0
      let crossesBar = 0
      for (const l of m.lanes) {
        const peers = m.lanes.filter((o) => (o.part ?? 0) === (l.part ?? 0))
        const on = (c: number) => peers.some((p) => isCellOn(p.cells[c]))
        for (let c = 0; c < m.steps; c++) {
          const cell = l.cells[c]
          if (!isCellOn(cell)) continue
          const d = Math.round(cell.duration)
          if (Math.abs(cell.duration - d) > 1e-6 || d < 1) continue
          for (let k = 1; k < d; k++) if (c + k < m.steps && on(c + k)) blocked++
          if (Number.isInteger(perBar) && Math.floor(c / perBar) !== Math.floor((c + d - 1) / perBar))
            crossesBar++
        }
      }

      const unspellable = sub > 0 || nonInt > 0 || blocked > 0 || crossesBar > 0
      if (unspellable) spell.subColumn++
      else spell.integerColumns++

      // WHAT DECLINING WOULD ACTUALLY COST. The one-note probe files a whole unit as a
      // loss, but a decline is per EDIT: only a write whose region carries an
      // unspellable sustain declines, and every other note in the same view keeps
      // working. So the cost is measured over EVERY cleanly-singleton note, not over
      // units — `alive` is the ceiling on what could go dead, and `corrupt` is what the
      // must-not already forbids today.
      const live = liveness(mini, m as StepGridModel & never, GRID_SURFACE)
      if (unspellable && live) {
        cost.probed += live.probed
        cost.alive += live.alive
        cost.corrupt += live.corrupt
      }
      console.log(
        `   spellability: sub=${sub} nonInt=${nonInt} blocked=${blocked} crossesBar=${crossesBar}` +
          (live ? `  liveness: ${live.alive} alive / ${live.corrupt} corrupt / ${live.probed} probed` : '  liveness: n/a'),
      )

      console.log(
        `\n#${n} ${klass}  ${m.leafSource ? 'LEAF' : 'ELEMENT'}  steps=${m.steps} bars=${bars}` +
          `  lengths: ${sub} sub-column, ${nonInt} non-integer, ${durs.length} total` +
          `\n  in  ${JSON.stringify(mini)}` +
          `\n  out ${JSON.stringify(probe.out)}`,
      )
    }

    console.log(
      `\n===== P4c SCOPE over ${n} step-grid losses =====` +
        `\n  DURATION-ONLY (a length-preserving printer addresses these)  ${tally.durationOnly}` +
        `\n  STRUCTURAL    (onsets/atoms wrong too — P4c does NOT fix)    ${tally.structural}` +
        `\n  UNCLASSIFIED                                                ${tally.unclassified}` +
        `\n  -- and whether the lengths are spellable per column --` +
        `\n  all-integer columns (a '_' per covered column spells it)    ${spell.integerColumns}` +
        `\n  sub-column or non-integer (no per-column token can)         ${spell.subColumn}` +
        `\n  -- over the UNSPELLABLE units, per NOTE (a decline is per edit, not per view) --` +
        `\n  notes probed ${cost.probed} · alive today ${cost.alive} · corrupt today ${cost.corrupt}`,
    )
  })
})
