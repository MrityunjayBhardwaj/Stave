/**
 * rollEdit.ts — the piano roll's edits as edits of a step's own text (#2294, stage 4 of
 * epic #1832).
 *
 * The roll addresses a note by WHERE IT PLAYS and its PITCH: a bar, the exact share of the
 * bar it begins at (as the divisions tree, asked of Strudel, gives it), and a MIDI row. This
 * file only turns that address into the written step it names and asks the step writer
 * (`./stepEdit.ts`) — the same writer the step grid uses, with the same rules — to change
 * that step's text. All text is spelled by `./strudelMini/spell.ts` through that writer.
 * Nothing here parses or prints the pattern, and nothing here models Strudel: the tree's
 * steps and Strudel's hits are the truth.
 *
 *   add     a rest at that place becomes the note (`~` → `e4`); a note of another pitch
 *           there gains it as a chord (`c4` → `[c4,e4]`); a place part-way through a plain
 *           step splits it (`c4` → `[c4 e4]`)
 *   delete  the note at that place and pitch becomes a rest, or leaves its chord
 *   length  the note at that place and pitch ends where asked, in its own group (`c4@2`)
 *
 * A note written once and played in several places changes everywhere it plays, as a
 * click on the grid does (the ruling of 2026-11-04). One hit of a plain `x*k` / `x!k` is
 * edited on its own (#2326).
 *
 *   move    a rest where the note was and the note where it lands, every copy of the
 *           written step together (the ruling of 2026-11-05); refused where the source and
 *           landing steps play in different places — that case is still open, and its rule
 *           is one function, `moveAcrossPlaces`
 */
import { rollPitch } from './notation/parse'
import { pitchToMidi } from './notation/pitch'
import type { BarTree, DivisionRow, DivisionStep, Frac } from './gridDivisions'
import { resizeStep, splitStep, toggleStep, type StepAddress, type StepEditResult } from './stepEdit'
import { respellCopies } from './strudelMini/spell'

/** where in the roll: a bar of the view's loop, and the share of it a note begins at */
export interface RollPlace {
  bar: number
  at: Frac
}

/** why the roll cannot make an edit by changing one step's text */
export type RollRefusal =
  /** no written step plays a note of this pitch beginning at that place */
  | 'no-note-there'
  /** no written step begins or runs through that place in any part */
  | 'no-step-there'
  /** several parts could take the note, and none is the obvious one */
  | 'part-unclear'
  /** an add where a note of that pitch already begins */
  | 'note-already-there'
  /** a move whose source and landing steps play in different places (still to be ruled) */
  | 'source-and-landing-play-in-different-places'
  /** a move into another bar of the view */
  | 'moves-across-bars'
  /** a move across places whose copies come from outside the note's own text (the loop, a `<…>` above) */
  | 'copies-come-from-outside-the-step'
  /** a move across places in a repeat whose content changes each time round (`[a <b c>]*2`): its copies are not one text */
  | 'repeat-plays-differently-each-time'

export type RollEditResult = StepEditResult | { ok: false; why: RollRefusal }

const same = (a: Frac, b: Frac): boolean => a.n * b.d === b.n * a.d
const before = (a: Frac, b: Frac): boolean => a.n * b.d < b.n * a.d

/** the MIDI row a hit is drawn on, as the roll reads it (`rollPitch`), or null */
function rowOf(value: unknown): number | null {
  const r = rollPitch(value)
  if (typeof r === 'string') return null
  const m = r.numeric ? Number(r.pitch) : pitchToMidi(r.pitch)
  return m === null || !Number.isFinite(m) ? null : m
}

/** every written step of a part's row, at any depth: chord members and group steps included */
function eachStep(row: DivisionRow, visit: (s: DivisionStep) => void): void {
  for (const s of row.steps) {
    visit(s)
    for (const r of s.rows ?? []) eachStep(r, visit)
  }
}

/**
 * The written note playing pitch `midi` from `place`, in which part: the step whose hit there
 * has that pitch — a plain note, a chord's member, or one hit of `x*k` / `x!k` — or null.
 */
export function noteAt(trees: readonly BarTree[], place: RollPlace, midi: number): { step: DivisionStep; part: number; at: Frac } | null {
  const tree = trees[place.bar]
  if (!tree || !tree.ok) return null
  let got: { step: DivisionStep; part: number; at: Frac } | null = null
  tree.parts.forEach((row, part) =>
    eachStep(row, (s) => {
      if (got || s.rows || s.rest || !s.span) return
      const h = s.hits.find((x) => same(x.begin, place.at) && rowOf(x.value) === midi)
      if (h) got = { step: s, part, at: h.begin }
    }),
  )
  return got
}

