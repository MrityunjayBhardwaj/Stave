/**
 * Strudel's own parse of a mini-notation string (#1971, part of #1869, epic #1007).
 *
 * The grammar is STRUDEL'S, so we ask Strudel for it: `@strudel/mini`'s krill parser,
 * the one the transpiler runs. This file and `./pattern.ts` are the only product code
 * that imports `@strudel/mini` — the boundary test (`modellingRatchet/boundary.ts`)
 * fails on any other file that does. Before this, eight places called the parser
 * themselves, each with its own copy of the two rules below.
 *
 * THE TWO RULES A CALLER NO LONGER KNOWS:
 *   1. krill wants the string QUOTED — the transpiler's own call shape.
 *   2. so every offset krill reports counts the opening quote. `miniTree` takes it
 *      back off: a `location_` here is in the coordinates of the string it was given.
 *
 * ⚠ WHY THIS IS A SEPARATE FILE FROM `./pattern.ts`: `ir/parseMini.ts` is in the
 * engine's import graph (through `ir/parseStrudel.ts`), and the engine loads
 * `@strudel/core` itself, later and dynamically. The evaluator (`mini.mjs`) imports
 * `@strudel/core` at load. So this file imports the parser and NOTHING ELSE; a test
 * keeps it that way.
 *
 * The nodes' FIELDS are read in this directory and nowhere else (#1972): `./shape.ts`
 * hands the same tree back as plain nodes, and that is what a caller walks. The raw tree
 * below is still exported for one caller — the old syntactic reader in
 * `notation/parse.ts`, listed function by function in `boundary.exceptions.json` until
 * #1012 deletes it.
 */
import { parse as krillParse } from '@strudel/mini/krill-parser.js'

// ---------------------------------------------------------------------------
// krill's nodes — dumped from `@strudel/mini@1.2.6`, not read off the grammar. The
// accessors are easy to get wrong: `bd:3` is NOT an atom named "bd:3", it is atom
// `bd` carrying a `tail` op. The tree is uniformly recursive — `pattern > element >
// (atom | pattern)` — and `weight`/`reps`/`ops` are fields on EVERY element.
// `notation/__tests__/krillContract.test.ts` pins the shape against the real parser.
// ---------------------------------------------------------------------------

/** where a node's text is, as offsets into the string `miniTree` was given */
export interface KLoc {
  start: { offset: number }
  end: { offset: number }
}
export interface KAtom {
  type_: 'atom'
  source_: string
  location_?: KLoc
}
export interface KOp {
  type_: string
  arguments_?: Record<string, unknown>
}
export interface KElement {
  type_: 'element'
  source_: KAtom | KPattern
  options_?: { weight?: number; reps?: number; ops?: KOp[] }
  /**
   * Every element carries one, and the element spans TILE the source
   * (`bd hh*2 sd cp` → `"bd "`, `"hh*2 "`, `"sd "`, `"cp"` — contiguous,
   * reconstructing the input byte-for-byte). That tiling is what makes span
   * surgery possible: the writer copies unedited regions through verbatim.
   * The padding lands on EITHER side by syntax, so a tight token span is derived
   * from the start, never copied from the end.
   */
  location_?: KLoc
}
export interface KPattern {
  type_: 'pattern'
  arguments_?: { alignment?: string }
  source_: KElement[]
}

/**
 * Take the opening quote off every offset in the tree. A location can sit at any
 * depth — an op's argument is a node too (`bd:3`'s tail, a euclid's three numbers,
 * `*<2 3>`'s amount) — so this walks every object rather than the three node kinds.
 * Each location is replaced by a new `{ start, end }` holding offsets alone: krill's
 * `line` and `column` count the quote as well, and nothing here corrects them.
 */
function unquoteOffsets(node: unknown): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) unquoteOffsets(child)
    return
  }
  const rec = node as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key !== 'location_') {
      unquoteOffsets(rec[key])
      continue
    }
    const loc = rec[key] as { start?: { offset?: unknown }; end?: { offset?: unknown } } | undefined
    if (typeof loc?.start?.offset === 'number' && typeof loc.end?.offset === 'number') {
      rec[key] = { start: { offset: loc.start.offset - 1 }, end: { offset: loc.end.offset - 1 } } satisfies KLoc
    }
  }
}

/**
 * krill's tree for `mini`, with every offset in `mini`'s own coordinates.
 *
 * THROWS what krill throws: a string krill rejects means something different to each
 * caller (a view's refusal, an opaque IR node, "not this shape"), so the catch stays
 * with the caller. The string is parsed exactly as given — trimming is the caller's,
 * because the offsets are into what was passed.
 */
export function miniTree(mini: string): KPattern {
  const ast = krillParse('"' + mini + '"') as KPattern
  unquoteOffsets(ast)
  return ast
}

/** one step of a row to mark: which child, the marker's text, and whether its ops stay */
export interface StepMark {
  child: number
  marker: string
  keepOps: boolean
}

/**
 * MARK the steps of one row of a krill tree, IN PLACE (#1833): each listed child element
 * has its content replaced by an atom named `marker`, and — unless `keepOps` — its ops
 * taken off. Weights are left alone, so the marker sits exactly where the written step
 * sat. Strudel evaluates the result (`./pattern.ts` `markedPattern`); nothing here
 * decides where anything plays.
 *
 * `path` walks from the root to the row: each index picks a child of the group in hand;
 * a group child IS the next group, an element child means the group it holds. Offsets
 * are not touched, so the tree may be the quoted or the unquoted parse.
 *
 * THROWS when the path or a mark does not name what it should — a caller's bug, not a
 * property of the pattern.
 */
export function markSteps(root: KPattern, path: readonly number[], marks: readonly StepMark[]): void {
  const kids = (g: KPattern): Array<KElement | KPattern> =>
    (g.source_ as unknown[]).filter((k): k is KElement | KPattern => !!k && typeof k === 'object' && !Array.isArray(k))
  let row = root
  for (const i of path) {
    const child = kids(row)[i]
    if (child?.type_ === 'pattern') row = child
    else if (child?.type_ === 'element' && child.source_.type_ === 'pattern') row = child.source_
    else throw new Error(`markSteps: no group at ${path.join('.')}`)
  }
  for (const mark of marks) {
    const el = kids(row)[mark.child]
    if (el?.type_ !== 'element') throw new Error(`markSteps: no step ${mark.child} at ${path.join('.')}`)
    el.source_ = { type_: 'atom', source_: mark.marker, location_: el.location_ ?? { start: { offset: 0 }, end: { offset: 0 } } }
    if (!mark.keepOps && el.options_) el.options_ = { ...el.options_, ops: [] }
  }
}
