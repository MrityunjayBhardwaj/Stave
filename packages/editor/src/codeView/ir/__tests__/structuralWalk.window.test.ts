/**
 * structuralWalk over a WINDOW that does not start at cycle 0 (#1209).
 *
 * ── WHY THESE ARMS EXIST ────────────────────────────────────────────────────
 * The Song view can now page: it shows `[origin, origin + span)` for an origin
 * the transport advances. Every producer feeding it has to follow. The walk was
 * the last one that did not — it derived arrange arms over `[0, span)` at every
 * origin, so a paged window drew the FIRST window's clips.
 *
 * ⚠ EVERY ARM BELOW USES A NON-ZERO ORIGIN ON PURPOSE. At origin 0 a
 * window-blind walk and a correct one return the identical result, so an arm
 * written there cannot tell them apart — which is exactly why the defect
 * survived a suite that already covered this function well. The arms are
 * paired: the same code, walked over two different windows, must disagree.
 *
 * Grounded in the walk's own arithmetic rather than assumed: `Arrange` selects
 * its arm with `ctx.cycle % period`, a pure function of the cycle, so cycle 256
 * can be reached without walking the 256 cycles before it. That is what makes a
 * banded walk both correct AND flat with depth.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { structuralWalk, walkLeafItemsInWindow, wholeWalkWindow } from '../structuralWalk'

/** arm0 → cycles 0-1, arm1 → 2-3, arm2 → 4-7, repeating with period 8. */
const CODE = '$: arrange([2, s("bd")], [2, s("hh")], [4, s("cp")])'

function armsOver(code: string, originCycle: number, spanCycles: number): Array<number | null> {
  const lane = structuralWalk(parseStrudel(code), { originCycle, spanCycles }).find(
    (l) => l.laneKey === 'd1',
  )
  return (lane?.armByCycle ?? new Array<number | undefined>(spanCycles)).map((x) => x ?? null)
}

describe('structuralWalk follows the window origin (#1209)', () => {
  it('walks the arms that play in the window, not the ones at the start of the song', () => {
    // Cycles 4-7 are arm2 throughout; cycles 0-3 are arms 0 and 1. A walk that
    // ignored the origin would return the latter for both.
    expect(armsOver(CODE, 0, 4)).toEqual([0, 0, 1, 1])
    expect(armsOver(CODE, 4, 4)).toEqual([2, 2, 2, 2])
  })

  it('indexes armByCycle WINDOW-relative — slot 0 is the origin, not song cycle 0', () => {
    // Period 8, so cycles 8-11 repeat cycles 0-3. Window-relative indexing is
    // what makes the deep window's array 4 long instead of 12 with 8 holes.
    const deep = armsOver(CODE, 8, 4)
    expect(deep).toHaveLength(4)
    expect(deep).toEqual([0, 0, 1, 1])
  })

  it('is FLAT with depth — a deep window walks its own cycles only', () => {
    // The leaf walk is the cost. A prefix walk to serve `[512, 516)` would emit
    // items for 516 cycles; a banded one emits items for 4. This is the property
    // the band accessor bought on the onset side, held on the structure side.
    const ir = parseStrudel(CODE)
    const shallow = walkLeafItemsInWindow(ir, { originCycle: 0, spanCycles: 4 })
    const deep = walkLeafItemsInWindow(ir, { originCycle: 512, spanCycles: 4 })
    expect(deep).toHaveLength(shallow.length)
    // ...and the items it DOES emit carry song-absolute cycles, which is what
    // lets the consumer put the origin back on when it publishes a clip.
    expect(deep.map((it) => it.cycle)).toEqual([512, 513, 514, 515])
  })

  it('`wholeWalkWindow` is the unpaged case, unchanged', () => {
    expect(armsOver(CODE, 0, 8)).toEqual([0, 0, 1, 1, 2, 2, 2, 2])
    const lane = structuralWalk(parseStrudel(CODE), wholeWalkWindow(8)).find(
      (l) => l.laneKey === 'd1',
    )
    expect((lane?.armByCycle ?? []).map((x) => x ?? null)).toEqual([0, 0, 1, 1, 2, 2, 2, 2])
  })

  it('keeps the lane ANCHORS a paged window still needs', () => {
    // A window that reaches a lane must annotate it: the label anchor drives the
    // display name and the hap→lane join, the combinator anchor drives clip
    // write-back. Both are source offsets, so they do not move with the window.
    const at0 = structuralWalk(parseStrudel(CODE), { originCycle: 0, spanCycles: 4 })[0]
    const at512 = structuralWalk(parseStrudel(CODE), { originCycle: 512, spanCycles: 4 })[0]
    expect(at512.laneKey).toBe(at0.laneKey)
    expect(at512.dollarPos).toBe(at0.dollarPos)
    expect(at512.arrangeOffset).toBe(at0.arrangeOffset)
  })

  it('degenerate windows are empty rather than wrong', () => {
    expect(armsOver(CODE, 4, 0)).toEqual([])
    expect(structuralWalk(parseStrudel(CODE), { originCycle: -5, spanCycles: 2 })[0]?.armByCycle)
      // A negative origin clamps to 0 — the whole-song case — never to a
      // window the song does not have.
      .toEqual([0, 0])
  })
})
