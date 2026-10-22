/**
 * Phase 20-04 wave δ — IR Inspector developer chrome tests (D-05 / PV35).
 *
 * Covers summarize() and children() for Code-with-via wrappers.
 * Developer chrome shows the FULL call site (`[opaque: .notreal(0.3)]`);
 * musician-view chrome (irProjection.ts) shows label-only `unmodelled`
 * — see irProjection.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { parseStrudel as _parseStrudel } from '@stave/editor'
import { IR, type PatternIR } from '@stave/editor'
import { summarize, children } from '../IRInspectorChrome'
import { unwrapD1 } from '../../../../editor/src/codeView/ir/__tests__/helpers/unwrapD1'

// Phase 20-11 γ-4 — drill through the synthetic d1 Track wrapper.
// Tests asserting on the unwrapped (Code-with-via, Param, ...) shape
// route through this shim; tests that need the raw Track shape (the
// new γ-3 Track chrome cases) call _parseStrudel directly or use
// IR.track(...) to hand-build.
const parseStrudel = (code: string): PatternIR => unwrapD1(_parseStrudel(code))

describe('20-04 — IR Inspector developer chrome (PV35 / D-05)', () => {
  // #928: `.release` became a registry-classified control (Param). The opaque
  // chrome is exercised with a genuinely-unrecognised method (`.notreal`).
  it('summarize for Code-with-via returns "[opaque: .method(args)]"', () => {
    const ir = parseStrudel('note("c").notreal(0.3)')
    expect(ir.tag).toBe('Code')
    expect(summarize(ir)).toBe('[opaque: .notreal(0.3)]')
  })

  it('summarize preserves raw whitespace in args (D-02 byte-fidelity)', () => {
    const ir = parseStrudel('note("c").notreal( 0.5 )')
    expect(summarize(ir)).toBe('[opaque: .notreal( 0.5 )]')
  })

  it('summarize for typed-arm parse-failure wrapper shows method + raw arg', () => {
    const ir = parseStrudel('note("c").fast("<2 3>")')
    expect(summarize(ir)).toBe('[opaque: .fast("<2 3>")]')
  })

  it('summarize for Code WITHOUT via falls back to source-code preview', () => {
    // Pre-20-04 path — parse-fallback Code (parser couldn't handle root).
    const code: PatternIR = IR.code('foo bar')
    expect(summarize(code)).toBe('"foo bar"')
  })

  it('children for Code-with-via exposes via.inner (tree expansion)', () => {
    const ir = parseStrudel('note("c").release(0.3)')
    const kids = children(ir)
    expect(kids.length).toBe(1)
    expect(kids[0].tag).toBe('Play')
  })

  it('children for Code WITHOUT via is empty (DV-08 unchanged)', () => {
    const code: PatternIR = IR.code('foo bar')
    expect(children(code)).toEqual([])
  })

  it('double-wrap: developer chrome shows nested [opaque] chips (D-06)', () => {
    const outer = parseStrudel('note("c").foo(1).bar(2)')
    expect(summarize(outer)).toBe('[opaque: .bar(2)]')
    const inner = children(outer)[0]
    expect(inner.tag).toBe('Code')
    expect(summarize(inner)).toBe('[opaque: .foo(1)]')
    const innermost = children(inner)[0]
    expect(innermost.tag).toBe('Play')
  })
})

// Phase 20-10 wave β-2 — Param developer chrome (PV35 / D-05).
describe('20-10 — Param developer chrome (sample-bucket / track-defining)', () => {
  it('summarize(Param) with string value emits key="value" (JSON.stringify quotes)', () => {
    const ir = parseStrudel('note("c").s("sawtooth")')
    expect(ir.tag).toBe('Param')
    expect(summarize(ir)).toBe('s="sawtooth"')
  })

  it('summarize(Param) with numeric value emits key=value (no quotes — matches Strudel arg)', () => {
    const ir = parseStrudel('note("c").gain(0.3)')
    expect(ir.tag).toBe('Param')
    expect(summarize(ir)).toBe('gain=0.3')
  })

  it('summarize(Param) with PatternIR sub-IR value emits key=[pattern]', () => {
    // .s("<bd cp>") — value is a parsed Cycle IR (sub-IR), not a literal.
    const ir = parseStrudel('note("c").s("<bd cp>")')
    expect(ir.tag).toBe('Param')
    expect(typeof (ir as { value: unknown }).value).toBe('object')
    expect(summarize(ir)).toBe('s=[pattern]')
  })

  it('children(Param) with literal value returns [body] only', () => {
    const ir = parseStrudel('note("c").s("sawtooth")')
    const kids = children(ir)
    expect(kids.length).toBe(1)
    expect(kids[0].tag).toBe('Play')   // body is the note("c") Play
  })

  it('children(Param) with PatternIR sub-IR returns [value, body] (drillable sub-IR)', () => {
    // The pattern-arg `<bd cp>` is a structural sub-tree the developer
    // must be able to drill into. Order: value first, body second.
    const ir = parseStrudel('note("c").s("<bd cp>")')
    const kids = children(ir)
    expect(kids.length).toBe(2)
    expect(kids[0].tag).toBe('Cycle')   // <bd cp> is parsed as a Cycle
    expect(kids[1].tag).toBe('Play')    // body
  })

  it('Param-wrapping-Param: developer chrome stacks chained chips', () => {
    // .s(...).gain(...) parses as Param(gain, body=Param(s, body=Play)).
    const outer = parseStrudel('note("c").s("sawtooth").gain(0.3)')
    expect(outer.tag).toBe('Param')
    expect(summarize(outer)).toBe('gain=0.3')
    const inner = children(outer)[0]
    expect(inner.tag).toBe('Param')
    expect(summarize(inner)).toBe('s="sawtooth"')
  })
})

describe('20-11 — Track developer chrome (musician-track-identity / PV35)', () => {
  it('summarize(Track) emits "track: <trackId>"', () => {
    const node = IR.track('lead', IR.play('c4', 1)) as PatternIR
    expect(summarize(node)).toBe('track: lead')
  })

  it('summarize(Track) for synthetic d{N} emits "track: d2"', () => {
    const node = IR.track('d2', IR.play('c4', 1)) as PatternIR
    expect(summarize(node)).toBe('track: d2')
  })

  it('children(Track) returns [body] (single-wrapper shape)', () => {
    const body: PatternIR = IR.play('c4', 1)
    const node = IR.track('lead', body) as PatternIR
    const kids = children(node)
    expect(kids.length).toBe(1)
    expect(kids[0]).toBe(body)
  })

  // #463 / #475 — NamedPick developer chrome.
  it('summarize(NamedPick) shows the method + named keys', () => {
    const node = IR.namedPick(
      IR.code('"<a b>"'),
      [
        { key: 'verse', pattern: IR.play('bd', 1) },
        { key: 'chorus', pattern: IR.play('hh', 1) },
      ],
      'pickRestart',
      '{verse: s("bd"), chorus: s("hh")}',
    ) as PatternIR
    expect(summarize(node)).toBe('pickRestart {verse, chorus}')
  })

  it('children(NamedPick) returns [selector, ...entries.patterns]', () => {
    const selector = IR.code('"<a b>"')
    const verse = IR.play('bd', 1)
    const chorus = IR.play('hh', 1)
    const node = IR.namedPick(
      selector,
      [
        { key: 'verse', pattern: verse },
        { key: 'chorus', pattern: chorus },
      ],
      'pickRestart',
      '{verse: s("bd"), chorus: s("hh")}',
    ) as PatternIR
    expect(children(node)).toEqual([selector, verse, chorus])
  })
})
