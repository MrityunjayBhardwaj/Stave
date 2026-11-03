/**
 * A click's column names the written step the grid draws there (#2292): the address
 * `toggleStep` takes. Pinned on a nested pattern that opens today, through the same model
 * and tree the panel uses.
 */
import { describe, expect, it } from 'vitest'
import { applyStepEdit, chunkDivisions, parseStepGrid, toggleStep, type StepGridModel } from '../../../codeView'
import { stepAddressAt } from '../gridZoom'

const MINI = 'bd [~ bd] sd [hh [~ cp]]'

function grid(mini: string): StepGridModel {
  const g = parseStepGrid(mini)
  if (!g.ok) throw new Error(g.reason)
  return g.model
}

/** the text of the step a click on (lane `sound`, column `col`) lands on, or why none */
function landsOn(mini: string, sound: string, col: number): string {
  const m = grid(mini)
  const trees = chunkDivisions(mini, m.bars ?? 1)
  const li = m.lanes.findIndex((l) => l.sound === sound)
  const at = stepAddressAt(m, trees, li, col)
  return typeof at === 'string' ? `refused: ${at}` : mini.slice(at.span.start, at.span.end).trim()
}

/** what a click on (lane `sound`, column `col`) writes, through the panel's own road */
function click(mini: string, sound: string, col: number): string {
  const m = grid(mini)
  const trees = chunkDivisions(mini, m.bars ?? 1)
  const li = m.lanes.findIndex((l) => l.sound === sound)
  const at = stepAddressAt(m, trees, li, col)
  if (typeof at === 'string') return `refused: ${at}`
  const order = m.lanes.filter((l) => (l.part ?? 0) === (m.lanes[li].part ?? 0)).map((l) => l.sound)
  const r = toggleStep(mini, trees, at, { sound, part: m.lanes[li].part, order })
  return r.ok ? applyStepEdit(mini, r.edit) : `refused: ${r.why}`
}

describe('stepAddressAt — the step a column names', () => {
  it('each step where it begins, at any depth', () => {
    const m = grid(MINI)
    expect(m.steps).toBe(16)
    expect(landsOn(MINI, 'bd', 0)).toBe('bd')
    expect(landsOn(MINI, 'bd', 4)).toBe('~')
    expect(landsOn(MINI, 'bd', 6)).toBe('bd')
    expect(landsOn(MINI, 'cp', 12)).toBe('hh')
    expect(landsOn(MINI, 'cp', 14)).toBe('~')
    expect(landsOn(MINI, 'cp', 15)).toBe('cp')
  })

  it('a column part-way through a step names none', () => {
    expect(landsOn(MINI, 'bd', 1)).toBe('refused: inside-a-step')
    expect(landsOn(MINI, 'cp', 13)).toBe('refused: inside-a-step')
    // a hat that begins part-way through `hh*4` was made by its op, and says so
    expect(landsOn('bd hh*4', 'hh', 5)).toBe('refused: step-is-generated')
    expect(click('bd hh*4', 'hh', 4)).toBe('refused: step-is-generated')
    // and one inside `bd!3` was made by its `!`
    expect(landsOn('bd!3', 'bd', 1)).toBe('refused: step-is-replicated')
  })

  it('a click writes the step’s own text', () => {
    expect(click(MINI, 'bd', 4)).toBe('bd [bd bd] sd [hh [~ cp]]')
    expect(click(MINI, 'bd', 6)).toBe('bd [~ ~] sd [hh [~ cp]]')
    expect(click(MINI, 'cp', 14)).toBe('bd [~ bd] sd [hh [cp cp]]')
    expect(click(MINI, 'cp', 12)).toBe('bd [~ bd] sd [[hh,cp] [~ cp]]')
    // a step repeated by its group: both copies change together
    expect(click('[bd ~]*2 sd', 'bd', 1)).toBe('[bd bd]*2 sd')
    expect(click('[bd ~]*2 sd', 'bd', 3)).toBe('[bd bd]*2 sd')
    expect(click('[bd ~]*2 sd', 'bd', 2)).toBe('[~ ~]*2 sd')
  })
})
