/**
 * stepEdit.ts — a click edits the step's own text (#2292, stage 2 of epic #1832).
 *
 * Today every grid click flips a COLUMN of a model, and one of four writers rewrites the
 * pattern string from the column diff. This module is the other road: the step is
 * addressed where it is WRITTEN — its span in the chunk's string, as the divisions tree
 * (`./gridDivisions.ts`, asked of Strudel) hands it over — and the answer is one small
 * replacement inside that step's own text, or a refusal that says why.
 *
 *   `bd ~ sd ~`, row `sd`, the step `~` at 1/4  →  { from: 3, to: 4, insert: 'sd' }
 *
 * Nothing here parses the pattern. The tree says where each step is, what it is called,
 * which ops it carries and where it sits in each bar; this file only decides whether a
 * toggle of that step can be written by changing that step's text alone.
 *
 * THE RULES IT KEEPS
 *  1. An edit changes ONLY the step's own text. A note or a rest: its name (`~`, `bd`,
 *     `bd:4`); what follows the name — its weight `@2`, its `_` holds — stays as written.
 *     A chord (`[bd,sd]`): its members, inside its own brackets. Nothing around the step is
 *     respelled; an edit that would need that is refused.
 *  2. A click edits the WRITTEN step, every place it plays. A text the pattern plays in
 *     several places — a group repeated (`[bd ~]*2`, `[bd ~]!3`, `[bd ~](3,8)`), a group
 *     every bar plays, a polymeter (`{…}%n`) — changes everywhere together, as the text does
 *     (the user's ruling, 2026-11-04).
 *  3. A generator ON THE STEP keeps its generator: one text whose own op makes its hits
 *     (`hh*4`, `bd(3,8)`, `bd!3`), or that plays by chance (`bd?`, `bd | sd`, `[bd ~]?`), is
 *     refused — a click on one of its hits is not a click on its text.
 *  4. A step another sound of the same part already plays keeps today's grid: the row's
 *     sound JOINS it as a chord (`bd` → `[bd,sd]`, `[bd, hh]` → `[bd, hh, sd]`). The row's
 *     note in a chord LEAVES it, and a chord left with one member is that member
 *     (`[bd,sd]` → `bd`), so a second click gives back the text the first click changed.
 *
 * THE ADDRESS is a bar, the step's span, and where in that bar the step begins. Later
 * stages reuse it as is: a split (`bd` → `[bd ~]`) and a resize (`bd` → `bd@2`) rewrite the
 * same text the same address finds, and a piano roll's add, delete and move can name a
 * step the same way.
 *
 * ⚠ `trees` MUST BE THE WHOLE LOOP the view draws — `chunkDivisions(mini, bars)` with the
 * grid's own bar count. Where a row of the step's is an alternation (some of what it writes
 * sits in other bars), every step it writes must turn up somewhere in the loop, or the loop
 * is shorter than the pattern: the edit would change bars the view does not show, and it is
 * refused.
 */
import type { StepLane } from './notation/model'
import { laneDivisions, type BarTree, type BarTreeRefusal, type DivisionRow, type DivisionStep, type Frac, type LaneDivisionsRefusal } from './gridDivisions'
import type { MiniSpan } from './strudelMini/shape'

/** one step of one bar, by where it is written */
export interface StepAddress {
  /** the bar of `trees` the click is in */
  bar: number
  /** the written step: `DivisionStep.span`, exactly as the tree gives it */
  span: MiniSpan
  /** where in the bar the clicked step begins: the `begin` of one of its slots there */
  at: Frac
}

/** the grid row the click is in */
export interface StepRow extends Pick<StepLane, 'sound' | 'part'> {
  /**
   * The part's sounds in the order the view lists its rows. A chord writes its members in
   * this order, as today's grid does (its rows come in the order the sounds first play).
   * Absent: the order the part first writes them.
   */
  order?: readonly string[]
}

/** one replacement in the chunk's string */
export interface StepEdit {
  from: number
  to: number
  insert: string
}

