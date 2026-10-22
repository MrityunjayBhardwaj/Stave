import { describe, it, expect } from 'vitest'

import { planVizAssignment, type VizAssignPlan } from '../vizAssign'

// Apply a plan the same way WorkspaceShell's Writeback does, so the tests
// assert the observable document outcome.
function apply(doc: string, plan: VizAssignPlan | null): string {
  if (!plan) return doc
  if (plan.kind === 'replace') {
    return doc.slice(0, plan.range[0]) + plan.text + doc.slice(plan.range[1])
  }
  return doc.slice(0, plan.offset) + plan.text + doc.slice(plan.offset)
}

describe('planVizAssignment (#832)', () => {
  it('returns null for an empty name', () => {
    expect(planVizAssignment('note("c4")', 5, '')).toBeNull()
  })

  it('returns null when there is no pattern chunk under the cursor', () => {
    // A viz decorates a pattern — with nothing to attach to, no-op.
    expect(planVizAssignment('', 0, 'aurora')).toBeNull()
    expect(planVizAssignment('// scratch', 3, 'aurora')).toBeNull()
  })

  it('appends `.viz("name")` (double-quoted) to the chunk under the cursor', () => {
    const doc = 'note("c4 e4 g4")'
    const plan = planVizAssignment(doc, 5, 'aurora')
    expect(apply(doc, plan)).toBe('note("c4 e4 g4").viz("aurora")')
  })

  it('attaches to a step pattern too (any pattern chunk, not just roll)', () => {
    const doc = 's("bd*4")'
    const plan = planVizAssignment(doc, 4, 'aurora')
    expect(apply(doc, plan)).toBe('s("bd*4").viz("aurora")')
  })

  it('appends after an existing chain', () => {
    const doc = 'note("c4").gain(0.6)'
    const plan = planVizAssignment(doc, 5, 'aurora')
    expect(apply(doc, plan)).toBe('note("c4").gain(0.6).viz("aurora")')
  })

  it('replaces an existing `.viz()` name in place', () => {
    const doc = 'note("c4").viz("pianoroll")'
    const plan = planVizAssignment(doc, 5, 'aurora')
    expect(apply(doc, plan)).toBe('note("c4").viz("aurora")')
  })

  it('replaces only the name, preserving a `.viz()` options object', () => {
    const doc = 'note("c4").viz("pianoroll", { backdrop: true })'
    const plan = planVizAssignment(doc, 5, 'aurora')
    expect(apply(doc, plan)).toBe('note("c4").viz("aurora", { backdrop: true })')
  })

  it('escapes special characters in the name', () => {
    const doc = 'note("c4")'
    const plan = planVizAssignment(doc, 5, 'my "cool" viz')
    expect(apply(doc, plan)).toBe('note("c4").viz("my \\"cool\\" viz")')
  })
})
