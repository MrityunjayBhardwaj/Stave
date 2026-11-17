/**
 * The level a chain's `.gain` plays at each instant (#2467): what the step grids read to refuse a
 * click that would add a hit under a gain rest.
 */
import { describe, expect, it } from 'vitest'
import { gainLevelsAt } from '../gainLevels'
import type { ChunkGain } from '../notation/model'

const str = (mini: string): ChunkGain => ({ mini, numeric: null, foreign: false })
const num = (n: number): ChunkGain => ({ mini: null, numeric: n, foreign: false })
const none: ChunkGain = { mini: null, numeric: null, foreign: false }

describe('gainLevelsAt: what plays at each instant', () => {
  it('reads levels, and null under a rest', () => {
    expect(gainLevelsAt(str('0.5 ~ 1 ~'), [0, 0.25, 0.5, 0.8])).toEqual([0.5, null, 1, null])
    expect(gainLevelsAt(num(0.4), [0, 0.5])).toEqual([0.4, 0.4])
    expect(gainLevelsAt(none, [0])).toEqual([1])
    expect(gainLevelsAt({ mini: null, numeric: null, foreign: true }, [0])).toBeNull()
  })
  it('a rest inside a group or a slow pattern is still a rest', () => {
    expect(gainLevelsAt(str('[1 ~] 0.5'), [0, 0.25, 0.5])).toEqual([1, null, 0.5])
    expect(gainLevelsAt(str('<1 ~>'), [0, 1])).toEqual([1, null])
  })
})
