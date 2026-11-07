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
import { chunkDivisions, laneDivisions, type BarTree, type BarTreeRefusal, type DivisionRow, type DivisionStep, type Frac, type LaneDivisionsRefusal } from './gridDivisions'
import type { MiniSpan } from './strudelMini/shape'
import { miniPattern } from './strudelMini/pattern'
// every step this file writes is spelled there, so no gesture keeps a spelling of its own (#2326)
import { REST, chord, group, note, printElement, printSeq, respellWrittenOut, rests } from './strudelMini/spell'

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
  /** a split: the place asked is not strictly inside the step (its start is a plain toggle) */
  | 'not-inside-the-step'
  /** a resize: the step is not the row's own note (a rest, another sound, a group) */
  | 'not-the-rows-note'
  /** a resize: the length asked is not a whole number of the step's own units, or is its length now */
  | 'length-not-whole-steps'
  /** a resize: the step's length is not written as plain holds or one whole `@n` (`bd@1.5`, `bd@2 _`) */
  | 'length-not-plain'
  /** a longer note: the steps after it in its group are not rests that end exactly where the note would */
  | 'no-room-to-grow'

export type StepEditResult = { ok: true; edit: StepEdit } | { ok: false; why: StepEditRefusal }

/* ── the row a grid row edits ───────────────────────────────────── */

/**
 * The tree row a grid row edits: `laneDivisions`'s answer, and two more.
 *
 * - A row that names no part under several (a grid read leaf by leaf, `bd ~, <[~ sd]*2>`):
 *   the one part that writes its sound, when exactly one does — `laneDivisions` will not
 *   guess, and this is not a guess: no other part has a step of that sound to edit.
 * - A row whose sound the text does not write anywhere yet (a voice just added, or one
 *   emptied of its last note): its own part, or the only part. `laneDivisions` refuses it
 *   because there it checks the grid's parts are Strudel's; a sound written nowhere has
 *   nothing to check, and the rests it would land on are the part's own.
 */
export function laneRowForEdit(tree: BarTree, row: Pick<StepLane, 'sound' | 'part'>): ReturnType<typeof laneDivisions> {
  const lane = laneDivisions(tree, row)
  if (!lane.ok && lane.why === 'lane-part-unknown' && tree.ok) {
    const writes = tree.parts.filter((p) => p.sounds.includes(row.sound))
    return writes.length === 1 ? { ok: true, row: writes[0], oneOf: tree.oneOf } : lane
  }
  if (lane.ok || lane.why !== 'lane-sound-not-in-part' || !tree.ok) return lane
  if (tree.parts.some((p) => p.sounds.includes(row.sound))) return lane
  const part = tree.parts[row.part ?? 0]
  return part ? { ok: true, row: part, oneOf: tree.oneOf } : lane
}

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

/** the step at `address`, found and checked: every rule a step's own text must pass before any gesture writes it */
type Located =
  | { ok: true; lane: { row: DivisionRow }; found: Found; slot: DivisionStep['slots'][number] }
  | { ok: false; why: StepEditRefusal }

/**
 * `fromItsStart`: a toggle may edit a step that sounds on past its bar (`A1@4` in
 * `<A1@4 D2@4>`, `[oh]/8`) when the click is where the step STARTS (#2441): the edit is the
 * step's own name, so it changes the one note however long it lasts. A split or resize
 * measures inside the slot the bar shows, which is not the whole step, so it keeps the
 * refusal; and so does any click on a bar the step only sounds through.
 */
