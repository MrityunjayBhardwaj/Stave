import { describe, it, expect } from 'vitest'
import { parsePianoRoll } from '../parse'
import { moveNote, placeNote, removeNote, resizeNote } from '../place'
import { serializePianoRoll } from '../serialize'
import type { PianoRollModel } from '../model'
import { absorbViewScale } from '../viewResolution'

/**
 * #1822 — the read-back gate must judge a write on a REFINED view (Slots ×2) in the
 * view's own units. It re-parsed the written text unrefined and required equal step
 * counts, so every write the document spells at its own, coarser resolution — a
 * delete, a placement on a whole step — was refused as if it had lost notes.
 */

function roll(mini: string, scale = 1): PianoRollModel {
  const r = parsePianoRoll(mini, scale)
  if (!r.ok) throw new Error(`does not open: ${mini} ×${scale}`)
  return r.model
}

const MELODY = 'e4 d4 c4 d4 e4 e4 e4@2'

describe('read-back on a refined view (#1822)', () => {
  it('a delete at ×2 goes through, and writes what the same delete writes at ×1', () => {
    for (const mini of [MELODY, 'c3 ~ ~ ~', 'c3 e3 g3 b3', 'c3 d3 e3 f3 g3 a3 b3 c4']) {
      const one = roll(mini)
      const two = roll(mini, 2)
      const n1 = one.notes[1] ?? one.notes[0]
      const n2 = two.notes.find((n) => n.pitch === n1.pitch && n.start === n1.start * 2)!
      const at1 = removeNote(one, n1.start, n1.pitch, { readback: true })
      const at2 = removeNote(two, n2.start, n2.pitch, { readback: true })
      expect(at1, `×1 control: ${mini}`).not.toBe(one)
      expect(at2, `×2: ${mini}`).not.toBe(two)
      expect(serializePianoRoll(at2)).toBe(serializePianoRoll(at1))
    }
  })

  it('a placement on a whole step at ×2 goes through, as at ×1', () => {
    const one = roll('c3 ~ ~ ~')
    const two = roll('c3 ~ ~ ~', 2)
    const at1 = placeNote(one, 'e3', 2, 1, { readback: true })
    const at2 = placeNote(two, 'e3', 4, 2, { readback: true })
    expect(at1).not.toBe(one)
    expect(at2).not.toBe(two)
    expect(serializePianoRoll(at2)).toBe(serializePianoRoll(at1))
  })

  it('what already worked at ×2 is unchanged: half-step placement, move, resize', () => {
    const two = roll(MELODY, 2)
    const d4 = two.notes.find((n) => n.pitch === 'd4')!
    const e4 = two.notes[0]
    expect(placeNote(two, 'g4', 1, 1, { readback: true })).not.toBe(two)
    expect(moveNote(two, d4.pitch, d4.start, 'd#4', d4.start, { readback: true })).not.toBe(two)
    expect(resizeNote(two, e4.start, e4.pitch, e4.duration + 2, { readback: true })).not.toBe(two)
  })

  it('still refuses the lossy delete (#1340) at every view, and still takes its partner', () => {
    // g4's removal re-spells the bar so the rest lands inside the `,`-stack and the
    // document reopens with FEWER notes; c3 in the same column is the accepted control.
    const mini = '<g1, c1> - <c3, g4 - - >'
    for (const scale of [1, 2, 4]) {
      const m = roll(mini, scale)
      const g4 = m.notes.find((n) => n.pitch === 'g4')!
      const c3 = m.notes.find((n) => n.pitch === 'c3' && n.start === g4.start)!
      expect(removeNote(m, g4.start, g4.pitch, { readback: true }), `g4 ×${scale}`).toBe(m)
      const kept = removeNote(m, c3.start, c3.pitch, { readback: true })
      expect(kept, `c3 ×${scale}`).not.toBe(m)
      expect(serializePianoRoll(kept)).toBe('<g1, c1> - <g4 c3 c3>')
    }
  })

  it('a delete at ×4 goes through too', () => {
    const one = roll(MELODY)
    const four = roll(MELODY, 4)
    const at1 = removeNote(one, one.notes[0].start, one.notes[0].pitch, { readback: true })
    const at4 = removeNote(four, four.notes[0].start, four.notes[0].pitch, { readback: true })
    expect(at4).not.toBe(four)
    expect(serializePianoRoll(at4)).toBe(serializePianoRoll(at1))
  })

  it('only a model that says it is a view is read finer; any other is judged as before', () => {
    // The same 8 columns with the view marker taken off: the write comes back as 4
    // steps and, with nothing saying 8 was a view, the gate keeps its old answer. The
    // rescue is scoped to the cause — a refined view — and the ×1 gate is unchanged.
    const m = absorbViewScale(roll('c3 e3 g3 b3', 2))
    expect(m.viewScale).toBeUndefined()
    expect(m.steps).toBe(8)
    expect(removeNote(m, m.notes[0].start, m.notes[0].pitch, { readback: true })).toBe(m)
  })
})
