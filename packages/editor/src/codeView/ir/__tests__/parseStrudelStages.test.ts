/**
 * The IR Inspector's intermediate views (#1387), and the parse they come from.
 *
 * `parseStrudelStages` lays `parseStrudelRecorded`'s record of each top-level
 * track body over the parser's final tree. These arms pin:
 *
 *   - RAW shows, per track, the exact source text its body was parsed from;
 *   - MINI-EXPANDED shows the root the parser built before applying the chain;
 *   - every view keeps the parser's own Track wrappers;
 *   - recording changes nothing: the `pipeline` side of every parity arm is the
 *     recording path, and the other side is plain `parseStrudel`.
 *
 * The parity arms that predate #1387 were written against the hand-kept staged
 * pipeline it replaced. Their fixtures still run, now through the recording path.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel, parseStrudelRecorded, buildBindingMap, parseExpression } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { parseStrudelStages } from '../parseStrudelStages'
import { unwrapD1 } from './helpers/unwrapD1'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

// ---------------------------------------------------------------------------
// Helpers — exported for PR-B's T-10.c reuse (REV-6).
// ---------------------------------------------------------------------------

/**
 * Assert recursively that no node carries stage-transition metadata.
 * D-06.c invariant: CHAIN-APPLIED and FINAL outputs MUST NOT contain
 * any `unresolvedChain` or `chainOffset` field on any node.
 *
 * Walks the IR tree via tag-based child enumeration. Any node where
 * the field is present (even with `undefined` value) fails the assertion.
 */
export function assertNoStageMeta(node: PatternIR): void {
  const visit = (n: PatternIR): void => {
    const rec = n as Record<string, unknown>
    expect(
      Object.prototype.hasOwnProperty.call(rec, 'unresolvedChain'),
      `node tag=${n.tag} has orphan unresolvedChain`,
    ).toBe(false)
    expect(
      Object.prototype.hasOwnProperty.call(rec, 'chainOffset'),
      `node tag=${n.tag} has orphan chainOffset`,
    ).toBe(false)
    // Phase 20-11 α-4 — Track-loc threading metadata.
    expect(
      Object.prototype.hasOwnProperty.call(rec, 'dollarStart'),
      `node tag=${n.tag} has orphan dollarStart`,
    ).toBe(false)
    expect(
      Object.prototype.hasOwnProperty.call(rec, 'dollarEnd'),
      `node tag=${n.tag} has orphan dollarEnd`,
    ).toBe(false)
    // #671 — label threading metadata; consumed as trackId in CHAIN-APPLIED.
    expect(
      Object.prototype.hasOwnProperty.call(rec, 'trackLabel'),
      `node tag=${n.tag} has orphan trackLabel`,
    ).toBe(false)
    // Recurse into children based on tag shape.
    switch (n.tag) {
      case 'Seq':
        for (const c of n.children) visit(c)
        break
      case 'Stack':
        for (const t of n.tracks) visit(t)
        break
      case 'Cycle':
        for (const i of n.items) visit(i)
        break
      case 'Choice':
        visit(n.then)
        visit(n.else_)
        break
      case 'Every':
        visit(n.body)
        if (n.default_) visit(n.default_)
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
        visit(n.body)
        break
      case 'Param':
        // Phase 20-10 — Param has BOTH a body and a value (which may be a
        // sub-IR for the pattern-arg form). Recurse into both.
        visit(n.body)
        if (typeof n.value === 'object' && n.value !== null) visit(n.value as PatternIR)
        break
      case 'Track':
        // Phase 20-11 wave α-1 — Track wraps a body; recurse into it so the
        // orphan-meta scan reaches inner nodes. Same single-body shape as FX.
        visit(n.body)
        break
      case 'Chunk':
        visit(n.transform)
        visit(n.body)
        break
      case 'Pick':
        visit(n.selector)
        for (const l of n.lookup) visit(l)
        break
      case 'Pure':
      case 'Play':
      case 'Sleep':
      case 'Code':
        // No children.
        break
    }
  }
  visit(node)
}


// ---------------------------------------------------------------------------
// #1376 — bare multi-statement documents. Fixtures, not just the corpus sweep:
// the sweep SKIPS when `.bakery-runs/` is absent (it is gitignored), so on a
// clean checkout nothing would cover this fix at all.
// ---------------------------------------------------------------------------

