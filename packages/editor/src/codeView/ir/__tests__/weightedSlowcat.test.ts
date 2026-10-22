/**
 * weightedSlowcat.test.ts — #463 Stage 0.
 *
 * Mini-notation angle-bracket alternation `<…>` honors per-arm `@weight`
 * (a weighted slowcat): `x@n` occupies n WHOLE cycles. Every expectation
 * here was GROUNDED against real `@strudel/mini` haps (queryArc per cycle)
 * — see the parity-style probe used during the fix.
 *
 * Two bugs this guards against:
 *   1. `Cycle` collect ignored `@weight` (picked items[cycle % len]) →
 *      `<a@2 b@2>` came out `a b a b` instead of `a a b b`.
 *   2. A weight/modifier after a rest or a closing group delimiter
 *      (`~@4`, `<a b>@2`, `[a b]@2`) was dropped and its digit re-read as a
 *      bogus atom (`~@4` → Sleep + Play("4")).
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '..'
import { walkLeafItems } from '../structuralWalk'

// The weighted-slowcat CYCLE MODEL (which arm plays in which cycle) is a
// structural property of the parsed `<…@w>` IR, so `walkLeafItems` — the
// behaviour-free structural walk that mirrors the retired collect's per-cycle
// arm selection — reproduces the note-per-cycle stream WITHOUT the behaviour
// interpreter. `labelValue` is `s ?? String(note)`; a rest arm reaches no leaf,
// so its cycle contributes the empty string.
function notesPerCycle(mini: string, cycles: number): string[] {
  const ir = parseStrudel(`note("${mini}")`)
  const items = walkLeafItems(ir, cycles)
  const byCycle: Record<number, string[]> = {}
  for (const it of items) (byCycle[it.cycle] ||= []).push(String(it.labelValue ?? ''))
  return Array.from({ length: cycles }, (_, c) => (byCycle[c] || []).sort().join(','))
}

describe('#463 Stage 0 — weighted angle-bracket slowcat', () => {
  it('`<a@2 b@2>` — each arm spans 2 whole cycles (a a b b …), not a b a b', () => {
    expect(notesPerCycle('<a@2 b@2>', 8)).toEqual(['a', 'a', 'b', 'b', 'a', 'a', 'b', 'b'])
  })

  it('`<a@3 b>` — asymmetric weights (period 4)', () => {
    expect(notesPerCycle('<a@3 b>', 8)).toEqual(['a', 'a', 'a', 'b', 'a', 'a', 'a', 'b'])
  })

  it('`<~@4 verse@8 chorus@8>` — the pickRestart control: rest 4, verse 8, chorus 8', () => {
    const got = notesPerCycle('<~@4 verse@8 chorus@8>', 20)
    expect(got).toEqual([
      '', '', '', '',                                                 // ~@4
      'verse', 'verse', 'verse', 'verse', 'verse', 'verse', 'verse', 'verse', // verse@8
      'chorus', 'chorus', 'chorus', 'chorus', 'chorus', 'chorus', 'chorus', 'chorus', // chorus@8
    ])
  })

  it('`~@4` does NOT leak the weight digit as a note value', () => {
    // Bug 2 discriminator: pre-fix this produced a Play("4") at cycle 1.
    const items = walkLeafItems(parseStrudel('note("<~@4 a>")'), 5)
    expect(items.every((it) => it.labelValue !== '4')).toBe(true)
    // cycles 0..3 are the rest (no leaves), cycle 4 is `a`.
    expect(notesPerCycle('<~@4 a>', 6)).toEqual(['', '', '', '', 'a', ''])
  })

  it('`<<a b>@2 c@2>` — weighted arm that is itself an alternation', () => {
    // Inner `<a b>` advances once per outer period (floor(cycle/period)).
    expect(notesPerCycle('<<a b>@2 c@2>', 12)).toEqual([
      'a', 'a', 'c', 'c', 'b', 'b', 'c', 'c', 'a', 'a', 'c', 'c',
    ])
  })

  it('`<bd <hh cp>>` — nested arm advances on visit (bd hh bd cp)', () => {
    expect(notesPerCycle('<bd <hh cp>>', 4)).toEqual(['bd', 'hh', 'bd', 'cp'])
  })

  it('unweighted `<a b c>` still cycles a b c (default weight 1)', () => {
    expect(notesPerCycle('<a b c>', 6)).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('`[a b]@2 c` — group weight in a Seq does not leak a digit', () => {
    // `[a b]@2` weights the group's slot 2:1 vs `c`; all three play each cycle.
    expect(notesPerCycle('[a b]@2 c', 3)).toEqual(['a,b,c', 'a,b,c', 'a,b,c'])
  })
})
