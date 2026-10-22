/**
 * _1164-panel-gesture.spec.ts — PROBE (inert). DOES #1164 EXIST ON THE GESTURE THE PANEL
 * ACTUALLY PERFORMS?
 *
 * #1164's measurement, and every re-derivation of it including my own, drops ONE note by
 * index: `notes.filter((_, i) => i !== ni)`. `PianoRollGrid` does not do that. Its delete
 * is keyed on the CELL, and a cell is a (pitch, start) pair:
 *
 *     notes: prev.notes.filter((n) => !(n.pitch === sel.pitch && n.start === sel.start))
 *
 * A unison is two notes sharing exactly that key, so the real gesture removes BOTH at
 * once — and then the pitch does leave the comparison, `gone` fires, and the anchors are
 * blanked. If that is so, the silent no-op is an artefact of the by-index model and is
 * never reachable by clicking.
 *
 * Run on a tree WITHOUT the fix: the question is whether the ORIGINAL bug is reachable.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = [
  ...new Set((corpus.minis as { mini: string }[]).map((o) => o.mini.trim()).filter((m) => m !== '')),
]

describe('#1164 — the panel gesture vs the by-index model', () => {
  it('compares them over every unison cell', () => {
    let unisonCells = 0
    let byIndexNoOp = 0
    let byIndexRefused = 0
    let byIndexWrote = 0
    let panelNoOp = 0
    let panelRefused = 0
    let panelWrote = 0
    const samples: string[] = []

    for (const mini of minis) {
      let p
      try {
        const r = parsePianoRoll(mini)
        p = r.ok ? r.model : null
      } catch {
        p = null
      }
      const ls = p?.leafSource
      if (!p || !ls || p.notes.length === 0) continue

      // every CELL that holds more than one note — the unison cells
      const cells = new Map<string, { start: number; pitch: string; n: number }>()
      for (const n of p.notes) {
        const k = `${n.start} ${n.pitch}`
        const c = cells.get(k) ?? { start: n.start, pitch: n.pitch, n: 0 }
        c.n++
        cells.set(k, c)
      }
      for (const c of cells.values()) {
        if (c.n < 2) continue
        unisonCells++

        // THE PANEL'S gesture: remove every note at this cell
        const panel = serializePianoRoll({
          ...p,
          notes: p.notes.filter((n) => !(n.pitch === c.pitch && n.start === c.start)),
        })
        if (panel === null) panelRefused++
        else if (panel === ls.src) panelNoOp++
        else panelWrote++

        // THE BY-INDEX model the issue measured: drop just one of them
        const ni = p.notes.findIndex((n) => n.pitch === c.pitch && n.start === c.start)
        const byIndex = serializePianoRoll({ ...p, notes: p.notes.filter((_, i) => i !== ni) })
        if (byIndex === null) byIndexRefused++
        else if (byIndex === ls.src) byIndexNoOp++
        else byIndexWrote++

        const show = (v: string | null): string =>
          v === null ? 'REFUSED' : v === ls.src ? 'NO-OP' : JSON.stringify(v)
        if (samples.length < 5)
          samples.push(
            [
              `start=${c.start} pitch=${c.pitch} notes=${c.n}`,
              `        panel   -> ${show(panel)}`,
              `        byIndex -> ${show(byIndex)}`,
              `        src: ${JSON.stringify(ls.src)}`,
            ].join('\n'),
          )
      }
    }

    console.log(`\n  unison CELLS (what a user can actually click): ${unisonCells}`)
    console.log(`\n  THE PANEL GESTURE (remove every note at the cell):`)
    console.log(`    wrote: ${panelWrote}   refused: ${panelRefused}   SILENT NO-OP: ${panelNoOp}`)
    console.log(`\n  THE BY-INDEX MODEL (#1164's measurement — drop one):`)
    console.log(`    wrote: ${byIndexWrote}   refused: ${byIndexRefused}   SILENT NO-OP: ${byIndexNoOp}`)
    console.log(`\n  samples:`)
    for (const s of samples) console.log(`    ${s}`)
  })
})
