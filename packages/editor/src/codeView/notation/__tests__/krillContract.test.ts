/**
 * krillContract.test.ts — the shape contract for Strudel's mini AST.
 *
 * `notation/parse.ts` reads `@strudel/mini`'s krill AST directly:
 * `options_.weight`, `options_.reps`, `ops[].type_`, `stretch.arguments_.type`,
 * `bjorklund.arguments_.rotation`. NONE of that is public API. krill-parser.js
 * ships no export map and no types; the field names are Strudel's private
 * internals, and we depend on them because the alternative — re-deriving the
 * grammar ourselves — is the bug #903 removed (a hand-rolled copy drifts from
 * the original and reports the drift as "unsupported syntax").
 *
 * WHY THIS FILE EXISTS. Depending on internals is a deliberate trade, and this
 * is the other half of it. Without this test an upstream AST change would be
 * SILENT: the adapter would read `undefined` where it expects a weight, decide
 * the notation is beyond the editable subset, and the grid would simply stop
 * opening tunes. Nothing throws — that is the documented failure mode of this
 * whole boundary (a walker returns a plausible WRONG verdict). This file turns
 * that silence into a loud, specific red.
 *
 * WHY NOT JUST PIN THE VERSION. Because pinning is the more dangerous option
 * here. Every `@strudel/*` package pins `@strudel/core` and `@strudel/mini`
 * EXACTLY (1.2.6) among themselves, so the set upgrades atomically and our
 * `^1.0.0` tracks it as a single instance. An exact pin on our side would let
 * `@strudel/transpiler` move to a version wanting `mini@1.3.0` while we hold
 * 1.2.6 — installing TWO copies of mini, which registers `mini()` on `Pattern`
 * by side effect. Two Patterns is a worse failure than the drift being guarded.
 * So: track the set, and assert the shape.
 *
 * WHEN THIS GOES RED. Upstream changed the AST. Do NOT patch the assertion to
 * match. Re-dump the AST (`krill.parse('"bd@2"')`, print it), read what moved,
 * and update `parse.ts`'s adapter to the new shape (the node types it reads are
 * written down once, in `strudelMini/tree.ts`) — then update this contract
 * to the new truth. The diff IS the news, exactly as in `parity.test.ts`.
 *
 * Every expectation below is a fact `parse.ts` RELIES ON. If an assertion here
 * has no corresponding read in the adapter, delete it — a contract nobody
 * depends on is noise that trains people to ignore this file.
 */
import { describe, it, expect } from 'vitest'
import { parse as krillParse } from '@strudel/mini/krill-parser.js'
import { bjorklund as strudelBjorklund } from '@strudel/core/euclid.mjs'
import { PROBE_SOUND, PROBE_NOTE, PROBE_NUM } from '../parse'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** the adapter's own call shape: the mini string arrives QUOTED */
const p = (mini: string): any => krillParse('"' + mini + '"')
/** first element of the root pattern */
const el0 = (mini: string): any => p(mini).source_[0]
const opsOf = (mini: string): string[] => (el0(mini).options_?.ops ?? []).map((o: any) => o.type_)

