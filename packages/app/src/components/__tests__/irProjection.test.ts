/**
 * Unit tests for the IR Inspector projection rules.
 *
 * Phase 19-06 (#76) — covers all 30 rows of RESEARCH §2 truth-table
 * plus the .off() 4-arrow-shape coverage (RESEARCH §2.x), Code
 * whitelist (NEW pre-mortem #8), Pure-as-Choice.else_ filter (NEW
 * pre-mortem #10), and direct stripInnerLate edge cases.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel as _parseStrudel } from '@stave/editor'
import { IR, type PatternIR } from '@stave/editor'
import { parseStrudelStages } from '@stave/editor'
import {
  projectedLabel,
  projectedChildren,
  stripInnerLate,
  flattenLeafVoices,
  LOCALSTORAGE_KEY,
} from '../irProjection'
import { unwrapD1 } from '../../../../editor/src/codeView/ir/__tests__/helpers/unwrapD1'
// The staged pipeline as the app publishes it (#1375) — the SHARED helper the
// corpus parity gate uses, not a second copy: the defect that issue tracked was
// a parallel reimplementation kept in sync by hand.
import { pipeline, stripStageMeta } from '../../../../editor/src/codeView/ir/__tests__/helpers/stagesParity'

// Phase 20-11 γ-4 — drill through the synthetic d1 Track wrapper. The
// projection tests assert on the inner shape (Stack, Late, Degrade, ...);
// the new γ-3 Track projection cases hand-build via IR.track(...).
const parseStrudel = (code: string): PatternIR => unwrapD1(_parseStrudel(code))

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseRoot(code: string): PatternIR {
  return parseStrudel(code)
}

/**
 * Walk the IR tree (raw children, NOT projected) and return the first
 * node matching the predicate, or null.
 */
function find(
  node: PatternIR,
  pred: (n: PatternIR) => boolean,
): PatternIR | null {
  if (pred(node)) return node
  const kids = rawChildren(node)
  for (const k of kids) {
    const hit = find(k, pred)
    if (hit) return hit
  }
  return null
}

function rawChildren(node: PatternIR): readonly PatternIR[] {
  switch (node.tag) {
    case 'Seq':   return node.children
    case 'Stack': return node.tracks
    case 'Cycle': return node.items
    case 'Choice': return [node.then, node.else_]
    case 'Every': return node.default_ ? [node.body, node.default_] : [node.body]
    case 'When':  return [node.body]
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
      return [node.body]
    case 'Param': {
      // Phase 20-10 — Param has body + (optionally) sub-IR value.
      const v = node.value
      if (typeof v === 'object' && v !== null) return [node.body, v as PatternIR]
      return [node.body]
    }
    case 'Track': return [node.body]   // Phase 20-11 wave α-1 — single-body wrapper.
    case 'Chunk': return [node.body, node.transform]
    case 'Pick':  return [node.selector, ...node.lookup]
    default:      return []
  }
}

// -----------------------------------------------------------------------------
// Module-scope constant
// -----------------------------------------------------------------------------

describe('LOCALSTORAGE_KEY', () => {
  it('uses the colon-prefix convention (RESEARCH §5.2)', () => {
    expect(LOCALSTORAGE_KEY).toBe('stave:inspector.irMode')
  })
})

// -----------------------------------------------------------------------------
// projectedLabel
// -----------------------------------------------------------------------------

describe('projectedLabel — user-callable tags use userMethod (PV31 first consumer)', () => {
  it('Stack from .layer() projects to "layer"', () => {
    const ir = parseRoot('note("c d e f").layer(x => x.add("0,2"))')
    expect(projectedLabel(ir)).toBe('layer')
  })

  it('Stack from .jux() projects to "jux"', () => {
    const ir = parseRoot('s("bd hh sd cp").jux(x => x.gain(0.5))')
    expect(projectedLabel(ir)).toBe('jux')
  })

  it('Stack from .off() projects to "off"', () => {
    const ir = parseRoot('s("bd hh sd cp").off(0.125, x => x.gain(0.5))')
    expect(projectedLabel(ir)).toBe('off')
  })

  it('Stack from stack() literal projects to "stack" (PV31 distinguishes from layer/jux/off)', () => {
    const ir = parseRoot('stack(s("bd"), s("hh"))')
    expect(projectedLabel(ir)).toBe('stack')
  })

  it('Late projects to "late"', () => {
    const ir = parseRoot('s("bd").late(0.125)')
    expect(projectedLabel(ir)).toBe('late')
  })

  it('Degrade from .degrade() projects to "degrade"', () => {
    const ir = parseRoot('s("bd hh sd cp ride lt mt ht").degrade()')
    expect(projectedLabel(ir)).toBe('degrade')
  })

  it('Degrade from .degradeBy() projects to "degradeBy" (PV31 distinguishes)', () => {
    const ir = parseRoot('s("bd hh sd cp ride lt mt ht").degradeBy(0.3)')
    expect(projectedLabel(ir)).toBe('degradeBy')
  })

  it.each([
    ['s("bd hh sd cp").chunk(4, x => x.gain(0.5))', 'chunk'],
    ['s("bd").ply(3)', 'ply'],
    // Phase 20-04 D-03: `.note()` is now wrapped per PV37 (was silently
    // passed through pre-20-04). Drop the trailing `.note()` so this
    // fixture continues to probe Pick's projection label specifically;
    // the wrapper-label assertion lives in wave δ inspector chrome tests.
    ['mini("<0 1 2 3>").pick(["c","e","g","b"])', 'pick'],
    ['note("c d e f").struct("x ~ x ~ x")', 'struct'],
    ['note("c d e f g h").swing(2)', 'swing'],
    ['note("c d e f").shuffle(4)', 'shuffle'],
    ['note("c d e f").scramble(4)', 'scramble'],
    ['s("bd").chop(4)', 'chop'],
    ['s("bd").fast(2)', 'fast'],
    ['s("bd").slow(2)', 'slow'],
    ['s("bd").every(2, x => x.fast(2))', 'every'],
    ['s("bd").gain(0.5)', 'gain'],
  ])('parses %s and projects label %s', (code, expected) => {
    const ir = parseRoot(code)
    expect(projectedLabel(ir)).toBe(expected)
  })

  it('Choice from .sometimes() projects to "sometimes" (Choice with userMethod)', () => {
    const ir = parseRoot('s("bd").sometimes(x => x.gain(0.5))')
    // sometimes desugars to Choice; userMethod set to 'sometimes'.
    expect(projectedLabel(ir)).toBe('sometimes')
  })
})

