/**
 * A step grid drawn from the pattern's own divisions, for a pattern with no column model
 * (#1834, epic #1832): rows, exact step boxes, small boxes inside closed steps, lines,
 * ruler, hits, playhead — and over the corpus, how many patterns that open as nothing
 * today get one.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chunkDivisions, parsePianoRoll, parseStepGrid } from '../../../codeView'
import { barStepsOrWhy, frac, type FracStep } from '../gridZoom'
import { drawTreeRow, lookOnlyTreeGrid, treeGridFrom, treeGridOf, treePlayhead, treeRuler, type TreeGrid } from '../treeGrid'

const ok = (g: TreeGrid): Extract<TreeGrid, { ok: true }> => {
  if (!g.ok) throw new Error(g.why)
  return g
}
/** `[begin,end)` of each step as `n/d`, children in brackets */
const show = (ns: readonly FracStep[]): string =>
  ns.map((n) => `${n.begin.n}/${n.begin.d}-${n.end.n}/${n.end.d}${n.children ? `[${show(n.children)}]` : ''}`).join(' ')
const tree = (mini: string, sound: string, part = 0): FracStep[] => {
  const [t] = chunkDivisions(mini, 1)
  if (!t.ok) throw new Error(t.why)
  const s = barStepsOrWhy(t.parts[part], sound)
  if (typeof s === 'string') throw new Error(s)
  return s
}

const NINETY_SIX = 'hh hh [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]'

describe('barStepsOrWhy — a bar as exact shares', () => {
  it('a pulse of three whose second beat is five', () => {
    expect(show(tree('c4 [e4 g4 b4 d5 f5] a4', 'c4'))).toBe('0/1-1/3 1/3-2/3[1/3-2/5 2/5-7/15 7/15-8/15 8/15-3/5 3/5-2/3] 2/3-1/1')
  })

  it('a bar the step grid cannot hold: 96 columns, eight steps, every share exact', () => {
    expect(parseStepGrid(NINETY_SIX).ok).toBe(false)
    expect(show(tree(NINETY_SIX, 'hh'))).toBe(
      '0/1-1/8 1/8-1/4 1/4-3/8[1/4-5/16 5/16-3/8] 3/8-1/2 1/2-5/8[1/2-13/24 13/24-7/12 7/12-5/8] 5/8-3/4 3/4-7/8 7/8-1/1[7/8-29/32 29/32-15/16 15/16-31/32 31/32-1/1]',
    )
  })

  it('every depth the text writes, however deep', () => {
    const ns = tree('bd [hh [hh [hh*4 [cp]]]] sd [~ cp]', 'hh')
    expect(show(ns)).toBe('0/1-1/4 1/4-1/2[1/4-3/8 3/8-1/2[3/8-7/16 7/16-1/2[7/16-15/32 15/32-1/2]]] 1/2-3/4 3/4-1/1[3/4-7/8 7/8-1/1]')
  })

  it('frac keeps lowest terms', () => {
    expect(frac(6, -8)).toEqual({ n: -3, d: 4 })
  })
})