describe('MINI-EXPANDED — top-level bindings resolve (#1375)', () => {
  // The D-06 sentinel had 13 fixtures and NOT ONE contained a `const` or
  // `let`, which is how this survived three separate bug reports. The corpus
  // sweep skips without `.bakery-runs/`, so these carry the fix on a clean
  // checkout.
  const parity = (code: string) =>
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))

  it('const then a bare use', () => parity('const a = s("bd hh")\na'))
  it('const then a stack', () => parity('const a = s("bd")\nconst b = s("hh")\nstack(a, b)'))
  it('const then a chain — bindings must reach applyChain too', () =>
    parity('const a = s("bd hh")\na.fast(2)'))
  it('let, not just const', () => parity('let a = s("bd")\nstack(a, s("hh"))'))
  it('a binding alongside a side-effect statement', () =>
    parity('setcps(120/240)\nconst a = s("bd hh")\na'))

  it('arrange() behind a const — the shape that sized a 3:28 song at 0:08 (#1373)', () => {
    const code = 'const a = s("bd*4")\nconst b = s("hh*8")\narrange([4, a], [8, b])'
    parity(code)
    // The point of the fix: the arrangement is VISIBLE, not an opaque blob.
    expect(unwrapD1(stripStageMeta(pipeline(code))).tag).toBe('Arrange')
  })

  it('an unresolvable binding keeps the opaque fallback, it does not throw', () => {
    // P67 — if the map does not help, the whole-document Code fallback is
    // still the right answer and must be preserved byte-for-byte.
    parity('const a = someUnknownThing()\na')
  })

  it('a $: track is NOT given bindings — matching parseStrudel', () => {
    // parseStrudel's multi-track path passes no binding map; the staged path
    // must not either, or the two diverge in the opposite direction.
    parity('const a = s("bd")\n$: s("hh")')
  })
})

describe('MINI-EXPANDED — a commented track keeps its name and its range (#1384)', () => {
  // `extractTracks` deliberately keeps a commented `$:`/`name:` line as an
  // empty-bodied track so the numbering stays stable when a user toggles the
  // comment prefix. RAW threads its label and `$:`-line range through; the
  // empty-code guard returned before reading them, so CHAIN-APPLIED had
  // nothing to build the wrapper from.
  const parity = (code: string) =>
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))

  it('a lone commented labelled track keeps its trackId', () => {
    const code = '// PR: s("bd hh")'
    parity(code)
    // The user-visible half: the row was renaming itself to `d1` the moment
    // the line was commented out — #671's failure mode, still live here.
    const ir = stripStageMeta(pipeline(code)) as { trackId?: string }
    expect(ir.trackId).toBe('PR')
  })

  it('and keeps its source range, which is what the timeline anchors on', () => {
    const code = '// PR: s("bd hh")'
    expect(stripStageMeta(pipeline(code)).loc).toEqual(
      stripStageMeta(parseStrudel(code)).loc,
    )
    expect(stripStageMeta(pipeline(code)).loc).toBeDefined()
  })

  it('a lone commented $: keeps d1 and still gets its range', () =>
    parity('// $: s("bd hh")'))

  it('a commented track among live ones holds its slot', () =>
    parity('drums: s("bd")\n// PR: s("hh")\nbass: s("cp")'))

  it('an uncommented labelled track is unchanged (control)', () =>
    parity('PR: s("bd hh")'))

  // CONTROLS — these reach the SAME empty-code guard with no label to attach.
  // They passed before the fix and must still pass: the guard must not start
  // inventing metadata where RAW threaded none.
  it('an all-prelude document has no label or loc (control)', () => {
    parity('setcps(120/240)')
    expect(stripStageMeta(pipeline('setcps(120/240)')).loc).toBeUndefined()
  })

  it('a comment-only document has no label or loc (control)', () => {
    parity('// just a comment')
    expect(stripStageMeta(pipeline('// just a comment')).loc).toBeUndefined()
  })

  it('an EMPTY document agrees with parseStrudel — a divergence pinned here until #1387', () => {
    // `parseStrudel('')` returns a bare `IR.pure()` from its own top guard,
    // with NO synthetic Track wrapper. The hand-kept staged pipeline wrapped
    // every non-multi-track shape in `Track('d1', …)` at CHAIN-APPLIED, so this
    // arm used to pin the two apart (`Pure` vs `Track`) as a known breach with
    // no reachable consequence. The views are derived from the parse now, so
    // there is nothing left to disagree: both sides are `Pure`.
    expect(stripStageMeta(parseStrudel('')).tag).toBe('Pure')
    expect(stripStageMeta(pipeline('')).tag).toBe('Pure')
  })
})

