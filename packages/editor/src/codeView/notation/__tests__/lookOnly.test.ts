/**
 * Look-only views (#1975): a pattern whose hits cannot be edited one by one is still
 * shown — drawn from what Strudel plays — and nothing can write through it.
 *
 * Three claims, each with its control:
 *   1. the view is what Strudel plays (asked of Strudel directly, not of our reader);
 *   2. every op declines on it, and every writer has no spelling for it;
 *   3. nothing else moved — the refusal is the same refusal, an editable pattern is
 *      never look-only, and a refusal about something other than editing gets no view.
 */
import { describe, it, expect } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'

import { parsePianoRoll, parseStepGrid } from '../parse'
import { serializePianoRoll, serializeStepGrid, serializeStepGridWithExtent, serializePianoRollWithExtent } from '../serialize'
import { isCellOn, lookOnlyLine, type PianoRollModel, type StepGridModel } from '../model'
import {
  moveNote,
  pasteNote,
  placeNote,
  removeNote,
  resizableNotes,
  resizeCell,
  resizeNote,
  toggleCell,
  canToggleCell,
  canPlaceNote,
  canRemoveNote,
} from '../place'
import { addLane, removeLane } from '../lane'
import { resizeGrid, resizeRoll } from '../resize'
import {
  RESOLUTION_PRESETS,
  collapsePianoRollToDocument,
  collapseStepGridToDocument,
  scalePianoRoll,
  scaleStepGrid,
} from '../resolution'
import { stepGridCodec, pianoRollCodec, gainWritable, slotPress, reconcileGrid, gridWritePlan } from '../gridCodec'
import { lengthenOffers, appendBarsOffer, appendEmptyBars } from '../lengthen'
import { UNREFINED } from '../viewResolution'
import { setColumnGain, setGroupGain } from '../../../visualEdit/panels/inspector'
import type { ChunkGain } from '../model'
import { routeSurface } from '../../surface/surfaceRoute'

const NO_GAIN: ChunkGain = { mini: null, numeric: null, foreign: false }

/** the two patterns the issue names, and what `main` said about each */
const GRID_CASES = [
  { mini: '[hh ~]!16', gate: 'view-unusable', reason: 'nothing in this view could be edited on its own', why: 'every hit here comes from the same piece of text, so none can be changed on its own', steps: 16, bars: 1, hits: 16 },
  // `no-leaf-anchor` until #1974: its hits were anchored on the euclid's `<2 4!2>`, not on `bd`.
  // Anchored on the note, every hit is the one `bd` — the same reason as the row above.
  { mini: '~ ~ ~ bd(<2 4!2>, 8)', gate: 'view-unusable', reason: 'nothing in this view could be edited on its own', why: 'every hit here comes from the same piece of text, so none can be changed on its own', steps: 48, bars: 3, hits: 10 },
  { mini: '<bd>*4', gate: 'view-unusable', reason: 'nothing in this view could be edited on its own', why: 'every hit here comes from the same piece of text, so none can be changed on its own', steps: 4, bars: 1, hits: 4 },
] as const

const ROLL_CASES = [
  { mini: '<c3>*4', gate: 'view-unusable', steps: 4, bars: 1, hits: 4 },
  { mini: '<0 2>!2*2', gate: 'view-unusable', steps: 4, bars: 1, hits: 4 },
] as const

const gridView = (mini: string): StepGridModel => {
  const r = parseStepGrid(mini)
  if (r.ok || !r.lookOnly) throw new Error(`no look-only grid for ${mini}`)
  return r.lookOnly
}
const rollView = (mini: string): PianoRollModel => {
  const r = parsePianoRoll(mini)
  if (r.ok || !r.lookOnly) throw new Error(`no look-only roll for ${mini}`)
  return r.lookOnly
}