describe('projectedLabel — mini-notation symbols (D-03)', () => {
  it('Sleep from `~` projects to "~"', () => {
    const ir = parseRoot('s("bd ~ sd")')
    const sleep = find(ir, (n) => n.tag === 'Sleep')
    expect(sleep).not.toBeNull()
    expect(projectedLabel(sleep!)).toBe('~')
  })

  it('Cycle from `<>` projects to "<>"', () => {
    const ir = parseRoot('s("<bd hh sd>")')
    const cycle = find(ir, (n) => n.tag === 'Cycle')
    expect(cycle).not.toBeNull()
    expect(projectedLabel(cycle!)).toBe('<>')
  })

  it('Choice from `?` projects to "?"', () => {
    const ir = parseRoot('s("bd?")')
    const choice = find(ir, (n) => n.tag === 'Choice')
    expect(choice).not.toBeNull()
    expect(projectedLabel(choice!)).toBe('?')
  })

  it('Fast from `*4` projects to "*4" (symbol-with-value)', () => {
    const ir = parseRoot('s("bd*4")')
    const fast = find(
      ir,
      (n) => n.tag === 'Fast' && n.userMethod === undefined,
    )
    expect(fast).not.toBeNull()
    expect(projectedLabel(fast!)).toBe('*4')
  })

  it('Fast from `*2` projects to "*2" (distinguished from *4)', () => {
    const ir = parseRoot('s("bd*2")')
    const fast = find(
      ir,
      (n) => n.tag === 'Fast' && n.userMethod === undefined,
    )
    expect(fast).not.toBeNull()
    expect(projectedLabel(fast!)).toBe('*2')
  })

  it('Elongate from `@2` projects to "@2"', () => {
    const ir = parseRoot('s("bd@2 sd")')
    const elong = find(ir, (n) => n.tag === 'Elongate')
    expect(elong).not.toBeNull()
    expect(projectedLabel(elong!)).toBe('@2')
  })

  it('Stack from polymetric `{a, b}` projects to "{}"', () => {
    const ir = parseRoot('s("{bd, sd hh}")')
    const stack = find(
      ir,
      (n) => n.tag === 'Stack' && n.userMethod === undefined,
    )
    expect(stack).not.toBeNull()
    expect(projectedLabel(stack!)).toBe('{}')
  })

  it('Seq from inner `[bd sd]` projects to "[]"', () => {
    const ir = parseRoot('s("[bd sd] hh")')
    const seq = find(
      ir,
      (n) => n.tag === 'Seq' && n.userMethod === undefined,
    )
    expect(seq).not.toBeNull()
    expect(projectedLabel(seq!)).toBe('[]')
  })
})

describe('projectedLabel — Code whitelist (RESEARCH NEW pre-mortem #8)', () => {
  it('Code from parser fall-through projects to "Code" (NOT undefined-hidden)', () => {
    // unknownFn(...) is unparseable as a root; parseStrudel returns IR.code(...)
    const ir = parseRoot('unknownFn("foo")')
    expect(ir.tag).toBe('Code')
    expect(projectedLabel(ir)).toBe('Code')
  })

  it('directly-constructed Code with no userMethod projects to "Code"', () => {
    const code: PatternIR = IR.code('foo bar')
    expect(projectedLabel(code)).toBe('Code')
  })
})

