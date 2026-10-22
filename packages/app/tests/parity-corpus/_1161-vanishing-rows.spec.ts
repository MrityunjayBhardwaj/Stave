/**
 * _1161-vanishing-rows.spec.ts — PROBE (inert: `_` prefix + `.spec.ts`).
 *
 * WHEN A DELETE TAKES AWAY THE ROW YOU WOULD CLICK BACK ON — measured on BOTH surfaces,
 * because the answer turns out to be different on each, and the difference is the design.
 *
 * #1161 measured the grid: clearing a lane's last sounding cell removes the LANE, because
 * a lane is drawn for a sound the document mentions and the document no longer mentions
 * it. 1345 asks, larger than every refusal class combined. Its scope line says the roll
 * was not measured — the same gap that doubled #1160's population.
 *
 * ⚠ BUT THE ROLL IS NOT SIMPLY THE SAME QUESTION, because the roll ALREADY CARRIES THE
 * MECHANISM #1161 IS ASKING FOR. `PianoRollGrid.tsx` keeps a STICKY pitch range: it
 * expands to fit the notes, never shrinks within a statement binding, and reseeds when
 * the statement changes (#391, #597). So a deleted note's row stays on screen even after
 * the content range around it has collapsed. The grid has no equivalent — grep says
 * 4 mentions of sticky in the roll panel, 0 in the sequencer panel.
 *
 * That makes this probe's job to measure THREE things, not one:
 *   1. the grid's population, re-derived on the current tree (the issue's figure predates
 *      #1154 and #1160, and a rate measured on a tree whose writer has changed is not
 *      this tree's rate);
 *   2. what the roll's sticky range SAVES — how many deletes would drop the note's row out
 *      of the display if the range were recomputed from content each time. This is the
 *      positive control that the mechanism is load-bearing rather than decorative;
 *   3. that with the sticky rule applied the roll's number is zero, which is the shape the
 *      grid should be made to match.
 *
 * ✅ THE RE-IMPLEMENTATION IS GONE (#1163 fixed). This probe used to carry a third copy of
 * the panel's private padding rule, because the function and its constants were
 * module-private to `PianoRollGrid.tsx` and nothing outside the panel could ask the real
 * one. `rollContentRange` in `notation/model.ts` now owns it, so this asks the real rule
 * and the figures below are about the panel rather than about a copy of it. The one
 * remaining restatement is in `placement-admissibility.test.ts`, kept deliberately as a
 * control arm and labelled there.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll, parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import {
  serializePianoRoll,
  serializeStepGrid,
} from '../../../editor/src/codeView/notation/serialize'
import { isCellOn, rollContentRange } from '../../../editor/src/codeView/notation/model'
import { pitchToMidi } from '../../../editor/src/codeView/notation/pitch'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = [
  ...new Set((corpus.minis as { mini: string }[]).map((o) => o.mini.trim()).filter((m) => m !== '')),
]

type Path = 'leaf' | 'alt' | 'source'
const pathOf = (m: { leafSource?: unknown; altSource?: unknown }): Path =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : 'source'

/** the panel's own rule, asked rather than restated (#1163) */
const contentRange = (notes: { pitch: string }[]): { lo: number; hi: number } =>
  rollContentRange({ notes })

const laneKey = (l: { sound: string; part?: number }): string => `${l.sound}#${l.part ?? 0}`
const bump = <K,>(m: Map<K, number>, k: K): void => void m.set(k, (m.get(k) ?? 0) + 1)