describe('MINI-EXPANDED — a structured Code wrapper is not opaque (#1383)', () => {
  // `Code` is TWO nodes wearing one tag. `wrapAsOpaque` returns tag 'Code' for
  // an unrecognised method arg but keeps the parsed chain in `via` (PV37
  // wrap-never-drop), so only `via === undefined` means the parse gave up.
  // `parseRootWithChainMeta` tested the tag alone and threw the structure away
  // — 15 of the 20 remaining corpus divergences, and the corpus sweep skips
  // without `.bakery-runs/`, so these carry the fix on a clean checkout.
  const parity = (code: string) =>
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))

  // Each of these has a root that parses to Code WITH a `via`. All four
  // diverged before the fix; verified by restoring the tag-only predicate.
  it('a method call inside a mini-string arg', () =>
    parity('note("c d".sub(12)).s("sawtooth")'))
  it('the same shape behind a $: label', () =>
    parity('$: note("c d".sub(12)).s("sawtooth")'))
  it('a longer chain past the wrapper', () =>
    parity('note("e3 d2 g4 a3".sub(12)).s("sawtooth").lpf("333:2")'))
  it('an arg-side pattern operator', () =>
    parity('n("0 2".add("<0 1>")).scale("C:minor")'))

  it('the structure survives — it is not replaced by a blob', () => {
    // The count is not the point; what the consumers receive is. Before the
    // fix this was a bare `Code` carrying the whole expression as text.
    const code = 'note("c d".sub(12)).s("sawtooth")'
    expect(unwrapD1(stripStageMeta(pipeline(code))).tag).toBe('Param')
  })

  it('the loc stays narrow, which is what the timeline anchors on', () => {
    // The quieter half of the defect: both sides emit a legal node, so a
    // structural check cannot see it, while a document-wide `loc` collapses
    // every hap onto one anchor in MusicalTimeline.
    const code = 'note("c d".sub(12)).s("sawtooth")'
    const staged = unwrapD1(stripStageMeta(pipeline(code)))
    const direct = unwrapD1(stripStageMeta(parseStrudel(code)))
    expect(staged.loc).toEqual(direct.loc)
    // 19..33 — the `.s("sawtooth")` span, not 0..33. The whole-expression
    // fallback this branch used to take spans the entire document.
    const span = staged.loc![0]
    expect(span.end - span.start).toBeLessThan(code.length)
  })

  // NEGATIVE CONTROL — a chained root that parses cleanly (no `via` wrapper).
  // These passed BEFORE the fix too. Without them this block could be green
  // because chains work at all, rather than because `via` is discriminated.
  it('a plainly-parsed root is unaffected (control)', () =>
    parity('n("0 2 4 7").fast(2).scale("C:minor")'))
  it('a template-literal root is unaffected (control)', () =>
    parity('note(`<c d>`).s("square")'))

  it('a genuinely opaque root still falls back to whole-expression Code', () => {
    // The branch must still fire for its real case, or the fix has simply
    // deleted the fallback. `via === undefined` is what opaque means.
    const code = 'someUnknownThing().s("bd")'
    parity(code)
    expect(unwrapD1(stripStageMeta(pipeline(code))).tag).toBe('Code')
  })
})

describe('RAW — a bare document with several top-level statements (#1376)', () => {
  it('gives every statement its own track, and loses none', () => {
    const code = 'sound ("hh hh hh hh")\nsound ("[bd bd][sd bd] bd sd")'
    // The defect was a DISAPPEARANCE, not a degraded shape: statement 2 was
    // absent from the IR entirely, with no opaque node standing in for it.
    expect(JSON.stringify(pipeline(code))).toContain('sd')
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))
  })

  it('a single bare statement is untouched', () => {
    const code = 'sound ("hh hh hh hh")'
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))
  })

  it('side-effect statements do not take a track', () => {
    const code = 'setcps(120/240)\nsound ("bd hh")\nsound ("cp cp")'
    const out = unwrapD1(stripStageMeta(pipeline(code)))
    expect(out.tag).toBe('Stack')
    if (out.tag !== 'Stack') throw new Error('unreachable')
    expect(out.tracks).toHaveLength(2)
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))
  })

  it('a document with a binding keeps the single-track shape', () => {
    // Deliberately narrow, mirroring parseStrudel: per-statement binding
    // semantics here would be a second, weaker binding map.
    const code = 'const a = sound("bd")\na'
    expect(stripStageMeta(pipeline(code)).tag).toBe('Track')
  })

  it('statements are split depth- and string-aware, not by newline', () => {
    // A multi-line stack( is ONE statement; a wrong split would fabricate
    // tracks the document never declared.
    const code = 'stack(\n  sound("bd"),\n  sound("cp")\n)'
    expect(stripStageMeta(pipeline(code))).toEqual(stripStageMeta(parseStrudel(code)))
    expect(unwrapD1(stripStageMeta(pipeline(code))).tag).toBe('Stack')
  })
})

// ---------------------------------------------------------------------------
// T-05.a — RAW: each track body is the source it was parsed from (#1387)
// ---------------------------------------------------------------------------

/** The body of each top-level Track in a view, in the order the tree holds them. */
function trackBodies(ir: PatternIR): PatternIR[] {
  if (ir.tag === 'Track') return [ir.body]
  if (ir.tag === 'Stack' && ir.tracks.every((t) => t.tag === 'Track')) {
    return ir.tracks.map((t) => (t as Extract<PatternIR, { tag: 'Track' }>).body)
  }
  return []
}

/** A view's top-level Track wrappers without their bodies — ids, loc, muted. */
function wrappers(ir: PatternIR): unknown[] {
  const tracks = ir.tag === 'Track' ? [ir] : ir.tag === 'Stack' ? ir.tracks : []
  return tracks.map((t) => ({ ...t, body: undefined }))
}

