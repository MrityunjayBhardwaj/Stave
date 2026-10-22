/**
 * _1233-byte-change.spec.ts — INSTRUMENT. What the core-opened attachment actually
 * CHANGES, as distinct from what it answers.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1233-byte-change.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ⚠ WHY THIS EXISTS AND THE CENSUS DOES NOT SUFFICE ([[PV320]]). `writer-reach`'s surgery
 * census counts which WRITER answered each delete, and the overlay changes that for far
 * more units than it changes bytes for — the region splice already copies everything
 * outside the touched element, so most units it takes over were already writing the bytes
 * surgery would write. Measured here, the two differ by roughly an order of magnitude. The
 * census is therefore kept as a FLOOR and this is the CLAIM: a number that only goes up is
 * not a gate.
 *
 * THE ARMS ARE A PAIRED A/B ON ONE TREE, PER UNIT. The same model with `surgical` stripped
 * IS the pre-#1233 writer for that unit — same corpus, same session, same machine state —
 * so neither arm is quoted from anywhere and neither can silently be the same tree twice
 * ([[P546]]: never use a stash as a control arm). Every unit that reaches the comparison
 * is counted in `paired`, so a run in which the attachment silently did not happen reports
 * zero attachments rather than zero benefit.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll, parseStepGridCore, parsePianoRollCore } from '../../../editor/src/codeView/notation/parse'
import type { PianoRollModel, StepGridModel } from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import {
  serializeStepGridWithExtent,
  serializePianoRollWithExtent,
} from '../../../editor/src/codeView/notation/serialize'

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

interface Tally {
  attached: number
  paired: number
  byteChanges: number
  routingOnly: number
  withBytes: number
  withoutBytes: number
  samples: string[]
}
const blank = (): Tally => ({
  attached: 0,
  paired: 0,
  byteChanges: 0,
  routingOnly: 0,
  withBytes: 0,
  withoutBytes: 0,
  samples: [],
})

function show(label: string, t: Tally, coreOnly: Tally) {
  console.log(`\n===== #1233 · ${label} (${minis.length} corpus units) =====`)
  console.log(`  units carrying an overlay:      ${t.attached}   <-- the intervention's own effect`)
  console.log(`  deletes compared in both arms:  ${t.paired}`)
  console.log(`  BYTE CHANGES (the claim):       ${t.byteChanges}`)
  console.log(`  routing-only, same bytes:       ${t.routingOnly}   <-- what the census counts and this does not`)
  console.log(`  on the changed ones: without ${t.withoutBytes} bytes moved, with ${t.withBytes}`)
  console.log(`  of the byte changes, CORE-OPENED (what #1233 adds): ${coreOnly.byteChanges}`)
  t.samples.slice(0, 12).forEach((s) => console.log(s))
}

describe('#1233 instrument — byte changes, not routing', () => {
  it('grid: every delete, with the overlay and with it stripped', () => {
    const all = blank()
    const core = blank()
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      if (m.surgical) all.attached++
      const coreOpened = parseStepGridCore(mini).ok
      for (let col = 0; col < m.steps; col++)
        for (let lane = 0; lane < m.lanes.length; lane++) {
          if (!isCellOn(m.lanes[lane].cells[col])) continue
          const next = toggleCell(m, lane, col, false)
          if (next === m) continue
          const { surgical: _drop, ...stripped } = next
          const withIt = serializeStepGridWithExtent(next)
          const without = serializeStepGridWithExtent(stripped as StepGridModel)
          if (withIt.mini === null || without.mini === null) continue
          for (const t of coreOpened ? [all, core] : [all]) {
            t.paired++
            if (withIt.mini === without.mini) {
              if (withIt.extent.path !== without.extent.path) t.routingOnly++
              continue
            }
            t.byteChanges++
            t.withBytes += changedWidth(mini, withIt.mini)
            t.withoutBytes += changedWidth(mini, without.mini)
            if (t === all && t.samples.length < 12)
              t.samples.push(
                `     ✗ ${JSON.stringify(mini).slice(0, 90)}\n         without → ${JSON.stringify(without.mini).slice(0, 90)}\n         with    → ${JSON.stringify(withIt.mini).slice(0, 90)}`,
              )
          }
        }
    }
    show('GRID', all, core)
    expect(all.attached, 'no overlay was attached — the arms are the same tree twice').toBeGreaterThan(0)
  })

  it('roll: the same, on the surface #1232 shipped the derived half of', () => {
    const all = blank()
    const core = blank()
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      if (m.surgical) all.attached++
      const coreOpened = parsePianoRollCore(mini).ok
      for (const gone of m.notes) {
        const kept = m.notes.filter((n) => n !== gone)
        const next = { ...m, notes: kept }
        const { surgical: _drop, ...stripped } = next
        const withIt = serializePianoRollWithExtent(next as PianoRollModel)
        const without = serializePianoRollWithExtent(stripped as PianoRollModel)
        if (withIt.mini === null || without.mini === null) continue
        for (const t of coreOpened ? [all, core] : [all]) {
          t.paired++
          if (withIt.mini === without.mini) {
            if (withIt.extent.path !== without.extent.path) t.routingOnly++
            continue
          }
          t.byteChanges++
          t.withBytes += changedWidth(mini, withIt.mini)
          t.withoutBytes += changedWidth(mini, without.mini)
          if (t === all && t.samples.length < 12)
            t.samples.push(
              `     ✗ ${JSON.stringify(mini).slice(0, 90)}\n         without → ${JSON.stringify(without.mini).slice(0, 90)}\n         with    → ${JSON.stringify(withIt.mini).slice(0, 90)}`,
            )
        }
      }
    }
    show('ROLL', all, core)
    expect(all.attached, 'no overlay was attached — the arms are the same tree twice').toBeGreaterThan(0)
  })
})