/**
 * Where a new note at `place` goes: the leaf step of some part that BEGINS there (a rest it
 * fills, a note it joins as a chord), else the plain step that runs THROUGH it (which it
 * splits). One part only: when several parts have a step there, the one with a rest there
 * wins; otherwise the note's part is unclear and nothing is written.
 */
function placeAt(trees: readonly BarTree[], place: RollPlace): { step: DivisionStep; part: number; slotBegin: Frac; inside: boolean } | RollRefusal {
  const tree = trees[place.bar]
  if (!tree || !tree.ok) return 'no-step-there'
  const begins: Array<{ step: DivisionStep; part: number; slotBegin: Frac }> = []
  const through: Array<{ step: DivisionStep; part: number; slotBegin: Frac }> = []
  tree.parts.forEach((row, part) =>
    eachStep(row, (s) => {
      if (s.rows || !s.span) return
      for (const slot of s.slots) {
        if (slot.fromBefore || slot.pastEnd) continue
        if (same(slot.begin, place.at)) begins.push({ step: s, part, slotBegin: slot.begin })
        else if (before(slot.begin, place.at) && before(place.at, slot.end)) through.push({ step: s, part, slotBegin: slot.begin })
      }
      // one hit of a plain `x*k` / `x!k` begins where a hit does, not a slot
      for (const h of s.hits) if (same(h.begin, place.at) && !s.slots.some((x) => same(x.begin, place.at))) begins.push({ step: s, part, slotBegin: h.begin })
    }),
  )
  const pick = <T extends { step: DivisionStep; part: number }>(xs: T[]): T | 'part-unclear' | null => {
    if (xs.length === 0) return null
    const parts = new Set(xs.map((x) => x.part))
    if (parts.size === 1) return xs.find((x) => x.step.rest) ?? xs[0]
    const rests = xs.filter((x) => x.step.rest)
    return rests.length === 1 ? rests[0] : 'part-unclear'
  }
  const b = pick(begins)
  if (b === 'part-unclear') return b
  if (b) return { ...b, inside: false }
  const t = pick(through)
  if (t === 'part-unclear') return t
  if (t) return { ...t, inside: true }
  return 'no-step-there'
}

/** a refusal or the address of a step */
const addressOf = (place: RollPlace, step: DivisionStep, at: Frac): StepAddress => ({ bar: place.bar, span: step.span!, at })

/**
 * ADD a note named `pitch` (the roll's token for its row: `e4`, or `64` for a numeric
 * pattern) at `place`. One replacement at one step's own text, or why not.
 */
export function rollAdd(mini: string, trees: readonly BarTree[], place: RollPlace, pitch: string): RollEditResult {
  // a note of this pitch already begins here: adding it again is nothing to write (and a
  // toggle of that text would take it away)
  const midi = /^-?[0-9]+(\.[0-9]+)?$/.test(pitch) ? Number(pitch) : pitchToMidi(pitch)
  if (midi !== null && noteAt(trees, place, midi)) return { ok: false, why: 'note-already-there' }
  const where = placeAt(trees, place)
  if (typeof where === 'string') return { ok: false, why: where }
  const row = { sound: pitch, part: where.part }
  if (where.inside) return splitStep(mini, trees, addressOf(place, where.step, where.slotBegin), place.at, row)
  return toggleStep(mini, trees, addressOf(place, where.step, where.slotBegin), row)
}

/** DELETE the note of row `midi` beginning at `place`: it becomes a rest, or leaves its chord */
export function rollRemove(mini: string, trees: readonly BarTree[], place: RollPlace, midi: number): RollEditResult {
  const n = noteAt(trees, place, midi)
  if (!n) return { ok: false, why: 'no-note-there' }
  return toggleStep(mini, trees, addressOf(place, n.step, n.at), { sound: n.step.name!, part: n.part })
}

/** every place the written step at `span` sits over the loop: `bar` and where in it it begins */
function placesOf(trees: readonly BarTree[], span: { start: number; end: number }): Array<{ bar: number; begin: Frac }> {
  const out: Array<{ bar: number; begin: Frac }> = []
  trees.forEach((t, bar) => {
    if (!t.ok) return
    t.parts.forEach((row) =>
      eachStep(row, (s) => {
        if (s.span && s.span.start === span.start && s.span.end === span.end) for (const sl of s.slots) if (!sl.fromBefore) out.push({ bar, begin: sl.begin })
      }),
    )
  })
  return out
}

