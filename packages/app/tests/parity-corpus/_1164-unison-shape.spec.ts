/**
 * _1164-unison-shape.spec.ts — PROBE (inert). WHAT SHAPE ARE THE 24?
 *
 * #1164 is settled as to CAUSE (`after` is a SET, so a unison's twin keeps the pitch
 * present and nothing enters `gone`) and unsettled as to FIX. The issue names two
 * candidates and declines to choose: carry the multiplicity (make the pitch comparison a
 * multiset, as the DURATION check at the same site already is), or refuse.
 *
 * Carrying the multiplicity is only well defined if the writer can say WHICH anchor the
 * user dropped. Two `,`-stacked parts at one column and one pitch have two disjoint leaf
 * spans; blanking the wrong one writes a different document. The duration multiset check
 * immediately above already distinguishes anchors by length, so:
 *
 *   - unison pair with DISTINCT durations  → the dropped note is identifiable, the fix is
 *                                            determined, and the existing check already
 *                                            computes the matching
 *   - unison pair with EQUAL durations     → the two anchors are interchangeable in the
 *                                            model; either choice is audibly identical and
 *                                            produces a DIFFERENT document. That is a
 *                                            coin flip written into the user's file.
 *
 * The split between those two decides whether "carry the multiplicity" is a principled
 * fix or an arbitrary one, so it is measured before anything is proposed. Measured, not
 * argued: reading the site cannot say how the real corpus is distributed.
 *
 * ⚠ READ `_1164-panel-gesture.spec.ts` FIRST — IT OVERTAKES THIS ONE. The split below is
 * real, and it is a fact about a gesture nobody performs. `PianoRollGrid` deletes by CELL,
 * removing every note at a (pitch, start); a unison is two notes sharing exactly that key,
 * so the real click removes both and the pitch leaves the comparison normally. Over the
 * corpus, the panel's gesture produces ZERO silent no-ops. Everything here is measured
 * by-index, which is #1164's own model and not the app's.
 *
 * Kept because the population figures are still the ones a fix would have to move, and
 * because the 28-vs-24 reconciliation (the issue inherited #1160's shared-leaf filter,
 * which is not this cause) is worth not re-deriving.
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

describe('#1164 — the shape of the 24', () => {
  it('splits them by whether the dropped note is identifiable', () => {
    // CROSS-TABULATED shared × duration-distinguishable. The gate counts only the SHARED
    // half (a leaf backing more than one distinct column); a first cut of this probe
    // omitted that filter and came out 28 against the gate's 24. The 4 are reconciled
    // here rather than explained away — [[P470]]: two implementations disagreeing is the
    // finding, and the same file already carries a `*<…>`-shaped instance of it.
    const cell = { sharedDistinct: 0, sharedEqual: 0, loneDistinct: 0, loneEqual: 0 }
    let residue = 0
    let rawUnisonAsks = 0
    let leafUnits = 0
    let totalNotes = 0
    const units = new Set<string>()
    const anchorCounts = new Map<number, number>()
    const samples: string[] = []
    // CONTROL: the same sweep counting deletes that are REFUSED, so a zero in any
    // bucket above is distinguishable from a sweep that never reached the branch.
    let refused = 0

    const fanoutOf = (perStart: { start: number; end: number }[][]): Map<string, number> => {
      const cols = new Map<string, Set<number>>()
      perStart.forEach((spans, c) => {
        for (const s of spans) {
          const k = `${s.start}:${s.end}`
          const seen = cols.get(k) ?? new Set<number>()
          seen.add(c)
          cols.set(k, seen)
        }
      })
      return new Map([...cols].map(([k, seen]) => [k, seen.size]))
    }

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
      leafUnits++
      totalNotes += p.notes.length

      const byStart = new Map<number, { start: number; end: number }[]>()
      for (const a of ls.anchors) byStart.set(a.start, [...(byStart.get(a.start) ?? []), a.span])
      const fan = fanoutOf([...byStart.values()])

      for (let ni = 0; ni < p.notes.length; ni++) {
        const note = p.notes[ni]
        // the anchors that sound this pitch at this column — the candidates to blank
        const cands = ls.anchors.filter((a) => a.start === note.start && a.pitch === note.pitch)
        const shared = cands.some((a) => (fan.get(`${a.span.start}:${a.span.end}`) ?? 0) > 1)
        if (cands.length >= 2) rawUnisonAsks++
        const dropped = { ...p, notes: p.notes.filter((_, i) => i !== ni) }
        const out = serializePianoRoll(dropped)
        if (out === null) {
          refused++
          continue
        }
        // the residue: a same-(start,pitch) twin survives the drop AND the bytes are
        // unchanged. Compared against `ls.src`, which is what the gate compares against.
        const twin = dropped.notes.some((n) => n.start === note.start && n.pitch === note.pitch)
        if (!twin || out !== ls.src) continue
        residue++
        units.add(mini)

        anchorCounts.set(cands.length, (anchorCounts.get(cands.length) ?? 0) + 1)
        const durs = cands.map((a) => a.duration)
        const allEqual = durs.every((d) => d === durs[0])
        if (shared) allEqual ? cell.sharedEqual++ : cell.sharedDistinct++
        else allEqual ? cell.loneEqual++ : cell.loneDistinct++

        // sample the LONE bucket preferentially — it is the one the issue never counted,
        // and the only one where the choice of anchor is genuinely arbitrary
        if (!shared || samples.length < 4)
          samples.push(
            `${shared ? 'SHARED' : 'lone  '} ${allEqual ? 'EQUAL   ' : 'DISTINCT'} start=${note.start} pitch=${note.pitch} durs=[${durs.join(',')}] anchors=${cands.length}  ${mini.slice(0, 70)}`,
          )
      }
    }

    console.log(`\n  ADMISSION: leaf roll units=${leafUnits} notes=${totalNotes}`)
    console.log(`  RAW asks whose note has >=2 anchors: ${rawUnisonAsks}`)
    console.log(`  residue, ALL of it (accepted + twin survives + bytes unchanged): ${residue}`)
    console.log(`  refused deletes (control — the branch is reachable):            ${refused}`)
    console.log(`  distinct corpus units carrying it:                              ${units.size}`)
    console.log(`\n  RECONCILED AGAINST THE GATE (which counts the SHARED row only):`)
    console.log(`                      duration DISTINCT   duration EQUAL`)
    console.log(`    leaf SHARED  →         ${String(cell.sharedDistinct).padStart(3)}              ${String(cell.sharedEqual).padStart(3)}      = gate's 24?`)
    console.log(`    leaf lone    →         ${String(cell.loneDistinct).padStart(3)}              ${String(cell.loneEqual).padStart(3)}      = outside the gate`)
    console.log(`\n  anchors at the (start,pitch): ${JSON.stringify([...anchorCounts])}`)
    console.log(`\n  samples:`)
    for (const s of samples) console.log(`    ${s}`)
  })
})
