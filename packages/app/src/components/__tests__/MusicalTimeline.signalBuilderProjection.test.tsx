/**
 * Phase 20-18 Wave D D-1 HIGH-SEVERITY acceptance test — Signal/Builder
 * projection guard through MusicalTimeline.collectTrackBodies + the
 * irProjection switches.
 *
 * Mirrors the 20-17 D-1c precedent (MusicalTimeline.literalProjection.test.tsx):
 * the consumer arms authored in Wave A Option-3 must keep a Signal /
 * Builder node WALKED end-to-end through:
 *
 *   1. MusicalTimeline.collectTrackBodies (`visit()` containing the line
 *      "if (anyN.via && typeof anyN.via === 'object' && !('literal' in anyN.via))"
 *      — a Signal/Builder has NO `via` field, so the guard provably DOES
 *      NOT enter the wrapAsOpaque arm; the 20-17 silent-wrong class does
 *      not apply by construction).
 *   2. irProjection.projectedLabel — returns the `kind` (musician-chrome,
 *      no IR-tag leak per PV35 / PV32).
 *   3. irProjection.projectedChildren — returns [] (LEAF; explicitly
 *      forbidden to recurse — the 20-17 MusicalTimeline:298 silent-wrong
 *      class made explicit).
 *   4. irProjection.stripInnerLate — pass-through (NOT a Late wrapper).
 *
 * The four assertions per shape mirror the per-switch disposition table
 * in `20-18-OBSERVATIONS.md` "WAVE A — Option-3 closure" #7/#9/#10.
 *
 * Test strategy: construct a Track whose body is a Signal/Builder
 * directly, plus a sibling Track for traversal-completion observation
 * (if the walk had thrown / hung / short-circuited on the new tag, the
 * sibling would be missing from the collected Map).
 */
import { describe, it, expect, vi } from 'vitest'
// The real module with the editor/snapshot channels stubbed, so nothing here
// reaches a live editor. Same as MusicalTimeline.literalProjection.test.tsx.
vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  getActiveEditor: () => null,
  getActiveFileId: () => null,
  onActiveEditorChange: () => () => {},
  getIRSnapshot: () => null,
  subscribeIRSnapshot: () => () => {},
  revealLineInFile: () => {},
  useTrackMeta: () => ({ meta: {}, set: () => {} }),
  getTrackMeta: () => ({}),
  setTrackMeta: () => {},
  subscribeToTrackMeta: () => () => {},
  getMusicalTimelineSubRowHeight: () => 18,
  onMusicalTimelineSubRowHeightChange: () => () => {},
}))

import { __test_collectTrackBodies } from '../MusicalTimeline'
import { projectedLabel, projectedChildren, stripInnerLate } from '../irProjection'
// Type-only — `import type` ensures no runtime entry into the barrel.
import type { PatternIR } from '@stave/editor'

function makeSignal(kind: string, args?: string): PatternIR {
  // Mirror IR.signal's shape — `args` only present when supplied.
  const node: PatternIR = { tag: 'Signal', kind } as PatternIR
  if (args) (node as { args?: string }).args = args
  return node
}

function makeBuilder(kind: string, args: string): PatternIR {
  return { tag: 'Builder', kind, args } as PatternIR
}

describe('MusicalTimeline.collectTrackBodies — Signal/Builder projection (20-18 D-1 HIGH-SEVERITY)', () => {
  it('does NOT throw when walking a Track whose body is a Signal', () => {
    const signal = makeSignal('sine')
    // Track('a') { body: Signal('sine') }
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'a',
      body: signal,
    } as PatternIR
    expect(() => __test_collectTrackBodies(ir)).not.toThrow()
  })

  it('does NOT throw when walking a Track whose body is a Builder', () => {
    const builder = makeBuilder('irand', '12')
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'a',
      body: builder,
    } as PatternIR
    expect(() => __test_collectTrackBodies(ir)).not.toThrow()
  })

  it('walks past a Signal node without recursing into via.inner (no spurious branch entry)', () => {
    // Sibling Track('b') sits BELOW the Signal node. If the walk had
    // mistakenly entered an unguarded `via.inner` branch on the Signal
    // and thrown / hung / short-circuited, Track('b') would be missing.
    //
    // Mechanism: the MusicalTimeline visit() guard reads
    //   if (anyN.via && typeof anyN.via === 'object' && !('literal' in anyN.via))
    // A Signal has NO `via` field, so `anyN.via` is undefined → guard
    // does not enter (the structural reason the 20-17 silent-wrong class
    // does not apply to Signal/Builder by construction).
    const signal = makeSignal('perlin')
    const ir: PatternIR = {
      tag: 'Stack',
      tracks: [
        { tag: 'Track', trackId: 'a', body: signal } as PatternIR,
        {
          tag: 'Track',
          trackId: 'b',
          body: { tag: 'Play', note: 'bd', duration: 0.25, params: { gain: 1, velocity: 1 } },
        } as PatternIR,
      ],
    } as PatternIR

    const bodies = __test_collectTrackBodies(ir)
    expect(bodies.has('a')).toBe(true)
    expect(bodies.has('b')).toBe(true)
    expect(bodies.size).toBe(2)
  })

  it('walks past a Builder node without recursing into via.inner (no spurious branch entry)', () => {
    const builder = makeBuilder('irand', '12')
    const ir: PatternIR = {
      tag: 'Stack',
      tracks: [
        { tag: 'Track', trackId: 'a', body: builder } as PatternIR,
        {
          tag: 'Track',
          trackId: 'b',
          body: { tag: 'Play', note: 'bd', duration: 0.25, params: { gain: 1, velocity: 1 } },
        } as PatternIR,
      ],
    } as PatternIR

    const bodies = __test_collectTrackBodies(ir)
    expect(bodies.has('a')).toBe(true)
    expect(bodies.has('b')).toBe(true)
    expect(bodies.size).toBe(2)
  })

  it('Signal Track body is PRESERVED intact in the collected map (not stripped / not swapped)', () => {
    const signal = makeSignal('sine')
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'solo',
      body: signal,
    } as PatternIR
    const bodies = __test_collectTrackBodies(ir)
    expect(bodies.has('solo')).toBe(true)
    const soloBody = bodies.get('solo') as PatternIR
    expect(soloBody.tag).toBe('Signal')
    expect((soloBody as Extract<PatternIR, { tag: 'Signal' }>).kind).toBe('sine')
  })

  it('Builder Track body is PRESERVED intact in the collected map (args byte-verbatim)', () => {
    const builder = makeBuilder('chord', '"Am Am"')
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'solo',
      body: builder,
    } as PatternIR
    const bodies = __test_collectTrackBodies(ir)
    expect(bodies.has('solo')).toBe(true)
    const soloBody = bodies.get('solo') as PatternIR
    expect(soloBody.tag).toBe('Builder')
    const b = soloBody as Extract<PatternIR, { tag: 'Builder' }>
    expect(b.kind).toBe('chord')
    expect(b.args).toBe('"Am Am"')
  })
})

