/**
 * spell.ts — the tree → text half of a step edit (#2326, epic #1832).
 *
 * Strudel already owns text → tree (krill, `@strudel/mini`) and tree → sound. The one half
 * that is ours is tree → text: when the grid changes a step, what does the step's own text
 * become? This file is that printer, and nothing else. Its input is KRILL'S OWN NODE — an
 * `element` with `source_` (an atom or a pattern), and `options_` `{ weight, reps, ops }`
 * in krill's vocabulary (`stretch`, `replicate`, `tail`) — and its output is text that
 * krill reads back as that same node (`roundTrips`, which every test and the corpus run ask).
 *
 * It lives in the adapter (`codeView/strudelMini/`) because it reads and builds krill's nodes,
 * and only the adapter does that (#1972).
 *
 * The step writer (`../stepEdit.ts`) decides WHAT a step becomes; the builders here decide
 * which of krill's equivalent nodes to write for it. The rules come from counting how the
 * community writes each shape (the study on #2326: 677 songs, krill-parsed), coarse on
 * purpose and named, so each can be made finer on its own:
 *
 *  - `HOLD_IS_AT` — a step held k slots is `x@k` (`_` runs: 0 uses in 677 songs).
 *  - `EVEN_HITS_ARE_STAR` — k equal hits of one sound in one step are `x*k` (`bd` split in
 *    half by its own row is `bd*2`). A group that also holds a rest stays a group: `[bd ~]`.
 *  - `COPIES_FROM_THREE_ARE_BANG` — k ≥ 3 copies of the same step side by side, made by the
 *    edit inside the edited step's own text, are `x!k`; two stay written out. Never folds a
 *    neighbour the edit did not write.
 *  - `RESTS_WRITTEN_OUT` — rests the edit makes are one `~` per slot (`~@k`: rare in the study).
 *    What is left of a rest someone wrote as `~@k` keeps its `@` (#2541, ruled on #2444).
 *  - `GROUP_IS_SPACED` — an uneven group is `[a b …]`.
 *  - `CHORD_IS_COMMAS` — notes sounding together are `[a,b]`, tight when new; a member joining
 *    a chord uses the separator that chord already uses (the caller passes it).
 *  - `EUCLID_FOR_A_EUCLID_RHYTHM` — a written-out step of one sound and rests whose hits are
 *    Strudel's own Bjorklund is `x(k,n)` / `x(k,n,r)`, tight here (40 of 53 euclids in the
 *    corpus have no spaces in the brackets). When it is one, and how its brackets are spaced
 *    after the euclids written beside it, is the writer's to decide (`../stepEdit.ts`,
 *    `respellEuclid`, #2437, #2554).
 *
 * The user's ruling (2026-11-05): the compact forms are written wherever the shape is even;
 * the writer edits what this file writes (a click on one hit of `hh*4` writes it out).
 */

import { miniTree, type KElement } from './tree'

/* ── krill's nodes, as the printer takes them (no locations) ──────── */

export interface SAtom {
  type_: 'atom'
  source_: string
}
export interface SOp {
  type_: string
  arguments_?: Record<string, unknown>
}
export interface SElement {
  type_: 'element'
  source_: SAtom | SPattern
  options_: { weight: number; reps: number; ops: SOp[] }
}
export interface SPattern {
  type_: 'pattern'
  arguments_: { alignment: string; _steps?: boolean }
  source_: Array<SElement | SPattern>
}

export const REST = '~'

/* ── the printer ───────────────────────────────────────────────────── */