type CodeNode = Extract<PatternIR, { tag: 'Code' }>
const RAW = 0
const MINI = 1
const CHAIN = 2

describe('parseStrudel stages — RAW (T-05.a, #1387)', () => {
  it('a bare pattern: one Code body, the exact source slice it names', () => {
    const code = '   note("c")\n'
    const bodies = trackBodies(parseStrudelStages(code)[RAW].ir)
    expect(bodies.map((b) => b.tag)).toEqual(['Code'])
    const body = bodies[0] as CodeNode
    expect(body.code.trim()).toBe('note("c")')
    const loc = body.loc![0]
    expect(code.slice(loc.start, loc.end)).toBe(body.code)
  })

  it('multi-track $: one Code body per track, each at its $: body offset', () => {
    const code = '$: note("c d")\n$: s("bd hh")'
    const bodies = trackBodies(parseStrudelStages(code)[RAW].ir)
    expect(bodies.map((b) => b.tag)).toEqual(['Code', 'Code'])
    const [b0, b1] = bodies as CodeNode[]
    // '$: ' is 3 chars, so the first body starts at 3; the second `$:` is at 15.
    expect([b0.loc?.[0]?.start, b0.code]).toEqual([3, 'note("c d")\n'])
    expect([b1.loc?.[0]?.start, b1.code]).toEqual([18, 's("bd hh")'])
    for (const b of [b0, b1]) expect(code.slice(b.loc![0].start, b.loc![0].end)).toBe(b.code)
  })

  it('every view keeps the parser\'s own Track wrappers', () => {
    for (const code of REGRESSION_FIXTURES) {
      const [raw, mini, chain] = parseStrudelStages(code)
      expect(wrappers(raw.ir), code).toEqual(wrappers(chain.ir))
      expect(wrappers(mini.ir), code).toEqual(wrappers(chain.ir))
    }
  })

  it('records exactly one body per top-level track', () => {
    for (const code of [...REGRESSION_FIXTURES, ...TIER4_FIXTURES.map((f) => f.code)]) {
      const { ir, bodies } = parseStrudelRecorded(code)
      expect(bodies.length, code).toBe(trackBodies(ir).length)
    }
  })

  it('a body parsed and then discarded leaves no record behind (the binding-map fall-through)', () => {
    const code = 'const a = s("bd")\nfoo(a)'
    // Preconditions, so the fixture cannot quietly stop taking the branch it is
    // here for: the binding map accepts the document, and its final expression
    // parses opaque — which is when the parser drops that parse and starts over.
    const bound = buildBindingMap(code, 0)
    expect(bound, 'precondition: the binding map accepts the document').not.toBeNull()
    const inner = parseExpression(bound!.finalExpr, bound!.finalOffset, undefined, bound!.bindings)
    expect(
      inner.tag === 'Code' && (inner as { via?: unknown }).via === undefined,
      'precondition: its final expression parses opaque',
    ).toBe(true)

    const { ir, bodies } = parseStrudelRecorded(code)
    expect(bodies.length).toBe(trackBodies(ir).length)
    // With the discarded body still recorded, the counts would disagree and RAW
    // would fall back to showing the final tree, whose body carries no loc.
    const [body] = trackBodies(parseStrudelStages(code)[RAW].ir)
    expect(body.tag).toBe('Code')
    expect((body as CodeNode).loc, 'RAW shows the recorded slice, not the final tree').toBeDefined()
  })

  it('a commented track keeps its slot in the record, with an empty body', () => {
    // ⚠ The corpus sweep also catches a commented track going unrecorded, but
    // it skips on a checkout without `.bakery-runs/`. This arm is what holds it
    // there: a missing body shifts every later track onto the wrong body.
    const code = 'drums: s("bd")\n// PR: s("hh")\nhats: s("cp")'
    const { ir, bodies } = parseStrudelRecorded(code)
    const finalBodies = trackBodies(ir)
    // Precondition: the parser really keeps the commented track as a Track.
    expect(finalBodies.map((b) => b.tag), 'precondition: three tracks, the middle one empty').toEqual([
      expect.any(String),
      'Pure',
      expect.any(String),
    ])
    expect(bodies).toHaveLength(3)
    const raw = trackBodies(parseStrudelStages(code)[RAW].ir)
    expect(raw.map((b) => b.tag)).toEqual(['Code', 'Pure', 'Code'])
    expect((raw[2] as CodeNode).code.trim()).toBe('s("cp")')
  })

  it('an empty document has no tracks, records nothing, and shows one tree in every view', () => {
    expect(parseStrudelRecorded('').bodies).toEqual([])
    expect(parseStrudelStages('').map((s) => s.ir)).toEqual([{ tag: 'Pure' }, { tag: 'Pure' }, { tag: 'Pure' }])
  })
})

// ---------------------------------------------------------------------------
// T-05.b — MINI-EXPANDED: the root before its chain (#1387; PV25, PV31).
// ---------------------------------------------------------------------------

