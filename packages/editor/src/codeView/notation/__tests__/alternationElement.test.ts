import { describe, it, expect } from 'vitest'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
} from '../parse'
import { serializeStepGrid, serializePianoRoll } from '../serialize'
import type { PianoRollModel, StepGridModel } from '../model'

/**
 * #920 — a `<...>` alternation used as a sequence ELEMENT (`bd <sd hh>`), not
 * only as the whole cycle. The model bar-expands (one alternative per bar); the
 * writer keeps each source element's bytes and re-emits only the one edited.
 *
 * Phase 1 = clean-rectangle cases (every bar the same step count). Reconciliation
 * (an alternative with a different expanded length, e.g. `!n`) is declined at
 * parse and stays code-only until phase 1b.
 */

const rt = (s: string): string | null => {
  const r = parseStepGrid(s)
  if (!r.ok) return `REFUSED: ${r.reason}`
  return serializeStepGrid(r.model)
}

describe('#920 grid — <...> as a sequence element', () => {
  describe('parses (was refused)', () => {
    for (const s of ['bd <sd hh>', '<bd sd> hh', 'bd <sd hh> oh', 'bd <sd hh cp>']) {
      it(`opens ${s}`, () => {
        const r = parseStepGrid(s)
        expect(r.ok).toBe(true)
        if (r.ok) expect((r.model.bars ?? 1)).toBeGreaterThan(1)
      })
    }
  })

  describe('unedited round-trip = identity', () => {
    for (const s of [
      'bd <sd hh>',
      '<bd sd> hh',
      'bd <sd hh> oh',
      'bd <sd hh cp>', // 3-cycle
      '<bd sd> <hh oh>',
      '<bd sd*2> hh cp', // a `*n` inside a branch (same step count, finer div)
      '<[bd sd] [bd hh]>', // whole-cycle non-regression
      'bd sd hh cp', // flat non-regression
    ]) {
      it(`${s}`, () => {
        expect(rt(s)).toBe(s)
      })
    }
  })

  describe('edit localizes to one element (span surgery)', () => {
    it('editing the alternation touches only that element', () => {
      const r = parseStepGrid('bd <sd hh>')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      // turn OFF the hh in bar1 (col 3) → the <sd hh> element loses its bar-1 hit
      const hh = m.lanes.find((l) => l.sound === 'hh')!
      const cells = [...hh.cells]
      cells[cells.length - 1] = false
      const edited: StepGridModel = { ...m, lanes: m.lanes.map((l) => (l.sound === 'hh' ? { ...l, cells } : l)) }
      // bar1's alternation slot is now empty → <sd ~>; the leading `bd` is untouched
      expect(serializeStepGrid(edited)).toBe('bd <sd ~>')
    })

    it('editing a MIDDLE element leaves both neighbours byte-identical', () => {
      // `hh` is the static middle element of three; editing it must not disturb
      // the `<bd sd>` before it or the `<cp oh>` after it (last-element-only gates
      // are blind to exactly this — PV197).
      const r = parseStepGrid('<bd sd> hh <cp oh>')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      const hh = m.lanes.find((l) => l.sound === 'hh')!
      const cells = [...hh.cells]
      cells[4] = false // bar1's hh column (cols: bar0=0,1,2 · bar1=3,4,5)
      const edited: StepGridModel = { ...m, lanes: m.lanes.map((l) => (l.sound === 'hh' ? { ...l, cells } : l)) }
      expect(serializeStepGrid(edited)).toBe('<bd sd> <hh ~> <cp oh>')
    })

    it('editing a static cell in one bar promotes it to an alternation', () => {
      const r = parseStepGrid('bd <sd hh>')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      // turn OFF bd in bar1 (col 2) — bd was static across both bars
      const bd = m.lanes.find((l) => l.sound === 'bd')!
      const cells = [...bd.cells]
      cells[2] = false
      const edited: StepGridModel = { ...m, lanes: m.lanes.map((l) => (l.sound === 'bd' ? { ...l, cells } : l)) }
      expect(serializeStepGrid(edited)).toBe('<bd ~> <sd hh>')
    })
  })

  describe('reconciliation: the SYNTACTIC path declines, the projection carries it (#930)', () => {
    // `!n` inside a branch makes the branches expand to different lengths, so the
    // bars don't line up and the syntactic alt model still declines these.
    //
    // They are no longer code-only, though: the behaviour projection bar-expands
    // what they PLAY, so the grid opens anyway. That is the projection working as
    // designed — when the syntax is beyond the model, show the behaviour — and it
    // is only safe because the write-back stays byte-local, which is what these
    // assert rather than merely that `.ok` flipped.
    for (const s of ['<bd!3 sd> hh', 'bd <sd hh!2>']) {
      it(`${s}: syntax declined, behaviour projected, source preserved`, () => {
        expect(parseStepGridCore(s).ok).toBe(false) // the syntactic model still says no
        const r = parseStepGrid(s)
        expect(r.ok).toBe(true) // …and the projection opens it
        if (!r.ok) return
        expect(r.model.bars).toBeGreaterThan(1) // as BARS, not a flattened cycle
        // an untouched open→write is byte-for-byte the user's own text: the `!n`
        // compaction the syntactic model could not represent survives verbatim
        expect(serializeStepGrid(r.model)).toBe(s)
      })
    }

    it('editing one bar of <bd!3 sd> hh rewrites only that element', () => {
      const r = parseStepGrid('<bd!3 sd> hh')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      // bars are [bd|hh] [bd|hh] [bd|hh] [sd|hh]; clear the sd in bar 3 (col 6)
      const sd = m.lanes.find((l) => l.sound === 'sd')!
      const cells = [...sd.cells]
      cells[6] = false
      const edited: StepGridModel = {
        ...m,
        lanes: m.lanes.map((l) => (l.sound === 'sd' ? { ...l, cells } : l)),
      }
      // The edited element keeps the user's own bytes and `hh` rides back untouched.
      //
      // ⚠ THIS PINNED THE ELEMENT WRITER'S EXPANSION UNTIL #1010 P4d — `<bd bd bd ~> hh`,
      // with the comment "the edited element expands to spell its bars". Both spellings
      // play the identical four bars; the old one re-derived the whole element from a
      // cell model and spent the `!3` doing it, which is the compaction the two arms
      // above assert survives an UNEDITED open→write. The edited path was destroying
      // exactly what the unedited path was asserted to preserve, and this assertion is
      // what made that read as intended behaviour.
      expect(serializeStepGrid(edited)).toBe('<bd!3 ~> hh')
    })
  })
})

