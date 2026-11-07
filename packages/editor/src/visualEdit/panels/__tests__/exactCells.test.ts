/**
 * A row's cells from the bar's tree alone, and what a click on one writes (#2454, #2295).
 *
 * FIXTURES pin the cells and writes in text a person can check.
 *
 * THE CORPUS, SIDE BY SIDE — wherever today's grid opens, each cell it draws (`rowBoxes`) is
 * clicked by today's road (`stepAddressAt` → the writer) and by the cell at the same exact
 * place. They ask the same writer, so the two must write the same bytes or refuse for the same
 * reason. Every other outcome is counted by cause and pinned, and must-fail controls show the
 * comparison can see a wrong cell and a wrong write.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { applyStepEdit, chunkDivisions, isCellOn, parseStepGrid, splitStep, toggleStep, type Frac, type StepGridModel } from '../../../codeView'
import { miniPattern } from '../../../codeView/strudelMini/pattern'
import { cellEdit, exactGridOf, type ExactCell, type ExactGrid, type ExactRow } from '../exactGrid'
import { frac, splitAddressAt, stepAddressAt } from '../gridZoom'
import { linesModel, ownStepWidths, rowBoxes } from '../writtenSteps'

const fr = (f: Frac): string => (f.d === 1 ? String(f.n) : `${f.n}/${f.d}`)
const grid = (mini: string): Extract<ExactGrid, { ok: true }> => {
  const g = exactGridOf(mini)
  if (!g.ok) throw new Error(g.why)
  return g
}
const rowOf = (g: Extract<ExactGrid, { ok: true }>, sound: string): ExactRow => {
  const r = g.rows.find((x) => x.sound === sound)
  if (!r) throw new Error(`no row ${sound}: ${g.rows.map((x) => x.sound).join(' ')}`)
  return r
}
/** a row as `begin` per cell, a note marked `*`, a snap half marked `.` */
const cellsOf = (mini: string, sound: string): string =>
  rowOf(grid(mini), sound)
    .cells.map((c) => `${c.bar > 0 ? `${c.bar}:` : ''}${fr(c.begin)}${c.on ? '*' : ''}${c.split ? '.' : ''}`)
    .join(' ')
/** the text a click on the cell at `begin` writes, or the writer's reason */
const click = (mini: string, sound: string, begin: string, bar = 0): string => {
  const g = grid(mini)
  const row = rowOf(g, sound)
  const cell = row.cells.find((c) => c.bar === bar && fr(c.begin) === begin)
  if (!cell) throw new Error(`no cell at ${begin}: ${cellsOf(mini, sound)}`)
  const r = cellEdit(mini, g.trees, row, g.rows.filter((x) => x.part === row.part).map((x) => x.sound), cell)
  return r.ok ? applyStepEdit(mini, r.edit) : `refused: ${r.why}`
}

describe('a row’s cells, from the tree alone', () => {
  it('a step is one cell, at its exact share of the bar', () => {
    expect(cellsOf('bd sd cp', 'sd')).toBe('0 1/3* 2/3')
    expect(cellsOf('bd@3 sd', 'sd')).toBe('0 1/4 1/2 3/4*')
  })

  it('a step whose op places its hits is one cell per place', () => {
    expect(cellsOf('hh*4', 'hh')).toBe('0* 1/4* 1/2* 3/4*')
    expect(cellsOf('bd(1,4)', 'bd')).toBe('0* 1/4 1/2 3/4')
    expect(cellsOf('perc:0(3,12,3)', 'perc:0').split(' ')).toHaveLength(12)
    expect(cellsOf('bd*2 [hh hh hh hh]', 'bd')).toBe('0* 1/8. 1/4* 3/8. 1/2 5/8 3/4 7/8')
    expect(cellsOf('bd(3,8)', 'bd')).toBe('0* 1/8 1/4 3/8* 1/2 5/8 3/4* 7/8')
  })

  it('a plain step longer than the part’s finest step is cut into snap halves', () => {
    expect(cellsOf('bd [~ bd]', 'bd')).toBe('0* 1/4. 1/2 3/4*')
  })

  it('a part is cut by itself, not by the part beside it', () => {
    expect(cellsOf('~ sd ~ sd, hh*8', 'sd')).toBe('0 1/4* 1/2 3/4*')
  })

  it('thirds, fives and sevens stay exact', () => {
    expect(cellsOf('bd [hh hh hh] sd', 'hh')).toBe('0 1/9. 2/9. 1/3* 4/9* 5/9* 2/3 7/9. 8/9.')
    expect(cellsOf('a b c d e', 'c')).toBe('0 1/5 2/5* 3/5 4/5')
  })

  it('each bar has its own steps, cut by the finest step in the loop', () => {
    expect(cellsOf('<e5 [d5 g5]>', 'e5')).toBe('0* 1/2. 1:0 1:1/2')
  })

  it('needs no columns: a pattern with too many for the column grid has cells', () => {
    const mini = 'hh hh [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]'
    expect(parseStepGrid(mini).ok).toBe(false)
    expect(cellsOf(mini, 'hh').split(' ')).toHaveLength(96)
  })

  it('a row whose steps do not tile keeps its notes as cells', () => {
    const g = grid('<<f#1 g1!3>*4!3 [[c2 -] [b1 -]]>*4')
    for (const r of g.rows) if (r.why) expect(r.cells.every((c) => c.on)).toBe(true)
  })
})