// Phase 20-04 wave δ — opaque-fragment wrapper chrome (D-05 / PV35 / PV32 / Trap 6).
describe('20-04 — wrapper chrome (PV35 audience split)', () => {
  it('musician projectedLabel for Code-with-via returns "unmodelled" (label-only — PV32 / Trap 6)', () => {
    // #928: `.release` now classifies as a control (Param); a genuinely
    // unrecognised method (`.notreal`) exercises the opaque-wrapper chrome.
    const ir = parseStrudel('note("c").notreal(0.3)')
    expect(ir.tag).toBe('Code')
    // PV32 / Trap 6: musician chrome MUST NOT leak the method name.
    expect(projectedLabel(ir)).toBe('unmodelled')
    // The literal method name must NOT appear in the musician label.
    expect(projectedLabel(ir)).not.toContain('notreal')
  })

  it('musician projectedLabel for Code WITHOUT via stays "Code" (parse-failure path unchanged)', () => {
    // Sanity: pre-20-04 Code-without-via still labels 'Code'.
    const code: PatternIR = IR.code('foo bar')
    expect(projectedLabel(code)).toBe('Code')
  })

  it('musician projectedChildren for wrapper exposes via.inner (D-05 — tree expansion)', () => {
    const ir = parseStrudel('note("c").notreal(0.3)')  // #928: unrecognised → opaque wrapper
    expect(ir.tag).toBe('Code')
    const children = projectedChildren(ir)
    expect(children.length).toBe(1)
    expect(children[0].tag).toBe('Play')
  })

  it('musician projectedChildren for parse-failure Code is empty (DV-08 unchanged)', () => {
    const code: PatternIR = IR.code('foo bar')
    expect(projectedChildren(code)).toEqual([])
  })

  it('double-wrap: musician chrome shows "unmodelled" at each level (D-06)', () => {
    const outer = parseStrudel('note("c").foo(1).bar(2)')
    expect(outer.tag).toBe('Code')
    expect(projectedLabel(outer)).toBe('unmodelled')
    const innerWrapper = projectedChildren(outer)[0]
    expect(innerWrapper.tag).toBe('Code')
    expect(projectedLabel(innerWrapper)).toBe('unmodelled')
    // Innermost is the Play.
    const innermost = projectedChildren(innerWrapper)[0]
    expect(innermost.tag).toBe('Play')
  })
})

// Phase 20-10 wave β-2 — Param musician chrome (PV35 / PV32 — userMethod-first).
describe('20-10 — Param musician chrome (userMethod short-circuit)', () => {
  it('projectedLabel(Param) returns "s" via userMethod short-circuit (NOT "Param")', () => {
    // PV32 / Trap "Param-as-label leak". The short-circuit at irProjection
    // lines 59-61 returns userMethod ('s') for every parser-constructed
    // Param. The `case 'Param':` defensive arm never fires in the normal
    // path; if this test ever shows 'Param', the short-circuit broke.
    const ir = parseStrudel('note("c").s("sawtooth")')
    expect(ir.tag).toBe('Param')
    expect(projectedLabel(ir)).toBe('s')
    expect(projectedLabel(ir)).not.toBe('Param')
  })

  it('projectedLabel(Param) for chained Params returns the typed token at each level', () => {
    // .s("sawtooth").gain(0.3) → Param(gain, Param(s, Play))
    // Outer label is 'gain'; inner label is 's' — both via userMethod.
    const outer = parseStrudel('note("c").s("sawtooth").gain(0.3)')
    expect(projectedLabel(outer)).toBe('gain')
    const inner = projectedChildren(outer).find(
      n => n.tag === 'Param',
    )
    expect(inner).toBeDefined()
    expect(projectedLabel(inner!)).toBe('s')
  })

  it('projectedChildren(Param) with literal value returns [body] only', () => {
    const ir = parseStrudel('note("c").s("sawtooth")')
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(1)
    expect(kids[0].tag).toBe('Play')   // body is the note("c") Play
  })

  it('projectedChildren(Param) with PatternIR sub-IR drills into the sub-IR', () => {
    // .s("<bd cp>") — value is a Cycle IR. The musician must be able to
    // drill into it (set breakpoints on bd / cp atoms, inspect the
    // pattern-arg structure). Order: [value, body] — value first because
    // it is the structural sub-tree the user typed.
    const ir = parseStrudel('note("c").s("<bd cp>")')
    expect(ir.tag).toBe('Param')
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
    expect(kids[0].tag).toBe('Cycle')   // pattern-arg drillable
    expect(kids[1].tag).toBe('Play')    // body
  })

  it('hand-constructed Param without userMethod falls through to tag (defensive — debugging-visible)', () => {
    // Defensive fail-safe path. NOT a normal-path PV32 violation — the
    // parser ALWAYS sets userMethod via tagMeta. This test documents that
    // a future code path forgetting tagMeta produces a visible 'Param'
    // label, not a silent undefined hide.
    const param: PatternIR = {
      tag: 'Param',
      key: 's',
      value: 'sawtooth',
      rawArgs: '"sawtooth"',
      body: IR.play('c'),
      // userMethod intentionally omitted
    }
    expect(projectedLabel(param)).toBe('Param')
  })
})

