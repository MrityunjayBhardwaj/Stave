/**
 * Exact grid mode, part 2 (#1855) — the gestures other than a click move by the box the row
 * draws, which in Exact is one of the part's own steps.
 *
 *   - the LENGTH (handle and ⌥⇧←/→): one box longer or shorter (`boxLengths`), and each
 *     written length checked against Strudel: the hit lasts a whole number of own steps;
 *   - the CURSOR: ←/→ step over a box, ↑/↓ land on the box playing at the same moment
 *     (`moveBoxCursor`);
 *   - VELOCITY: never offered on an Exact row — pinned, because the gain writer skips every
 *     `,`-stack and only a stack has a part stretched onto the shared grid.
 */
import { describe, expect, it } from 'vitest'
import { parseStepGrid } from '../../../codeView/notation/parse'
import { serializeStepGain, serializeStepGrid } from '../../../codeView/notation/serialize'
import { canResizeCell, resizeCell } from '../../../codeView/notation/place'
import { isCellOn } from '../../../codeView/notation/model'
import { boxLengths, ownStepWidths } from '../writtenSteps'
import { moveBoxCursor, moveCursor, type CursorMove } from '../gridGestures'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'

const grid = (mini: string) => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const laneOf = (m: ReturnType<typeof grid>, sound: string) => m.lanes.findIndex((l) => l.sound === sound)

/** [begin, duration] in cycles of every `sound` hap Strudel plays over one cycle */
function haps(text: string, sound: string): [number, number][] {
  const pat = reifyMini(text) as { queryArc: (a: number, b: number) => { whole: { begin: unknown; end: unknown }; value: unknown }[] }
  return pat
    .queryArc(0, 1)
    .filter((h) => h.value === sound)
    .map((h): [number, number] => [Number(h.whole.begin), Number(h.whole.end) - Number(h.whole.begin)])
    .sort((a, b) => a[0] - b[0])
}

describe('boxLengths — one box longer and one box shorter', () => {
  it('is ±1 on a box per column', () => {
    expect(boxLengths(1, 1)).toEqual({ longer: 2, shorter: null })
    expect(boxLengths(3, 1)).toEqual({ longer: 4, shorter: 2 })
    // a sub-column note is offered the whole lengths around it, as before
    expect(boxLengths(0.5, 1)).toEqual({ longer: 2, shorter: null })
  })

  it('moves by whole own steps on a wider box', () => {
    expect(boxLengths(2, 2)).toEqual({ longer: 4, shorter: null })
    expect(boxLengths(4, 2)).toEqual({ longer: 6, shorter: 2 })
    // a length that is not a whole number of steps lands on the next one either way
    expect(boxLengths(3, 2)).toEqual({ longer: 4, shorter: 2 })
    expect(boxLengths(4, 4)).toEqual({ longer: 8, shorter: null })
  })
})

describe('a length in Exact is a whole number of own steps', () => {
  // [pattern, sound, head column, own step columns, one step longer, written text]
  const LONGER: [string, string, number, number, number, string][] = [
    ['~ sd ~ ~, hh*8', 'sd', 2, 2, 4, '~ sd _ ~, hh*8'],
    ['~ sd ~ sd, hh*8', 'sd', 2, 2, 4, '~ sd _ sd, hh*8'],
    ['sd ~ ~ ~, hh*8', 'sd', 0, 2, 4, 'sd _ ~ ~, hh*8'],
  ]

  it.each(LONGER)('%s: %s at %i grows by one own step', (mini, sound, head, own, longer, text) => {
    const m = grid(mini)
    const li = laneOf(m, sound)
    expect(ownStepWidths(m).get(m.lanes[li].part ?? 0)).toBe(own)
    const d = (m.lanes[li].cells[head] as { duration: number }).duration
    expect(d).toBe(own)
    // what the handle used to ask: a column either way is half a step, declined both ways,
    // so the handle was never drawn
    expect(canResizeCell(m, li, head, d + 1)).toBe(false)
    expect(canResizeCell(m, li, head, d - 1)).toBe(false)
    const { longer: asked } = boxLengths(d, own)
    expect(asked).toBe(longer)
    expect(canResizeCell(m, li, head, asked)).toBe(true)
    expect(serializeStepGrid(resizeCell(m, li, head, asked))).toBe(text)
    // Strudel: the hit keeps its start and lasts two own steps
    const cyclesPerCol = 1 / m.steps
    expect(haps(text, sound)).toContainEqual([head * cyclesPerCol, 2 * own * cyclesPerCol])
  })

  it('shrinks back by one own step, and grows again to the room it has', () => {
    const m = grid('~ sd _ ~, hh*8')
    const li = laneOf(m, 'sd')
    expect((m.lanes[li].cells[2] as { duration: number }).duration).toBe(4)
    const { longer, shorter } = boxLengths(4, 2)
    expect(serializeStepGrid(resizeCell(m, li, 2, shorter!))).toBe('~ sd ~ ~, hh*8')
    expect(serializeStepGrid(resizeCell(m, li, 2, longer))).toBe('~ sd _ _, hh*8')
  })
})

