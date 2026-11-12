/**
 * Which writer the piano roll uses, by Settings › Grid, and where its length handle is drawn
 * in the tree mode (#2294).
 *
 * THE CHOOSER — Exact hands the gestures the text and its divisions (the step writer); LCM
 * hands them nothing, so they fall through to the column writer. The LCM arm is what keeps the
 * roll's older browser specs byte-for-byte as before the step writer.
 *
 * THE HANDLE — drawn only where a drag would write (#1322). In the tree mode a drag asks
 * `rollResize`, so a note followed by another note, with no rest to grow into and no room to
 * give back, gets no handle. Each verdict here is checked against `rollResize` itself.
 */
import { describe, expect, it } from 'vitest'
import { chunkDivisions, parsePianoRoll, pitchToMidi, rollResize, type PianoRollModel } from '../../../codeView'
import { columnPlace, columnUnit, endInBar } from '../gridZoom'
import { rollResizableNotes, rollStepText } from '../rollWriter'

const modelOf = (mini: string): PianoRollModel => {
  const g = parsePianoRoll(mini)
  if (!g.ok) throw new Error(`${mini}: ${g.reason}`)
  return g.model
}

describe('the grid mode chooses the roll’s writer (#2294)', () => {
  it('Exact hands the gestures the text and its divisions; LCM hands them nothing', () => {
    const m = modelOf('c4 ~ e4 ~')
    const exact = rollStepText('exact', m, 'c4 ~ e4 ~')
    expect(exact?.mini).toBe('c4 ~ e4 ~')
    expect(exact?.trees).toEqual(chunkDivisions('c4 ~ e4 ~', 1))
    expect(rollStepText('lcm', m, 'c4 ~ e4 ~')).toBeNull()
  })

  it('nothing to write is nothing in either mode: no model, a look-only model, no text', () => {
    expect(rollStepText('exact', null, 'c4')).toBeNull()
    expect(rollStepText('exact', { lookOnly: true }, 'c4')).toBeNull()
    expect(rollStepText('exact', modelOf('c4'), null)).toBeNull()
  })
})

describe('a column that is no exact share of its bar is no place (#2294)', () => {
  it('weights that sum to no whole (2.7 columns) give no place, unit or end; whole columns do', () => {
    const frac = modelOf('c4@1.5 e4@1.2')
    expect(columnPlace(frac, 0)).toBeNull()
    expect(columnPlace(frac, 1)).toBeNull()
    expect(columnUnit(frac, 1)).toBeNull()
    expect(endInBar(frac, 0, 1)).toBeNull()
    const whole = modelOf('c4 ~ ~ ~')
    expect(columnPlace(whole, 1)).toEqual({ bar: 0, at: { n: 1, d: 4 } })
    expect(columnUnit(whole, 1)).toEqual({ n: 1, d: 4 })
    expect(endInBar(whole, 0, 2)).toEqual({ n: 1, d: 2 })
  })
})

describe('in the tree mode the length handle is where `rollResize` writes (#2294, #1322)', () => {
  /** the notes some other whole-column length of which `rollResize` writes, asked directly */
  const writable = (mini: string): string[] => {
    const m = modelOf(mini)
    const trees = chunkDivisions(mini, m.bars ?? 1)
    return m.notes
      .filter((n) => {
        const midi = pitchToMidi(n.pitch)!
        const place = columnPlace(m, n.start)!
        for (let dur = 1; ; dur++) {
          if (dur === Math.round(n.duration)) continue
          const end = endInBar(m, n.start, n.start + dur)
          if (!end) return false
          if (rollResize(mini, trees, place, midi, end).ok) return true
        }
      })
      .map((n) => `${n.pitch}@${n.start}`)
  }
  const handles = (mini: string): string[] => {
    const m = modelOf(mini)
    const base = rollStepText('exact', m, mini)!
    return [...rollResizableNotes(m, base)].map((n) => `${n.pitch}@${n.start}`)
  }

  it('a note followed by a note, one column long, has no handle', () => {
    expect(handles('g3 c3 g3 c3 g3 c3 g3 c3')).toEqual([])
  })

  it('a note with a rest after it, or room to give back, keeps its handle', () => {
    expect(handles('c4 ~ e4 ~').sort()).toEqual(['c4@0', 'e4@2'])
    // c3 cannot grow over e3 but can give a column back; g2 can give one back
    expect(handles('[c3@3 e3] [~ g2@2 b2]').sort()).toEqual(['c3@0', 'g2@5'])
  })

  it('every verdict is what `rollResize` answers', () => {
    for (const mini of ['g3 c3 g3 c3 g3 c3 g3 c3', 'c4 ~ e4 ~', '[c3@3 e3] [~ g2@2 b2]', '[c3,e3] ~ ~ ~', 'c3 e3 g3 a3', 'c4 [e4 [g4 a4]] ~']) {
      expect(handles(mini).sort(), mini).toEqual(writable(mini).sort())
    }
  })
})