const shift = (a: Frac, n: number, d: number): Frac => ({ n: a.n * d + n * a.d, d: a.d * d })

/**
 * Do the source and landing steps play in the SAME places, the landing a fixed time later in
 * each? Then a move moves every copy (the ruling of 2026-11-05, case 1).
 */
function samePlaces(source: Array<{ bar: number; begin: Frac }>, landing: Array<{ bar: number; begin: Frac }>, delta: Frac): boolean {
  if (source.length !== landing.length) return false
  return source.every((p) => landing.some((q) => q.bar === p.bar && same(q.begin, shift(p.begin, delta.n, delta.d))))
}

/** the group steps a written step sits in, innermost first, over one part's row */
function enclosing(row: DivisionRow, span: { start: number; end: number }, around: DivisionStep[] = []): DivisionStep[] | null {
  for (const s of row.steps) {
    if (s.span && s.span.start === span.start && s.span.end === span.end) return [...around].reverse()
    for (const r of s.rows ?? []) {
      const got = enclosing(r, span, [...around, s])
      if (got) return got
    }
  }
  return null
}

/**
 * A REPEAT WRITTEN IN THE STEP'S OWN TEXT: a group repeated by an integer `*k` or `!k`
 * (`[bd sd]*4`, `[c4 e4]!2`), the innermost one the note sits in — its text, its `k`, and
 * the text it is written out as. Null when the copies come from anywhere else (the loop
 * playing again in every bar, a `<…>` above, an outer op), where there is no one text to
 * write out.
 */
function repeatOf(mini: string, around: DivisionStep[]): { from: number; to: number; out: string; kind: 'star' | 'bang' } | null {
  for (const g of around) {
    if (!g.span || g.oneOf) continue
    const start = g.span.start + (mini.slice(g.span.start, g.span.end).length - mini.slice(g.span.start, g.span.end).trimStart().length)
    const text = mini.slice(start, g.span.end).trim()
    const m = /^(\[[^]*\])([*!])([1-9][0-9]*)$/.exec(text)
    if (!m) continue
    const k = Number(m[3])
    if (k < 2) continue
    const copies = Array.from({ length: k }, () => m[1])
    // `*k` squeezes the copies into the group's own slot: written out, they stay one step —
    // unless the repeat is the whole pattern, where its slot is the bar
    const whole = mini.trim() === text
    const out = m[2] === '!' || whole ? copies.join(' ') : `[${copies.join(' ')}]`
    return { from: start, to: start + text.length, out, kind: m[2] === '!' || whole ? 'bang' : 'star' }
  }
  return null
}

/**
 * MOVE ACROSS PLACES (#2294, case 2 — the ruling of 2026-11-05, "follow the community
 * code"). When the dragged note and where it lands play in different places, only the
 * REPEAT the dragged note sits in is written out — `[c4 e4]*4` as its four copies — the
 * one dragged copy changes, and the copies left side by side are spelled back by
 * `./strudelMini/spell.ts` (`[c4 e4]!3 [c4 ~]`): "a repeat then the odd one" is how the
 * community writes a variation (49 drum songs and 79 note songs, against 14 / 15 that nest
 * a `<…>` in a repeat). Copies made outside the step's own text — the loop playing again
 * in every bar, a `<…>` above — have no one text to write out: refused with that reason.
 *
 * Returns the text to move in (the original, or the repeat written out) and the region a
 * write-out must be spelled again in — or why not.
 */
