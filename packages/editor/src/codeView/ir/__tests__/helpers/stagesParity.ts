/**
 * stagesParity — what is left of the staged-pipeline parity helpers (#1375),
 * after #1387 removed the staged pipeline.
 *
 * `pipeline` used to run the four hand-kept `run*Stage` passes, and every parity
 * arm compared it with `parseStrudel`. It is now the Inspector's CHAIN-APPLIED
 * view — `parseStrudel` through its RECORDING path — so those arms still run,
 * and what a mismatch would now catch is recording changing the parse.
 */
import type { PatternIR } from '../../PatternIR'
import { parseStrudelStages } from '../../parseStrudelStages'

/** The Inspector's CHAIN-APPLIED view: `parseStrudel` via `parseStrudelRecorded`. */
export function pipeline(code: string): PatternIR {
  const stages = parseStrudelStages(code)
  return stages[stages.length - 1].ir
}

/**
 * Strip stage-transition metadata so the two sides are comparable.
 *
 * The staged pipeline threads `unresolvedChain`/`chainOffset` (chain deferral)
 * and `dollarStart`/`dollarEnd`/`trackLabel` (#671 track-loc + label) between
 * stages. `parseStrudel` never emits them, so they are removed before any
 * equality check. `assertNoStageMeta` separately proves they are ABSENT from
 * CHAIN-APPLIED and FINAL — this strip is for the intermediate comparison and
 * must not be read as tolerating them at the end.
 */
export function stripStageMeta(node: PatternIR): PatternIR {
  const rec = node as Record<string, unknown>
  const cloned: Record<string, unknown> = {}
  for (const k of Object.keys(rec)) {
    if (
      k === 'unresolvedChain' ||
      k === 'chainOffset' ||
      k === 'dollarStart' ||
      k === 'dollarEnd' ||
      k === 'trackLabel'
    ) {
      continue
    }
    cloned[k] = rec[k]
  }
  switch (node.tag) {
    case 'Seq':
      cloned.children = node.children.map(stripStageMeta)
      break
    case 'Stack':
      cloned.tracks = node.tracks.map(stripStageMeta)
      break
    case 'Cycle':
      cloned.items = node.items.map(stripStageMeta)
      break
    case 'Choice':
      cloned.then = stripStageMeta(node.then)
      cloned.else_ = stripStageMeta(node.else_)
      break
    case 'Every':
      cloned.body = stripStageMeta(node.body)
      if (node.default_) cloned.default_ = stripStageMeta(node.default_)
      break
    case 'When':
    case 'Ramp':
    case 'Fast':
    case 'Slow':
    case 'Elongate':
    case 'Late':
    case 'Degrade':
    case 'Ply':
    case 'Struct':
    case 'Swing':
    case 'Shuffle':
    case 'Scramble':
    case 'Chop':
    case 'Loop':
      cloned.body = stripStageMeta(node.body)
      break
    case 'Param':
      cloned.body = stripStageMeta(node.body)
      if (typeof node.value === 'object' && node.value !== null) {
        cloned.value = stripStageMeta(node.value as PatternIR)
      }
      break
    case 'Track':
      cloned.body = stripStageMeta(node.body)
      break
    case 'Chunk':
      cloned.transform = stripStageMeta(node.transform)
      cloned.body = stripStageMeta(node.body)
      break
    case 'Pick':
      cloned.selector = stripStageMeta(node.selector)
      cloned.lookup = node.lookup.map(stripStageMeta)
      break
    default:
      break
  }
  return cloned as PatternIR
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const k of keys) {
    if (ra[k] === undefined && rb[k] === undefined) continue
    if (!deepEqual(ra[k], rb[k])) return false
  }
  return true
}


// ---------------------------------------------------------------------------
// Divergence classification (#1375 step 1)
// ---------------------------------------------------------------------------

