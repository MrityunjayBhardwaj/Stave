/**
 * laneIdentity.test.ts — the source-containment reconciler (#1101).
 *
 * The lane-KEY copy (`resolveLaneKey`) and its drift guard against the editor's
 * `laneKeyOf` were retired in #1943: the app reads `laneKeyOf` from
 * `@stave/editor` now, and the editor's `songAnalysis.test.ts` covers it.
 */
import { describe, it, expect } from 'vitest'
import { containingAnchor } from '../laneIdentity'

describe('containingAnchor — the one source-containment reconciler (#1101)', () => {
  // Ascending, as every caller must supply. Two `$:` statements at 0 and 23.
  const anchors = [
    ['d1', 0],
    ['d2', 23],
  ] as ReadonlyArray<readonly [string, number]>

  it('attributes an offset to the LARGEST anchor at or before it', () => {
    expect(containingAnchor(anchors, 0)).toBe('d1')
    expect(containingAnchor(anchors, 22)).toBe('d1')
    expect(containingAnchor(anchors, 23)).toBe('d2') // inclusive at the boundary
    expect(containingAnchor(anchors, 999)).toBe('d2')
  })

  it('returns undefined when the offset precedes every anchor', () => {
    // A bare-ref hap whose `loc` points at a `const` above the first statement —
    // it belongs to no declared track, and a guess would fold it into one.
    expect(containingAnchor([['d1', 10]], 4)).toBeUndefined()
  })

  it('returns undefined for an absent or non-finite offset, never a guess', () => {
    // A hap with no `loc`, or a row with no statement offset (an unlabelled
    // statement). There is no positional answer, so it must not invent one.
    expect(containingAnchor(anchors, undefined)).toBeUndefined()
    expect(containingAnchor(anchors, NaN)).toBeUndefined()
    expect(containingAnchor(anchors, Infinity)).toBeUndefined()
  })

  it('returns undefined against no anchors at all', () => {
    expect(containingAnchor([], 5)).toBeUndefined()
  })

  it('MISANSWERS unsorted input — the ascending precondition is load-bearing', () => {
    // The scan keeps the last anchor ≤ `start` and breaks at the first one past it,
    // which only yields "the largest ≤" while the list ascends. This pins the
    // failure so the docstring's precondition is enforced rather than advisory: a
    // caller that forgets to sort gets a confident wrong answer, not an error.
    const descending = [
      ['d2', 23],
      ['d1', 0],
    ] as ReadonlyArray<readonly [string, number]>
    // Correct answers on this data are d2 (for 30) and d1 (for 5). Both are wrong:
    expect(containingAnchor(descending, 30)).toBe('d1') // keeps scanning past d2
    expect(containingAnchor(descending, 5)).toBeUndefined() // breaks at d2 immediately
    // …and are right once sorted, which is what every call site does.
    const ascending = [...descending].sort((a, b) => a[1] - b[1])
    expect(containingAnchor(ascending, 30)).toBe('d2')
    expect(containingAnchor(ascending, 5)).toBe('d1')
  })
})