describe('parseStrudel stages — MINI-EXPANDED (T-05.b, #1387)', () => {
  it('a chained track shows its root before the chain', () => {
    const [, mini, chain] = parseStrudelStages('note("c d e").fast(2)')
    const [m] = trackBodies(mini.ir)
    const [c] = trackBodies(chain.ir)
    expect(c.tag).toBe('Fast')
    if (c.tag !== 'Fast') throw new Error('unreachable')
    expect(m.tag).not.toBe('Fast')
    expect(m).toEqual(c.body)
  })

  it('a track with no chain shows the same body in both views', () => {
    const [, mini, chain] = parseStrudelStages('note("c d")')
    expect(trackBodies(mini.ir)).toEqual(trackBodies(chain.ir))
  })

  it('root-level stack(...) preserves userMethod === "stack" (PV31)', () => {
    const [m] = trackBodies(parseStrudelStages('stack(s("bd"), s("hh"))')[MINI].ir)
    expect(m.tag).toBe('Stack')
    expect((m as { userMethod?: string }).userMethod).toBe('stack')
  })

  it('multi-track $: each body is a parsed root, not Code', () => {
    const bodies = trackBodies(parseStrudelStages('$: note("c d")\n$: s("bd hh")')[MINI].ir)
    expect(bodies).toHaveLength(2)
    for (const b of bodies) expect(b.tag).not.toBe('Code')
  })
})

// ---------------------------------------------------------------------------
// T-05.c — Regression sentinel: 4-stage pipeline FINAL output is
//          byte-equal to today's parseStrudel(code) (D-06).
//          Plus assertNoStageMeta on CHAIN-APPLIED + FINAL outputs
//          (REV-6: PR-A ships REAL CHAIN-APPLIED, so the metadata-strip
//          invariant must be tested HERE, not deferred to PR-B).
// ---------------------------------------------------------------------------

const REGRESSION_FIXTURES: readonly string[] = [
  'note("c d e f")',
  'note("c d").fast(2)',
  's("bd hh sd cp").every(2, x => x.late(0.125))',
  '$: note("c d")\n$: s("bd hh")',
  'stack(s("bd"), s("hh"))',
  's("bd hh sd cp").layer(x => x.add("0,2"))',
  // #113 — a bare pattern PRECEDED by a prelude statement must lift the same
  // way in the staged pipeline as in parseStrudel (strip the prelude). Before
  // the fix the pipeline lifted the whole source as opaque Code → empty
  // timeline; parseStrudel already stripped it, so these fixtures pin parity.
  'setcps(120/240)\ns("bd hh sd")',
  'setcps(120/240)\nsound("bd hh sd")',
  '// my tune\ns("bd hh sd")',
  // #671 — `name:` labelled tracks must pin parity with parseStrudel, which
  // sets trackId = label (parseStrudel.ts:857/876). Before the fix the staged
  // pipeline emitted `d{N}` ordinals here → the full-song timeline (which
  // consumes this pipeline) dropped the labels. These fixtures FAILED pre-fix.
  'drums: s("bd hh")', // single labelled track → Track('drums')
  'drums: s("bd")\nhats: s("hh")', // multi labelled → Track('drums'), Track('hats')
  'drums: s("bd")\n$: s("hh")', // mixed: label='drums' → drums, `$:` → d2
]

describe('parseStrudel stages — regression sentinel (T-05.c, D-06)', () => {
  for (const code of REGRESSION_FIXTURES) {
    it(`pipeline FINAL is byte-equal to parseStrudel(code) — ${JSON.stringify(code).slice(0, 50)}`, () => {
      const fromPipeline = pipeline(code)
      const fromDirect = parseStrudel(code)
      // Strip residual metadata defensively (FINAL output should already
      // be metadata-free; defensive strip catches any test-side drift).
      expect(stripStageMeta(fromPipeline)).toEqual(stripStageMeta(fromDirect))
    })
  }

  for (const code of REGRESSION_FIXTURES) {
    it(`no view carries stage metadata (D-06.c) — ${JSON.stringify(code).slice(0, 50)}`, () => {
      for (const stage of parseStrudelStages(code)) assertNoStageMeta(stage.ir)
      assertNoStageMeta(parseStrudel(code))
    })
  }

  // #671 — direct trackId assertion (documents the fix intent explicitly, not
  // just via byte-equality). The staged pipeline is the one the full-song
  // timeline consumes; it MUST carry `name:` labels as trackIds.
  it('threads `name:` track labels into trackId (not `d{N}` ordinals)', () => {
    const ir = pipeline('drums: s("bd")\nhats: s("hh")\n$: s("cp")') as {
      tag: string
      tracks?: Array<{ trackId?: string }>
    }
    expect(ir.tag).toBe('Stack')
    expect(ir.tracks?.map((t) => t.trackId)).toEqual(['drums', 'hats', 'd3'])
  })
})

// ---------------------------------------------------------------------------
// T-05.d — CHAIN-APPLIED is the parser's tree (#1387).
// ---------------------------------------------------------------------------

