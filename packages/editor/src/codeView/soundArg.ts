/**
 * soundArg.ts — what a `.sound(…)` / `.s(…)` / `.bank(…)` argument names, and the
 * one edit a sound pick may make to it (#2226).
 *
 * ── WHY THE STRING IS NOT THE NAME ──────────────────────────────────────────
 * Every string Strudel reifies is read as mini notation: the transpiler rewrites
 * double-quoted and template strings, and `installMiniStringParser`
 * (`engine/stringParser.ts`) sends every other string through `mini`, falling back
 * to the plain value only when it does not parse. So
 * `.sound("piano gm_electric_guitar_muted")` is not one sound with a long name: it
 * is a pattern that plays piano for the first half of the bar and the guitar for
 * the second. The quote style changes nothing here.
 *
 * Read as one name, a pattern was shown as the raw string and, worse, replaced
 * whole by the next pick, which threw away code the user wrote. So the argument
 * is read by krill (through the adapter), and a pick writes only what it may:
 *
 *  - ONE plain name (a bare atom, or a string that is not notation) → the pick
 *    replaces the literal, exactly as before;
 *  - one name, written as a pattern (`"piano*2"`, `"<piano ~>"`, `"piano:2"`) →
 *    the pick renames that name where it is written and keeps everything else;
 *  - SEVERAL names → no single pick can mean "replace them all", so nothing is
 *    written and the caller says why.
 *
 * This module is pure.
 */
import { miniShape, isRest, type MiniGroup, type MiniSpan } from './strudelMini/shape'
import type { ChunkInfo } from './chunkDetect'
import { readChainMethod } from './chainMethod'
import type { OffsetEdit } from './writeback'

export type SoundArg =
  /** one plain name; `name` is what plays */
  | { kind: 'one'; name: string }
  /**
   * A pattern. `names` are the distinct names it plays, in written order; `spans`
   * are where each name is written, in the literal's body (inside the quotes).
   * `alternates` is a whole-argument `<…>`: one name per bar, in turn.
   */
  | { kind: 'pattern'; names: string[]; spans: MiniSpan[]; alternates: boolean }

/** every name atom under `g`, rests excluded; op arguments (`*2`, `:3`, `(3,8)`) are not names */
export function nameAtoms(g: MiniGroup, out: { text: string; span: MiniSpan }[]): void {
  for (const c of g.children) {
    if (c.kind === 'group') nameAtoms(c, out)
    else if (c.content.kind === 'group') nameAtoms(c.content, out)
    else if (!isRest(c.content)) out.push({ text: c.content.text, span: c.content.span })
  }
}

/** the root's one element, when the root is a sequence of exactly one */
function soleElement(root: MiniGroup) {
  const only = root.children.length === 1 ? root.children[0] : null
  return root.alignment === 'fastcat' && only?.kind === 'element' ? only : null
}

/**
 * What `body` — a sound argument's text inside its quotes — names.
 *
 * A body krill rejects is not notation, and plays as itself (`engine/stringParser.ts`
 * falls back to the plain value), so it is one name. So is a body with no name in it
 * (`""`, `"~"`): there is nothing a pick could lose.
 */
export function readSoundArg(body: string): SoundArg {
  let root: MiniGroup
  try {
    root = miniShape(body)
  } catch {
    return { kind: 'one', name: body }
  }
  const sole = soleElement(root)
  if (
    sole &&
    sole.content.kind === 'atom' &&
    sole.ops.length === 0 &&
    sole.weight === 1 &&
    sole.reps === 1
  ) {
    return { kind: 'one', name: sole.content.text }
  }
  const atoms: { text: string; span: MiniSpan }[] = []
  nameAtoms(root, atoms)
  if (atoms.length === 0) return { kind: 'one', name: body }
  const names = [...new Set(atoms.map((a) => a.text))]
  const alternates = !!sole && sole.content.kind === 'group' && sole.content.alignment === 'polymeter_slowcat'
  return { kind: 'pattern', names, spans: atoms.map((a) => a.span), alternates }
}

/**
 * The playing `.sound`-style call's argument, read: null when the call is absent or
 * its argument is not a plain string (a signal, an expression) — the same cases
 * `readChainMethod` returns null for.
 */
export function readSoundCall(chunk: ChunkInfo, names: readonly string[]): SoundArg | null {
  const cur = readChainMethod(chunk, names)
  return cur ? readSoundArg(cur.value) : null
}

/**
 * What the picker shows for an argument: the name, or for a pattern of several,
 * how many and which (`2 sounds: piano, gm_electric_guitar_muted`; `alternates: …`
 * for a `<…>`). `noun` is the singular the picker counts in (`sound`, `kit`).
 */
export function soundArgLabel(arg: SoundArg, noun: string): string {
  if (arg.kind === 'one') return arg.name
  if (arg.names.length === 1) return arg.names[0]
  const list = arg.names.join(', ')
  return arg.alternates ? `alternates: ${list}` : `${arg.names.length} ${noun}s: ${list}`
}

/** Why a pick may not write here, or null when it may. */
export function soundPickRefusal(arg: SoundArg | null, noun: string): string | null {
  if (!arg || arg.kind === 'one' || arg.names.length === 1) return null
  return (
    `This ${noun} is a pattern of ${arg.names.length} ${noun}s (${arg.names.join(', ')}). ` +
    `Picking one would replace them all, so change it in the code.`
  )
}

export type SoundPickEdit = { edit: OffsetEdit } | { refused: string }

/**
 * The edit a pick of `value` makes to the chunk's `.sound`-style call:
 *  - no plain-string call → append `.canonical('value')`, as before;
 *  - one plain name → replace the literal with `'value'`, as before (single-quoted:
 *    an id must stay a string — a name like `my kick` is not one mini atom);
 *  - one name in a pattern → rename it at each place it is written, quotes and the
 *    rest of the pattern untouched. Refused when `value` would not read back as one
 *    name in notation (`my kick` reads as two);
 *  - several names → refused.
 * Absent `value` (the empty "Default" pick) writes nothing; that is the caller's.
 */
export function soundPickEdit(
  fresh: ChunkInfo,
  names: readonly string[],
  canonical: string,
  value: string,
  noun: string,
): SoundPickEdit {
  const cur = readChainMethod(fresh, names)
  if (!cur) {
    const end = fresh.exprRange[1]
    return { edit: { range: [end, end], text: `.${canonical}('${value}')` } }
  }
  const arg = readSoundArg(cur.value)
  if (arg.kind === 'one') return { edit: { range: cur.range, text: `'${value}'` } }
  const refused = soundPickRefusal(arg, noun)
  if (refused) return { refused }
  const asAtom = readSoundArg(value)
  if (asAtom.kind !== 'one' || asAtom.name !== value) {
    return {
      refused: `"${value}" can't be written inside this ${noun}'s pattern as it stands, so change it in the code.`,
    }
  }
  // splice right to left so earlier spans keep their offsets
  let body = cur.value
  for (const s of [...arg.spans].sort((a, b) => b.start - a.start)) {
    body = body.slice(0, s.start) + value + body.slice(s.end)
  }
  // the literal's own quotes stay: only the body between them is rewritten
  return { edit: { range: [cur.range[0] + 1, cur.range[1] - 1], text: body } }
}

