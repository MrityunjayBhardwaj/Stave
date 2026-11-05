/**
 * A click edits the step's own text (#2292).
 *
 * Two claims, two halves.
 *
 * FIXTURES — every toggle is checked against STRUDEL, not against our reading of it: the
 * edited string is evaluated and what it plays over two loops must differ from before by
 * exactly the intended hit, in every loop, and by nothing else.
 *
 * THE CORPUS, SIDE BY SIDE — wherever today's grid opens, every step the grid draws is
 * toggled both ways: by today's road (`toggleCell` + `serializeStepGrid`, the click the
 * panel makes) and by `toggleStep`. Wherever both write, the whole strings must be the same
 * bytes. What each side refuses is counted by reason, and the bytes each rewrites per edit
 * are measured. Today's road is asked for the SAME gesture: a placed hit as long as the
 * step it lands on, which is what a click on a drawn step means.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyStepEdit,
  chunkDivisions,
  isCellOn,
  laneDivisions,
  laneRowForEdit,
  parseStepGrid,
  serializeStepGrid,
  toggleCell,
  toggleStep,
  type BarTree,
  type DivisionRow,
  type DivisionStep,
  type Frac,
  type StepAddress,
  type StepEditResult,
  type StepGridModel,
} from '..'
import { miniPattern } from '../strudelMini/pattern'

/**
 * Where to write the full side-by-side difference list, when you want to read it:
 * `STEP_EDIT_REPORT=/some/dir/side-by-side.txt`. Unset, nothing is written.
 */
const REPORT = process.env.STEP_EDIT_REPORT

/* ── asking Strudel ─────────────────────────────────────────────── */

