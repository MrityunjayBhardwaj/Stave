/**
 * A bar as the pattern's own divisions (#1833, part of #1832, epic #1007).
 *
 * `./joined.ts` says which note wrote each hit. This file says where every WRITTEN STEP
 * sits in one bar — notes, rests and groups alike — as a tree: a part is a row of steps,
 * a group step holds its own rows, and each row cuts its parent's slot again. Nothing is
 * laid on a shared column grid.
 *
 * WHERE A SLOT COMES FROM: STRUDEL IS ASKED, NOTHING IS ADDED UP HERE. A note's hit shows
 * where the note sounds, but a rest plays nothing, a euclid's step is wider than any of
 * its hits, and a group has no hit of its own. So each row is evaluated once more as a
 * MARKED COPY: in krill's parsed tree (not in the text) every step of the row is
 * replaced by a marker sound with the step's own ops set aside, and the marker's hap is
 * the step's slot. The weights, the alternations and everything above the row are
 * Strudel's, untouched; the copy is checked to play every other note exactly as before.
 *
 * A step whose own op repeats a GROUP (`[a b]*2`, `[a b](3,8)`) is asked a second time
 * with the op kept, so the row inside can be cut against each copy rather than against
 * the whole step. A step whose op repeats a single NOTE needs no second ask: its hits
 * are the copies, and each carries the argument atoms that shaped it (`JoinedHit.args`)
 * — the tokens an edit would change, so a generated step never has to be written out.
 *
 * THE TREE IS ONLY HANDED BACK WHEN IT HOLDS: in every row the steps tile the slot they
 * cut, and every hit of the bar starts inside a slot of the step that wrote it. Anything
 * else comes back as a refusal that says which rule failed — never a tree that is nearly
 * right. Every hit is in the tree once by construction: each note's step is visited
 * once, and a step with no slot this bar is refused if anything of it sounds.
 *
 * ⚠ Evaluator side, like `./joined.ts`: it takes a `MiniPattern`. The engine's import
 * graph must not reach it.
 */
import { joinedCycle, type JoinedCycle, type JoinedHit } from './joined'
import { markedPattern, type MarkedPattern, type MiniPattern, type MiniTime } from './pattern'
import { isRest, type MiniAtom, type MiniElement, type MiniGroup } from './shape'

/** an exact fraction of the cycle — plain data, so no Strudel object leaves the adapter */
export interface Frac {
  n: number
  d: number
}

/**
 * Where something sits in ONE bar, measured from the bar's start. A step longer than
 * the room it is given — a bar, or the slot of the step it is written in — is cut there,
 * and the two flags say so.
 */
export interface Slot {
  begin: Frac
  end: Frac
  /** it began before `begin`: this is the later part of a longer step */
  fromBefore: boolean
  /** it runs on past `end` */
  pastEnd: boolean
}

export interface Step {
  /** the written step */
  element: MiniElement
  /**
   * Where the written step sits, its own ops set aside. One slot, or several when
   * something ABOVE it repeats the row it is in (`[a b]*2`, `{a b c}%4`).
   */
  slots: Slot[]
  /** a written rest */
  rest: boolean
  /**
   * A note step: the hits it plays in this bar, in Strudel's order. More than one per
   * slot when the step's own op generates them; each hit carries its argument atoms.
   * Empty for a rest, for a group, and for a held note that began in an earlier bar.
   */
  hits: JoinedHit[]
  /** a group step whose own op repeats it: where each copy of its content sits */
  copies: Slot[] | null
  /** a group step: the rows inside it, each cutting `copies ?? slots` again */
  rows: Row[] | null
  /** the rows are a random choice (`a | b`): each copy holds ONE of them, not all */
  oneOf: boolean
}

/** one row of steps: a comma part, an alternation's arms, one layer of a polymeter */
export interface Row {
  group: MiniGroup
  /** the steps that sit in this bar, in written order — an arm another bar plays is absent */
  steps: Step[]
}