/** why a step cannot be toggled by changing its own text */
export type StepEditRefusal =
  /** the bar, or another bar the count needs, has no tree; or the row has no row of it */
  | BarTreeRefusal
  | LaneDivisionsRefusal
  /** the address names a bar outside `trees` */
  | 'no-such-bar'
  /** no step of the row's part is written at that span, or it does not begin at `at` in that bar */
  | 'no-step-there'
  /** the step is a group that is not a plain chord (`[bd sd]`, `<bd sd>`, `[bd, hh*2]`): no one text is the click */
  | 'step-is-a-group'
  /** the step's name has no single run of text (`bd:<1 2>`), or the tree gave it no span */
  | 'step-has-no-text'
  /** the text at the span is not what the tree says is written there: the tree is of another string */
  | 'tree-is-not-this-text'
  /** the step starts in one bar and sounds on into another (`bd/2`, `bd@3` over a bar line) */
  | 'step-crosses-a-bar'
  /** the step is written once and plays as several steps side by side (`bd!3`, `~!2`) */
  | 'step-is-replicated'
  /** the step's own op makes its hits (`hh*4`, `bd(3,8)`, `bd?`, `bd/2`) */
  | 'step-is-generated'
  /** a group the step sits in plays by chance (`[bd ~]?`), or carries an op that is not a plain repeat */
  | 'step-under-a-generator'
  /** the step sits in a random choice (`[bd | ~]`, `bd | sd`): which copy plays is chance */
  | 'step-is-a-random-choice'
  /** a row the step sits in writes steps that never play in the loop: the loop is one turn of a longer pattern */
  | 'loop-shorter-than-the-pattern'

export type StepEditResult = { ok: true; edit: StepEdit } | { ok: false; why: StepEditRefusal }

/* ── finding the step ───────────────────────────────────────────── */

const sameSpan = (a: MiniSpan | null, b: MiniSpan): boolean => !!a && a.start === b.start && a.end === b.end
const sameFrac = (a: Frac, b: Frac): boolean => a.n * b.d === b.n * a.d
const spanKey = (s: MiniSpan | null): string => (s ? `${s.start}-${s.end}` : '?')

interface Found {
  step: DivisionStep
  /** the group steps it sits in, outermost first */
  around: DivisionStep[]
  /** the rows it sits in, outermost first, each with a key that names the same row in every bar */
  rows: Array<{ row: DivisionRow; key: string }>
}

function findIn(row: DivisionRow, key: string, span: MiniSpan, around: DivisionStep[], rows: Found['rows']): Found | null {
  const here = [...rows, { row, key }]
  for (const s of row.steps) {
    if (sameSpan(s.span, span)) return { step: s, around, rows: here }
    const inner = s.rows ?? []
    for (let j = 0; j < inner.length; j++) {
      const f = findIn(inner[j], `${spanKey(s.span)}#${j}`, span, [...around, s], here)
      if (f) return f
    }
  }
  return null
}

/** over every bar: for each row (by key), the steps of it that sit in some bar — or the first bar's refusal */
function overTheLoop(trees: readonly BarTree[]): Map<string, Set<string>> | BarTreeRefusal {
  const seen = new Map<string, Set<string>>()
  const visit = (row: DivisionRow, key: string): void => {
    let got = seen.get(key)
    if (!got) seen.set(key, (got = new Set()))
    for (const s of row.steps) {
      got.add(spanKey(s.span))
      ;(s.rows ?? []).forEach((r, j) => visit(r, `${spanKey(s.span)}#${j}`))
    }
  }
  for (const t of trees) {
    if (!t.ok) return t.why
    t.parts.forEach((p, i) => visit(p, `part${i}`))
  }
  return seen
}

/* ── chords ─────────────────────────────────────────────────────── */

/** a chord's member: one plain note, alone in its layer */
interface Member {
  name: string
  span: MiniSpan
}

/**
 * The members of a group step that is a PLAIN CHORD — layers side by side (`[bd,hh]`), or
 * one note alone in brackets (`[bd]`), no op on the group, each layer one note with
 * nothing but its name — or null. Only a chord like that can take a member in by editing
 * its own text.
 */