function locate(trees: readonly BarTree[], address: StepAddress, row: StepRow, fromItsStart = false): Located {
  const no = (why: StepEditRefusal): Located => ({ ok: false, why })
  const tree = trees[address.bar]
  if (!tree) return no('no-such-bar')
  const lane = laneRowForEdit(tree, row)
  if (!lane.ok) return no(lane.why)
  // a random choice of whole parts: what the bar plays is chance
  if (lane.oneOf) return no('step-is-a-random-choice')
  // the part's key by its place in the bar, since the row may not name it
  const found = findIn(lane.row, `part${tree.ok ? tree.parts.indexOf(lane.row) : 0}`, address.span, [], [])
  if (!found) return no('no-step-there')
  const { step, around } = found
  const slot = step.slots.find((s) => sameFrac(s.begin, address.at))
  if (!slot) {
    // one hit of the step its own op made (`bd(3,8)`'s second): the op is the reason
    if (step.hits.some((h) => sameFrac(h.begin, address.at))) return no(step.reps > 1 || step.ops.includes('replicate') ? 'step-is-replicated' : 'step-is-generated')
    return no('no-step-there')
  }

  if (around.some((g) => g.oneOf)) return no('step-is-a-random-choice')
  // A group that REPEATS what it holds (`[bd ~]*2`, `[bd ~]!3`, `[bd ~](3,8)`, `[bd ~]/2`)
  // plays the step's one text in several places, and an edit to that text changes every
  // one of them together — the user's ruling (2026-11-04): a click edits the written step,
  // all its copies. A group op that plays by CHANCE (`[bd ~]?`), or one this file does not
  // know, is refused: what it would play is not a set of copies.
  if (around.some((g) => g.ops.some((o) => !REPEATS.has(o)))) return no('step-under-a-generator')
  // `bd!3` (and a bare `bd!`) is ONE text that plays as three steps. A click is on one of
  // them, and no change to that text touches only that one: `~ bd!2` or `bd ~ bd` respell
  // the step into several — the replication is a generator like `*n`, and it keeps its
  // parameter for a handle of its own later. Checked before the other ops so it says so.
  if (step.reps > 1 || step.ops.includes('replicate')) return no('step-is-replicated')
  // every other op makes, moves, thins or stretches the step's hits — only `:` tails are
  // part of the name
  if (step.ops.some((o) => o !== 'tail')) return no('step-is-generated')
  if (slot.fromBefore || (slot.pastEnd && !fromItsStart)) return no('step-crosses-a-bar')

  // Where the text plays over the loop: once, or in several places that all change together
  // (a group played in every bar, `{…}%n`, a repeated group). The loop must be the whole of
  // every row the step sits in: an alternation whose arms do not all come round in it
  // (`<a b c d>` over two bars) plays past the loop's end, where the view cannot show it.
  const loop = overTheLoop(trees)
  if (typeof loop === 'string') return no(loop)
  for (const { row: r, key } of found.rows) {
    if ((loop.get(key)?.size ?? 0) < r.written) return no('loop-shorter-than-the-pattern')
  }
  return { ok: true, lane, found, slot }
}

/**
 * Toggle `row`'s sound on the step at `address`: a rest becomes the row's sound (`~` →
 * `sd`), the row's own note becomes a rest (`sd` → `~`), and a step another sound plays
 * gains the row's sound beside it (`bd` → `[bd,sd]`). One replacement inside the step's own
 * text, or why it cannot be written that way.
 *
 * Pure: `mini` is the chunk's string and `trees` its `chunkDivisions(mini, bars)` over the
 * view's whole loop. Nothing is evaluated here.
 */
function toggleStepHere(mini: string, trees: readonly BarTree[], address: StepAddress, row: StepRow): StepEditResult {
  const at = locate(trees, address, row, true)
  if (!at.ok) return refuse(at.why)
  const { lane, found } = at
  const { step, around } = found

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
    return write(from, to, REST)
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
  return write(from, to, printElement(chord(mineFirst ? [row.sound, step.name] : [step.name, row.sound])))
}

/** `mini` with `edit` made */
export function applyStepEdit(mini: string, edit: StepEdit): string {
  return mini.slice(0, edit.from) + edit.insert + mini.slice(edit.to)
}

/* ── split and resize (#2293) ───────────────────────────────────── */

/**
 * `resizeStep` by `delta` of the note's own units (one longer, one shorter): what the keys
 * and the length handle's offer ask, where the grid knows the step but not its unit.
 */
function resizeStepByHere(mini: string, trees: readonly BarTree[], address: StepAddress, delta: number, row: StepRow): StepEditResult {
  const got = locate(trees, address, row)
  if (!got.ok) return refuse(got.why)
  const { step } = got.found
  if (!Number.isInteger(step.weight) || step.weight < 1) return refuse('length-not-plain')
  const unit = fdiv(fsub(got.slot.end, got.slot.begin), { n: step.weight, d: 1 })
  const k = step.weight + delta
  const end = { n: got.slot.begin.n * unit.d + k * unit.n * got.slot.begin.d, d: got.slot.begin.d * unit.d }
  return resizeStepHere(mini, trees, address, end, row)
}

const fsub = (a: Frac, b: Frac): Frac => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d })
const gcdOf = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcdOf(b, a % b))
/** `a / b` in lowest terms, `b` not zero */
function fdiv(a: Frac, b: Frac): Frac {
  let n = a.n * b.d
  let d = a.d * b.n
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcdOf(n, d) || 1
  return { n: n / g, d: d / g }
}