/** Named child slots, so a divergence can be reported at a readable path. */
function childSlots(n: PatternIR): [string, PatternIR][] {
  const N = n as unknown as Record<string, unknown>
  switch (n.tag) {
    case 'Seq':   return n.children.map((c, i) => [`children[${i}]`, c])
    case 'Stack': return n.tracks.map((c, i) => [`tracks[${i}]`, c])
    case 'Cycle': return n.items.map((c, i) => [`items[${i}]`, c])
    case 'Choice': return [['then', n.then], ['else_', n.else_]]
    case 'Every': return n.default_ ? [['body', n.body], ['default_', n.default_]] : [['body', n.body]]
    case 'When': case 'Ramp': case 'Fast': case 'Slow': case 'Elongate':
    case 'Late': case 'Degrade': case 'Ply': case 'Struct': case 'Swing':
    case 'Shuffle': case 'Scramble': case 'Chop': case 'Loop': case 'Track':
      return [['body', n.body]]
    case 'Param':
      return typeof N.value === 'object' && N.value !== null
        ? [['body', n.body], ['value', N.value as PatternIR]]
        : [['body', n.body]]
    case 'Chunk': return [['transform', n.transform], ['body', n.body]]
    case 'Pick':  return [['selector', n.selector], ...n.lookup.map((c, i) => [`lookup[${i}]`, c] as [string, PatternIR])]
    default: return []
  }
}

export type DivergenceKind =
  | { kind: 'none' }
  | { kind: 'tag'; path: string; a: string; b: string }
  | { kind: 'arity'; path: string; a: number; b: number }
  | { kind: 'field'; path: string; fields: string[] }

/**
 * The FIRST point at which the two trees disagree, depth-first, scalar fields
 * before children.
 *
 * Reports EVERY differing field at that node, not just one. Reporting only the
 * first understated this badly: the 16 documents in class C differ in
 * `code` AND `loc` AND `via` at once, and seeing only `code` made them look
 * like cosmetic text noise when they are nothing of the kind.
 */
export function firstDivergence(a: PatternIR, b: PatternIR, path = '$'): DivergenceKind {
  if (a.tag !== b.tag) return { kind: 'tag', path, a: a.tag, b: b.tag }
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const kidsA = childSlots(a)
  const kidsB = childSlots(b)
  const childKeys = new Set([...kidsA, ...kidsB].map(([k]) => k.replace(/\[\d+\]$/, '')))
  const fields: string[] = []
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'tag' || childKeys.has(k)) continue
    if (ra[k] === undefined && rb[k] === undefined) continue
    if (!deepEqual(ra[k], rb[k])) fields.push(k)
  }
  if (fields.length > 0) return { kind: 'field', path, fields: fields.sort() }
  if (kidsA.length !== kidsB.length) return { kind: 'arity', path, a: kidsA.length, b: kidsB.length }
  for (let i = 0; i < kidsA.length; i++) {
    const d = firstDivergence(kidsA[i][1], kidsB[i][1], `${path}.${kidsA[i][0]}`)
    if (d.kind !== 'none') return d
  }
  return { kind: 'none' }
}

/**
 * The four mechanisms behind the 44, measured (#1375 step 1) — NOT guessed.
 *
 *   A-opaque-collapse   the pipeline replaces a real subtree with opaque `Code`
 *   B-track-count       the two sides disagree on how many tracks exist, at the root
 *   C-via-vs-blob       both emit `Code`, but one carries a structured `via` + a
 *                       narrow `loc` and the other carries raw text
 *   D-metadata          `loc`/`trackId` only
 *
 * ⚠ C is the one to distrust most. Those documents AGREE on shape, so the
 * structural check calls them identical — while `0/-1j62z5xjyCN`'s direct node
 * describes a 9-character span and its staged node describes all 1912. A
 * structural comparison cannot see a 200x difference in what a node covers.
 */
export function classifyDivergence(d: DivergenceKind): string {
  switch (d.kind) {
    case 'none':  return ''
    case 'arity': return 'B-track-count'
    case 'tag':   return d.b === 'Code' ? 'A-opaque-collapse'
                       : d.a === 'Code' ? 'A-opaque-collapse-inverted'
                       : 'B-track-count'
    case 'field': return d.fields.includes('via') ? 'C-via-vs-blob' : 'D-metadata'
  }
}