describe('the shapes the tree learned (#2454)', () => {
  it('feet are group steps, asked of Strudel', () => {
    expect(cellsOf('bd sd . hh', 'hh')).toBe('0 1/4 1/2* 3/4.')
    expect(click('bd sd . hh', 'sd', '0')).toBe('[bd,sd] sd . hh')
    expect(click('bd sd . hh', 'hh', '1/2')).toBe('bd sd . ~')
  })

  it('a note with no plain name is a row called what the text writes', () => {
    const g = grid('bd:<1 2> sd')
    expect(g.rows.map((r) => r.sound)).toEqual(['bd:<1 2>', 'sd'])
    expect(rowOf(g, 'bd:<1 2>').hits.map((h) => h.begin)).toEqual([0, 1])
    expect(click('bd:<1 2> sd', 'bd:<1 2>', '0')).toBe('refused: step-has-no-text')
    expect(click('bd:<1 2> sd', 'sd', '1/2')).toBe('bd:<1 2> ~')
  })

  it('a long repeat has all its bars', () => {
    expect(grid('<lp:1!8 - lp:11!8>').bars).toBe(17)
    expect(grid('<sawtooth!16 pulse!8>').bars).toBe(24)
  })

  it('a pattern that plays nothing still has its rests to write into', () => {
    const g = grid('~ ~')
    expect(g.rows).toEqual([])
    expect(g.bars).toBe(1)
  })
})

