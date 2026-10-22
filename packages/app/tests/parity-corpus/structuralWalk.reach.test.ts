/**
 * structuralWalk resilience / reach gate — PV212 (#974, part of the collect.ts split #945).
 *
 * The whole point of keeping a structural walk (instead of routing lanes through the eval-backed
 * hap producer too) is RESILIENCE: syntactically-valid but semantically-invalid code — an
 * unresolved binding, a mid-edit trailing dot, a half-typed call — makes Strudel's `evaluate()`
 * THROW, so `getTimelineEvents` returns no haps and the eval-backed marks are empty. The timeline
 * must still draw its lane SKELETON so the editor doesn't blink to a blank canvas mid-keystroke
 * (never "24 events → 0 blank", spike §4). `structuralWalk` owns that skeleton, and its per-node
 * try/catch degrades a bad sub-node to its own branch instead of blanking the whole walk.
 *
 * This is the committed half of the two-arm gate (Arm B). Arm A — that the eval marks are the
 * correct verdict when evaluation SUCCEEDS — is a browser-fidelity check (headless over-counts,
 * P319), not this file. Here we assert only the structural floor: mid-edit code still has lanes.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { structuralWalk, wholeWalkWindow, type LaneSkeleton } from '../../../editor/src/codeView/ir/structuralWalk'
import { IR, type PatternIR } from '../../../editor/src/codeView/ir/PatternIR'

const N = 4
const walk = (code: string): LaneSkeleton[] => structuralWalk(parseStrudel(code), wholeWalkWindow(N))
const keys = (lanes: LaneSkeleton[]): string[] => lanes.map((l) => l.laneKey)

describe('structuralWalk keeps a lane skeleton for mid-edit / semantically-invalid code (PV212, #974)', () => {
  it('unresolved binding inside one track — the track still gets its lane', () => {
    // `ghostTrack` is an undefined reference: Strudel's evaluate() ReferenceErrors, so the eval
    // marks are empty. A bare `stack(...)` is ONE track (`d1`); the lane skeleton must survive so
    // the timeline shows the row rather than a blank canvas.
    const lanes = walk('stack(s("bd"), ghostTrack, s("cp"))')
    expect(keys(lanes)).toContain('d1')
  })

  it('unresolved binding as a whole track — sibling tracks keep their own lanes', () => {
    // Three `$:` statements, the middle one an undefined reference (its own lane is legitimately
    // empty — nothing to draw), the outer two valid. The valid tracks must keep their lanes.
    const lanes = walk('$: s("bd")\n$: ghostTrack\n$: s("cp")')
    expect(keys(lanes)).toContain('d1')
    expect(keys(lanes)).toContain('d3')
  })

  it('a trailing-dot mid-edit still yields the base voice lane', () => {
    // `s("bd*4").` — the user is mid-chain; evaluate() throws on the dangling member access.
    const lanes = walk('s("bd*4").')
    expect(lanes.length).toBeGreaterThan(0)
  })

  it('a half-typed track next to a complete one — the complete track survives', () => {
    // Two `$:` statements, the second half-typed. The first must keep its lane.
    const lanes = walk('$: s("bd sd")\n$: broken(')
    expect(lanes.length).toBeGreaterThan(0)
  })

  it('does not throw on any of the mid-edit samples (walk is total)', () => {
    for (const code of ['stack(s("bd"), ghostTrack, s("cp"))', 's("bd*4").', '$: s("bd sd")\n$: broken(', 'note(', ')(']) {
      expect(() => walk(code), code).not.toThrow()
    }
  })

  it('per-node resilience: a throwing sub-node degrades only its own branch', () => {
    // Hand-build a Stack whose second arm throws when walked (a malformed node), alongside a
    // valid `s("bd")` track. structuralWalk wraps every child recursion in try/catch, so the
    // valid sibling's lane survives while the bad arm contributes nothing.
    const good: PatternIR = IR.track('d1', IR.play('bd', 0.25, { s: 'bd' }))
    const bad = { tag: 'Stack', tracks: null } as unknown as PatternIR // walking `.tracks` throws
    const stack: PatternIR = { tag: 'Stack', tracks: [good, bad] } as PatternIR
    let lanes: LaneSkeleton[] = []
    expect(() => {
      lanes = structuralWalk(stack, wholeWalkWindow(N))
    }).not.toThrow()
    expect(keys(lanes)).toContain('d1')
  })
})
