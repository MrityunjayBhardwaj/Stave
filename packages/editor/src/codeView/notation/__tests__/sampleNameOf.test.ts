/**
 * `sampleNameOf` — the sample a lane token names, as Strudel's `s` tuple reads it (#1941).
 *
 * The token comes from `tailToken`, which joins krill's tuple with `:`. These arms
 * take the tuple from Strudel itself (the same `reifyMini(...).queryArc` the grid
 * reads), join it the way the grid does, and require the head back. So a change to
 * either side of the pair goes red here, not in a drum label three files away.
 */
import { describe, it, expect } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { sampleNameOf, tailToken } from '../parse'

/** Every onset value Strudel produces for `src` over one cycle. */
function valuesOf(src: string): unknown[] {
  const pat = reifyMini(src) as { queryArc(a: number, b: number): Array<{ value: unknown }> }
  return pat.queryArc(0, 1).map((h) => h.value)
}

describe('sampleNameOf — the head of the tuple tailToken joined', () => {
  it("gives back Strudel's own tuple head for every variant shape", () => {
    // two members, three members, and a string member — all real corpus notation
    const values = valuesOf('bd:3 sd:0:0.5 piano:x:.5 hh:1:0.25')
    expect(values.every(Array.isArray)).toBe(true)
    for (const v of values as unknown[][]) {
      const token = tailToken(v)
      expect(token).not.toBeNull()
      expect(sampleNameOf(token!)).toBe(String(v[0]))
    }
  })

  it('a token with no variant is its own sample name', () => {
    const [v] = valuesOf('bd')
    expect(v).toBe('bd')
    expect(sampleNameOf('bd')).toBe('bd')
  })

  it('names the head of a non-sound tuple too, leaving meaning to the caller', () => {
    // `G:major` is a scale, not a sample. It still has a head; the drum map's
    // lookup is what decides `G` means nothing there.
    expect(sampleNameOf('G:major')).toBe('G')
    expect(sampleNameOf('0.5:0.01:0.5')).toBe('0.5')
  })
})
