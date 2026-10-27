/**
 * #1750 — dragging the edge between two track names sets the Timeline row
 * height so that edge stays under the pointer. Solved against the real lane
 * layout, so every lane shape above the edge (collapsed, expanded, multi-voice)
 * scales exactly as the view draws it.
 */
import { describe, it, expect } from 'vitest'
import { computeLaneLayout, type LaneLayoutInput } from '../laneLayout'
import { rowHeightForEdge } from '../rowEdgeResize'

const lane = (key: string, voices = 0): LaneLayoutInput =>
  ({
    laneKey: key,
    voices: Array.from({ length: voices }, (_, i) => ({ key: `${key}v${i}`, label: `v${i}`, melodic: false })),
  }) as unknown as LaneLayoutInput

const lanes = [lane('a'), lane('b', 3), lane('c'), lane('d')]
const layoutAt = (expanded: ReadonlySet<string>) => (h: number) => computeLaneLayout(lanes, expanded, h, 96, h)
const edgeOf = (expanded: ReadonlySet<string>, h: number, i: number) => {
  const box = layoutAt(expanded)(h).boxes[i]
  return box.top + box.height
}

describe('rowHeightForEdge (#1750)', () => {
  it('puts the grabbed edge under the pointer with collapsed lanes above it', () => {
    const none = new Set<string>()
    // Edge below lane c (index 2): three rows above it → 3h.
    expect(rowHeightForEdge(layoutAt(none), 2, 90, 12, 48)).toBe(30)
    expect(edgeOf(none, 30, 2)).toBe(90)
  })

  it('counts an expanded multi-voice lane above the edge as its voices and its header', () => {
    const b = new Set(['b'])
    // Above the edge below c: a (1 row) + b (header + 3 voices, #2226) + c (1 row) = 6h.
    expect(rowHeightForEdge(layoutAt(b), 2, 120, 12, 48)).toBe(20)
    expect(edgeOf(b, 20, 2)).toBe(120)
  })

  it('picks the nearest whole pixel when the pointer falls between two', () => {
    const none = new Set<string>()
    // Edge below lane b (2 rows): 61 px → 30.5, 62 → 31.
    expect(rowHeightForEdge(layoutAt(none), 1, 62, 12, 48)).toBe(31)
    expect(rowHeightForEdge(layoutAt(none), 1, 60.9, 12, 48)).toBe(30)
  })

  it('stops at the setting\'s range at both ends', () => {
    const none = new Set<string>()
    expect(rowHeightForEdge(layoutAt(none), 0, -40, 12, 48)).toBe(12)
    expect(rowHeightForEdge(layoutAt(none), 0, 5000, 12, 48)).toBe(48)
  })

  it('answers null for an edge that is not there', () => {
    expect(rowHeightForEdge(layoutAt(new Set()), 9, 50, 12, 48)).toBeNull()
  })
})