describe('moveBoxCursor — arrows over boxes', () => {
  // `~ sd ~ sd, hh*8` in Exact: row 0 (sd) boxes 2 wide, row 1 (hh) a box per column
  const widthOf = (row: number) => (row === 0 ? 2 : 1)
  const go = (at: { row: number; col: number }, ...moves: CursorMove[]) =>
    moves.reduce((c, mv) => moveBoxCursor(c, mv, 2, 8, widthOf), at)

  it('←/→ step over a whole box and land on its first column', () => {
    expect(go({ row: 0, col: 2 }, 'right')).toEqual({ row: 0, col: 4 })
    expect(go({ row: 0, col: 3 }, 'right')).toEqual({ row: 0, col: 4 })
    expect(go({ row: 0, col: 2 }, 'left')).toEqual({ row: 0, col: 0 })
    expect(go({ row: 0, col: 3 }, 'left')).toEqual({ row: 0, col: 0 })
    // clamped at the edges, never wrapping
    expect(go({ row: 0, col: 0 }, 'left')).toEqual({ row: 0, col: 0 })
    expect(go({ row: 0, col: 6 }, 'right')).toEqual({ row: 0, col: 6 })
    expect(go({ row: 0, col: 2 }, 'rowEnd')).toEqual({ row: 0, col: 6 })
  })

  it('↑/↓ land on the box playing at the same moment', () => {
    // from a snare box, down to the hat that starts with it — also after ← (which used to
    // leave the cursor on the previous box's LAST column, a hat later)
    expect(go({ row: 0, col: 2 }, 'down')).toEqual({ row: 1, col: 2 })
    expect(go({ row: 0, col: 2 }, 'left', 'down')).toEqual({ row: 1, col: 0 })
    // from the second hat of a snare step, up into that snare step and back to the same hat
    expect(go({ row: 1, col: 3 }, 'up')).toEqual({ row: 0, col: 3 })
    expect(go({ row: 1, col: 3 }, 'up', 'down')).toEqual({ row: 1, col: 3 })
    expect(go({ row: 1, col: 3 }, 'up', 'right')).toEqual({ row: 0, col: 4 })
  })

  it('is moveCursor where every box is one column', () => {
    const moves: CursorMove[] = ['left', 'right', 'up', 'down', 'rowStart', 'rowEnd', 'first', 'last']
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 5; col++)
        for (const mv of moves)
          expect(moveBoxCursor({ row, col }, mv, 3, 5, () => 1), `${row}:${col} ${mv}`).toEqual(
            moveCursor({ row, col }, mv, 3, 5),
          )
  })
})

describe('velocity is never offered on an Exact row', () => {
  it.each(['~ sd ~ sd, hh*8', 'bd*3, hh*4', '<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8', '<bd sd>, hh*4'])(
    '%s',
    (mini) => {
      const m = grid(mini)
      expect(ownStepWidths(m).size).toBeGreaterThan(0)
      // the panel offers a velocity drag only where this writes (`gainScoped`)
      const gains = m.lanes[0].cells.map((c) => (isCellOn(c) ? 0.5 : 1))
      expect(serializeStepGain({ ...m, gains })).toEqual({ kind: 'skip' })
    },
  )
})
