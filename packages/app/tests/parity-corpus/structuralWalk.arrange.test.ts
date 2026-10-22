/**
 * structuralWalk arrange arm-bucketing gate (#974, part of the collect.ts split #945).
 *
 * Regression guard for a bug the 57-tune corpus never exercised and only the real-app arrange
 * e2e caught: an `arrange(...)` whose arms span MORE than one cycle each. structuralWalk descends
 * into the selected arm with a SELECTION cycle (arm-local), and the leaf it reaches must still be
 * bucketed under the OUTER SONG cycle. Conflating the two put every arm on its arm-local 0..w-1
 * (last-write-wins → `[2,2,2,2,null,…]`) instead of `[0,0,1,1,2,2,2,2]`, so a clip-split gesture on
 * a multi-cycle arrange lane targeted the wrong cycle and silently no-op'd.
 *
 * Pinned against the expected bucketing directly (previously against collect's own bucketing;
 * collect is retired). The multi-track fixture is frozen as a committed snapshot.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { structuralWalk, wholeWalkWindow } from '../../../editor/src/codeView/ir/structuralWalk'

function walkArmByCycle(code: string, laneKey: string, n: number): Array<number | null> {
  const lane = structuralWalk(parseStrudel(code), wholeWalkWindow(n)).find((l) => l.laneKey === laneKey)
  return (lane?.armByCycle ?? new Array<number | undefined>(n)).map((x) => x ?? null)
}

describe('structuralWalk buckets arrange arms by the OUTER song cycle (#974)', () => {
  it('multi-cycle arms land on the cycles they play', () => {
    // arm0 weight2 → cycles 0-1, arm1 weight2 → 2-3, arm2 weight4 → 4-7.
    const code = '$: arrange([2, s("bd")], [2, s("hh")], [4, s("cp")])'
    expect(walkArmByCycle(code, 'd1', 8)).toEqual([0, 0, 1, 1, 2, 2, 2, 2])
  })

  it('the multi-track fixture the e2e split-gesture uses (d1 arrange, two sibling $: tracks)', () => {
    const code = [
      '$: arrange([2, s("bd")], [2, s("hh")], [4, s("cp")])',
      '$: s("bd*2, ~ sd, hh*8").bank("RolandTR909")',
      '$: note("c2 eb2 g2 c3").s("sawtooth").slow(2)',
    ].join('\n')
    expect(walkArmByCycle(code, 'd1', 8)).toMatchSnapshot()
  })

  it('single-cycle arms still bucket one-per-cycle (the corpus shape, unregressed)', () => {
    const code = '$: arrange([1, s("bd")], [1, s("hh")], [1, s("cp")])'
    expect(walkArmByCycle(code, 'd1', 3)).toEqual([0, 1, 2])
  })
})