const num = (x: Frac): number => x.n / x.d
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const fr = (n: number, d: number): string => {
  const g = gcd(n, d) || 1
  return d / g === 1 ? String(n / g) : `${n / g}/${d / g}`
}
/** a time as Strudel's own exact fraction */
const t = (x: { toFraction?: () => string; valueOf(): number }): string => x.toFraction?.() ?? String(x.valueOf())
const valueName = (v: unknown): string => (Array.isArray(v) ? v.join(':') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** every hit Strudel plays in cycles `[0, cycles)`, as `name@begin-end` */
function plays(mini: string, cycles: number): string[] {
  const pat = miniPattern(mini)
  const out: string[] = []
  for (let c = 0; c < cycles; c++) for (const h of pat.hits(c)) out.push(`${valueName(h.value)}@${t(h.begin)}-${t(h.end)}`)
  return out.sort()
}

/** what `after` plays that `before` does not, and the other way round, as multisets */
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

interface Toggle {
  mini: string
  bars: number
  trees: readonly BarTree[]
  address: StepAddress
  sound: string
  /** was the row's own note there (an erase) */
  erase: boolean
  /** the step is a plain `x*k` / `x!k` (#2326): its `k` — ONE of its hits changes, not all of them */
  generator?: { k: number; bang: boolean } | null
}

/** the `k` of a written step that is a plain `x*k` / `x!k` — one note, an integer count, nothing else (#2326) — or null */
function plainGeneratorK(text: string): { k: number; bang: boolean } | null {
  const m = /^[^\s[\]<>{}~]+?([*!])([1-9][0-9]*)?(@[1-9][0-9]*)?$/.exec(text.trim())
  if (!m || (m[1] === '*' && !m[2]) || (m[1] === '!' && m[3])) return null
  return { k: m[2] ? Number(m[2]) : 2, bang: m[1] === '!' }
}

/** the hits Strudel plays in cycles `[0, cycles)` whose written place overlaps `[from, to)` */
function playedFrom(mini: string, cycles: number, from: number, to: number): string[] {
  const pat = miniPattern(mini)
  const out: string[] = []
  for (let c = 0; c < cycles; c++) {
    for (const h of pat.hits(c)) {
      if (h.locations.some((l) => l.start < to && l.end > from)) out.push(`${valueName(h.value)}@${t(h.begin)}-${t(h.end)}`)
    }
  }
  return out.sort()
}

/** where the written step at the address begins, over two loops, in every bar it sits in */
function beginsOf(x: Toggle): Set<string> {
  const out = new Set<string>()
  const visit = (r: DivisionRow, b: number): void => {
    for (const s of r.steps) {
      if (s.span && s.span.start === x.address.span.start && s.span.end === x.address.span.end) {
        for (const slot of s.slots) for (let k = 0; k < 2; k++) {
          const at = k * x.bars + b
          out.add(fr(at * slot.begin.d + slot.begin.n, slot.begin.d))
        }
      }
      for (const k of s.rows ?? []) visit(k, b)
    }
  }
  x.trees.forEach((tree, b) => tree.ok && tree.parts.forEach((p) => visit(p, b)))
  return out
}

/**
 * Does the edited string play exactly what the click asks, over two loops — no more, no
 * less? STRUDEL IS ASKED, through where it says each hit was written: the change must be
 * exactly the hits written in the text the edit replaced, against those written in what
 * replaced it, and that change must be the row's sound alone, all added (a place) or all
 * removed (an erase), each hit where the written step sits. A step played in several places
 * changes in every one of them; a hit written anywhere else may not move.
 */
function playsTheStep(x: Toggle, edited: string, edit: { from: number; to: number; insert: string }): { ok: boolean; got: { added: string[]; removed: string[] }; want: { added: string[]; removed: string[] } } {
  const cycles = x.bars * 2
  const want = difference(playedFrom(x.mini, cycles, edit.from, edit.to), playedFrom(edited, cycles, edit.from, edit.from + edit.insert.length))
  const got = difference(plays(x.mini, cycles), plays(edited, cycles))
  // the row's sound as Strudel names what it plays (`sd:1:.6` plays as `sd:1:0.6`)
  const name = valueName(miniPattern(x.sound).hits(0)[0].value)
  const net = x.erase ? want.removed : want.added
  // one hit at every place the written step sits, and nowhere else
  const begins = beginsOf(x)
  const at = new Set(net.map((k) => k.slice(name.length + 1).split('-')[0]))
  // A plain `x*k` / `x!k` (#2326) changes ONE of its hits — the one clicked, wherever the
  // step plays — not one per place the step's slot begins: the clicked hit must be among
  // them, and fewer hits change than the step plays.
  const clicked = fr(x.address.at.n + x.address.bar * x.address.at.d, x.address.at.d)
  // A plain `x*k` / `x!k` (#2326): the clicked hit changes at every place the written step
  // plays — one per place its slot begins (`x*k`, and `x!k` laid in one slot), or a `k`-th of
  // its copies' slots (`x!k` whose copies are slots of their own, as in an alternation)
  const shape = x.generator
    ? at.has(clicked) && (net.length === begins.size || (x.generator.bang && net.length * x.generator.k === begins.size))
    : net.length === begins.size && [...begins].every((b) => at.has(b))
  const ok =
    JSON.stringify(got) === JSON.stringify(want) &&
    (x.erase ? want.added : want.removed).length === 0 &&
    net.every((k) => k.startsWith(`${name}@`)) &&
    shape
  return { ok, got, want }
}

/** the one replacement that turns `before` into `after`, once the common head and tail are set aside */
function editOf(before: string, after: string): { from: number; to: number; insert: string } {
  const [a, z] = changed(before, after)
  return { from: a, to: z, insert: after.slice(a, after.length - (before.length - z)) }
}

/* ── fixtures ───────────────────────────────────────────────────── */

/** the step of `sound`'s row written as `text`, at its `nth` slot in bar `bar`, at any depth */
function stepAt(trees: readonly BarTree[], bar: number, sound: string, part: number | undefined, text: string, mini: string, nth = 0): { address: StepAddress; end: Frac } {
  const d = laneDivisions(trees[bar], { sound, part })
  if (!d.ok) throw new Error(`${mini}: ${d.why}`)
  const all: DivisionStep[] = []
  const walk = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.span && mini.slice(s.span.start, s.span.end).trim() === text) all.push(s)
      for (const k of s.rows ?? []) walk(k)
    }
  }
  walk(d.row)
  const flat = all.flatMap((s) => s.slots.map((slot) => ({ s, slot })))
  const hit = flat[nth]
  if (!hit) throw new Error(`${mini}: no step ${text} #${nth} in bar ${bar}`)
  return { address: { bar, span: hit.s.span!, at: hit.slot.begin }, end: hit.slot.end }
}