/** why a bar has no tree */
export type DivisionsRefusal =
  /** the pattern already contains the marker text */
  | 'marker-in-pattern'
  /** a hit has no single written note (`joinedCycle` says why) */
  | 'unpaired-hit'
  /** `a b . c d`: feet are a row of rows, not modelled yet */
  | 'feet'
  /** a group that mixes steps and rows, or nests rows in rows */
  | 'unknown-shape'
  /** Strudel could not evaluate the marked copy */
  | 'marked-copy-fails'
  /** the marked copy plays some other note differently — the slots it gives are not this pattern's */
  | 'marked-copy-differs'
  /** the steps of a row do not tile the slot they cut */
  | 'steps-do-not-tile'
  /** a hit does not start inside a slot of the step that wrote it */
  | 'hit-outside-its-step'

export type BarDivisions =
  | {
      ok: true
      /** one row per comma part; a single row when there is no comma */
      parts: Row[]
      /** the parts are a random choice (`a | b`): this bar holds ONE of them */
      oneOf: boolean
    }
  | { ok: false; why: DivisionsRefusal }

/* ── exact time ─────────────────────────────────────────────────── */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))

function fracOf(t: MiniTime, cyc: number): Frac {
  const rel = t.sub ? t.sub(cyc) : null
  const text = rel?.toFraction?.()
  const m = text === undefined ? null : /^(-?\d+)(?:\/(\d+))?$/.exec(text)
  if (!m) throw new Error(`divisions: a time that is not a fraction (${String(text)})`)
  const n = Number(m[1])
  const d = m[2] === undefined ? 1 : Number(m[2])
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}

/** negative, zero or positive as a is before, at or after b */
export const fracCompare = (a: Frac, b: Frac): number => a.n * b.d - b.n * a.d
const same = (a: Frac, b: Frac): boolean => fracCompare(a, b) === 0

const ZERO: Frac = { n: 0, d: 1 }
const ONE: Frac = { n: 1, d: 1 }
const WHOLE_BAR: Slot = { begin: ZERO, end: ONE, fromBefore: false, pastEnd: false }

/* ── the marked copies ──────────────────────────────────────────── */

/** no word a pattern would use; `marker-in-pattern` refuses the one that does */
const MARK = 'zzq'
const markerOf = (i: number): string => `${MARK}${i}`
/** the marker a hap's value names: the value itself, or the head of a `:` tail */
const markOf = (value: unknown): string | null => {
  const head = Array.isArray(value) ? value[0] : value
  return typeof head === 'string' && head.startsWith(MARK) ? head : null
}

type Copy = MarkedPattern | 'fails'
const COPIES = new WeakMap<MiniPattern, Map<string, Copy>>()

function copyOf(pat: MiniPattern, path: number[], children: number[], keepOps: boolean): Copy {
  let byKey = COPIES.get(pat)
  if (!byKey) COPIES.set(pat, (byKey = new Map()))
  const key = `${path.join('.')}|${children.join(',')}|${keepOps ? 'ops' : 'step'}`
  let copy = byKey.get(key)
  if (copy === undefined) {
    try {
      copy = markedPattern(pat.mini, path, children.map((child) => ({ child, marker: markerOf(child), keepOps })))
    } catch {
      copy = 'fails'
    }
    byKey.set(key, copy)
  }
  return copy
}

const hitKey = (value: unknown, begin: MiniTime, end: MiniTime): string =>
  `${JSON.stringify(value)}@${begin.toFraction?.() ?? begin.valueOf()}-${end.toFraction?.() ?? end.valueOf()}`

interface Ctx {
  pat: MiniPattern
  cyc: number
  joined: JoinedCycle
}

function notesIn(node: MiniElement | MiniGroup | MiniAtom, out: Set<MiniAtom>): Set<MiniAtom> {
  if (node.kind === 'atom') out.add(node)
  else if (node.kind === 'element') notesIn(node.content, out)
  else for (const c of node.children) notesIn(c, out)
  return out
}

/**
 * The slots the markers of one copy take in this bar, per marked child — or the refusal.
 * `inside` is every note the marks replaced: all OTHER notes must play as they did.
 */
