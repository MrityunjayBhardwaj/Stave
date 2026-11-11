/**
 * One hit of `x*k`, one copy of `x!k` (#2326): the user's ruling (2026-11-05) writes these
 * compact forms wherever the shape is even, so the writer must edit them. A click on one
 * hit writes that step out with the change (`hh*4`, third hit → `[hh hh ~ hh]`) and spells
 * it again; nothing else in the text moves.
 *
 * STRUDEL IS ASKED: over two cycles the edited string plays exactly the clicked hit added
 * or removed — at every place the written step plays — and nothing else. KRILL IS ASKED:
 * the step's new text parses. Over the corpus, every plain generator hit is clicked.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyStepEdit, chunkDivisions, laneRowForEdit, parseStepGrid, toggleStep, type BarTree, type DivisionRow, type DivisionStep, type Frac } from '..'
import { miniPattern } from '../strudelMini/pattern'
import { miniTree } from '../strudelMini/tree'

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const F = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}
const str = (x: Frac): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`)
const t = (x: { toFraction?: () => string; valueOf(): number }): string => x.toFraction?.() ?? String(x.valueOf())
const valueName = (v: unknown): string => (Array.isArray(v) ? v.join(':') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))
const played = (name: string): string => valueName(miniPattern(name).hits(0)[0].value)

function plays(mini: string, cycles: number): string[] {
  const pat = miniPattern(mini)
  const out: string[] = []
  for (let c = 0; c < cycles; c++) for (const h of pat.hits(c)) out.push(`${valueName(h.value)}@${t(h.begin)}-${t(h.end)}`)
  return out.sort()
}
function difference(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const left = new Map<string, number>()
  for (const k of before) left.set(k, (left.get(k) ?? 0) + 1)
  const added: string[] = []
  for (const k of after) {
    const n = left.get(k) ?? 0
    if (n > 0) left.set(k, n - 1)
    else added.push(k)
  }
  const removed: string[] = []
  for (const [k, n] of left) for (let i = 0; i < n; i++) removed.push(k)
  return { added: added.sort(), removed: removed.sort() }
}

/** the step written as `text` in bar 0 of `sound`'s row */
function stepOf(trees: readonly BarTree[], sound: string, text: string, mini: string): DivisionStep {
  const d = laneRowForEdit(trees[0], { sound })
  if (!d.ok) throw new Error(d.why)
  let got: DivisionStep | null = null
  const walk = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.span && mini.slice(s.span.start, s.span.end).trim() === text) got = got ?? s
      for (const k of s.rows ?? []) walk(k)
    }
  }
  walk(d.row)
  if (!got) throw new Error(`no ${text}`)
  return got
}

/** every hit Strudel plays over two cycles that it says was written in `[from, to)` of `mini` */
function writtenIn(mini: string, from: number, to: number): string[] {
  const pat = miniPattern(mini)
  const out: string[] = []
  for (let c = 0; c < 2; c++) for (const h of pat.hits(c)) if (h.locations.some((l) => l.start >= from && l.end <= to)) out.push(`${valueName(h.value)}@${t(h.begin)}-${t(h.end)}`)
  return out.sort()
}

/**
 * Did the edit change exactly ONE hit of the written step's `k`, wherever the step plays —
 * and the clicked one among them? Strudel is asked: the change must be hits written in the
 * step (as Strudel locates them), all removed (an erase) or all added at those places, a
 * `k`-th of the step's hits over two cycles, the clicked hit included; nothing else moves.
 */
function oneHitChanged(mini: string, edited: string, s: DivisionStep, clicked: { begin: Frac; end: Frac }, k: number, sound: string): boolean {
  const mine = writtenIn(mini, s.span!.start, s.span!.end)
  const got = difference(plays(mini, 2), plays(edited, 2))
  const key = (n: string): string => `${n}@${str(clicked.begin)}-${str(clicked.end)}`
  if (s.name === sound) {
    return got.added.length === 0 && got.removed.length * k === mine.length && got.removed.every((h) => mine.includes(h)) && got.removed.includes(key(played(s.name!)))
  }
  const name = played(sound)
  return got.removed.length === 0 && got.added.length * k === mine.length && got.added.every((h) => h.startsWith(`${name}@`)) && got.added.includes(key(name))
}

