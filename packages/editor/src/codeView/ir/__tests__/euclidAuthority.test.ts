/**
 * euclidAuthority.test.ts — the IR must draw the euclid rhythm Strudel PLAYS.
 *
 * The oracle here is `@strudel/mini`'s own evaluator, queried for real haps —
 * not a table of rhythms I typed in. That matters: the bug this file pins
 * (#907) existed *because* someone wrote down what they believed the rhythm
 * was. A test asserting `bd(5,8) === '10101011'` would have passed against the
 * broken code forever, since it encodes the same belief. Asking Strudel what
 * it actually triggers is the only check that can disagree with us.
 *
 * WHAT WENT WRONG (#907), and why it lived three months:
 *   - `parseMini`'s hand-rolled `bjorklund` disagreed with Strudel's on 44 of
 *     152 (k,n) pairs to n=16 — `bd(5,8)` plays 10110110, the IR drew 10101011.
 *   - Its rotation ran the wrong way: Strudel's `_euclidRot` does
 *     `rotate(b, -rotation)` (a RIGHT rotation); we left-rotated.
 * Both defaults are correct — `bd(3,8)` is one of the pairs the copy got right,
 * and `rot=0` is a no-op in either direction. The canonical example works, the
 * docs example works, so every hand-check passed while the timeline drew a
 * rhythm the audio never played. Nothing threw. The two representations were
 * simply never compared, which is what this file now does on every run.
 */
import { describe, it, expect } from 'vitest'
import { mini } from '@strudel/mini/mini.mjs'
import { parseMini } from '../parseMini'
import { bjorklund } from '../parseMini'
import { bjorklund as strudelBjorklund } from '@strudel/core/euclid.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** the onset mask Strudel actually triggers over one cycle */
function played(pat: string, steps: number): string {
  const haps = (mini(pat) as any).queryArc(0, 1)
  const on = new Set(haps.map((h: any) => Math.round(Number(h.part.begin) * steps)))
  return Array.from({ length: steps }, (_, i) => (on.has(i) ? '1' : '0')).join('')
}

/** the onset mask the IR draws — Play = onset, Sleep = rest, in order */
function drawn(pat: string): string {
  const ir: any = parseMini(pat)
  return (ir.children ?? []).map((c: any) => (c.tag === 'Play' ? '1' : '0')).join('')
}

describe('euclid: the IR draws what Strudel plays', () => {
  // (k,n) pairs spanning the region the old copy got WRONG. `bd(3,8)` is
  // included deliberately: it is the case that always worked, and it is why
  // nobody noticed. A regression that only breaks the others must still fail.
  const CASES: [string, number][] = [
    ['bd(3,8)', 8], // the canonical one — correct even when broken
    ['bd(5,8)', 8], // the cinquillo — was 10101011, plays 10110110
    ['bd(4,6)', 6], // first disagreement in the sweep
    ['bd(6,8)', 8],
    ['bd(7,16)', 16],
    ['bd(2,5)', 5],
    ['bd(9,16)', 16],
  ]

  it.each(CASES)('%s', (pat, steps) => {
    expect(drawn(pat)).toBe(played(pat, steps))
  })

  // Rotation: Strudel's `_euclidRot` is `rotate(b, -rotation)`. rot=0 is the
  // no-op that hid the sign error, so the non-zero cases carry the assertion.
  const ROT: [string, number][] = [
    ['bd(3,8,0)', 8],
    ['bd(3,8,1)', 8],
    ['bd(3,8,2)', 8],
    ['bd(3,8,3)', 8],
    ['bd(5,8,2)', 8],
  ]

  it.each(ROT)('%s (rotation)', (pat, steps) => {
    expect(drawn(pat)).toBe(played(pat, steps))
  })
})

describe('bjorklund: the exported distribution IS Strudel"s', () => {
  /**
   * The sweep that found it. 44/152 disagreed before the fix; the assertion is
   * total agreement, so any future re-transcription fails here immediately
   * rather than in a rhythm someone notices months later.
   */
  it('agrees with @strudel/core on every (k,n) to n=16', () => {
    const disagree: string[] = []
    for (let n = 1; n <= 16; n++) {
      for (let k = 1; k < n; k++) {
        const ours = bjorklund(k, n).map((x) => (x ? 1 : 0)).join('')
        const theirs = strudelBjorklund(k, n).join('')
        if (ours !== theirs) disagree.push(`(${k},${n}) ours=${ours} strudel=${theirs}`)
      }
    }
    expect(disagree).toEqual([])
  })

  /**
   * The degenerate ends stay OURS: upstream computes `steps - hits` as the
   * zero-run length, so k >= n throws there. Callers expect an n-long mask.
   */
  it('holds the degenerate ends upstream does not', () => {
    expect(() => strudelBjorklund(5, 4)).toThrow()
    expect(bjorklund(5, 4)).toEqual([true, true, true, true])
    expect(bjorklund(4, 4)).toEqual([true, true, true, true])
    expect(bjorklund(0, 4)).toEqual([false, false, false, false])
    // A NEGATIVE k with |k| < n is NOT empty — it is Strudel's INVERSION
    // (euclid.mjs): (-1,3) plays the 2 steps a euclid 1 leaves out. This line
    // pinned all-false while the hand parser's tokenizer refused negative
    // pulses outright, so the case was never exercised; #943 unified the two
    // euclid helpers onto the authority, which inverts. Asserting all-false
    // here contradicted this file's own thesis (draw what Strudel plays).
    expect(bjorklund(-1, 3)).toEqual([false, true, true])
    expect(bjorklund(3, 0)).toEqual([])
    expect(bjorklund(3, -2)).toEqual([])
  })
})
