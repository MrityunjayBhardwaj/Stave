import { describe, it, expect } from 'vitest'
import { parseStepGrid } from '../parse'
import { serializeStepGrid } from '../serialize'
import { addLane, removeLane } from '../lane'
import { cellOn } from '../model'
import type { StepGridModel } from '../model'

function parse(s: string): StepGridModel {
  const r = parseStepGrid(s)
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`)
  return r.model
}

describe('addLane / removeLane (#516)', () => {
  it('addLane stages an all-rest voice — text unchanged until a hit', () => {
    const m = addLane(parse('bd ~ sd ~'), 'hh')
    expect(m.lanes.map((l) => l.sound)).toEqual(['bd', 'sd', 'hh'])
    expect(m.lanes[2].cells).toEqual([false, false, false, false])
    // an empty lane contributes nothing → serialized text is identical (staging)
    expect(serializeStepGrid(m)).toBe('bd ~ sd ~')
  })

  it('a hit in the new voice writes it into the pattern (stacks per column)', () => {
    const m = addLane(parse('bd ~ sd ~'), 'hh')
    const li = m.lanes.length - 1
    const withHit: StepGridModel = {
      ...m,
      lanes: m.lanes.map((l, i) =>
        i === li ? { ...l, cells: [cellOn(), false, false, false] } : l,
      ),
    }
    expect(serializeStepGrid(withHit)).toBe('[bd,hh] ~ sd ~')
  })

  it('addLane is a no-op for a duplicate or blank sound (returns same ref)', () => {
    const m = parse('bd ~ sd ~')
    expect(addLane(m, 'bd')).toBe(m)
    expect(addLane(m, '   ')).toBe(m)
  })

  it('the new lane inherits the first lane part (no spurious comma-stack)', () => {
    const m = parse('bd ~ sd ~')
    expect(addLane(m, 'hh').lanes[2].part).toBe(m.lanes[0]?.part)
  })

  it('removeLane drops the voice from the serialized output', () => {
    const m = removeLane(parse('bd hh sd hh'), 'hh')
    expect(m.lanes.map((l) => l.sound)).toEqual(['bd', 'sd'])
    expect(serializeStepGrid(m)).toBe('bd ~ sd ~')
  })

  it('removeLane is a no-op for an absent sound (returns same ref)', () => {
    const m = parse('bd ~ sd ~')
    expect(removeLane(m, 'cp')).toBe(m)
  })
})
