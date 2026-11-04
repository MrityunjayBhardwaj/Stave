/**
 * A grid row as the pattern's own steps, nested, and which open at a zoom (#2277).
 *
 * The nodes come from the tree (Strudel); the corpus arm checks their top level against
 * the parser's own written-step starts (`writtenStepStarts`), a second route, and pins
 * how many rows get nodes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chunkDivisions, laneDivisions, parsePianoRoll, parseStepGrid, type StepGridModel } from '../../../codeView'
import { barStepsOrWhy, columnOf, frac, laneSteps, laneStepsOrWhy, openAt, openStarts, partSteps, partStepsOrWhy, zoomRuler, type DrawnNode, type StepNode } from '../gridZoom'
import { writtenStepStarts } from '../writtenSteps'

const grid = (mini: string): StepGridModel => {
  const g = parseStepGrid(mini)
  if (!g.ok) throw new Error(`${mini}: ${g.reason}`)
  return g.model
}
const steps = (mini: string, sound: string): StepNode[] | null => {
  const m = grid(mini)
  const lane = m.lanes.findIndex((l) => l.sound === sound)
  return laneSteps(m, chunkDivisions(mini, m.bars ?? 1), lane)
}
/** `[from,to)` per node, children in brackets */
const show = (ns: readonly (StepNode | DrawnNode)[] | null): string =>
  ns === null ? 'null' : ns.map((n) => `${n.from}-${n.to}${n.children ? `[${show(n.children)}]` : ''}`).join(' ')
const px = (w: number) => (): number => w

describe('laneSteps — the row as its own steps, in drawn columns', () => {
  it('a group step holds its inner steps', () => {
    expect(show(steps('bd [~ bd] sd ~', 'bd'))).toBe('0-2 2-4[2-3 3-4] 4-6 6-8')
  })

  it('every level the text writes, at its depth', () => {
    const ns = steps('bd [hh [hh hh]] sd [~ cp]', 'hh')!
    expect(show(ns)).toBe('0-4 4-8[4-6 6-8[6-7 7-8]] 8-12 12-16[12-14 14-16]')
    expect(ns[1].children![1].children![0].depth).toBe(3)
  })

  it('a group its own op repeats: the copies are a level', () => {
    expect(show(steps('bd [~ hh]*2', 'hh'))).toBe('0-4 4-8[4-6[4-5 5-6] 6-8[6-7 7-8]]')
  })

  it('a bar that is one step is cut by that step: its split is the pulse', () => {
    expect(show(steps('[~ hh]*4, bd ~ sd ~', 'hh'))).toBe('0-2[0-1 1-2] 2-4[2-3 3-4] 4-6[4-5 5-6] 6-8[6-7 7-8]')
    expect(show(steps('[c5 d5 e5 g5]', 'c5'))).toBe('0-1 1-2 2-3 3-4')
  })

  it('a step written with `!` is that many steps', () => {
    expect(show(steps('bd!3 sd', 'bd'))).toBe('0-1 1-2 2-3 3-4')
    expect(show(steps('[bd hh]!2 sd', 'bd'))).toBe('0-2[0-1 1-2] 2-4[2-3 3-4] 4-6')
  })

  it('a note written `@3` is three steps, the way Strudel counts; a group keeps its weight whole', () => {
    expect(show(steps('bd@3 sd', 'bd'))).toBe('0-1 1-2 2-3 3-4')
    expect(show(steps('bd _ _ sd', 'bd'))).toBe('0-1 1-2 2-3 3-4')
    expect(show(steps('[bd hh]@2 sd', 'bd'))).toBe('0-2[0-1 1-2] 2-3')
  })

  it('a generated note is one step: its hits are columns inside it, not steps', () => {
    expect(show(steps('hh*8 bd', 'hh'))).toBe('0-8 8-16')
  })

  it('a group of several rows draws, for each grid row, the inner row that writes its sound', () => {
    // `[hh hh, cp]`: the hats' row splits in two, the clap's does not split
    expect(show(steps('bd [hh hh, cp]', 'hh'))).toBe('0-2 2-4[2-3 3-4]')
    expect(show(steps('bd [hh hh, cp]', 'cp'))).toBe('0-2 2-4')
  })

  it('each bar is its own tree', () => {
    // bar 1 plays `bd`, bar 2 plays `[bd bd]`
    expect(show(steps('<bd [bd bd]> sd', 'bd'))).toBe('0-2 2-4 4-6[4-5 5-6] 6-8')
  })

  it('null when the tree is not this grid: cells the tree does not play', () => {
    const mini = 'bd [~ bd] sd ~'
    const m = grid(mini)
    const trees = chunkDivisions(mini, 1)
    expect(laneSteps(m, trees, 0)).not.toBeNull()
    // a cell moved one column: the tree no longer places this row's notes
    const cells = [...m.lanes[0].cells]
    ;[cells[3], cells[2]] = [cells[2], cells[3]]
    const moved = { ...m, lanes: m.lanes.map((l, i) => (i === 0 ? { ...l, cells } : l)) }
    expect(laneSteps(moved, trees, 0)).toBeNull()
    // and a tree for another bar count
    expect(laneSteps(m, chunkDivisions(mini, 2), 0)).toBeNull()
  })
})

