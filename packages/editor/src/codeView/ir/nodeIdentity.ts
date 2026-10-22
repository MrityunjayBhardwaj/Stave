/**
 * Node identity — content-addressed ids for PatternIR nodes.
 *
 * `irNodeId` is a stable identity for an IR NODE, derived purely from its
 * source span + tag + position (`fnv1a("${start}:${end}:${tag}:${position}")`).
 * It is OUR IR's concern, not Strudel's: a Strudel hap arrives carrying only a
 * source `loc` (the shared join coordinate); the adapter (`normalizeStrudelHap`)
 * stamps `irNodeId` onto each hap by matching its loc against the index this
 * module builds. Strudel has no notion of our nodes, so identity cannot come
 * from the engine — only the join key (`loc`) does.
 *
 * This lived inside `collect.ts` only because collect happened to walk the IR to
 * emit onsets and stamped ids on the way past — co-location by convenience, not
 * by domain. Identity is a STRUCTURAL property (loc + tag), not a behavioural
 * one (onsets / RNG / euclid), so it belongs here alongside `structuralWalk`,
 * computed WITHOUT running the behaviour interpreter.
 *
 * `buildNodeLocIndex` reuses structuralWalk's proven cycle-0 traversal — the
 * same Play leaves `collect(ir)`'s `DEFAULT_CONTEXT` reaches — so the
 * loc→irNodeId lookup the engine feeds to `normalizeStrudelHap` is identical to
 * the collect-derived one it replaces, but no longer depends on collect.
 * Byte-equivalence is pinned by `nodeIdentity.test.ts`.
 */
import type { PatternIR } from './PatternIR'
import type { IREvent } from './IREvent'
import { walkLeafItems } from './structuralWalk'

/**
 * FNV-1a 32-bit hash. Used to derive content-addressed irNodeIds (PV38 D-02).
 * Inputs: `${loc.start}:${loc.end}:${tag}:${position}`.
 *
 * Determinism: pure function, same input → same output.
 * Uniqueness: 32-bit space; corpus-wide collision probability negligible for
 * snapshot-scoped node counts. The uniqueness/lookup-resolves probe in
 * parity.test.ts catches any real-world collision before ship.
 *
 * Why FNV-1a over crypto.subtle.digest: subtle is async; digestSync does not
 * exist; the walk is sync. Why over DJB2: FNV-1a has slightly better avalanche
 * on short keys (the key length here is ~10).
 *
 * Exported as the documentation-grade public surface for the test harness
 * (`fnv1a.test.ts`); production callers go through `assignNodeId` /
 * `buildNodeLocIndex`.
 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime, 32-bit safe via Math.imul
  }
  // >>> 0 forces unsigned 32-bit; toString(16) hex; padStart for stable width.
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The content-addressed id FORMAT — the single definition both `assignNodeId`
 * (collect's Play-leaf stamp) and `buildNodeLocIndex` (the eval-path lookup)
 * derive from, so the two producers cannot drift.
 */
function nodeIdFor(start: number, end: number, tag: string, position: number): string {
  return fnv1a(`${start}:${end}:${tag}:${position}`)
}

/**
 * Compute a stable content-addressed id for an IR node (PV38 clause 1 / D-02).
 * Inputs: `loc[0].start + loc[0].end + tag + position`.
 *
 * Under the leaf-only-assignment scheme (RESEARCH DEC-NEW-1), collect calls
 * this from the Play arm with position=0. A loc-less node (which violates PV36
 * and dev-warns at the collect() boundary) falls back to start=-1, end=-1 so an
 * id is still produced; PV36 enforcement remains the loud gate.
 */
export function assignNodeId(ir: PatternIR, position: number): string {
  const start = ir.loc?.[0]?.start ?? -1
  const end = ir.loc?.[0]?.end ?? -1
  return nodeIdFor(start, end, ir.tag, position)
}

/**
 * Build the loc→irNodeId lookup the engine feeds to `normalizeStrudelHap`
 * (PV38 clause 2). Keyed by each leaf's innermost source span
 * (`${loc[0].start}:${loc[0].end}`); the value is a stub `IREvent` carrying only
 * `loc` + `irNodeId` — the sole fields a matched event contributes downstream
 * (`findMatchedEvent` returns the `begin`-nearest candidate, but every candidate
 * at one key shares a single irNodeId, so `begin` is neutral to the result).
 *
 * All leaf items come from a Play node (`structuralWalk` emits items only at the
 * Play arm), so tag is always 'Play' and position 0 — reproducing collect's
 * `assignNodeId(playNode, 0)` byte-for-byte. Cycle 0 mirrors `collect(ir)`'s
 * `DEFAULT_CONTEXT` (cycle 0 → Every fires, Arrange→arm 0, Cycle→item 0), so the
 * index equals the collect-derived lookup it replaces (`nodeIdentity.test.ts`).
 *
 * collect emits one event per ONSET (many per node) whereas this emits one stub
 * per node VISIT — so a key's candidate array may be shorter here, but its
 * irNodeId is identical, which is all the match projects.
 */
export function buildNodeLocIndex(ir: PatternIR): Map<string, IREvent[]> {
  const map = new Map<string, IREvent[]>()
  for (const item of walkLeafItems(ir, 1)) {
    const loc = item.loc
    if (!loc || loc.length === 0) continue
    const l0 = loc[0]
    if (typeof l0.start !== 'number' || typeof l0.end !== 'number') continue
    const key = `${l0.start}:${l0.end}`
    const stub: IREvent = {
      begin: 0,
      end: 0,
      endClipped: 0,
      note: null,
      freq: null,
      s: null,
      gain: 1,
      velocity: 1,
      color: null,
      loc: [...loc],
      irNodeId: nodeIdFor(l0.start, l0.end, 'Play', 0),
    }
    const arr = map.get(key)
    if (arr) arr.push(stub)
    else map.set(key, [stub])
  }
  return map
}
