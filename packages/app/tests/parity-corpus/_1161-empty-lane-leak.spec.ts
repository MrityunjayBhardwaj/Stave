/**
 * _1161-empty-lane-leak.spec.ts — PROBE (inert).
 *
 * THE ONE QUESTION THE WHOLE FIX RESTS ON: is a lane with no sounding cell invisible to
 * the writer?
 *
 * #1161's fix keeps a just-emptied lane on screen so the note can be clicked back. The
 * cheapest way to do that is to leave the lane in `model.lanes` with every cell off, so
 * indices, clicks and gestures all keep working uniformly. That is only safe if such a
 * lane contributes NOTHING to the document — otherwise the panel would author an extra
 * `~ ~ ~ ~` comma-part into notation the user wrote, which is the line the whole
 * write-back mechanism exists not to cross.
 *
 * Measured rather than reasoned from reading `columnAtoms`: for every corpus unit that
 * opens a grid, serialize the model as parsed, then serialize it again with one extra
 * all-off lane appended, and compare BYTES. If they are identical everywhere, the
 * invariant holds by construction and the fix needs no stripping step. If they differ
 * anywhere, the surplus must be stripped at the write boundary and this probe says where.
 *
 * The control arm matters as much as the result: an extra lane carrying a SOUNDING cell
 * must change the bytes, or the comparison is measuring nothing.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'
import { cellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = [
  ...new Set((corpus.minis as { mini: string }[]).map((o) => o.mini.trim()).filter((m) => m !== '')),
]

const pathOf = (m: StepGridModel): string =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : m.source ? 'source' : 'bare'

describe('#1161 — is an all-off lane invisible to the writer?', () => {
  it('measures it', () => {
    const same = new Map<string, number>()
    const differs = new Map<string, number>()
    const ctrlChanged = new Map<string, number>()
    const ctrlSame = new Map<string, number>()
    const samples: string[] = []

    for (const mini of minis) {
      let m: StepGridModel | null = null
      try {
        const r = parseStepGrid(mini)
        m = r.ok ? r.model : null
      } catch {
        m = null
      }
      if (!m || m.lanes.length === 0) continue
      const p = pathOf(m)
      const base = serializeStepGrid(m)
      if (base === null) continue

      // THE ASK: one extra lane, every cell off — what a just-emptied lane looks like
      const ghost = {
        ...m,
        lanes: [...m.lanes, { ...m.lanes[0], sound: '__ghost__', cells: m.lanes[0].cells.map(() => false as const) }],
      }
      const withGhost = serializeStepGrid(ghost)
      const key = `${p}`
      if (withGhost === base) same.set(key, (same.get(key) ?? 0) + 1)
      else {
        differs.set(key, (differs.get(key) ?? 0) + 1)
        if (samples.length < 8)
          samples.push(
            `[${p}] ${mini.replace(/\s+/g, ' ').slice(0, 42)}\n           base: ${String(base).replace(/\s+/g, ' ').slice(0, 52)}\n          ghost: ${String(withGhost).replace(/\s+/g, ' ').slice(0, 52)}`,
          )
      }

      // CONTROL: the same extra lane, but SOUNDING. If this does not change the bytes,
      // the comparison above is blind and its agreement means nothing.
      const loud = {
        ...m,
        lanes: [
          ...m.lanes,
          {
            ...m.lanes[0],
            sound: '__ghost__',
            cells: m.lanes[0].cells.map((_, i) => (i === 0 ? cellOn(1) : (false as const))),
          },
        ],
      }
      const withLoud = serializeStepGrid(loud)
      if (withLoud !== base) ctrlChanged.set(key, (ctrlChanged.get(key) ?? 0) + 1)
      else ctrlSame.set(key, (ctrlSame.get(key) ?? 0) + 1)
    }

    console.log(`\n  AN ALL-OFF LANE APPENDED TO THE MODEL — do the written bytes change?`)
    console.log(`    ${'path'.padEnd(8)} ${'identical'.padStart(10)} ${'DIFFERS'.padStart(9)}`)
    for (const p of ['source', 'leaf', 'alt', 'bare'])
      if ((same.get(p) ?? 0) + (differs.get(p) ?? 0) > 0)
        console.log(`    ${p.padEnd(8)} ${String(same.get(p) ?? 0).padStart(10)} ${String(differs.get(p) ?? 0).padStart(9)}`)

    console.log(`\n  CONTROL — the same lane but SOUNDING (must change the bytes, or the above is blind)`)
    console.log(`    ${'path'.padEnd(8)} ${'changed'.padStart(10)} ${'unchanged'.padStart(10)}`)
    for (const p of ['source', 'leaf', 'alt', 'bare'])
      if ((ctrlChanged.get(p) ?? 0) + (ctrlSame.get(p) ?? 0) > 0)
        console.log(`    ${p.padEnd(8)} ${String(ctrlChanged.get(p) ?? 0).padStart(10)} ${String(ctrlSame.get(p) ?? 0).padStart(10)}`)

    if (samples.length > 0) {
      console.log(`\n  WHERE IT LEAKS:`)
      for (const s of samples) console.log(`      ${s}`)
    }
  })
})
