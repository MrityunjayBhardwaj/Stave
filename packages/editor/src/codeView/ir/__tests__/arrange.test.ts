/**
 * Phase 5a (#386) — unified time-sequence IR (`arrange`/`cat`/`slowcat`/
 * `fastcat`) + arm-tagged collect. Three layers:
 *   1. STRUCTURE — parseStrudel builds the `Arrange` node (arms, weights, loc).
 *   2. EVENTS    — collect slices arms across cycles + tags `armIndex`.
 *   3. PARITY    — collected events match real Strudel haps (the ground truth).
 *
 * GROUNDED 2026-06-17 (real `@strudel/core@1.2.6` haps):
 *   arrange([2,a],[1,b]) → a:[0,2) b:[2,3), period 3, arm cycle advances.
 *   cat/slowcat(a,b)     → a@cycle0 b@cycle1, period 2 (= arrange weights 1).
 *   fastcat(a,b)         → a@[0,.5) b@[.5,1), period 1 (≡ Seq).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'

import { parseStrudel as _parseStrudel, toStrudel, patternToJSON, patternFromJSON } from '..'
import type { PatternIR } from '..'
import { walkLeafItems } from '../structuralWalk'
import { unwrapD1 } from './helpers/unwrapD1'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'

const parse = (code: string): PatternIR => unwrapD1(_parseStrudel(code))

beforeAll(async () => {
  await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
  miniAllStrings()
})

// --- Strudel reference (ground truth) ------------------------------------
type SP = { queryArc: (b: number, e: number) => unknown[] }
async function strudelOnsets(code: string, cycles: number): Promise<Array<{ note: unknown; begin: number; end: number }>> {
  const { pattern } = (await evaluate(code)) as { pattern: SP }
  const num = (x: unknown) => Number((x as { valueOf(): number }).valueOf())
  const out: Array<{ note: unknown; begin: number; end: number }> = []
  for (let c = 0; c < cycles; c++) {
    for (const h of pattern.queryArc(c, c + 1) as Array<{ whole?: { begin: unknown; end: unknown }; part: { begin: unknown }; value: { note?: unknown } }>) {
      if (h.whole && num(h.whole.begin) === num(h.part.begin)) {
        out.push({ note: h.value.note, begin: num(h.whole.begin), end: num(h.whole.end) })
      }
    }
  }
  return out.sort((a, b) => a.begin - b.begin)
}

// Which arm (clip) plays in which cycle is a STRUCTURAL property of the parsed
// Arrange IR — `walkLeafItems` (the behaviour-free structural walk that mirrors
// the retired collect's per-cycle arm selection + armIndex threading) reports it
// without the behaviour interpreter. Onset TIMING within a cycle now comes from
// Strudel's eval; here we assert the arm bucketing + armIndex the timeline uses.
const armOnsets = (ir: PatternIR, nCycles: number) =>
  walkLeafItems(ir, nCycles)
    .map(it => ({ note: it.labelValue, cycle: it.cycle, arm: it.armIndex }))
    .sort((a, b) => a.cycle - b.cycle)

// --------------------------------------------------------------------------
describe('Phase 5a — Arrange IR structure', () => {
  it('arrange([2,a],[1,b]) → Arrange node, 2 arms with weights + per-arm loc', () => {
    const ir = parse('arrange([2, note("c3")], [1, note("e3")])')
    expect(ir.tag).toBe('Arrange')
    if (ir.tag !== 'Arrange') return
    expect(ir.mode).toBe('arrange')
    expect(ir.arms.map(a => a.weight)).toEqual([2, 1])
    // per-arm loc is mandatory (P5b/c write-back needs it)
    expect(ir.arms[0].loc?.[0]).toBeDefined()
    expect(ir.arms[1].loc?.[0]).toBeDefined()
    // arm loc spans the [n, pat] tuple → starts at '[' (weight-editable range)
    const src = 'arrange([2, note("c3")], [1, note("e3")])'
    expect(src.slice(ir.arms[0].loc![0].start, ir.arms[0].loc![0].end)).toBe('[2, note("c3")]')
  })

  it('cat / slowcat → Arrange, all weights 1, mode preserved', () => {
    for (const fn of ['cat', 'slowcat'] as const) {
      const ir = parse(`${fn}(note("c3"), note("e3"))`)
      expect(ir.tag).toBe('Arrange')
      if (ir.tag !== 'Arrange') continue
      expect(ir.mode).toBe(fn)
      expect(ir.arms.map(a => a.weight)).toEqual([1, 1])
    }
  })

  it('fastcat → Seq (one-cycle, ≡ existing node), NOT Arrange', () => {
    const ir = parse('fastcat(note("c3"), note("e3"))')
    expect(ir.tag).toBe('Seq')
  })

  it('method forms: a.cat(b) → Arrange[a,b]; a.fastcat(b) → Seq', () => {
    const c = parse('note("c3").cat(note("e3"))')
    expect(c.tag).toBe('Arrange')
    if (c.tag === 'Arrange') expect(c.arms.length).toBe(2)
    const f = parse('note("c3").fastcat(note("e3"))')
    expect(f.tag).toBe('Seq')
  })
})

describe('Phase 5a — structural walk: arm bucketing + armIndex', () => {
  it('arrange buckets arms by weight across cycles, tags armIndex', () => {
    const ir = parse('arrange([2, note("c3")], [1, note("e3")])')
    expect(armOnsets(ir, 4)).toEqual([
      { note: 'c3', cycle: 0, arm: 0 },
      { note: 'c3', cycle: 1, arm: 0 },
      { note: 'e3', cycle: 2, arm: 1 },
      { note: 'c3', cycle: 3, arm: 0 }, // loops (period 3)
    ])
  })

  it("an arm's internal cycle advances across its span (alternating arm)", () => {
    const ir = parse('arrange([2, note("<c3 e3>")], [1, note("g3")])')
    const evs = armOnsets(ir, 4)
    expect(evs.map(e => e.note)).toEqual(['c3', 'e3', 'g3', 'c3'])
    expect(evs.map(e => e.arm)).toEqual([0, 0, 1, 0])
  })

  it('cat tags armIndex 0/1 per cycle', () => {
    const ir = parse('cat(note("c3"), note("e3"))')
    expect(armOnsets(ir, 2)).toEqual([
      { note: 'c3', cycle: 0, arm: 0 },
      { note: 'e3', cycle: 1, arm: 1 },
    ])
  })

  it('a NESTED combinator arm tags the OUTER armIndex, not the inner (#451)', () => {
    // arrange arm 0 (weight 2) is itself a `cat` → c3 then e3 over cycles 0,1;
    // arm 1 (weight 1) is g3 at cycle 2. The inner cat must NOT overwrite the
    // outer arm index: both c3 and e3 belong to OUTER arm 0 (one clip), g3 to
    // outer arm 1 — so the timeline sees the cat block as a single outer clip.
    const ir = parse('arrange([2, cat(note("c3"), note("e3"))], [1, note("g3")])')
    expect(armOnsets(ir, 3)).toEqual([
      { note: 'c3', cycle: 0, arm: 0 },
      { note: 'e3', cycle: 1, arm: 0 }, // inner cat arm 1, but OUTER arm 0
      { note: 'g3', cycle: 2, arm: 1 },
    ])
  })

  it('a nested arm inherits the outer arm RANGE with the outer index (#1391)', () => {
    // The companion of #451 above, for the other half of the arm's identity.
    // `armIndex` and `armRange` name the SAME arm — the index says which clip,
    // the range says what it is called — so a nested arrange must not be able to
    // supply one while the outer supplies the other. Pinned with the outer arms'
    // `loc` REMOVED, which is the only shape that can tell the two apart: with
    // both present the outer range wins either way, and the arm proves nothing.
    const ir = parse('arrange([2, arrange([1, note("c3")], [1, note("e3")])], [1, note("g3")])')
    for (const arm of ir.tag === 'Arrange' ? ir.arms : []) delete (arm as { loc?: unknown }).loc
    const items = walkLeafItems(ir, 3)
    // Outer arm 0 spans both inner arms. Neither may lend it a name.
    const outer0 = items.filter((e) => e.armIndex === 0)
    expect(outer0.map((e) => e.labelValue)).toEqual(['c3', 'e3'])
    expect(outer0.every((e) => e.armRange === undefined)).toBe(true)
    expect(items.find((e) => e.labelValue === 'g3')?.armRange).toBeUndefined()
  })

  it('the OUTER index does NOT leak to a sibling track without an arrange (#451)', () => {
    // childCtx.armIndex is scoped to the arrange's own subtree — a sibling track
    // (here a bare note) is walked from the stack's ctx, so it must carry NO
    // armIndex (else `ctx.armIndex ?? armIndex` would wrongly propagate).
    const ir = parse('stack(arrange([2, note("c3")], [1, note("e3")]), note("g3"))')
    const items = walkLeafItems(ir, 3)
    const g3 = items.filter((e) => e.labelValue === 'g3')
    expect(g3.length).toBeGreaterThan(0)
    expect(g3.every((e) => e.armIndex === undefined)).toBe(true)
    // the arrange track still tags its arms
    expect(items.find((e) => e.labelValue === 'c3')?.armIndex).toBe(0)
    expect(items.find((e) => e.labelValue === 'e3')?.armIndex).toBe(1)
  })

  it('a nested arm carries loc INNERMOST→OUTERMOST (loc[last] = outer combinator)', () => {
    // loc is ordered leaf→…→outermost: [note "c3", cat(…), arrange(…)]. The
    // timeline's clip anchor is loc[last] (the OUTER arrange); the inner cat is
    // an interior entry. (Bind uses loc[0], the content leaf.)
    const code = 'arrange([2, cat(note("c3"), note("e3"))], [1, note("g3")])'
    const ir = parse(code)
    const ev = walkLeafItems(ir, 1).find((e) => e.labelValue === 'c3')!
    expect(ev.loc!.length).toBeGreaterThanOrEqual(2)
    const outer = ev.loc![ev.loc!.length - 1]!
    expect(code.slice(outer.start, outer.start + 'arrange('.length)).toBe('arrange(')
    // the inner cat is present as an interior loc entry (not the outermost)
    expect(ev.loc!.some((l) => code.slice(l.start, l.start + 'cat('.length) === 'cat(')).toBe(true)
  })
})

describe('Phase 5a — round-trip', () => {
  it('toStrudel re-emits the literal combinator', () => {
    expect(toStrudel(parse('arrange([2, note("c3")], [1, note("e3")])'))).toContain('arrange([2,')
    expect(toStrudel(parse('cat(note("c3"), note("e3"))'))).toMatch(/^cat\(/)
  })

  it('JSON serialize round-trips arms + weights + mode', () => {
    const ir = parse('arrange([2, note("c3")], [1, note("e3")])')
    const back = patternFromJSON(patternToJSON(ir))
    const u = unwrapD1(back)
    expect(u.tag).toBe('Arrange')
    if (u.tag === 'Arrange') expect(u.arms.map(a => a.weight)).toEqual([2, 1])
  })
})

describe('#434 — fastcat/Seq round-trip preserves ONE-cycle semantics', () => {
  // A non-collapsible fastcat: children can't fold into mini, so toStrudel must
  // pick a function form. The bug emitted `cat(...)` (slowcat = one cycle PER
  // child) → a 1-cycle sequence became 2-cycle. Now it emits `fastcat(...)`.
  const FASTCAT = 'fastcat(note("c3").fast(2), note("e3"))'

  it('toStrudel emits fastcat() for a non-collapsible Seq, not cat()', () => {
    const code = toStrudel(parse(FASTCAT))
    expect(code).toMatch(/^fastcat\(/)
    expect(code).not.toMatch(/^cat\(/)
  })

  it('parse → toStrudel → parse is identity (Seq + userMethod fastcat)', () => {
    const first = unwrapD1(parse(FASTCAT))
    expect(first.tag).toBe('Seq')
    if (first.tag === 'Seq') expect(first.userMethod).toBe('fastcat')
    const round = unwrapD1(parse(toStrudel(first)))
    expect(round.tag).toBe('Seq')
    if (round.tag === 'Seq') expect(round.userMethod).toBe('fastcat')
  })

  it('round-tripped code keeps ONE-cycle timing in real Strudel', async () => {
    // Ground truth: the re-emitted code must produce the SAME onsets as the
    // original over the same window. The old cat() emit would shift e3 to
    // cycle 1 (period 2); fastcat() keeps both in cycle 0 (period 1).
    const original = await strudelOnsets(FASTCAT, 2)
    const reemitted = await strudelOnsets(toStrudel(parse(FASTCAT)), 2)
    const norm = (xs: typeof original) =>
      xs.map(e => ({ note: e.note, begin: +e.begin.toFixed(4), end: +e.end.toFixed(4) }))
        .sort((a, b) => a.begin - b.begin)
    expect(norm(reemitted)).toEqual(norm(original))
  })

  it('patternToJSON/patternFromJSON preserves userMethod=fastcat (serialize fix)', () => {
    const ir = parse(FASTCAT)
    const back = unwrapD1(patternFromJSON(patternToJSON(ir)))
    expect(back.tag).toBe('Seq')
    if (back.tag === 'Seq') expect(back.userMethod).toBe('fastcat')
    // and the JSON-restored IR still re-emits fastcat (not cat)
    expect(toStrudel(back)).toMatch(/^fastcat\(/)
  })
})
