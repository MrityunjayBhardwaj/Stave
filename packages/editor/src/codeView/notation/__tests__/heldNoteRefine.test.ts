/**
 * #1120 — a pattern with held notes can be looked at more closely.
 *
 * The printer spells a length as `_` sustain in the step sequence, and above
 * `div === 1` that sequence is chopped into `[…]` groups. Refining is exactly what
 * raises `div`, so every note longer than one column needed a `_` in first position —
 * meaningless there — and the whole class refused a finer view. `stackedRegion` writes
 * those regions as a `,`-stack of flat per-sound parts instead.
 *
 * Measured over the corpus before the fix: 16 refused asks across 6 units, all on that
 * one guard, and 0 on the piano roll (whose notes carry a duration natively).
 */
import { describe, it, expect } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid } from '../parse'
import { serializeStepGrid } from '../serialize'
import { cellOn } from '../model'

interface H {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
  part: { begin: { valueOf(): number } }
  value: unknown
}

/** what Strudel actually PLAYS: onset + length per note, sorted. The invariant is the
 *  haps, never the spelling the writer happened to choose. */
function onsets(src: string): string {
  const pat = reifyMini(src) as { queryArc(a: number, b: number): H[] }
  return pat
    .queryArc(0, 1)
    .filter((h) => h.whole && Number(h.whole.begin.valueOf()) === Number(h.part.begin.valueOf()))
    .map((h) => {
      const b = Number(h.whole!.begin.valueOf())
      const e = Number(h.whole!.end.valueOf())
      const v = h.value as { s?: string; note?: string } | string
      const tok = typeof v === 'string' ? v : (v.s ?? v.note ?? JSON.stringify(v))
      return `${tok}@${b.toFixed(4)}+${(e - b).toFixed(4)}`
    })
    .sort()
    .join('  ')
}

/** every corpus unit that refused a finer view for this reason, plus the shapes
 *  from the issue. `bd _ ~ ~ …` is the length-preserving printer's own output. */
const HELD = [
  'bd@2 cp bd@3 cp@3 bd cp@2 bd bd cp@2',
  'bd _ ~ ~ sn _ ~ ~',
  'bd@2 sn cp',
  '[c2, ds3, as3, d4]@3 [ds2, g3, as3, e4] [d3, f3, c4, e3]@3[cs2, g3, b3, f4]',
  'E2@3 E2@3 E2@3 E2@3 E2@2 E2@2',
]