/** what Strudel plays in bar `b`, asked of Strudel: `value@column+length`, sorted */
function played(mini: string, b: number, perBar: number): string[] {
  const pat = reifyMini(mini) as {
    queryArc: (a: number, z: number) => {
      value: unknown
      whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
      hasOnset(): boolean
    }[]
  }
  return pat
    .queryArc(b, b + 1)
    .filter((h) => h.whole && h.hasOnset())
    .map((h) => {
      const at = (h.whole!.begin.valueOf() - b) * perBar
      const len = (h.whole!.end.valueOf() - h.whole!.begin.valueOf()) * perBar
      return `${String(h.value)}@${Math.round(at)}+${len.toFixed(6)}`
    })
    .sort()
}

/** the same list read off a look-only grid's cells */
function drawnGrid(model: StepGridModel, b: number, perBar: number): string[] {
  const out: string[] = []
  for (const lane of model.lanes) {
    for (let c = 0; c < perBar; c++) {
      const cell = lane.cells[b * perBar + c]
      if (isCellOn(cell)) out.push(`${lane.sound}@${c}+${cell.duration.toFixed(6)}`)
    }
  }
  return out.sort()
}

function drawnRoll(model: PianoRollModel, b: number, perBar: number): string[] {
  return model.notes
    .filter((n) => Math.floor(n.start / perBar) === b)
    .map((n) => `${n.pitch}@${n.start - b * perBar}+${n.duration.toFixed(6)}`)
    .sort()
}

describe('a pattern that cannot be edited note by note is still shown (#1975)', () => {
  for (const c of GRID_CASES) {
    it(`grid ${c.mini}: the refusal is unchanged and carries the view`, () => {
      const r = parseStepGrid(c.mini)
      expect(r.ok).toBe(false)
      if (r.ok) return
      // the same refusal `main` gave — look-only adds a view, it does not reword the no
      expect(r.gate).toBe(c.gate)
      expect(r.reason).toBe(c.reason)
      const m = r.lookOnly
      expect(m).toBeDefined()
      if (!m) return
      // the view speaks for itself, in its own words — not the refusal's
      expect(m.lookOnly).toEqual({ gate: c.gate, reason: c.why })
      expect(lookOnlyLine(m.lookOnly!)).toBe(`Look only — ${c.why}. Edit it in the code.`)
      expect(m.steps).toBe(c.steps)
      expect(m.bars ?? 1).toBe(c.bars)
      // nothing to write through
      expect(m.source).toBeUndefined()
      expect(m.altSource).toBeUndefined()
      expect(m.leafSource).toBeUndefined()
      expect(m.surgical).toBeUndefined()
    })

    it(`grid ${c.mini}: every bar draws exactly what Strudel plays`, () => {
      const m = gridView(c.mini)
      const perBar = m.steps / (m.bars ?? 1)
      let total = 0
      for (let b = 0; b < (m.bars ?? 1); b++) {
        const want = played(c.mini, b, perBar)
        expect(drawnGrid(m, b, perBar)).toEqual(want)
        total += want.length
      }
      expect(total).toBe(c.hits)
      // …and the bar after the last one is the first again
      expect(played(c.mini, m.bars ?? 1, perBar)).toEqual(drawnGrid(m, 0, perBar))
    })
  }

  for (const c of ROLL_CASES) {
    it(`roll ${c.mini}: refused as before, shown as played`, () => {
      const r = parsePianoRoll(c.mini)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.gate).toBe(c.gate)
      const m = r.lookOnly
      expect(m?.lookOnly).toEqual({
        gate: c.gate,
        reason: 'every note here comes from the same piece of text, so none can be changed on its own',
      })
      if (!m) return
      expect(m.leafSource).toBeUndefined()
      expect(m.source).toBeUndefined()
      const perBar = m.steps / (m.bars ?? 1)
      let total = 0
      for (let b = 0; b < (m.bars ?? 1); b++) {
        const want = played(c.mini, b, perBar)
        expect(drawnRoll(m, b, perBar)).toEqual(want)
        total += want.length
      }
      expect(total).toBe(c.hits)
    })
  }
})