describe('projectedLabel — synthetic intermediates hidden (D-02)', () => {
  it('Late inside .off() (userMethod undefined) returns undefined', () => {
    const ir = parseRoot('s("bd").off(0.125, x => x.gain(0.5))')
    const late = find(
      ir,
      (n) => n.tag === 'Late' && n.userMethod === undefined,
    )
    expect(late).not.toBeNull()
    expect(projectedLabel(late!)).toBeUndefined()
  })

  it('the jux pan (Param pan, userMethod undefined) returns undefined', () => {
    const ir = parseRoot('s("bd").jux(x => x.gain(0.5))')
    const pan = find(
      ir,
      // #967 — jux pans are Param('pan', ±1) with no userMethod (was FX).
      (n) => n.tag === 'Param' && (n as { key?: string }).key === 'pan' && n.userMethod === undefined,
    )
    expect(pan).not.toBeNull()
    expect(projectedLabel(pan!)).toBeUndefined()
  })

  it('Pure node (synthetic, userMethod undefined) returns undefined', () => {
    const pure: PatternIR = IR.pure()
    expect(projectedLabel(pure)).toBeUndefined()
  })
})

describe('projectedLabel — Play leaf', () => {
  it('Play (no userMethod field) projects to "Play"', () => {
    const ir = parseRoot('s("bd")')
    // s("bd") with a single token returns a Play directly (or wrapped in Seq).
    const play = find(ir, (n) => n.tag === 'Play')
    expect(play).not.toBeNull()
    expect(projectedLabel(play!)).toBe('Play')
  })
})

// -----------------------------------------------------------------------------
// projectedChildren
// -----------------------------------------------------------------------------

describe('projectedChildren — layer (tracks verbatim, drop the Stack)', () => {
  it('returns the f(body) and g(body) sub-IRs, no scaffolding', () => {
    const ir = parseRoot('note("c d e f").layer(x => x.add("0,2"))')
    const kids = projectedChildren(ir)
    expect(kids.length).toBeGreaterThanOrEqual(1)
    // Each kid should NOT itself be a Stack (the wrapping was the IR-mode shape).
    for (const k of kids) {
      expect(k.tag).not.toBe('Stack')
    }
  })
})

describe('projectedChildren — jux (strip the FX(pan,±1) wrappers)', () => {
  it('returns [body, transformed] with no synthetic FX(pan) wrapping', () => {
    const ir = parseRoot('s("bd").jux(x => x.gain(0.5))')
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
    const t0 = kids[0]
    const t1 = kids[1]
    // Neither side should be a synthetic pan wrapper at the top (#967: the
    // jux pan is Param('pan', ±1) with no userMethod, was FX(pan)).
    const isSyntheticPan = (n: PatternIR) =>
      n.tag === 'Param' && (n as { key?: string }).key === 'pan' && n.userMethod === undefined
    expect(isSyntheticPan(t0)).toBe(false)
    expect(isSyntheticPan(t1)).toBe(false)
  })
})

describe('projectedChildren — off (strip the inner Late, RESEARCH §2.x option a)', () => {
  function hasSyntheticLate(n: PatternIR): boolean {
    if (n.tag === 'Late' && n.userMethod === undefined) return true
    const kids = rawChildren(n)
    for (const k of kids) {
      if (hasSyntheticLate(k)) return true
    }
    return false
  }

  it.each([
    ['x => x.gain(0.5)'],
    ['x => x.fast(2)'],
    ['x => x.late(0.125)'],
    ['x => x.gain(0.5).fast(2)'],
  ])('strips synthetic Late from transform body for %s', (transformExpr) => {
    const code = `s("bd").off(0.125, ${transformExpr})`
    const ir = parseRoot(code)
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
    const transformed = kids[1]
    expect(hasSyntheticLate(transformed)).toBe(false)
  })

  it('preserves user-typed .late() (userMethod set) inside transform', () => {
    // x => x.late(...) — the user-typed Late should NOT be stripped (only
    // the synthetic one with userMethod undefined gets stripped).
    const ir = parseRoot('s("bd").off(0.125, x => x.late(0.0625))')
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
    const transformed = kids[1]
    // The user-typed Late should still be visible (its userMethod is 'late').
    function hasUserLate(n: PatternIR): boolean {
      if (n.tag === 'Late' && n.userMethod === 'late') return true
      const ks = rawChildren(n)
      for (const k of ks) if (hasUserLate(k)) return true
      return false
    }
    expect(hasUserLate(transformed)).toBe(true)
  })
})

describe('projectedChildren — Choice (drop Pure else_ from mini `?`)', () => {
  it('mini `bd?` Choice has 1 projected child, not 2 (RESEARCH NEW pre-mortem #10)', () => {
    const ir = parseRoot('s("bd?")')
    const choice = find(ir, (n) => n.tag === 'Choice')
    expect(choice).not.toBeNull()
    const kids = projectedChildren(choice!)
    expect(kids.length).toBe(1)
  })

  it('user-typed Choice with non-Pure else_ keeps both children', () => {
    // Construct directly — the parser doesn't expose a chained .choice path;
    // use the smart constructor to model a hypothetical user-typed Choice.
    const choice: PatternIR = IR.choice(
      0.3,
      IR.play('bd'),
      IR.play('hh'),
      { userMethod: 'choice' },
    )
    const kids = projectedChildren(choice)
    expect(kids.length).toBe(2)
  })
})