/** how many hits the written step makes: `k` of `x*k`, `x!k`; for euclid (#2434), the hits Strudel plays in it */
const kOf = (mini: string, s: DivisionStep): number =>
  s.ops.includes('bjorklund') ? s.hits.length : Number(/[*!]([0-9]+)/.exec(mini.slice(s.span!.start, s.span!.end))?.[1] ?? 2)

/** click hit `j` of the step: what it writes, and whether Strudel plays exactly that hit changed */
function click(mini: string, sound: string, text: string, j: number): { text: string | null; why?: string; heard: boolean } {
  const trees = chunkDivisions(mini, 1)
  const s = stepOf(trees, sound, text, mini)
  const hits = [...s.hits].sort((x, y) => x.begin.n * y.begin.d - y.begin.n * x.begin.d)
  // a step that plays by chance may drop the hit asked for: the first is then the click
  const at = (hits[j] ?? hits[0])?.begin ?? s.slots[0].begin
  const r = toggleStep(mini, trees, { bar: 0, span: s.span!, at }, { sound })
  if (!r.ok) return { text: null, why: r.why, heard: false }
  const edited = applyStepEdit(mini, r.edit)
  return { text: edited, heard: oneHitChanged(mini, edited, s, hits[j], kOf(mini, s), sound) }
}

/** the innermost step of `sound`'s row that has a slot beginning at `at`, in bar 0 */
function leafAt(trees: readonly BarTree[], sound: string, at: Frac, part?: number): DivisionStep {
  const d = laneRowForEdit(trees[0], { sound, part })
  if (!d.ok) throw new Error(d.why)
  let got: DivisionStep | null = null
  const walk = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.rows) s.rows.forEach(walk)
      else if (s.span && s.slots.some((x) => x.begin.n * at.d === at.n * x.begin.d)) got = got ?? s
    }
  }
  walk(d.row)
  // a place inside a step that plays no hit there (an empty place of a euclid)
  const cover = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.rows) s.rows.forEach(cover)
      else if (s.span && s.slots.some((x) => x.begin.n * at.d <= at.n * x.begin.d && at.n * x.end.d < x.end.n * at.d)) got = got ?? s
    }
  }
  if (!got) cover(d.row)
  if (!got) throw new Error(`no step at ${str(at)}`)
  return got
}

/**
 * A click on the place at `at` (#2437): what it writes, the text a plain toggle would have
 * written there (the step left written out), and whether Strudel plays the two the same.
 */
function placeAt(mini: string, sound: string, at: Frac): { text: string | null; asWrittenOut: string | null; same: boolean } {
  const trees = chunkDivisions(mini, 1)
  const s = leafAt(trees, sound, at)
  const r = toggleStep(mini, trees, { bar: 0, span: s.span!, at }, { sound })
  if (!r.ok) return { text: null, asWrittenOut: null, same: false }
  const text = applyStepEdit(mini, r.edit)
  // the plain toggle: the one place's name changed, nothing respelled
  const asWrittenOut = s.rest ? mini.slice(0, s.head!.start) + sound + mini.slice(s.head!.end) : mini.slice(0, s.head!.start) + '~' + mini.slice(s.head!.end)
  miniTree(text)
  return { text, asWrittenOut, same: JSON.stringify(plays(text, 2)) === JSON.stringify(plays(asWrittenOut, 2)) }
}

/**
 * The hit at `at` of step `s` clicked off, then the same place clicked again: the text in
 * between, the text it ends as, and whether Strudel plays that as it played before both clicks.
 */
function offAndOnAt(mini: string, trees: readonly BarTree[], s: DivisionStep, at: Frac, row: { sound: string; part?: number }): { between: string; back: string; same: boolean } | null {
  const off = toggleStep(mini, trees, { bar: 0, span: s.span!, at }, row)
  if (!off.ok) return null
  const between = applyStepEdit(mini, off.edit)
  // the first click took the hit away: a writer that wrote nothing would pass the round trip
  if (JSON.stringify(plays(between, 2)) === JSON.stringify(plays(mini, 2))) return { between, back: between, same: false }
  const again = chunkDivisions(between, 1)
  const on = toggleStep(between, again, { bar: 0, span: leafAt(again, row.sound, at, row.part).span!, at }, row)
  if (!on.ok) return null
  const back = applyStepEdit(between, on.edit)
  return { between, back, same: JSON.stringify(plays(back, 2)) === JSON.stringify(plays(mini, 2)) }
}