describe('nothing writes through a look-only model (#1975)', () => {
  for (const c of GRID_CASES) {
    it(`grid ${c.mini}: the writers have no spelling for it`, () => {
      const m = gridView(c.mini)
      expect(serializeStepGrid(m)).toBeNull()
      expect(serializeStepGridWithExtent(m)).toEqual({ mini: null, extent: { path: 'declined' } })
      expect(stepGridCodec.serializeGain(m)).toEqual({ kind: 'skip' })
      expect(gainWritable(stepGridCodec, m)).toBe(false)
      expect(gridWritePlan(stepGridCodec, m)).toBeNull()
      expect(collapseStepGridToDocument(m) === null || collapseStepGridToDocument(m) === m || serializeStepGrid(collapseStepGridToDocument(m)!) === null).toBe(true)
    })

    it(`grid ${c.mini}: every op hands the model back untouched`, () => {
      const m = gridView(c.mini)
      let asked = 0
      const declines = (next: StepGridModel): void => {
        asked++
        expect(next).toBe(m)
      }
      for (let lane = 0; lane < m.lanes.length; lane++) {
        for (let col = 0; col < m.steps; col++) {
          declines(toggleCell(m, lane, col, true))
          declines(toggleCell(m, lane, col, false))
          declines(toggleCell(m, lane, col, true, 2))
          declines(resizeCell(m, lane, col, 1))
          declines(resizeCell(m, lane, col, 2))
          declines(setColumnGain(m, col, 0.5))
          expect(canToggleCell(m, lane, col, true)).toBe(false)
          expect(canToggleCell(m, lane, col, false)).toBe(false)
        }
      }
      declines(addLane(m, 'cp'))
      declines(removeLane(m, m.lanes[0].sound))
      declines(scaleStepGrid(m, 'double'))
      declines(scaleStepGrid(m, 'halve'))
      for (const mode of ['pad', 'spread'] as const) {
        declines(resizeGrid(m, m.steps * 2, mode))
        declines(resizeGrid(m, Math.max(1, m.steps / 2), mode))
      }
      for (const t of RESOLUTION_PRESETS) {
        declines(stepGridCodec.quantizeTo(m, t))
        // offered nothing — not even with a prover that says every view draws
        expect(stepGridCodec.slotState(m, t, () => true)).toBe(t === m.steps ? 'active' : 'disabled')
      }
      expect(asked).toBeGreaterThan(m.steps * 6)
    })

    it(`grid ${c.mini}: the + handle offers nothing, and says why`, () => {
      const offers = lengthenOffers(stepGridCodec.parse, c.mini, c.bars, NO_GAIN)
      expect(offers.duplicate.ok).toBe(false)
      expect(offers.append.ok).toBe(false)
      const more = appendBarsOffer(stepGridCodec.parse, c.mini, c.bars, 3, NO_GAIN)
      expect(more.ok).toBe(false)
      if (!more.ok) expect(more.reason).toMatch(/can't edit it/)
    })

    it(`grid ${c.mini}: the panel holds the view, and holds nothing else`, () => {
      const held = reconcileGrid(stepGridCodec, c.mini, NO_GAIN, UNREFINED, null, UNREFINED)
      expect(held?.model.lookOnly?.gate).toBe(c.gate)
      expect(held?.read).toBe(held?.model)
      // an in-progress model from another pattern is never kept over it
      const other = stepGridCodec.parse('bd ~ sd ~', UNREFINED)
      if (!other.ok) throw new Error('control did not parse')
      const again = reconcileGrid(stepGridCodec, c.mini, NO_GAIN, UNREFINED, other.model, UNREFINED)
      expect(again?.model.lookOnly?.gate).toBe(c.gate)
      // and a finer view is the same look-only view, not a refusal with nothing to show
      const fine = reconcileGrid(stepGridCodec, c.mini, NO_GAIN, 2, null, UNREFINED)
      expect(fine?.model.lookOnly?.gate).toBe(c.gate)
      expect(fine?.model.steps).toBe(c.steps)
    })
  }

  for (const c of ROLL_CASES) {
    it(`roll ${c.mini}: no writer, no op, no offer`, () => {
      const m = rollView(c.mini)
      expect(serializePianoRoll(m)).toBeNull()
      expect(serializePianoRollWithExtent(m)).toEqual({ mini: null, extent: { path: 'declined' } })
      expect(pianoRollCodec.serializeGain(m)).toEqual({ kind: 'skip' })
      expect(gainWritable(pianoRollCodec, m)).toBe(false)
      expect(gridWritePlan(pianoRollCodec, m)).toBeNull()
      expect(resizableNotes(m).size).toBe(0)
      let asked = 0
      const declines = (next: PianoRollModel): void => {
        asked++
        expect(next).toBe(m)
      }
      const free = m.numeric ? '7' : 'e4'
      for (const n of m.notes) {
        declines(removeNote(m, n.start, n.pitch))
        declines(resizeNote(m, n.start, n.pitch, n.duration + 1))
        declines(moveNote(m, n.pitch, n.start, free, n.start))
        declines(pasteNote(m, free, n.start, 1))
        declines(setGroupGain(m, n.start, 0.5))
        expect(canRemoveNote(m, n.start, n.pitch)).toBe(false)
      }
      for (let col = 0; col < m.steps; col++) {
        declines(placeNote(m, free, col, 1))
        expect(canPlaceNote(m, free, col, 1)).toBe(false)
      }
      declines(scalePianoRoll(m, 'double'))
      declines(scalePianoRoll(m, 'halve'))
      declines(resizeRoll(m, m.steps * 2, 'pad'))
      declines(resizeRoll(m, m.steps * 2, 'spread'))
      for (const t of RESOLUTION_PRESETS) {
        declines(pianoRollCodec.quantizeTo(m, t))
        expect(pianoRollCodec.slotState(m, t, () => true)).toBe(t === m.steps ? 'active' : 'disabled')
        expect(slotPress(pianoRollCodec, m, t, () => true).kind).toBe('write')
      }
      expect(collapsePianoRollToDocument(m) === null || serializePianoRoll(collapsePianoRollToDocument(m)!) === null).toBe(true)
      expect(asked).toBeGreaterThan(m.notes.length * 5)
      const offers = lengthenOffers(pianoRollCodec.parse, c.mini, c.bars, NO_GAIN)
      expect(offers.duplicate.ok).toBe(false)
      expect(offers.append.ok).toBe(false)
    })
  }
})

describe('the + handle on a look-only pattern (#1975)', () => {
  it('is refused on the pattern itself — the longer text would have read back as editable', () => {
    // 16 of the corpus's 71 look-only views are like this one: appending a bar gives
    // text the grid CAN edit, so the read-back alone would have offered the write.
    const mini = '<clap clap>*8'
    expect(parseStepGrid(mini).ok).toBe(false)
    const longer = appendEmptyBars(mini, 1, 1)
    expect(longer).toEqual({ ok: true, mini: '<[<clap clap>*8] ~>' })
    if (!longer.ok) return
    const back = parseStepGrid(longer.mini)
    expect(back.ok && (back.model.bars ?? 1) === 2, 'the witness: this rewrite reads back').toBe(true)
    // …and it is still not offered
    expect(lengthenOffers(stepGridCodec.parse, mini, 1, NO_GAIN).append.ok).toBe(false)
    expect(appendBarsOffer(stepGridCodec.parse, mini, 1, 1, NO_GAIN).ok).toBe(false)
  })
})

describe('a view that could not draw every hit is not offered (#1975)', () => {
  it('one sound twice in a column at two lengths: refused as before, with no view', () => {
    // plays a one-column D and a four-column D together; a cell holds one of them
    const r = parseStepGrid('[C G], <D Fb B C A>*[0.5,2]')
    expect(r.ok).toBe(false)
    if (r.ok) return
    // `no-leaf-anchor` until #1974 anchored its hits on their notes; it is turned away one
    // check later now, still with no view
    expect(r.gate).toBe('edit-unsafe')
    expect('lookOnly' in r).toBe(false)
  })

  it('CONTROL: the same sound twice at the SAME length is one cell, and is shown', () => {
    // bars 10 and 11 of this one land both arms on the same note
    const r = parseStepGrid('<f#5 g#5 e5 c#5, a5 e5 c#5>')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.lookOnly?.bars).toBe(12)
  })
})