describe('projectedChildren — stack(...) literal (tracks verbatim, no projection)', () => {
  it('parses stack(a, b) and projects children as the two raw track sub-IRs', () => {
    const ir = parseRoot('stack(s("bd"), s("hh"))')
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
  })
})

describe('projectedChildren — deep-nested-hide composition (CONSIDER C7)', () => {
  it('does not crash on nested .jux() inside .off()', () => {
    const ir = parseRoot('s("bd").off(0.125, x => x.jux(y => y.gain(0.5)))')
    // Just verify the rules don't throw and produce a sensible child list.
    expect(() => projectedChildren(ir)).not.toThrow()
    const kids = projectedChildren(ir)
    expect(kids.length).toBe(2)
  })
})

// -----------------------------------------------------------------------------
// stripInnerLate (private — exported for tests)
// -----------------------------------------------------------------------------

describe('stripInnerLate', () => {
  it('returns body when given synthetic Late directly', () => {
    const body = parseRoot('s("bd")')
    const synthLate: PatternIR = {
      tag: 'Late',
      offset: 0.125,
      body,
      // userMethod intentionally omitted (synthetic).
    }
    expect(stripInnerLate(synthLate)).toBe(body)
  })

  it('preserves user-typed Late (userMethod="late") at the top level', () => {
    const ir = parseRoot('s("bd").late(0.125)')
    expect(ir.tag).toBe('Late')
    const stripped = stripInnerLate(ir)
    // The user-typed Late stays as a Late (not stripped) and userMethod
    // is preserved. The body may be a new object (the recursion descends
    // into body looking for synthetic Late), but the wrapper survives.
    expect(stripped.tag).toBe('Late')
    expect((stripped as { userMethod?: string }).userMethod).toBe('late')
  })

  it('descends single-body wrappers (FX > synthetic Late case)', () => {
    const inner = parseRoot('s("bd")')
    const synthLate: PatternIR = {
      tag: 'Late',
      offset: 0.125,
      body: inner,
    }
    const param: PatternIR = {
      tag: 'Param',
      key: 'gain',
      value: 0.5,
      rawArgs: '0.5',
      body: synthLate,
      userMethod: 'gain',
    }
    const stripped = stripInnerLate(param)
    expect(stripped.tag).toBe('Param')
    expect((stripped as { body: PatternIR }).body).toBe(inner)
  })

  it('descends two single-body wrappers (Fast > Param > synthetic Late case)', () => {
    const inner = parseRoot('s("bd")')
    const synthLate: PatternIR = {
      tag: 'Late',
      offset: 0.125,
      body: inner,
    }
    const param: PatternIR = {
      tag: 'Param',
      key: 'gain',
      value: 0.5,
      rawArgs: '0.5',
      body: synthLate,
      userMethod: 'gain',
    }
    const fast: PatternIR = {
      tag: 'Fast',
      factor: 2,
      body: param,
      userMethod: 'fast',
    }
    const stripped = stripInnerLate(fast)
    expect(stripped.tag).toBe('Fast')
    const fastBody = (stripped as { body: PatternIR }).body
    expect(fastBody.tag).toBe('Param')
    expect((fastBody as { body: PatternIR }).body).toBe(inner)
  })

  it('stops at multi-child / leaf nodes (Stack — no recursion)', () => {
    const ir = parseRoot('stack(s("bd"), s("hh"))')
    expect(stripInnerLate(ir)).toBe(ir)
  })

  it('stops at Pure leaf', () => {
    const pure: PatternIR = IR.pure()
    expect(stripInnerLate(pure)).toBe(pure)
  })

  it('stops at Code leaf', () => {
    const code: PatternIR = IR.code('foo')
    expect(stripInnerLate(code)).toBe(code)
  })
})

// -----------------------------------------------------------------------------
// T-12.5 (REV-3) — RAW tab projection probe
//
// CONTEXT D-04 mandates uniform projection across all 4 stages
// (RAW, MINI-EXPANDED, CHAIN-APPLIED, Parsed). T-12 audits the FINAL
// (rightmost-by-default) tab via Playwright; the RAW tab — which renders
// a multi-track $: source as Stack(userMethod=undefined) > Code, Code,
// Code (RESEARCH §2.1) — has no explicit projection probe. P46 (display-
// layer projection whitelist) is the catalogue ref: a missing rule would
// fail silently as a thrown render error or blank row, neither of which
// the existing FINAL-tab tests catch.
// -----------------------------------------------------------------------------