function toggle(mini: string, sound: string, text: string, opts: { bars?: number; bar?: number; part?: number; nth?: number } = {}): { result: StepEditResult; x: Toggle } {
  const bars = opts.bars ?? 1
  const bar = opts.bar ?? 0
  const trees = chunkDivisions(mini, bars)
  const { address } = stepAt(trees, bar, sound, opts.part, text, mini, opts.nth)
  const result = toggleStep(mini, trees, address, { sound, part: opts.part })
  // the step's name: what comes before its length, holds or op (`hh` of `hh*4`)
  const erase = text.split(/[@\s_*!(?]/)[0] === sound
  return { result, x: { mini, bars, trees, address, sound, erase, generator: plainGeneratorK(text) } }
}

/** the toggle writes `want`, and Strudel plays exactly what the click asks, no more */
function writes(mini: string, sound: string, text: string, want: string, opts: Parameters<typeof toggle>[3] = {}): void {
  const { result, x } = toggle(mini, sound, text, opts)
  if (!result.ok) throw new Error(`${mini} ${sound}@${text}: refused ${result.why}`)
  const edited = applyStepEdit(mini, result.edit)
  expect(edited).toBe(want)
  const heard = playsTheStep(x, edited, result.edit)
  expect(heard.ok, `${mini} → ${edited}: ${JSON.stringify(heard)}`).toBe(true)
}

/** the toggle and a second toggle on the same step give back the text that was there */
function roundTrips(mini: string, sound: string, text: string, opts: Parameters<typeof toggle>[3] = {}): void {
  const { result } = toggle(mini, sound, text, opts)
  if (!result.ok) throw new Error(`${mini}: refused ${result.why}`)
  const once = applyStepEdit(mini, result.edit)
  // the step the first edit wrote, found again by the text it now has
  const back = toggle(once, sound, sound, { ...opts, nth: 0 })
  if (!back.result.ok) throw new Error(`${once}: refused ${back.result.why}`)
  expect(applyStepEdit(once, back.result.edit)).toBe(mini)
}

function refuses(mini: string, sound: string, text: string, why: string, opts: Parameters<typeof toggle>[3] = {}): void {
  expect(toggle(mini, sound, text, opts).result).toEqual({ ok: false, why })
}

describe('toggleStep — one step, its own text, checked by Strudel', () => {
  it('a rest becomes the row’s sound, and the row’s note becomes a rest', () => {
    writes('bd ~ sd ~', 'sd', '~', 'bd sd sd ~')
    writes('bd ~ sd ~', 'sd', '~', 'bd ~ sd sd', { nth: 1 })
    writes('bd ~ sd ~', 'sd', 'sd', 'bd ~ ~ ~')
    writes('bd ~ sd ~', 'bd', 'bd', '~ ~ sd ~')
    writes('bd - sd', 'bd', '-', 'bd bd sd')
  })

  it('nested steps: the step inside the step is written where it is', () => {
    writes('~ [~ [bd ~]]', 'bd', 'bd', '~ [~ [~ ~]]')
    writes('~ [~ [bd ~]]', 'bd', '~', 'bd [~ [bd ~]]', { nth: 0 })
    writes('~ [~ [bd ~]]', 'bd', '~', '~ [~ [bd bd]]', { nth: 2 })
  })

  it('a weight stays as written: the hit lasts the step', () => {
    writes('bd@2 ~ sd', 'bd', 'bd@2', '~@2 ~ sd')
    writes('~@3 bd', 'bd', '~@3', 'bd@3 bd')
    writes('bd _ _ sd', 'bd', 'bd _ _', '~ _ _ sd')
  })

  it('a `:` tail is part of the name: the row is `bd:4`, and the tail goes with the note', () => {
    writes('bd:4 ~ sd', 'bd:4', 'bd:4', '~ ~ sd')
    writes('bd:4 ~ sd', 'bd:4', '~', 'bd:4 bd:4 sd')
    writes('bd:4@2 ~', 'bd:4', 'bd:4@2', '~@2 ~')
  })

  it('comma parts: the row edits its own part, leaving the other alone', () => {
    writes('bd ~ bd ~, hh ~ hh hh', 'hh', '~', 'bd ~ bd ~, hh hh hh hh', { part: 1, nth: 0 })
    writes('bd ~ bd ~, hh ~ hh hh', 'bd', '~', 'bd ~ bd bd, hh ~ hh hh', { part: 0, nth: 1 })
    // a stack inside a step: the row's own layer
    writes('[bd ~, hh hh] sd', 'bd', '~', '[bd bd, hh hh] sd')
    writes('[bd ~, hh hh] sd', 'hh', 'hh', '[bd ~, ~ hh] sd')
  })

  it('a step another sound of the part plays: the row joins it as a chord, in the order the part writes them', () => {
    writes('bd sd', 'sd', 'bd', '[bd,sd] sd')
    writes('bd sd', 'bd', 'sd', 'bd [bd,sd]')
    writes('bd hh sd hh', 'sd', 'hh', 'bd [hh,sd] sd hh')
    writes('bd@2 sd', 'sd', 'bd@2', '[bd,sd]@2 sd')
    // a chord already written takes the sound in its own brackets, spaced as it is spaced
    writes('[bd, hh] sd', 'sd', '[bd, hh]', '[bd, hh, sd] sd')
    writes('[bd,hh] sd', 'sd', '[bd,hh]', '[bd,hh,sd] sd')
    writes('[e3] [b3]', 'b3', 'e3', '[e3,b3] [b3]')
    writes('[e3] [b3]', 'e3', 'b3', '[e3] [e3,b3]')
    // the row's note leaves a chord; a chord left with one member is that member
    writes('[bd,sd] hh', 'sd', 'sd', 'bd hh')
    writes('[bd, sd]@2 hh', 'bd', 'bd', 'sd@2 hh')
    writes('[bd, hh, sd] cp', 'hh', 'hh', '[bd, sd] cp')
    writes('[bd, hh, sd] cp', 'bd', 'bd', '[hh, sd] cp')
    writes('[bd, hh, sd] cp', 'sd', 'sd', '[bd, hh] cp')
    // a chord of one has nothing to leave: its note becomes a rest
    writes('[e3] [b3]', 'e3', 'e3', '[~] [b3]')
  })

  it('a row whose sound the text does not write yet (a voice just added) edits its part', () => {
    const mini = 'bd ~ sd ~'
    const trees = chunkDivisions(mini, 1)
    const rest = stepAt(trees, 0, 'bd', undefined, '~', mini)
    const r = toggleStep(mini, trees, rest.address, { sound: 'cp' })
    expect(r.ok && applyStepEdit(mini, r.edit)).toBe('bd cp sd ~')
    const kick = stepAt(trees, 0, 'bd', undefined, 'bd', mini)
    const k = toggleStep(mini, trees, kick.address, { sound: 'cp', order: ['bd', 'sd', 'cp'] })
    expect(k.ok && applyStepEdit(mini, k.edit)).toBe('[bd,cp] ~ sd ~')
    // under several parts, a new voice with no part named has none to edit
    const two = chunkDivisions('bd ~, hh hh', 1)
    expect(toggleStep('bd ~, hh hh', two, stepAt(two, 0, 'bd', 0, '~', 'bd ~, hh hh').address, { sound: 'cp' })).toEqual({ ok: false, why: 'lane-part-unknown' })
  })

  it('a click and a second click on the same step give back the text', () => {
    roundTrips('bd sd', 'sd', 'bd')
    roundTrips('[bd, hh] sd', 'sd', '[bd, hh]')
    roundTrips('bd ~ sd ~', 'sd', '~')
    roundTrips('bd@2 sd', 'sd', 'bd@2')
  })

  it('an alternation’s arm is a step of the one bar that plays it', () => {
    writes('<bd ~> hh', 'bd', '~', '<bd bd> hh', { bars: 2, bar: 1 })
    writes('<bd ~> hh', 'bd', 'bd', '<~ ~> hh', { bars: 2, bar: 0 })
  })

  it('a step written once and played in several places changes in every one (ruling of 2026-11-04)', () => {
    // a group repeated by its op: both copies
    writes('[bd ~]*2 sd', 'bd', '~', '[bd bd]*2 sd')
    writes('[bd ~]!2 sd', 'bd', '~', '[bd bd]!2 sd')
    writes('[~ bd](3,8)', 'bd', 'bd', '[~ ~](3,8)')
    // an alternation's arm that comes round twice in four bars
    writes('<bd ~> hh', 'bd', '~', '<bd bd> hh', { bars: 4, bar: 1 })
    // a polymeter plays its one `bd` twice in the first bar, and comes round in three bars
    writes('{bd ~ sd}%4', 'bd', 'bd', '{~ ~ sd}%4', { bars: 3 })
  })
})

describe('toggleStep — refused where no change to one text is the one click', () => {
  it('a generated step keeps its generator', () => {
    refuses('bd(3,8) ~', 'bd', 'bd(3,8)', 'step-is-generated')
    refuses('bd? ~', 'bd', 'bd?', 'step-is-generated')
    refuses('hh*<2 4> ~', 'hh', 'hh*<2 4>', 'step-is-generated')
    refuses('hh*1.5 ~', 'hh', 'hh*1.5', 'step-is-generated')
    // a rest made copies has no hit to edit
    refuses('bd ~!2', 'bd', '~!2', 'step-is-replicated')
  })

  it('one hit of a plain `x*k`, one copy of `x!k`, is edited on its own (#2326)', () => {
    writes('hh*4 ~', 'hh', 'hh*4', '[~ hh hh hh] ~')
    writes('bd!3 ~', 'bd', 'bd!3', '~ bd bd ~')
    writes('bd! ~', 'bd', 'bd!', '~ bd ~')
  })

  it('a step in a random choice', () => {
    refuses('[bd | ~] sd', 'bd', 'bd', 'step-is-a-random-choice')
  })

  it('an alternation the loop does not fill: the edit would change bars the view does not show', () => {
    // `<bd ~ sd ~>` over TWO bars: its `sd` and last `~` never come round, so the loop is one
    // turn of four bars
    refuses('<bd ~ sd ~> hh', 'bd', '~', 'loop-shorter-than-the-pattern', { bars: 2, bar: 1 })
    writes('<bd ~ sd ~> hh', 'bd', '~', '<bd bd sd ~> hh', { bars: 4, bar: 1 })
  })

  it('a group step, a name that is not one run of text, a tree of another string', () => {
    refuses('[bd sd, hh] cp', 'cp', '[bd sd, hh]', 'step-is-a-group')
    // the `sd` row on a note whose tail alternates: its name is no one run of text
    refuses('bd:<1 2> sd', 'sd', 'bd:<1 2>', 'step-has-no-text')
    // and the row of that note's own name lands on the same step, which has no name to change
    expect(toggleStep('bd:<1 2> ~', chunkDivisions('bd:<1 2> ~', 1), { bar: 0, span: { start: 0, end: 9 }, at: { n: 0, d: 1 } }, { sound: 'bd' })).toEqual({ ok: false, why: 'step-has-no-text' })
    const mini = 'bd ~ sd ~'
    const trees = chunkDivisions(mini, 1)
    const { address } = stepAt(trees, 0, 'sd', undefined, '~', mini)
    expect(toggleStep('bd x sd ~', trees, address, { sound: 'sd' })).toEqual({ ok: false, why: 'tree-is-not-this-text' })
    expect(toggleStep(mini, trees, { ...address, at: { n: 1, d: 3 } }, { sound: 'sd' })).toEqual({ ok: false, why: 'no-step-there' })
    expect(toggleStep(mini, trees, { ...address, bar: 1 }, { sound: 'sd' })).toEqual({ ok: false, why: 'no-such-bar' })
  })

  it('the Strudel check can go red: an edit one step off plays the wrong hit', () => {
    const { result, x } = toggle('bd ~ sd ~', 'sd', '~')
    if (!result.ok) throw new Error(result.why)
    // the same insert, one step later: `bd ~ sd sd` instead of `bd sd sd ~`
    const off = { from: result.edit.from + 5, to: result.edit.to + 5, insert: result.edit.insert }
    const shifted = applyStepEdit(x.mini, off)
    expect(shifted).toBe('bd ~ sd sd')
    expect(playsTheStep(x, shifted, off).ok).toBe(false)
    expect(playsTheStep(x, applyStepEdit(x.mini, result.edit), result.edit).ok).toBe(true)
    // and an edit that changes one copy of a repeated step but not the other is not the click
    const two = toggle('[bd ~]*2 sd', 'bd', '~')
    if (!two.result.ok) throw new Error(two.result.why)
    const oneCopy = '[[bd ~] [bd bd]] sd'
    expect(playsTheStep(two.x, oneCopy, editOf(two.x.mini, oneCopy)).ok).toBe(false)
  })
})

/* ── the corpus, side by side ───────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

function barColumns(m: StepGridModel, b: number): { start: number; per: number } {
  const bars = m.bars ?? 1
  if (m.barSteps) return { start: m.barSteps.slice(0, b).reduce((a, n) => a + n, 0), per: m.barSteps[b] }
  return { start: b * (m.steps / bars), per: m.steps / bars }
}

/**
 * The inner row of a group step a grid row draws — the same rule as the grid's
 * `innerRow` (`visualEdit/panels/gridZoom.ts`), restated here because codeView's tests do
 * not reach into the views: its only row, or under several the one that writes the sound.
 */
function innerRow(s: DivisionStep, sound: string): DivisionRow | null {
  if (!s.rows || s.oneOf) return null
  if (s.rows.length === 1) return s.rows[0]
  const mine = s.rows.filter((r) => r.sounds.includes(sound))
  return mine.length === 1 ? mine[0] : null
}

/** the steps a grid row draws in a bar: each leaf, or a group it does not open */
function drawnSteps(row: DivisionRow, sound: string, out: DivisionStep[] = []): DivisionStep[] {
  for (const s of row.steps) {
    const inner = s.rows ? innerRow(s, sound) : null
    if (inner) drawnSteps(inner, sound, out)
    else out.push(s)
  }
  return out
}

/** the stretch `[from, to)` of `before` a change touched, once the common head and tail are set aside */
function changed(before: string, after: string): [number, number] {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  let z = 0
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++
  return [a, before.length - z]
}

/**
 * Where two writes that PLAY THE SAME differ in spelling, which of today's respellings it
 * is: bytes outside the clicked step's text, `_` holds written into the step, or a chord's
 * members spaced or ordered differently. Anything else is 'unexplained' and fails the test.
 */
function spelling(mini: string, today: string, mine: string, span: { start: number; end: number }, sound: string): string {
  const [a, z] = changed(mini, today)
  if (a < span.start || z > span.end) return 'same music — today rewrites bytes outside the step'
  const theirs = today.slice(a, today.length - (mini.length - z))
  if (/(^|[\s[])_(?=[\s\]]|$)/.test(theirs)) return 'same music — today writes `_` holds into the step'
  // a chord: the members as each string writes them, at the place the step is
  const chordAt = (s: string, at: number): string[] | null => {
    // `at` is where a change starts: the chord's `[` is before it, its `]` at or after it
    let open = at - 1
    while (open >= 0 && s[open] !== '[' && s[open] !== ']') open--
    let close = at
    while (close < s.length && s[close] !== ']' && s[close] !== '[') close++
    if (s[open] !== '[' || s[close] !== ']') return null
    const members = s.slice(open + 1, close).split(',').map((m) => m.trim())
    return members.every((m) => m !== '' && !/\s/.test(m)) ? members : null
  }
  const [b] = changed(mini, mine)
  const before = chordAt(mini, b) ?? [mini.slice(span.start, span.end).trim()]
  const ours = chordAt(mine, b)
  const theirsChord = chordAt(today, a)
  // the row's note in a chord: today writes a rest in its place, the new edit takes it out
  // (and drops the brackets when one member is left) — the ruling of 2026-11-04
  if (theirsChord && theirsChord.includes('~') && !before.includes('~')) {
    const left = theirsChord.filter((m) => m !== '~')
    const taken = editOf(mini, mine).insert.trim()
    if ((ours && JSON.stringify(ours) === JSON.stringify(left)) || (left.length === 1 && taken === left[0])) return 'by design — the row’s note leaves the chord (ruling of 2026-11-04); today writes a rest in it'
  }
  if (ours && theirsChord) {
    const without = (xs: string[]): string[] => xs.filter((x) => x !== sound || before.includes(sound))
    const keep = JSON.stringify(without(ours)) === JSON.stringify(before)
    const sameSet = JSON.stringify([...ours].sort()) === JSON.stringify([...theirsChord].sort())
    // ours keeps the members where the author wrote them and today's moves them: today reorders
    if (keep && sameSet && JSON.stringify(without(theirsChord)) !== JSON.stringify(before)) return 'same music — today reorders the chord’s members into its row order'
    if (keep && JSON.stringify(ours) === JSON.stringify(theirsChord.map((m) => m.trim()))) return 'same music — today drops the chord’s spaces'
  }
  const spaced = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*([[\]<>,])\s*/g, '$1')
  if (spaced(today) === spaced(mine)) return 'same music — today changes the spacing beside the step'
  if (/@/.test(mini.slice(span.start, span.end)) && !/@/.test(theirs)) return 'same music — today writes the step’s weight out as steps'
  // #2326 (the ruling of 2026-11-05): copies the edit leaves side by side are spelled `x!k`, even hits `x*k`
  // the step was written `x!k` / `x*k` and the new edit keeps that form for what is left, where
  // today writes every copy out
  const [ma, mz] = changed(mini, mine)
  const written = mine.slice(ma, mine.length - (mini.length - mz))
  const kept = /[!*][0-9]/.test(mini.slice(span.start, span.end)) && /[!*][0-9]/.test(mine.slice(span.start, span.end + (mine.length - mini.length)))
  // the written-out step keeps the brackets that make it one step; today, where the step is
  // the whole pattern, writes the copies bare
  if (today.replace(/[[\]]/g, '') === mine.replace(/[[\]]/g, '')) return 'same music — the written-out step keeps its brackets; today drops them (#2326)'
  // the written-out step stays ONE step of its group (`[~ bd]`); today writes its hits as
  // several steps of the group at the group's own resolution (`~ ~ bd`)
  if (!/[[\]]/.test(theirs) && /^\[[^[\]]*\]$/.test(written.trim())) return 'same music — the written-out step stays one step; today writes it as several steps of its group (#2326)'
  if ((/[!*][0-9]/.test(written) || kept) && !/[!*][0-9]/.test(theirs)) return 'by design — today writes the copies out; the new edit spells them `x!k` / `x*k` (#2326)'
  return 'same music — unexplained'
}

