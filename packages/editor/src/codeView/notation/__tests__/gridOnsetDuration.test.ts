/**
 * The grid reader keeps each note's LENGTH (#1010 P4a).
 *
 * WHY THIS IS PINNED AT THE READER. Three axes have now been caught being dropped
 * on the way in — duration (#1026), gain (#1027), and a sounding note omitted
 * because `part` went unread (#1028) — and each one surfaced much later as a
 * silent-corruption class, once a writer re-derived what the model never held.
 * The reader is where that class starts, so it is where the axis is asserted.
 *
 * `readGridOnsets` is exported for this test alone. That is deliberate: the
 * boundary that drops axes is the one worth being able to interrogate directly,
 * and a field nothing asserts is a field that drifts (the lesson of #1031).
 *
 * The cases are chosen so that a reader which merely returned a CONSTANT — the
 * column width, say — would fail every one of them: each pattern has notes of
 * UNEQUAL length, and two of them have lengths that are not the grid's resolution
 * at all.
 */
import { describe, it, expect } from 'vitest'
import { miniPattern } from '../../strudelMini/pattern'
import { readGridOnsets, type Onset } from '../parse'

/**
 * flatten to `atom@pos×dur` triples, rounded, so a mismatch reads in one line
 *
 * Reads `occ` — every hap the column held — rather than the derived `atoms`/`durs`
 * pair (#1034). For a pattern where no two haps at a column share a token the two
 * are identical, which is every case below except the collapse ones at the end;
 * reading the authority means those cases can be written at all.
 */
function read(mini: string): string[] {
  const r = readGridOnsets(miniPattern(mini), 0)
  if (!r.ok) throw new Error(`${mini} refused at gate: ${JSON.stringify(r.gate)}`)
  return (r.onsets as Onset[]).flatMap((o) =>
    o.occ.map((c) => `${c.token}@${o.pos.toFixed(3)}×${(c.dur ?? NaN).toFixed(3)}`),
  )
}

describe('#1010 P4a — the grid reader carries duration, as the roll always has', () => {
  it('reads equal lengths for an even pair', () => {
    expect(read('bd sd')).toEqual(['bd@0.000×0.500', 'sd@0.500×0.500'])
  })

  it('reads the WEIGHT an `@n` gives a note, not the column width', () => {
    // `bd@3 sd` is 3:1 — bd holds three quarters of the cycle. A reader that
    // returned the grid's resolution would say 0.5 for both.
    expect(read('bd@3 sd')).toEqual(['bd@0.000×0.750', 'sd@0.750×0.250'])
  })

  it('reads a length FINER than the grid resolution — the corruption case', () => {
    // `[hh ~]!16` is the unit named in the write path's duration-loss list: sixteen
    // notes of 1/32 each, laid on a 1/16 grid. Re-spelling it from a duration-free
    // cell model yields `~ hh hh …` — sixteen correct onsets, each twice as long.
    // This asserts the fact that makes that loss DETECTABLE rather than invisible.
    const got = read('[hh ~]!16')
    expect(got).toHaveLength(16)
    expect(got[0]).toBe('hh@0.000×0.031')
    expect(got[15]).toBe('hh@0.938×0.031')
    // every note the same length, and that length HALF the 1/16 column it sits in
    expect(new Set(got.map((g) => g.split('×')[1])).size).toBe(1)
  })

  it('reads a repeated element as several notes, each its own share', () => {
    expect(read('bd*2 sd')).toEqual([
      'bd@0.000×0.250',
      'bd@0.250×0.250',
      'sd@0.500×0.500',
    ])
  })

  it('reads a fractional weight against its siblings, not against the cycle', () => {
    // 0.5 : 1 : 1 : 1 — bd takes 0.5/3.5 of the cycle, an irrational-looking 1/7
    // that no resolution-derived guess would produce.
    expect(read('[bd@0.5 - - -]')).toEqual(['bd@0.000×0.143'])
  })
})