describe('treeGridOf — rows, boxes, ruler', () => {
  it('the 96-column pattern draws look-only: one row, eight steps, small boxes inside the three groups', () => {
    const g = ok(treeGridOf(NINETY_SIX))
    expect(g.bars).toBe(1)
    expect(g.rows.map((r) => r.sound)).toEqual(['hh'])
    const [row] = g.rows
    expect(row.hits).toHaveLength(14)
    // 1×: nothing opens — eight steps, the groups' 2 + 3 + 4 steps as small boxes
    const one = drawTreeRow(row.bars!, 400, Infinity)
    expect(one.steps).toHaveLength(8)
    expect(one.inner).toHaveLength(9)
    expect(one.steps.map((s) => s.end - s.begin)).toEqual(Array(8).fill(1 / 8))
    expect(treeRuler(row.bars!, 400, Infinity).map((x) => x.label)).toEqual(['1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8'])
    // zoomed until the quarters of the last step are 16 px: every group opens
    const wide = drawTreeRow(row.bars!, 32 * 16, 16)
    expect(wide.steps).toHaveLength(14)
    expect(wide.inner).toHaveLength(0)
    expect(wide.lines.filter((l) => l.depth === 2).map((l) => l.at)).toEqual([5 / 16, 13 / 24, 7 / 12, 29 / 32, 15 / 16, 31 / 32])
  })

  it('a step opens only when each step inside it is wide enough', () => {
    const g = ok(treeGridOf(NINETY_SIX))
    // a bar 400 px wide, steps open at 13 px: halves (25 px) and thirds (16.7 px) open, quarters (12.5 px) stay shut
    const d = drawTreeRow(g.rows[0].bars!, 400, 13)
    expect(d.steps).toHaveLength(5 + 2 + 3 + 1)
    expect(d.inner).toHaveLength(4)
    const labels = treeRuler(g.rows[0].bars!, 400, 13).map((x) => x.label)
    expect(labels).toContain('1.5.3')
    expect(labels).not.toContain('1.8.2')
  })

  it('a row per sound, each with its own hits; the steps are the part\'s', () => {
    const g = ok(treeGridOf('bd [hh [hh [hh*4 [cp]]]] sd [~ cp]'))
    // in written order: the clap inside the second step is written before the snare
    expect(g.rows.map((r) => r.sound)).toEqual(['bd', 'hh', 'cp', 'sd'])
    expect(g.rows.find((r) => r.sound === 'hh')!.hits.map((h) => h.begin)).toEqual([1 / 4, 3 / 8, 7 / 16, 57 / 128, 58 / 128, 59 / 128])
    expect(g.rows.find((r) => r.sound === 'cp')!.hits.map((h) => h.begin)).toEqual([15 / 32, 7 / 8])
    expect(treeRuler(g.rows[0].bars!, 4000, 16).map((x) => x.label)).toEqual(['1', '1.2', '1.2.2', '1.2.2.2', '1.2.2.2.2', '1.3', '1.4', '1.4.2'])
  })

  it('a row per comma part names its part, and a part that alternates draws every bar it plays', () => {
    const g = ok(treeGridOf('bd:5,[~ <sd:1!3 sd:1(3,4,3)>],hh27(3,4,1)'))
    expect(g.bars).toBe(4)
    expect(g.rows.map((r) => `${r.sound}:${r.part}`)).toEqual(['bd:5:0', 'sd:1:1', 'hh27:2'])
    expect(g.rows[1].hits.map((h) => h.begin)).toEqual([0.5, 1.5, 2.5, 3.5, 3.625, 3.875])
  })

  it('refuses a pattern that does not repeat, a random choice of parts, a hit with no plain name', () => {
    expect(treeGridFrom(Array.from({ length: 16 }, (_, b) => ({ ok: true as const, parts: [{ steps: [], written: 0, sounds: [String(b)] }], oneOf: false })))).toEqual({ ok: false, why: 'does-not-repeat' })
    const choice = { ok: true as const, parts: [{ steps: [], written: 0, sounds: ['bd'] }, { steps: [], written: 0, sounds: ['hh'] }], oneOf: true }
    expect(treeGridFrom(Array(16).fill(choice))).toEqual({ ok: false, why: 'parts-are-a-choice' })
    expect(treeGridOf('bd:<1 2> sd')).toEqual({ ok: false, why: 'unnamed-hit' })
    expect(treeGridOf('~ ~')).toEqual({ ok: false, why: 'no-hits' })
  })

  it('the playhead is the exact position, never a step', () => {
    expect(treePlayhead(5.3, 4)).toBeCloseTo(1.3)
    expect(treePlayhead(0.53125, 1)).toBe(0.53125)
    expect(treePlayhead(null, 1)).toBeNull()
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

describe('treeGridOf — the corpus', () => {
  it('of the patterns that open as neither a step grid nor a piano roll, how many draw look-only, and why the rest do not', () => {
    let nothing = 0
    let notAGrid = 0
    let drawn = 0
    let rows = 0
    let rowsWithSteps = 0
    const refused: Record<string, number> = {}
    const rowWhy: Record<string, number> = {}
    const byGate: Record<string, { drawn: number; refused: number }> = {}
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      const r = parsePianoRoll(mini)
      if (g.ok || g.lookOnly || r.ok || r.lookOnly) continue
      nothing++
      const gate = g.gate ?? 'core'
      const look = lookOnlyTreeGrid(mini)
      if (look === null) {
        notAGrid++
        continue
      }
      byGate[gate] ??= { drawn: 0, refused: 0 }
      if ('why' in look) {
        refused[look.why] = (refused[look.why] ?? 0) + 1
        byGate[gate].refused++
        continue
      }
      const t = look.grid
      drawn++
      byGate[gate].drawn++
      for (const row of t.rows) {
        rows++
        if (row.bars) rowsWithSteps++
        else rowWhy[row.why!] = (rowWhy[row.why!] ?? 0) + 1
        // every row's hits sit inside the pattern
        for (const h of row.hits) expect(h.begin >= 0 && h.begin < t.bars).toBe(true)
      }
    }
    expect({ nothing, notAGrid, drawn, rows, rowsWithSteps, refused, rowWhy, byGate }).toEqual(TREE_PINNED)
  }, 600_000)
})

/**
 * Measured 2026-11-03 over 1,625 distinct corpus patterns: 256 open as neither a step grid
 * nor a piano roll, editable or look-only. 129 of those are not rows of sounds (numbers the
 * roll would show, nothing played, mixed pitch kinds), which a tree grid does not stand in
 * for. Of the other 127, 33 draw look-only (118 rows; the 13 rows whose bar steps do not tile
 * draw their hits alone). The rest: 89 do not repeat within 12 bars (the step grid's own
 * cap, so the grid's `unstable-period`), 3 the tree refuses, 2 play a note with no plain name.
 */
const TREE_PINNED = {
  nothing: 256,
  notAGrid: 129,
  drawn: 33,
  rows: 118,
  rowsWithSteps: 105,
  refused: { 'does-not-repeat': 89, 'steps-do-not-tile': 3, 'unnamed-hit': 2 },
  rowWhy: { 'does-not-tile': 13 },
  byGate: {
    'edit-unsafe': { drawn: 0, refused: 1 },
    'irrational-onset': { drawn: 11, refused: 1 },
    resolution: { drawn: 22, refused: 1 },
    'unstable-period': { drawn: 0, refused: 90 },
    'view-unusable': { drawn: 0, refused: 1 },
  },
}