/** hit `j` of the step clicked off, then the same place clicked again: the text it ends as */
function offAndOn(mini: string, sound: string, text: string, j: number): string | null {
  const trees = chunkDivisions(mini, 1)
  const s = stepOf(trees, sound, text, mini)
  const hits = [...s.hits].sort((x, y) => x.begin.n * y.begin.d - y.begin.n * x.begin.d)
  const got = offAndOnAt(mini, trees, s, hits[j].begin, { sound })
  // whatever it ends as, Strudel plays it as it played before both clicks
  expect(got?.same).toBe(true)
  return got?.back ?? null
}

describe('one hit of `x*k` or copy of `x!k` is edited on its own (#2326)', () => {
  it('a hit of `x*k` is written out with the change, and spelled again', () => {
    expect(click('bd hh*4', 'hh', 'hh*4', 2)).toEqual({ text: 'bd [hh hh ~ hh]', heard: true })
    expect(click('bd hh*4', 'hh', 'hh*4', 0)).toEqual({ text: 'bd [~ hh hh hh]', heard: true })
    expect(click('bd hh*4@2 sd', 'hh', 'hh*4@2', 3)).toEqual({ text: 'bd [hh hh hh ~]@2 sd', heard: true })
    // another sound of the part joins that hit as a chord
    expect(click('bd hh*2', 'sd', 'hh*2', 1)).toEqual({ text: 'bd [hh [hh,sd]]', heard: true })
  })

  it('a copy of `x!k` is written out as its copies; three or more left side by side stay `x!k`', () => {
    expect(click('bd!3 sd', 'bd', 'bd!3', 1)).toEqual({ text: 'bd ~ bd sd', heard: true })
    expect(click('bd!4 sd', 'bd', 'bd!4', 3)).toEqual({ text: 'bd!3 ~ sd', heard: true })
  })

  it('a step its group repeats: the hit changes in every copy', () => {
    expect(click('[hh*2 sd]*2', 'hh', 'hh*2', 1)).toEqual({ text: '[[hh ~] sd]*2', heard: true })
  })

  it('one hit of a euclid step is edited on its own, where Strudel plays it (#2434)', () => {
    expect(click('bd(3,8)', 'bd', 'bd(3,8)', 1)).toEqual({ text: '[bd ~ ~ ~ ~ ~ bd ~]', heard: true })
    expect(click('bd(3,8,2) sd', 'bd', 'bd(3,8,2)', 0)).toEqual({ text: '[~ ~ bd ~ ~ bd ~ ~] sd', heard: true })
    expect(click('bd(-3,8)', 'bd', 'bd(-3,8)', 4)).toEqual({ text: '[~ bd bd ~ bd bd ~ ~]', heard: true })
    expect(click('bd(3,8)@2 sd', 'bd', 'bd(3,8)@2', 2)).toEqual({ text: '[bd ~ ~ bd ~ ~ ~ ~]@2 sd', heard: true })
    // another row's sound joins the hit it lands on, as on any step
    expect(click('bd(3,8) sd', 'sd', 'bd(3,8)', 1)).toEqual({ text: '[bd ~ ~ [bd,sd] ~ ~ bd ~] sd', heard: true })
  })

  it('a euclid hit taken off and put back gives back the euclid, byte for byte (#2437)', () => {
    for (const [mini, sound, text] of [
      ['bd(3,8)', 'bd', 'bd(3,8)'],
      ['bd(3,8,2) sd', 'bd', 'bd(3,8,2)'],
      ['bd(5,8)', 'bd', 'bd(5,8)'],
      ['bd(3,8)@2 sd', 'bd', 'bd(3,8)@2'],
      ['bd:2(3,8)', 'bd:2', 'bd:2(3,8)'],
      ['sd [bd(3,8) ~]', 'bd', 'bd(3,8)'],
      ['bd(7,16,14)', 'bd', 'bd(7,16,14)'],
    ]) {
      const hits = stepOf(chunkDivisions(mini, 1), sound, text, mini).hits.length
      expect(hits).toBeGreaterThan(1)
      // every hit, off and on again
      for (let j = 0; j < hits; j++) expect(offAndOn(mini, sound, text, j), `${mini} hit ${j}`).toBe(mini)
    }
  })

  it('a written-out step that is a euclid rhythm is spelled `x(k,n,r)`, and plays as written out (#2437)', () => {
    // the smallest rotation that plays those hits; none written when it is 0
    expect(placeAt('[bd ~ ~ ~ ~ ~ bd ~]', 'bd', F(3, 8))).toEqual({ text: 'bd(3,8)', asWrittenOut: '[bd ~ ~ bd ~ ~ bd ~]', same: true })
    expect(placeAt('[bd ~ ~ ~ ~ bd ~ ~] sd', 'bd', F(1, 8))).toEqual({ text: 'bd(3,8,2) sd', asWrittenOut: '[bd ~ bd ~ ~ bd ~ ~] sd', same: true })
    // its weight goes with it
    expect(placeAt('hh [bd ~ ~ ~ ~ ~ bd ~]@3', 'bd', F(17, 32))).toEqual({ text: 'hh bd(3,8)@3', asWrittenOut: 'hh [bd ~ ~ bd ~ ~ bd ~]@3', same: true })
  })

  it('a shape that is no euclid, or repeats a shorter one, stays written out (#2437)', () => {
    // two hits that are no Bjorklund rhythm
    expect(placeAt('[bd ~ ~ ~ ~ ~ bd ~]', 'bd', F(1, 8)).text).toBe('[bd bd ~ ~ ~ ~ bd ~]')
    // `[bd ~ bd ~]` is `bd(2,4)` too, but it repeats `[bd ~]`: it stays as the rules spell it
    expect(placeAt('[bd ~ ~ ~]', 'bd', F(1, 2)).text).toBe('[bd ~ bd ~]')
    expect(placeAt('[bd ~ ~ ~ ~ ~ ~ ~]', 'bd', F(1, 2)).text).toBe('[bd ~ ~ ~ bd ~ ~ ~]')
    // one hit is a note and its rests, never `bd(1,n)`
    expect(placeAt('[~ ~ ~ ~]', 'bd', F(1, 4)).text).toBe('[~ bd ~ ~]')
    // another sound in the step: no one sound to make a euclid of
    expect(placeAt('[bd ~ ~ sd ~ ~ ~ ~]', 'bd', F(6, 8)).text).toBe('[bd ~ ~ sd ~ ~ bd ~]')
  })

  it('every other op keeps its refusal: chance, a pattern amount, a decimal', () => {
    expect(click('bd(<3 5>,8)', 'bd', 'bd(<3 5>,8)', 1).why).toBe('step-is-generated')
    expect(click('hh*<2 4>', 'hh', 'hh*<2 4>', 1).why).toBe('step-is-generated')
    expect(click('hh*2? sd', 'hh', 'hh*2?', 1).why).toBe('step-is-generated')
    expect(click('hh*1.5 sd', 'hh', 'hh*1.5', 0).why).toBe('step-is-generated')
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

interface GenSide {
  steps: number
  clicks: number
  written: number
  refused: Record<string, number>
  heard: number
  heardBad: string[]
  /** of the above, the euclid steps (#2434): steps, clicks, edits written */
  euclid: { steps: number; clicks: number; written: number }
  /** the step's new text parses (krill) */
  parsed: number
  parseBad: string[]
}

function overCorpus(writer: typeof toggleStep): GenSide {
  const r: GenSide = { steps: 0, clicks: 0, written: 0, refused: {}, heard: 0, heardBad: [], euclid: { steps: 0, clicks: 0, written: 0 }, parsed: 0, parseBad: [] }
  for (const mini of minis) {
    const g = parseStepGrid(mini)
    if (!g.ok || (g.model.bars ?? 1) !== 1) continue
    const trees = chunkDivisions(mini, 1)
    for (const lane of g.model.lanes) {
      const d = laneRowForEdit(trees[0], lane)
      if (!d.ok) continue
      const walk = (row: DivisionRow): void => {
        for (const s of row.steps) {
          for (const k of s.rows ?? []) walk(k)
          if (s.rows || s.rest || !s.span || s.name !== lane.sound || s.hits.length < 2) continue
          if (!s.ops.every((o) => o === 'tail' || o === 'stretch' || o === 'replicate' || o === 'bjorklund') || !s.ops.some((o) => o !== 'tail')) continue
          const euclid = s.ops.includes('bjorklund')
          r.steps++
          if (euclid) r.euclid.steps++
          const hits = [...s.hits].sort((x, y) => x.begin.n * y.begin.d - y.begin.n * x.begin.d)
          hits.forEach((h, j) => {
            r.clicks++
            if (euclid) r.euclid.clicks++
            const res = writer(mini, trees, { bar: 0, span: s.span!, at: h.begin }, { sound: lane.sound, part: lane.part })
            if (!res.ok) {
              r.refused[res.why] = (r.refused[res.why] ?? 0) + 1
              return
            }
            r.written++
            if (euclid) r.euclid.written++
            const edited = applyStepEdit(mini, res.edit)
            try {
              miniTree(edited)
              r.parsed++
            } catch {
              r.parseBad.push(`${JSON.stringify(mini)} → ${JSON.stringify(edited)}`)
            }
            let ok = false
            try {
              ok = oneHitChanged(mini, edited, s, h, kOf(mini, s), lane.sound)
            } catch {
              ok = false
            }
            if (ok) r.heard++
            else if (r.heardBad.length < 40) r.heardBad.push(`${JSON.stringify(mini)} ${lane.sound} hit ${j} → ${JSON.stringify(edited)}`)
          })
        }
      }
      walk(d.row)
    }
  }
  return r
}

describe('one hit of `x*k` / `x!k`, over the corpus (#2326)', () => {
  it('every hit erased plays exactly that hit gone, and its text parses', () => {
    const r = overCorpus(toggleStep)
    if (process.env.GENERATOR_REPORT) writeFileSync(process.env.GENERATOR_REPORT, JSON.stringify(r, null, 1))
    expect(r.clicks).toBeGreaterThan(500)
    expect(r.heardBad).toEqual([])
    expect(r.parseBad).toEqual([])
    expect(r.heard).toBe(r.written)
  }, 900_000)

  it('every euclid hit erased and put back plays as before, and is the euclid again where the rules spell one (#2437)', () => {
    const r = { trips: 0, identical: 0, tight: 0, writtenOut: 0, other: [] as string[], heardBad: [] as string[] }
    for (const mini of minis) {
      const g = parseStepGrid(mini)
      if (!g.ok || (g.model.bars ?? 1) !== 1) continue
      const trees = chunkDivisions(mini, 1)
      for (const lane of g.model.lanes) {
        const d = laneRowForEdit(trees[0], lane)
        if (!d.ok) continue
        const walk = (row: DivisionRow): void => {
          for (const s of row.steps) {
            for (const k of s.rows ?? []) walk(k)
            if (s.rows || !s.span || s.name !== lane.sound || !s.ops.includes('bjorklund')) continue
            const own = mini.slice(s.span.start, s.span.end).trimEnd()
            for (const h of s.hits) {
              const got = offAndOnAt(mini, trees, s, h.begin, { sound: lane.sound, part: lane.part })
              if (!got) continue
              r.trips++
              if (!got.same) r.heardBad.push(`${JSON.stringify(mini)} → ${JSON.stringify(got.back)}`)
              // what the step's own text became; nothing else may change
              const tail = mini.slice(s.span.start + own.length)
              const now = got.back.slice(s.span.start, got.back.length - tail.length)
              const kept = got.back.startsWith(mini.slice(0, s.span.start)) && got.back.endsWith(tail)
              // the parens as written, spaces and a written-out `,0` aside: what the second click cannot know
              const tight = (x: string): string => x.replace(/\(([^()]*)\)/, (_, a: string) => `(${a.replace(/\s+/g, '').replace(/,0$/, '')})`)
              if (got.back === mini) r.identical++
              else if (kept && now === tight(own)) r.tight++
              else if (kept && now.startsWith('[') && !now.includes('(')) r.writtenOut++
              else r.other.push(`${JSON.stringify(mini)} → ${JSON.stringify(got.between)} → ${JSON.stringify(got.back)}`)
            }
          }
        }
        walk(d.row)
      }
    }
    if (process.env.GENERATOR_REPORT) writeFileSync(`${process.env.GENERATOR_REPORT}.euclid-round-trip.json`, JSON.stringify(r, null, 1))
    expect(r.trips).toBeGreaterThan(100)
    expect(r.heardBad).toEqual([])
    expect(r.other).toEqual([])
    // measured 2026-11-11 over this corpus: 57 of 116 byte for byte, 36 the same euclid spelled tight
    expect(r.identical).toBeGreaterThanOrEqual(57)
  }, 900_000)

  it('can go red: an edit that rests the whole step, not the one hit, is heard', () => {
    // the same replacement range, every hit of the step gone: plausible bytes, wrong music
    const whole: typeof toggleStep = (...args) => {
      const r = toggleStep(...args)
      return r.ok ? { ok: true, edit: { ...r.edit, insert: '~' } } : r
    }
    const r = overCorpus(whole)
    expect(r.heardBad.length).toBeGreaterThan(0)
  }, 900_000)
})