function printOps(ops: readonly SOp[], head: string): string {
  let out = head
  for (const op of ops) {
    const a = op.arguments_ ?? {}
    if (op.type_ === 'tail') out += ':' + String((a.element as SAtom).source_)
    else if (op.type_ === 'stretch' && a.type === 'fast') out += '*' + String((a.amount as SAtom).source_)
    else if (op.type_ === 'stretch' && a.type === 'slow') out += '/' + String((a.amount as SAtom).source_)
    else if (op.type_ === 'replicate') out += '!' + String(a.amount)
    else if (op.type_ === 'bjorklund') {
      const [k, n, r] = [argText(a.pulse), argText(a.step), a.rotation ? argText(a.rotation) : '']
      if (k === null || n === null || r === null) throw new Error('stepSpell: a euclid whose amounts are not plain')
      out += `(${k},${n}${r === '' ? '' : ',' + r})`
    } else throw new Error(`stepSpell: no spelling for op ${op.type_}`)
  }
  return out
}

/** a pattern's text: `[a b]` in sequence, `[a,b]` stacked */
function printPattern(p: SPattern, sep = ','): string {
  if (p.arguments_.alignment === 'stack') return `[${p.source_.map((l) => printLayer(l)).join(sep)}]`
  if (p.arguments_.alignment === 'fastcat') return `[${printSeq(p.source_ as SElement[])}]`
  throw new Error(`stepSpell: no spelling for ${p.arguments_.alignment}`)
}

/** one layer of a stack: its steps in sequence, no brackets of its own */
function printLayer(l: SElement | SPattern): string {
  if (l.type_ === 'pattern' && l.arguments_.alignment === 'fastcat') return printSeq(l.source_ as SElement[])
  return l.type_ === 'element' ? printElement(l) : printPattern(l)
}

/** steps side by side */
export function printSeq(els: readonly SElement[]): string {
  return els.map((e) => printElement(e)).join(' ')
}

/**
 * One element's text. `HOLD_IS_AT`: a weight is `@k`. A replicate carries its own weight
 * (krill folds `!k` into it), so only weight beyond the copies is written.
 */
export function printElement(e: SElement, chordSep = ','): string {
  const body = e.source_.type_ === 'atom' ? e.source_.source_ : printPattern(e.source_, chordSep)
  const text = printOps(e.options_.ops, body)
  const reps = e.options_.reps
  const held = reps > 1 ? e.options_.weight - reps : e.options_.weight
  if (reps > 1 && held !== 0) throw new Error('stepSpell: a held replicate has no plain spelling')
  return held > 1 || (reps === 1 && held !== 1) ? `${text}@${held}` : text
}

/* ── the builders: which of krill's equivalent nodes to write ─────── */

const atom = (name: string): SAtom => ({ type_: 'atom', source_: name })

/** a note or a rest, by its name as written (`bd`, `bd:4`, `~`), `weight` slots long (`HOLD_IS_AT`) */
export function note(name: string, weight = 1): SElement {
  const [base, ...tails] = name.split(':')
  const ops: SOp[] = tails.map((t) => ({ type_: 'tail', arguments_: { element: atom(t) } }))
  return { type_: 'element', source_: atom(base), options_: { weight, reps: 1, ops } }
}

/** the plain note an element is (name, no ops but `:` tails, one slot, once), or null */
export function plainName(e: SElement): string | null {
  if (e.source_.type_ !== 'atom' || e.options_.weight !== 1 || e.options_.reps !== 1) return null
  if (!e.options_.ops.every((o) => o.type_ === 'tail')) return null
  return printElement(e)
}

/**
 * One step cut into equal parts, `weight` slots long. `EVEN_HITS_ARE_STAR`: k parts all the
 * same note are `x*k`; otherwise `GROUP_IS_SPACED`: `[a b …]`.
 */
export function group(parts: readonly SElement[], weight = 1): SElement {
  const names = parts.map(plainName)
  const first = names[0]
  if (parts.length > 1 && first !== null && first !== REST && names.every((n) => n === first)) {
    const e = note(first, weight)
    e.options_.ops = [...e.options_.ops, { type_: 'stretch', arguments_: { amount: atom(String(parts.length)), type: 'fast' } }]
    return e
  }
  return { type_: 'element', source_: { type_: 'pattern', arguments_: { alignment: 'fastcat', _steps: false }, source_: [...parts] }, options_: { weight, reps: 1, ops: [] } }
}