describe('RAW tab projection (D-04 uniform projection — REV-3)', () => {
  it('multi-track $: RAW IR projects without errors; each track row drills to its source Code', () => {
    const code = '$: note("c d")\n$: s("bd hh")'
    // #1387 — RAW is the parser's tree with each track body shown as the source
    // it was parsed from, so the outer Stack and the Track rows are the parser's.
    const raw = parseStrudelStages(code)[0].ir
    expect(raw.tag).toBe('Stack')
    expect((raw as { userMethod?: string }).userMethod).toBeUndefined()
    expect(() => projectedLabel(raw)).not.toThrow()
    expect(projectedLabel(raw)).toBe('{}')
    const rows = projectedChildren(raw)
    expect(rows.map((r) => r.tag)).toEqual(['Track', 'Track'])
    const bodies = rows.flatMap((r) => projectedChildren(r))
    expect(bodies.map((b) => b.tag)).toEqual(['Code', 'Code'])
    for (const b of bodies) expect(projectedLabel(b)).toBe('Code')
    const codes = bodies
      .filter((k): k is Extract<PatternIR, { tag: 'Code' }> => k.tag === 'Code')
      .map((k) => k.code)
    expect(codes[0]).toContain('note("c d")')
    expect(codes[1]).toContain('s("bd hh")')
  })

  it('single-track RAW IR projects to one track row over one Code row with the expected text', () => {
    const code = 'note("c d")'
    const raw = parseStrudelStages(code)[0].ir
    expect(raw.tag).toBe('Track')
    expect(() => projectedLabel(raw)).not.toThrow()
    const kids = projectedChildren(raw)
    expect(kids.map((k) => k.tag)).toEqual(['Code'])
    expect(projectedLabel(kids[0])).toBe('Code')
    // Code is a leaf at projection — no children.
    expect(projectedChildren(kids[0])).toHaveLength(0)
    expect((kids[0] as { code: string }).code.trim()).toBe('note("c d")')
  })
})

describe('20-11 — Track projection (musician-track-identity / PV35 / PV32)', () => {
  it('projectedLabel(Track) returns trackId — synthetic d1', () => {
    const node: PatternIR = IR.track('d1', IR.play('c4', 1))
    expect(projectedLabel(node)).toBe('d1')
  })

  it('projectedLabel(Track) returns trackId — custom name', () => {
    const node: PatternIR = IR.track('lead', IR.play('c4', 1))
    expect(projectedLabel(node)).toBe('lead')
  })

  it('projectedLabel(Track) — userMethod-first short-circuit returns "p" for .p()-derived', () => {
    // Hand-construct a Track with userMethod='p' to exercise the short-circuit
    // path (lines 59-61). Real parser path produces this for `.p("name")`.
    const node: PatternIR = {
      tag: 'Track',
      trackId: 'lead',
      body: IR.play('c4', 1),
      userMethod: 'p',
    }
    expect(projectedLabel(node)).toBe('p')
  })

  it('projectedChildren(Track) returns [body]', () => {
    const body = IR.play('c4', 1)
    const node: PatternIR = IR.track('lead', body)
    const kids = projectedChildren(node)
    expect(kids).toEqual([body])
  })

  it('stripInnerLate preserves Track wrapper (single-body recursion)', () => {
    const node: PatternIR = IR.track('d1', IR.play('c4', 1))
    expect(stripInnerLate(node)).toEqual(node)
  })
})

