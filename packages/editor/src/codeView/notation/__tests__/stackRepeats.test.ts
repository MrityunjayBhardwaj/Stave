/**
 * A `,`-stack whose parts are written over different numbers of bars (#1849).
 *
 * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8` plays for two bars: the kick is written
 * over two, the snare and hats over one, and Strudel plays those again in bar 2 (`stack`
 * asks every part for the same cycle). The grid draws two bars, and an edit in bar b
 * changes bar b only: the edited part is written `<bar1 bar2>`, every other bar and every
 * other part byte for byte, and a part whose bars agree again goes back to one bar.
 */
import { describe, expect, it } from 'vitest'
import { mini as reify } from '@strudel/mini/mini.mjs'
import { parseStepGrid } from '../parse'
import { serializeStepGrid } from '../serialize'
import { toggleCell } from '../place'
import { collapseStepGridToDocument } from '../resolution'
import type { StepGridModel } from '../model'
import { writtenStepStarts } from '../../../visualEdit/panels/writtenSteps'

const BEAT = '<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8'
const KICK = '<[bd ~ bd ~] [bd ~ ~ bd]>'
const CORPUS = 'bd bd bd bd, - sd - sd, <[cr oh hh oh hh oh hh oh] [hh oh]*4!3>'

function open(mini: string): StepGridModel {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.model
}
const lane = (m: StepGridModel, sound: string): number => {
  const i = m.lanes.findIndex((l) => l.sound === sound)
  if (i < 0) throw new Error(`no ${sound} lane`)
  return i
}
/** the columns a sound is struck in */
const hits = (m: StepGridModel, sound: string): number[] =>
  m.lanes[lane(m, sound)].cells.flatMap((c, i) => (c ? [i] : []))
/**
 * toggle, write, and check the text reads back as the model that was edited. `'step'`
 * adds a hit one of the part's OWN steps long — a copy of a hit it already has — since a
 * click on a coarser part's own step still paints half of it (#1853).
 */
function edit(mini: string, sound: string, col: number, value: boolean | 'step'): string {
  const m = open(mini)
  const li = lane(m, sound)
  const own = m.lanes[li].cells.find((c) => c)
  const next =
    value === 'step'
      ? { ...m, lanes: m.lanes.map((l, i) => (i === li ? { ...l, cells: l.cells.map((c, j) => (j === col ? own! : c)) } : l)) }
      : toggleCell(m, li, col, value)
  expect(next, `the ${sound} toggle at ${col} must be admitted`).not.toBe(m)
  return written(next)
}
function written(next: StepGridModel): string {
  const out = serializeStepGrid(next)
  expect(out).not.toBeNull()
  // what you clicked is what the text holds: no bar changes on the re-read
  const back = open(out!)
  for (const l of next.lanes) {
    const shown = next.lanes.filter((x) => x.sound === l.sound).flatMap((x) => x.cells.map((c, i) => (c ? i : -1)))
    const read = back.lanes.filter((x) => x.sound === l.sound).flatMap((x) => x.cells.map((c, i) => (c ? i : -1)))
    expect(new Set(read.filter((i) => i >= 0)), `${l.sound} on re-read of ${out}`).toEqual(
      new Set(shown.filter((i) => i >= 0)),
    )
  }
  return out!
}
/** what Strudel plays in cycle `c`, as sorted `begin value` rows */
function heard(mini: string, c: number): string[] {
  type H = { whole?: { begin: { valueOf(): number } }; value: unknown; hasOnset?: () => boolean }
  return (reify(mini) as unknown as { queryArc(a: number, b: number): H[] })
    .queryArc(c, c + 1)
    .filter((h) => h.hasOnset?.() !== false)
    .map((h) => `${(h.whole!.begin.valueOf() - c).toFixed(4)} ${JSON.stringify(h.value)}`)
    .sort()
}