/**
 * Steps side by side that the edit wrote. `COPIES_FROM_THREE_ARE_BANG`: a run of k ≥ 3 of
 * the same plain note is one `x!k`; shorter runs, and rests (`RESTS_WRITTEN_OUT`), stay as
 * they are.
 */
export function siblings(els: readonly SElement[]): SElement[] {
  // a copy is any step written once with nothing on it — a note, or a group (`[c4 e4]`, the
  // copies of a repeat written out, #2294) — compared by its text
  const key = (e: SElement): string | null =>
    e.options_.weight === 1 && e.options_.reps === 1 && e.options_.ops.every((o) => o.type_ === 'tail') ? printElement(e) : null
  const out: SElement[] = []
  for (let i = 0; i < els.length; ) {
    const n = key(els[i])
    let j = i + 1
    while (n !== null && n !== REST && j < els.length && key(els[j]) === n) j++
    const k = j - i
    if (n !== null && n !== REST && k >= 3) {
      const e: SElement = JSON.parse(JSON.stringify(els[i]))
      e.options_ = { weight: k, reps: k, ops: [...e.options_.ops, { type_: 'replicate', arguments_: { amount: k } }] }
      out.push(e)
    } else out.push(...els.slice(i, j))
    i = j
  }
  return out
}

/** `CHORD_IS_COMMAS`: notes sounding together, one slot */
export function chord(members: readonly string[]): SElement {
  const layer = (m: string): SPattern => ({ type_: 'pattern', arguments_: { alignment: 'fastcat', _steps: false }, source_: [note(m)] })
  return { type_: 'element', source_: { type_: 'pattern', arguments_: { alignment: 'stack' }, source_: members.map(layer) }, options_: { weight: 1, reps: 1, ops: [] } }
}

/** `RESTS_WRITTEN_OUT`: `k` slots of rest, each its own step */
export function rests(k: number): SElement[] {
  return Array.from({ length: k }, () => note(REST))
}

/**
 * `EUCLID_FOR_A_EUCLID_RHYTHM` (#2437): `name(k,n)` — `name(k,n,r)` when the rotation is not
 * 0 — `weight` slots long. Which `k`, `n`, `r` is the caller's: Strudel is asked there.
 */
export function euclid(name: string, k: number, n: number, r: number, weight = 1): SElement {
  const amount = (x: number): SElement => ({ type_: 'element', source_: atom(String(x)), options_: { weight: 1, reps: 1, ops: [] } })
  const e = note(name, weight)
  e.options_.ops = [...e.options_.ops, { type_: 'bjorklund', arguments_: { pulse: amount(k), step: amount(n), rotation: r === 0 ? null : amount(r) } }]
  return e
}

/* ── a written-out generator, spelled again ───────────────────────── */

/** krill's node with its locations taken off: what the printer takes */
const bare = <T>(n: T): T => JSON.parse(JSON.stringify(n, (key, v) => (key === 'location_' ? undefined : v))) as T

/**
 * A step written out from `x*k` (`'star'`, one element `[a b …]@w`) or `x!k` (`'bang'`,
 * copies side by side), then edited, SPELLED AGAIN by the rules above: a group still even
 * folds back to `x*k` (`EVEN_HITS_ARE_STAR`), a run of three or more copies to `x!k`
 * (`COPIES_FROM_THREE_ARE_BANG`). Only this text is read — never a neighbour. Krill reads it.
 */
function respellWrittenOutHere(text: string, kind: 'star' | 'bang'): string {
  const els = (miniTree(text).source_ as KElement[]).map((e) => bare(e) as unknown as SElement)
  if (kind === 'bang') return printSeq(siblings(els))
  if (els.length !== 1) return text
  const e = els[0]
  const src = e.source_
  if (src.type_ !== 'pattern' || src.arguments_.alignment !== 'fastcat' || e.options_.ops.length > 0 || e.options_.reps !== 1) return text
  return printElement(group(src.source_ as SElement[], e.options_.weight))
}

