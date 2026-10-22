/**
 * Exact grid mode (#1855) — each `,`-part drawn at its own steps, and a click that fills
 * one whole own step.
 *
 * Two halves, and they are asked of different things on purpose:
 *   - the LAYOUT (`ownStepWidths`, `rowBoxes`) reads the parser's own `SourcePart.factor`;
 *     every expected width below was read off `source.parts[].factor` first;
 *   - the WRITE is `toggleCell` with a length, through the unchanged writer, and each
 *     written text is checked against Strudel: the new hit starts on the part's own step
 *     and lasts exactly one of them.
 */
import { describe, expect, it } from 'vitest'
import { parseStepGrid } from '../../../codeView/notation/parse'
import { serializeStepGrid } from '../../../codeView/notation/serialize'
import { canToggleCell, toggleCell } from '../../../codeView/notation/place'
import { isCellOn } from '../../../codeView/notation/model'
import { ownStepWidths, rowBoxes } from '../writtenSteps'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'

const grid = (mini: string) => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const widths = (mini: string) => Object.fromEntries(ownStepWidths(grid(mini)))
const laneOf = (m: ReturnType<typeof grid>, sound: string) => m.lanes.findIndex((l) => l.sound === sound)

/** [begin, duration] in cycles of every `sound` hap Strudel plays over `bars` cycles */
function haps(text: string, sound: string, bars: number): [number, number][] {
  const pat = reifyMini(text) as { queryArc: (a: number, b: number) => { whole: { begin: unknown; end: unknown }; value: unknown }[] }
  return pat
    .queryArc(0, bars)
    .filter((h) => h.value === sound)
    .map((h): [number, number] => [Number(h.whole.begin), Number(h.whole.end) - Number(h.whole.begin)])
    .sort((a, b) => a[0] - b[0])
}

describe('ownStepWidths — how many columns one of a part\'s own steps spans', () => {
  it('lists each stretched part at its factor', () => {
    expect(widths('~ sd ~ sd, hh*8')).toEqual({ 0: 2 })
    expect(widths('bd sd, hh*4')).toEqual({ 0: 2 })
    expect(widths('bd*3, hh*4')).toEqual({ 0: 4, 1: 3 })
    expect(widths('<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8')).toEqual({ 0: 2, 1: 2 })
    // a part written over fewer bars: one bar of it is one bar of the grid
    expect(widths('<bd sd>, hh*4')).toEqual({ 0: 4 })
  })

  it('lists nothing where every part already sits on the shared grid', () => {
    // `[~ bd]` makes the part's own reading 8 columns: its own step IS one column
    expect(widths('bd [~ bd] sd ~, hh*8')).toEqual({})
    expect(widths('bd sd hh cp')).toEqual({})
  })

  it('lists nothing for a model drawn per bar, or read leaf by leaf', () => {
    const perBar = grid('<[bd bd bd] [bd bd bd bd]>')
    expect(perBar.barSteps).toEqual([3, 4])
    expect(ownStepWidths(perBar).size).toBe(0)
    const leaf = grid('<[bd bd bd] [bd bd bd bd]>, hh*4')
    expect(leaf.leafSource).toBeDefined()
    expect(ownStepWidths(leaf).size).toBe(0)
  })

  it('skips a part whose regions no longer tile the model', () => {
    const m = grid('~ sd ~ sd, hh*8')
    expect(ownStepWidths({ ...m, steps: 16 }).size).toBe(0)
  })
})

describe('rowBoxes — the boxes one row is drawn as', () => {
  it('cuts a row into own-step boxes', () => {
    const m = grid('~ sd ~ sd, hh*8')
    const sd = m.lanes[laneOf(m, 'sd')]
    expect(rowBoxes(sd.cells, m.steps, 2, isCellOn)).toEqual([
      { start: 0, width: 2 },
      { start: 2, width: 2 },
      { start: 4, width: 2 },
      { start: 6, width: 2 },
    ])
  })

  it('keeps a box per column when a hit starts inside a box', () => {
    const m = grid('~ sd ~ sd, hh*8')
    const sd = m.lanes[laneOf(m, 'sd')]
    const cells = sd.cells.map((c, i) => (i === 3 ? { duration: 1 } : c))
    expect(rowBoxes(cells, m.steps, 2, isCellOn).every((b) => b.width === 1)).toBe(true)
    expect(rowBoxes(sd.cells, m.steps, undefined, isCellOn)).toHaveLength(8)
  })
})

describe('a click in Exact fills one whole own step', () => {
  // [pattern, sound, column, own step columns, written text]
  const WRITES: [string, string, number, number, string][] = [
    ['bd sd, hh*4', 'bd', 2, 2, 'bd [bd,sd], hh*4'],
    ['bd ~, hh*4', 'bd', 2, 2, 'bd bd, hh*4'],
    ['~ sd ~ sd, hh*8', 'sd', 0, 2, 'sd sd ~ sd, hh*8'],
    ['~ sd ~ sd, hh*8', 'sd', 4, 2, '~ sd sd sd, hh*8'],
    ['<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8', 'bd', 2, 2, '<[bd bd bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8'],
    ['<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8', 'sd', 8, 2, '<[bd ~ bd ~] [bd ~ ~ bd]>, <[~ sd ~ sd] [sd sd ~ sd]>, hh*8'],
  ]

  it.each(WRITES)('%s: %s at column %i', (mini, sound, col, own, text) => {
    const m = grid(mini)
    const li = laneOf(m, sound)
    // the LCM click — one column long — is half this part's step, and the writer declines it
    expect(toggleCell(m, li, col, true, 1)).toBe(m)
    const next = toggleCell(m, li, col, true, own)
    expect(next).not.toBe(m)
    expect(serializeStepGrid(next)).toBe(text)
    // Strudel plays the new hit on the part's own step, one own step long
    const bars = m.bars ?? 1
    const cyclesPerCol = bars / m.steps
    expect(haps(text, sound, bars)).toContainEqual([col * cyclesPerCol, own * cyclesPerCol])
  })

  it('erases the same way in both modes', () => {
    const m = grid('~ sd ~ sd, hh*8')
    const li = laneOf(m, 'sd')
    expect(serializeStepGrid(toggleCell(m, li, 2, false, 2))).toBe('~ ~ ~ sd, hh*8')
    expect(serializeStepGrid(toggleCell(m, li, 2, false, 1))).toBe('~ ~ ~ sd, hh*8')
  })

  it("opens every box of the #1849 beat, including LCM's 8 locked cells", () => {
    const m = grid('<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8')
    const w = ownStepWidths(m)
    let lockedInLcm = 0
    let boxes = 0
    m.lanes.forEach((lane, li) => {
      for (const { start, width } of rowBoxes(lane.cells, m.steps, w.get(lane.part ?? 0), isCellOn)) {
        boxes++
        const on = isCellOn(lane.cells[start])
        if (!canToggleCell(m, li, start, !on, 1)) lockedInLcm++
        expect(canToggleCell(m, li, start, !on, width), `${lane.sound} @${start}`).toBe(true)
      }
    })
    expect(lockedInLcm).toBe(8)
    expect(boxes).toBe(8 + 8 + 16)
  })
})
