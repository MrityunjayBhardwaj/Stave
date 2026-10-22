/**
 * The shape of a mini-notation string, in our own words (#1972, part of #1869, epic #1007).
 *
 * `./tree.ts` returns Strudel's own parse; its nodes are krill's, with krill's field
 * names. This file reads those fields ONCE and hands back the same tree as plain nodes
 * — atom, element, group, op — so a caller asks "what is here and where" without
 * knowing how krill spells it. Nothing is worked out: no timing, no meaning, no
 * defaults beyond the two krill itself implies (a weight and a repeat count of 1).
 *
 * WHY IT EXISTS: as long as any file can read a krill field, the next feature can work
 * out what the notation means in that file. The boundary test
 * (`modellingRatchet/boundary.ts`) fails on a krill field read outside this directory;
 * the one exception is the old syntactic reader in `notation/parse.ts`, listed by
 * function and due to be deleted (#1012).
 *
 * ⚠ LIKE `./tree.ts`, THIS FILE MUST NOT LOAD THE EVALUATOR: `ir/parseMini.ts` walks this
 * shape and is in the engine's import graph. It imports `./tree` and nothing else.
 *
 * WHAT KRILL'S TREE LOOKS LIKE (dumped from `@strudel/mini@1.2.6`), and so what this is:
 *   - a pattern whose alignment is `fastcat` holds ELEMENTS; every other alignment
 *     (`polymeter_slowcat` for `<…>`, `stack` for `,`, `rand` for `|`, `polymeter` for
 *     `{…}`, `feet` for `.`) holds PATTERNS, one per layer. Both are `children` here,
 *     told apart by `kind`.
 *   - an element holds an atom or a pattern, a weight, a repeat count and ops.
 *   - a polymeter written `{…}%n` keeps its step count on the pattern itself, beside
 *     the alignment — `steps` here.
 *   - an op's arguments are atoms (`*2`, `:3`), patterns (`*<2 3>`), elements holding
 *     either (a euclid's numbers), or plain values (`!3`'s count, a stretch's
 *     `'fast'` / `'slow'`).
 */
import { miniTree, type KLoc } from './tree'

/** where something is, as offsets into the string `miniShape` was given */
export interface MiniSpan {
  start: number
  end: number
}

export interface MiniAtom {
  kind: 'atom'
  /** the atom's own text: `bd`, `~`, `0.25` */
  text: string
  /**
   * The atom's TIGHT span. krill's own start can sit on the padding before the token
   * (it lands on either side by syntax), so the token is found from the first non-space
   * at or after it and is as long as its text. An atom krill gave no place counts from 0.
   */
  span: MiniSpan
}

export interface MiniElement {
  kind: 'element'
  content: MiniAtom | MiniGroup
  /**
   * krill's span for the element, padding included — the element spans of a sequence
   * TILE its text, which is what lets a writer copy unedited regions through verbatim.
   * `null` when krill gave none.
   */
  span: MiniSpan | null
  /** `@n` / `_` — 1 when unwritten */
  weight: number
  /** `!n` / a bare `!` — 1 when unwritten */
  reps: number
  /** in written order */
  ops: MiniOp[]
}

export interface MiniGroup {
  kind: 'group'
  /** krill's name for how the children share time; `fastcat` is a plain sequence */
  alignment: string | undefined
  /** elements under `fastcat`, one group per layer under everything else */
  children: (MiniElement | MiniGroup)[]
  /**
   * `{…}%n`'s step count — krill keeps it on the group, not in an op. `null` wherever
   * none is written, which is every group that is not a polymeter and most that are.
   */
  steps: MiniArg
}

/** an op's argument: a node, a plain value, or nothing */
export type MiniArg = MiniAtom | MiniElement | MiniGroup | string | number | boolean | null

export interface MiniOp {
  /** krill's name: `stretch`, `replicate`, `bjorklund`, `tail`, `degradeBy`, `range` */
  kind: string
  /**
   * By krill's argument name. A name krill does not give this op is ABSENT (asking a
   * `tail` for its `amount` is undefined); an argument krill lists and the author left
   * out is null (a euclid's `rotation`, a bare `?`'s `amount`).
   */
  args: Partial<Record<string, MiniArg>>
}

/** the atom an argument IS, or the atom the element it is holds; null for anything else */
export function argAtom(arg: MiniArg | undefined): MiniAtom | null {
  if (!arg || typeof arg !== 'object') return null
  if (arg.kind === 'atom') return arg
  return arg.kind === 'element' && arg.content.kind === 'atom' ? arg.content : null
}

/** `~` or `-`: the two ways to write silence */
export const isRest = (a: MiniAtom): boolean => a.text === '~' || a.text === '-'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

function firstNonSpace(mini: string, from: number): number {
  let i = from
  while (i < mini.length && /\s/.test(mini[i])) i++
  return i
}

const spanOf = (loc: unknown): MiniSpan | null => {
  const l = loc as KLoc | undefined
  return typeof l?.start?.offset === 'number' && typeof l.end?.offset === 'number'
    ? { start: l.start.offset, end: l.end.offset }
    : null
}

function atomOf(raw: Raw, mini: string): MiniAtom {
  const text = raw.source_ as string
  const start = firstNonSpace(mini, spanOf(raw.location_)?.start ?? 0)
  return { kind: 'atom', text, span: { start, end: start + text.length } }
}

function groupOf(raw: Raw, mini: string): MiniGroup {
  const args = raw.arguments_ as { alignment?: string; stepsPerCycle?: unknown } | undefined
  const kids = Array.isArray(raw.source_) ? raw.source_ : []
  return {
    kind: 'group',
    alignment: args?.alignment,
    children: kids.filter(isObj).map((k) => (k.type_ === 'element' ? elementOf(k, mini) : groupOf(k, mini))),
    steps: argOf(args?.stepsPerCycle, mini),
  }
}

function elementOf(raw: Raw, mini: string): MiniElement {
  const inner = raw.source_
  const options = raw.options_ as { weight?: number; reps?: number; ops?: Raw[] } | undefined
  return {
    kind: 'element',
    content: isObj(inner) && inner.type_ === 'atom' ? atomOf(inner, mini) : groupOf(isObj(inner) ? inner : {}, mini),
    span: spanOf(raw.location_),
    weight: options?.weight ?? 1,
    reps: options?.reps ?? 1,
    ops: (options?.ops ?? []).map((op) => opOf(op, mini)),
  }
}

function argOf(raw: unknown, mini: string): MiniArg {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw
  if (!isObj(raw)) return null
  if (raw.type_ === 'atom') return atomOf(raw, mini)
  if (raw.type_ === 'element') return elementOf(raw, mini)
  if (raw.type_ === 'pattern') return groupOf(raw, mini)
  return null
}

function opOf(raw: Raw, mini: string): MiniOp {
  const args: MiniOp['args'] = {}
  for (const [name, value] of Object.entries((raw.arguments_ as Raw | undefined) ?? {})) args[name] = argOf(value, mini)
  return { kind: raw.type_ as string, args }
}

/**
 * The shape of `mini`: its root group, every span in `mini`'s own coordinates.
 *
 * THROWS what krill throws, like `miniTree` — a string krill rejects means something
 * different to each caller. The string is read exactly as given, never trimmed.
 */
export function miniShape(mini: string): MiniGroup {
  return groupOf(miniTree(mini) as unknown as Raw, mini)
}