const rtRoll = (s: string): string | null => {
  const r = parsePianoRoll(s)
  if (!r.ok) return `REFUSED: ${r.reason}`
  return serializePianoRoll(r.model)
}

describe('#920 roll — <...> as a sequence element', () => {
  describe('parses (was refused)', () => {
    for (const s of ['0 <2 3> 5', 'c3 <e3 g3>', '<0 2> 4 <5 7>']) {
      it(`opens ${s}`, () => {
        const r = parsePianoRoll(s)
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.model.bars ?? 1).toBeGreaterThan(1)
      })
    }
  })

  describe('unedited round-trip = identity', () => {
    for (const s of [
      '0 <2 3> 5',
      'c3 <e3 g3>',
      '<0 2> 4 <5 7>',
      '0 <2 3 4> 5', // 3-cycle
      '0 <2 [3 4]> 5', // a group in a branch (same weight, finer div)
      '0 <2 3>@1 5', // explicit trailing where padding varies
      '<[c3,e3] [d3,f3]> g3', // chords in the branches
      '<0 2 5> <0 3 5>', // whole-cycle non-regression (single alternation each)
      '0 2 5', // flat non-regression
    ]) {
      it(`${s}`, () => {
        expect(rtRoll(s)).toBe(s)
      })
    }
  })

  describe('edit localizes to one element', () => {
    it('editing the alternation slot in one bar touches only that element', () => {
      const r = parsePianoRoll('0 <2 3> 5')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      // bar1's alternation note is `3` at column 4 (cols: bar0=0,1,2 · bar1=3,4,5)
      const edited: PianoRollModel = {
        ...m,
        notes: m.notes.map((n) => (n.start === 4 ? { ...n, pitch: '4' } : n)),
      }
      expect(serializePianoRoll(edited)).toBe('0 <2 4> 5')
    })

    it('editing a static note in one bar promotes it to an alternation', () => {
      const r = parsePianoRoll('0 <2 3> 5')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const m = r.model
      // the leading `0` is static (col 0 and col 3); change bar1's to `7`
      const edited: PianoRollModel = {
        ...m,
        notes: m.notes.map((n) => (n.start === 3 ? { ...n, pitch: '7' } : n)),
      }
      expect(serializePianoRoll(edited)).toBe('<0 7> <2 3> 5')
    })
  })

  describe('reconciliation: the SYNTACTIC path declines (#938)', () => {
    it('0 <2!3 3> 5: syntax declined, behaviour projected, edits stay byte-local', () => {
      // `!3` makes the branches expand to different lengths, so the syntactic alt
      // model still declines — but the projection bar-expands what it plays.
      expect(parsePianoRollCore('0 <2!3 3> 5').ok).toBe(false)
      const r = parsePianoRoll('0 <2!3 3> 5')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.model.bars).toBe(4)
      expect(serializePianoRoll(r.model)).toBe('0 <2!3 3> 5') // untouched = identity
      // repitch the note in the LAST bar: only the first element re-emits, and the
      // `<2!3 3>` the model could not parse rides back byte-for-byte
      const perBar = r.model.steps / 4
      const idx = r.model.notes.findIndex((n) => n.start === 3 * perBar)
      expect(idx).toBeGreaterThanOrEqual(0)
      const edited: PianoRollModel = {
        ...r.model,
        notes: r.model.notes.map((n, i) => (i === idx ? { ...n, pitch: '9' } : n)),
      }
      expect(serializePianoRoll(edited)).toBe('<0 0 0 9> <2!3 3> 5')
    })

    it('0 <2@2 3> 5 is never RE-EMITTED — the leaf writer edits its bytes instead', () => {
      // `@2` is the case bar expansion does NOT rescue: re-emitting the element per
      // bar cannot preserve its weight, so writing it back that way would re-divide
      // the cycle and shift every neighbour. Both element paths still decline, and
      // that is what this locks.
      expect(parsePianoRollCore('0 <2@2 3> 5').ok).toBe(false)
      // What changed (#986 P1b) is that refusing the VIEW is no longer the only
      // honest answer: the leaf writer never re-emits an element, so the weight it
      // could not preserve is simply bytes it never touches. Editing the `3` branch
      // rewrites that one token and leaves `@2` — and every other byte — verbatim.
      const r = parsePianoRoll('0 <2@2 3> 5')
      expect(r.ok).toBe(true)
      if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
      const m = r.model
      const three = m.notes.find((n) => n.pitch === '3')!
      expect(serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== three) })).toBe(
        '0 <2@2 ~> 5',
      )
      // …and a note whose single leaf sounds in every bar cannot be dropped from ONE
      // of them: no byte replacement says that, so the writer declines (never guesses).
      const shared = m.notes.find((n) => n.pitch === '0' && n.start === 0)!
      expect(serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== shared) })).toBeNull()
    })
  })
})
