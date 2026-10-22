import { describe, it, expect } from 'vitest'

import type { PianoRollModel, StepGridModel } from '../../../codeView/notation/model'
import { cellOn } from '../../../codeView/notation/model'
import { gainAtStart, setGroupGain, setColumnGain } from '../inspector'

const roll = (notes: PianoRollModel['notes']): PianoRollModel => ({ steps: 4, notes })

describe('gainAtStart', () => {
  it('reads the gain of the group at a start column (default 1)', () => {
    const m = roll([
      { pitch: 'c3', start: 0, duration: 1, gain: 0.5 },
      { pitch: 'e3', start: 2, duration: 1 },
    ])
    expect(gainAtStart(m, 0)).toBe(0.5)
    expect(gainAtStart(m, 2)).toBe(1) // no gain → neutral
    expect(gainAtStart(m, 3)).toBe(1) // no note → neutral
  })
})

describe('setGroupGain — one shared `.gain` write path (PV129)', () => {
  it('sets the gain on every note of the chord at `start`', () => {
    const m = roll([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'e3', start: 0, duration: 1 }, // chord member, shares start
      { pitch: 'g3', start: 2, duration: 1 },
    ])
    const out = setGroupGain(m, 0, 0.4)
    expect(out.notes.filter((n) => n.start === 0).every((n) => n.gain === 0.4)).toBe(true)
    expect(out.notes.find((n) => n.start === 2)?.gain).toBeUndefined() // untouched
  })
})

describe('setColumnGain — per-column step velocity', () => {
  const step = (gains?: number[]): StepGridModel => ({
    steps: 4,
    lanes: [{ sound: 'bd', cells: [cellOn(), false, cellOn(), false] }],
    ...(gains ? { gains } : {}),
  })

  it('seeds a neutral gains array and sets one column', () => {
    const out = setColumnGain(step(), 2, 0.3)
    expect(out.gains).toEqual([1, 1, 0.3, 1])
  })

  it('returns the same model when the value is unchanged (no write)', () => {
    const m = step([1, 1, 1, 1])
    expect(setColumnGain(m, 0, 1)).toBe(m)
  })
})
