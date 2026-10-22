/**
 * _1160-shared-leaf-delete.spec.ts — PROBE (inert: `_` prefix + `.spec.ts`).
 *
 * CAN YOU DELETE AT ALL ON A LEAF SURFACE? Measured over the whole corpus, on BOTH
 * surfaces, with the refusal site read off the run rather than guessed from the source.
 *
 * #1160 records the grid's half at 275 of 557 asks refusing at `shared-leaf-disagrees`.
 * Two reasons that figure is re-derived here rather than quoted:
 *
 *  - It was measured while diagnosing #1154, on a tree whose writer has since changed
 *    what it can SPELL (rests are now indexed, so a column that had no span has one).
 *    A rate taken before that change describes a writer that no longer exists.
 *  - The issue's own scope line says the ROLL's half was never measured at all. A
 *    design call about whether to split shared tokens rests on both numbers or neither.
 *
 * THE GESTURE, on each surface, exactly as the panel poses it:
 *   grid — open the grid, click one sounding cell OFF, ask the writer
 *   roll — open the roll, drop one note, ask the writer
 * One ask per sounding cell / per note. No re-open, no re-add: this probe is about
 * step one alone, which is what makes it a different question from #1154's.
 *
 * WHAT A SPLIT WOULD COST is measured, not estimated: for every refusal, the shared
 * token is read back out of `leafSource.src` and reported with how many columns it
 * backs. That turns "we would have to re-spell `bd*4`" from a worry into a population.
 *
 * ⚠ REQUIRES TEMPORARY INSTRUMENTATION. `serialize.ts` ships with none. Each `return
 * null` inside `spliceByLeaf`/`spliceRollByLeaf` must be wrapped in a helper that bumps
 * `globalThis.__leafRefusals[why]`; restore the file by checksum afterwards. Without it
 * every refusal reads as an undifferentiated `leaf`, which is the blunt answer three
 * issues in a row have already been misled by.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGridWithExtent,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type {
  StepGridModel,
  PianoRollModel,
  StepCell,
} from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

type Shape = 'leaf' | 'alt' | 'source' | 'bare'
const gridShape = (m: StepGridModel): Shape =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : m.source ? 'source' : 'bare'
const rollShape = (m: PianoRollModel): Shape =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : m.source ? 'source' : 'bare'

const bump = <K,>(m: Map<K, number>, k: K, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by)

/** run a write and report WHICH refusal site fired (empty when it succeeded) */
function ask(run: () => string | null): { mini: string | null; why: string } {
  const g = globalThis as unknown as { __leafRefusals?: Record<string, number> }
  g.__leafRefusals = {}
  const mini = run()
  const sites = Object.keys(g.__leafRefusals)
  g.__leafRefusals = undefined
  if (mini !== null) return { mini, why: '' }
  return { mini: null, why: sites.length > 0 ? sites.join('+') : 'UNINSTRUMENTED' }
}

function withCell(m: StepGridModel, laneIdx: number, col: number, cell: StepCell): StepGridModel {
  const lanes = m.lanes.map((l, i) =>
    i === laneIdx ? { ...l, cells: l.cells.map((c, j) => (j === col ? cell : c)) } : l,
  )
  return { ...m, lanes }
}

/**
 * WHY one token backs several columns — the construct a split would have to rewrite.
 *
 * ⚠ READ FROM AROUND THE SPAN, NEVER FROM THE TOKEN. An anchor's span covers the ATOM
 * and nothing else: in `bd*4` it is the two bytes `bd`, and the `*4` that does the
 * multiplying sits outside it. A first cut of this classifier tested the token text and
 * duly reported that not one refusal in the corpus involved a `*n` — which is what you
 * get for asking the wrong bytes. The operator is the answer, so the operator is what
 * is read: the source immediately following the span, falling back to the enclosing
 * construct when nothing follows.
 */
function sharingCause(src: string, end: number, mini: string): string {
  const after = src.slice(end).match(/^\s*([*!@/:])\s*[\d.]*/)
  if (after) {
    const op = after[1]
    if (op === '*') return 'repeat — `tok*n`'
    if (op === '!') return 'replicate — `tok!n`'
    if (op === '@') return 'hold — `tok@n`'
    if (op === '/') return 'slow — `tok/n`'
    if (op === ':') return 'sample index — `tok:n`'
  }
  // Nothing on the token: the multiplication is done by something ENCLOSING it — a
  // group `[a b]*2`, an alternation replayed across bars, a `slow` outside the mini.
  //
  // WHICH of those is deliberately NOT guessed. The obvious next line — test whether
  // the mini contains a `*` or a `<` anywhere — asks a character that may belong to a
  // construct nowhere near this token, and would hand back a confident split derived
  // from nothing. What the design call needs is the cut this function CAN evidence:
  // is the multiplier on the token (so a split is a local edit) or is it not (so a
  // split means re-authoring notation that encloses it)? That is answered above.
  void mini
  return 'NOT on the token — enclosing construct (which one: undetermined)'
}

