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

/** how many hits the written step makes: `k` of `x*k`, `x!k` */
const kOf = (mini: string, s: DivisionStep): number => Number(/[*!]([0-9]+)/.exec(mini.slice(s.span!.start, s.span!.end))?.[1] ?? 2)

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

  it('every other op keeps its refusal: euclid, chance, a pattern amount, a decimal', () => {
    expect(click('bd(3,8)', 'bd', 'bd(3,8)', 1).why).toBe('step-is-generated')
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
  /** the step's new text parses (krill) */
  parsed: number
  parseBad: string[]
}

function overCorpus(writer: typeof toggleStep): GenSide {
  const r: GenSide = { steps: 0, clicks: 0, written: 0, refused: {}, heard: 0, heardBad: [], parsed: 0, parseBad: [] }
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
          if (!s.ops.every((o) => o === 'tail' || o === 'stretch' || o === 'replicate') || !s.ops.some((o) => o !== 'tail')) continue
          r.steps++
          const hits = [...s.hits].sort((x, y) => x.begin.n * y.begin.d - y.begin.n * x.begin.d)
          hits.forEach((h, j) => {
            r.clicks++
            const res = writer(mini, trees, { bar: 0, span: s.span!, at: h.begin }, { sound: lane.sound, part: lane.part })
            if (!res.ok) {
              r.refused[res.why] = (r.refused[res.why] ?? 0) + 1
              return
            }
            r.written++
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