/** bytes a change rewrites: removed + inserted, once the common head and tail are set aside */
function rewritten(before: string, after: string): number {
  const [a, z] = changed(before, after)
  return z - a + (after.length - before.length + (z - a))
}

interface SideBySide {
  grids: number
  asked: number
  agree: number
  /** both write and the bytes differ, by why */
  differ: Record<string, string[]>
  /** today writes, the new writer refuses — by the new writer's reason */
  newRefuses: Record<string, number>
  /** the new writer writes, today refuses */
  todayRefuses: number
  todayRefusesList: string[]
  /** both refuse, by the new writer's reason */
  bothRefuse: Record<string, number>
  /** addresses skipped before either writer is asked, and why */
  skipped: Record<string, number>
  /** every new-writer edit: does Strudel play exactly the intended hit? */
  strudelOk: number
  strudelBad: string[]
  bytesNew: number[]
  bytesToday: number[]
  bytesTodayAgreeing: number[]
  examplesNewRefuses: Record<string, string[]>
}

type Writer = typeof toggleStep

function sideBySide(writer: Writer, opts: { strudel: boolean; limit?: number }): SideBySide {
  const r: SideBySide = {
    grids: 0,
    asked: 0,
    agree: 0,
    differ: {},
    newRefuses: {},
    todayRefuses: 0,
    todayRefusesList: [],
    bothRefuse: {},
    skipped: {},
    strudelOk: 0,
    strudelBad: [],
    bytesNew: [],
    bytesToday: [],
    bytesTodayAgreeing: [],
    examplesNewRefuses: {},
  }
  const bump = (o: Record<string, number>, k: string): void => {
    o[k] = (o[k] ?? 0) + 1
  }
  for (const mini of minis.slice(0, opts.limit)) {
    const g = parseStepGrid(mini)
    if (!g.ok) continue
    r.grids++
    const m = g.model
    const bars = m.bars ?? 1
    const trees = chunkDivisions(mini, bars)
    m.lanes.forEach((lane, li) => {
      for (let b = 0; b < bars; b++) {
        // the row a click edits — the one the panel asks for (`laneRowForEdit`)
        const d = laneRowForEdit(trees[b], lane)
        if (!d.ok) {
          bump(r.skipped, `row has no tree row: ${d.why}`)
          continue
        }
        const { start, per } = barColumns(m, b)
        for (const s of drawnSteps(d.row, lane.sound)) {
          if (!s.span) {
            bump(r.skipped, 'step has no span')
            continue
          }
          for (const slot of s.slots) {
            const begin = num(slot.begin)
            if (begin < 0 || begin >= 1) continue
            const c = begin * per
            const w = (num(slot.end) - begin) * per
            if (Math.abs(c - Math.round(c)) > 1e-9 || Math.abs(w - Math.round(w)) > 1e-9 || Math.round(w) < 1) {
              bump(r.skipped, 'step is not whole columns')
              continue
            }
            const col = start + Math.round(c)
            r.asked++
            const on = isCellOn(lane.cells[col])
            const next = toggleCell(m, li, col, !on, on ? 1 : Math.round(w))
            const today = next === m ? null : serializeStepGrid(next)
            const address: StepAddress = { bar: b, span: s.span, at: slot.begin }
            // the grid's own rows of this part, in its order: a chord writes them so
            const order = m.lanes.filter((l) => (l.part ?? 0) === (lane.part ?? 0)).map((l) => l.sound)
            const mine = writer(mini, trees, address, { sound: lane.sound, part: lane.part, order })
            const mineText = mine.ok ? applyStepEdit(mini, mine.edit) : null
            const where = `${JSON.stringify(mini)} row ${lane.sound}${lane.part === undefined ? '' : ` (part ${lane.part})`} bar ${b} col ${col} step ${JSON.stringify(mini.slice(s.span.start, s.span.end).trim())}`
            const x: Toggle = { mini, bars, trees, address, sound: lane.sound, erase: s.name === lane.sound && !s.rest, generator: plainGeneratorK(mini.slice(s.span.start, s.span.end)) }
            /** does `text` play exactly what the click asks? today's text is judged by the same rule, through its own edit */
            const isTheClick = (text: string): boolean => {
              try {
                return playsTheStep(x, text, editOf(mini, text)).ok
              } catch {
                return false
              }
            }
            if (mine.ok) {
              r.bytesNew.push(rewritten(mini, mineText!))
              if (opts.strudel) {
                let heard: ReturnType<typeof playsTheStep> | null = null
                try {
                  heard = playsTheStep(x, mineText!, mine.edit)
                } catch {
                  heard = null
                }
                if (heard?.ok) r.strudelOk++
                else r.strudelBad.push(`${where} → ${JSON.stringify(mineText)} ${heard ? JSON.stringify(heard) : 'does not evaluate'}`)
              }
            }
            if (today !== null) r.bytesToday.push(rewritten(mini, today))
            if (today !== null && mineText !== null) {
              if (today === mineText) {
                r.agree++
                r.bytesTodayAgreeing.push(rewritten(mini, today))
              } else {
                // WHY do they differ? Asked, not assumed: does Strudel play the two the same,
                // and did today's writer change bytes outside the clicked step's own text?
                let same = false
                try {
                  same = JSON.stringify(plays(today, bars * 2)) === JSON.stringify(plays(mineText!, bars * 2))
                } catch {
                  same = false
                }
                const kind = same
                  ? spelling(mini, today, mineText!, s.span, lane.sound)
                  : !isTheClick(mineText!)
                    ? 'PLAYS DIFFERENTLY — the new edit does not play the click'
                    : isTheClick(today)
                      ? 'PLAYS DIFFERENTLY — both play the click'
                      : beginsOf(x).size > 2
                        ? 'by design — the step plays in several places: today changes the one clicked, the new edit every one (ruling of 2026-11-04)'
                        : 'today plays other than the click; the new edit plays exactly it'
                const list = (r.differ[kind] ??= [])
                list.push(`${where}\n      today: ${JSON.stringify(today)}\n      new:   ${JSON.stringify(mineText)}`)
              }
            } else if (today !== null && !mine.ok) {
              bump(r.newRefuses, mine.why)
              const ex = (r.examplesNewRefuses[mine.why] ??= [])
              if (ex.length < 4) ex.push(`${where} — today writes ${JSON.stringify(today)}`)
            } else if (today === null && mine.ok) {
              r.todayRefuses++
              if (r.todayRefusesList.length < 40) r.todayRefusesList.push(`${where} → new ${JSON.stringify(mineText)}`)
            } else if (!mine.ok) bump(r.bothRefuse, mine.why)
          }
        }
      }
    })
  }
  return r
}