describe('a stack with a `<…>` part reads bar by bar (#1849)', () => {
  it('opens with its source: 2 bars, the kick written over 2, snare and hats over 1', () => {
    const m = open(BEAT)
    expect(m.leafSource).toBeUndefined()
    expect(m.bars).toBe(2)
    expect(m.steps).toBe(16)
    expect(m.source?.parts.map((p) => p.bars)).toEqual([2, 1, 1])
    // what Strudel plays: kick changes per bar, the snare is the same bar twice
    expect(hits(m, 'bd')).toEqual([0, 4, 8, 14])
    expect(hits(m, 'sd')).toEqual([2, 6, 10, 14])
    expect(hits(m, 'hh')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(serializeStepGrid(m)).toBe(BEAT)
  })

  it('step lines are drawn in every bar', () => {
    const m = open(BEAT)
    expect(writtenStepStarts(m).get(m.lanes[lane(m, 'sd')].part!)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
  })
})

describe('an edit in bar b changes bar b only (#1849)', () => {
  // [sound, column, on, the code after] — column 8 is bar 2's downbeat
  const TABLE: [string, string, number, boolean | 'step', string][] = [
    ['remove the second snare', 'sd', 14, false, `${KICK}, <[~ sd ~ sd] [~ sd ~ ~]>, hh*8`],
    ['add a snare on step 3', 'sd', 12, 'step', `${KICK}, <[~ sd ~ sd] [~ sd sd sd]>, hh*8`],
    ['remove the 4th hat', 'hh', 11, false, `${KICK}, ~ sd ~ sd, <hh*8 [hh hh hh ~ hh hh hh hh]>`],
    ['add a kick between steps', 'bd', 11, true, '<[bd ~ bd ~] [bd _ ~ bd ~ ~ bd _]>, ~ sd ~ sd, hh*8'],
  ]
  for (const [what, sound, col, on, after] of TABLE) {
    it(`${what} in bar 2 → ${after}`, () => {
      const out = edit(BEAT, sound, col, on)
      expect(out).toBe(after)
      // Strudel: bar 1 plays exactly as before, bar 2 changes, and the pair loops
      expect(heard(out, 0)).toEqual(heard(BEAT, 0))
      expect(heard(out, 2)).toEqual(heard(BEAT, 2))
      expect(heard(out, 1)).not.toEqual(heard(BEAT, 1))
      expect(heard(out, 3)).toEqual(heard(out, 1))
    })
  }

  it('a bar emptied by edits is one rest, so it draws no steps over nothing', () => {
    const one = edit(BEAT, 'sd', 10, false)
    const out = edit(one, 'sd', 14, false)
    expect(out).toBe(`${KICK}, <[~ sd ~ sd] ~>, hh*8`)
    const m = open(out)
    // bar 2 of the snare has no step lines of its own
    expect(writtenStepStarts(m).get(m.lanes[lane(m, 'sd')].part!)!.filter((c) => c > 8)).toEqual([])
    expect(heard(out, 0)).toEqual(heard(BEAT, 0))
    expect(heard(out, 1)).toEqual(heard(`${KICK}, ~, hh*8`, 1))
    // …the same as the hats, which spell one element
    let hats = BEAT
    for (let c = 8; c < 16; c++) hats = edit(hats, 'hh', c, false)
    expect(hats).toBe(`${KICK}, ~ sd ~ sd, <hh*8 ~>`)
  })

  it('an edit in bar 1 of a repeating part leaves bar 2 as it was', () => {
    expect(edit(BEAT, 'sd', 6, false)).toBe(`${KICK}, <[~ sd ~ ~] [~ sd ~ sd]>, hh*8`)
  })

  it('a part whose bars agree again goes back to one bar', () => {
    const snare = `${KICK}, <[~ sd ~ sd] [~ sd ~ ~]>, hh*8`
    expect(edit(snare, 'sd', 14, 'step')).toBe(BEAT)
    const hats = `${KICK}, ~ sd ~ sd, <hh*8 [hh hh hh ~ hh hh hh hh]>`
    expect(edit(hats, 'hh', 11, 'step')).toBe(BEAT)
  })

  it('a one-bar part in a four-bar stack, edited in bar 3 → <A A B A>', () => {
    const four = '<[bd ~] [bd bd] [~ bd] [bd ~]>, ~ sd'
    const m = open(four)
    expect(m.bars).toBe(4)
    // bar 3 of 4: its snare is the second of that bar's two steps
    const col = 2 * (m.steps / 4) + m.steps / 8
    // bar 3, emptied, is one rest
    const out = edit(four, 'sd', col, false)
    expect(out).toBe('<[bd ~] [bd bd] [~ bd] [bd ~]>, <[~ sd] [~ sd] ~ [~ sd]>')
    for (const c of [0, 1, 3]) expect(heard(out, c)).toEqual(heard(four, c))
  })

  it('a two-bar part in a four-bar stack, edited in bar 3 → <A B C B>', () => {
    const four = '<[bd ~] [bd bd] [~ bd] [bd ~]>, <[~ sd] [sd ~]>'
    const m = open(four)
    const col = 2 * (m.steps / 4) + m.steps / 8
    // an emptied bar is one rest, the way any emptied element is re-emitted
    const out = edit(four, 'sd', col, false)
    expect(out).toBe('<[bd ~] [bd bd] [~ bd] [bd ~]>, <[~ sd] [sd ~] ~ [sd ~]>')
    for (const c of [0, 1, 3]) expect(heard(out, c)).toEqual(heard(four, c))
    expect(heard(out, 2)).toEqual(heard('<[bd ~] [bd bd] [~ bd] [bd ~]>', 2))
  })

  it('edits in two bars at once — a nudge across the bar line — are written', () => {
    const m = open(BEAT)
    const sd = lane(m, 'sd')
    // the bar-1 snare on column 6 moves to bar 2's downbeat
    const cells = m.lanes[sd].cells.map((c, i) => (i === 6 ? false : i === 8 ? m.lanes[sd].cells[6] : c))
    const moved: StepGridModel = { ...m, lanes: m.lanes.map((l, i) => (i === sd ? { ...l, cells } : l)) }
    expect(written(moved)).toBe(`${KICK}, <[~ sd ~ ~] [sd sd ~ sd]>, hh*8`)
  })

  it('the corpus shape: a kick written once beside a four-bar hats part', () => {
    const m = open(CORPUS)
    expect(m.bars).toBe(4)
    expect(m.source?.parts.map((p) => p.bars)).toEqual([1, 1, 4])
    expect(serializeStepGrid(m)).toBe(CORPUS)
    // the second kick of bar 3 — bar 3 only
    const col = 2 * (m.steps / 4) + 2
    expect(edit(CORPUS, 'bd', col, false)).toBe(
      '<[bd bd bd bd] [bd bd bd bd] [bd ~ bd bd] [bd bd bd bd]>, - sd - sd, <[cr oh hh oh hh oh hh oh] [hh oh]*4!3>',
    )
  })

  it('a lone weighted bar is bracketed inside <…>, where `!2` would claim a second bar', () => {
    const bang = '<[bd ~] [bd bd]>, sd!2'
    const m = open(bang)
    // the second snare of bar 2
    const out = edit(bang, 'sd', m.steps / 2 + m.steps / 4, false)
    expect(out).toBe('<[bd ~] [bd bd]>, <[sd!2] [sd ~]>')
    expect(heard(out, 0)).toEqual(heard(bang, 0))
    expect(heard(out, 1)).toEqual(heard('<[bd ~] [bd bd]>, sd ~', 1))
  })

  it('a part written as <A A> by hand stays as written while another part is edited', () => {
    const hand = '<[bd ~] [bd ~]>, <[~ sd] [~ sd]>'
    const m = open(hand)
    expect(m.bars).toBe(2)
    expect(serializeStepGrid(m)).toBe(hand)
    // the second kick step of bar 2
    expect(edit(hand, 'bd', m.steps / 2 + m.steps / 4, true)).toBe('<[bd ~] [bd bd]>, <[~ sd] [~ sd]>')
  })

  it('a ×2 view comes back to the document, so zooming never respells the file (#1057)', () => {
    // halving passes through a model whose regions still describe ×2, and the two-bar
    // part must rebuild bar by bar there rather than decline
    for (const mini of [BEAT, CORPUS, 'c2 c2 c2 c2 , < [~ g1 ~ ~] [~ ~ ~ g1] >']) {
      const r = parseStepGrid(mini, 2)
      if (!r.ok) throw new Error(`×2 refused ${mini}`)
      const back = collapseStepGridToDocument(r.model)
      expect(back, mini).not.toBeNull()
      expect(serializeStepGrid(back!)).toBe(mini)
    }
  })

  it('CONTROL: a stack that plays one bar is written exactly as before', () => {
    const m = open('bd sd, hh*4')
    expect(m.bars).toBeUndefined()
    expect(m.source?.parts.every((p) => p.bars === undefined)).toBe(true)
    expect(edit('bd sd, hh*4', 'bd', 1, true)).toBe('[bd bd] sd, hh*4')
  })
})