function slotsOf(ctx: Ctx, copy: Copy, inside: Set<MiniAtom>): Map<number, Slot[]> | DivisionsRefusal {
  if (copy === 'fails') return 'marked-copy-fails'
  const want: string[] = []
  for (const j of ctx.joined.hits) if (!inside.has(j.atom!)) want.push(hitKey(j.hit.value, j.hit.begin, j.hit.end))
  const got: string[] = []
  let pieces: ReturnType<MarkedPattern['pieces']>
  try {
    for (const h of copy.hits(ctx.cyc)) if (markOf(h.value) === null) got.push(hitKey(h.value, h.begin, h.end))
    pieces = copy.pieces(ctx.cyc)
  } catch {
    return 'marked-copy-fails'
  }
  want.sort()
  got.sort()
  if (want.length !== got.length || want.some((k, i) => k !== got[i])) return 'marked-copy-differs'
  // one slot per hap; a hap Strudel hands back in several pieces is one slot
  const byWhole = new Map<string, { child: number; slot: Slot; from: Frac; to: Frac }>()
  for (const p of pieces) {
    const mark = markOf(p.value)
    if (mark === null) continue
    const child = Number(mark.slice(MARK.length))
    const begin = fracOf(p.begin, ctx.cyc)
    const end = fracOf(p.end, ctx.cyc)
    const key = `${child}|${hitKey(null, p.wholeBegin, p.wholeEnd)}`
    const seen = byWhole.get(key)
    if (seen) {
      if (fracCompare(begin, seen.slot.begin) < 0) seen.slot.begin = begin
      if (fracCompare(end, seen.slot.end) > 0) seen.slot.end = end
      continue
    }
    byWhole.set(key, {
      child,
      slot: { begin, end, fromBefore: false, pastEnd: false },
      from: fracOf(p.wholeBegin, ctx.cyc),
      to: fracOf(p.wholeEnd, ctx.cyc),
    })
  }
  const out = new Map<number, Slot[]>()
  for (const { child, slot, from, to } of byWhole.values()) {
    slot.fromBefore = fracCompare(from, slot.begin) < 0
    slot.pastEnd = fracCompare(to, slot.end) > 0
    const list = out.get(child)
    if (list) list.push(slot)
    else out.set(child, [slot])
  }
  for (const list of out.values()) list.sort((a, b) => fracCompare(a.begin, b.begin))
  return out
}

/* ── the tree ───────────────────────────────────────────────────── */

const isRefusal = (v: unknown): v is DivisionsRefusal => typeof v === 'string'

/** how a group's children sit together: side by side, or one chosen per turn */
type Together = 'all' | 'one'

/** the rows of a group, each with the path a marked copy reaches it by */
function rowsOf(group: MiniGroup, path: number[]): { rows: Array<{ group: MiniGroup; path: number[] }>; together: Together } | DivisionsRefusal {
  if (group.children.every((c) => c.kind === 'element')) return { rows: [{ group, path }], together: 'all' }
  if (group.alignment === 'feet') return 'feet'
  const rows: Array<{ group: MiniGroup; path: number[] }> = []
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i]
    if (child.kind !== 'group' || !child.children.every((c) => c.kind === 'element')) return 'unknown-shape'
    rows.push({ group: child, path: [...path, i] })
  }
  return { rows, together: group.alignment === 'rand' ? 'one' : 'all' }
}

/** the slots of `slots` that start inside `within`, if they cut it exactly: none, or edge to edge */
function tiling(slots: Slot[], within: Slot): 'none' | 'tiles' | 'broken' {
  const mine = slots.filter((s) => fracCompare(s.begin, within.begin) >= 0 && fracCompare(s.begin, within.end) < 0)
  if (mine.length === 0) return 'none'
  let at = within.begin
  for (const s of mine) {
    if (!same(s.begin, at)) return 'broken'
    at = s.end
  }
  return same(at, within.end) ? 'tiles' : 'broken'
}

/** slots that touch end to start, joined into the stretches they make */
function stretches(slots: Slot[]): Slot[] {
  const out: Slot[] = []
  for (const s of [...slots].sort((a, b) => fracCompare(a.begin, b.begin))) {
    const last = out[out.length - 1]
    if (last && same(last.end, s.begin)) out[out.length - 1] = { ...last, end: s.end, pastEnd: s.pastEnd }
    else out.push({ ...s })
  }
  return out
}

function rowSlots(row: Row): Slot[] {
  return row.steps.flatMap((s) => s.slots).sort((a, b) => fracCompare(a.begin, b.begin))
}

