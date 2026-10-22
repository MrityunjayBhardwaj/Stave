/**
 * A section that plays nothing is still a section (#1710).
 *
 * Add section (#1461) writes `[n, silence]` and a gap Delete (#491) turns an arm
 * into one. The walk used to learn which arm owns a cycle only from the LEAVES it
 * reached there, so a silent arm left `undefined` in `armByCycle`, no clip was
 * built over it, and the one section the user had just made could not be
 * selected, moved, deleted or filled from the canvas.
 *
 * The arms below pin the three things the fix must hold at once: the silent span
 * is owned by its arm; a note always outranks a rest; and nothing the leaves
 * decide (lane order, anchors, the leaf stream itself) moves.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import {
  aggregateLaneItems,
  structuralWalk,
  walkLeafItems,
  walkLeafItemsInWindow,
  wholeWalkWindow,
} from '../structuralWalk'

function lane(code: string, key: string, originCycle = 0, spanCycles = 10) {
  return structuralWalk(parseStrudel(code), { originCycle, spanCycles }).find((l) => l.laneKey === key)
}
const arms = (l: ReturnType<typeof lane>, n: number) =>
  (l?.armByCycle ?? new Array<number | undefined>(n)).map((x) => x ?? null)

describe('a silent arrange arm owns its cycles (#1710)', () => {
  it('the section Add section writes gets its span — the issue\'s own document', () => {
    const code = 'drums: arrange([2, s("bd")], [2, s("bd")], [4, s("hh*2")], [2, s("hh*2")], [2, silence])'
    const l = lane(code, 'drums', 0, 12)
    expect(arms(l, 12)).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4])
    // …and carries the `[2, silence]` tuple's range, so its caption and its
    // write-back resolve the arm the user sees.
    const r = l?.armRanges?.get(4)
    expect(r && code.slice(r[0], r[1])).toBe('[2, silence]')
  })

  it('a leading rest leaves the lane anchored on the notes, not on the call', () => {
    const code = 'drums: arrange([2, silence], [2, s("bd")])'
    const l = lane(code, 'drums', 0, 4)
    expect(arms(l, 4)).toEqual([0, 0, 1, 1])
    expect(l?.sourceOffset).toBe(code.indexOf('bd'))
    expect(l?.arrangeOffset).toBe(code.indexOf('[2, s("bd")]'))
  })

  it('a gap Delete\'s arm in the MIDDLE of a song closes the hole', () => {
    const code = '$: arrange([2, s("bd")], [2, silence], [2, s("hh")])'
    expect(arms(lane(code, 'd1', 0, 6), 6)).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('a note outranks a rest on the same lane and cycle', () => {
    // Two arrangements on one lane. At cycles 2-3 the first rests in its arm 0
    // while the second PLAYS its arm 1 — the slot is the note's. (At 0-1 both
    // name arm 0, so only 2-3 can tell a rest-wins walk from a note-wins one.)
    const code = 'drums: stack(arrange([4, silence]), arrange([2, s("hh")], [2, s("cp")]))'
    expect(arms(lane(code, 'drums', 0, 4), 4)).toEqual([0, 0, 1, 1])
  })

  it('a silent INNER arm marks the OUTER section, as its notes would', () => {
    const code = 'drums: arrange([4, arrange([2, s("bd")], [2, silence])], [2, s("hh")])'
    expect(arms(lane(code, 'drums', 0, 6), 6)).toEqual([0, 0, 0, 0, 1, 1])
  })

  it('a paged window inside a long rest still has the section', () => {
    const code = 'drums: arrange([2, s("bd")], [8, silence])'
    const l = lane(code, 'drums', 4, 4)
    expect(arms(l, 4)).toEqual([1, 1, 1, 1])
    // A rest has no source position, so a lane only it names carries no anchors;
    // the consumer backfills those from the whole-song walk (#1209).
    expect(l?.dollarPos).toBeUndefined()
    expect(l?.sourceOffset).toBeUndefined()
  })

  it('an unlabelled expression is a track too — its rest lands on `d1`', () => {
    const code = 'arrange([2, s("bd")], [2, silence])'
    const lanes = structuralWalk(parseStrudel(code), wholeWalkWindow(4))
    expect(lanes.map((l) => l.laneKey)).toEqual(['d1'])
    expect(arms(lanes[0], 4)).toEqual([0, 0, 1, 1])
  })

  it('the leaf stream is unchanged — a rest is not a leaf', () => {
    const code = 'drums: arrange([2, s("bd")], [2, silence])'
    const items = walkLeafItems(parseStrudel(code), 4)
    expect(items.map((i) => i.cycle)).toEqual([0, 1])
  })

  it('lanes, their order and their anchors are exactly what the leaves alone give', () => {
    // `a` rests first, so `b` is first-seen — that order is the leaves', and it
    // must not change because `a`'s rest was walked at cycle 0.
    const code = 'a: arrange([2, silence], [2, s("bd")])\nb: s("hh")'
    const ir = parseStrudel(code)
    const window = wholeWalkWindow(4)
    const withRests = structuralWalk(ir, window)
    const leavesOnly = aggregateLaneItems(walkLeafItemsInWindow(ir, window), window)
    const strip = (ls: typeof withRests) => ls.map(({ armByCycle: _a, armRanges: _r, ...rest }) => rest)
    expect(strip(withRests)).toEqual(strip(leavesOnly))
    expect(withRests.map((l) => l.laneKey)).toEqual(['b', 'a'])
  })
})