describe('#1161 — the row that is not there to click back on', () => {
  it('measures it, on both surfaces', () => {
    /* ── THE GRID: does the lane survive its last note? ─────────────────── */
    const gAsks = new Map<Path, number>()
    const gVanished = new Map<Path, number>()
    const gRefused = new Map<Path, number>()
    const gUnits = new Map<Path, number>()
    const gVanishUnits = new Set<string>()
    const gSamples: string[] = []

    /* ── THE ROLL: does the row survive, with and without the sticky range? ─ */
    const rAsks = new Map<Path, number>()
    const rOutWithout = new Map<Path, number>() // row falls outside a recomputed range
    const rOutWith = new Map<Path, number>() // ... outside the sticky (never-shrinking) one
    const rRefused = new Map<Path, number>()
    const rUnits = new Map<Path, number>()
    const rSamples: string[] = []

    for (const mini of minis) {
      /* ---- grid ---- */
      let g: StepGridModel | null = null
      try {
        const r = parseStepGrid(mini)
        g = r.ok ? r.model : null
      } catch {
        g = null
      }
      if (g && g.lanes.length > 0) {
        const p = pathOf(g)
        bump(gUnits, p)
        for (let li = 0; li < g.lanes.length; li++) {
          const lane = g.lanes[li]
          for (let c = 0; c < g.steps; c++) {
            if (!isCellOn(lane.cells[c])) continue
            bump(gAsks, p)
            const lanes = g.lanes.map((l, i) =>
              i === li ? { ...l, cells: l.cells.map((cell, j) => (j === c ? false : cell)) } : l,
            )
            const out = serializeStepGrid({ ...g, lanes })
            if (out === null) {
              bump(gRefused, p)
              continue
            }
            // re-open on what was written — what the panel actually does after a write
            let after: StepGridModel | null = null
            try {
              const r = parseStepGrid(out)
              after = r.ok ? r.model : null
            } catch {
              after = null
            }
            if (!after) continue
            if (!after.lanes.some((l) => laneKey(l) === laneKey(lane))) {
              bump(gVanished, p)
              gVanishUnits.add(mini)
              if (gSamples.length < 8)
                gSamples.push(
                  `${laneKey(lane).padEnd(10)} ${mini.replace(/\s+/g, ' ').slice(0, 46)}  →  ${out.replace(/\s+/g, ' ').slice(0, 40)}`,
                )
            }
          }
        }
      }

      /* ---- roll ---- */
      let r0: PianoRollModel | null = null
      try {
        const r = parsePianoRoll(mini)
        r0 = r.ok ? r.model : null
      } catch {
        r0 = null
      }
      if (r0 && r0.notes.length > 0) {
        const p = pathOf(r0)
        bump(rUnits, p)
        // the range the panel is showing BEFORE the delete — what stickiness preserves
        const before = contentRange(r0.notes)
        for (let ni = 0; ni < r0.notes.length; ni++) {
          bump(rAsks, p)
          const note = r0.notes[ni]
          const midi = pitchToMidi(note.pitch)
          if (midi === null) continue
          const dropped = { ...r0, notes: r0.notes.filter((_, i) => i !== ni) }
          const out = serializePianoRoll(dropped)
          if (out === null) {
            bump(rRefused, p)
            continue
          }
          let after: PianoRollModel | null = null
          try {
            const rr = parsePianoRoll(out)
            after = rr.ok ? rr.model : null
          } catch {
            after = null
          }
          if (!after) continue
          // WITHOUT stickiness: the range is recomputed from what is left
          const fresh = contentRange(after.notes)
          const outside = midi < fresh.lo || midi > fresh.hi
          if (outside) {
            bump(rOutWithout, p)
            if (rSamples.length < 8)
              rSamples.push(
                `${note.pitch}(${midi}) fresh=[${fresh.lo},${fresh.hi}] sticky=[${before.lo},${before.hi}]  ${mini.replace(/\s+/g, ' ').slice(0, 40)}`,
              )
          }
          // WITH the panel's rule: expand to fit, never shrink within the statement
          const sticky = { lo: Math.min(before.lo, fresh.lo), hi: Math.max(before.hi, fresh.hi) }
          if (midi < sticky.lo || midi > sticky.hi) bump(rOutWith, p)
        }
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? ' n/a' : `${((n / d) * 100).toFixed(1)}%`)
    const row = (k: Path, a: Map<Path, number>, v: Map<Path, number>, u: Map<Path, number>, rf: Map<Path, number>): string =>
      `    ${k.padEnd(8)} ${String(u.get(k) ?? 0).padStart(6)} ${String(a.get(k) ?? 0).padStart(6)} ${String(rf.get(k) ?? 0).padStart(8)} ${String(v.get(k) ?? 0).padStart(9)} ${pct(v.get(k) ?? 0, a.get(k) ?? 0).padStart(8)}`

    console.log(`\n  corpus: ${minis.length} unique minis`)

    console.log(`\n  THE GRID — clearing a cell, then re-opening: is the LANE still drawn?`)
    console.log(`    ${'path'.padEnd(8)} ${'units'.padStart(6)} ${'asks'.padStart(6)} ${'refused'.padStart(8)} ${'VANISHED'.padStart(9)} ${'rate'.padStart(8)}`)
    let gTot = 0
    for (const k of ['source', 'leaf', 'alt'] as Path[]) {
      console.log(row(k, gAsks, gVanished, gUnits, gRefused))
      gTot += gVanished.get(k) ?? 0
    }
    console.log(`    TOTAL lanes vanished: ${gTot}   across ${gVanishUnits.size} units`)
    for (const s of gSamples) console.log(`      ${s}`)

    console.log(`\n  THE ROLL — dropping a note: is its PITCH ROW still on screen?`)
    console.log(`    (the roll keeps a sticky range — expand to fit, never shrink within a statement)`)
    console.log(`    ${'path'.padEnd(8)} ${'units'.padStart(6)} ${'asks'.padStart(6)} ${'refused'.padStart(8)} ${'GONE-no-sticky'.padStart(15)} ${'GONE-sticky'.padStart(12)}`)
    let rTotWithout = 0
    let rTotWith = 0
    for (const k of ['source', 'leaf', 'alt'] as Path[]) {
      console.log(
        `    ${k.padEnd(8)} ${String(rUnits.get(k) ?? 0).padStart(6)} ${String(rAsks.get(k) ?? 0).padStart(6)} ${String(rRefused.get(k) ?? 0).padStart(8)} ${String(rOutWithout.get(k) ?? 0).padStart(15)} ${String(rOutWith.get(k) ?? 0).padStart(12)}`,
      )
      rTotWithout += rOutWithout.get(k) ?? 0
      rTotWith += rOutWith.get(k) ?? 0
    }
    console.log(`    TOTAL rows that would vanish WITHOUT the sticky range: ${rTotWithout}`)
    console.log(`    TOTAL rows that vanish WITH it:                        ${rTotWith}`)
    for (const s of rSamples) console.log(`      ${s}`)

    console.log(`\n  WHAT THIS SAYS`)
    console.log(`    grid: ${gTot} asks lose the row. No sticky mechanism exists on that surface.`)
    console.log(`    roll: ${rTotWithout} would lose it; ${rTotWith} do. The difference is the mechanism,`)
    console.log(`          and it is the same rule #1161 proposes for the grid, already shipped since #391.`)
  })
})
