/**
 * _p4e-roll-locality.spec.ts — INSTRUMENT. The ROLL's half of #1010 P4d, which #1229
 * did not touch and nobody has measured.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_p4e-roll-locality.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ⚠ MEASURED SEPARATELY FROM THE GRID AND EXPECTED TO DISAGREE — #1010 says so, and
 * `projectPianoRollDerived`'s own comment records the two surfaces answering the same
 * flip with OPPOSITE signs (the roll loses ten units of reach where the grid gains
 * five). Nothing here is inferred from the grid's answer.
 *
 * WHAT IT CAN ASK WITHOUT A PRODUCTION CHANGE. `serializePianoRoll` returns bytes and
 * nothing else — there is no `serializePianoRollWithExtent`, so the roll cannot be
 * asked WHICH path answered the way the grid can (that gap is itself a finding). What
 * it can be asked is how much of the document each delete MOVED: a splice that already
 * replaces only the note's own bytes has nothing for surgery to buy, and the width of
 * the changed range is that question, answered from the writer's real output.
 *
 * The delete mirrors `engineEditOracle.deleteFromRoll` — the same clean-singleton
 * target, the same model mutation, through the same writer.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll, parsePianoRollCore } from '../../../editor/src/codeView/notation/parse'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'

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

describe('P4e instrument — the roll, and how local its deletes already are', () => {
  it('counts roll deletes by owner and by how much of the document moved', () => {
    let units = 0
    let asked = 0
    const byOwner = new Map<string, number>()
    const wide: { mini: string; out: string; width: number; owner: string }[] = []
    let localCount = 0

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      units++
      // the first column holding exactly one note — `deleteFromRoll`'s clean target
      const starts = [...new Set(m.notes.map((n) => n.start))].sort((a, b) => a - b)
      const col = starts.find((c) => m.notes.filter((n) => n.start === c).length === 1)
      if (col === undefined) {
        byOwner.set('(no clean single-note target)', (byOwner.get('(no clean single-note target)') ?? 0) + 1)
        continue
      }
      const gone = m.notes.find((n) => n.start === col)!
      const out = serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== gone) })
      const owner = m.leafSource
        ? 'leaf-owned (already byte surgery)'
        : parsePianoRollCore(mini).ok
          ? 'core-opened'
          : 'derived (element)'
      if (out === null) {
        byOwner.set(`${owner} · REFUSED`, (byOwner.get(`${owner} · REFUSED`) ?? 0) + 1)
        continue
      }
      asked++
      const w = changedWidth(mini, out)
      // "local" = the change is no wider than the deleted atom's own text plus the `~`
      // that replaces it, with a byte of slack for a separator
      const budget = String(gone.pitch).length + 3
      if (w <= budget) localCount++
      else wide.push({ mini, out, width: w, owner })
      byOwner.set(`${owner} · ${w <= budget ? 'already local' : 'MOVED MORE'}`, (byOwner.get(`${owner} · ${w <= budget ? 'already local' : 'MOVED MORE'}`) ?? 0) + 1)
    }

    console.log(`\n===== P4e ROLL: (${minis.length} corpus units) =====`)
    console.log(`  units opening a roll:           ${units}`)
    console.log(`  deletes performed:              ${asked}`)
    console.log(`  already local:                  ${localCount}`)
    console.log(`  moved more than the note:       ${wide.length}   <-- the roll's whole prize`)
    console.log(`  -- by owner --`)
    for (const [k, v] of [...byOwner.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    console.log(`\n  -- the widest 25 --`)
    wide
      .sort((a, b) => b.width - a.width)
      .slice(0, 25)
      .forEach((r) => {
        console.log(`     ✗ [${r.owner}] (${r.width}b) ${JSON.stringify(r.mini)}`)
        console.log(`         → ${JSON.stringify(r.out)}`)
      })
    expect(units).toBeGreaterThan(400)
  })
})
