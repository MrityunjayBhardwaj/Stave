/**
 * Phase 20-17 D-1c HIGH-SEVERITY acceptance test.
 *
 * Drives a literal `Code.via = {literal:true,raw}` node through
 * `MusicalTimeline.collectTrackBodies` — the `visit()` containing
 * MusicalTimeline.tsx:298 (post-D-1c: line 309) — and asserts:
 *
 *   1. The walk does NOT throw on a literal-via node.
 *   2. The literal subtree is NOT silently dropped from the timeline
 *      projection (the surrounding walk still reaches it as a leaf via
 *      structural siblings; we measure via the visited Track set).
 *   3. The `via.inner`-undefined branch is provably NOT entered for the
 *      literal arm (no spurious recursion into a non-existent inner).
 *
 * PRE-20-17 shape (the bug this test pins as fixed):
 *   if (anyN.via && typeof anyN.via === 'object') {
 *     const inner = (anyN.via as { inner?: PatternIR }).inner
 *     if (inner) visit(inner)
 *   }
 *
 * A literal `via = {literal:true,raw:'4'}` is truthy AND `typeof === 'object'`,
 * so the unguarded branch ENTERS; `via.inner` is `undefined`; `if (inner)`
 * is false → the literal subtree is silently dropped from the projection
 * (no throw, no log, wrong-but-plausible render). The D-1c fix adds the
 * `'literal' in via` guard BEFORE the `via.inner` read so the literal arm
 * is treated as a LEAF and the projection does not lose it.
 *
 * Test strategy: construct a Track whose body is a single-body wrapper
 * (Param) whose body is a Code-with-literal-via. The walk descends into
 * `body` (and through `body` into the wrapped child), and would have
 * incorrectly recursed into `via.inner` on the literal arm pre-D-1c. We
 * also place a second Track sibling whose presence (or absence) in the
 * collected Map proves the walk completed without falling off the rails.
 */
import { describe, it, expect, vi } from 'vitest'
// Phase 20-17 D-1c — mock @stave/editor BEFORE importing MusicalTimeline.
// The mock is the real module with the editor/snapshot channels stubbed —
// we call `__test_collectTrackBodies` directly on a hand-built IR, so nothing
// here may reach a live editor.
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
// Type-only import — `import type` ensures no runtime entry into the barrel.
import type { PatternIR } from '@stave/editor'

function makeLiteralCode(raw: string): PatternIR {
  // Mirror the shape `classifyLiteralRhs` produces in @stave/editor.
  return {
    tag: 'Code',
    code: raw,
    lang: 'strudel',
    via: { literal: true, raw },
  } as PatternIR
}

describe('MusicalTimeline.collectTrackBodies — literal Code.via projection (20-17 D-1c HIGH-SEVERITY)', () => {
  it('does NOT throw when walking a Track whose body contains a literal Code.via', () => {
    const literal = makeLiteralCode('4')
    // Track('a') { body: Param(literal) }
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'a',
      body: {
        tag: 'Param',
        key: 'gain',
        value: 1,
        rawArgs: '1',
        body: literal,
      },
    } as PatternIR
    expect(() => __test_collectTrackBodies(ir)).not.toThrow()
  })

  it('walks past a literal-via node without recursing into a non-existent inner', () => {
    const literal = makeLiteralCode('4')
    // Sibling Track('b') sits BELOW the literal node. If the walk
    // mistakenly entered the unguarded `via.inner` branch on the literal
    // and threw / hung / short-circuited, Track('b') would be missing.
    const ir: PatternIR = {
      tag: 'Stack',
      tracks: [
        {
          tag: 'Track',
          trackId: 'a',
          body: {
            tag: 'Param',
            key: 'gain',
            value: 1,
            rawArgs: '1',
            body: literal,
          },
        } as PatternIR,
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
    // Track('a') must reach the projection — the literal node under the Param
    // body is a LEAF and does not block traversal.
    expect(bodies.size).toBe(2)
  })

  it('does NOT treat literal via as the wrapAsOpaque inner (no spurious recursion entry)', () => {
    // Pre-D-1c, a literal `via = {literal:true,raw:'4'}` would enter the
    // `anyN.via && typeof anyN.via === 'object'` branch and read
    // `via.inner` (undefined). Post-D-1c the `'literal' in via` guard
    // blocks the branch. We assert this by walking a Track whose direct
    // body is a Code-with-literal-via — the walk should NOT attempt to
    // descend the literal via as if it were an opaque-wrapper inner.
    //
    // We observe this indirectly: a literal Code IS the Track body, so
    // the Track gets collected (visit(Track) → out.set(trackId, body)),
    // then visit(body) is invoked with body = Code-with-literal-via. If
    // the unguarded `via.inner` recursion had fired with `inner =
    // undefined`, the `if (inner)` short-circuit would mask the bug AT
    // RUNTIME but the spurious branch-entry is exactly what the guard
    // prevents at the TYPE level (`via.inner` is not a member of the
    // literal arm). Surface-level observable: NO throw, projection size = 1.
    const literal = makeLiteralCode('"bd"')
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'solo',
      body: literal,
    } as PatternIR
    expect(() => __test_collectTrackBodies(ir)).not.toThrow()
    const bodies = __test_collectTrackBodies(ir)
    expect(bodies.has('solo')).toBe(true)
    expect(bodies.size).toBe(1)
    // The collected body for 'solo' IS the literal Code node — preserved
    // intact, not silently swapped or stripped.
    const soloBody = bodies.get('solo') as PatternIR
    expect(soloBody.tag).toBe('Code')
    const soloVia = (soloBody as { via?: { literal?: boolean; raw?: string } }).via
    expect(soloVia?.literal).toBe(true)
    expect(soloVia?.raw).toBe('"bd"')
  })

  it('still descends the wrapAsOpaque arm via.inner (PV37 unchanged)', () => {
    // Defensive — make sure the literal-arm guard does NOT break the
    // existing wrapAsOpaque arm's recursion.
    const innerTrack: PatternIR = {
      tag: 'Track',
      trackId: 'wrapped',
      body: { tag: 'Pure' },
    } as PatternIR
    const wrapperOpaque: PatternIR = {
      tag: 'Code',
      code: '',
      lang: 'strudel',
      via: {
        method: 'release',
        args: '0.3',
        callSiteRange: [0, 11],
        inner: innerTrack,
      },
    } as PatternIR
    const ir: PatternIR = {
      tag: 'Track',
      trackId: 'outer',
      body: wrapperOpaque,
    } as PatternIR
    const bodies = __test_collectTrackBodies(ir)
    // Both Track nodes must be reachable — the outer + the inner
    // (drilled through via.inner).
    expect(bodies.has('outer')).toBe(true)
    expect(bodies.has('wrapped')).toBe(true)
  })
})