describe('openAt and zoomRuler — zoom opens a level, the ruler follows', () => {
  const mini = 'bd [hh [hh hh]] sd [~ cp]'
  const m = grid(mini)
  const ns = steps(mini, 'hh')!

  it('a step opens once each step inside it is at least 16 px', () => {
    // 16 columns: at 8 px a column the 2-column inner steps are 16 px, the 1-column ones 8
    expect(show(openAt(ns, px(8)))).toBe('0-4 4-8[4-6 6-8] 8-12 12-16[12-14 14-16]')
    expect(show(openAt(ns, px(16)))).toBe('0-4 4-8[4-6 6-8[6-7 7-8]] 8-12 12-16[12-14 14-16]')
    expect(show(openAt(ns, px(4)))).toBe('0-4 4-8 8-12 12-16')
  })

  it('the ruler names each open step by its place in the pattern', () => {
    const at = (w: number): string[] => [...zoomRuler(m, openAt(ns, px(w))).entries()].sort((a, b) => a[0] - b[0]).map(([c, l]) => `${c}:${l}`)
    expect(at(4)).toEqual(['0:1', '4:1.2', '8:1.3', '12:1.4'])
    expect(at(8)).toEqual(['0:1', '4:1.2', '6:1.2.2', '8:1.3', '12:1.4', '14:1.4.2'])
    expect(at(16)).toEqual(['0:1', '4:1.2', '6:1.2.2', '7:1.2.2.2', '8:1.3', '12:1.4', '14:1.4.2'])
  })
})