describe('krill AST contract — the shape notation/parse.ts reads', () => {
  it('roots a pattern with an alignment and an element list', () => {
    const ast = p('bd sd')
    expect(ast.type_).toBe('pattern')
    expect(ast.arguments_.alignment).toBe('fastcat')
    expect(ast.source_).toHaveLength(2)
    expect(ast.source_[0].type_).toBe('element')
    expect(ast.source_[0].source_.type_).toBe('atom')
    expect(ast.source_[0].source_.source_).toBe('bd')
  })

  /**
   * The alignment vocabulary IS the adapter's discriminator: `fastcat`/`stack`
   * map onto the view, the rest are refused BY NAME (that naming is what
   * dissolved the 392-unit "beyond the editable subset" catch-all).
   */
  it('names every alignment the adapter switches on', () => {
    expect(p('bd sd').arguments_.alignment).toBe('fastcat')
    expect(p('bd,sd').arguments_.alignment).toBe('stack')
    expect(el0('<bd sd>').source_.arguments_.alignment).toBe('polymeter_slowcat')
    expect(el0('{bd sd}%4').source_.arguments_.alignment).toBe('polymeter')
    expect(el0('[bd,hh]').source_.arguments_.alignment).toBe('stack')
    expect(el0('[bd sd]').source_.arguments_.alignment).toBe('fastcat')
    expect(p('bd . sd').arguments_.alignment).toBe('feet')
    expect(p('bd|sd').arguments_.alignment).toBe('rand')
  })

  it('carries weight/reps on EVERY element (the uniformity the adapter relies on)', () => {
    const o = el0('bd').options_
    expect(o.weight).toBe(1)
    expect(o.reps).toBe(1)
  })

  /**
   * The desugarings. These are why the adapter is short: `_`, `@n` and `!n` all
   * collapse into the same two fields instead of needing one reader each.
   */
  it('desugars @n and `_` into the SAME weight field', () => {
    expect(el0('bd@2').options_.weight).toBe(2)
    // `bd _` is sustain, not silence — and is byte-identical to `bd@2` here
    expect(el0('bd _').options_.weight).toBe(2)
    expect(p('bd _').source_).toHaveLength(1)
    expect(el0('bd _ _').options_.weight).toBe(3)
    // fractional weights are legal — the hand-rolled copy's `\d+` refused them
    expect(el0('c4@0.5').options_.weight).toBe(0.5)
  })

  it('desugars !n into reps, and sets weight === reps', () => {
    // the adapter uses `weight !== reps` to detect an `@` written next to a `!`
    expect(el0('bd!3').options_).toMatchObject({ reps: 3, weight: 3 })
    expect(opsOf('bd!3')).toContain('replicate')
    // a BARE `!` is `!2` — refusing it was drift, not a subset edge
    expect(el0('bd!').options_).toMatchObject({ reps: 2, weight: 2 })
    // `bd!0` is legal and queries to zero haps — the adapter refuses it as a
    // view decision (no cell to draw), so it must keep arriving as reps: 0
    expect(el0('bd!0').options_.reps).toBe(0)
    // `!` next to `@` diverges the two fields — the adapter's reject signal
    expect(el0('bd!3@2').options_).toMatchObject({ reps: 3, weight: 4 })
  })

  it('exposes stretch with a fast/slow type and an atom amount', () => {
    const op = el0('bd*2').options_.ops.find((o: any) => o.type_ === 'stretch')
    expect(op.arguments_.type).toBe('fast')
    expect(op.arguments_.amount.type_).toBe('atom')
    expect(op.arguments_.amount.source_).toBe('2')
    // `bd/2` is the SAME op with type 'slow' — the adapter refuses it by name,
    // and it is the largest single refusal class in the real-world corpus
    const slow = el0('bd/2').options_.ops.find((o: any) => o.type_ === 'stretch')
    expect(slow.arguments_.type).toBe('slow')
  })

  it('exposes bjorklund as a SPEC (krill does not evaluate the euclid)', () => {
    const op = el0('bd(3,8)').options_.ops.find((o: any) => o.type_ === 'bjorklund')
    // pulse/step arrive WRAPPED IN AN ELEMENT — `numArg` unwraps exactly this
    expect(op.arguments_.pulse.type_).toBe('element')
    expect(op.arguments_.pulse.source_.source_).toBe('3')
    expect(op.arguments_.step.source_.source_).toBe('8')
    // An absent rotation arrives NULLISH — today an explicit `null`, never
    // undefined. The adapter reads it as `== null` (both), so that is what is
    // asserted: the contract must fire when we would BREAK, not merely when
    // upstream picks the other empty value. Reading it as `=== undefined`
    // refused every euclid in the corpus, and a JSON dump that stripped nulls
    // hid the field entirely — hence the belt of testing it at all.
    expect(op.arguments_.rotation ?? null).toBeNull()
    expect(el0('bd(3,8,2)').options_.ops[0].arguments_.rotation.source_.source_).toBe('2')
  })

  it('exposes `:variant` as a tail op whose element is the NODE itself', () => {
    const op = el0('bd:3').options_.ops.find((o: any) => o.type_ === 'tail')
    // NOT an atom named "bd:3" — the adapter re-joins the token from these
    expect(el0('bd:3').source_.source_).toBe('bd')
    expect(op.arguments_.element.type_).toBe('atom')
    expect(op.arguments_.element.source_).toBe('3')
    // and the tail can be a PATTERN (`rd:<1 3 2>`) — the adapter must refuse
    // that rather than truncate the token to "rd" and write the variant away
    const patterned = el0('rd:<1 3 2>').options_.ops.find((o: any) => o.type_ === 'tail')
    expect(patterned.arguments_.element.type_).toBe('pattern')
  })

  it('exposes `?` as degradeBy', () => {
    expect(opsOf('bd?')).toContain('degradeBy')
  })

  /**
   * Token boundaries. Each of these was a real "unsupported token" bug in the
   * hand-rolled copy: a char-class read CONTENT as SYNTAX. krill's answer is
   * the authority, and the adapter must never re-encode it as a regex.
   */
  it('treats `_`, `-` and `#` inside a word as NAME characters', () => {
    expect(p('gm_agogo').source_).toHaveLength(1)
    expect(el0('gm_agogo').source_.source_).toBe('gm_agogo')
    expect(el0('blue-velvet').source_.source_).toBe('blue-velvet')
    expect(el0('LinnDrum_hh').source_.source_).toBe('LinnDrum_hh')
    // but a STANDALONE `_` is the elongation operator, not a name
    expect(p('bd _').source_).toHaveLength(1)
  })

  it('treats `~` and `-` as ordinary atoms (silence is decided downstream)', () => {
    // upstream: `if (source_ === '~' || source_ === '-') return silence`
    expect(el0('~').source_.source_).toBe('~')
    expect(el0('bd - sd').type_).toBe('element')
    expect(p('bd - sd').source_).toHaveLength(3)
    expect(p('bd - sd').source_[1].source_.source_).toBe('-')
  })

  it('THROWS on a lone `_` (nothing to extend) — the adapter guards this', () => {
    expect(() => p('_')).toThrow()
  })
})