/** the note's text must be its name and its plays must be one hit per slot, where the slot begins */
function plainNote(mini: string, step: DivisionStep): StepEditRefusal | null {
  if (step.rows !== null) return 'step-is-a-group'
  if (step.name === null || step.head === null || step.span === null) return 'step-has-no-text'
  if (mini.slice(step.head.start, step.head.end) !== step.name) return 'tree-is-not-this-text'
  if (!step.rest && (step.hits.length !== step.slots.length || !step.hits.every((h) => step.slots.some((s) => sameFrac(h.begin, s.begin))))) {
    return 'step-is-generated'
  }
  return null
}

/**
 * SPLIT A PLAIN STEP where a click lands part-way through it (#2293 — the snap halves the
 * design locked as option B): the step's name becomes a group of equal parts, its own name
 * first, the row's sound where the click is, rests between. One replacement at the name;
 * whatever follows it (`@2`, `_` holds) stays as written.
 *
 *   `bd ~ sn ~`, row bd, at 1/8 (the second half of `bd`)  →  `[bd bd] ~ sn ~`
 *   `~`, its second half                                    →  `[~ bd]`
 *   `bd@2`, a quarter of the way in                         →  `[bd bd ~ ~]@2`
 *
 * `at` is where in bar `address.bar` the click is, as a share of the bar. The parts are as
 * many as the click's place needs and no more: half way is two, a quarter of the way four.
 * The step's own hit, if it plays one, now lasts its first part — the music of a split, as
 * the grid has always written it. Refused wherever a toggle of the same step is.
 *
 * `unit`, when given, is the smallest part the caller draws, as a share of the bar (the
 * piano roll's column, #2294): the parts are then that size, so the new note lasts one
 * column — `~` over 8 columns, clicked at its third, is `[~ ~ d4 ~ ~ ~ ~ ~]`, not
 * `[~ d4 ~ ~]`. Only a rest is split so: a note's own hit lasts its first part, and finer
 * parts would cut it shorter than the click needs. Ignored where it does not divide the step
 * into whole parts that hold the click's place.
 */
function splitStepHere(mini: string, trees: readonly BarTree[], address: StepAddress, at: Frac, row: StepRow, unit?: Frac): StepEditResult {
  const got = locate(trees, address, row)
  if (!got.ok) return refuse(got.why)
  const { step } = got.found
  const bad = plainNote(mini, step)
  if (bad) return refuse(bad)
  // where in the step the click is, exactly: k of q equal parts
  const width = fsub(got.slot.end, got.slot.begin)
  let p = fdiv(fsub(at, got.slot.begin), width)
  if (p.n <= 0 || p.n >= p.d) return refuse('not-inside-the-step')
  // parts of the caller's unit, where that unit cuts the step into whole parts holding the
  // click — a rest only: a note split finer would only be cut shorter than it needs to be
  if (unit && step.rest) {
    const q = fdiv(width, unit)
    if (q.d === 1 && q.n > p.d && q.n % p.d === 0) p = { n: (p.n * q.n) / p.d, d: q.n }
  }
  // the step's name only: whatever follows it (`@2`) still applies to the whole of it
  const parts = Array.from({ length: p.d }, (_, i) => note(i === 0 ? step.name! : i === p.n ? row.sound : REST))
  return write(step.head!.start, step.head!.end, printElement(group(parts)))
}

/** the step's text ends here, padding left out */
const textEnd = (mini: string, s: DivisionStep): number => s.span!.start + mini.slice(s.span!.start, s.span!.end).trimEnd().length

type Length = { kind: 'plain' } | { kind: 'at'; from: number; to: number; n: number } | { kind: 'holds'; at: number[] }

/** a note's length as written after its name: nothing, one whole `@n`, or `_` holds (and where each is) — else null */
function lengthOf(mini: string, step: DivisionStep): Length | null {
  const after = mini.slice(step.head!.end, textEnd(mini, step))
  if (after === '') return { kind: 'plain' }
  const m = /^@([1-9][0-9]*)$/.exec(after)
  if (m) return { kind: 'at', from: step.head!.end, to: step.head!.end + after.length, n: Number(m[1]) }
  if (/^(\s+_)+$/.test(after)) {
    const at: number[] = []
    for (let i = 0; i < after.length; i++) if (after[i] === '_') at.push(step.head!.end + i)
    return { kind: 'holds', at }
  }
  return null
}