describe('#1034 — one sound at one column with two lengths keeps both', () => {
  /**
   * The atom dedupe is a DISPLAY rule. It used to gate the span and the length as
   * well, so where a `,`-stack put the same token on one column the second hap was
   * dropped entirely — and WHICH one survived came down to hap arrival order.
   *
   * Measured before the fix: 2 of the 889 musical units across 150 tunes, 4 of the
   * 1500 distinct corpus minis. Nil impact then (none of them project, and nothing
   * read the field yet), which is exactly what made it worth closing before P4b
   * puts the length into the cell.
   */
  /**
   * WHY ASSERTING AN ORDER HERE IS SAFE, and not a flake waiting to happen.
   *
   * The issue this closes says which length survived came down to "hap arrival
   * order", which reads like non-determinism — it is not. `stack`'s query is
   * `flatten(pats.map((pat) => pat.query(state)))`
   * (`@strudel/core@1.2.6/pattern.mjs:1324`): a map over the parts in SOURCE
   * order, flattened. So a stack's haps arrive in part order, deterministically.
   *
   * What was arbitrary was never the order — it was letting the order DECIDE
   * which of two real notes to keep. The order itself is stable enough to pin,
   * and pinning it is what makes "both are kept, in part order" checkable at all.
   */
  it('keeps BOTH lengths when a stack sounds one token twice at one instant', () => {
    // part A: `bd*2` → bd at 0 for 0.5. part B: `bd` → bd at 0 for the full cycle.
    expect(read('bd*2, bd')).toEqual([
      'bd@0.000×0.500',
      'bd@0.000×1.000', // ← dropped entirely before #1034
      'bd@0.500×0.500',
    ])
  })

  it('keeps both ANCHORS too — the span is the write-back target, not a label', () => {
    // The span collapsed under the same guard, and predates the duration field.
    // A column resolving to one anchor means an edit writes to one of the two
    // source leaves and silently ignores the other.
    const r = readGridOnsets(miniPattern('bd*2, bd'), 0)
    if (!r.ok) throw new Error('refused')
    const first = (r.onsets as Onset[]).find((o) => o.pos === 0)!
    expect(first.occ.map((c) => c.span)).toEqual([
      { start: 0, end: 2 }, // `bd*2`'s leaf
      { start: 6, end: 8 }, // the stacked `bd`'s leaf
    ])
    // the DISPLAY view still shows the sound once — that rule was never wrong
    expect(first.atoms).toEqual(['bd'])
  })

  it('records both members of a stack whose parts AGREE, losing nothing either way', () => {
    // `[bd@2, bd]` cannot exhibit the LOSS: a `,`-stack normalizes each part to
    // the full cycle, so both haps read 1.0 and the old guard discarded a value
    // identical to the one it kept. Kept as a case because it was the first probe
    // tried for this defect and it cannot produce the failure — a probe that
    // cannot fail is not evidence of absence.
    //
    // Note the column still holds TWO occurrences now, not one: the count changes
    // even where no length does, because two notes really are sounding. Only the
    // derived `atoms` collapses them, which is what display should do.
    expect(read('[bd@2, bd]')).toEqual(['bd@0.000×1.000', 'bd@0.000×1.000'])
    const r = readGridOnsets(miniPattern('[bd@2, bd]'), 0)
    if (!r.ok) throw new Error('refused')
    expect((r.onsets as Onset[])[0].atoms).toEqual(['bd'])
  })

  it('leaves a stack with DISTINCT tokens exactly as it was', () => {
    expect(read('bd*2, sd')).toEqual([
      'bd@0.000×0.500',
      'sd@0.000×1.000',
      'bd@0.500×0.500',
    ])
  })

  it('keeps both lengths for a real corpus unit, not only a constructed one', () => {
    // `hh,hh oh sd` — a sustained hh layered against hh oh sd. One of the four the
    // corpus sweep found, and the only one that reads as music rather than a probe.
    const got = read('hh,hh oh sd')
    expect(got.filter((g) => g.startsWith('hh@0.000'))).toEqual([
      'hh@0.000×1.000',
      'hh@0.000×0.333',
    ])
  })
})