describe('@strudel/core euclid contract — the distribution the grid draws', () => {
  it('returns 0|1 numbers, not booleans (the adapter maps them)', () => {
    const r = strudelBjorklund(3, 8)
    expect(r).toEqual([1, 0, 0, 1, 0, 0, 1, 0])
    expect(typeof r[0]).toBe('number')
  })

  it('is the same distribution our deleted copy computed', () => {
    // the copy agreed on all 152 (k,n) pairs to n=16; these are the shapes the
    // notation tests assert, so a change here surfaces as a euclid grid change
    expect(strudelBjorklund(5, 8)).toEqual([1, 0, 1, 1, 0, 1, 1, 0])
    expect(strudelBjorklund(2, 5)).toEqual([1, 0, 1, 0, 0])
  })

  /**
   * The degenerate end the adapter holds ITSELF rather than delegating:
   * upstream computes `steps - ons` as the zero-run length, so k > n builds a
   * negative-length array. `bjorklund()` in parse.ts short-circuits k >= n
   * before calling this — if upstream ever starts handling it, that guard can
   * go, and this test is where you'd find out.
   */
  it('does NOT handle k > n — which is why the adapter guards it', () => {
    expect(() => strudelBjorklund(5, 4)).toThrow()
  })
})

/**
 * The edit-safety probes splice a marker into the MIDDLE of a user's pattern and
 * require the result to be the original plus that marker. That comparison is only
 * meaningful if the marker survives being lexed next to its neighbours — one atom,
 * carrying its own bytes, wherever it lands.
 *
 * `PROBE_SOUND` used to be `__stave_probe__`, picked to be improbable in a sample
 * library. It was — but `_` is mini's elongation token, so its leading underscores
 * bound to the element BEFORE it and the marker arrived two bytes short inside a
 * pattern one slot too long. Every probe away from column 0 failed, and the
 * projections declined 45 editable patterns as `edit-unsafe` (#994). The marker was
 * checked against the wrong authority: the constraint is the grammar's, not the
 * sample library's.
 *
 * So these hold the property against krill itself, in both positions — after an
 * element (where the old marker broke) and at the start (where it did not, which is
 * why the bug stayed hidden). A marker chosen for how distinctive it LOOKS cannot
 * pass here.
 */
describe('krill contract — the edit probes are single atoms wherever they land', () => {
  /** every atom krill produces for `mini`, in order */
  const atoms = (mini: string): string[] =>
    p(mini).source_.map((e: any) => e.source_.source_)
  /** the weights krill assigns — an elongation shows up HERE, not in the atom list */
  const weights = (mini: string): number[] =>
    p(mini).source_.map((e: any) => e.options_?.weight ?? 1)

  for (const [name, token] of [
    ['PROBE_SOUND', PROBE_SOUND],
    ['PROBE_NOTE', PROBE_NOTE],
    ['PROBE_NUM', PROBE_NUM],
  ] as const) {
    it(`${name} lexes as ONE atom after another element`, () => {
      expect(atoms(`bd ${token} sd`)).toEqual(['bd', token, 'sd'])
      // and it must not have been swallowed as somebody else's elongation
      expect(weights(`bd ${token} sd`)).toEqual([1, 1, 1])
    })

    it(`${name} lexes as ONE atom at the start of a pattern`, () => {
      expect(atoms(`${token} bd`)).toEqual([token, 'bd'])
    })

    it(`${name} carries no character mini gives a meaning to`, () => {
      // the direct statement of the rule, so a red here reads as the CAUSE rather
      // than as a puzzling atom-list mismatch
      expect(token).toMatch(/^[a-z0-9]+$/i)
    })

    it(`${name} is still distinguishable from the pattern it is spliced into`, () => {
      // The property the ORIGINAL marker was chosen for, kept: the probe compares
      // "the pattern plus this marker" against what came back, so a marker the user
      // could plausibly have written would make the two indistinguishable. Losing
      // this while fixing the grammar collision would trade one silent failure for
      // another, so both are asserted rather than one replacing the other.
      expect(atoms(`bd ${token} sd`).filter((a) => a === token)).toHaveLength(1)
      expect(token.length).toBeGreaterThan(1)
    })
  }

  it('is non-vacuous: the old marker FAILS the property it was chosen without', () => {
    // `-` keeps its own slot and absorbs both underscores as weight; the marker
    // that follows is `stave_probe__`, two bytes short of what was spliced in
    expect(atoms('bd __stave_probe__ sd')).toEqual(['bd', 'stave_probe__', 'sd'])
    expect(weights('bd __stave_probe__ sd')).toEqual([3, 1, 1])
  })
})