/**
 * MAKE THE ROW'S NOTE END AT `end` (#2293): a resize that stays inside the note's group.
 * The length is counted in the note's own units — the share of its group one step takes —
 * and spelled by `./strudelMini/spell.ts` (#2326): a length is `@n`, room given back is rests.
 *
 *   `bd ~ sd ~`, longer by one   →  `bd@2 sd ~`   (the rest after it is taken in)
 *   `bd@2 ~ sd`, longer by one   →  `bd@3 sd`
 *   `bd@3 sd`,   shorter by one  →  `bd@2 ~ sd`   (the room it gives back is a rest)
 *   `bd _ sd ~`, shorter by one  →  `bd ~ sd ~`   (its holds are its own text, now `@n`)
 *
 * A longer note takes the room of the rests after it in its group, which must end exactly
 * where the note would; anything else after it — a note, a group, a rest longer than the
 * room asked — is refused, as is a length that is not a whole number of units. The group
 * keeps its count of units, so every other step keeps its place and nothing else is heard
 * to change but the note's length. `end` is a share of bar `address.bar`.
 */
function resizeStepHere(mini: string, trees: readonly BarTree[], address: StepAddress, end: Frac, row: StepRow): StepEditResult {
  const got = locate(trees, address, row)
  if (!got.ok) return refuse(got.why)
  const { step } = got.found
  const { slot } = got
  if (step.rows !== null || step.rest || step.name !== row.sound) return refuse('not-the-rows-note')
  const bad = plainNote(mini, step)
  if (bad) return refuse(bad)
  if (!Number.isInteger(step.weight) || step.weight < 1) return refuse('length-not-plain')
  const len = lengthOf(mini, step)
  if (!len || (len.kind === 'plain' && step.weight !== 1) || (len.kind === 'at' && len.n !== step.weight) || (len.kind === 'holds' && len.at.length + 1 !== step.weight)) {
    return refuse('length-not-plain')
  }
  // the note's unit: its slot over its weight; the length asked, in units
  const unit = fdiv(fsub(slot.end, slot.begin), { n: step.weight, d: 1 })
  const want = fdiv(fsub(end, slot.begin), unit)
  if (want.d !== 1 || want.n < 1 || want.n === step.weight) return refuse('length-not-whole-steps')
  const w = want.n
  // the note's own text: its name and whatever length it writes after it
  const from = step.head!.start
  const name = step.name!

  if (w < step.weight) return write(from, textEnd(mini, step), printSeq([note(name, w), ...rests(step.weight - w)]))

  // LONGER: the rests after the note in its own row, next in time, until the room is filled.
  // Only in a row whose steps are all heard in this bar — a sequence. An alternation's next arm
  // (`<bd - - ->*2`: the `-` heard after `bd`) is not room in the note's group: taking it in
  // would remove an arm every other bar plays.
  const ownRow = got.found.rows[got.found.rows.length - 1].row
  if (ownRow.written !== ownRow.steps.length) return refuse('no-room-to-grow')
  const rowSteps = ownRow.steps
  const i = rowSteps.indexOf(step)
  let need = w - step.weight
  let atTime = slot.end
  const taken: DivisionStep[] = []
  for (let j = i + 1; j < rowSteps.length && need > 0; j++) {
    const r = rowSteps[j]
    // the next step in TIME in this bar — an alternation's next arm is not
    const next = r.slots.find((x) => sameFrac(x.begin, atTime))
    if (!next || !r.rest || r.rows || r.ops.length > 0 || r.reps !== 1 || !r.span || !r.head || next.pastEnd) return refuse('no-room-to-grow')
    const u = fdiv(fsub(next.end, next.begin), unit)
    if (u.d !== 1 || u.n > need) return refuse('no-room-to-grow')
    taken.push(r)
    need -= u.n
    atTime = next.end
  }
  if (need > 0) return refuse('no-room-to-grow')
  // the note and the rests it takes in become one step
  return write(from, textEnd(mini, taken[taken.length - 1]), printElement(note(name, w)))
}

/* ── a hit of `x*k`, a copy of `x!k` (#2326) ─────────────────────── */