/**
 * The copies of a repeat written out (#2294, a drag across places), one of them changed,
 * SPELLED AGAIN: copies left side by side three or more are `x!k`
 * (`COPIES_FROM_THREE_ARE_BANG`) — `[c4 e4] [c4 e4] [c4 e4] [c4 ~]` → `[c4 e4]!3 [c4 ~]`.
 * `'bang'`: the text is the copies side by side; `'star'`: one step holding them
 * (`[[c4 e4] [c4 ~]]`), its own weight kept. Only this text is read. Krill reads it.
 */
function respellCopiesHere(text: string, kind: 'star' | 'bang'): string {
  const els = (miniTree(text).source_ as KElement[]).map((e) => bare(e) as unknown as SElement)
  if (kind === 'bang') return printSeq(siblings(els))
  if (els.length !== 1) return text
  const e = els[0]
  const src = e.source_
  if (src.type_ !== 'pattern' || src.arguments_.alignment !== 'fastcat' || e.options_.ops.length > 0 || e.options_.reps !== 1) return text
  const inner = `[${printSeq(siblings(src.source_ as SElement[]))}]`
  return e.options_.weight === 1 ? inner : `${inner}@${e.options_.weight}`
}

/** `respellWrittenOutHere`, or the text as it stands where a node in it has no spelling here yet (`<a b>`, `{a b}`): never a guess */
export function respellWrittenOut(text: string, kind: 'star' | 'bang'): string {
  try {
    return respellWrittenOutHere(text, kind)
  } catch {
    return text
  }
}

/** `respellCopiesHere`, or the text as it stands where a node in it has no spelling here yet (`<a b>`, `{a b}`): never a guess */
export function respellCopies(text: string, kind: 'star' | 'bang'): string {
  try {
    return respellCopiesHere(text, kind)
  } catch {
    return text
  }
}

/** a written-out step of one sound and rests: the sound, the step's weight, and which of its places are hits */
export interface WrittenOutRhythm {
  name: string
  weight: number
  hits: boolean[]
}

/**
 * `text` as ONE step `[x ~ ~ x …]` (its `@k` allowed, no other op): every part one plain
 * slot, all of one sound or a rest (`~`, `-`), at least one hit — or null. Krill reads it.
 */
export function writtenOutRhythm(text: string): WrittenOutRhythm | null {
  let els: SElement[]
  try {
    els = (miniTree(text).source_ as KElement[]).map((e) => bare(e) as unknown as SElement)
  } catch {
    return null
  }
  if (els.length !== 1) return null
  const e = els[0]
  const src = e.source_
  if (e.type_ !== 'element' || src.type_ !== 'pattern' || src.arguments_.alignment !== 'fastcat' || e.options_.ops.length > 0 || e.options_.reps !== 1) return null
  let name: string | null = null
  const hits: boolean[] = []
  for (const p of src.source_) {
    const n = p.type_ === 'element' ? plainName(p) : null
    if (n === null) return null
    if (n === REST || n === '-') hits.push(false)
    else if (name === null || n === name) {
      name = n
      hits.push(true)
    } else return null
  }
  return name === null || hits.length < 2 ? null : { name, weight: e.options_.weight, hits }
}

/* ── a `.gain` that mirrors the steps ─────────────────────────────── */

/** the plain text an op argument holds (`8` of `bd(3,8)`), or null for anything else */
function argText(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null
  const n = a as { type_?: string; source_?: unknown }
  if (n.type_ === 'atom' && typeof n.source_ === 'string') return n.source_
  if (n.type_ === 'element') return argText(n.source_)
  return null
}