// Phase 20-12 α-5 — flattenLeafVoices (D-03 / RESEARCH §C.2). Recursion gate:
// Stack with userMethod ∈ {undefined, 'stack'} is the ONLY recursion case.
// Everything else (incl. Stack with userMethod 'layer'/'jux'/'off') is a leaf.
describe('20-12 α-5 — flattenLeafVoices', () => {
  it('single-voice body (Play) returns [body] — 1 leaf', () => {
    const body = IR.play('bd', 1)
    const leaves = flattenLeafVoices(body)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]).toBe(body)
  })

  it('Stack with default userMethod (mini polymetric) returns [a, b, c] — 3 leaves', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const c = IR.play('sd', 1)
    const body = IR.stack(a, b, c)
    const leaves = flattenLeafVoices(body)
    expect(leaves).toHaveLength(3)
    expect(leaves[0]).toBe(a)
    expect(leaves[1]).toBe(b)
    expect(leaves[2]).toBe(c)
  })

  it('user-typed Stack(stack-userMethod) returns each track verbatim', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const stackTyped: PatternIR = { tag: 'Stack', tracks: [a, b], userMethod: 'stack' }
    const leaves = flattenLeafVoices(stackTyped)
    expect(leaves).toEqual([a, b])
  })

  it('nested Stack(stack(hh, bd), sawtooth) flattens to 3 leaves (inner stack dissolves)', () => {
    const hh = IR.play('hh', 1)
    const bd = IR.play('bd', 1)
    const sawtooth = IR.play('sawtooth', 1)
    const inner: PatternIR = { tag: 'Stack', tracks: [hh, bd], userMethod: 'stack' }
    const outer: PatternIR = { tag: 'Stack', tracks: [inner, sawtooth], userMethod: 'stack' }
    const leaves = flattenLeafVoices(outer)
    expect(leaves).toEqual([hh, bd, sawtooth])
  })

  it('Stack with userMethod="layer" is a single leaf (NOT recursed)', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const layerStack: PatternIR = { tag: 'Stack', tracks: [a, b], userMethod: 'layer' }
    const leaves = flattenLeafVoices(layerStack)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]).toBe(layerStack)
  })

  it('Stack with userMethod="jux" is a single leaf', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const juxStack: PatternIR = { tag: 'Stack', tracks: [a, b], userMethod: 'jux' }
    const leaves = flattenLeafVoices(juxStack)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]).toBe(juxStack)
  })

  it('empty Stack returns [] (RESEARCH §C.3 — expand-toggle is visual no-op)', () => {
    const empty: PatternIR = { tag: 'Stack', tracks: [], userMethod: 'stack' }
    expect(flattenLeafVoices(empty)).toEqual([])
  })

  // Wrapper-peel regression — `stack(...).viz(...)` / `.gain(...)` / `.fast(...)`
  // wrap the Stack in single-body modifier nodes. The user's mental model is
  // "voice count = stack arg count" regardless of outer wrappers. Without the
  // peel, only the outer Code/Param/Fast was visible and flattenLeafVoices
  // returned 1 leaf instead of N — observed live in /tmp/probe-collapse.mjs
  // run on the user's 4-`$:` fixture. Stack-wrapped-in-Code-via was the live bug.
  it('Code-with-via wrapping a Stack peels to N leaves (`stack(...).viz(...)`)', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const c = IR.play('sd', 1)
    const stack: PatternIR = { tag: 'Stack', tracks: [a, b, c], userMethod: 'stack' }
    const wrapped: PatternIR = {
      tag: 'Code',
      code: 'stack(...).viz("p5test")',
      lang: 'strudel',
      via: {
        method: 'viz',
        args: '"p5test"',
        callSiteRange: [0, 0],
        inner: stack,
      },
    }
    expect(flattenLeafVoices(wrapped)).toEqual([a, b, c])
  })

  it('Code-without-via is a leaf (no peel — parse-failure / opaque)', () => {
    const opaque: PatternIR = {
      tag: 'Code',
      code: 'some(unparseable)',
      lang: 'strudel',
    }
    const leaves = flattenLeafVoices(opaque)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]).toBe(opaque)
  })

  it('Param wrapping a Stack peels to N leaves (`stack(...).gain(0.5)`)', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const stack: PatternIR = { tag: 'Stack', tracks: [a, b], userMethod: 'stack' }
    const gainWrapped: PatternIR = {
      tag: 'Param',
      key: 'gain',
      value: 0.5,
      rawArgs: '0.5',
      body: stack,
    }
    expect(flattenLeafVoices(gainWrapped)).toEqual([a, b])
  })

  it('Fast wrapping a Stack peels to N leaves (`stack(...).fast(2)`)', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const stack: PatternIR = { tag: 'Stack', tracks: [a, b], userMethod: 'stack' }
    const fastWrapped: PatternIR = { tag: 'Fast', factor: 2, body: stack }
    expect(flattenLeafVoices(fastWrapped)).toEqual([a, b])
  })

  it('Multiple wrappers chain through to the inner Stack (`stack(...).gain(0.5).fast(2).viz(...)`)', () => {
    const a = IR.play('hh', 1)
    const b = IR.play('bd', 1)
    const c = IR.play('sd', 1)
    const stack: PatternIR = { tag: 'Stack', tracks: [a, b, c], userMethod: 'stack' }
    const gainWrapped: PatternIR = {
      tag: 'Param',
      key: 'gain',
      value: 0.5,
      rawArgs: '0.5',
      body: stack,
    }
    const fastWrapped: PatternIR = { tag: 'Fast', factor: 2, body: gainWrapped }
    const vizWrapped: PatternIR = {
      tag: 'Code',
      code: 'stack(...).gain(0.5).fast(2).viz("x")',
      lang: 'strudel',
      via: {
        method: 'viz',
        args: '"x"',
        callSiteRange: [0, 0],
        inner: fastWrapped,
      },
    }
    expect(flattenLeafVoices(vizWrapped)).toEqual([a, b, c])
  })

  it('Wrapper around a non-Stack body still terminates as 1 leaf', () => {
    const inner = IR.play('square', 1)
    const wrapped: PatternIR = {
      tag: 'Code',
      code: 'note(...).s("square").viz("pitchwheel")',
      lang: 'strudel',
      via: {
        method: 'viz',
        args: '"pitchwheel"',
        callSiteRange: [0, 0],
        inner,
      },
    }
    const leaves = flattenLeafVoices(wrapped)
    expect(leaves).toHaveLength(1)
  })
})

// -----------------------------------------------------------------------------
// #463 / #475 — NamedPick projection (regression: the `kids is not iterable`
// white-screen). NamedPick was added producer-side but never projected; the
// `default` arm returned the node object → spliceHiddenChildren threw on the
// non-iterable, unmounting the editor shell.
// -----------------------------------------------------------------------------

