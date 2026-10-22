/**
 * perBar.test.ts — each bar of a pattern drawn at its own step count (#1827).
 *
 * What a written result PLAYS is asked of Strudel here, independently of the writers,
 * so a rewrite that spelled plausible text but moved a note would still go red.
 */
import { describe, it, expect } from 'vitest'
import { mini } from '@strudel/mini/mini.mjs'

import { parsePianoRoll, parseStepGrid } from '../parse'
import { serializePianoRoll, serializeStepGrid } from '../serialize'
import { moveNote, placeNote, removeNote, toggleCell } from '../place'
import { drawnAt, perBarLayout, sharedAt } from '../perBar'
import type { PianoRollModel, StepGridModel } from '../model'

/** onsets over `cycles` as `value@start+dur`, sorted — what the pattern plays */
function plays(m: string, cycles: number): string[] {
  type H = { hasOnset(): boolean; value: unknown; whole: { begin: number; end: number } }
  return (mini(m) as unknown as { queryArc(a: number, b: number): H[] })
    .queryArc(0, cycles)
    .filter((h) => h.hasOnset())
    .map((h) => `${JSON.stringify(h.value)}@${+h.whole.begin}+${+h.whole.end - +h.whole.begin}`)
    .sort()
}

function roll(m: string): PianoRollModel {
  const r = parsePianoRoll(m)
  if (!r.ok) throw new Error(r.reason)
  return r.model
}
function grid(m: string): StepGridModel {
  const r = parseStepGrid(m)
  if (!r.ok) throw new Error(r.reason)
  return r.model
}

const THREE_FOUR = '<[c3 e3 g3] [c3 e3 g3 b3]>'
const EIGHT = 'c3 d3 e3 f3 g3 a3 b3 c4'
const SEVEN = 'c3 d3 e3 f3 g3 a3 b3'

describe('perBarLayout — only bars whose counts do not nest', () => {
  it('draws 3 and 4, or 8 and 7, per bar', () => {
    expect(perBarLayout([3, 4])).toEqual([3, 4])
    expect(perBarLayout([8, 7])).toEqual([8, 7])
  })
  it('keeps the uniform layout when every count divides the largest', () => {
    expect(perBarLayout([4, 1])).toBeNull()
    expect(perBarLayout([8, 4, 2])).toBeNull()
    expect(perBarLayout([4, 4])).toBeNull()
    expect(perBarLayout([5])).toBeNull()
  })
})

describe('drawn ↔ shared columns', () => {
  it('are exact inverses on every drawn column and bar boundary', () => {
    const bs = [3, 4]
    for (let d = 0; d <= 7; d++) expect(drawnAt(sharedAt(d, bs), bs)).toBe(d)
    // bar 2 starts at shared column 12 (one bar of the 12-column shared grid)
    expect(sharedAt(3, bs)).toBe(12)
    expect(sharedAt(4, bs)).toBe(15)
  })
})

describe('the piano roll', () => {
  it('opens 3 + 4 as 3 and 4 columns, not 12 and 12', () => {
    const m = roll(THREE_FOUR)
    expect(m.barSteps).toEqual([3, 4])
    expect(m.steps).toBe(7)
    expect(m.notes.map((n) => `${n.pitch}@${n.start}+${n.duration}`)).toEqual([
      'c3@0+1', 'e3@1+1', 'g3@2+1', 'c3@3+1', 'e3@4+1', 'g3@5+1', 'b3@6+1',
    ])
  })

  it('opens 8 + 7, which used to be refused past 64 columns', () => {
    const m = roll(`<[${EIGHT}] [${SEVEN}]>`)
    expect(m.barSteps).toEqual([8, 7])
    expect(m.steps).toBe(15)
  })

  it('leaves patterns whose bars nest exactly as they were', () => {
    const a = roll('<[c3 e3 g3 b3] ~>')
    expect(a.barSteps).toBeUndefined()
    expect(a.steps).toBe(8)
    const b = roll(`<[${EIGHT}] [c3 e3 g3 b3]>`)
    expect(b.barSteps).toBeUndefined()
    expect(b.steps).toBe(16)
  })

  it('still refuses a bar past 64 steps, and a shared grid past its own ceiling', () => {
    const wide = Array.from({ length: 65 }, () => 'c3').join(' ')
    expect(parsePianoRoll(`<[${wide}] [c3 e3 g3]>`).ok).toBe(false)
    const a = Array.from({ length: 64 }, () => 'c3').join(' ')
    const b = Array.from({ length: 63 }, () => 'c3').join(' ')
    expect(parsePianoRoll(`<[${a}] [${b}]>`).ok).toBe(false) // shared grid 2 × 4032
  })

  it('writes an untouched per-bar roll back byte for byte', () => {
    expect(serializePianoRoll(roll(THREE_FOUR))).toBe(THREE_FOUR)
    const ef = `<[${EIGHT}] [${SEVEN}]>`
    expect(serializePianoRoll(roll(ef))).toBe(ef)
  })

  it('an edit in drawn columns lands on the bar it was made in, spelled at that bar', () => {
    const m = roll(THREE_FOUR)
    // bar 1's middle note is drawn column 1
    const out = serializePianoRoll(
      placeNote(removeNote(m, 1, 'e3', { readback: true }), 'd3', 1, 1, { readback: true }),
    )
    expect(out).toBe('<[c3 d3 g3] [c3 e3 g3 b3]>')
    // bar 2's last cell (drawn column 6) — a note of one QUARTER of a cycle
    const b2 = serializePianoRoll(placeNote(removeNote(m, 6, 'b3', { readback: true }), 'a3', 6, 1, { readback: true }))
    expect(b2).toBe('<[c3 e3 g3] [c3 e3 g3 a3]>')
    expect(plays(b2!, 2)).toEqual(
      plays(THREE_FOUR, 2).map((h) => (h.startsWith('"b3"') ? h.replace('"b3"', '"a3"') : h)).sort(),
    )
  })

  it('an edit in the 7-step bar of 8 + 7 writes that bar and plays it', () => {
    const ef = `<[${EIGHT}] [${SEVEN}]>`
    const m = roll(ef)
    // drawn column 8 is bar 2's first cell
    const out = serializePianoRoll(placeNote(removeNote(m, 8, 'c3', { readback: true }), 'e4', 8, 1, { readback: true }))
    expect(out).toBe(`<[${EIGHT}] [e4 d3 e3 f3 g3 a3 b3]>`)
  })
})