describe('#1120 — held notes can be refined', () => {
  it('every held-note unit that used to refuse now draws at twice its columns', () => {
    for (const m of HELD) {
      const doc = parseStepGrid(m)
      expect(doc.ok, `${m} must open at its own resolution`).toBe(true)
      if (!doc.ok) continue
      const fine = parseStepGrid(m, 2)
      expect(fine.ok, `${m} must offer a finer view`).toBe(true)
      if (!fine.ok) continue
      expect(fine.model.steps, m).toBe(doc.model.steps * 2)
    }
  })

  it('CONTROL ARM — a pattern with no held note is unaffected', () => {
    // this one refined before the change too, so it proves the fix is scoped rather
    // than that the suite runs
    const fine = parseStepGrid('bd sn cp bd', 2)
    expect(fine.ok).toBe(true)
    if (!fine.ok) return
    expect(fine.model.steps).toBe(8)
    expect(serializeStepGrid(fine.model)).toBe('bd sn cp bd')
  })

  it('refining alone still writes NOTHING — the document comes back byte-identical', () => {
    // the free zone's whole promise: looking more closely must not rewrite the file
    for (const m of HELD) {
      const fine = parseStepGrid(m, 2)
      expect(fine.ok, m).toBe(true)
      if (!fine.ok) continue
      expect(serializeStepGrid(fine.model), m).toBe(m)
    }
  })

  it('an edit in a column the document could not address lands, and moves nothing else', () => {
    const SRC = 'bd@2 sn cp'
    const fine = parseStepGrid(SRC, 2)
    expect(fine.ok).toBe(true)
    if (!fine.ok) return

    // drawn column 1 is inside the held bd's own span and has no spelling at the
    // document's 4 columns — it exists only because the view is refined
    const lanes = fine.model.lanes.map((l) => ({ ...l, cells: [...l.cells] }))
    lanes[1].cells[1] = cellOn()
    const out = serializeStepGrid({ ...fine.model, lanes })
    expect(out).toBe('[bd _ _ _, ~ sn ~ ~]@2 sn cp')

    // …and the ENGINE agrees: bd keeps its length, the two untouched notes keep
    // their onsets, and the new note is one fine column long
    expect(onsets(out!)).toBe(
      'bd@0.0000+0.5000  cp@0.7500+0.2500  sn@0.1250+0.1250  sn@0.5000+0.2500',
    )
    expect(onsets(SRC)).toBe('bd@0.0000+0.5000  cp@0.7500+0.2500  sn@0.5000+0.2500')
  })

  it('a CHORD region survives an edit through the stacked path', () => {
    // the stacked form gives every sound its own part, so a chord that the flat sheet
    // wrote as one `[a,b]` cell token comes back as separate parts. That is a genuinely
    // different shape, and the corpus unit that exercises it is a four-note chord — so
    // the property is asserted where it actually lives, in what Strudel plays.
    const SRC = '[c2, ds3]@2 e3 g3'
    const fine = parseStepGrid(SRC, 2)
    expect(fine.ok).toBe(true)
    if (!fine.ok) return

    const before = onsets(SRC)
    const lanes = fine.model.lanes.map((l) => ({ ...l, cells: [...l.cells] }))
    lanes[2].cells[1] = cellOn() // a fine column inside the held chord's span
    const out = serializeStepGrid({ ...fine.model, lanes })
    expect(out, 'the chord region must be writable').not.toBeNull()

    const after = onsets(out!)
    // every note that was already there keeps its onset AND its length
    for (const note of before.split('  ')) expect(after, `${note} must survive`).toContain(note)
    // …and exactly one note was added
    expect(after.split('  ').length).toBe(before.split('  ').length + 1)
  })

  it('ASSERTS STRUDEL, NOT US — the obvious one-level-up spelling elongates the group', () => {
    // ⚠ THIS CLAUSE PROVES NOTHING ABOUT THE FIX, and is named so nobody reads it as
    // coverage: it stays green with `stackedRegion` removed, because it only queries
    // the engine. It is here to record WHY the spelling is what it is, so the fix
    // cannot be "simplified" back into the bug.
    //
    // `[bd _, zz ~] _` reads like the same idea applied to the step sequence. It is
    // not: a trailing `_` elongates the whole GROUP, so the one-column note comes
    // back at twice the length.
    const stacked = onsets('[bd _ _ _, zz ~ ~ ~]@2 sn cp')
    const naive = onsets('[bd _, zz ~] _ sn cp')
    expect(stacked).toContain('zz@0.0000+0.1250')
    expect(naive).toContain('zz@0.0000+0.2500')
    expect(naive).not.toBe(stacked)
  })

  it('SCOPE LIMIT — the fallback declines a length with no whole-column spelling', () => {
    // ⚠ A SCOPE CLAUSE, not a fires-per-cause one. With `stackedRegion` removed it
    // does redden, but at its SETUP — the refine it needs is the thing being removed —
    // so it would read as proof of the fix while actually asserting nothing about it.
    // What it really holds: the fallback widens what can be WRITTEN, never what can be
    // invented. A note shorter than a column has no token at this resolution either way.
    const fine = parseStepGrid('bd@2 sn cp', 2)
    expect(fine.ok).toBe(true)
    if (!fine.ok) return
    const lanes = fine.model.lanes.map((l) => ({ ...l, cells: [...l.cells] }))
    // `cellOn`, not a literal: a cell is "on" by BEING an object (`isCellOn` is a
    // `typeof` check), so an `on: true` field is a belief about the shape rather than
    // part of it — which is why tsc rejected the literal and why the two sibling
    // cases above already ask the module for their cells.
    lanes[0].cells[0] = cellOn(1.5)
    expect(serializeStepGrid({ ...fine.model, lanes })).toBeNull()
  })
})