describe('#475 — NamedPick projection (object/named-key pick family)', () => {
  it('projectedChildren returns [selector, ...entries.patterns] (NOT the node — the crash)', () => {
    const root = parseStrudel(
      '"<a b>".pickRestart({ verse: s("bd"), chorus: s("hh") })',
    )
    const np = find(root, (n) => n.tag === 'NamedPick')
    expect(np?.tag).toBe('NamedPick')

    // The exact call that threw: projectedChildren must be iterable.
    const kids = projectedChildren(np as PatternIR)
    expect(Array.isArray(kids)).toBe(true)
    expect(() => {
      for (const _k of kids) void _k
    }).not.toThrow()
    // selector first, then one child per named entry (verse, chorus).
    expect(kids).toHaveLength(3)
    if (np?.tag === 'NamedPick') {
      expect(kids[0]).toBe(np.selector)
      expect(kids.slice(1)).toEqual(np.entries.map((e) => e.pattern))
    }
  })

  it('projectedLabel returns the user method ("pickRestart"), never the IR tag (PV32)', () => {
    const root = parseStrudel(
      '"<a b>".pickRestart({ verse: s("bd"), chorus: s("hh") })',
    )
    const np = find(root, (n) => n.tag === 'NamedPick') as PatternIR
    expect(projectedLabel(np)).toBe('pickRestart')
    expect(projectedLabel(np)).not.toBe('NamedPick')
  })

  it('projectedLabel falls back to node.method for a hand-built node with no userMethod', () => {
    const np = IR.namedPick(
      IR.code('"<a b>"'),
      [{ key: 'verse', pattern: IR.play('bd', 1) }],
      'pickReset',
      '{verse: s("bd")}',
    )
    // Hand-built (no tagMeta) → userMethod undefined → method token shown.
    expect(np.tag === 'NamedPick' && np.userMethod).toBeUndefined()
    expect(projectedLabel(np)).toBe('pickReset')
  })

  it('the hardened default arm degrades a future unhandled tag to an opaque leaf (no crash)', () => {
    // Simulate a producer-added tag that slipped past tsc. The old arm
    // returned the node object (non-iterable, the crash); the hardened arm
    // returns [] for children and the raw tag for the label.
    const ghost = { tag: 'FutureTag', loc: [] } as unknown as PatternIR
    expect(projectedChildren(ghost)).toEqual([])
    expect(() => projectedLabel(ghost)).not.toThrow()
    expect(projectedLabel(ghost)).toBe('FutureTag')
  })
})

/**
 * #1375 step 5 — the Inspector's downstream payoff, at the last reachable layer.
 *
 * ── WHY THIS ARM EXISTS AND WHY IT IS HERE ───────────────────────────────────
 * #1375 opened on a real complaint about this file's neighbours: `irProjection`
 * carries `Arrange` cases that "are written to display arrangements they can
 * never be handed", because the STAGED pipeline — the one whose snapshot the
 * Inspector actually reads — collapsed an arrangement behind a `const` into an
 * opaque `Code`. The issue's own example:
 *
 *   arrange([4, s("bd")], [8, s("hh")])          FINAL = Track→[Arrange(2)]  ✓
 *   const a = …; arrange([4, a], [8, b])         FINAL = Track→[Code]        ✗
 *
 * ⚠ THE CORPUS PARITY GATE CANNOT SEE THIS. That gate pins the staged pipeline
 * against `parseStrudel`, so it asks whether the two AGREE — and if both
 * regressed to `Code` together it would stay green while the Inspector showed a
 * blob. This arm asks the different question: is the projection handed
 * STRUCTURE at all. Every other test in this file feeds the projection an IR it
 * built itself, which cannot answer that either.
 *
 * ⚠ AND IT STOPS AT THE PROJECTION, deliberately. The rendered panel is NOT
 * asserted here and was not observed: the Inspector's tab registration is
 * commented out in `StaveApp` (#680), so no user can open it and its four
 * browser specs are all `test.skip`ped for that reason. What is provable today
 * is that the projection receives an `Arrange` rather than a blob; that the
 * panel then draws it is the acceptance criterion of #680, not of this arm.
 */
describe('#1375 — the staged pipeline hands the Inspector structure, not a blob', () => {
  const projectedTags = (root: PatternIR): string[] => {
    const out: string[] = []
    const walk = (n: PatternIR): void => {
      out.push(n.tag)
      for (const c of projectedChildren(n)) walk(c)
    }
    walk(root)
    return out
  }

  it.each([
    ['inline', 'arrange([4, s("bd")], [8, s("hh")])'],
    ['behind a binding', 'const a = s("bd")\nconst b = s("hh")\narrange([4, a], [8, b])'],
  ])('projects an Arrange for an arrangement %s', (_name, code) => {
    const staged = stripStageMeta(pipeline(code))
    const tags = projectedTags(staged)

    expect(tags).toContain('Arrange')
    // The point of the issue: no opaque node anywhere on the projected path.
    expect(tags).not.toContain('Code')

    const arrange = [staged, ...projectedChildren(staged)].find((n) => n.tag === 'Arrange')!
    expect(projectedLabel(arrange)).toBe('arrange')
    expect(projectedChildren(arrange)).toHaveLength(2)
  })
})