/**
 * A step written as a PLAIN generator: one note (its `:` tails allowed) made `k` equal hits
 * by `*k`, or `k` copies by `!k` — an integer `k`, no other op. The user's ruling
 * (2026-11-05): the spelling writes these wherever the shape is even, so the writer must
 * edit them. Euclid joins them (the ruling of 2026-11-07, #2434): `bd(3,8)` is written out as
 * its eight slots, `[bd ~ ~ bd ~ ~ bd ~]`, where Strudel itself says the hits are. Anything
 * else on a step — `?`, `|`, a pattern amount (`*<2 4>`, `(<3 5>,8)`), a decimal — keeps its
 * refusal.
 */
interface PlainGenerator {
  kind: 'star' | 'bang' | 'euclid'
  k: number
  /** where the step's own text is in the string */
  from: number
  to: number
  /** the step written out: `[hh hh hh hh]@2` for `hh*4@2`, `bd bd bd` for `bd!3` */
  out: string
  /** where each written-out copy's name begins, in the string the step is written out in */
  heads: number[]
}

function plainGenerator(mini: string, step: DivisionStep): PlainGenerator | null {
  if (step.rows !== null || step.rest || step.name === null || step.head === null || step.span === null) return null
  const from = step.head.start
  const to = textEnd(mini, step)
  const own = mini.slice(from, to)
  const name = step.name
  if (!own.startsWith(name)) return null
  const rest = own.slice(name.length)
  const ops = step.ops.filter((o) => o !== 'tail')
  let kind: PlainGenerator['kind']
  let k: number
  let after = ''
  const star = /^\*([1-9][0-9]*)(@[1-9][0-9]*)?$/.exec(rest)
  const bang = /^!([1-9][0-9]*)?$/.exec(rest)
  const euclid = /^(\(\s*-?[0-9]+\s*,\s*([1-9][0-9]*)\s*(?:,\s*[0-9]+\s*)?\))(@[1-9][0-9]*)?$/.exec(rest)
  if (euclid && ops.length === 1 && ops[0] === 'bjorklund' && step.reps === 1) return euclidWrittenOut(name, euclid[1], Number(euclid[2]), euclid[3] ?? '', from, to)
  if (star && ops.length === 1 && ops[0] === 'stretch' && step.reps === 1) {
    kind = 'star'
    k = Number(star[1])
    after = star[2] ?? ''
  } else if (bang && ops.length === 1 && ops[0] === 'replicate' && step.reps > 1) {
    kind = 'bang'
    k = bang[1] ? Number(bang[1]) : 2
    if (k !== step.reps || step.weight !== k) return null
  } else return null
  if (k < 2) return null
  const heads: number[] = []
  let out = kind === 'star' ? '[' : ''
  for (let i = 0; i < k; i++) {
    if (i > 0) out += ' '
    heads.push(from + out.length)
    out += name
  }
  out += kind === 'star' ? `]${after}` : ''
  return { kind, k, from, to, out, heads }
}

/**
 * `name(k,n[,r])` written out as its `n` slots: the name where Strudel plays a hit in the
 * step's first cycle, a rest elsewhere. Strudel is asked by playing the step's own text alone
 * (`bd(3,8,2)`), so rotation and a negative `k` mean what they mean there. Null where a hit
 * is not on a slot or the count disagrees: then the step keeps its refusal.
 */
function euclidWrittenOut(name: string, args: string, n: number, after: string, from: number, to: number): PlainGenerator | null {
  if (n < 2) return null
  let onsets: number[]
  try {
    onsets = miniPattern(`${name}${args}`).hits(0).map((h) => h.begin.valueOf() * n)
  } catch {
    return null
  }
  const at = new Set<number>()
  for (const x of onsets) {
    const i = Math.round(x)
    if (Math.abs(x - i) > 1e-9 || i < 0 || i >= n || at.has(i)) return null
    at.add(i)
  }
  if (at.size === 0) return null
  const heads: number[] = []
  let out = '['
  for (let i = 0; i < n; i++) {
    if (i > 0) out += ' '
    // every place is a cell the grid draws: a hit to erase, or an empty place to fill
    heads.push(from + out.length)
    out += at.has(i) ? name : REST
  }
  out += `]${after}`
  return { kind: 'euclid', k: n, from, to, out, heads }
}

type Writer = (mini: string, trees: readonly BarTree[], address: StepAddress) => StepEditResult