interface Tally {
  units: number
  asks: number
  refused: number
  wrote: number
}
const blank = (): Tally => ({ units: 0, asks: 0, refused: 0, wrote: 0 })

describe('#1160 — deleting on a leaf surface, both surfaces, whole corpus', () => {
  it('measures it', () => {
    const gridBy = new Map<Shape, Tally>()
    const rollBy = new Map<Shape, Tally>()
    const gridSite = new Map<string, number>()
    const rollSite = new Map<string, number>()
    /** what a split would have to re-spell, bucketed by how the shared token is written */
    const gridSplitCost = new Map<string, number>()
    const rollSplitCost = new Map<string, number>()
    const gridFanout = new Map<number, number>()
    const rollFanout = new Map<number, number>()
    const gridSamples: string[] = []
    const rollSamples: string[] = []
    /** units in which EVERY delete is refused — the surface is read-only in practice */
    const gridDead = new Set<string>()
    const rollDead = new Set<string>()

    for (const mini of minis) {
      /* ── the GRID's delete ─────────────────────────────────────────────── */
      let g: StepGridModel | null = null
      try {
        const r = parseStepGrid(mini)
        g = r.ok ? r.model : null
      } catch {
        g = null
      }
      if (g && g.lanes.length > 0) {
        const s = gridShape(g)
        if (!gridBy.has(s)) gridBy.set(s, blank())
        const t = gridBy.get(s)!
        t.units++
        const ls = g.leafSource
        // a span backing more than one column IS the shared leaf; derived from the
        // model, so the split cost does not depend on the instrumentation
        const fan = new Map<string, number>()
        if (ls) for (const col of ls.cols) for (const a of col) bump(fan, `${a.span.start}:${a.span.end}`)

        let asksHere = 0
        let wroteHere = 0
        for (let li = 0; li < g.lanes.length; li++) {
          for (let c = 0; c < g.steps; c++) {
            if (!isCellOn(g.lanes[li].cells[c])) continue
            asksHere++
            t.asks++
            const r = ask(() => serializeStepGridWithExtent(withCell(g!, li, c, false)).mini)
            if (r.mini === null) {
              t.refused++
              bump(gridSite, `${s}:${r.why}`)
              if (s === 'leaf' && r.why === 'shared-leaf-disagrees' && ls) {
                for (const a of ls.cols[c] ?? []) {
                  const n = fan.get(`${a.span.start}:${a.span.end}`) ?? 1
                  if (n < 2) continue
                  const tok = ls.src.slice(a.span.start, a.span.end)
                  const ctx = ls.src.slice(a.span.start, a.span.end + 6).replace(/\s+/g, ' ')
                  bump(gridSplitCost, sharingCause(ls.src, a.span.end, mini))
                  bump(gridFanout, n)
                  if (gridSamples.length < 10)
                    gridSamples.push(
                      `${String(n).padStart(2)} cols  \`${tok}\` as written: \`${ctx}\`  in: ${mini.replace(/\s+/g, ' ').slice(0, 54)}`,
                    )
                }
              }
            } else {
              t.wrote++
              wroteHere++
            }
          }
        }
        if (s === 'leaf' && asksHere > 0 && wroteHere === 0) gridDead.add(mini)
      }

      /* ── the ROLL's delete — the half #1160 says was never measured ─────── */
      let p: PianoRollModel | null = null
      try {
        const r = parsePianoRoll(mini)
        p = r.ok ? r.model : null
      } catch {
        p = null
      }
      if (p && p.notes.length > 0) {
        const s = rollShape(p)
        if (!rollBy.has(s)) rollBy.set(s, blank())
        const t = rollBy.get(s)!
        t.units++
        const ls = p.leafSource
        const fan = new Map<string, number>()
        if (ls) for (const a of ls.anchors) bump(fan, `${a.span.start}:${a.span.end}`)

        let asksHere = 0
        let wroteHere = 0
        for (let ni = 0; ni < p.notes.length; ni++) {
          asksHere++
          t.asks++
          const dropped = { ...p, notes: p.notes.filter((_, i) => i !== ni) }
          const r = ask(() => serializePianoRoll(dropped))
          if (r.mini === null) {
            t.refused++
            bump(rollSite, `${s}:${r.why}`)
            if (s === 'leaf' && r.why === 'roll:shared-leaf-disagrees' && ls) {
              const note = p.notes[ni]
              for (const a of ls.anchors) {
                if (a.start !== note.start) continue
                const n = fan.get(`${a.span.start}:${a.span.end}`) ?? 1
                if (n < 2) continue
                const tok = ls.src.slice(a.span.start, a.span.end)
                const ctx = ls.src.slice(a.span.start, a.span.end + 6).replace(/\s+/g, ' ')
                bump(rollSplitCost, sharingCause(ls.src, a.span.end, mini))
                bump(rollFanout, n)
                if (rollSamples.length < 10)
                  rollSamples.push(
                    `${String(n).padStart(2)} notes \`${tok}\` as written: \`${ctx}\`  in: ${mini.replace(/\s+/g, ' ').slice(0, 54)}`,
                  )
              }
            }
          } else {
            t.wrote++
            wroteHere++
          }
        }
        if (s === 'leaf' && asksHere > 0 && wroteHere === 0) rollDead.add(mini)
      }
    }

    const pct = (n: number, d: number): string => (d === 0 ? ' n/a' : `${((n / d) * 100).toFixed(1)}%`)
    const table = (name: string, by: Map<Shape, Tally>): void => {
      console.log(`\n  ${name} — one ask = one delete offered`)
      console.log(`    ${'shape'.padEnd(8)} ${'units'.padStart(6)} ${'asks'.padStart(6)} ${'wrote'.padStart(6)} ${'REFUSED'.padStart(8)} ${'refused%'.padStart(9)}`)
      for (const [s, v] of [...by].sort((a, b) => b[1].asks - a[1].asks))
        console.log(
          `    ${s.padEnd(8)} ${String(v.units).padStart(6)} ${String(v.asks).padStart(6)} ${String(v.wrote).padStart(6)} ${String(v.refused).padStart(8)} ${pct(v.refused, v.asks).padStart(9)}`,
        )
    }

    console.log(`\n  corpus: ${minis.length} unique minis\n`)
    table('THE GRID DELETE', gridBy)
    table('THE ROLL DELETE', rollBy)

    console.log('\n  WHICH SITE REFUSED — GRID (read off the run)')
    for (const [k, n] of [...gridSite].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)
    console.log('\n  WHICH SITE REFUSED — ROLL')
    for (const [k, n] of [...rollSite].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)

    // POSITIVE CONTROLS. A zero in the leaf cohort means nothing unless this probe can
    // be seen accepting a delete somewhere, on the SAME surface, through the same call.
    const gWrote = [...gridBy].filter(([s]) => s !== 'leaf').reduce((a, [, v]) => a + v.wrote, 0)
    const rWrote = [...rollBy].filter(([s]) => s !== 'leaf').reduce((a, [, v]) => a + v.wrote, 0)
    const gLeafWrote = gridBy.get('leaf')?.wrote ?? 0
    const rLeafWrote = rollBy.get('leaf')?.wrote ?? 0
    console.log(`\n  POSITIVE CONTROLS — the probe can see a delete SUCCEED:`)
    console.log(`    grid: ${gWrote} outside the leaf path, ${gLeafWrote} inside it`)
    console.log(`    roll: ${rWrote} outside the leaf path, ${rLeafWrote} inside it`)
    console.log(`    (a zero on either OUTSIDE figure means the instrument is broken, not the delete)`)

    console.log(`\n  WHAT A SPLIT WOULD HAVE TO RE-SPELL — GRID`)
    for (const [k, n] of [...gridSplitCost].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)
    console.log(`    fan-out (columns per shared token):`)
    for (const [k, n] of [...gridFanout].sort((a, b) => a[0] - b[0]))
      console.log(`      ${String(k).padStart(3)} cols → ${n}`)
    for (const s of gridSamples) console.log(`      ${s}`)

    console.log(`\n  WHAT A SPLIT WOULD HAVE TO RE-SPELL — ROLL`)
    for (const [k, n] of [...rollSplitCost].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)
    console.log(`    fan-out (notes per shared token):`)
    for (const [k, n] of [...rollFanout].sort((a, b) => a[0] - b[0]))
      console.log(`      ${String(k).padStart(3)} notes → ${n}`)
    for (const s of rollSamples) console.log(`      ${s}`)

    console.log(
      `\n  UNITS WHERE NO DELETE IS ACCEPTED AT ALL (the surface opens, and nothing on it can be cleared):`,
    )
    console.log(`    grid ${gridDead.size} · roll ${rollDead.size}`)
    for (const m of [...gridDead].slice(0, 6)) console.log(`      [grid] ${m.slice(0, 76)}`)
    for (const m of [...rollDead].slice(0, 6)) console.log(`      [roll] ${m.slice(0, 76)}`)
  })
})
