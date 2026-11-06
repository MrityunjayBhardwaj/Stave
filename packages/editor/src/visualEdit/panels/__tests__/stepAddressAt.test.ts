/**
 * A click's column names the written step the grid draws there (#2292): the address
 * `toggleStep` takes. Pinned on a nested pattern that opens today, through the same model
 * and tree the panel uses.
 */
import { describe, expect, it } from 'vitest'
import { applyStepEdit, chunkDivisions, parseStepGrid, splitStep, toggleStep, type StepGridModel } from '../../../codeView'
import { laneSteps, leafStops, splitAddressAt, stepAddressAt } from '../gridZoom'

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
    // a euclid step's hits, and its empty places, name the step: each is edited on its own (#2434)
    expect(landsOn('bd(3,8)', 'bd', 3)).toBe('bd(3,8)')
    expect(click('bd(3,8)', 'bd', 3)).toBe('[bd ~ ~ ~ ~ ~ bd ~]')
    expect(click('bd(3,8)', 'bd', 1)).toBe('[bd bd ~ bd ~ ~ bd ~]')
    // an op the writer does not edit is the writer's refusal, given for the hit
    expect(click('bd(<3 5>,8)', 'bd', 3)).toBe('refused: step-is-generated')
    // a hat of a plain `hh*4`, and a copy of `bd!3`, name their step: each is edited on its
    // own (#2326)
    expect(landsOn('bd hh*4', 'hh', 5)).toBe('hh*4')
    expect(click('bd hh*4', 'hh', 4)).toBe('bd [~ hh hh hh]')
    expect(click('bd hh*4', 'hh', 5)).toBe('bd [hh ~ hh hh]')
    expect(landsOn('bd!3', 'bd', 1)).toBe('bd!3')
    expect(click('bd!3', 'bd', 1)).toBe('bd ~ bd')
  })

  it('a column part-way through a plain step splits it, at any depth (#2293)', () => {
    const split = (mini: string, sound: string, col: number): string => {
      const m = grid(mini)
      const trees = chunkDivisions(mini, m.bars ?? 1)
      const li = m.lanes.findIndex((l) => l.sound === sound)
      const got = splitAddressAt(m, trees, li, col)
      if (!got) return 'none'
      const r = splitStep(mini, trees, got.address, got.at, { sound, part: m.lanes[li].part })
      return r.ok ? applyStepEdit(mini, r.edit) : `refused: ${r.why}`
    }
    // `bd` is columns 0–3 of 16: column 2 is its half, column 1 its quarter
    // two equal hits of one sound are `bd*2` (#2326)
    expect(split(MINI, 'bd', 2)).toBe('bd*2 [~ bd] sd [hh [~ cp]]')
    expect(split(MINI, 'bd', 1)).toBe('[bd bd ~ ~] [~ bd] sd [hh [~ cp]]')
    // inside a group: `hh` is columns 12–13
    expect(split(MINI, 'cp', 13)).toBe('bd [~ bd] sd [[hh cp] [~ cp]]')
    // a column where a step begins is no split
    expect(split(MINI, 'bd', 4)).toBe('none')
    // a hat of `hh*4` begins at column 5: a click there is a toggle of that hat, not a split
    expect(split('bd hh*4', 'hh', 5)).toBe('refused: not-inside-the-step')
  })

  it('leafStops: the cursor walks each step at every depth, never a column inside one (#2293)', () => {
    const m = grid(MINI)
    const trees = chunkDivisions(MINI, m.bars ?? 1)
    const stops = (sound: string): number[] => leafStops(laneSteps(m, trees, m.lanes.findIndex((l) => l.sound === sound))!)
    // bd [~ bd] sd [hh [~ cp]] on 16 columns: bd 0, ~ 4, bd 6, sd 8, hh 12, ~ 14, cp 15
    expect(stops('bd')).toEqual([0, 4, 6, 8, 12, 14, 15])
    expect(stops('cp')).toEqual([0, 4, 6, 8, 12, 14, 15])
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