describe('a move re-authors the pattern, still one bar at a time', () => {
  it('moves a note within its bar and keeps both bars at their own counts', () => {
    // A move re-authors through the rebuild writers rather than the splice, and those
    // strode bars by one uniform width: without the per-bar bounds this bar of 3 came back
    // as twelve slots, reopened uniform, and the read-back refused every drag.
    const m = roll(THREE_FOUR)
    const out = serializePianoRoll(moveNote(m, 'g3', 2, 'a3', 2, { readback: true }))
    expect(out).toBe('<[c3 e3 a3] [c3 e3 g3 b3]>')
  })

  it('moves a note from the bar of 4 into the bar of 3, where a cell is longer', () => {
    // drawn column 6 is bar 2's last cell (a quarter); drawn column 2 is bar 1's last (a third)
    const m = roll('<[c3 e3 ~] [c3 e3 g3 b3]>')
    expect(m.barSteps).toEqual([3, 4])
    const moved = moveNote(m, 'b3', 6, 'b3', 2, { readback: true })
    expect(moved).not.toBe(m)
    const out = serializePianoRoll(moved)!
    expect(out).toBe('<[c3 e3 b3] [c3 e3 g3 ~]>')
    // …and it plays there for bar 1's third of a cycle
    expect(plays(out, 2)).toContain('"b3"@0.6666666666666666+0.33333333333333337')
  })
})

describe('the step sequencer', () => {
  it('opens 3 + 4 per bar', () => {
    const m = grid('<[bd sd hh] [bd sd hh oh]>')
    expect(m.barSteps).toEqual([3, 4])
    expect(m.steps).toBe(7)
    const hh = m.lanes.find((l) => l.sound === 'hh')!
    expect(hh.cells.map((c) => (c ? 1 : 0))).toEqual([0, 0, 1, 0, 0, 1, 0])
  })

  it('writes an untouched per-bar grid back byte for byte', () => {
    expect(serializeStepGrid(grid('<[bd sd hh] [bd sd hh oh]>'))).toBe('<[bd sd hh] [bd sd hh oh]>')
  })

  it('a toggled bar is spelled at its own count, not the shared twelve', () => {
    const src = '<[bd sd hh] [bd sd hh oh]>'
    const m = grid(src)
    const hh = m.lanes.findIndex((l) => l.sound === 'hh')
    const out = serializeStepGrid(toggleCell(m, hh, 0, true))
    expect(out).toBe('<[[bd,hh] sd hh] [bd sd hh oh]>')
    // …and it plays the old pattern plus exactly one hi-hat, on bar 1's downbeat
    const added = plays(out!, 2).filter((h) => !plays(src, 2).includes(h))
    expect(added).toEqual(['"hh"@0+0.3333333333333333'])
  })

  it('the shorter spelling only engages on a per-bar grid', () => {
    // a uniform grid is written exactly as before
    const m = grid('<[bd sd hh oh] [bd ~ ~ ~]>')
    expect(m.barSteps).toBeUndefined()
    const hh = m.lanes.findIndex((l) => l.sound === 'hh')
    expect(serializeStepGrid(toggleCell(m, hh, 4, true))).toBe('<[bd sd hh oh] [[bd,hh] ~ ~ ~]>')
  })
})
