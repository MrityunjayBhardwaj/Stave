/**
 * Split and resize walk steps (#2293): each edit is one replacement at the step's own text,
 * and STRUDEL IS ASKED what it plays — over two loops, the edited string must differ from
 * the original by exactly the intended hits, at every place the written step plays.
 *
 * - a split adds the row's hit where the click is, and the step's own hit (if any) now
 *   lasts its first part;
 * - a resize changes the note's length and nothing else.
 *
 * The corpus half compares the resize side by side with today's column writer
 * (`resizeCell` + `serializeStepGrid`), as stage 2 did for the click.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyStepEdit,
  chunkDivisions,
  isCellOn,
  laneDivisions,
  laneRowForEdit,
  parseStepGrid,
  resizeCell,
  resizeStep,
  serializeStepGrid,
  splitStep,
  toggleCell,
  toggleStep,
  type BarTree,
  type DivisionRow,
  type DivisionStep,
  type Frac,
  type StepAddress,
  type StepEditResult,
} from '..'
import { miniPattern } from '../strudelMini/pattern'

/* ── exact time, and asking Strudel ─────────────────────────────── */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const F = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}
const add = (a: Frac, b: Frac): Frac => F(a.n * b.d + b.n * a.d, a.d * b.d)
const sub = (a: Frac, b: Frac): Frac => F(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: Frac, k: Frac): Frac => F(a.n * k.n, a.d * k.d)
const str = (x: Frac): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`)
const t = (x: { toFraction?: () => string; valueOf(): number }): string => x.toFraction?.() ?? String(x.valueOf())
const valueName = (v: unknown): string => (Array.isArray(v) ? v.join(':') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))
/** a name as Strudel names what it plays */
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

/** every place over two loops the written step at `span` sits: `[begin, end)` in cycles */
function placesOf(trees: readonly BarTree[], span: { start: number; end: number }): Array<{ b: Frac; e: Frac; step: DivisionStep }> {
  const out: Array<{ b: Frac; e: Frac; step: DivisionStep }> = []
  const bars = trees.length
  trees.forEach((tree, bar) => {
    if (!tree.ok) return
    const visit = (r: DivisionRow): void => {
      for (const s of r.steps) {
        if (s.span && s.span.start === span.start && s.span.end === span.end) {
          for (const slot of s.slots) {
            if (slot.fromBefore) continue
            for (let k = 0; k < 2; k++) {
              const at = F(k * bars + bar)
              out.push({ b: add(at, slot.begin), e: add(at, slot.end), step: s })
            }
          }
        }
        for (const k of s.rows ?? []) visit(k)
      }
    }
    tree.parts.forEach(visit)
  })
  return out
}

/* ── fixtures ───────────────────────────────────────────────────── */

/** the step of `sound`'s row written as `text` (its `nth` slot), in bar `bar` */
function stepAt(mini: string, trees: readonly BarTree[], bar: number, sound: string, text: string, nth = 0): { address: StepAddress; end: Frac; step: DivisionStep } {
  const d = laneDivisions(trees[bar], { sound })
  const row = d.ok ? d.row : (() => {
    const r = laneRowForEdit(trees[bar], { sound })
    if (!r.ok) throw new Error(`${mini}: ${r.why}`)
    return r.row
  })()
  const all: Array<{ s: DivisionStep; slot: DivisionStep['slots'][number] }> = []
  const walk = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.span && mini.slice(s.span.start, s.span.end).trim() === text) for (const slot of s.slots) all.push({ s, slot })
      for (const k of s.rows ?? []) walk(k)
    }
  }
  walk(row)
  const hit = all[nth]
  if (!hit) throw new Error(`${mini}: no step ${text}`)
  return { address: { bar, span: hit.s.span!, at: hit.slot.begin }, end: hit.slot.end, step: hit.s }
}

/** split `text` in `sound`'s row at `p` of the way through it; Strudel must agree */
function splits(mini: string, sound: string, text: string, p: Frac, want: string, bars = 1): void {
  const trees = chunkDivisions(mini, bars)
  const { address, end, step } = stepAt(mini, trees, 0, sound, text)
  const at = add(address.at, mul(sub(end, address.at), p))
  const r = splitStep(mini, trees, address, at, { sound })
  if (!r.ok) throw new Error(`${mini}: refused ${r.why}`)
  const edited = applyStepEdit(mini, r.edit)
  expect(edited).toBe(want)
  // what Strudel should now play differently: at every place the step sits
  const expected = { added: [] as string[], removed: [] as string[] }
  for (const pl of placesOf(trees, address.span)) {
    const part = mul(sub(pl.e, pl.b), F(1, p.d))
    if (!step.rest) {
      const name = played(step.name!)
      expected.removed.push(`${name}@${str(pl.b)}-${str(pl.e)}`)
      expected.added.push(`${name}@${str(pl.b)}-${str(add(pl.b, part))}`)
    }
    const hb = add(pl.b, mul(part, F(p.n)))
    expected.added.push(`${played(sound)}@${str(hb)}-${str(add(hb, part))}`)
  }
  const got = difference(plays(mini, bars * 2), plays(edited, bars * 2))
  expect(got).toEqual({ added: expected.added.sort(), removed: expected.removed.sort() })
}

/** resize `text` (the row's note) to `units` of its own units; Strudel must hear only the length change */
function resizes(mini: string, sound: string, text: string, length: number | Frac, want: string, bars = 1): void {
  // the length asked, in the note's own units: a whole number, or part of one (#2443)
  const units = typeof length === 'number' ? F(length) : length
  const trees = chunkDivisions(mini, bars)
  const { address, end, step } = stepAt(mini, trees, 0, sound, text)
  const unit = mul(sub(end, address.at), F(1, step.weight))
  const r = resizeStep(mini, trees, address, add(address.at, mul(unit, units)), { sound })
  if (!r.ok) throw new Error(`${mini}: refused ${r.why}`)
  const edited = applyStepEdit(mini, r.edit)
  expect(edited).toBe(want)
  const name = played(sound)
  const expected = { added: [] as string[], removed: [] as string[] }
  for (const pl of placesOf(trees, address.span)) {
    const u = mul(sub(pl.e, pl.b), F(1, step.weight))
    expected.removed.push(`${name}@${str(pl.b)}-${str(pl.e)}`)
    expected.added.push(`${name}@${str(pl.b)}-${str(add(pl.b, mul(u, units)))}`)
  }
  const got = difference(plays(mini, bars * 2), plays(edited, bars * 2))
  expect(got).toEqual({ added: expected.added.sort(), removed: expected.removed.sort() })
}

function resizeRefused(mini: string, sound: string, text: string, units: number): StepEditResult {
  const trees = chunkDivisions(mini, 1)
  const { address, end, step } = stepAt(mini, trees, 0, sound, text)
  const unit = mul(sub(end, address.at), F(1, step.weight))
  return resizeStep(mini, trees, address, add(address.at, mul(unit, F(units))), { sound })
}

describe('splitStep — a click part-way through a plain step', () => {
  it('half way: the row’s sound joins the step as its second half', () => {
    // two equal hits of one sound are `bd*2` (#2326, the user's ruling of 2026-11-05)
    splits('bd ~ sn ~', 'bd', 'bd', F(1, 2), 'bd*2 ~ sn ~')
    splits('bd ~ sn ~', 'bd', '~', F(1, 2), 'bd [~ bd] sn ~')
    splits('bd ~ sn ~', 'bd', 'sn', F(1, 2), 'bd ~ [sn bd] ~')
  })

  it('a quarter of the way: as many parts as the place needs, and no more', () => {
    splits('bd ~ sn ~', 'hh', '~', F(1, 4), 'bd [~ hh ~ ~] sn ~')
    splits('bd ~ sn ~', 'hh', '~', F(3, 4), 'bd [~ ~ ~ hh] sn ~')
    splits('bd ~ sn ~', 'hh', '~', F(2, 4), 'bd [~ hh] sn ~')
  })

  it('at any depth, and what follows the name stays as written', () => {
    splits('bd [~ sd] hh', 'sd', 'sd', F(1, 2), 'bd [~ sd*2] hh')
    splits('bd@2 sn', 'bd', 'bd@2', F(1, 2), 'bd*2@2 sn')
    splits('bd _ sn ~', 'bd', 'bd _', F(1, 4), '[bd bd ~ ~] _ sn ~')
  })

  it('a step its group repeats changes in every copy', () => {
    splits('[bd ~]*2 sn', 'bd', '~', F(1, 2), '[bd [~ bd]]*2 sn')
  })

  it('one hit of `x*k` or copy of `x!k` splits on its own (#2326)', () => {
    const write = (mini: string, sound: string, text: string, at: Frac): string => {
      const trees = chunkDivisions(mini, 1)
      const { address } = stepAt(mini, trees, 0, sound, text)
      const r = splitStep(mini, trees, address, at, { sound })
      if (!r.ok) throw new Error(r.why)
      return applyStepEdit(mini, r.edit)
    }
    // `hh*4 sn`: the first hat is [0, 1/8); half way through it
    expect(write('hh*4 sn', 'hh', 'hh*4', F(1, 16))).toBe('[hh*2 hh hh hh] sn')
    // `bd!2 sn`: the first copy is [0, 1/3)
    expect(write('bd!2 sn', 'bd', 'bd!2', F(1, 6))).toBe('bd*2 bd sn')
    expect(difference(plays('bd!2 sn', 2), plays('bd*2 bd sn', 2))).toEqual({ added: ['bd@0-1/6', 'bd@1-7/6', 'bd@1/6-1/3', 'bd@7/6-4/3'], removed: ['bd@0-1/3', 'bd@1-4/3'] })
  })

  it('refused where the step is not one plain text, or the click is not inside it', () => {
    const trees = chunkDivisions('hh(3,8) sn', 1)
    const { address, end } = stepAt('hh(3,8) sn', trees, 0, 'hh', 'hh(3,8)')
    // a euclid hit is written out and split on its own since #2434: half the whole step is past the clicked hit (an eighth of it)
    expect(splitStep('hh(3,8) sn', trees, address, mul(end, F(1, 2)), { sound: 'hh' })).toEqual({ ok: false, why: 'not-inside-the-step' })
    const t3 = chunkDivisions('bd ~ sn ~', 1)
    const s3 = stepAt('bd ~ sn ~', t3, 0, 'bd', 'bd')
    expect(splitStep('bd ~ sn ~', t3, s3.address, F(0), { sound: 'bd' })).toEqual({ ok: false, why: 'not-inside-the-step' })
    expect(splitStep('bd ~ sn ~', t3, s3.address, F(1, 4), { sound: 'bd' })).toEqual({ ok: false, why: 'not-inside-the-step' })
    const t4 = chunkDivisions('[bd,hh] sn', 1)
    const s4 = stepAt('[bd,hh] sn', t4, 0, 'sn', '[bd,hh]')
    expect(splitStep('[bd,hh] sn', t4, s4.address, F(1, 4), { sound: 'sn' })).toEqual({ ok: false, why: 'step-is-a-group' })
  })
})

describe('resizeStep — part of a step, and part of a rest (#2443)', () => {
  it('shorter by part of its step: the step is cut inside its own text', () => {
    resizes('g3 f#3', 'g3', 'g3', F(2, 3), '[g3@2 ~] f#3')
    resizes('c4@2 e4', 'c4', 'c4@2', F(3, 2), '[c4@3 ~]@2 e4')
  })
  it('longer into a rest: the note takes in the silence it grows over, and no more', () => {
    resizes('c4 ~ e4', 'c4', 'c4', F(3, 2), '[c4@3 ~]@2 e4')
    // a whole unit into a longer rest: what is left of the rest stays beside the note
    resizes('bd ~@2 sd', 'bd', 'bd', 2, 'bd@2 ~ sd')
  })
  it('never over the next note, and never on a chord member', () => {
    expect(resizeRefused('c4 e4', 'c4', 'c4', 2)).toEqual({ ok: false, why: 'no-room-to-grow' })
    expect(resizeRefused('[c4,e4] g4', 'c4', '[c4,e4]', 2)).toMatchObject({ ok: false })
  })
})

describe('resizeStep — a note’s length, inside its group', () => {
  // spelled by stepSpell (#2326): a length is `@n`, room given back is written-out rests
  it('longer: the rests after it are taken into its `@n`; shorter: the room it gives back is rests', () => {
    resizes('bd ~ sd ~', 'bd', 'bd', 2, 'bd@2 sd ~')
    resizes('bd ~ ~ sd', 'bd', 'bd', 3, 'bd@3 sd')
    resizes('bd@2 ~ sd ~', 'bd', 'bd@2', 3, 'bd@3 sd ~')
    resizes('bd@3 sd', 'bd', 'bd@3', 2, 'bd@2 ~ sd')
    resizes('bd@3 sd', 'bd', 'bd@3', 1, 'bd ~ ~ sd')
    resizes('bd@2 ~@2 sd', 'bd', 'bd@2', 4, 'bd@4 sd')
  })

  it('holds a note already has are its own text: the edit writes them as `@n`', () => {
    resizes('bd _ sd ~', 'bd', 'bd _', 1, 'bd ~ sd ~')
    resizes('bd _ _ ~', 'bd', 'bd _ _', 2, 'bd@2 ~ ~')
    resizes('bd _ _ ~', 'bd', 'bd _ _', 4, 'bd@4')
  })

  it('at any depth, in every copy', () => {
    resizes('hh [sd ~ ~] hh', 'sd', 'sd', 2, 'hh [sd@2 ~] hh')
    resizes('[bd ~ sd ~]*2', 'bd', 'bd', 2, '[bd@2 sd ~]*2')
  })

  it('refused where it would not stay inside the group, or the length is not plain', () => {
    expect(resizeRefused('bd sd ~ ~', 'bd', 'bd', 2)).toEqual({ ok: false, why: 'no-room-to-grow' })
    // the group ends: no room past it
    expect(resizeRefused('[bd ~] sd', 'bd', 'bd', 3)).toEqual({ ok: false, why: 'no-room-to-grow' })
    // an alternation's next arm is not room: it plays in other bars (`<bd ~ ~ ~>*2`)
    {
      const mini = '<bd ~ ~ ~>*2'
      const trees = chunkDivisions(mini, 2)
      const { address, end } = stepAt(mini, trees, 0, 'bd', 'bd')
      expect(resizeStep(mini, trees, address, add(address.at, mul(sub(end, address.at), F(2))), { sound: 'bd' })).toEqual({ ok: false, why: 'no-room-to-grow' })
    }
    expect(resizeRefused('bd@1.5 ~ sd', 'bd', 'bd@1.5', 2)).toMatchObject({ ok: false })
    expect(resizeRefused('bd ~ sd ~', 'bd', 'bd', 1)).toEqual({ ok: false, why: 'length-not-whole-steps' })
    // one hit of `bd*2` is resized on its own since #2326: the next hit is in its way
    expect(resizeRefused('bd*2 ~ sd ~', 'bd', 'bd*2', 2)).toEqual({ ok: false, why: 'no-room-to-grow' })
    // and one hit of a euclid step since #2434: the hit after it is in its way
    expect(resizeRefused('bd(3,8) ~ sd ~', 'bd', 'bd(3,8)', 2)).toEqual({ ok: false, why: 'no-room-to-grow' })
    expect(resizeRefused('bd ~ sd ~', 'sd', 'sd', 2)).toMatchObject({ ok: true })
    expect(resizeRefused('bd ~ sd ~', 'bd', '~', 2)).toEqual({ ok: false, why: 'not-the-rows-note' })
  })
})

/* ── the corpus: resize side by side with today's column writer ── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/**
 * The inner row of a group step a grid row draws — the grid's own rule (`innerRow` in
 * `visualEdit/panels/gridZoom.ts`), restated as stage 2's corpus test does: its only row,
 * or under several the one that writes the row's sound.
 */
function innerRow(s: DivisionStep, sound: string): DivisionRow | null {
  if (!s.rows || s.oneOf) return null
  if (s.rows.length === 1) return s.rows[0]
  const mine = s.rows.filter((r) => r.sounds.includes(sound))
  return mine.length === 1 ? mine[0] : null
}

/** the stretch `[from, to)` of `before` a change touched */
function changed(before: string, after: string): [number, number] {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  let z = 0
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++
  return [a, before.length - z]
}

interface Side {
  grids: number
  asked: number
  agree: number
  differ: Record<string, number>
  differExamples: string[]
  newRefuses: Record<string, number>
  todayRefusesNewWrites: number
  bothRefuse: number
  strudelOk: number
  strudelBad: string[]
  /** bytes each edit rewrites (removed + inserted): the new writer's, today's column writer's */
  bytesNew: number[]
  bytesToday: number[]
  /** both write and Strudel plays the two the same */
  playbackIdentical: number
  /** new edits whose text spells a length with `_` holds, or a generator (`!n`, `*n`) — stepSpell writes neither */
  spellingBad: string[]
  /** new edits after which the step, read again, is no longer a step a click can edit */
  readBackBad: string[]
}

/** the written step whose name begins at `head` and that has a slot beginning at `begin`, in bar 0 */
function findStep(trees: readonly BarTree[], head: number, begin: Frac): { start: number; end: number } | null {
  const t = trees[0]
  if (!t?.ok) return null
  let got: { start: number; end: number } | null = null
  const visit = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.head?.start === head && s.span && s.slots.some((x) => x.begin.n * begin.d === begin.n * x.begin.d)) got = s.span
      for (const k of s.rows ?? []) visit(k)
    }
  }
  t.parts.forEach(visit)
  return got
}

/** bytes a change rewrites: removed + inserted, once the common head and tail are set aside */
function rewritten(before: string, after: string): number {
  const [a, z] = changed(before, after)
  return z - a + (after.length - before.length + (z - a))
}

const stats = (xs: number[]): string => {
  if (xs.length === 0) return 'n=0'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `n=${s.length} median=${at(0.5)} p95=${at(0.95)} max=${s[s.length - 1]}`
}

/**
 * Every note of every row of every grid that opens today, made one of its units longer and
 * one shorter, by both writers. The new writer's every edit is checked by Strudel: only that
 * note's length may change. Where both write and differ, the reason is named.
 */
function sideBySide(writer: typeof resizeStep, limit?: number): Side {
  const r: Side = {
    grids: 0, asked: 0, agree: 0, differ: {}, differExamples: [], newRefuses: {}, todayRefusesNewWrites: 0, bothRefuse: 0, strudelOk: 0, strudelBad: [],
    bytesNew: [], bytesToday: [], playbackIdentical: 0, spellingBad: [], readBackBad: [],
  }
  for (const mini of minis.slice(0, limit)) {
    const g = parseStepGrid(mini)
    if (!g.ok) continue
    r.grids++
    const m = g.model
    const bars = m.bars ?? 1
    if (bars !== 1) continue
    const trees = chunkDivisions(mini, 1)
    const per = m.steps
    m.lanes.forEach((lane, li) => {
      const d = laneRowForEdit(trees[0], lane)
      if (!d.ok) return
      const visit = (row: DivisionRow): void => {
        for (const s of row.steps) {
          const inner = s.rows ? innerRow(s, lane.sound) : null
          if (inner) visit(inner)
          if (s.rows || s.rest || s.name !== lane.sound || !s.span || s.slots.length !== 1) continue
          const slot = s.slots[0]
          const col = (slot.begin.n * per) / slot.begin.d
          const len = ((slot.end.n * slot.begin.d - slot.begin.n * slot.end.d) * per) / (slot.end.d * slot.begin.d)
          if (!Number.isInteger(col) || !Number.isInteger(len) || !isCellOn(lane.cells[col]) || !Number.isInteger(s.weight) || len % s.weight !== 0) continue
          const unitCols = len / s.weight
          for (const units of [s.weight + 1, s.weight - 1]) {
            if (units < 1) continue
            r.asked++
            const next = resizeCell(m, li, col, units * unitCols)
            const today = next === m ? null : serializeStepGrid(next)
            const address: StepAddress = { bar: 0, span: s.span, at: slot.begin }
            const unit = F(slot.end.n * slot.begin.d - slot.begin.n * slot.end.d, slot.end.d * slot.begin.d * s.weight)
            const mine = writer(mini, trees, address, add(slot.begin, mul(unit, F(units))), { sound: lane.sound, part: lane.part })
            const mineText = mine.ok ? applyStepEdit(mini, mine.edit) : null
            if (mineText !== null) {
              const name = played(lane.sound)
              const want = { added: [] as string[], removed: [] as string[] }
              for (let c = 0; c < 2; c++) {
                const b = add(F(c), slot.begin)
                want.removed.push(`${name}@${str(b)}-${str(add(F(c), slot.end))}`)
                want.added.push(`${name}@${str(b)}-${str(add(b, mul(unit, F(units))))}`)
              }
              let ok = false
              try {
                ok = JSON.stringify(difference(plays(mini, 2), plays(mineText, 2))) === JSON.stringify({ added: want.added.sort(), removed: want.removed.sort() })
              } catch {
                ok = false
              }
              if (ok) r.strudelOk++
              else r.strudelBad.push(`${JSON.stringify(mini)} ${lane.sound} → ${JSON.stringify(mineText)}`)
              r.bytesNew.push(rewritten(mini, mineText))
              // the spelling rules (#2326): a length is `@n`, never `_` holds or a generator
              if (/(^|\s)_(\s|$|\])|[!*]\d|\(\d/.test(mine.ok ? mine.edit.insert : '')) r.spellingBad.push(`${JSON.stringify(mini)} → ${JSON.stringify(mineText)}`)
              // and what it writes reads back as a step a click edits: the note, found again
              // where it begins, can be toggled
              const again = chunkDivisions(mineText, 1)
              const found = s.head ? findStep(again, s.head.start, slot.begin) : null
              const back = found ? toggleStep(mineText, again, { bar: 0, span: found, at: slot.begin }, { sound: lane.sound, part: lane.part }) : null
              if (!back?.ok) r.readBackBad.push(`${JSON.stringify(mineText)} ${lane.sound}: ${back ? back.why : 'step not found'}`)
            }
            if (today !== null) r.bytesToday.push(rewritten(mini, today))
            if (today !== null && mineText !== null) {
              let sameMusic = false
              try {
                sameMusic = JSON.stringify(plays(today, 2)) === JSON.stringify(plays(mineText, 2))
              } catch {
                sameMusic = false
              }
              if (sameMusic) r.playbackIdentical++
              if (today === mineText) r.agree++
              else {
                // WHY: asked, not assumed — do the two play the same, and where does each change the text?
                let same = false
                try {
                  same = JSON.stringify(plays(today, 2)) === JSON.stringify(plays(mineText, 2))
                } catch {
                  same = false
                }
                const [ta, tz] = changed(mini, today)
                const [ma, mz] = changed(mini, mineText)
                const kind = !same
                  ? 'other'
                  : ta < ma || tz > mz
                    ? 'same music — today rewrites text beside the note (other steps’ `@`, spacing)'
                    : /(^|\s)_(\s|$|\])/.test(today.slice(ta, today.length - (mini.length - tz))) && /@/.test(mineText.slice(ma, mineText.length - (mini.length - mz)))
                      ? 'same music — today writes the length as `_` holds; the new edit writes `@n` (#2326)'
                      : 'other'
                r.differ[kind] = (r.differ[kind] ?? 0) + 1
                if (r.differExamples.length < 30) r.differExamples.push(`${kind}: ${JSON.stringify(mini)} today ${JSON.stringify(today)} new ${JSON.stringify(mineText)}`)
              }
            } else if (today !== null && !mine.ok) r.newRefuses[mine.why] = (r.newRefuses[mine.why] ?? 0) + 1
            else if (today === null && mine.ok) r.todayRefusesNewWrites++
            else r.bothRefuse++
          }
        }
      }
      visit(d.row)
    })
  }
  return r
}

describe('resizeStep — the corpus, side by side with today’s column writer', () => {
  it('every new edit changes only the note’s length; where both write and differ, the reason is named', () => {
    const r = sideBySide(resizeStep)
    // `RESIZE_REPORT=/some/file.json` writes the whole measurement; unset, nothing is written
    if (process.env.RESIZE_REPORT) writeFileSync(process.env.RESIZE_REPORT, JSON.stringify(r, null, 1))
    if (process.env.RESIZE_REPORT) {
      writeFileSync(process.env.RESIZE_REPORT.replace(/\.json$/, '-bytes.txt'), `new: ${stats(r.bytesNew)}\ntoday: ${stats(r.bytesToday)}\nplayback-identical where both write: ${r.playbackIdentical}\n`)
    }
    expect(r.asked).toBeGreaterThan(1000)
    expect(r.strudelBad).toEqual([])
    expect(r.differ.other ?? 0).toBe(0)
    expect(r.spellingBad).toEqual([])
    expect(r.readBackBad).toEqual([])
  }, 900_000)

  it('can go red: a resize that writes the rest it took in, not the length, is heard', () => {
    // the absorbed rests written back as rests: tiny, plausible bytes, and the length never changes
    const noLength: typeof resizeStep = (...args) => {
      const r = resizeStep(...args)
      return r.ok ? { ok: true, edit: { ...r.edit, insert: r.edit.insert.replace(/@\d+/g, '') } } : r
    }
    const r = sideBySide(noLength, 300)
    expect(r.strudelBad.length).toBeGreaterThan(0)
  }, 300_000)

  it('can go red: a length spelled as `_` holds breaks the spelling rule, though it plays the same', () => {
    // the spelling the user ruled out (#2326): same music, so only the spelling check catches it
    const holds: typeof resizeStep = (...args) => {
      const r = resizeStep(...args)
      return r.ok ? { ok: true, edit: { ...r.edit, insert: r.edit.insert.replace(/@(\d+)/g, (_m, n) => ' _'.repeat(Number(n) - 1)) } } : r
    }
    const r = sideBySide(holds, 300)
    expect(r.strudelBad).toEqual([])
    expect(r.spellingBad.length).toBeGreaterThan(0)
  }, 300_000)
})

/* ── the corpus: split side by side with today's column writer ─── */

interface SplitSide {
  asked: number
  agree: number
  /** both write, the bytes differ, the music is the same */
  sameMusic: number
  sameMusicExamples: string[]
  /** both write and play differently: as every new split plays exactly the click (`strudelBad` empty), today's does not */
  todayPlaysOther: string[]
  newRefuses: Record<string, number>
  todayRefusesNewWrites: number
  bothRefuse: number
  strudelOk: number
  strudelBad: string[]
  /** bytes each edit rewrites: the new writer's, today's column writer's */
  bytesNew: number[]
  bytesToday: number[]
}

/**
 * Every plain step two or more columns wide in every one-bar grid, clicked in its second
 * column by its own row: today's road (`toggleCell` there + `serializeStepGrid`) beside
 * `splitStep`. Strudel checks every new edit: the row's hit added where the click is, the
 * step's own hit (if any) now its first part, at every place it plays.
 */
function splitSide(writer: typeof splitStep): SplitSide {
  const r: SplitSide = { asked: 0, agree: 0, sameMusic: 0, sameMusicExamples: [], todayPlaysOther: [], newRefuses: {}, todayRefusesNewWrites: 0, bothRefuse: 0, strudelOk: 0, strudelBad: [], bytesNew: [], bytesToday: [] }
  for (const mini of minis) {
    const g = parseStepGrid(mini)
    if (!g.ok || (g.model.bars ?? 1) !== 1) continue
    const m = g.model
    const trees = chunkDivisions(mini, 1)
    const per = m.steps
    m.lanes.forEach((lane, li) => {
      const d = laneRowForEdit(trees[0], lane)
      if (!d.ok) return
      const visit = (row: DivisionRow): void => {
        for (const s of row.steps) {
          const inner = s.rows ? innerRow(s, lane.sound) : null
          if (inner) visit(inner)
          // a plain step only: a hit of `x*k` / `x!k` splits on its own (#2326), pinned in stepGenerators.test.ts
          if (s.rows || !s.span || s.slots.length !== 1 || s.reps > 1 || s.ops.some((o) => o !== 'tail')) continue
          const slot = s.slots[0]
          const col = (slot.begin.n * per) / slot.begin.d
          const len = ((slot.end.n * slot.begin.d - slot.begin.n * slot.end.d) * per) / (slot.end.d * slot.begin.d)
          if (!Number.isInteger(col) || !Number.isInteger(len) || len < 2 || isCellOn(lane.cells[col + 1])) continue
          r.asked++
          const next = toggleCell(m, li, col + 1, true, 1)
          const today = next === m ? null : serializeStepGrid(next)
          const at = add(slot.begin, F(1, per))
          const mine = writer(mini, trees, { bar: 0, span: s.span, at: slot.begin }, at, { sound: lane.sound, part: lane.part })
          const mineText = mine.ok ? applyStepEdit(mini, mine.edit) : null
          if (mineText !== null) r.bytesNew.push(rewritten(mini, mineText))
          if (today !== null) r.bytesToday.push(rewritten(mini, today))
          if (mineText !== null) {
            // the click is one column in: the step cut into `len` parts, the hit in the second
            const part = F(slot.end.n * slot.begin.d - slot.begin.n * slot.end.d, slot.end.d * slot.begin.d * len)
            const want = { added: [] as string[], removed: [] as string[] }
            for (let c = 0; c < 2; c++) {
              const b = add(F(c), slot.begin)
              if (!s.rest && s.name) {
                const nm = played(s.name)
                want.removed.push(`${nm}@${str(b)}-${str(add(F(c), slot.end))}`)
                want.added.push(`${nm}@${str(b)}-${str(add(b, part))}`)
              }
              const hb = add(b, part)
              want.added.push(`${played(lane.sound)}@${str(hb)}-${str(add(hb, part))}`)
            }
            let ok = false
            try {
              ok = JSON.stringify(difference(plays(mini, 2), plays(mineText, 2))) === JSON.stringify({ added: want.added.sort(), removed: want.removed.sort() })
            } catch {
              ok = false
            }
            if (ok) r.strudelOk++
            else r.strudelBad.push(`${JSON.stringify(mini)} ${lane.sound} → ${JSON.stringify(mineText)}`)
          }
          if (today !== null && mineText !== null) {
            if (today === mineText) r.agree++
            else {
              let same = false
              try {
                same = JSON.stringify(plays(today, 2)) === JSON.stringify(plays(mineText, 2))
              } catch {
                same = false
              }
              if (same) {
                r.sameMusic++
                if (r.sameMusicExamples.length < 40) r.sameMusicExamples.push(`${JSON.stringify(mini)} ${lane.sound}: today ${JSON.stringify(today)} new ${JSON.stringify(mineText)}`)
              }
              else r.todayPlaysOther.push(`${JSON.stringify(mini)} ${lane.sound}: today ${JSON.stringify(today)} new ${JSON.stringify(mineText)}`)
            }
          } else if (today !== null && !mine.ok) r.newRefuses[mine.why] = (r.newRefuses[mine.why] ?? 0) + 1
          else if (today === null && mine.ok) r.todayRefusesNewWrites++
          else r.bothRefuse++
        }
      }
      visit(d.row)
    })
  }
  return r
}

describe('splitStep — the corpus, side by side with today’s column writer', () => {
  it('every new split plays exactly the click', () => {
    const r = splitSide(splitStep)
    // `SPLIT_REPORT=/some/file.json` writes the whole measurement; unset, nothing is written
    if (process.env.SPLIT_REPORT) {
      writeFileSync(process.env.SPLIT_REPORT, JSON.stringify(r, null, 1))
      writeFileSync(process.env.SPLIT_REPORT.replace(/\.json$/, '-bytes.txt'), `new: ${stats(r.bytesNew)}\ntoday: ${stats(r.bytesToday)}\nplayback-identical where both write: ${r.agree + r.sameMusic}\n`)
    }
    expect(r.asked).toBeGreaterThan(500)
    expect(r.strudelBad).toEqual([])
  }, 900_000)

  it('can go red: a split half a column late is heard', () => {
    const late: typeof splitStep = (mini, trees, address, at, row) => splitStep(mini, trees, address, { n: at.n * 2 + 1, d: at.d * 2 }, row)
    expect(splitSide(late).strudelBad.length).toBeGreaterThan(0)
  }, 900_000)
})