export function moveAcrossPlaces(
  mini: string,
  trees: readonly BarTree[],
  source: { step: DivisionStep; part: number },
  landing: { step: DivisionStep },
  delta: Frac,
  treesOf: (mini: string) => readonly BarTree[],
):
  | { kind: 'moves-every-copy'; mini: string; trees: readonly BarTree[] }
  | { kind: 'written-out'; mini: string; trees: readonly BarTree[]; region: { from: number; to: number }; spell: 'star' | 'bang' }
  | { kind: 'refused'; why: 'source-and-landing-play-in-different-places' | 'copies-come-from-outside-the-step' | 'repeat-plays-differently-each-time' } {
  if (samePlaces(placesOf(trees, source.step.span!), placesOf(trees, landing.step.span!), delta)) return { kind: 'moves-every-copy', mini, trees }
  const tree = trees.find((t) => t.ok)
  const row = tree && tree.ok ? tree.parts[source.part] : null
  const around = row ? enclosing(row, source.step.span!) : null
  const rep = around ? repeatOf(mini, around) : null
  if (!rep) return { kind: 'refused', why: 'copies-come-from-outside-the-step' }
  // A repeat whose content changes from one repetition to the next — an alternation (`<4 5
  // 6>` steps on each time round), a polymeter, chance — is not k copies of one text:
  // written out, each copy would start its alternation afresh and play differently
  if (/[<{|?]/.test(mini.slice(rep.from, rep.to))) return { kind: 'refused', why: 'repeat-plays-differently-each-time' }
  const written = mini.slice(0, rep.from) + rep.out + mini.slice(rep.to)
  return { kind: 'written-out', mini: written, trees: treesOf(written), region: { from: rep.from, to: rep.from + rep.out.length }, spell: rep.kind }
}

/** the one replacement turning `before` into `after`: their common head and tail set aside */
function oneEdit(before: string, after: string): { from: number; to: number; insert: string } {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  let z = 0
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++
  return { from: a, to: before.length - z, insert: after.slice(a, after.length - z) }
}

/**
 * MOVE the note of row `midi` at `from` to row `toPitch` (its token) at `to`, in the same
 * bar: a rest where it was (`rollRemove`) and the note where it lands (`rollAdd`), every copy
 * of the written step together. One replacement covering both texts and nothing between them
 * changed. Refused when the two steps play in different places (`moveAcrossPlaces`), or
 * when either half is.
 */
export function rollMove(
  mini: string,
  trees: readonly BarTree[],
  from: RollPlace,
  midi: number,
  to: RollPlace,
  toPitch: string,
  treesOf: (mini: string) => readonly BarTree[],
): RollEditResult {
  if (to.bar !== from.bar) return { ok: false, why: 'moves-across-bars' }
  const n = noteAt(trees, from, midi)
  if (!n) return { ok: false, why: 'no-note-there' }
  const land = placeAt(trees, to)
  if (typeof land === 'string') return { ok: false, why: land }
  const delta = { n: to.at.n * from.at.d - from.at.n * to.at.d, d: to.at.d * from.at.d }
  const verdict = moveAcrossPlaces(mini, trees, n, land, delta, treesOf)
  if (verdict.kind === 'refused') return { ok: false, why: verdict.why }
  const text = verdict.mini
  let region = verdict.kind === 'written-out' ? { ...verdict.region } : null
  if (region) {
    // written out, the dragged copy plays once: the landing must now play where it does
    const n2 = noteAt(verdict.trees, from, midi)
    const land2 = placeAt(verdict.trees, to)
    if (!n2 || typeof land2 === 'string') return { ok: false, why: n2 ? (land2 as RollRefusal) : 'no-note-there' }
    if (!samePlaces(placesOf(verdict.trees, n2.step.span!), placesOf(verdict.trees, land2.step.span!), delta)) return { ok: false, why: 'source-and-landing-play-in-different-places' }
  }
  /** keep the written-out region's end in step with an edit made inside it */
  const follow = (e: { from: number; to: number; insert: string }): boolean => {
    if (!region) return true
    const d = e.insert.length - (e.to - e.from)
    if (e.to <= region.from) {
      region = { from: region.from + d, to: region.to + d }
      return true
    }
    if (e.from >= region.to) return true
    if (e.from < region.from || e.to > region.to) return false
    region.to += d
    return true
  }
  const gone = rollRemove(text, verdict.trees, from, midi)
  if (!gone.ok) return gone
  if (!follow(gone.edit)) return { ok: false, why: 'no-note-there' }
  const between = text.slice(0, gone.edit.from) + gone.edit.insert + text.slice(gone.edit.to)
  const added = rollAdd(between, treesOf(between), to, toPitch)
  if (!added.ok) return added
  if (!follow(added.edit)) return { ok: false, why: 'no-step-there' }
  let after = between.slice(0, added.edit.from) + added.edit.insert + between.slice(added.edit.to)
  if (region && verdict.kind === 'written-out') {
    // the copies left side by side spelled again: `[c4 e4] [c4 e4] [c4 e4] [c4 ~]` → `[c4 e4]!3 [c4 ~]`
    after = after.slice(0, region.from) + respellCopies(after.slice(region.from, region.to), verdict.spell) + after.slice(region.to)
  }
  return { ok: true, edit: oneEdit(mini, after) }
}

/** LENGTH: the note of row `midi` beginning at `place` ends at `end` (a share of the same bar) */
export function rollResize(mini: string, trees: readonly BarTree[], place: RollPlace, midi: number, end: Frac): RollEditResult {
  const n = noteAt(trees, place, midi)
  if (!n) return { ok: false, why: 'no-note-there' }
  return resizeStep(mini, trees, addressOf(place, n.step, n.at), end, { sound: n.step.name!, part: n.part })
}
