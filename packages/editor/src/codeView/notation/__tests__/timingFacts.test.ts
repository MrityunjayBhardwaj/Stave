/**
 * Every timing fact a view states is checked against what Strudel plays (#1974, part of
 * #1869, epic #1007).
 *
 * A view states three kinds of timing fact: where a note starts, how long it lasts, and
 * how many steps a bar has. Each is worked out by the readers in `../parse`, on several
 * paths (the syntactic reader, the two projections, the look-only view). This test asks
 * Strudel the same three things through the adapter's joined tree
 * (`strudelMini/joined.ts`) and compares, for every corpus pattern either view opens —
 * a look-only view included — over TWO periods, so "it repeats every `bars` cycles" is
 * checked too rather than taken from the model.
 *
 * WHAT A STEP COUNT CAN AND CANNOT BE CHECKED AGAINST. Strudel has no step count for a
 * bar; `bd ~ ~ ~` is four steps because its author wrote four. A count is the UNIT every
 * other fact of that bar is stated in, so that is how it is checked: at the count the
 * model states, its starts and lengths must be Strudel's, and the bars' counts must add
 * up to the model's width. A count that does not belong to the hits fails the first on
 * every note of the bar; the break arms below do exactly that.
 *
 * A STEP IS NOT ALWAYS WHERE A NOTE STARTS. The piano roll states fractional starts on
 * purpose (`[c5@0.5 f4@0.5 f5@3]` puts `f4` half a column in), so "every hit starts on a
 * column" is not a rule of the roll and is not asserted; how many do not is printed.
 * A grid cell IS a column, so there a hit between columns is a hit the view cannot show
 * and is reported as one.
 *
 * NAMES ARE THE KEY, NOT THE SUBJECT. A sound written `hh:0:.3` plays as `hh` with the
 * numbers 0 and 0.3; the two are matched by reading the written numbers as numbers.
 *
 * WHAT IS NOT INDEPENDENT. On the projected paths a cell's place and length descend
 * from the same hits they are compared with; what the comparison still checks there is
 * the cycles→columns arithmetic, the per-bar layout, and the period. On the syntactic
 * path nothing is shared. The tally is printed per path so neither stands for the other.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinedCycle } from '../../strudelMini/joined'
import { miniPattern, type MiniPattern } from '../../strudelMini/pattern'
import { isCellOn, type PianoRollModel, type StepGridModel } from '../model'
import { parsePianoRoll, parseStepGrid } from '../parse'
import { barStarts } from '../perBar'

type Surface = 'grid' | 'roll'
type View = StepGridModel | PianoRollModel
/** which reader produced the view — the paths are not equally independent of the hits */
type Path = 'written' | 'leaf' | 'look-only'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(here, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const EPS = 1e-6
const num = (x: number): string => (Math.abs(x - Math.round(x)) < EPS ? String(Math.round(x)) : x.toFixed(5))

/** one thing that sounds: what, at which column of its bar, for how many columns */
interface Fact {
  what: string
  at: number
  len: number
}
const key = (f: Fact): string => `${f.what}@${num(f.at)}+${num(f.len)}`
const place = (f: Fact): string => `${f.what}@${num(f.at)}`
/** a name with its `:` parts that are numbers read as numbers, so `.3` and `0.3` agree */
const named = (text: string, surface: Surface): string =>
  (surface === 'roll' ? text.toLowerCase() : text)
    .split(':')
    .map((part) => (part.trim() !== '' && Number.isFinite(Number(part)) ? String(Number(part)) : part))
    .join(':')

/** the model's own statement of its bars: where each starts and how many steps it has */
function barsOf(m: View): { starts: number[]; counts: number[] } | null {
  if (m.barSteps) return { starts: barStarts(m.barSteps), counts: m.barSteps }
  const bars = m.bars ?? 1
  const per = m.steps / bars
  if (!Number.isInteger(per) || per < 1) return null
  const counts = Array.from({ length: bars }, () => per)
  return { starts: barStarts(counts), counts }
}

/** what the VIEW says sounds in bar `b` */
function stated(m: View, b: number, starts: number[], surface: Surface): Fact[] {
  const from = starts[b]
  const to = starts[b + 1]
  const out: Fact[] = []
  if ('lanes' in m) {
    for (const lane of m.lanes)
      for (let c = from; c < to; c++) {
        const cell = lane.cells[c]
        if (isCellOn(cell)) out.push({ what: named(lane.sound, surface), at: c - from, len: cell.duration })
      }
  } else {
    for (const n of m.notes)
      if (n.start + EPS >= from && n.start < to - EPS) out.push({ what: named(n.pitch, surface), at: n.start - from, len: n.duration })
  }
  return out
}

/** what STRUDEL says sounds in cycle `cyc`, in columns of a bar that has `count` steps */
function played(pat: MiniPattern, cyc: number, count: number, surface: Surface): { facts: Fact[]; unpaired: number } {
  const facts: Fact[] = []
  let unpaired = 0
  for (const j of joinedCycle(pat, cyc).hits) {
    if (j.atom === null) unpaired++
    const v = j.hit.value
    const begin = j.hit.begin.valueOf()
    facts.push({
      what: named(Array.isArray(v) ? v.map(String).join(':') : String(v), surface),
      at: (begin - cyc) * count,
      len: (j.hit.end.valueOf() - begin) * count,
    })
  }
  return { facts, unpaired }
}

type Kind = 'played-not-shown' | 'shown-not-played' | 'length' | 'width'
interface Finding {
  kind: Kind
  cycle: number
  detail: string
}
interface Compared {
  /** null when the view's bars are not a whole number of columns each — nothing compared */
  findings: Finding[] | null
  /** places compared: a note of the roll, a (sound, column) of the grid */
  onsets: number
  /** lengths compared */
  lengths: number
  /** bars whose step count was used as the unit, counted once per cycle looked at */
  counts: number
  /** hits the joined tree could not attach to one written note */
  unpaired: number
  /** grid columns where one cell stands for a sound Strudel plays more than once there */
  shared: number
  /** hits that start between two columns of their bar */
  between: number
}

/**
 * Compare one view with what its pattern plays, over two periods.
 *
 * The roll states every note, so its notes and the hits must be the same multiset. The
 * grid states one cell per sound per column: the cells and the hits must name the same
 * (sound, column) places, and a cell's length must be a length played there.
 */
function compareView(pat: MiniPattern, m: View, surface: Surface): Compared {
  const out: Compared = { findings: [], onsets: 0, lengths: 0, counts: 0, unpaired: 0, shared: 0, between: 0 }
  const layout = barsOf(m)
  if (!layout) return { ...out, findings: null }
  const findings = out.findings!
  const { starts, counts } = layout
  const bars = counts.length
  if (starts[bars] !== m.steps) findings.push({ kind: 'width', cycle: 0, detail: `bars add up to ${starts[bars]}, the view is ${m.steps} wide` })
  for (let cyc = 0; cyc < 2 * bars; cyc++) {
    const b = cyc % bars
    const said = stated(m, b, starts, surface)
    const { facts: heard, unpaired } = played(pat, cyc, counts[b], surface)
    out.unpaired += unpaired
    out.counts++
    out.between += heard.filter((h) => Math.abs(h.at - Math.round(h.at)) > EPS).length
    if (surface === 'roll') {
      out.onsets += heard.length
      out.lengths += heard.length
      const left = new Map<string, number>()
      for (const h of heard) left.set(key(h), (left.get(key(h)) ?? 0) + 1)
      const saidOnly: Fact[] = []
      for (const s of said) {
        const n = left.get(key(s)) ?? 0
        if (n > 0) left.set(key(s), n - 1)
        else saidOnly.push(s)
      }
      const heardOnly = heard.filter((h) => {
        const n = left.get(key(h)) ?? 0
        if (n > 0) left.set(key(h), n - 1)
        return n > 0
      })
      // a note shown and a note played at the same place with different lengths is ONE finding
      for (const s of saidOnly) {
        const i = heardOnly.findIndex((h) => place(h) === place(s))
        if (i < 0) findings.push({ kind: 'shown-not-played', cycle: cyc, detail: key(s) })
        else findings.push({ kind: 'length', cycle: cyc, detail: `${key(s)}, played ${num(heardOnly.splice(i, 1)[0].len)}` })
      }
      for (const h of heardOnly) findings.push({ kind: 'played-not-shown', cycle: cyc, detail: key(h) })
    } else {
      const lens = new Map<string, number[]>()
      for (const h of heard) lens.set(place(h), [...(lens.get(place(h)) ?? []), h.len])
      const saidPlaces = new Set(said.map(place))
      out.onsets += lens.size
      for (const [p, l] of lens) {
        if (l.length > 1) out.shared++
        if (!saidPlaces.has(p)) findings.push({ kind: 'played-not-shown', cycle: cyc, detail: p })
      }
      for (const s of said) {
        const l = lens.get(place(s))
        if (!l) findings.push({ kind: 'shown-not-played', cycle: cyc, detail: key(s) })
        else {
          out.lengths++
          if (!l.some((x) => Math.abs(x - s.len) < EPS))
            findings.push({ kind: 'length', cycle: cyc, detail: `${key(s)}, played ${l.map(num).join(' / ')}` })
        }
      }
    }
  }
  return out
}

interface Opened {
  mini: string
  surface: Surface
  scale: 1 | 2
  path: Path
  model: View
}

let memo: { views: Opened[]; asked: number; noView: number } | null = null
/**
 * Every view either surface opens over the corpus, at the document's resolution and one
 * finer. Built on first use inside a test, never while the file is being collected: ten
 * seconds of parsing there would be charged to every run that only lists this file.
 */
function opened(): { views: Opened[]; asked: number; noView: number } {
  if (memo) return memo
  const views: Opened[] = []
  let asked = 0
  let noView = 0
  for (const mini of minis)
    for (const surface of ['grid', 'roll'] as const)
      for (const scale of [1, 2] as const) {
        asked++
        const r = surface === 'grid' ? parseStepGrid(mini, scale) : parsePianoRoll(mini, scale)
        const model: View | undefined = r.ok ? r.model : r.lookOnly
        if (!model) {
          noView++
          continue
        }
        views.push({ mini, surface, scale, path: !r.ok ? 'look-only' : model.leafSource ? 'leaf' : 'written', model })
      }
  return (memo = { views, asked, noView })
}

const grid = (mini: string): StepGridModel => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const roll = (mini: string): PianoRollModel => {
  const r = parsePianoRoll(mini)
  if (!r.ok) throw new Error(`${mini}: ${r.reason}`)
  return r.model
}
const kinds = (c: Compared): Kind[] => [...new Set((c.findings ?? []).map((f) => f.kind))].sort()

/** the same view, claiming twice the steps per bar — a count that is not the hits' */
function withWrongCounts<M extends View>(m: M): M {
  return { ...m, steps: m.steps * 2, ...(m.barSteps ? { barSteps: m.barSteps.map((n) => n * 2) } : {}) }
}

describe('timing facts — the comparison can fail', () => {
  it('agrees on patterns it should agree on, on every path', () => {
    for (const mini of ['bd ~ sd ~', 'bd*2 [sd cp]', '<bd sd> hh', '<[a b c] [a b c d]>', 'bd:3 sd:1:.5'])
      expect(compareView(miniPattern(mini), grid(mini), 'grid').findings, mini).toEqual([])
    // a look-only view is a view: it is held to the same facts
    const look = parseStepGrid('[hh ~]!4')
    expect(look.ok).toBe(false)
    if (look.ok || !look.lookOnly) throw new Error('the fixture is no longer a look-only view')
    expect(compareView(miniPattern('[hh ~]!4'), look.lookOnly, 'grid').findings).toEqual([])
    for (const mini of ['c3 e3 g3', 'c3@3 e3', '<[c3 e3 g3] [c3 e3 g3 b3]>', '[c3,e3] g3', '0 2 4 7', 'C3 Eb3'])
      expect(compareView(miniPattern(mini), roll(mini), 'roll').findings, mini).toEqual([])
  })

  it('a view of one pattern held against another is caught, and the finding says what', () => {
    // a hit the view does not show
    expect(kinds(compareView(miniPattern('bd sd hh ~'), grid('bd sd ~ ~'), 'grid'))).toEqual(['played-not-shown'])
    // a cell nothing plays
    expect(kinds(compareView(miniPattern('bd ~ ~ ~'), grid('bd ~ sd ~'), 'grid'))).toEqual(['shown-not-played'])
    // the right place, the wrong length
    expect(kinds(compareView(miniPattern('c3@3 e3'), roll('c3@2 ~ e3'), 'roll'))).toEqual(['length'])
    expect(kinds(compareView(miniPattern('bd@3 sd'), grid('bd ~ ~ sd'), 'grid'))).toEqual(['length'])
    // a note moved
    expect(kinds(compareView(miniPattern('c3 ~ e3 ~'), roll('c3 e3 ~ ~'), 'roll'))).toEqual(['played-not-shown', 'shown-not-played'])
  })

  it('a view that says it repeats sooner than the pattern does is caught in the second period', () => {
    const c = compareView(miniPattern('<bd sd>'), grid('bd'), 'grid')
    expect(c.findings!.length).toBeGreaterThan(0)
    expect(c.findings!.every((f) => f.cycle === 1)).toBe(true)
  })

  it('a step count that is not the hits\' is caught: uniform bars and bars of their own', () => {
    for (const mini of ['bd ~ sd ~', '<[a b c] [a b c d]>']) {
      const c = compareView(miniPattern(mini), withWrongCounts(grid(mini)), 'grid')
      expect(c.findings!.length, mini).toBeGreaterThan(0)
    }
    // the fixtures really have bars of their own, on both surfaces
    expect(grid('<[a b c] [a b c d]>').barSteps).toEqual([3, 4])
    const mini = '<[c3 e3 g3] [c3 e3 g3 b3]>'
    const m = roll(mini)
    expect(m.barSteps).toEqual([3, 4])
    expect(compareView(miniPattern(mini), withWrongCounts(m), 'roll').findings!.length).toBeGreaterThan(0)
    // the two bars' counts the wrong way round: each bar is laid on the other's steps
    expect(compareView(miniPattern(mini), { ...m, barSteps: [4, 3] }, 'roll').findings!.length).toBeGreaterThan(0)
    // counts that do not add up to the width
    expect(kinds(compareView(miniPattern(mini), { ...m, steps: m.steps + 1 }, 'roll'))).toContain('width')
  })
})

describe('timing facts — what a view states is what Strudel plays (corpus)', () => {
  it('every start, length and step count of every view either surface opens, over two periods', () => {
    const { views, asked, noView } = opened()
    type Tally = { views: number; onsets: number; lengths: number; counts: number; shared: number; between: number; betweenViews: number }
    const tally = new Map<string, Tally>()
    const disagreeing: string[] = []
    const notCompared: string[] = []
    let unpaired = 0
    for (const v of views) {
      const k = `${v.surface} ${v.path}`
      const t = tally.get(k) ?? { views: 0, onsets: 0, lengths: 0, counts: 0, shared: 0, between: 0, betweenViews: 0 }
      tally.set(k, t)
      const c = compareView(miniPattern(v.mini), v.model, v.surface)
      if (c.findings === null) {
        notCompared.push(`${k} @${v.scale} ${JSON.stringify(v.mini)}: ${v.model.steps} steps over ${v.model.bars ?? 1} bars is not a whole count per bar`)
        continue
      }
      t.views++
      t.onsets += c.onsets
      t.lengths += c.lengths
      t.counts += c.counts
      t.shared += c.shared
      t.between += c.between
      if (c.between > 0) t.betweenViews++
      unpaired += c.unpaired
      for (const f of c.findings.slice(0, 3)) disagreeing.push(`${k} @${v.scale} ${JSON.stringify(v.mini)} cycle ${f.cycle}: ${f.kind} ${f.detail}`)
    }
    const total = [...tally.values()].reduce((a, t) => ({ views: a.views + t.views, onsets: a.onsets + t.onsets, lengths: a.lengths + t.lengths, counts: a.counts + t.counts }), { views: 0, onsets: 0, lengths: 0, counts: 0 })
    console.log(
      [
        `[#1974 timing facts] patterns=${minis.length} asked=${asked} (2 surfaces x 2 resolutions) views=${views.length} no-view=${noView}`,
        ...[...tally].sort().map(([k, t]) => `  ${k}: views ${t.views}, starts ${t.onsets}, lengths ${t.lengths}, bar counts ${t.counts}; grid columns one cell stands for several hits ${t.shared}; hits between columns ${t.between} in ${t.betweenViews} views`),
        `  compared: views ${total.views}, starts ${total.onsets}, lengths ${total.lengths}, bar counts ${total.counts}`,
        `  not compared: ${notCompared.length}; hits with no single written note: ${unpaired}; disagreements: ${disagreeing.length}`,
        ...notCompared.map((l) => '  NOT COMPARED ' + l),
      ].join('\n'),
    )
    expect(disagreeing).toEqual([])
    expect(notCompared).toEqual([])
    // every path is present in what was measured — a path emptying out must not pass quietly
    for (const k of ['grid written', 'grid leaf', 'grid look-only', 'roll written', 'roll leaf', 'roll look-only'])
      expect(tally.get(k)?.views ?? 0, k).toBeGreaterThan(0)
    // a grid cell is a column: a hit between columns would have been a hit the view cannot show
    for (const k of ['grid written', 'grid leaf', 'grid look-only']) expect(tally.get(k)!.between, k).toBe(0)
    // the population, so a corpus refresh or a change in what opens announces itself
    expect({ patterns: minis.length, asked, views: views.length, noView }).toEqual({ patterns: 1625, asked: 6500, views: 3258, noView: 3242 })
  }, 600_000)

  it('control: the same views with a step count that is not theirs disagree, every one that holds a note', () => {
    const { views } = opened()
    let holding = 0
    let caught = 0
    const missed: string[] = []
    for (const v of views) {
      const real = compareView(miniPattern(v.mini), v.model, v.surface)
      if (real.findings === null || real.onsets === 0) continue
      holding++
      const c = compareView(miniPattern(v.mini), withWrongCounts(v.model), v.surface)
      if (c.findings !== null && c.findings.length > 0) caught++
      else if (missed.length < 10) missed.push(`${v.surface} ${v.path} @${v.scale} ${JSON.stringify(v.mini)}`)
    }
    console.log(`[#1974 timing facts] control, step counts doubled: caught ${caught} of ${holding} views that hold a note`)
    expect(missed).toEqual([])
    expect(caught).toBe(holding)
    expect(holding).toBeGreaterThan(3000)
  }, 600_000)
})