describe('nothing else moved (#1975)', () => {
  it('an editable pattern is never look-only', () => {
    for (const mini of ['bd ~ sd ~', 'bd*4', 'bd ~ ~ ~, ~ sd ~ sd, hh hh hh hh', '<bd sd> hh', 'bd*<2 3>']) {
      const r = parseStepGrid(mini)
      expect(r.ok, mini).toBe(true)
      if (r.ok) expect(r.model.lookOnly, mini).toBeUndefined()
      expect('lookOnly' in r, mini).toBe(false)
    }
    for (const mini of ['c3 e3 g3', 'c3*4', '[c3 ~]!4', '0 .. 3', '<c3 e3> g3']) {
      const r = parsePianoRoll(mini)
      expect(r.ok, mini).toBe(true)
      if (r.ok) expect(r.model.lookOnly, mini).toBeUndefined()
      expect('lookOnly' in r, mini).toBe(false)
    }
  })

  it('a refusal that is not about editing gets no view', () => {
    const cases: [string, 'grid' | 'roll', string][] = [
      ['bd? sd', 'grid', 'unstable-period'],
      ['0 .. 3', 'grid', 'wrong-surface'],
      ['[hh ~]!16', 'roll', 'wrong-surface'],
      ['~ ~ c3(<2 4!2>, 8)', 'roll', 'resolution'],
    ]
    for (const [mini, surface, gate] of cases) {
      const r = surface === 'grid' ? parseStepGrid(mini) : parsePianoRoll(mini)
      expect(r.ok, mini).toBe(false)
      if (r.ok) continue
      expect(r.gate, mini).toBe(gate)
      expect('lookOnly' in r, mini).toBe(false)
    }
    // nothing reified at all: the core's own message, and nothing to draw
    const bad = parseStepGrid('bd [sd')
    expect(bad.ok).toBe(false)
    expect('lookOnly' in bad).toBe(false)
  })

  it('an editable pattern still lengthens — the new first gate is not a blanket no', () => {
    const offers = lengthenOffers(stepGridCodec.parse, 'bd ~ sd ~', 1, NO_GAIN)
    expect(offers.duplicate).toEqual({ ok: true, mini: '<[bd ~ sd ~] [bd ~ sd ~]>' })
    expect(offers.append).toEqual({ ok: true, mini: '<[bd ~ sd ~] ~>' })
  })
})

describe('a silent head routes to the roll that can show it (#1975)', () => {
  it('pitches neither surface can edit open the roll, look-only', () => {
    // both refuse `<c3>*4` for the same reason; before, the silent head fell to the grid
    expect(parsePianoRoll('<c3>*4').ok).toBe(false)
    expect(parseStepGrid('<c3>*4').ok).toBe(false)
    expect(routeSurface(null, '<c3>*4')).toBe('roll')
  })

  it('CONTROLS: an editable roll, an editable grid and a sound pattern route as before', () => {
    expect(routeSurface(null, 'c3 e3 g3')).toBe('roll')
    expect(routeSurface(null, 'bd ~ sd ~')).toBe('step')
    // look-only on the GRID only: the roll says wrong-surface, so the grid is asked
    expect(routeSurface(null, '[hh ~]!16')).toBe('step')
    // a head that names its surface is not re-routed by any of this
    expect(routeSurface('s', '<c3>*4')).toBe('step')
    expect(routeSurface('note', '[hh ~]!16')).toBe('roll')
  })
})