describe('partSteps — a piano roll part as its own steps', () => {
  const roll = (mini: string): StepNode[] | null => {
    const r = parsePianoRoll(mini)
    if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
    return partSteps(r.model, chunkDivisions(mini, r.model.bars ?? 1), 0)
  }

  it('the steps the melody writes, nested; a chord is one step', () => {
    expect(show(roll('c4 [e4 g4] a4 [b4 [c5 d5]]'))).toBe('0-4 4-8[4-6 6-8] 8-12 12-16[12-14 14-16[14-15 15-16]]')
    expect(show(roll('[c4,e4,g4] [d4 f4]'))).toBe('0-2 2-4[2-3 3-4]')
  })

  it('the lines at a zoom: the first column of each open step, by depth', () => {
    const drawn = openAt(roll('c4 [e4 g4] a4 [b4 [c5 d5]]')!, () => 16)
    expect([...openStarts(drawn).entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 1], [4, 1], [6, 2], [8, 1], [12, 1], [14, 2], [15, 3],
    ])
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

describe('laneSteps — the corpus', () => {
  it('a row gets nodes or null; where the parser wrote step starts, the top level agrees; counts pinned', () => {
    let grids = 0
    let rows = 0
    let nodes = 0
    let compared = 0
    let maxDepth = 0
    const refused: Record<string, number> = {}
    const odd: string[] = []
    const differ: string[] = []
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      if (!g.ok) continue
      grids++
      const m = g.model
      const trees = chunkDivisions(mini, m.bars ?? 1)
      const written = writtenStepStarts(m)
      m.lanes.forEach((lane, i) => {
        rows++
        const got = laneStepsOrWhy(m, trees, i)
        if (typeof got === 'string') {
          refused[got] = (refused[got] ?? 0) + 1
          if (got === 'cells-differ' || got === 'does-not-tile' || got === 'off-grid') odd.push(`${got} ${JSON.stringify(mini).slice(0, 80)} ${lane.sound}`)
          return
        }
        const ns = got
        nodes++
        const depth = (xs: StepNode[]): number => Math.max(0, ...xs.map((x) => (x.children ? 1 + depth(x.children) : 1)))
        maxDepth = Math.max(maxDepth, depth(ns))
        const parser = written.get(lane.part ?? 0)
        if (!parser) return
        compared++
        const mine = ns.map((n) => n.from).join(',')
        if (mine !== parser.join(',')) {
          const t = new Set(ns.map((n) => n.from))
          const p = new Set(parser)
          const kind = [...t].every((x) => p.has(x)) ? 'parser-finer' : [...p].every((x) => t.has(x)) ? 'tree-finer' : 'cross'
          differ.push(`${kind} ${JSON.stringify(mini).slice(0, 70)} ${lane.sound}: tree ${mine} parser ${parser.join(',')}`)
        }
      })
    }
    // never a crossing: where both routes cut the row, one may be finer, but no edge of one
    // falls inside a step of the other
    expect(differ.filter((d) => d.startsWith('cross'))).toEqual([])
    const kinds = (k: string): number => differ.filter((d) => d.startsWith(k)).length
    expect(odd.filter((o) => o.startsWith('cells-differ'))).toEqual([])
    expect({ grids, rows, nodes, compared, treeFiner: kinds('tree-finer'), parserFiner: kinds('parser-finer'), maxDepth, refused }).toEqual(PINNED)
  }, 600_000)
})

/**
 * Measured 2026-11-02 over 1,625 distinct corpus patterns. Where the two routes cut a row
 * differently, one is finer: the tree where a bar is one step (`[bd hh]*4` is four steps,
 * the parser's one region), the parser where its regions are per column (`[c2, ds3]@3 …`). A row
 * with no nodes draws as it does today: `off-grid` (a slot inside a column), `does-not-tile`
 * (a group repeated by a euclid, `[a, b](4,8,1)`), and the tree's own refusals.
 */
describe('partSteps — the corpus', () => {
  it('every roll gets the steps of its part or says why; where the parser wrote step starts, they never cross', () => {
    let rolls = 0
    let nodes = 0
    let compared = 0
    const refused: Record<string, number> = {}
    const cross: string[] = []
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      rolls++
      const m = r.model
      const parts = m.source?.parts.length ?? 1
      // the part the roll draws when it has one; a stack's choice is the panel's
      if (parts > 1) {
        refused['several-parts'] = (refused['several-parts'] ?? 0) + 1
        continue
      }
      const got = partStepsOrWhy(m, chunkDivisions(mini, m.bars ?? 1), 0)
      if (typeof got === 'string') {
        refused[got] = (refused[got] ?? 0) + 1
        continue
      }
      nodes++
      const parser = writtenStepStarts(m).get(0)
      if (!parser) continue
      compared++
      const t = new Set(got.map((n) => n.from))
      const p = new Set(parser)
      if (![...t].every((x) => p.has(x)) && ![...p].every((x) => t.has(x))) cross.push(JSON.stringify(mini))
    }
    expect(cross).toEqual([])
    expect({ rolls, nodes, compared, refused }).toEqual(ROLL_PINNED)
  }, 600_000)
})

/** measured 2026-11-02 over the same corpus: 603 open as a roll; a stack's part is the panel's choice, so it is counted apart */
const ROLL_PINNED = { rolls: 603, nodes: 561, compared: 524, refused: { 'does-not-tile': 4, 'off-grid': 4, 'several-parts': 34 } }

const PINNED = {
  grids: 1018,
  rows: 2496,
  nodes: 2431,
  compared: 2211,
  treeFiner: 122,
  parserFiner: 27,
  maxDepth: 4,
  // 2026-11-03 (#2287): the 14 rows that named no part under several now draw the one part
  // writing their sound — 13 get nodes, 1 is off-grid
  refused: { 'off-grid': 16, 'does-not-tile': 25, feet: 6, 'lane-sound-not-in-part': 18 },
}

describe('laneSteps — columns are the exact fractions, laid on the bar (#1834)', () => {
  it('column c of a bar is the fraction (c − start) / per, and back', () => {
    expect(columnOf(frac(3, 8), 0, 8)).toBe(3)
    expect(columnOf(frac(3, 8), 16, 8)).toBe(19)
    expect(columnOf(frac(1, 3), 0, 8)).toBeNull()
  })

  it('over the corpus, every row that draws by columns draws its tree\'s fractions exactly', () => {
    let rows = 0
    let edges = 0
    const bad: string[] = []
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      const m = g.ok ? g.model : g.lookOnly
      if (!m) continue
      const bars = m.bars ?? 1
      const trees = chunkDivisions(mini, bars)
      m.lanes.forEach((lane, li) => {
        const nodes = laneSteps(m, trees, li)
        if (!nodes) return
        rows++
        // the same steps as shares of each bar, asked of the tree directly
        let at = 0
        for (let b = 0; b < bars; b++) {
          const start = m.barSteps ? m.barSteps.slice(0, b).reduce((a, n) => a + n, 0) : (b * m.steps) / bars
          const per = m.barSteps ? m.barSteps[b] : m.steps / bars
          const d = laneDivisions(trees[b], lane)
          if (!d.ok) throw new Error(d.why)
          const fs = barStepsOrWhy(d.row, lane.sound)
          if (typeof fs === 'string') throw new Error(fs)
          const walk = (cs: readonly StepNode[], ff: ReturnType<typeof barStepsOrWhy> & object): void => {
            if (cs.length !== ff.length) bad.push(`${mini.slice(0, 50)} ${lane.sound}: ${cs.length} vs ${ff.length}`)
            cs.forEach((c, i) => {
              const f = ff[i]
              if (!f) return
              edges += 2
              if ((c.from - start) / per !== f.begin.n / f.begin.d || (c.to - start) / per !== f.end.n / f.end.d) {
                bad.push(`${mini.slice(0, 50)} ${lane.sound}: ${c.from}-${c.to} vs ${f.begin.n}/${f.begin.d}-${f.end.n}/${f.end.d}`)
              }
              if (!!c.children !== !!f.children) bad.push(`${mini.slice(0, 50)} ${lane.sound}: children differ`)
              if (c.children && f.children) walk(c.children, f.children)
            })
          }
          const inBar = nodes.slice(at, at + fs.length)
          at += fs.length
          walk(inBar, fs)
        }
        if (at !== nodes.length) bad.push(`${mini.slice(0, 50)} ${lane.sound}: ${nodes.length} nodes, ${at} steps`)
      })
    }
    expect(bad).toEqual([])
    // editable 2,431 + look-only 133 (pinned above and below)
    expect({ rows, edges }).toEqual({ rows: 2564, edges: COLUMN_EDGES })
  }, 600_000)
})