const stats = (xs: number[]): string => {
  if (xs.length === 0) return 'n=0'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `n=${s.length} total=${s.reduce((a, b) => a + b, 0)} median=${at(0.5)} p95=${at(0.95)} max=${s[s.length - 1]}`
}

function report(r: SideBySide, title: string): string {
  const lines = [
    `# ${title}`,
    `corpus: ${minis.length} distinct patterns; ${r.grids} open as a step grid today`,
    `addresses asked (row × bar × drawn step slot on whole columns): ${r.asked}`,
    `both write: agree ${r.agree}, differ ${Object.values(r.differ).reduce((a, v) => a + v.length, 0)} ${JSON.stringify(Object.fromEntries(Object.entries(r.differ).map(([k, v]) => [k, v.length])))}`,
    `today writes, new refuses: ${Object.values(r.newRefuses).reduce((a, b) => a + b, 0)} ${JSON.stringify(r.newRefuses)}`,
    `new writes, today refuses: ${r.todayRefuses}`,
    `both refuse (by new reason): ${JSON.stringify(r.bothRefuse)}`,
    `skipped before asking: ${JSON.stringify(r.skipped)}`,
    `Strudel plays exactly the intended hit (new writer, every edit): ${r.strudelOk} ok, ${r.strudelBad.length} not`,
    `bytes rewritten per edit — new writer (every edit): ${stats(r.bytesNew)}`,
    `bytes rewritten per edit — today (every edit): ${stats(r.bytesToday)}`,
    `bytes rewritten per edit — today, on the edits that agree: ${stats(r.bytesTodayAgreeing)}`,
    '',
    '## differences, every one, by why',
    ...Object.entries(r.differ).flatMap(([k, v]) => [`### ${k} (${v.length})`, ...v]),
    '',
    '## new refuses where today writes — examples',
    ...Object.entries(r.examplesNewRefuses).flatMap(([k, v]) => [`### ${k}`, ...v]),
    '',
    '## new writes where today refuses (first 40)',
    ...r.todayRefusesList,
    '',
    '## Strudel disagrees with the intended hit',
    ...r.strudelBad.slice(0, 60),
  ]
  return lines.join('\n')
}