function chordOf(g: DivisionStep, mini: string): Member[] | null {
  if (!g.rows || g.rows.length < 1 || g.oneOf || g.copies || g.ops.length > 0 || g.reps > 1 || g.span === null) return null
  const out: Member[] = []
  for (const r of g.rows) {
    if (r.written !== 1 || r.steps.length !== 1) return null
    const s = r.steps[0]
    if (s.rest || s.rows || s.name === null || s.span === null || s.head === null || s.ops.some((o) => o !== 'tail') || s.reps !== 1 || s.weight !== 1) return null
    // its name is all of its text, so the member's span is the member
    if (mini.slice(s.head.start, s.head.end) !== s.name) return null
    out.push({ name: s.name, span: s.span })
  }
  // written in square brackets: `<bd>` and `{bd}` hold one note too, and are not chords
  return bracketsOf(mini, out) ? out : null
}

/**
 * `sound` joins the chord: placed among the members by the view's order, and separated
 * the way the chord already separates them (`, ` in `[bd, hh]`; a bare `,` when there is
 * one member). The members already there are never moved or respelled.
 */
function joinChord(mini: string, members: Member[], order: readonly string[], sound: string): StepEditResult {
  const sep =members.length > 1 ? mini.slice(members[0].span.end, members[1].span.start) : ','
  if (sep.trim() !== ',') return refuse('tree-is-not-this-text')
  const at = members.findIndex((m) => rank(order, m.name) > rank(order, sound))
  if (at < 0) {
    const end = members[members.length - 1].span.end
    return write(end, end, sep + sound)
  }
  return write(members[at].span.start, members[at].span.start, sound + sep)
}

/** where a chord's brackets are: the `[` before its first member and the `]` after its last, padding allowed */
function bracketsOf(mini: string, members: Member[]): { open: number; close: number } | null {
  let open = members[0].span.start - 1
  while (open >= 0 && /\s/.test(mini[open])) open--
  let close = members[members.length - 1].span.end
  while (close < mini.length && /\s/.test(mini[close])) close++
  return mini[open] === '[' && mini[close] === ']' ? { open, close } : null
}

