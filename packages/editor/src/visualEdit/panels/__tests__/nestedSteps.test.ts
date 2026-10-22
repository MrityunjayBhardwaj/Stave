/**
 * Exact grid (#1861) — a written step that holds several hits is drawn as one step with its
 * hits inside; a plain step cut into columns is one box with faint halves.
 *
 * The step edges are the parser's own regions (`writtenStepStarts`, the step lines already
 * drawn); whether a step is plain is read off the row's coverage (`laneCoverage`). Every
 * expectation below was read off the model first.
 */
import { describe, expect, it } from 'vitest'
import { parseStepGrid } from '../../../codeView/notation/parse'
import { isCellOn, laneCoverage } from '../../../codeView/notation/model'
import { groupBoxesBySteps, ownStepWidths, rowBoxes, writtenStepStarts } from '../writtenSteps'

const grid = (mini: string) => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}

/** each row as its written steps: `P` plain, `H` holds, with the box count */
function rows(mini: string): Record<string, string> {
  const m = grid(mini)
  const starts = writtenStepStarts(m)
  const widths = ownStepWidths(m)
  const out: Record<string, string> = {}
  const covs = m.lanes.map((l) => laneCoverage(l.cells, m.steps))
  m.lanes.forEach((lane) => {
    const part = lane.part ?? 0
    const owners = m.lanes.flatMap((l, i) => ((l.part ?? 0) === part ? [(c: number) => covs[i][c]?.start] : []))
    const boxes = rowBoxes(lane.cells, m.steps, widths.get(part), isCellOn)
    const g = groupBoxesBySteps(boxes, starts.get(part), m.steps, owners)
    out[lane.sound] = g.map((s) => (s.boxes.length === 1 ? '1' : `${s.plain ? 'P' : 'H'}${s.boxes.length}`)).join(' ')
  })
  return out
}

describe('groupBoxesBySteps — rows as the text writes them', () => {
  it('hh*8 alone is one step holding 8 hits', () => {
    expect(rows('hh*8')).toEqual({ hh: 'H8' })
  })

  it('a group holds its hits and rests; the plain steps beside it are one box each', () => {
    // bd [~ bd] sd ~ : 8 columns, 4 written steps
    expect(rows('bd [~ bd] sd ~')).toEqual({ bd: 'P2 H2 P2 P2', sd: 'P2 H2 P2 P2' })
  })

  it('a plain step cut by its sibling is one box with halves', () => {
    expect(rows('bd hh*2 sd cp')).toEqual({ bd: 'P2 H2 P2 P2', hh: 'P2 H2 P2 P2', sd: 'P2 H2 P2 P2', cp: 'P2 H2 P2 P2' })
  })

  it('euclid is one step holding its pulses', () => {
    expect(rows('bd(3,8)')).toEqual({ bd: 'H8' })
  })

  it('rows of a `,`-stack follow their own part', () => {
    // the snare part is stretched (boxes 2 wide) and flat: one box per step
    expect(rows('~ sd ~ sd, hh*8')).toEqual({ sd: '1 1 1 1', hh: 'H8' })
    // `bd [sd sd]` shares a part: the second step holds the snares, and the kick row draws it
    // subdivided too (empty inside), as the text writes it for the whole part
    expect(rows('bd [sd sd], hh*8')).toEqual({ bd: 'P2 H2', sd: 'P2 H2', hh: 'H8' })
  })

  it('steps with one column each are drawn exactly as today', () => {
    expect(rows('bd sd hh cp')).toEqual({ bd: '1 1 1 1', sd: '1 1 1 1', hh: '1 1 1 1', cp: '1 1 1 1' })
  })

  it('a note held across a step edge keeps that step plain', () => {
    // bd@3 is 3 written steps of one column (weight splits, #1845)
    expect(rows('bd@3 sd')).toEqual({ bd: '1 1 1 1', sd: '1 1 1 1' })
  })

  it('without starts, or when a box straddles a step edge, every box stands alone', () => {
    const b = [
      { start: 0, width: 2 },
      { start: 2, width: 2 },
    ]
    expect(groupBoxesBySteps(b, undefined, 4, [() => undefined]).map((g) => g.boxes.length)).toEqual([1, 1])
    // a step edge at column 1 cuts the first box
    expect(groupBoxesBySteps(b, [0, 1], 4, [() => undefined]).map((g) => g.boxes.length)).toEqual([1, 1])
  })
})
