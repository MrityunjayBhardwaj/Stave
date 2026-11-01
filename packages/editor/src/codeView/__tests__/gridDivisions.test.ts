/**
 * Each bar's divisions, handed to the views through codeView's entry (#2275).
 *
 * The fixtures pin what a view reads. The corpus arm is the claim: over every pattern
 * that opens as a step grid, each grid row's tree row either places that row's notes
 * exactly where the grid's own cells do, or is refused with the rule that failed — the
 * counts PINNED. The cells come from the grid parser and the tree from Strudel, so the
 * two are separate routes to the same onsets.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chunkDivisions, laneDivisions, parseStepGrid, type BarTree, type DivisionRow, type Frac, type StepGridModel } from '..'

const f = (x: Frac): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`)
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const key = (x: Frac): string => {
  const g = gcd(x.n, x.d) || 1
  return `${x.n / g}/${x.d / g}`
}
const grid = (mini: string): StepGridModel => {
  const g = parseStepGrid(mini)
  if (!g.ok) throw new Error(`${mini}: ${g.reason}`)
  return g.model
}
const only = (t: BarTree): DivisionRow[] => {
  if (!t.ok) throw new Error(`refused: ${t.why}`)
  return t.parts
}

/** where a row's notes named `sound` start in its bar, at any depth — as exact fractions of the bar */
function treeOnsets(row: DivisionRow, sound: string, out = new Set<string>()): Set<string> {
  for (const s of row.steps) {
    if (s.name === sound) for (const h of s.hits) if (h.begin.n >= 0 && h.begin.n < h.begin.d) out.add(key(h.begin))
    for (const r of s.rows ?? []) treeOnsets(r, sound, out)
  }
  return out
}

/** where the grid's own cells for lane `i` start in bar `b`, as exact fractions of the bar */
function cellOnsets(m: StepGridModel, i: number, b: number): Set<string> {
  const bars = m.bars ?? 1
  const per = m.barSteps ? m.barSteps[b] : m.steps / bars
  const start = m.barSteps ? m.barSteps.slice(0, b).reduce((a, n) => a + n, 0) : b * per
  const out = new Set<string>()
  for (let c = 0; c < per; c++) if (m.lanes[i].cells[start + c]) out.add(key({ n: c, d: per }))
  return out
}

/** does the tree row a view is handed for lane `i`, bar `b`, put the lane's notes where its cells are? */
function agrees(row: DivisionRow, m: StepGridModel, i: number, b: number): boolean {
  const a = treeOnsets(row, m.lanes[i].sound)
  const c = cellOnsets(m, i, b)
  return a.size === c.size && [...a].every((x) => c.has(x))
}

describe('chunkDivisions — each bar as plain data', () => {
  it('a step, its slot, its hits and the rows inside a group', () => {
    const [part] = only(chunkDivisions('bd [~ bd] sd:2 ~', 1)[0])
    expect(part.steps.map((s) => `${s.name ?? '[…]'}@${s.slots.map((x) => `${f(x.begin)}-${f(x.end)}`).join(',')}`)).toEqual([
      'bd@0-1/4',
      '[…]@1/4-1/2',
      'sd:2@1/2-3/4',
      '~@3/4-1',
    ])
    expect(part.steps[0].hits.map((h) => `${f(h.begin)}-${f(h.end)}`)).toEqual(['0-1/4'])
    expect(part.steps[3]).toMatchObject({ rest: true, hits: [] })
    const inner = part.steps[1].rows!
    expect(inner[0].steps.map((s) => `${s.name}@${f(s.slots[0].begin)}`)).toEqual(['~@1/4', 'bd@3/8'])
    // the row's written notes by the name a grid row has, rests left out
    expect(part.sounds.sort()).toEqual(['bd', 'sd:2'])
    // where each step sits in the chunk's string
    expect(part.steps.map((s) => s.span && 'bd [~ bd] sd:2 ~'.slice(s.span.start, s.span.end).trim())).toEqual(['bd', '[~ bd]', 'sd:2', '~'])
  })

  it('a generated step carries its hits and the argument tokens that shaped them', () => {
    const [part] = only(chunkDivisions('bd(3,8) hh', 1)[0])
    const euclid = part.steps[0]
    expect(euclid.hits.map((h) => f(h.begin))).toEqual(['0', '3/16', '3/8'])
    expect(euclid.hits[0].args.map((a) => a.text)).toEqual(['3', '8'])
  })

  it('one tree per bar: an alternation is the arm each bar plays', () => {
    const bars = chunkDivisions('<bd sd> hh', 2).map((t) => only(t)[0].steps.map((s) => s.name))
    // `<bd sd>` is one written step holding one row per bar
    expect(bars).toEqual([[null, 'hh'], [null, 'hh']])
    const arm = (t: BarTree): string[] => only(t)[0].steps[0].rows!.flatMap((r) => r.steps.map((s) => s.name!))
    expect(chunkDivisions('<bd sd> hh', 2).map(arm)).toEqual([['bd'], ['sd']])
  })

  it('is plain data: no Strudel object or krill node leaves', () => {
    const trees = chunkDivisions('bd*2 [~ <sd cp>], hh(3,8):2', 2)
    expect(JSON.parse(JSON.stringify(trees))).toEqual(trees)
    const protos = new Set<unknown>()
    const walk = (x: unknown): void => {
      if (x === null || typeof x !== 'object') return
      protos.add(Object.getPrototypeOf(x))
      for (const v of Object.values(x)) walk(v)
    }
    walk(trees)
    expect([...protos].every((p) => p === Object.prototype || p === Array.prototype)).toBe(true)
  })

  it('is built once per text and bar count', () => {
    const a = chunkDivisions('bd sd [hh hh]', 2)
    expect(chunkDivisions('bd sd [hh hh]', 2)).toBe(a)
    expect(chunkDivisions('bd sd [hh hh]', 1)).not.toBe(a)
    expect(chunkDivisions('bd sd [hh hh] ', 2)).not.toBe(a)
  })

  it('a bar with no tree says why, in every bar it applies to', () => {
    const why = (mini: string, bars = 1): unknown[] => chunkDivisions(mini, bars).map((t) => (t.ok ? 'tree' : t.why))
    expect(why('a b . c d', 2)).toEqual(['feet', 'feet'])
    expect(why('zzq1 bd')).toEqual(['marker-in-pattern'])
    expect(why('[bd sd', 2)).toEqual(['does-not-evaluate', 'does-not-evaluate'])
  })
})

