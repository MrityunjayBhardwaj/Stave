/**
 * Regression gate for the node-identity extraction (#975/#982).
 *
 * `buildNodeLocIndex` is the source of the loc→irNodeId map `normalizeStrudelHap`
 * reads to enrich haps (it replaced the engine's retired propagate→collect→
 * loc-lookup). With collect now deleted, its output is FROZEN as a committed
 * snapshot: for a corpus spanning the IR's node variety, the loc→irNodeId
 * projection of `buildNodeLocIndex(ir)` must match the snapshot — the values are
 * the same collect-equivalent ids the byte-identical gate used to compare
 * against, now pinned directly.
 *
 * Why the projection is the full observable: `normalizeStrudelHap` reads ONLY
 * `.irNodeId` from a matched event, and `findMatchedEvent` keys on `loc[0]` then
 * tie-breaks by `begin` among candidates that all share one irNodeId — so the
 * loc→irNodeId projection is the sole observable the lookup contributes. The
 * projection is pure over the parsed IR (no Strudel eval), so the gate is
 * hermetic and deterministic.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { buildNodeLocIndex, fnv1a } from '../nodeIdentity'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import type { PatternIR } from '../PatternIR'

/** The lookup, projected to key → irNodeId. */
function indexProjection(ir: PatternIR): Map<string, string> {
  const m = new Map<string, string>()
  for (const [key, evs] of buildNodeLocIndex(ir)) {
    const id = evs[0]?.irNodeId
    if (id) m.set(key, id)
  }
  return m
}

// Corpus spanning the IR node variety that carries Play leaves with loc:
// plain notes, drum stacks, fast/slow, euclid, <> cycles, arrange clips,
// multi-track $:, degrade (RNG), chords, nested stacks, scales, elongation,
// chop, every, replicate, chained transforms.
const CORPUS: readonly string[] = [
  'note("c3 e3 g3 a3")',
  's("bd hh sd hh")',
  's("bd*2 hh")',
  's("bd(3,8)")',
  's("bd(3,8,2)")',
  'note("<c e g>")',
  'stack(s("bd sd"), s("hh*4"))',
  'stack(s("bd sd"), stack(s("hh*2"), s("oh")))',
  's("bd sd").every(2, fast(2))',
  's("bd sd").degradeBy(0.5)',
  's("bd hh sd cp").degrade()',
  'arrange([1, s("bd*4")], [1, s("sd*2")])',
  '$: s("bd sd")\n$: note("c e g")',
  'n("0 2 4").scale("C:major")',
  's("[bd,hh]")',
  'note("c@3 e")',
  's("bd sd hh cp").chop(2)',
  's("bd!3 sd")',
  's("bd sd").slow(2)',
  's("hh*8").jux(rev)',
  's("bd sd hh").off(0.125, x => x.fast(2))',
  'note("c e g").add("12")',
  's("bd <sd cp> hh")',
  'sound("bd*4, hh*8, ~ sd ~ sd")',
]

/** Canonical (key-sorted) plain-object view of the loc→irNodeId projection, for
 *  a stable committed snapshot. */
function canonProjection(ir: PatternIR): Record<string, string> {
  return Object.fromEntries([...indexProjection(ir)].sort((a, b) => a[0].localeCompare(b[0])))
}