describe('a click asks the writer', () => {
  it('toggles, and splits part-way through a plain step', () => {
    expect(click('bd sd', 'sd', '1/2')).toBe('bd ~')
    expect(click('bd ~', 'bd', '1/2')).toBe('bd bd')
    expect(click('bd [~ bd]', 'bd', '1/4')).toBe('bd*2 [~ bd]')
  })

  it('edits one hit of a generator by writing out only that step', () => {
    expect(click('hh*4', 'hh', '1/2')).toBe('[hh hh ~ hh]')
  })

  it('shows the writer’s refusal, not one of its own', () => {
    expect(click('hh*<2 4> sd', 'hh', '0')).toBe('refused: step-is-generated')
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

function barOf(m: StepGridModel, col: number): { bar: number; n: number; per: number } {
  const bars = m.bars ?? 1
  let start = 0
  for (let b = 0; b < bars; b++) {
    const per = m.barSteps ? m.barSteps[b] : m.steps / bars
    if (col < start + per) return { bar: b, n: col - start, per }
    start += per
  }
  return { bar: bars - 1, n: 0, per: 1 }
}
const placeKey = (bar: number, n: number, d: number): string => {
  const f = Number.isInteger(d) ? frac(n, d) : { n, d }
  return `${bar}|${f.n / f.d}`
}

interface Tally {
  grids: number
  lanes: number
  todayCells: number
  sameWrite: number
  sameRefusal: number
  writesDiffer: string[]
  /** one side writes and the other refuses, or they refuse for different reasons */
  outcomesDiffer: string[]
  onDiffers: string[]
  noGrid: string[]
  barsDiffer: string[]
  /** a today's row the tree calls by what the text writes (`hh:<1 2>` is one row, not `hh:1`, `hh:2`) */
  laneNamedOtherwise: number
  /** today writes here and no cell: only in a comma stack today's grid reads as one part */
  noCellToday: { writes: number; refuses: number; writesNotInAStack: string[] }
  cellsOnlyHere: number
}

function sideBySide(limit = Infinity, cellAt: (row: ExactRow) => readonly ExactCell[] = (r) => r.cells): Tally {
  const t: Tally = {
    grids: 0,
    lanes: 0,
    todayCells: 0,
    sameWrite: 0,
    sameRefusal: 0,
    writesDiffer: [],
    outcomesDiffer: [],
    onDiffers: [],
    noGrid: [],
    barsDiffer: [],
    laneNamedOtherwise: 0,
    noCellToday: { writes: 0, refuses: 0, writesNotInAStack: [] },
    cellsOnlyHere: 0,
  }
  for (const mini of minis.slice(0, limit)) {
    const g = parseStepGrid(mini)
    if (!g.ok || g.model.lookOnly) continue
    const m = g.model
    t.grids++
    const x = exactGridOf(mini)
    if (!x.ok) {
      t.noGrid.push(`${x.why}: ${mini}`)
      continue
    }
    if (x.bars !== (m.bars ?? 1)) {
      t.barsDiffer.push(mini)
      continue
    }
    const trees = chunkDivisions(mini, m.bars ?? 1)
    const widths = ownStepWidths(linesModel(m, m))
    m.lanes.forEach((lane, li) => {
      t.lanes++
      const row = x.rows.find((r) => r.sound === lane.sound && r.part === (lane.part ?? 0)) ?? x.rows.find((r) => r.sound === lane.sound)
      if (!row) {
        t.laneNamedOtherwise++
        return
      }
      const cells = new Map<string, ExactCell>()
      for (const c of cellAt(row)) cells.set(placeKey(c.bar, c.begin.n, c.begin.d), c)
      const order = m.lanes.filter((l) => (l.part ?? 0) === (lane.part ?? 0)).map((l) => l.sound)
      const orderHere = x.rows.filter((r) => r.part === row.part).map((r) => r.sound)
      const seen = new Set<string>()
      for (const box of rowBoxes(lane.cells, m.steps, widths.get(lane.part ?? 0), isCellOn)) {
        const at = barOf(m, box.start)
        const key = placeKey(at.bar, at.n, at.per)
        seen.add(key)
        t.todayCells++
        const writerRow = { sound: lane.sound, part: lane.part, order }
        const addr = stepAddressAt(m, trees, li, box.start)
        const inside = addr === 'inside-a-step' ? splitAddressAt(m, trees, li, box.start) : null
        const today =
          addr === 'inside-a-step'
            ? inside
              ? splitStep(mini, trees, inside.address, inside.at, writerRow)
              : { ok: false as const, why: addr as string }
            : typeof addr === 'string'
              ? { ok: false as const, why: addr as string }
              : toggleStep(mini, trees, addr, writerRow)
        const cell = cells.get(key)
        if (!cell) {
          if (today.ok) {
            t.noCellToday.writes++
            const stacked = trees.some((tr) => tr.ok && tr.parts.length > 1)
            if (!stacked && !row.why) t.noCellToday.writesNotInAStack.push(`${mini} [${lane.sound}] col ${box.start}/${m.steps}`)
          } else t.noCellToday.refuses++
          continue
        }
        if (cell.on !== isCellOn(lane.cells[box.start])) t.onDiffers.push(`${mini} [${lane.sound}] col ${box.start}`)
        const mine = cellEdit(mini, trees, row, orderHere, cell)
        const a = today.ok ? applyStepEdit(mini, today.edit) : `refused: ${today.why}`
        const b = mine.ok ? applyStepEdit(mini, mine.edit) : `refused: ${mine.why}`
        if (a === b) {
          if (today.ok) t.sameWrite++
          else t.sameRefusal++
        } else if (today.ok && mine.ok) t.writesDiffer.push(`${a}\n  ${b}`)
        else t.outcomesDiffer.push(`${mini} [${lane.sound}]: ${a} || ${b}`)
      }
      for (const key of cells.keys()) if (!seen.has(key)) t.cellsOnlyHere++
    })
  }
  return t
}

/** how many hits the text plays at each place over `cycles`, by Strudel's own exact fraction */
function hitsByPlace(mini: string, cycles: number): Map<string, number> {
  const pat = miniPattern(mini)
  const out = new Map<string, number>()
  for (let c = 0; c < cycles; c++) {
    for (const h of pat.hits(c)) {
      const key = h.begin.toFraction?.() ?? String(h.begin.valueOf())
      out.set(key, (out.get(key) ?? 0) + 1)
    }
  }
  return out
}
/** the place a cell is, spelled as Strudel spells a time */
const placeText = (c: Pick<ExactCell, 'bar' | 'begin'>): string => {
  const f = frac(c.bar * c.begin.d + c.begin.n, c.begin.d)
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`
}

/**
 * Measured 2026-11-07 on the epic at 71c726ab + this change, over 1,625 distinct patterns.
 * A number here moves only with a reason.
 *
 * The cells only the tree has are places today's 64-column limit or a coarser shared grid
 * cannot draw. The writes with no cell here are of two kinds. In comma stacks, today's grid
 * reads two parts as one and offers the finer part's columns on the coarser row; Exact draws
 * each part at its own steps, as the design asks, and a finer view is the Slots control's job.
 * And four patterns hold a group under a euclid (`[d4 g3](7,16)`): its steps do not tile the
 * bar, so a row has its notes as cells and nothing to add into (the euclid ruling of
 * 2026-11-07 keeps a group under a euclid refused).
 *
 * The two different writes are one chord in another order: same music, other bytes. Rows
 * follow the order sounds first play, and these two first play in one stack (`[d6, e6]`).
 *
 * The two bars-differ patterns are one pattern twice over, one the column parser reads as a
 * single bar and the tree as two.
 */
const PINNED = {
  grids: 1018,
  lanes: 2486,
  todayCells: 30151,
  sameWrite: 27586,
  sameRefusal: 1736,
  writesDiffer: 2,
  outcomesDiffer: 0,
  onDiffers: 0,
  noGrid: 0,
  barsDiffer: 2,
  laneNamedOtherwise: 18,
  noCellWrites: 311,
  noCellRefuses: 516,
  cellsOnlyHere: 766,
}

describe('the corpus, side by side with today’s grid', () => {
  it('a click on the same place writes the same bytes, or refuses for the same reason', () => {
    const t = sideBySide()
    expect({
      grids: t.grids,
      lanes: t.lanes,
      todayCells: t.todayCells,
      sameWrite: t.sameWrite,
      sameRefusal: t.sameRefusal,
      writesDiffer: t.writesDiffer.length,
      outcomesDiffer: t.outcomesDiffer.length,
      onDiffers: t.onDiffers.length,
      noGrid: t.noGrid.length,
      barsDiffer: t.barsDiffer.length,
      laneNamedOtherwise: t.laneNamedOtherwise,
      noCellWrites: t.noCellToday.writes,
      noCellRefuses: t.noCellToday.refuses,
      cellsOnlyHere: t.cellsOnlyHere,
    }).toEqual(PINNED)
    expect(t.noCellToday.writesNotInAStack.length, t.noCellToday.writesNotInAStack.slice(0, 30).join('\n')).toBe(0)
    expect(t.outcomesDiffer).toEqual([])
    expect(t.onDiffers).toEqual([])
  }, 900_000)

  // Read over the loop itself: a toggle adds or takes away a hit at the place clicked. Each
  // pattern's first cells only, so a run stays minutes long; the writer's own corpus suite
  // judges every toggle it can reach through columns.
  it('every edit of a cell only the tree has plays the click: one hit more or fewer at that place', () => {
    let asked = 0
    let wrote = 0
    const wrong: string[] = []
    for (const mini of minis) {
      const g = parseStepGrid(mini) as { ok: boolean; lookOnly?: unknown; gate?: string; model?: StepGridModel }
      // the patterns that have no editable column grid today: every cell of them is new
      if ((g.ok && !g.model?.lookOnly) || g.gate === 'wrong-surface') continue
      const x = exactGridOf(mini)
      if (!x.ok) continue
      const before = hitsByPlace(mini, x.bars)
      for (const row of x.rows) {
        const order = x.rows.filter((r) => r.part === row.part).map((r) => r.sound)
        for (const cell of row.cells.filter((c) => !c.split).slice(0, 12)) {
          asked++
          const r = cellEdit(mini, x.trees, row, order, cell)
          if (!r.ok) continue
          wrote++
          const text = applyStepEdit(mini, r.edit)
          const at = placeText(cell)
          let after: Map<string, number>
          try {
            after = hitsByPlace(text, x.bars)
          } catch {
            wrong.push(`does not evaluate: ${JSON.stringify(mini)} → ${JSON.stringify(text)}`)
            continue
          }
          const moved = (after.get(at) ?? 0) - (before.get(at) ?? 0)
          if (cell.on ? moved >= 0 : moved <= 0) wrong.push(`${JSON.stringify(mini)} [${row.sound}] ${at} ${moved} → ${JSON.stringify(text)}`)
        }
      }
    }
    expect(wrong.length, wrong.slice(0, 40).join('\n')).toBe(0)
    expect(wrote).toBeGreaterThan(1000)
    expect(asked).toBeGreaterThan(wrote)
  }, 900_000)

  it('can go red: a cell one place later is seen', () => {
    const shifted = (r: ExactRow): ExactCell[] => r.cells.map((c, i) => ({ ...c, begin: r.cells[i + 1]?.begin ?? c.begin }))
    const t = sideBySide(200, shifted)
    expect(t.outcomesDiffer.length + t.writesDiffer.length + t.onDiffers.length).toBeGreaterThan(0)
  }, 300_000)

  it('can go red: a row answered by another row’s cells is seen', () => {
    const none = (): ExactCell[] => []
    const t = sideBySide(200, none)
    expect(t.sameWrite).toBe(0)
    expect(t.noCellToday.writes).toBeGreaterThan(0)
  }, 300_000)
})