describe('parseStrudel stages — CHAIN-APPLIED is the parser\'s tree (T-05.d, #1387)', () => {
  it('CHAIN-APPLIED equals parseStrudel(code) for a plain track', () => {
    expect(parseStrudelStages('note("c d")')[CHAIN].ir).toEqual(parseStrudel('note("c d")'))
  })

  it('and for a chained track', () => {
    const code = 'note("c d e").fast(2)'
    expect(parseStrudelStages(code)[CHAIN].ir).toEqual(parseStrudel(code))
  })
})

// ===========================================================================
// PR-B SCOPE — T-09 Tier-4 round-trip + T-10 deeper per-stage tests.
// ===========================================================================

// ---------------------------------------------------------------------------
// T-09 — Tier-4 round-trip per applyMethod case (REV: PR-A shipped real
//        runChainAppliedStage; T-09 verifies parity per Tier-4 method).
// ---------------------------------------------------------------------------

const TIER4_FIXTURES: ReadonlyArray<{ method: string; code: string }> = [
  { method: 'fast',     code: 's("bd").fast(2)' },
  { method: 'slow',     code: 's("bd").slow(2)' },
  { method: 'jux',      code: 's("bd hh sd cp").jux(x => x.gain(0.5))' },
  { method: 'off',      code: 's("bd hh sd cp").off(0.125, x => x.gain(0.5))' },
  { method: 'layer',    code: 'note("c d e").layer(x => x.add("0,2"))' },
  { method: 'struct',   code: 's("bd hh sd cp").struct("1 0 1 0")' },
  { method: 'ply',      code: 's("bd hh").ply(2)' },
  { method: 'late',     code: 's("bd hh").late(0.125)' },
  { method: 'degrade',  code: 's("bd hh sd cp").degrade()' },
  { method: 'degradeBy', code: 's("bd hh sd cp").degradeBy(0.3)' },
  { method: 'chunk',    code: 's("bd hh sd cp").chunk(2, x => x.fast(2))' },
  { method: 'swing',    code: 's("bd hh sd cp").swing(4)' },
  { method: 'pick',     code: 's("bd hh").pick("0 1", [s("sd"), s("cp")])' },
  { method: 'shuffle',  code: 's("bd hh sd cp").shuffle(4)' },
  { method: 'scramble', code: 's("bd hh sd cp").scramble(4)' },
  { method: 'chop',     code: 's("bd hh").chop(4)' },
  { method: 'every',    code: 's("bd").every(2, x => x.late(0.125))' },
  { method: 'sometimes', code: 's("bd hh").sometimes(x => x.fast(2))' },
  { method: 'gain',     code: 's("bd hh").gain(0.5)' },
]

describe('parseStrudel stages — Tier-4 round-trip per method (T-09)', () => {
  for (const { method, code } of TIER4_FIXTURES) {
    it(`CHAIN-APPLIED FINAL parity for .${method}(...) — pipeline === parseStrudel`, () => {
      const fromPipeline = pipeline(code)
      const fromDirect = parseStrudel(code)
      expect(stripStageMeta(fromPipeline)).toEqual(stripStageMeta(fromDirect))
    })
  }
})

// ---------------------------------------------------------------------------
// T-10 PR-B SCOPE
// ---------------------------------------------------------------------------

/**
 * Recursive walker that collects every node carrying a `loc[0]` field,
 * keyed by tag-path from the root, into a flat list. Used for the
 * MINI-EXPANDED → CHAIN-APPLIED universal loc-equality probe (T-10.b1,
 * REV-2). The path string is `<tag>` for root and `<tag>.<childKey>...`
 * for descendants — ensures structurally-corresponding nodes line up
 * across stages even when applyChain wraps the root in additional tags.
 *
 * We collect in PRE-ORDER so root appears first; CHAIN-APPLIED's wrapping
 * tags (Fast/Late/etc.) appear at the START of its list. Comparison
 * strategy: every entry from MINI-EXPANDED MUST appear in CHAIN-APPLIED's
 * list with the same loc — order need not match (CHAIN-APPLIED has
 * extra entries from wrapping tags).
 */
