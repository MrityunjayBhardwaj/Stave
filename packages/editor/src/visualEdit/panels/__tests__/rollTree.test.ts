/**
 * A piano roll drawn from the pattern's own divisions, for a melody with no roll model
 * (#1834): notes at exact times and lengths on the pitch the roll reads, one part's lines,
 * ruler, and over the corpus how many patterns that open as nothing today get one.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parsePianoRoll, parseStepGrid } from '../../../codeView'
import { lookOnlyTreeRoll, treeRollOf, type TreeRollResult } from '../rollTree'
import { drawTreeRow, lookOnlyTreeGrid, treeRuler } from '../treeGrid'

const ok = (r: TreeRollResult): Extract<TreeRollResult, { ok: true }> => {
  if (!r.ok) throw new Error(r.why)
  return r
}

describe('treeRollOf — notes and lines from the tree', () => {
  it('a pulse of three whose second beat is five: every note exact, on its MIDI row', () => {
    const r = ok(treeRollOf('c4 [e4 g4 b4 d5 f5] a4'))
    expect(r.numeric).toBe(false)
    expect(r.notes.map((n) => `${n.midi}@${n.begin.toFixed(4)}-${n.end.toFixed(4)}`)).toEqual([
      '60@0.0000-0.3333',
      '64@0.3333-0.4000',
      '67@0.4000-0.4667',
      '71@0.4667-0.5333',
      '74@0.5333-0.6000',
      '77@0.6000-0.6667',
      '69@0.6667-1.0000',
    ])
    expect(treeRuler(r.lines!, 400, Infinity).map((x) => x.label)).toEqual(['1', '1.2', '1.3'])
    // beat 2's fifths are 26.7 px at a 400 px bar: zoomed, they open
    expect(treeRuler(r.lines!, 400, 16).map((x) => x.label)).toEqual(['1', '1.2', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3'])
    expect(drawTreeRow(r.lines!, 400, 16).lines.filter((l) => l.depth === 2)).toHaveLength(4)
  })

  it('numbers are drawn on their own number\'s row, as the roll draws them', () => {
    const r = ok(treeRollOf('0 [2 4 7] -3'))
    expect(r.numeric).toBe(true)
    expect(r.notes.map((n) => n.midi)).toEqual([0, 2, 4, 7, -3])
  })

  it('the part with the most notes draws the lines; a note held with @ keeps its length', () => {
    const r = ok(treeRollOf('c3@3 e3, [g4 a4 b4 c5]*2'))
    expect(r.parts).toBe(2)
    expect(r.linesPart).toBe(1)
    expect(r.notes.find((n) => n.midi === 48)!.end).toBe(0.75)
  })

  it('refuses sound names, a mix of numbers and names, and a pattern that does not repeat', () => {
    expect(treeRollOf('bd sd')).toEqual({ ok: false, why: 'wrong-surface' })
    expect(treeRollOf('c4 3')).toEqual({ ok: false, why: 'mixed-pitch-domain' })
    expect(treeRollOf('c4 e4?')).toEqual({ ok: false, why: 'does-not-repeat' })
  })

  it('a melody the roll has a model for gets no tree roll; one whose onset is off every column does', () => {
    expect(lookOnlyTreeRoll('c4 e4 g4')).toBeNull()
    const deep = 'c4 [e4 [g4 [b4*4 [d5]]]] a4 [~ f4]'
    expect(parsePianoRoll(deep).ok).toBe(false)
    const got = lookOnlyTreeRoll(deep)
    expect(got && 'roll' in got).toBe(true)
    // kept per text: the same answer, not worked out again
    expect(lookOnlyTreeRoll.cached(deep)).toBe(got)
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

describe('lookOnlyTreeRoll — the corpus', () => {
  it('of the patterns that open as neither a step grid nor a piano roll, how many draw as a look-only roll', () => {
    let nothing = 0
    let rolls = 0
    let notes = 0
    let withLines = 0
    let alsoTreeGrid = 0
    const notARoll: Record<string, number> = {}
    const refused: Record<string, number> = {}
    // the plan's two groups: values that are numbers, and notes with no text of their own
    const numbers = { patterns: 0, drawn: 0, not: {} as Record<string, number> }
    const noText = { patterns: 0, drawn: 0 }
    // notes with no text of their own already open a look-only view of their own (#1975)
    let noTextLookOnly = 0
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      const r = parsePianoRoll(mini)
      if ((!g.ok && g.lookOnly && g.gate === 'no-leaf-anchor') || (!r.ok && r.lookOnly && r.gate === 'no-leaf-anchor')) noTextLookOnly++
    }
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      const r = parsePianoRoll(mini)
      if (g.ok || g.lookOnly || r.ok || r.lookOnly) continue
      nothing++
      const isNumbers = g.gate === 'wrong-surface'
      const isNoText = r.gate === 'no-leaf-anchor' || g.gate === 'no-leaf-anchor'
      if (isNumbers) numbers.patterns++
      if (isNoText) noText.patterns++
      const look = lookOnlyTreeRoll(mini)
      if (isNumbers && !(look && 'roll' in look)) {
        const k = look === null ? `roll-gate:${r.gate}` : look.why
        numbers.not[k] = (numbers.not[k] ?? 0) + 1
      }
      if (look === null) {
        notARoll[r.gate ?? 'core'] = (notARoll[r.gate ?? 'core'] ?? 0) + 1
        continue
      }
      if ('why' in look) {
        refused[look.why] = (refused[look.why] ?? 0) + 1
        continue
      }
      rolls++
      notes += look.roll.notes.length
      if (look.roll.lines) withLines++
      if (isNumbers) numbers.drawn++
      if (isNoText) noText.drawn++
      const tg = lookOnlyTreeGrid(mini)
      if (tg && 'grid' in tg) alsoTreeGrid++
      for (const n of look.roll.notes) expect(n.begin >= 0 && n.begin < look.roll.bars && n.end > n.begin).toBe(true)
    }
    expect({ nothing, noTextLookOnly, rolls, notes, withLines, alsoTreeGrid, numbers, noText, notARoll, refused }).toEqual(ROLL_TREE_PINNED)
  }, 600_000)
})

/**
 * Measured 2026-11-04 over 1,625 distinct corpus patterns. 256 open as neither a step grid
 * nor a piano roll (editable or look-only); 63 of them now draw as a look-only roll, 7,694
 * notes, 58 with their part's lines (5 whose steps do not tile draw notes alone). 12 of the
 * 63 are note names that a step-grid tree also draws — which one shows is the route's call
 * (a `note` head gets the roll). Of the 121 that play numbers (the step grid's
 * `wrong-surface`), 51 now draw; 45 do not repeat within 12 bars, 19 the roll reads as
 * sounds, 5 mix numbers and names, 1 the tree refuses. Notes with no text of their own
 * never reach this population: all 27 such patterns already open a look-only view (#1975).
 */
const ROLL_TREE_PINNED = {
  nothing: 256,
  noTextLookOnly: 27,
  rolls: 63,
  notes: 7694,
  withLines: 58,
  alsoTreeGrid: 12,
  numbers: {
    patterns: 121,
    drawn: 51,
    not: { 'does-not-repeat': 45, 'hit-outside-its-step': 1, 'mixed-pitch-domain': 2, 'roll-gate:mixed-pitch-domain': 3, 'roll-gate:wrong-surface': 19 },
  },
  noText: { patterns: 0, drawn: 0 },
  notARoll: { 'escaped-source': 1, 'mixed-pitch-domain': 3, 'no-note-content': 7, 'wrong-surface': 105 },
  refused: { 'does-not-repeat': 71, 'hit-outside-its-step': 1, 'mixed-pitch-domain': 2, 'steps-do-not-tile': 3 },
}
