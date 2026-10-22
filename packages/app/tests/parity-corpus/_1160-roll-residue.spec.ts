/**
 * _1160-roll-residue.spec.ts — PROBE (inert). WHY 24 ROLL DELETES ON A SHARED LEAF ARE
 * ACCEPTED, when the grid's equivalent is an exact iff (0).
 *
 * An unexplained residue inside a gate is the shape of claim nobody re-measures, so this
 * names it before it is pinned.
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

describe('#1160 — the roll residue', () => {
  it('names it', () => {
    let residue = 0
    let alsoDuplicated = 0
    let noOp = 0
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
      const byStart = new Map<number, { start: number; end: number }[]>()
      for (const a of ls.anchors) byStart.set(a.start, [...(byStart.get(a.start) ?? []), a.span])
      const cols = new Map<string, Set<number>>()
      for (const [c, spans] of byStart)
        for (const s of spans) {
          const k = `${s.start}:${s.end}`
          cols.set(k, (cols.get(k) ?? new Set<number>()).add(c))
        }
      for (let ni = 0; ni < p.notes.length; ni++) {
        const note = p.notes[ni]
        const shared = ls.anchors
          .filter((a) => a.start === note.start && a.pitch === note.pitch)
          .some((a) => (cols.get(`${a.span.start}:${a.span.end}`)?.size ?? 0) > 1)
        if (!shared) continue
        const dropped = { ...p, notes: p.notes.filter((_, i) => i !== ni) }
        const out = serializePianoRoll(dropped)
        if (out === null) continue
        residue++
        // HYPOTHESIS: another note with the SAME start and pitch survives the drop, so
        // the pitch is never `gone`, every shared anchor asserts its own source bytes,
        // they agree — and the write is accepted having changed nothing.
        const twin = dropped.notes.some((n) => n.start === note.start && n.pitch === note.pitch)
        if (twin) alsoDuplicated++
        if (out === ls.src) noOp++
        if (samples.length < 6)
          samples.push(
            `${note.pitch}@${note.start} twin=${twin} unchanged=${out === ls.src}  ${mini.replace(/\s+/g, ' ').slice(0, 58)}`,
          )
      }
    }
    console.log(`\n  residue (shared leaf, delete ACCEPTED): ${residue}`)
    console.log(`    of which a same-(start,pitch) TWIN survives the drop: ${alsoDuplicated}`)
    console.log(`    of which the document comes back BYTE-UNCHANGED:      ${noOp}`)
    for (const s of samples) console.log(`      ${s}`)
  })
})