/**
 * A gesture on one hit of `x*k` or one copy of `x!k`: the step is written out (`hh*4` →
 * `[hh hh hh hh]`, `bd!3` → `bd bd bd`), the gesture is made on that one hit by the same
 * writer as any other step, and the result is spelled again — the third hit of `hh*4`
 * erased is `[hh hh ~ hh]`. One replacement, at the step's own text (and, for a longer
 * note, the rests it takes in). Null when the address is not on such a step: the writer
 * then answers as it always has.
 */
function viaWrittenOut(mini: string, trees: readonly BarTree[], address: StepAddress, row: StepRow, writer: Writer): StepEditResult | null {
  const tree = trees[address.bar]
  if (!tree) return null
  const lane = laneRowForEdit(tree, row)
  if (!lane.ok) return null
  const found = findIn(lane.row, `part${tree.ok ? tree.parts.indexOf(lane.row) : 0}`, address.span, [], [])
  if (!found) return null
  const gen = plainGenerator(mini, found.step)
  if (!gen) return null
  const written = mini.slice(0, gen.from) + gen.out + mini.slice(gen.to)
  const again = chunkDivisions(written, trees.length)
  // the written-out copy whose hit begins where the gesture is
  const t = again[address.bar]
  if (!t || !t.ok) return refuse(t ? t.why : 'no-such-bar')
  let span: MiniSpan | null = null
  const visit = (r: DivisionRow): void => {
    for (const s of r.steps) {
      if (s.head && gen.heads.includes(s.head.start) && s.span && s.slots.some((x) => sameFrac(x.begin, address.at))) span = s.span
      for (const k of s.rows ?? []) visit(k)
    }
  }
  t.parts.forEach(visit)
  if (!span) return refuse('no-step-there')
  const inner = writer(written, again, { bar: address.bar, span, at: address.at })
  if (!inner.ok) return inner
  const edit = inner.edit
  const end = gen.from + gen.out.length
  const delta = edit.insert.length - (edit.to - edit.from)
  // the region the step is now: its written-out text, edited — and the rests a longer note took in
  const regionEnd = edit.to > end ? edit.from + edit.insert.length : end + delta
  const replacedEnd = edit.to > end ? gen.to + (edit.to - end) : gen.to
  if (edit.from < gen.from) return refuse('tree-is-not-this-text')
  const after = applyStepEdit(written, edit)
  return write(gen.from, replacedEnd, respellWrittenOut(after.slice(gen.from, regionEnd), gen.kind === 'bang' ? 'bang' : 'star'))
}

/* ── the gestures ──────────────────────────────────────────────────── */

/**
 * Toggle `row`'s sound on the step at `address`: a rest becomes the row's sound (`~` →
 * `sd`), the row's own note becomes a rest (`sd` → `~`), and a step another sound plays
 * gains the row's sound beside it (`bd` → `[bd,sd]`). On one hit of `x*k` or one copy of
 * `x!k`, that hit alone (#2326). One replacement inside the step's own text, or why it
 * cannot be written that way.
 */
export function toggleStep(mini: string, trees: readonly BarTree[], address: StepAddress, row: StepRow): StepEditResult {
  return viaWrittenOut(mini, trees, address, row, (m, t, a) => toggleStepHere(m, t, a, row)) ?? toggleStepHere(mini, trees, address, row)
}

/** `splitStepHere`, on one hit of `x*k` or copy of `x!k` too (#2326) */
export function splitStep(mini: string, trees: readonly BarTree[], address: StepAddress, at: Frac, row: StepRow, unit?: Frac): StepEditResult {
  return viaWrittenOut(mini, trees, address, row, (m, t, a) => splitStepHere(m, t, a, at, row, unit)) ?? splitStepHere(mini, trees, address, at, row, unit)
}

/** `resizeStepHere`, on one hit of `x*k` or copy of `x!k` too (#2326) */
export function resizeStep(mini: string, trees: readonly BarTree[], address: StepAddress, end: Frac, row: StepRow): StepEditResult {
  return viaWrittenOut(mini, trees, address, row, (m, t, a) => resizeStepHere(m, t, a, end, row)) ?? resizeStepHere(mini, trees, address, end, row)
}

/** `resizeStepByHere`, on one hit of `x*k` or copy of `x!k` too (#2326) */
export function resizeStepBy(mini: string, trees: readonly BarTree[], address: StepAddress, delta: number, row: StepRow): StepEditResult {
  return viaWrittenOut(mini, trees, address, row, (m, t, a) => resizeStepByHere(m, t, a, delta, row)) ?? resizeStepByHere(mini, trees, address, delta, row)
}