function collectLocEntries(
  node: PatternIR,
  path: string = node.tag,
  acc: Array<{ path: string; tag: string; start: number; end: number }> = [],
): Array<{ path: string; tag: string; start: number; end: number }> {
  const rec = node as Record<string, unknown>
  const loc = rec.loc as Array<{ start: number; end: number }> | undefined
  if (loc && loc.length > 0) {
    acc.push({ path, tag: node.tag, start: loc[0].start, end: loc[0].end })
  }
  switch (node.tag) {
    case 'Seq':   node.children.forEach((c, i) => collectLocEntries(c, `${path}.children[${i}]`, acc)); break
    case 'Stack': node.tracks.forEach((t, i) => collectLocEntries(t, `${path}.tracks[${i}]`, acc)); break
    case 'Cycle': node.items.forEach((c, i) => collectLocEntries(c, `${path}.items[${i}]`, acc)); break
    case 'Choice':
      collectLocEntries(node.then, `${path}.then`, acc)
      collectLocEntries(node.else_, `${path}.else_`, acc)
      break
    case 'Every':
      collectLocEntries(node.body, `${path}.body`, acc)
      if (node.default_) collectLocEntries(node.default_, `${path}.default_`, acc)
      break
    case 'When': case 'Ramp': case 'Fast': case 'Slow':
    case 'Elongate': case 'Late': case 'Degrade': case 'Ply': case 'Struct':
    case 'Swing': case 'Shuffle': case 'Scramble': case 'Chop': case 'Loop':
    case 'Track':
      collectLocEntries(node.body, `${path}.body`, acc)
      break
    case 'Param':
      // #967 — jux pans are now Param('pan', ±1) wrapping the arm, so this
      // walker must recurse into the body (the old FX(pan) case did). A
      // pattern-arg Param also carries a sub-IR value; recurse it too.
      collectLocEntries(node.body, `${path}.body`, acc)
      if (typeof node.value === 'object' && node.value !== null) {
        collectLocEntries(node.value as PatternIR, `${path}.value`, acc)
      }
      break
    case 'Chunk':
      collectLocEntries(node.transform, `${path}.transform`, acc)
      collectLocEntries(node.body, `${path}.body`, acc)
      break
    case 'Pick':
      collectLocEntries(node.selector, `${path}.selector`, acc)
      node.lookup.forEach((l, i) => collectLocEntries(l, `${path}.lookup[${i}]`, acc))
      break
    case 'Code':
      // Phase 20-04 PV37 / D-01: opaque-fragment wrapper has via.inner —
      // recurse to keep MINI-EXPANDED → CHAIN-APPLIED loc parity when a
      // chain method (e.g. .add("0,2") inside .layer) wraps the receiver.
      if (node.via) collectLocEntries(node.via.inner, `${path}.via.inner`, acc)
      break
    default: break
  }
  return acc
}

describe('parseStrudel stages — MINI-EXPANDED → CHAIN-APPLIED: universal loc-equality (T-10.b1, REV-2, PV25, P39)', () => {
  const fixtures = [
    's("bd hh sd cp").jux(x => x.gain(0.5))',
    's("bd hh sd cp").off(0.125, x => x.gain(0.5))',
    'note("c d e").layer(x => x.add("0,2"))',
    's("bd hh sd cp").struct("1 0 1 0")',
    '$: note("c d")\n$: s("bd hh")',
    '$: s("bd").fast(2)\n$: s("hh").late(0.125)',
  ]
  for (const code of fixtures) {
    it(`every loc preserved MINI-EXPANDED → CHAIN-APPLIED — ${JSON.stringify(code).slice(0, 50)}`, () => {
      const stages = parseStrudelStages(code)
      // #1387 — MINI-EXPANDED keeps the parser's own outer Stack and Track
      // wrappers, so there is no synthetic RAW wrapper to skip any more.
      const meEntries = collectLocEntries(stages[MINI].ir)
      const caEntries = collectLocEntries(stages[CHAIN].ir)
      // CHAIN-APPLIED may have MORE entries (newly-wrapped tags) but every
      // (start, end, tag) tuple from MINI-EXPANDED must appear at least
      // once at CHAIN-APPLIED.
      const caKeys = new Set(caEntries.map((e) => `${e.tag}|${e.start}|${e.end}`))
      for (const me of meEntries) {
        const key = `${me.tag}|${me.start}|${me.end}`
        expect(caKeys.has(key), `MINI-EXPANDED loc dropped at CHAIN-APPLIED: ${me.path} (tag=${me.tag} start=${me.start} end=${me.end})`).toBe(true)
      }
    })
  }
})

describe('parseStrudel stages — PK12 dot-inclusive convention preserved (T-10.b)', () => {
  it('s("bd").fast(2).late(0.125).gain(0.5) — each tag.loc.start lands on its leading dot', () => {
    const code = 's("bd").fast(2).late(0.125).gain(0.5)'
    const ir = unwrapD1(pipeline(code))
    // Phase 20-10: outermost tag is now Param (gain). Walk down: Param →
    // Late → Fast → Play. Loc convention unchanged (PK12 dot-inclusive).
    expect(ir.tag).toBe('Param')
    if (ir.tag !== 'Param') throw new Error('unreachable')
    expect(ir.loc?.[0]?.start).toBe(code.indexOf('.gain'))

    expect(ir.body.tag).toBe('Late')
    if (ir.body.tag !== 'Late') throw new Error('unreachable')
    expect(ir.body.loc?.[0]?.start).toBe(code.indexOf('.late'))

    expect(ir.body.body.tag).toBe('Fast')
    if (ir.body.body.tag !== 'Fast') throw new Error('unreachable')
    expect(ir.body.body.loc?.[0]?.start).toBe(code.indexOf('.fast'))
  })
})