describe('laneSteps — the corpus, look-only grids (#2287)', () => {
  it('a look-only grid gets its rows\' steps the way an editable one does; counts pinned', () => {
    let grids = 0
    let rows = 0
    let nodes = 0
    const refused: Record<string, number> = {}
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      if (g.ok || !g.lookOnly) continue
      grids++
      const m = g.lookOnly
      const trees = chunkDivisions(mini, m.bars ?? 1)
      m.lanes.forEach((_, i) => {
        rows++
        const got = laneStepsOrWhy(m, trees, i)
        if (typeof got === 'string') refused[got] = (refused[got] ?? 0) + 1
        else nodes++
      })
    }
    expect(refused['cells-differ']).toBeUndefined()
    expect({ grids, rows, nodes, refused }).toEqual(LOOK_ONLY_PINNED)
  }, 600_000)
})

/**
 * Measured 2026-11-03 over the same corpus: 56 patterns open as a look-only grid, 180 rows.
 * Their rows are built from the cells and name no part, so under a stack every one was
 * refused `lane-part-unknown` until #2287: 97 rows got steps then, 133 now. The 6 left
 * unknown are a sound two parts both write.
 */
/** every edge of every drawn step, at every depth, of the 2,564 rows */
const COLUMN_EDGES = 52_580

const LOOK_ONLY_PINNED = {
  grids: 56,
  rows: 180,
  nodes: 133,
  refused: { 'does-not-tile': 2, 'lane-part-unknown': 6, 'lane-sound-not-in-part': 25, 'off-grid': 14 },
}