describe('laneDivisions — the row each grid row draws', () => {
  it('a row draws its own comma part', () => {
    const mini = 'bd ~ bd ~, hh*4'
    const m = grid(mini)
    const [t] = chunkDivisions(mini, m.bars ?? 1)
    for (let i = 0; i < m.lanes.length; i++) {
      const d = laneDivisions(t, m.lanes[i])
      if (!d.ok) throw new Error(d.why)
      expect(d.row.sounds).toContain(m.lanes[i].sound)
      expect(agrees(d.row, m, i, 0)).toBe(true)
    }
  })

  it('refuses rather than guess: no part named under several, a part that is not there, a part without the sound', () => {
    const [two] = chunkDivisions('bd ~ bd ~, hh*4', 1)
    expect(laneDivisions(two, { sound: 'bd' })).toEqual({ ok: false, why: 'lane-part-unknown' })
    expect(laneDivisions(two, { sound: 'bd', part: 2 })).toEqual({ ok: false, why: 'lane-part-missing' })
    expect(laneDivisions(two, { sound: 'bd', part: 1 })).toEqual({ ok: false, why: 'lane-sound-not-in-part' })
    const [one] = chunkDivisions('bd sd', 1)
    expect(laneDivisions(one, { sound: 'bd' }).ok).toBe(true)
    // a refused bar hands its reason on
    expect(laneDivisions(chunkDivisions('a . b', 1)[0], { sound: 'a' })).toEqual({ ok: false, why: 'feet' })
  })

  it('a tree shifted by one slot does not agree with the grid (the check below can go red)', () => {
    const mini = 'bd sd hh sd'
    const m = grid(mini)
    const t = chunkDivisions(mini, 1)[0]
    const d = laneDivisions(t, m.lanes[0])
    if (!d.ok) throw new Error(d.why)
    expect(agrees(d.row, m, 0, 0)).toBe(true)
    const shifted: DivisionRow = JSON.parse(JSON.stringify(d.row))
    const bd = shifted.steps.find((s) => s.name === 'bd')!
    bd.hits = bd.hits.map((h) => ({ ...h, begin: { n: h.begin.n * 4 + h.begin.d, d: h.begin.d * 4 } }))
    expect(agrees(shifted, m, 0, 0)).toBe(false)
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

describe('laneDivisions — the corpus', () => {
  it('every grid row, every bar: the tree puts its notes where its cells are, or says why not; the counts are pinned', () => {
    const tally: Record<string, number> = {}
    let grids = 0
    const differ: string[] = []
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      if (!g.ok) continue
      grids++
      const m = g.model
      const trees = chunkDivisions(mini, m.bars ?? 1)
      trees.forEach((t, b) => {
        m.lanes.forEach((lane, i) => {
          const d = laneDivisions(t, lane)
          const k = !d.ok ? d.why : agrees(d.row, m, i, b) ? 'agrees' : 'differs'
          tally[k] = (tally[k] ?? 0) + 1
          if (k === 'differs') differ.push(`${JSON.stringify(mini)} ${lane.sound} bar ${b}`)
        })
      })
    }
    expect(differ).toEqual([])
    expect({ grids, ...tally }).toEqual(PINNED)
  }, 600_000)
})

/**
 * Measured 2026-11-02 on main c26ca5e7 + this change, 1,625 distinct corpus patterns:
 * 1,018 open as a step grid, 4,919 grid rows × bars. Refused: `feet` (not modelled by the
 * tree), `lane-part-unknown` (a stack the grid reads leaf by leaf, whose rows name no
 * part), `lane-sound-not-in-part` (the row's sound is a value the text does not write as
 * such: `hh:<1 2>`, `hh:3:.2` read as `hh:3:0.2`).
 */
const PINNED = {
  grids: 1018,
  agrees: 4812,
  feet: 7,
  'lane-part-unknown': 62,
  'lane-sound-not-in-part': 38,
}