describe('parseStrudel stages — userMethod alias-distinguished pairs (T-10.a, PV31)', () => {
  it('Stack-from-layer ≠ Stack-from-jux', () => {
    const layerFinal = unwrapD1(pipeline('note("c d e").layer(x => x.add("0,2"))'))
    const juxFinal   = unwrapD1(pipeline('s("bd hh sd cp").jux(x => x.gain(0.5))'))
    expect(layerFinal.tag).toBe('Stack')
    expect((layerFinal as { userMethod?: string }).userMethod).toBe('layer')
    expect(juxFinal.tag).toBe('Stack')
    expect((juxFinal as { userMethod?: string }).userMethod).toBe('jux')
  })

  it('Degrade-from-degrade ≠ Degrade-from-degradeBy', () => {
    const d  = unwrapD1(pipeline('s("bd hh sd cp").degrade()'))
    const db = unwrapD1(pipeline('s("bd hh sd cp").degradeBy(0.3)'))
    expect(d.tag).toBe('Degrade')
    expect((d as { userMethod?: string }).userMethod).toBe('degrade')
    expect(db.tag).toBe('Degrade')
    expect((db as { userMethod?: string }).userMethod).toBe('degradeBy')
  })

  it('Every-from-every ≠ Every-from-sometimes', () => {
    const e  = unwrapD1(pipeline('s("bd").every(2, x => x.fast(2))'))
    const s  = unwrapD1(pipeline('s("bd hh").sometimes(x => x.fast(2))'))
    // every → Every tag with userMethod 'every'
    expect(e.tag).toBe('Every')
    expect((e as { userMethod?: string }).userMethod).toBe('every')
    // sometimes → Choice tag with userMethod 'sometimes' (per applyMethod case)
    expect(s.tag).toBe('Choice')
    expect((s as { userMethod?: string }).userMethod).toBe('sometimes')
  })

  it('Param-from-gain has userMethod gain (not pan) — Phase 20-10 promotion', () => {
    const g = unwrapD1(pipeline('s("bd").gain(0.5)'))
    expect(g.tag).toBe('Param')
    expect((g as { userMethod?: string }).userMethod).toBe('gain')
  })
})

// ---------------------------------------------------------------------------
// T-10.c — Orphan-metadata recursive walk for every regression fixture.
//          (assertNoStageMeta exported above for reuse.)
// ---------------------------------------------------------------------------

describe('parseStrudel stages — orphan stage-metadata walk over fixtures (T-10.c, D-06.c)', () => {
  const fixtures = [
    's("bd hh sd cp").jux(x => x.gain(0.5))',
    's("bd hh sd cp").off(0.125, x => x.gain(0.5))',
    'note("c d e").layer(x => x.add("0,2"))',
    's("bd hh sd cp").struct("1 0 1 0")',
    's("bd hh").ply(2)',
    's("bd").fast(2).late(0.125).gain(0.5)',
    '$: s("bd").fast(2)\n$: s("hh").late(0.125)',
  ]
  for (const code of fixtures) {
    it(`no stage metadata in any view — ${JSON.stringify(code).slice(0, 50)}`, () => {
      for (const stage of parseStrudelStages(code)) assertNoStageMeta(stage.ir)
    })
  }
})

// ---------------------------------------------------------------------------
// T-10.d — parseTransform recursion within CHAIN-APPLIED preserves arrow-body
//          offsets (PRE-01).
// ---------------------------------------------------------------------------

describe('parseStrudel stages — parseTransform recursion (T-10.d, PRE-01)', () => {
  it('every(2, x => x.late(0.125)) preserves arrow-body Late.loc.start at absolute dot offset', () => {
    const code = 's("bd").every(2, x => x.late(0.125))'
    const ir = unwrapD1(pipeline(code))
    // Walk: outer Every → inner body → Late (from arrow `x.late(0.125)`).
    expect(ir.tag).toBe('Every')
    if (ir.tag !== 'Every') throw new Error('unreachable')
    expect(ir.loc?.[0]?.start).toBe(code.indexOf('.every'))
    // The transform-body Late lives at Every.body. Inside the arrow,
    // `x.late(0.125)` — the `.late` dot is at the absolute offset of the
    // dot inside the source.
    expect(ir.body.tag).toBe('Late')
    if (ir.body.tag !== 'Late') throw new Error('unreachable')
    // The dot before `.late` inside the arrow body is at:
    //   index of `x.late` in source - 0 (since it's `x.late(...)`)
    // We just assert it's non-zero (PRE-01: arrow-body offsets preserved).
    expect(ir.body.loc?.[0]?.start).toBeGreaterThan(0)
    // Specifically: the dot before `.late` in `x => x.late(0.125)` is the
    // character at `code.indexOf('x.late') + 1` (the `.` after `x`).
    const dotPos = code.indexOf('x.late') + 1
    expect(ir.body.loc?.[0]?.start).toBe(dotPos)
  })
})
