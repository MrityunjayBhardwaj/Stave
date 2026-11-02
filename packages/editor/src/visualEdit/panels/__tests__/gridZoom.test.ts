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
import { chunkDivisions, parseStepGrid, type StepGridModel } from '../../../codeView'
import { laneSteps, laneStepsOrWhy, openAt, zoomRuler, type DrawnNode, type StepNode } from '../gridZoom'
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
const PINNED = {
  grids: 1018,
  rows: 2496,
  nodes: 2418,
  compared: 2211,
  treeFiner: 122,
  parserFiner: 27,
  maxDepth: 4,
  refused: { 'off-grid': 15, 'does-not-tile': 25, feet: 6, 'lane-part-unknown': 14, 'lane-sound-not-in-part': 18 },
}