describe('buildNodeLocIndex loc→irNodeId projection is frozen over the corpus (#975/#982)', () => {
  // The load-bearing property: NO hap loses its irNodeId and NO hap's irNodeId
  // changes across the IR's node variety. The projection is frozen as a
  // committed snapshot (the values are the collect-equivalent ids the retired
  // byte-identical gate compared against); a drift in any leaf's span or the id
  // format turns the snapshot RED.
  for (const code of CORPUS) {
    it(`freezes node ids for: ${code.replace(/\n/g, ' \\n ')}`, () => {
      expect(canonProjection(parseStrudel(code))).toMatchSnapshot()
    })
  }

  it('decouples identity from behaviour — every degrade leaf gets a stable structural id', () => {
    // The extraction removes node-identity's entanglement with the RNG: the
    // structural index gives EVERY real leaf its canonical id regardless of any
    // probabilistic gating, so a leaf a cycle-0 RNG would have dropped is still
    // identifiable (breakpointable / pulsable). This is the improvement the
    // domain-correct home enables — no behaviour interpreter, no RNG dependence.
    const proj = indexProjection(parseStrudel('s("bd sd").degradeBy(0.5)'))
    // Both source leaves (bd, sd) always carry a stable, distinct id.
    expect(proj.size).toBeGreaterThanOrEqual(2)
    expect(new Set(proj.values()).size).toBe(proj.size)
  })

  it('is non-vacuous — a multi-leaf pattern yields multiple distinct ids', () => {
    // Guards against the gate passing on two empty maps: a real pattern must
    // produce several keys with pairwise-distinct ids (distinct source spans).
    const ir = parseStrudel('note("c3 e3 g3 a3")')
    const proj = indexProjection(ir)
    expect(proj.size).toBeGreaterThanOrEqual(4)
    expect(new Set(proj.values()).size).toBe(proj.size)
  })

  it('end-to-end — a hap at a leaf span is enriched with that leaf’s irNodeId', () => {
    // The live observable: the engine builds `buildNodeLocIndex(ir)` and feeds it
    // to `normalizeStrudelHap`, which stamps `irNodeId` onto each queryArc hap by
    // matching its `context.locations` against the index. This drives that exact
    // chain with the REAL index (not a hand-built lookup) and observes the id the
    // adapter attaches — proving the enrichment, not inferring it from the lookup.
    const ir = parseStrudel('s("bd sd")')
    const lookup = buildNodeLocIndex(ir)
    // The `bd` leaf sits at source span 3:5 (inside `s("bd sd")`).
    const bdHap = {
      whole: { begin: 0, end: 0.5 },
      value: { s: 'bd' },
      context: { locations: [{ start: 3, end: 5 }] },
    }
    const enriched = normalizeStrudelHap(bdHap, undefined, lookup)
    expect(enriched.irNodeId).toBe(fnv1a('3:5:Play:0'))
    // A hap whose loc matches no leaf gets no id (PV37 — no fallback ladder).
    const orphan = normalizeStrudelHap(
      { whole: { begin: 0, end: 0.5 }, value: { s: 'x' }, context: { locations: [{ start: 900, end: 902 }] } },
      undefined,
      lookup,
    )
    expect(enriched.irNodeId).toBeTruthy()
    expect(orphan.irNodeId).toBeUndefined()
  })

  it('discriminates — a corrupted leaf loc changes the id (the gate can fail)', () => {
    // Proves the equivalence assertion is load-bearing: perturbing a leaf's loc
    // must change its computed id, so a real drift would turn the gate RED.
    const ir = parseStrudel('s("bd sd")')
    const before = indexProjection(ir)
    const firstLeaf = findFirstPlay(ir)
    expect(firstLeaf?.loc?.[0]).toBeTruthy()
    firstLeaf!.loc![0] = { start: firstLeaf!.loc![0].start + 999, end: firstLeaf!.loc![0].end + 999 }
    const after = indexProjection(ir)
    expect([...after.values()].sort()).not.toEqual([...before.values()].sort())
  })
})

/** Depth-first: the first Play node carrying a loc, for the discrimination probe. */
function findFirstPlay(node: PatternIR): PatternIR | null {
  if (node.tag === 'Play' && node.loc && node.loc.length > 0) return node
  for (const child of childrenOf(node)) {
    const hit = findFirstPlay(child)
    if (hit) return hit
  }
  return null
}

/** Enumerate a node's child PatternIRs across every child-bearing field. */
function childrenOf(node: PatternIR): PatternIR[] {
  const n = node as unknown as Record<string, unknown>
  const out: PatternIR[] = []
  const push = (v: unknown) => {
    if (v && typeof v === 'object' && 'tag' in (v as Record<string, unknown>)) out.push(v as PatternIR)
  }
  for (const key of ['body', 'then', 'else_', 'default_', 'transform', 'selector']) push(n[key])
  for (const key of ['children', 'tracks', 'items', 'lookup']) {
    const arr = n[key]
    if (Array.isArray(arr)) for (const c of arr) push(c)
  }
  if (Array.isArray(n.arms)) for (const a of n.arms as Array<{ pattern?: unknown }>) push(a?.pattern)
  if (Array.isArray(n.entries)) for (const e of n.entries as Array<{ pattern?: unknown }>) push(e?.pattern)
  const via = n.via as { inner?: unknown } | undefined
  if (via && typeof via === 'object' && 'inner' in via) push(via.inner)
  return out
}