function write(name: string, text: string): void {
  if (!REPORT) return
  const file = name === 'main' ? REPORT : REPORT.replace(/\.txt$/, `-${name}.txt`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

describe('toggleStep — the corpus, side by side with today’s grid', () => {
  it('wherever both write, the bytes are the same; every new edit plays exactly the intended hit', () => {
    const r = sideBySide(toggleStep, { strudel: true })
    write('main', report(r, 'toggleStep vs toggleCell + serializeStepGrid'))
    expect(r.differ['PLAYS DIFFERENTLY — the new edit does not play the click'] ?? []).toEqual([])
    expect(r.differ['PLAYS DIFFERENTLY — both play the click'] ?? []).toEqual([])
    expect(r.differ['same music — unexplained'] ?? []).toEqual([])
    expect(r.strudelBad).toEqual([])
  }, 900_000)

  // The side-by-side must be able to fail. Two broken writers, each over the first 300
  // patterns: it must catch both, by the arm that is meant to catch them.
  it('can go red: an edit one byte off plays the wrong thing, and Strudel says so', () => {
    const offByOne: Writer = (...args) => {
      const r = toggleStep(...args)
      return r.ok ? { ok: true, edit: { ...r.edit, from: r.edit.from + 1, to: r.edit.to + 1 } } : r
    }
    const r = sideBySide(offByOne, { strudel: true, limit: 300 })
    write('break-off-by-one', report(r, 'BREAK TEST: every edit one byte later'))
    expect(r.strudelBad.length).toBeGreaterThan(0)
    expect((r.differ['PLAYS DIFFERENTLY — the new edit does not play the click'] ?? []).length).toBeGreaterThan(0)
    expect(r.agree).toBe(0)
  }, 300_000)

  it('can go red: a chord written in the wrong order is a difference nothing explains', () => {
    const backwards: Writer = (mini, trees, address, row) => toggleStep(mini, trees, address, { ...row, order: [...(row.order ?? [])].reverse() })
    const r = sideBySide(backwards, { strudel: false, limit: 300 })
    write('break-chord-order', report(r, 'BREAK TEST: chords in the reverse of the row order'))
    expect((r.differ['same music — unexplained'] ?? []).length).toBeGreaterThan(0)
  }, 300_000)
})