// ─── irProjection switches — the 5 FLOOR sites at lines 42/73/190/333/438 ───
//
// The Wave A disposition table promises:
//   #7  miniSymbol (line 42)            → return node.tag (fallback)
//   #8  projectedLabel (line 73)        → return node.kind (musician chrome)
//   #9  projectedChildren (line 190)    → return [] (LEAF — the 20-17 silent-wrong class)
//   #10 stripInnerLate (line 333)       → return node (pass-through; not a Late)
//   #11 peelSingleBodyWrapper (line 438) → return null (not a single-body wrapper)
//
// Three of these (#8, #9, #10) are publicly exported. We exercise each on
// hand-built Signal / Builder nodes. #7 and #11 are not exported; they are
// exercised indirectly by the test above (the walk through collectTrackBodies
// uses the projection internally — a throw or wrong recurse there would
// surface as a missing sibling Track / a throw out of __test_collectTrackBodies).

describe('irProjection switches — Signal/Builder Wave A disposition table verified', () => {
  it('projectedLabel(Signal) returns the kind (musician chrome — no IR-tag leak; PV35/PV32)', () => {
    expect(projectedLabel(makeSignal('sine'))).toBe('sine')
    expect(projectedLabel(makeSignal('perlin'))).toBe('perlin')
  })

  it('projectedLabel(Builder) returns the kind', () => {
    expect(projectedLabel(makeBuilder('irand', '12'))).toBe('irand')
    expect(projectedLabel(makeBuilder('chord', '"Am Am"'))).toBe('chord')
  })

  it('projectedChildren(Signal) returns [] (LEAF — explicitly forbidden to recurse; 20-17 silent-wrong class guard)', () => {
    expect(projectedChildren(makeSignal('sine'))).toEqual([])
    expect(projectedChildren(makeSignal('perlin'))).toEqual([])
  })

  it('projectedChildren(Builder) returns []', () => {
    expect(projectedChildren(makeBuilder('irand', '12'))).toEqual([])
    expect(projectedChildren(makeBuilder('arrange', '[48, stack(p)]'))).toEqual([])
  })

  it('stripInnerLate(Signal) is pass-through (NOT a Late wrapper)', () => {
    const node = makeSignal('sine')
    expect(stripInnerLate(node)).toBe(node)
  })

  it('stripInnerLate(Builder) is pass-through', () => {
    const node = makeBuilder('irand', '12')
    expect(stripInnerLate(node)).toBe(node)
  })

  it('projectedLabel/projectedChildren do NOT throw on any curated Signal kind', () => {
    // Defensive sweep — every curated Signal kind (the FROZEN Wave-0 set,
    // 21 entries) must round-trip the projection switches.
    const signalKinds = [
      'sine', 'cosine', 'saw', 'isaw', 'tri', 'square', 'pulse',
      'perlin', 'berlin', 'time',
      'rand', 'rand2', 'brand',
      'sine2', 'cosine2', 'saw2', 'isaw2', 'tri2', 'square2',
      'mousex', 'mousey',
    ]
    for (const kind of signalKinds) {
      const node = makeSignal(kind)
      expect(() => projectedLabel(node)).not.toThrow()
      expect(() => projectedChildren(node)).not.toThrow()
      expect(() => stripInnerLate(node)).not.toThrow()
      expect(projectedLabel(node)).toBe(kind)
      expect(projectedChildren(node)).toEqual([])
    }
  })

  it('projectedLabel/projectedChildren do NOT throw on any curated Builder kind', () => {
    // FROZEN Wave-0 + Wave-C grounded additions: 8 entries.
    const builderKinds = [
      'run', 'irand', 'binary', 'binaryN', 'binaryL', 'binaryNL',
      'chord', 'arrange',
    ]
    for (const kind of builderKinds) {
      const node = makeBuilder(kind, '12')
      expect(() => projectedLabel(node)).not.toThrow()
      expect(() => projectedChildren(node)).not.toThrow()
      expect(() => stripInnerLate(node)).not.toThrow()
      expect(projectedLabel(node)).toBe(kind)
      expect(projectedChildren(node)).toEqual([])
    }
  })
})