/** the members' order: the view's rows, or the part's written order */
function rank(order: readonly string[], name: string): number {
  const i = order.indexOf(name)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/* ── the toggle ─────────────────────────────────────────────────── */

/** group ops that repeat what the group holds: each copy is the same written text */
const REPEATS = new Set(['replicate', 'stretch', 'bjorklund'])

const refuse = (why: StepEditRefusal): StepEditResult => ({ ok: false, why })
const write = (from: number, to: number, insert: string): StepEditResult => ({ ok: true, edit: { from, to, insert } })

/**
 * Toggle `row`'s sound on the step at `address`: a rest becomes the row's sound (`~` →
 * `sd`), the row's own note becomes a rest (`sd` → `~`), and a step another sound plays
 * gains the row's sound beside it (`bd` → `[bd,sd]`). One replacement inside the step's own
 * text, or why it cannot be written that way.
 *
 * Pure: `mini` is the chunk's string and `trees` its `chunkDivisions(mini, bars)` over the
 * view's whole loop. Nothing is evaluated here.
 */
export function toggleStep(mini: string, trees: readonly BarTree[], address: StepAddress, row: StepRow): StepEditResult {
  const tree = trees[address.bar]
  if (!tree) return refuse('no-such-bar')
  const lane = laneDivisions(tree, row)
  if (!lane.ok) return refuse(lane.why)
  // a random choice of whole parts: what the bar plays is chance
  if (lane.oneOf) return refuse('step-is-a-random-choice')
  const found = findIn(lane.row, `part${row.part ?? 0}`, address.span, [], [])
  if (!found) return refuse('no-step-there')
  const { step, around } = found
  const slot = step.slots.find((s) => sameFrac(s.begin, address.at))
  if (!slot) return refuse('no-step-there')

  if (around.some((g) => g.oneOf)) return refuse('step-is-a-random-choice')
  // A group that REPEATS what it holds (`[bd ~]*2`, `[bd ~]!3`, `[bd ~](3,8)`, `[bd ~]/2`)
  // plays the step's one text in several places, and an edit to that text changes every
  // one of them together — the user's ruling (2026-11-04): a click edits the written step,
  // all its copies. A group op that plays by CHANCE (`[bd ~]?`), or one this file does not
  // know, is refused: what it would play is not a set of copies.
  if (around.some((g) => g.ops.some((o) => !REPEATS.has(o)))) return refuse('step-under-a-generator')
  // `bd!3` (and a bare `bd!`) is ONE text that plays as three steps. A click is on one of
  // them, and no change to that text touches only that one: `~ bd!2` or `bd ~ bd` respell
  // the step into several — the replication is a generator like `*n`, and it keeps its
  // parameter for a handle of its own later. Checked before the other ops so it says so.
  if (step.reps > 1 || step.ops.includes('replicate')) return refuse('step-is-replicated')
  // every other op makes, moves, thins or stretches the step's hits — only `:` tails are
  // part of the name
  if (step.ops.some((o) => o !== 'tail')) return refuse('step-is-generated')
  if (slot.fromBefore || slot.pastEnd) return refuse('step-crosses-a-bar')

  // Where the text plays over the loop: once, or in several places that all change together
  // (a group played in every bar, `{…}%n`, a repeated group). The loop must be the whole of
  // every row the step sits in: an alternation whose arms do not all come round in it
  // (`<a b c d>` over two bars) plays past the loop's end, where the view cannot show it.
  const loop = overTheLoop(trees)
  if (typeof loop === 'string') return refuse(loop)
  for (const { row: r, key } of found.rows) {
    if ((loop.get(key)?.size ?? 0) < r.written) return refuse('loop-shorter-than-the-pattern')
  }

  const order = row.order ?? lane.row.sounds

  if (step.rows !== null) {
    // a chord the row's sound is not in (the view draws the chord as one step of this row):
    // the sound joins it, as today's grid does (`[bd, hh] sd`, row sd on the chord)
    const members = chordOf(step, mini)
    if (!members || members.some((m) => m.name === row.sound)) return refuse('step-is-a-group')
    return joinChord(mini, members, order, row.sound)
  }

  if (step.name === null || step.head === null || step.span === null) return refuse('step-has-no-text')
  const { start: from, end: to } = step.head
  if (mini.slice(from, to) !== step.name) return refuse('tree-is-not-this-text')

  if (step.rest) return write(from, to, row.sound)

  // a note plays one hit in each of its slots, where the slot begins — anything else was made
  // by something the tree does not name as an op, and is not this step's text
  if (step.hits.length !== step.slots.length || !step.hits.every((h) => step.slots.some((s) => sameFrac(h.begin, s.begin)))) return refuse('step-is-generated')

  if (step.name === row.sound) {
    // The row's own note in a plain chord leaves the chord, so a click and a second click give
    // back the text that was there (`[bd, hh]` → `[bd, hh, sd]` → `[bd, hh]`); a chord left
    // with one member is that member (`[bd,sd]` → `bd`) — the user's ruling, 2026-11-04. A
    // chord of one (`[bd]`) has nothing to leave, and its note becomes a rest like any other.
    const chord = around.length > 0 ? chordOf(around[around.length - 1], mini) : null
    if (chord && chord.length > 1) {
      const k = chord.findIndex((m) => sameSpan(m.span, step.span!))
      if (k < 0) return refuse('tree-is-not-this-text')
      if (chord.length === 2) {
        const { open, close } = bracketsOf(mini, chord)!
        return write(open, close + 1, chord[1 - k].name)
      }
      // the member and the separator before it (after it, for the first)
      return k === 0 ? write(chord[0].span.start, chord[1].span.start, '') : write(chord[k - 1].span.end, chord[k].span.end, '')
    }
    return write(from, to, '~')
  }

  // Another sound of the same part plays here. Today's grid answers with a chord, its
  // members in the order of the grid's rows (`bd sd`, row bd on the `sd` → `[bd,sd]`); kept.
  // A note that is already a chord's member (`[bd]`, `[bd,hh]`'s `bd` when the row draws that
  // layer) gains the sound in that chord's brackets, not a chord of its own inside them.
  const parent = around.length > 0 ? chordOf(around[around.length - 1], mini) : null
  if (parent) {
    if (parent.some((m) => m.name === row.sound)) return refuse('step-is-a-group')
    return joinChord(mini, parent, order, row.sound)
  }
  const mineFirst = rank(order, row.sound) < rank(order, step.name)
  return write(from, to, mineFirst ? `[${row.sound},${step.name}]` : `[${step.name},${row.sound}]`)
}

/** `mini` with `edit` made */
export function applyStepEdit(mini: string, edit: StepEdit): string {
  return mini.slice(0, edit.from) + edit.insert + mini.slice(edit.to)
}
