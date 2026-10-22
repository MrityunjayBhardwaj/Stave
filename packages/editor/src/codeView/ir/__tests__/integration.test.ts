/**
 * Integration tests: code string → parse → PatternIR → toStrudel, plus the
 * behaviour-free structural walk (structuralWalk / walkLeafItems) that carries
 * lane identity + source loc off the parsed IR. Onset behaviour now comes from
 * Strudel's eval, not from a hand-rolled interpreter.
 *
 * No Strudel runtime required — parser works on strings, not Pattern objects.
 */

import { describe, it, expect } from 'vitest'
import { parseMini, bjorklund } from '../parseMini'
import { parseStrudel as _parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import { patternToJSON, patternFromJSON } from '../serialize'
import { walkLeafItems } from '../structuralWalk'
import { buildNodeLocIndex } from '../nodeIdentity'
import { IR, type PatternIR } from '../PatternIR'
import { unwrapD1 } from './helpers/unwrapD1'

// Phase 20-11 γ-4 — drill through the synthetic d1 Track wrapper that
// parseStrudel adds at the root of any non-`$:` input. Pre-20-11 tests
// asserted on the inner shape (Seq, Stack, Param, ...) directly; this
// shim restores that contract without site-by-site rewrites at every
// `parseStrudel(...).tag === 'Foo'` callsite. Tests that need the raw
// (Track-wrapped) IR — multi-`$:` Stack roots, `.p()`-wrapped Tracks,
// the new wave-α/γ shape probes — import _parseStrudel directly.
const parseStrudel = (code: string): PatternIR => unwrapD1(_parseStrudel(code))

// ---------------------------------------------------------------------------
// parseMini
// ---------------------------------------------------------------------------

describe('parseMini', () => {
  it('parses simple sequence', () => {
    const tree = parseMini('c4 e4 g4')
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      expect(tree.children).toHaveLength(3)
      expect(tree.children[0].tag).toBe('Play')
    }
  })

  it('parses rest', () => {
    const tree = parseMini('c4 ~ e4')
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      expect(tree.children[1].tag).toBe('Sleep')
    }
  })

  it('parses cycle with angle brackets', () => {
    const tree = parseMini('<c4 e4 g4>')
    expect(tree.tag).toBe('Cycle')
    if (tree.tag === 'Cycle') {
      expect(tree.items).toHaveLength(3)
      expect(tree.items[0].tag).toBe('Play')
    }
  })

  it('parses sub-sequence with brackets', () => {
    const tree = parseMini('[c4 e4] g4')
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      expect(tree.children).toHaveLength(2)
      expect(tree.children[0].tag).toBe('Seq') // sub-sequence
    }
  })

  it('parses repeat with *', () => {
    const tree = parseMini('c4*2')
    expect(tree.tag).toBe('Fast')
    if (tree.tag === 'Fast') {
      expect(tree.factor).toBe(2)
      expect(tree.body.tag).toBe('Play')
    }
  })

  it('parses sometimes with ?', () => {
    const tree = parseMini('c4?')
    expect(tree.tag).toBe('Choice')
    if (tree.tag === 'Choice') {
      expect(tree.p).toBe(0.5)
    }
  })

  it('empty string returns Pure', () => {
    expect(parseMini('')).toEqual(IR.pure())
  })

  it('single note returns Play', () => {
    const tree = parseMini('c4')
    expect(tree.tag).toBe('Play')
    if (tree.tag === 'Play') expect(tree.note).toBe('c4')
  })

  it('sample mode sets s param', () => {
    const tree = parseMini('bd sd hh', true)
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      const first = tree.children[0]
      if (first.tag === 'Play') {
        expect(first.params.s).toBe('bd')
      }
    }
  })

  it('unrecognized token preserved as Play note', () => {
    // Forward compatible: unknown atoms become Play nodes
    const tree = parseMini('xyz123')
    expect(tree.tag).toBe('Play')
  })

  // ---- Tier 2: slice ----------------------------------------------------

  describe('slice (a:N)', () => {
    it('attaches slice index to a sample Play.params', () => {
      const tree = parseMini('bd:2', true)
      expect(tree.tag).toBe('Play')
      if (tree.tag === 'Play') {
        expect(tree.params.s).toBe('bd')
        expect(tree.params.slice).toBe(2)
      }
    })

    it('non-sample mode still records the slice index', () => {
      const tree = parseMini('c4:1')
      expect(tree.tag).toBe('Play')
      if (tree.tag === 'Play') expect(tree.params.slice).toBe(1)
    })

    it('composes with repeat — slice resolves first, then *N wraps', () => {
      const tree = parseMini('bd:2*3', true)
      // Fast(3, Play(bd, slice:2))
      expect(tree.tag).toBe('Fast')
      if (tree.tag === 'Fast') {
        expect(tree.factor).toBe(3)
        if (tree.body.tag === 'Play') expect(tree.body.params.slice).toBe(2)
      }
    })

    it('mixes with plain atoms in a sequence', () => {
      const tree = parseMini('bd bd:1 bd:2', true)
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        expect(tree.children).toHaveLength(3)
        const slices = tree.children
          .map(c => (c.tag === 'Play' ? c.params.slice : undefined))
        expect(slices).toEqual([undefined, 1, 2])
      }
    })

    it('rejects negative or non-numeric slice — falls through silently', () => {
      // The character after `:` is not a digit, so the colon stays with
      // the next token (or is dropped). Atom is parsed without slice.
      const tree = parseMini('bd:abc', true)
      // We don't promise an exact shape for malformed input — just that
      // it doesn't throw and Play.slice isn't set.
      const play = tree.tag === 'Play' ? tree
        : tree.tag === 'Seq' ? (tree.children[0].tag === 'Play' ? tree.children[0] : null)
        : null
      if (play) expect(play.params.slice).toBeUndefined()
    })
  })

  // ---- Tier 2: elongation -----------------------------------------------

  describe('elongation (a@N)', () => {
    it('wraps a single atom in Elongate', () => {
      const tree = parseMini('c4@2')
      expect(tree.tag).toBe('Elongate')
      if (tree.tag === 'Elongate') {
        expect(tree.factor).toBe(2)
        expect(tree.body.tag).toBe('Play')
      }
    })

    it('inside a sequence — elongated child carries weight', () => {
      const tree = parseMini('c4@2 e4')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        expect(tree.children).toHaveLength(2)
        expect(tree.children[0].tag).toBe('Elongate')
        expect(tree.children[1].tag).toBe('Play')
      }
    })

    it('non-integer factor allowed (1.5x)', () => {
      const tree = parseMini('c4@1.5')
      expect(tree.tag).toBe('Elongate')
      if (tree.tag === 'Elongate') expect(tree.factor).toBe(1.5)
    })

    it('zero/negative factors are silently dropped', () => {
      const tree = parseMini('c4@0')
      expect(tree.tag).toBe('Play') // no Elongate wrapper
    })
  })

  // ---- Tier 2: Euclidean ------------------------------------------------

  describe('bjorklund', () => {
    it('canonical 3 over 8 = [1 0 0 1 0 0 1 0]', () => {
      expect(bjorklund(3, 8)).toEqual([true, false, false, true, false, false, true, false])
    })
    /**
     * This test's TITLE has been correct since it was written, and its BODY
     * checked none of it — it asserted only "5 onsets somewhere in 8 slots",
     * which the broken distribution satisfied. The old code returned
     * 10101011; the title says 10110110, and 10110110 is what Strudel plays.
     * The title was right for three months while the body held no constraint.
     *
     * The comment that did it: "the exact distribution depends on the
     * Bjorklund variant used". There is no variant freedom here — the grid is
     * a VIEW of what Strudel triggers, so exactly one distribution is correct,
     * and it is upstream's. Asserting the title (#907).
     */
    it('5 over 8 = [1 0 1 1 0 1 1 0]', () => {
      expect(bjorklund(5, 8)).toEqual([true, false, true, true, false, true, true, false])
    })
    it('hits >= steps fills with onsets', () => {
      expect(bjorklund(8, 8)).toEqual(new Array(8).fill(true))
    })
    it('zero hits → all rests', () => {
      expect(bjorklund(0, 4)).toEqual([false, false, false, false])
    })
  })

  describe('Euclidean (a(h,s,r?))', () => {
    it('bd(3,8) expands to a Seq of 8 slots', () => {
      const tree = parseMini('bd(3,8)', true)
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        expect(tree.children).toHaveLength(8)
        const onsets = tree.children.filter(c => c.tag === 'Play').length
        const rests = tree.children.filter(c => c.tag === 'Sleep').length
        expect(onsets).toBe(3)
        expect(rests).toBe(5)
      }
    })

    it('rotation rolls the pattern by N steps', () => {
      const a = parseMini('bd(3,8)', true)
      const b = parseMini('bd(3,8,2)', true)
      // Both have same onset count, different placement.
      const onsetsAt = (t: PatternIR) =>
        t.tag === 'Seq'
          ? t.children.map((c, i) => (c.tag === 'Play' ? i : -1)).filter(i => i >= 0)
          : []
      const ai = onsetsAt(a)
      const bi = onsetsAt(b)
      expect(ai).not.toEqual(bi)
      expect(ai.length).toBe(bi.length)
    })

    it('a(3,3) = a a a (no rests)', () => {
      const tree = parseMini('bd(3,3)', true)
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        expect(tree.children.every(c => c.tag === 'Play')).toBe(true)
        expect(tree.children).toHaveLength(3)
      }
    })

    it('malformed (only one arg) is opaque, not a fabricated atom', () => {
      const tree = parseMini('bd(3)', true)
      // krill — the grammar authority — REJECTS a euclid with one arg, so
      // `s("bd(3)")` throws in Strudel too: it never plays. The hand parser
      // dropped the euclid token and kept a `Play bd` that no audio matched;
      // #943 degrades to the opaque Code fallback instead of inventing a note.
      expect(tree.tag).toBe('Code')
    })

    it('combines with repeat: bd(3,8)*2 wraps in Fast', () => {
      const tree = parseMini('bd(3,8)*2', true)
      expect(tree.tag).toBe('Fast')
      if (tree.tag === 'Fast') {
        expect(tree.factor).toBe(2)
        expect(tree.body.tag).toBe('Seq')
      }
    })
  })

  // ---- Tier 2: polymetric ----------------------------------------------

  describe('polymetric ({a b, c d})', () => {
    it('two-segment polymeter lowers to Stack', () => {
      const tree = parseMini('{c4 e4, g4 b4 d5}')
      expect(tree.tag).toBe('Stack')
      if (tree.tag === 'Stack') {
        expect(tree.tracks).toHaveLength(2)
      }
    })

    it('each segment can have any of the existing structures inside', () => {
      const tree = parseMini('{c4 e4, [g4 b4]*2, <a4 d5>}')
      expect(tree.tag).toBe('Stack')
      if (tree.tag === 'Stack') {
        expect(tree.tracks).toHaveLength(3)
      }
    })

    it('single segment (no comma) just inlines the sub-sequence', () => {
      const tree = parseMini('{c4 e4 g4}')
      expect(tree.tag).toBe('Seq') // not Stack
    })

    it('empty polymeter is opaque (krill rejects it)', () => {
      const tree = parseMini('{}')
      // krill rejects an empty polymeter, so this is not valid mini at all.
      // The hand parser emitted Pure (a silent no-op); #943 keeps the source
      // visible as opaque Code rather than swallowing syntax Strudel refuses.
      expect(['Pure', 'Code']).toContain(tree.tag)
    })

    it('polymetric inside a sequence parses as one element', () => {
      const tree = parseMini('c4 {e4, g4 b4} a4')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        expect(tree.children).toHaveLength(3)
        expect(tree.children[1].tag).toBe('Stack')
      }
    })
  })

  // ---- Source-location tracking ----------------------------------------

  describe('Play.loc — source-range tracking', () => {
    it('single atom carries its char range', () => {
      const tree = parseMini('c4')
      expect(tree.tag).toBe('Play')
      if (tree.tag === 'Play') {
        expect(tree.loc).toEqual([{ start: 0, end: 2 }])
      }
    })

    it('atoms in a sequence carry distinct ranges', () => {
      const tree = parseMini('c4 e4 g4')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        const locs = tree.children.map(c =>
          c.tag === 'Play' ? c.loc?.[0] : null,
        )
        expect(locs).toEqual([
          { start: 0, end: 2 },
          { start: 3, end: 5 },
          { start: 6, end: 8 },
        ])
      }
    })

    it('baseOffset shifts every atom by the same amount', () => {
      const tree = parseMini('c4 e4', false, 100)
      if (tree.tag === 'Seq' && tree.children[0].tag === 'Play') {
        expect(tree.children[0].loc).toEqual([{ start: 100, end: 102 }])
      }
    })

    it('atoms inside sub-sequences keep accurate offsets', () => {
      // [c4 e4] g4 — c4 at 1-3, e4 at 4-6, g4 at 8-10
      const tree = parseMini('[c4 e4] g4')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        const sub = tree.children[0]
        const last = tree.children[1]
        if (sub.tag === 'Seq' && sub.children[0].tag === 'Play') {
          expect(sub.children[0].loc).toEqual([{ start: 1, end: 3 }])
        }
        if (last.tag === 'Play') {
          expect(last.loc).toEqual([{ start: 8, end: 10 }])
        }
      }
    })

    it('atoms inside a polymeter keep accurate offsets', () => {
      // {c4, e4} — c4 at 1-3, e4 at 5-7
      const tree = parseMini('{c4, e4}')
      expect(tree.tag).toBe('Stack')
      if (tree.tag === 'Stack') {
        const a = tree.tracks[0]
        const b = tree.tracks[1]
        if (a.tag === 'Play') expect(a.loc).toEqual([{ start: 1, end: 3 }])
        if (b.tag === 'Play') expect(b.loc).toEqual([{ start: 5, end: 7 }])
      }
    })
  })

  // ---- structuralWalk carries Play.loc → LaneItem.loc ------------------

  describe('structuralWalk carries Play.loc → LaneItem.loc', () => {
    it('leaf items carry the loc set on their producing Play node', () => {
      const tree = parseMini('c4 e4', false, 50)
      const items = walkLeafItems(tree, 1)
      expect(items.map(it => it.loc?.[0])).toEqual([
        { start: 50, end: 52 },
        { start: 53, end: 55 },
      ])
    })

    it('Play built without loc produces items with loc undefined', () => {
      const items = walkLeafItems(IR.play('c4'), 1)
      expect(items[0].loc).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// parseStrudel
// ---------------------------------------------------------------------------

describe('parseStrudel', () => {
  it('parses note("c4 e4 g4")', () => {
    const tree = parseStrudel('note("c4 e4 g4")')
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      expect(tree.children).toHaveLength(3)
      const first = tree.children[0]
      if (first.tag === 'Play') expect(first.note).toBe('c4')
    }
  })

  it('parses s("bd sd")', () => {
    const tree = parseStrudel('s("bd sd")')
    expect(tree.tag).toBe('Seq')
    if (tree.tag === 'Seq') {
      const first = tree.children[0]
      if (first.tag === 'Play') {
        expect(first.note).toBe('bd')
        expect(first.params.s).toBe('bd')
      }
    }
  })

  it('parses .fast(2)', () => {
    const tree = parseStrudel('s("bd sd").fast(2)')
    expect(tree.tag).toBe('Fast')
    if (tree.tag === 'Fast') {
      expect(tree.factor).toBe(2)
      expect(tree.body.tag).toBe('Seq')
    }
  })

  it('parses .slow(3)', () => {
    const tree = parseStrudel('note("c4").slow(3)')
    expect(tree.tag).toBe('Slow')
    if (tree.tag === 'Slow') expect(tree.factor).toBe(3)
  })

  it('parses .every(4, fast(2))', () => {
    const tree = parseStrudel('note("c4").every(4, fast(2))')
    expect(tree.tag).toBe('Every')
    if (tree.tag === 'Every') {
      expect(tree.n).toBe(4)
      expect(tree.body.tag).toBe('Fast')
    }
  })

  it('parses stack(a, b)', () => {
    const tree = parseStrudel('stack(s("bd"), note("c4"))')
    expect(tree.tag).toBe('Stack')
    if (tree.tag === 'Stack') {
      expect(tree.tracks).toHaveLength(2)
    }
  })

  it('parses multi-track $: syntax', () => {
    const code = '$: s("bd sd").p("d1")\n$: note("c4 e4").p("m1")'
    const tree = parseStrudel(code)
    expect(tree.tag).toBe('Stack')
    if (tree.tag === 'Stack') {
      expect(tree.tracks).toHaveLength(2)
    }
  })

  // 20-17 E-1 — input updated. The original `const x = 42; note(x)` is now
  // resolvable end-to-end: D-01 G3 (additive Code.via literal arm via
  // `classifyLiteralRhs`, per the LOCKED D-02 CORRECTION 2026-05-19 — "Strudel
  // code IS JavaScript; standard JS literal bindings are first-class and MUST
  // be supported") + D-01 G4 (optional `bindings` threaded through every
  // recursion) splice the literal `42` into the chain arg. The purpose of this
  // test — "verify graceful Code fallback for opaque code" — is preserved by
  // replacing the input with a genuinely-still-opaque post-D-01 case:
  // `foo() + 1` is a function call + arithmetic → bareCode RHS → opaque
  // post-fixpoint terminal → graceful Code fallback. The complementary
  // assertion on the original input lives below as
  // `bound-literal binding resolves end-to-end (D-01 G3+G4)`.
  it('unsupported code returns Code node', () => {
    const tree = parseStrudel('const x = foo() + 1; note(x)')
    expect(tree.tag).toBe('Code')
    if (tree.tag === 'Code') {
      expect(tree.code).toContain('const x')
    }
  })

  // 20-17 E-1 — complementary test documenting the new D-01 contract.
  // `const x = 42; note(x)` was previously graceful-Code (pre-D-01 invariant).
  // Per the LOCKED D-02 CORRECTION (2026-05-19), it now structures: the literal
  // `42` is recognised by `classifyLiteralRhs` and spliced into the chain arg.
  // Asserts: the result is NOT bare Code, AND a `Code.via` literal arm
  // with `raw === '42'` appears at the splice site (term-spliced subtree).
  it('bound-literal binding resolves end-to-end (D-01 G3+G4)', () => {
    const tree = parseStrudel('const x = 42; note(x)')
    // Not bare Code — D-01 resolved the binding and structured the program.
    const isBareCode =
      tree.tag === 'Code' && (tree as { via?: unknown }).via === undefined
    expect(isBareCode).toBe(false)
    // Locate the spliced `Code.via { literal:true; raw:'42' }` node by
    // walking the tree. The exact wrapper tag depends on how `note(x)`
    // structures post-substitution; the load-bearing invariant is the
    // literal arm's presence + raw equality.
    const found: { literal: true; raw: string }[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const obj = node as Record<string, unknown>
      const via = obj.via
      if (
        via &&
        typeof via === 'object' &&
        (via as Record<string, unknown>).literal === true
      ) {
        found.push(via as { literal: true; raw: string })
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(tree)
    expect(found.length).toBeGreaterThan(0)
    expect(found.some((v) => v.raw === '42')).toBe(true)
  })

  it('empty string returns Pure', () => {
    expect(parseStrudel('')).toEqual(IR.pure())
  })

  it('never throws on any input', () => {
    const inputs = [
      'note("c4")',
      'invalid syntax ??? !!!',
      '',
      'stack()',
      '.fast(2)',
      '{ broken json',
    ]
    for (const input of inputs) {
      expect(() => parseStrudel(input)).not.toThrow()
    }
  })

  it('parses .room(0.8) as Param (#944 — the FX→Param collapse)', () => {
    // Pre-#944 a numeric-arg control tagged FX; now it routes through the
    // control registry and classifies as Param under the canonical key.
    const tree = parseStrudel('note("c4").room(0.8)')
    expect(tree.tag).toBe('Param')
    if (tree.tag === 'Param') {
      expect(tree.key).toBe('room')
      expect(tree.value).toBe(0.8)
    }
  })

  it('parses .late(0.125) into Late tag (Tier 4)', () => {
    const tree = parseStrudel('s("bd").late(0.125)')
    expect(tree.tag).toBe('Late')
    if (tree.tag === 'Late') {
      expect(tree.offset).toBe(0.125)
      // Body is the parsed `s("bd")` — a single Play (parseMini collapses
      // single-token sequences to a bare Play, see parseMini.ts).
      expect(tree.body.tag).toBe('Play')
      if (tree.body.tag === 'Play') expect(tree.body.params.s).toBe('bd')
    }
  })

  it('parses .late(0.5) on a multi-token sequence into Late wrapping a Seq', () => {
    const tree = parseStrudel('note("c4 e4 g4").late(0.5)')
    expect(tree.tag).toBe('Late')
    if (tree.tag === 'Late') {
      expect(tree.offset).toBe(0.5)
      expect(tree.body.tag).toBe('Seq')
    }
  })

  it('parses .jux(x => x.gain(0.5)) into Stack(Param(pan,-1, body), Param(pan,+1, transform(body))) (Tier 4)', () => {
    // Ground truth: pattern.mjs:2379-2381 (jux) + 2356-2368 (juxBy):
    //   jux(f)(pat) = juxBy(1, f, pat)
    //   juxBy(1, …) halves to by=0.5, splits onto two pans:
    //     left  = pat with pan = (default 0.5) - 0.5 = 0.0  (Strudel [0,1])
    //     right = f(pat with pan = (default 0.5) + 0.5 = 1.0)
    // Mapping to our IR's [-1, 1] pan convention: Strudel 0.0 → ours -1,
    // Strudel 1.0 → ours +1. The parity harness normalises Strudel-side
    // events before diff (normalizeStrudelPan).
    const tree = parseStrudel('s("bd hh sd cp").jux(x => x.gain(0.5))')
    expect(tree.tag).toBe('Stack')
    if (tree.tag === 'Stack') {
      expect(tree.tracks.length).toBe(2)
      const [left, right] = tree.tracks
      expect(left.tag).toBe('Param')
      if (left.tag === 'Param') {
        expect(left.key).toBe('pan')
        expect(left.value).toBe(-1)
        expect(left.userMethod).toBeUndefined()   // the synthetic-marker flag
      }
      expect(right.tag).toBe('Param')
      if (right.tag === 'Param') {
        expect(right.key).toBe('pan')
        expect(right.value).toBe(1)
        expect(right.userMethod).toBeUndefined()
        // Right body is the transformed body — Phase 20-10 promoted gain to
        // the Param tag. #967 deleted the FX tag; jux's synthetic pans are now
        // Param('pan', ±1) with no userMethod (was FX(pan,±1)).
        expect(right.body.tag).toBe('Param')
        if (right.body.tag === 'Param') {
          expect(right.body.key).toBe('gain')
          expect(right.body.value).toBe(0.5)
        }
      }
    }
  })

  it('parses .off(0.25, x => x.fast(2)) into Stack(body, Fast(2, Late(0.25, body))) (Tier 4)', () => {
    // Ground truth: pattern.mjs:2236-2238
    //   off(time_pat, func, pat) = stack(pat, func(pat.late(time_pat)))
    // The transform is applied to `pat.late(t)`, so Late is INSIDE the
    // transform, not outside. Our desugar mirrors that order exactly.
    const tree = parseStrudel('s("bd").off(0.25, x => x.fast(2))')
    expect(tree.tag).toBe('Stack')
    if (tree.tag === 'Stack') {
      expect(tree.tracks.length).toBe(2)
      // Left track is the original body (s("bd") — a Play).
      expect(tree.tracks[0].tag).toBe('Play')
      // Right track is Fast(2, Late(0.25, body)) — transform OUTSIDE Late.
      const right = tree.tracks[1]
      expect(right.tag).toBe('Fast')
      if (right.tag === 'Fast') {
        expect(right.factor).toBe(2)
        expect(right.body.tag).toBe('Late')
        if (right.body.tag === 'Late') {
          expect(right.body.offset).toBe(0.25)
          expect(right.body.body.tag).toBe('Play')
        }
      }
    }
  })

  it('parses .ply(3) into Ply(3, body) (Tier 4)', () => {
    // Ground truth: pattern.mjs:1905-1911. Originally planned as a desugar
    // to Fast(n, Seq(body × n)); a W4 T10 probe showed our Fast scales
    // ctx.speed and so compresses events instead of re-playing them, so
    // the desugar fails parity. Promoted to a forced new tag.
    const tree = parseStrudel('s("bd hh sd cp").ply(3)')
    expect(tree.tag).toBe('Ply')
    if (tree.tag === 'Ply') {
      expect(tree.n).toBe(3)
      expect(tree.body.tag).toBe('Seq')
    }
  })

  it('parses .ply(2.5) as opaque wrapper over the body (D-03 / PV37 — phase 20-04)', () => {
    // CONTEXT D-02 / RESEARCH §2.4: non-integer / pattern factors used to
    // fall through to the body unchanged (silent drop — P33). Phase 20-04
    // D-03 lifts the failure branch into wrapAsOpaque, so .ply(2.5)
    // produces a Code-with-via wrapper whose inner is the receiver Seq.
    // The body remains observable via via.inner; the .ply(2.5) call site
    // is no longer silently dropped.
    const tree = parseStrudel('s("bd hh sd cp").ply(2.5)')
    expect(tree.tag).toBe('Code')
    if (tree.tag !== 'Code') return
    expect(tree.via?.method).toBe('ply')
    expect(tree.via?.args).toBe('2.5')
    expect(tree.via?.inner.tag).toBe('Seq')
  })

  // Phase 19-04 T-02 — Pick tag shape tests.
  it('parses .pick([…]) into Pick(selector, lookup) (Tier 4)', () => {
    // Ground truth: pick.mjs:44-54. First IR shape carrying a list of
    // sub-patterns as data. Receiver becomes selector; array-literal
    // arg becomes lookup[].
    const tree = parseStrudel('mini("<0 1 2 3>").pick(["c","e","g","b"])')
    expect(tree.tag).toBe('Pick')
    if (tree.tag === 'Pick') {
      expect(tree.lookup.length).toBe(4)
      // Selector is the parsed mini-notation (Cycle of Plays).
      expect(tree.selector.tag).toBe('Cycle')
      // Each lookup element is a Play — bare strings get wrapped in
      // note(...) by parseArrayLiteralElement (default receiver context
      // = 'note' in v1).
      for (const elem of tree.lookup) {
        expect(['Play', 'Seq']).toContain(elem.tag)
      }
    }
  })

  it('IR.pick smart constructor produces well-formed Pick node', () => {
    const sel = IR.cycle(IR.play(0), IR.play(1))
    const lookup = [IR.play('c'), IR.play('e')]
    const node = IR.pick(sel, lookup)
    expect(node.tag).toBe('Pick')
    if (node.tag === 'Pick') {
      expect(node.selector).toBe(sel)
      expect(node.lookup).toEqual(lookup)
    }
  })

  it('toStrudel(Pick) round-trips to .pick([…])', () => {
    const sel = IR.cycle(IR.play(0), IR.play(1))
    const lookup = [IR.play('c'), IR.play('e')]
    const node = IR.pick(sel, lookup)
    const code = toStrudel(node)
    expect(code).toContain('.pick([')
    expect(code).toContain(', ')  // separator between elements
  })

  it('parseArrayLiteralElement wraps bare quoted strings in note() (v1 receiver default)', () => {
    // The docstring shape `pick(["g a", ...])` requires bare-string
    // wrapping per RESEARCH §1.4 / pre-mortem #10. Verify the wrapped
    // result is a parseable Play / Seq, not a Code fallback.
    const tree = parseStrudel('mini("<0 1>").pick(["c", "e"])')
    expect(tree.tag).toBe('Pick')
    if (tree.tag === 'Pick') {
      // Each lookup element should be a Play with the bare string as note.
      expect(tree.lookup[0].tag).toBe('Play')
      expect(tree.lookup[1].tag).toBe('Play')
      if (tree.lookup[0].tag === 'Play') expect(tree.lookup[0].note).toBe('c')
      if (tree.lookup[1].tag === 'Play') expect(tree.lookup[1].note).toBe('e')
    }
  })

  // Phase 19-04 T-03 — Struct tag shape tests.
  it('parses .struct("…") into Struct(mask, body) (Tier 4)', () => {
    // Ground truth: pattern.mjs:1161 — struct(mask) = this.keepif.out(mask).
    // Re-times body's value-stream to mask onsets; distinct from When/.mask
    // (which only gates). RESEARCH §1.2.
    const tree = parseStrudel('note("c d e").struct("x ~ x")')
    expect(tree.tag).toBe('Struct')
    if (tree.tag === 'Struct') {
      expect(tree.mask).toBe('x ~ x')
      expect(tree.body.tag).toBe('Seq')
    }
  })

  it('IR.struct smart constructor produces well-formed Struct node', () => {
    const body = IR.play('c4')
    const node = IR.struct('x ~ x ~', body)
    expect(node.tag).toBe('Struct')
    if (node.tag === 'Struct') {
      expect(node.mask).toBe('x ~ x ~')
      expect(node.body).toBe(body)
    }
  })

  it('toStrudel(Struct) round-trips to .struct("…")', () => {
    const node = IR.struct('x ~ x ~', IR.play('c4'))
    const code = toStrudel(node)
    expect(code).toContain('.struct("x ~ x ~")')
  })

  // Phase 19-04 T-04 — Swing tag shape tests (D-03 narrow shape).
  it('parses .swing(n) into Swing(n, body) (Tier 4, narrow per D-03)', () => {
    // Ground truth: pattern.mjs:2193 — swing(n) = pat.swingBy(1/3, n) =
    // pat.inside(n, late(seq(0, 1/6))). Modeled directly without an
    // Inside primitive (deferred). RESEARCH §1.3.
    const tree = parseStrudel('s("hh*8").swing(4)')
    expect(tree.tag).toBe('Swing')
    if (tree.tag === 'Swing') {
      expect(tree.n).toBe(4)
    }
  })

  it('IR.swing smart constructor produces well-formed Swing node with NO additional fields (Pre-mortem #6)', () => {
    // Locked shape: { tag, n, body } only — keeps migration cheap when an
    // Inside primitive lands later.
    const body = IR.play('c4')
    const node = IR.swing(4, body)
    expect(node.tag).toBe('Swing')
    if (node.tag === 'Swing') {
      expect(node.n).toBe(4)
      expect(node.body).toBe(body)
      // No additional fields — guards Pre-mortem #6 (Inside-someday churn).
      expect(Object.keys(node).sort()).toEqual(['body', 'n', 'tag'])
    }
  })

  it('toStrudel(Swing) round-trips to .swing(n)', () => {
    const node = IR.swing(4, IR.play('c4'))
    const code = toStrudel(node)
    expect(code).toContain('.swing(4)')
  })

  // Phase 19-04 T-05 — Shuffle + Scramble shape tests.
  it('IR.shuffle smart constructor produces well-formed Shuffle node', () => {
    const body = IR.play('c4')
    const node = IR.shuffle(4, body)
    expect(node.tag).toBe('Shuffle')
    if (node.tag === 'Shuffle') {
      expect(node.n).toBe(4)
      expect(node.body).toBe(body)
      expect(Object.keys(node).sort()).toEqual(['body', 'n', 'tag'])
    }
  })

  it('IR.scramble smart constructor produces well-formed Scramble node', () => {
    const body = IR.play('c4')
    const node = IR.scramble(4, body)
    expect(node.tag).toBe('Scramble')
    if (node.tag === 'Scramble') {
      expect(node.n).toBe(4)
      expect(node.body).toBe(body)
      expect(Object.keys(node).sort()).toEqual(['body', 'n', 'tag'])
    }
  })

  it('toStrudel(Shuffle) round-trips to .shuffle(n)', () => {
    const node = IR.shuffle(4, IR.play('c4'))
    expect(toStrudel(node)).toContain('.shuffle(4)')
  })

  it('toStrudel(Scramble) round-trips to .scramble(n)', () => {
    const node = IR.scramble(4, IR.play('c4'))
    expect(toStrudel(node)).toContain('.scramble(4)')
  })

  // Phase 19-04 T-08 — Chop shape tests (pattern-level only per D-04).
  it('IR.chop smart constructor produces well-formed Chop node', () => {
    const body = IR.play('bd', 0.25, { s: 'bd' })
    const node = IR.chop(4, body)
    expect(node.tag).toBe('Chop')
    if (node.tag === 'Chop') {
      expect(node.n).toBe(4)
      expect(node.body).toBe(body)
      expect(Object.keys(node).sort()).toEqual(['body', 'n', 'tag'])
    }
  })

  it('toStrudel(Chop) round-trips to .chop(n)', () => {
    const node = IR.chop(4, IR.play('bd', 1, { s: 'bd' }))
    expect(toStrudel(node)).toContain('.chop(4)')
  })

  it('parseStrudel routes .chop(n) to Chop tag', () => {
    const ir = parseStrudel('s("bd").chop(4)')
    expect(ir.tag).toBe('Chop')
    if (ir.tag === 'Chop') {
      expect(ir.n).toBe(4)
    }
  })

  describe('source-range tracking', () => {
    it('single-line note("c4 e4") — Play.loc points at exact char ranges', () => {
      // 0123456789012345
      // note("c4 e4")
      // c4 at 6-8, e4 at 9-11
      const tree = parseStrudel('note("c4 e4")')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        const c = tree.children[0]
        const e = tree.children[1]
        if (c.tag === 'Play') expect(c.loc).toEqual([{ start: 6, end: 8 }])
        if (e.tag === 'Play') expect(e.loc).toEqual([{ start: 9, end: 11 }])
      }
    })

    it('s("bd sd") — sample atoms also carry loc', () => {
      // s("bd sd")
      // bd at 3-5, sd at 6-8
      const tree = parseStrudel('s("bd sd")')
      expect(tree.tag).toBe('Seq')
      if (tree.tag === 'Seq') {
        const a = tree.children[0]
        const b = tree.children[1]
        if (a.tag === 'Play') expect(a.loc).toEqual([{ start: 3, end: 5 }])
        if (b.tag === 'Play') expect(b.loc).toEqual([{ start: 6, end: 8 }])
      }
    })

    it('multi-track $: blocks each map to their own absolute offsets', () => {
      // $: note("c4 e4")\n$: s("bd sd")
      // 0  3       11
      // c4 at 9-11 of code; bd at first char after `$: s("` of second track
      const code = '$: note("c4 e4")\n$: s("bd sd")'
      const tree = parseStrudel(code)
      expect(tree.tag).toBe('Stack')
      if (tree.tag === 'Stack') {
        // First track: note("c4 e4") with `$: ` prefix → body starts
        // at offset 3, then `note("` is 6 chars → c4 at 3+6=9
        const t0 = tree.tracks[0]
        if (t0.tag === 'Seq' && t0.children[0].tag === 'Play') {
          expect(t0.children[0].loc?.[0].start).toBe(9)
        }
        // Second track: `$: s("` prefix. Code length up to second $: is
        // 17 ('$: note("c4 e4")\n'). After `$: ` body offset = 17+3=20.
        // Then `s("` is 3 chars → bd at 20+3=23.
        const t1 = tree.tracks[1]
        if (t1.tag === 'Seq' && t1.children[0].tag === 'Play') {
          expect(t1.children[0].loc?.[0]).toEqual({ start: 23, end: 25 })
        }
      }
    })

    it('leaf items carry loc all the way through the structural walk', () => {
      // PV36 / D-01 — multi-range loc, innermost first. The atom range
      // ("c4" / "e4") stays at loc[0]; Seq's wrapping range (the whole
      // mini-notation string source) is appended at loc[1+].
      const items = walkLeafItems(parseStrudel('note("c4 e4")'), 1)
      expect(items).toHaveLength(2)
      expect(items[0].loc?.[0]).toEqual({ start: 6, end: 8 })
      expect(items[1].loc?.[0]).toEqual({ start: 9, end: 11 })
      // Non-empty loc on every leaf — the contract PV36 enforces.
      expect(items[0].loc!.length).toBeGreaterThanOrEqual(1)
      expect(items[1].loc!.length).toBeGreaterThanOrEqual(1)
    })

    it('opaque expressions contribute no structural leaves (mapping is unknown)', () => {
      // mystery(42) is opaque → a Code node with no modellable inner, so the
      // structural walk reaches no leaf and no loc is invented.
      expect(walkLeafItems(parseStrudel('mystery(42)'), 1)).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// Full pipeline integration
// ---------------------------------------------------------------------------

describe('full pipeline', () => {
  it('test 1: simple note pattern', () => {
    const input = 'note("c4 e4 g4")'
    const patternIR = parseStrudel(input)
    expect(patternIR.tag).toBe('Seq')
    if (patternIR.tag === 'Seq') expect(patternIR.children).toHaveLength(3)

    const code = toStrudel(patternIR)
    expect(code).toContain('c4')
    expect(code).toContain('e4')
    expect(code).toContain('g4')
  })

  it('test 2: drum pattern with fast', () => {
    const input = 's("bd sd hh hh").fast(2)'
    const patternIR = parseStrudel(input)
    expect(patternIR.tag).toBe('Fast')
    if (patternIR.tag === 'Fast') {
      expect(patternIR.factor).toBe(2)
      expect(patternIR.body.tag).toBe('Seq')
    }

    const code = toStrudel(patternIR)
    expect(code).toContain('.fast(2)')
  })

  it('test 3: stack (multi-track)', () => {
    const input = 'stack(s("bd sd"), note("c4 e4 g4"))'
    const patternIR = parseStrudel(input)
    expect(patternIR.tag).toBe('Stack')
    if (patternIR.tag === 'Stack') {
      expect(patternIR.tracks).toHaveLength(2)
    }

    const code = toStrudel(patternIR)
    expect(code).toContain('stack(')
  })

  it('test 4: every + transforms (cycle-dependent)', () => {
    const input = 'note("c4").every(4, fast(2))'
    const patternIR = parseStrudel(input)
    expect(patternIR.tag).toBe('Every')
    if (patternIR.tag === 'Every') {
      expect(patternIR.n).toBe(4)
      // cycle-0 fires the transformed body (Fast), other cycles the default.
      expect(patternIR.body.tag).toBe('Fast')
    }
  })

  it('test 5: cycle alternation', () => {
    const input = 'note("<c4 e4 g4>")'
    const patternIR = parseStrudel(input)
    // parseMini returns Cycle inside Seq(single item)
    const flat = flattenSingleSeq(patternIR)
    expect(flat.tag).toBe('Cycle')
    if (flat.tag === 'Cycle') {
      expect(flat.items).toHaveLength(3)
    }

    // The Cycle picks item[cycle % len] — a structural per-cycle selection the
    // walk reproduces without the behaviour interpreter.
    const perCycle = walkLeafItems(flat, 2)
    expect(perCycle.find((it) => it.cycle === 0)?.labelValue).toBe('c4')
    expect(perCycle.find((it) => it.cycle === 1)?.labelValue).toBe('e4')
  })

  it('test 6: JSON round-trip', () => {
    const input = 'note("c4 e4 g4")'
    const patternIR = parseStrudel(input)
    const json = patternToJSON(patternIR)
    const restored = patternFromJSON(json)
    const code1 = toStrudel(patternIR)
    const code2 = toStrudel(restored)
    expect(code1).toBe(code2)
  })

  // 20-17 E-1 — input updated. Same rationale as the integration test at
  // line ~462: `const x = 42; note(x)` is now resolvable end-to-end via
  // D-01 G3 (literal-RHS `Code.via` arm) + G4 (`bindings` threaded through
  // every recursion), per the LOCKED D-02 CORRECTION (2026-05-19). The
  // purpose of this test — "verify graceful Code fallback + round-trip
  // identity for unparseable code" — is preserved by replacing the input
  // with a genuinely-still-opaque post-D-01 case (`foo() + 1` → bareCode
  // RHS → opaque post-fixpoint terminal → graceful Code fallback). The
  // complementary post-D-01 round-trip on the original input is asserted
  // by the `bound-literal binding resolves end-to-end` test above and by
  // the parity-corpus + proto gates.
  it('test 7: unparseable code returns Code node (graceful fallback)', () => {
    const input = 'const x = foo() + 1; note(x)'
    const patternIR = parseStrudel(input)
    expect(patternIR.tag).toBe('Code')
    // toStrudel(Code) = original code
    expect(toStrudel(patternIR)).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// Phase 20-10 wave γ — Param sub-IR slot-table semantics (PLAN §5 γ-2).
//
// The behavioural slot-table pins (per-event evt.s / gain resolution, silence,
// numeric coercion, merge direction) were the retired collect engine's job —
// value resolution now comes from Strudel's eval, so those arms are gone. What
// remains here is STRUCTURAL: the Param sub-IR walk must preserve loc + node
// identity on the body leaves, and opaque methods must stay opaque.
// ---------------------------------------------------------------------------

describe('20-10 wave γ — Param sub-IR slot-table semantics', () => {
  // 7. Loc-position assertion (PV36 / RESEARCH Trap 10 second clause).
  // The first leaf's first loc atom should be inside `note("c d")` —
  // specifically the position of "c" inside the note string. NOT the
  // position of "bd" inside the s mini-string.
  it('note("c d").s("<bd cp>") leaves carry body-atom loc, NOT mini-string loc', () => {
    const code = 'note("c d").s("<bd cp>")'
    const items = walkLeafItems(parseStrudel(code), 1)
    const firstAtomStart = items[0].loc?.[0]?.start ?? -1
    const cPos = code.indexOf('"c d"') + 1 // position of "c"
    const bdPos = code.indexOf('"<bd cp>"') + 2 // position of "b" in "bd"
    expect(firstAtomStart).toBe(cPos)
    expect(firstAtomStart).not.toBe(bdPos)
  })

  // 9. No regression for opaque (PV37 preservation). #928 note: `release` is
  //    now a registry-classified control (Param), so a GENUINELY unrecognised
  //    method (`.notreal` — not a structural transform, not isControlName) is
  //    used here to keep exercising the opaque-wrap path.
  it('note("c").notreal(0.3) still produces a Code-with-via wrapper, NOT a Param', () => {
    const ir = parseStrudel('note("c").notreal(0.3)')
    expect(ir.tag).toBe('Code')
    expect((ir as { via?: object }).via).toBeDefined()
  })

  // 10. Param sub-IR walk preserves loc + irNodeId on body leaves
  // (PV36 + PV38 — Issue #3 catcher for α-4 pre_mortem clause 7).
  it('Param sub-IR walk preserves loc and irNodeId on every body leaf', () => {
    const ir = parseStrudel('note("c4 e4").s("<bd cp>")')
    const items = walkLeafItems(ir, 1)
    const index = buildNodeLocIndex(ir)
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) {
      expect(it.loc).toBeDefined()
      expect(it.loc!.length).toBeGreaterThan(0)
      // Node identity is derived from the SAME walk (buildNodeLocIndex indexes
      // walkLeafItems by leaf loc), so every body leaf resolves to an irNodeId.
      const key = `${it.loc![0].start}:${it.loc![0].end}`
      expect(index.get(key)?.[0]?.irNodeId).toBeDefined()
    }
  })

  // 11. Pattern-arg sub-IR atoms carry loc pointing INSIDE the mini-string
  // (goal-backward gap — Inspector click on `<bd cp>` event must resolve
  // to the mini-string atom, not the `.s(...)` call site).
  it('pattern-arg sub-IR atoms carry loc pointing inside the mini-string', () => {
    const code = 'note("c").s("<bd cp>")'
    const ir = parseStrudel(code)
    if (ir.tag !== 'Param') throw new Error('expected top-level Param')
    const subIr = (ir as { value: unknown }).value
    if (typeof subIr !== 'object' || subIr === null) {
      throw new Error('expected PatternIR sub-IR (pattern-arg form)')
    }
    // Inner mini-string spans: code.indexOf('"<bd cp>"') is the OUTER quote;
    // inner string lives between innerStart..innerEnd (exclusive of quotes).
    const outerQuoteIdx = code.indexOf('"<bd cp>"')
    const innerStart = outerQuoteIdx + 1 // position of '<'
    const innerEnd = outerQuoteIdx + '"<bd cp>"'.length - 1 // position of closing '"'
    // Recursively gather every loc on every node of the sub-IR. At least
    // one Play leaf inside must carry a loc whose start is in
    // [innerStart, innerEnd).
    const collectLocs = (node: unknown): Array<{ start: number; end: number }> => {
      if (typeof node !== 'object' || node === null) return []
      const out: Array<{ start: number; end: number }> = []
      const n = node as Record<string, unknown>
      if (Array.isArray(n.loc)) {
        for (const l of n.loc as Array<{ start: number; end: number }>) out.push(l)
      }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) for (const item of v) out.push(...collectLocs(item))
        else if (typeof v === 'object') out.push(...collectLocs(v))
      }
      return out
    }
    const locs = collectLocs(subIr)
    const insideMini = locs.filter((l) => l.start >= innerStart && l.start < innerEnd)
    expect(insideMini.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 20-11 wave β — Track → lane identity (β-1).
// A Track's `trackId` becomes the leaf's lane key (`laneKey = trackId ?? s ??
// '$default'`), threaded by structuralWalk's `case 'Track':` arm. This is the
// live substrate the timeline reads; the retired collect arm produced the same
// identity as `evt.trackId`.
// ---------------------------------------------------------------------------

describe('20-11 wave β — Track lane identity', () => {
  it('Track-wrapped IR gives its leaves the trackId as laneKey', () => {
    const ir = IR.track('d1', IR.play('c4'))
    const items = walkLeafItems(ir, 1)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].laneKey).toBe('d1')
  })

  it('hand-built IR with no Track wrapper falls back to the $default lane', () => {
    const items = walkLeafItems(IR.play('c4'), 1)
    expect(items.length).toBeGreaterThan(0)
    // No trackId, no sample → the default lane key.
    expect(items[0].laneKey).toBe('$default')
  })

  it('nested Track — innermost wrapper wins (childCtx override at each level)', () => {
    // Hand-built IR shape: outer='d1' wraps inner='lead' wraps Play. The Track
    // arm sets childCtx.trackId=ir.trackId at each level, so the inner 'lead'
    // overrides 'd1' for the leaf beneath it.
    const ir = IR.track('d1', IR.track('lead', IR.play('c4'), { userMethod: 'p' }))
    expect(walkLeafItems(ir, 1)[0].laneKey).toBe('lead')
  })

  it('parseStrudel on duplicate $: blocks produces distinct lane keys (the 20-10 γ-4 fix)', () => {
    const code = '$: s("hh*8")\n$: s("hh*8")'
    const laneKeys = new Set(walkLeafItems(parseStrudel(code), 1).map((it) => it.laneKey))
    expect(laneKeys.has('d1')).toBe(true)
    expect(laneKeys.has('d2')).toBe(true)
    expect(laneKeys.size).toBe(2)
  })

  it('Track wrapper preserves loc + irNodeId on body leaves (PV36 + PV38)', () => {
    const ir = parseStrudel('$: note("c4 e4")')
    const items = walkLeafItems(ir, 1)
    const index = buildNodeLocIndex(ir)
    expect(items.length).toBeGreaterThan(0)
    items.forEach((it) => {
      expect(it.loc).toBeDefined()
      expect(it.loc!.length).toBeGreaterThan(0)
      const key = `${it.loc![0].start}:${it.loc![0].end}`
      expect(index.get(key)?.[0]?.irNodeId).toBeDefined()
    })
  })

  it('user .p("custom") via parseStrudel gives its leaves the "custom" lane key', () => {
    const ir = parseStrudel('note("c").p("custom")')
    const items = walkLeafItems(ir, 1)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].laneKey).toBe('custom')
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** If tree is a Seq with a single child, unwrap it. */
function flattenSingleSeq(tree: ReturnType<typeof parseStrudel>): ReturnType<typeof parseStrudel> {
  if (tree.tag === 'Seq' && tree.children.length === 1) return tree.children[0]
  return tree
}