/** the rows of `group`, checked against the slots they cut */
function container(ctx: Ctx, group: MiniGroup, path: number[], cut: Slot[]): { rows: Row[]; oneOf: boolean } | DivisionsRefusal {
  const laid = rowsOf(group, path)
  if (isRefusal(laid)) return laid
  const rows: Row[] = []
  for (const r of laid.rows) {
    const steps = rowSteps(ctx, r.group, r.path)
    if (isRefusal(steps)) return steps
    rows.push({ group: r.group, steps })
  }
  const perRow = rows.map(rowSlots)
  // every slot of a row belongs to one of the slots it cuts…
  for (const slots of perRow) {
    for (const s of slots) {
      if (!cut.some((c) => fracCompare(s.begin, c.begin) >= 0 && fracCompare(s.begin, c.end) < 0)) return 'steps-do-not-tile'
    }
  }
  // …and cuts it edge to edge: every row, or for a random choice the one row chosen.
  // Rows that sit side by side are held to the STRETCH their slots make together: a
  // step may run from one copy into the next (`<a@2 b>*3` — `a` spans two copies) and
  // Strudel hands it back as one piece. A choice is made per copy, so it is held to each.
  for (const c of laid.together === 'all' ? stretches(cut) : cut) {
    const verdicts = perRow.map((slots) => tiling(slots, c))
    const tiled = verdicts.filter((v) => v === 'tiles').length
    const absent = verdicts.filter((v) => v === 'none').length
    if (laid.together === 'all' ? tiled !== rows.length : tiled !== 1 || absent !== rows.length - 1) return 'steps-do-not-tile'
  }
  return { rows, oneOf: laid.together === 'one' }
}

function rowSteps(ctx: Ctx, group: MiniGroup, path: number[]): Step[] | DivisionsRefusal {
  const elements = group.children as MiniElement[]
  const all = elements.map((_, i) => i)
  const inside = notesIn(group, new Set())
  const slots = slotsOf(ctx, copyOf(ctx.pat, path, all, false), inside)
  if (isRefusal(slots)) return slots
  // the group steps whose own op repeats them are asked again, op kept
  const repeated = all.filter((i) => elements[i].content.kind === 'group' && elements[i].ops.length > 0)
  let copies = new Map<number, Slot[]>()
  if (repeated.length > 0) {
    const within = new Set<MiniAtom>()
    for (const i of repeated) notesIn(elements[i], within)
    const asked = slotsOf(ctx, copyOf(ctx.pat, path, repeated, true), within)
    if (isRefusal(asked)) return asked
    copies = asked
  }
  const steps: Step[] = []
  for (const i of all) {
    const element = elements[i]
    const mine = slots.get(i) ?? []
    if (element.content.kind === 'atom') {
      const hits = ctx.joined.of(element.content)
      for (const j of hits) {
        const at = fracOf(j.hit.begin, ctx.cyc)
        if (!mine.some((s) => fracCompare(at, s.begin) >= 0 && fracCompare(at, s.end) < 0)) return 'hit-outside-its-step'
      }
      if (mine.length > 0) steps.push({ element, slots: mine, rest: isRest(element.content), hits, copies: null, rows: null, oneOf: false })
      continue
    }
    const own = repeated.includes(i) ? (copies.get(i) ?? []) : null
    if (mine.length === 0) {
      // an arm this bar does not play: nothing of it may sound
      if (ctx.joined.of(element).length > 0) return 'hit-outside-its-step'
      continue
    }
    const inner = container(ctx, element.content, [...path, i], own ?? mine)
    if (isRefusal(inner)) return inner
    steps.push({ element, slots: mine, rest: false, hits: [], copies: own, rows: inner.rows, oneOf: inner.oneOf })
  }
  return steps
}

/**
 * Bar `cyc` of `pat` as the pattern's own divisions, or why it has none.
 *
 * THROWS what Strudel throws when the pattern itself cannot be queried, and what krill
 * throws if the string does not parse, like `joinedCycle`.
 */
export function barDivisions(pat: MiniPattern, cyc: number): BarDivisions {
  if (pat.mini.includes(MARK)) return { ok: false, why: 'marker-in-pattern' }
  const joined = joinedCycle(pat, cyc)
  if (joined.hits.some((j) => j.atom === null)) return { ok: false, why: 'unpaired-hit' }
  const top = container({ pat, cyc, joined }, joined.root, [], [WHOLE_BAR])
  if (isRefusal(top)) return { ok: false, why: top }
  return { ok: true, parts: top.rows, oneOf: top.oneOf }
}
