/**
 * writtenSteps (#1841) — the written steps the parser already recorded, in drawn columns.
 *
 * Every expected value below was read off the model's own regions first (`source.parts[]
 * .regions`, `altSource.regions`) and only then pinned, so these arms say "the drawing
 * follows the model", not "the drawing follows a second reading of the text".
 */
import { describe, expect, it } from 'vitest'
import { parsePianoRoll, parseStepGrid } from '../../../codeView/notation/parse'
import { columnCount } from '../../../codeView/notation/model'
import { UNREFINED } from '../../../codeView/notation/viewResolution'
import { drawnBarStarts, fitLabels, rulerLabels, writtenStepStarts } from '../writtenSteps'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'

/** Strudel's own step count for an element's bytes (`Pattern._steps`, a Fraction) */
const strudelSteps = (raw: string): number => Number((reifyMini(raw.trim()) as { _steps?: unknown })._steps)

const grid = (mini: string, scale = UNREFINED) => {
  const r = parseStepGrid(mini, scale)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const roll = (mini: string) => {
  const r = parsePianoRoll(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const starts = (m: Parameters<typeof writtenStepStarts>[0]) => Object.fromEntries(writtenStepStarts(m))
const labels = (m: Parameters<typeof writtenStepStarts>[0] & { lanes?: unknown }, part = 0) =>
  Object.fromEntries(rulerLabels(m, columnCount(m as never), writtenStepStarts(m).get(part)))

describe('written-step starts, in drawn columns', () => {
  it('a group inside a step: four written steps over eight columns', () => {
    const m = grid('bd [~ bd] sd ~')
    expect(starts(m)).toEqual({ 0: [0, 2, 4, 6] })
    expect(labels(m)).toEqual({ 0: '1', 2: '1.2', 4: '1.3', 6: '1.4' })
  })

  it('`hh*8` is one written step, as the model records it', () => {
    expect(starts(grid('hh*8'))).toEqual({ 0: [0] })
    expect(labels(grid('hh*8'))).toEqual({ 0: '1' })
  })

  it('each `,`-part has its own steps, stretched onto the shared grid by its factor', () => {
    // `bd sd` is 2 own columns stretched ×3 onto the 6 shared ones; `hh*3` is one step
    expect(starts(grid('bd sd, hh*3'))).toEqual({ 0: [0, 3], 1: [0] })
  })

  it('a two-against-three bar keeps both groups as steps', () => {
    expect(starts(grid('[bd sd] [lt mt ht]'))).toEqual({ 0: [0, 6] })
  })

  it('an alternation used as a step repeats its within-bar steps in every bar', () => {
    const m = grid('bd <sd hh>')
    expect(m.altSource).toBeDefined()
    expect(starts(m)).toEqual({ 0: [0, 1, 2, 3] })
    expect(labels(m)).toEqual({ 0: '1', 1: '1.2', 2: '2', 3: '2.2' })
  })

  it('a grid drawn per bar maps through the shared grid (bars of 3 and 2)', () => {
    const m = grid('<bd*3 [sd hh]>')
    expect(m.barSteps).toEqual([3, 2])
    // ⚠ MOVED at #1855: bar 2 is `[sd hh]`, a whole bar in one `[…]`, and draws its two steps
    expect(starts(m)).toEqual({ 0: [0, 3, 4] })
    expect(labels(m)).toEqual({ 0: '1', 3: '2', 4: '2.2' })
  })

  it('a finer Slots view moves the lines with the columns', () => {
    expect(starts(grid('bd [~ bd] sd ~', 2 as never))).toEqual({ 0: [0, 4, 8, 12] })
  })

  it('a leaf-read grid has no written-step regions: bar numbers only', () => {
    const m = grid('<bd [~ bd]>@2 hh@2 bd <bd ~> [hh bd] [~ hh]')
    expect(m.leafSource).toBeDefined()
    expect(starts(m)).toEqual({})
    expect(labels(m)).toEqual({ 0: '1', 16: '2' })
  })

  it('a region set that no longer tiles the model is skipped, not guessed', () => {
    const m = grid('bd [~ bd] sd ~')
    // the writers' covers-check: a width moved out from under the regions
    expect(starts({ ...m, steps: 16 })).toEqual({})
  })

  it('the piano roll reads the same regions', () => {
    expect(starts(roll('c4 [e4 g4] a4 b4'))).toEqual({ 0: [0, 2, 4, 6] })
    // ⚠ MOVED at #1855: each `<…>` bar is a whole bar in one `[…]`, drawn at its own steps (3, then 4)
    expect(starts(roll('<[c3 e3 g3] [c3 e3 g3 b3]>'))).toEqual({ 0: [0, 1, 2, 3, 4, 5, 6] })
  })
})

describe('an element Strudel counts as several steps begins that many (#1845)', () => {
  it('`@` weights count as steps: `bd@3 sd` is four', () => {
    const m = grid('bd@3 sd')
    expect(starts(m)).toEqual({ 0: [0, 1, 2, 3] })
    expect(labels(m)).toEqual({ 0: '1', 1: '1.2', 2: '1.3', 3: '1.4' })
  })

  it('`!` replicas count as steps: `hh!6` is six', () => {
    expect(starts(grid('hh!6'))).toEqual({ 0: [0, 1, 2, 3, 4, 5] })
    // each replica is one step even when it plays several hits
    expect(starts(grid('bd*3!2'))).toEqual({ 0: [0, 3] })
  })

  it('a weighted group splits on its weight, not on its contents', () => {
    expect(starts(grid('[bd sd]@2 hh'))).toEqual({ 0: [0, 1, 2] })
    expect(starts(roll('c4 [e4 g4]@2'))).toEqual({ 0: [0, 2, 4] })
  })

  it('a `,`-part splits in its own columns, then stretches by its factor', () => {
    // `bd!2 sd` is 3 steps stretched ×4 onto `hh*4`'s 12 shared columns
    expect(starts(grid('bd!2 sd, hh*4'))).toEqual({ 0: [0, 4, 8], 1: [0] })
  })

  it('`*n`, Euclid and `<…>` stay one step each, as Strudel counts them', () => {
    expect(starts(grid('hh*8'))).toEqual({ 0: [0] })
    expect(starts(grid('bd(3,8)'))).toEqual({ 0: [0] })
    expect(starts(grid('[~ hh]*4'))).toEqual({ 0: [0] })
  })

  it('the piano roll splits the same way', () => {
    expect(starts(roll('c4@2 e4 g4'))).toEqual({ 0: [0, 1, 2, 3] })
    expect(starts(roll('c4!2 e4'))).toEqual({ 0: [0, 1, 2] })
  })

  it('a region without a weight stays one step', () => {
    const m = grid('bd@3 sd')
    const bare = {
      ...m,
      source: { ...m.source!, parts: m.source!.parts.map((p) => ({ ...p, regions: p.regions.map(({ weight: _w, ...r }) => r) })) },
    }
    expect(starts(bare)).toEqual({ 0: [0, 3] })
  })

  it('every region’s weight is the step count Strudel gives its bytes', () => {
    // agreement with Strudel, checked here — the drawing never calls Strudel
    const cases = ['bd@3 sd', 'hh!6', '[bd sd]@2 hh', 'bd!2 sd, hh*4', 'hh*8', 'bd(3,8)', 'bd*3!2', 'bd [~ bd] sd ~']
    for (const c of cases) {
      for (const p of grid(c).source!.parts) {
        for (const r of p.regions) {
          expect(r.weight, `${c}: ${r.raw}`).toBe(strudelSteps(r.raw))
        }
      }
    }
    for (const c of ['c4@2 e4 g4', 'c4!2 e4', 'c4 [e4 g4]@2']) {
      for (const r of roll(c).source!.parts[0].regions) {
        expect(r.weight, `${c}: ${r.raw}`).toBe(strudelSteps(r.raw))
      }
    }
  })
})

describe('a whole bar written as one `[…]` draws its own steps (#1855)', () => {
  const BEAT = '<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8'

  it('each `<…>` bar of the kick is four steps, like the snare beside it', () => {
    const m = grid(BEAT)
    expect(m.bars).toBe(2)
    expect(starts(m)).toEqual({ 0: [0, 2, 4, 6, 8, 10, 12, 14], 1: [0, 2, 4, 6, 8, 10, 12, 14], 2: [0, 8] })
  })

  it('an edit that splits a part into bars keeps bar 1 drawn as it was; an emptied bar is one step', () => {
    const edited = grid('<[bd ~ bd ~] [bd ~ ~ bd]>, <[~ sd ~ sd] ~>, hh*8')
    expect(starts(edited)[1]).toEqual([0, 2, 4, 6, 8])
    expect(starts(edited)[1].filter((c) => c < 8)).toEqual(starts(grid(BEAT))[1].filter((c) => c < 8))
  })

  it('a pattern that is only a `<…>` of bracketed bars', () => {
    expect(starts(grid('<[bd ~ bd ~] [bd ~ ~ bd]>'))).toEqual({ 0: [0, 1, 2, 3, 4, 5, 6, 7] })
  })

  it('the bar is cut the way its content is: weights count, groups inside stay one step', () => {
    // `bd@3 sd` is four steps; `[bd [sd sd]]` is two, its inner group one of them
    const m = grid('<[bd@3 sd] [bd [sd sd]]>')
    const perBar = m.steps / 2
    expect(starts(m)[0]).toEqual([0, 1, 2, 3].map((k) => (k * perBar) / 4).concat([perBar, perBar * 1.5]))
  })

  it('a bracketed bar beside an unbracketed one: only the bracketed bar splits', () => {
    const m = grid('<bd [sd sd]>')
    const perBar = m.steps / 2
    expect(starts(m)[0]).toEqual([0, perBar, perBar * 1.5])
  })

  it('CONTROL: unbracketed bars stay one step each, and `hh*8` is one step as before', () => {
    const m = grid('<bd sd hh>')
    expect(starts(m)[0]).toEqual([0, m.steps / 3, (2 * m.steps) / 3])
    expect(starts(grid('hh*8'))).toEqual({ 0: [0] })
  })

  it('the piano roll draws the same bars', () => {
    const m = roll('<[c3 e3 g3 b3] [d3 f3]>')
    const perBar = m.steps / 2
    expect(starts(m)[0]).toEqual([0, 1, 2, 3].map((k) => (k * perBar) / 4).concat([perBar, perBar * 1.5]))
  })
})

describe('bar starts come from the panels’ own layout', () => {
  it('uniform bars and bars drawn per bar', () => {
    const two = grid('<bd [sd sd]>')
    expect(drawnBarStarts(two, columnCount(two))).toEqual([0, 2, 4])
    const perBar = grid('<bd*3 [sd hh]>')
    expect(drawnBarStarts(perBar, columnCount(perBar))).toEqual([0, 3, 5])
  })
})

describe('ruler labels that do not fit are hidden, bar numbers first (#1843)', () => {
  // a label box: drawn at `left`, `w` px wide
  const box = (left: number, w: number, bar = false) => ({ left, right: left + w, bar })

  it('labels with room all show', () => {
    expect(fitLabels([box(0, 6, true), box(40, 14), box(80, 14), box(120, 6, true)])).toEqual([true, true, true, true])
  })

  it('a step label that would touch the one before it is hidden, and the next one that clears is shown', () => {
    // 18px columns, labels 18px wide: each would sit flush against the last
    const steps = [box(0, 6, true), box(18, 18), box(36, 18), box(54, 18), box(72, 18)]
    expect(fitLabels(steps)).toEqual([true, true, false, true, false])
  })

  it('a step label is hidden rather than crowd the next bar number', () => {
    expect(fitLabels([box(0, 6, true), box(30, 18), box(50, 6, true)])).toEqual([true, false, true])
  })

  it('bar numbers win over step labels, and crowd only each other', () => {
    // bars every 10px: `10` would touch `9`
    const bars = [box(0, 6, true), box(10, 6, true), box(20, 11, true), box(30, 11, true)]
    expect(fitLabels(bars)).toEqual([true, true, true, false])
  })
})