/** one element of the pattern, every step of it `level`: null where it has no such spelling here */
function mirrorElement(e: SElement, level: string): string | null {
  const src = e.source_
  let body: string | null
  if (src.type_ === 'atom') body = level
  else if (src.arguments_.alignment === 'stack') body = level // a chord sounds once there: one value for all of it
  else {
    const inner = mirrorPattern(src, level)
    if (inner === null) return null
    body = src.arguments_.alignment === 'polymeter_slowcat' ? inner : `[${inner}]`
  }
  let text = body
  for (const op of e.options_.ops) {
    const a = op.arguments_ ?? {}
    if (op.type_ === 'tail' || op.type_ === 'degradeBy') continue // a variant has no level; `?` would drop a level, and the hit with it
    if (op.type_ === 'stretch' && (a.type === 'fast' || a.type === 'slow')) {
      const k = argText(a.amount)
      if (k === null || !/^[0-9]+(\.[0-9]+)?$/.test(k)) return null
      text += (a.type === 'fast' ? '*' : '/') + k
    } else if (op.type_ === 'replicate') text += '!' + String(a.amount)
    else if (op.type_ === 'bjorklund') {
      // every place of the euclid gets its own level, hit or not: a click that fills one is never silenced
      const n = argText(a.step)
      if (n === null || !/^[1-9][0-9]*$/.test(n)) return null
      text += '*' + n
    } else return null
  }
  const reps = e.options_.reps
  const held = reps > 1 ? e.options_.weight - reps : e.options_.weight
  if (reps > 1 && held !== 0) return null
  return held > 1 || (reps === 1 && held !== 1) ? `${text}@${held}` : text
}

/**
 * A pattern's inside, every step `level`: a sequence (`fastcat`), steps split by `.` (`feet`,
 * each foot a sequence), or `<…>` with one layer (`polymeter_slowcat`, returned with its angle
 * brackets). Null for anything else.
 */
function mirrorPattern(p: SPattern, level: string): string | null {
  const a = p.arguments_.alignment
  if (a === 'fastcat') return mirrorSeq(p.source_ as SElement[], level)
  const layers = p.source_ as Array<SElement | SPattern>
  const seqOf = (l: SElement | SPattern): string | null =>
    l.type_ === 'pattern' && l.arguments_.alignment === 'fastcat' ? mirrorSeq(l.source_ as SElement[], level) : null
  if (a === 'feet') {
    const feet = layers.map(seqOf)
    return feet.some((f) => f === null) ? null : feet.join(' . ')
  }
  if (a === 'polymeter_slowcat' && layers.length === 1) {
    const inner = seqOf(layers[0])
    return inner === null ? null : `<${inner}>`
  }
  return null
}

function mirrorSeq(els: readonly SElement[], level: string): string | null {
  const out: string[] = []
  for (const e of els) {
    const t = mirrorElement(e, level)
    if (t === null) return null
    out.push(t)
  }
  return out.join(' ')
}

/**
 * A `.gain` string with the pattern's own steps, each one `level` (#2468, the user's ruling
 * 2026-11-08): `bd [hh hh] sd hh` → `0.5 [0.5 0.5] 0.5 0.5`. Rests take a level too, so a hit
 * a later click adds is never under a gain `~`; a chord is one level, a euclid one per place,
 * a `?` none of its own. Null where the pattern has a part this does not spell (`,` parts side
 * by side, `|`, `{…}`, a pattern as an op's amount): a stack of levels would play each hit once
 * per layer. Krill reads the pattern; whether the levels land on every hit is the caller's to
 * ask of Strudel.
 */
export function gainMirror(mini: string, level: string): string | null {
  try {
    const root = bare(miniTree(mini)) as unknown as SPattern
    // `<…>` at the top is a pattern of its own, not this one's inside
    return root.arguments_.alignment === 'polymeter_slowcat' ? null : mirrorPattern(root, level)
  } catch {
    return null
  }
}
