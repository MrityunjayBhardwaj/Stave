/**
 * How a bar's divisions ask Strudel (#2278): the rows of one group share ONE marked copy,
 * and that copy is still checked against the pattern.
 *
 * Every marked copy evaluates the whole pattern, so a copy per row made a stack of N parts
 * cost N whole patterns (7.2 s for a 100-part stack in the corpus). The count of copies is
 * the cost's shape, and unlike a wall clock it can be asserted on.
 *
 * `markedPattern` is wrapped here: it counts the copies, and on request hands back a copy
 * that plays one unmarked note differently — the copy the guard must refuse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RowMarks } from '../pattern'

const spy = vi.hoisted(() => ({ copies: [] as number[], move: null as string | null }))

vi.mock('../pattern', async (importOriginal) => {
  const real = await importOriginal<typeof import('../pattern')>()
  return {
    ...real,
    markedPattern: (mini: string, rows: readonly RowMarks[]) => {
      spy.copies.push(rows.length)
      const copy = real.markedPattern(mini, rows)
      const moved = spy.move
      if (moved === null) return copy
      // the same pattern, except that the unmarked note `moved` now plays another sound
      return { ...copy, hits: (cyc: number) => copy.hits(cyc).map((h) => (h.value === moved ? { ...h, value: 'moved' } : h)) }
    },
  }
})

const { barDivisions } = await import('../divisions')
const { miniPattern } = await import('../pattern')

beforeEach(() => {
  spy.copies = []
  spy.move = null
})

describe('barDivisions — one marked copy per group, not per row', () => {
  it('a stack of comma parts is asked in one copy, whatever the number of parts', () => {
    for (const parts of [2, 10, 40]) {
      spy.copies = []
      const mini = Array.from({ length: parts }, (_, i) => `bd*${i + 1}`).join(', ')
      const d = barDivisions(miniPattern(mini), 0)
      expect(d.ok && d.parts.length).toBe(parts)
      // one copy, holding every part's marks
      expect(spy.copies).toEqual([parts])
    }
  })

  it('every row one depth down shares one more copy; a repeated group is asked once more with its op kept', () => {
    barDivisions(miniPattern('bd [hh hh, cp] [sd sd]*2'), 0)
    // the top row; the top row again for [sd sd], op kept; the two rows inside [hh hh, cp] with the row inside [sd sd]
    expect(spy.copies).toEqual([1, 1, 3])
    // a chord progression: every chord's notes, one copy for all of them
    spy.copies = []
    barDivisions(miniPattern('[e3,a3,c4]@2 [e3,a3,c4] [e3,a3,d4]@2 [e3,a3,d4]'), 0)
    expect(spy.copies).toEqual([1, 12])
  })
})

describe('barDivisions — the copy is still checked against the pattern', () => {
  it('a copy that plays an unmarked note differently is refused', () => {
    // `e` sits outside the group whose rows are marked: it must play as it did
    const mini = '[a b, c d] e'
    expect(barDivisions(miniPattern(mini), 0).ok).toBe(true)
    spy.move = 'e'
    expect(barDivisions(miniPattern(mini), 0)).toEqual({ ok: false, why: 'marked-copy-differs' })
  })

  it('…and so is one where the note moved is in a row the copy does not mark', () => {
    // the inner rows of [c d, f] are asked with `a` and `b` unmarked
    const mini = 'a [c d, f] b'
    expect(barDivisions(miniPattern(mini), 0).ok).toBe(true)
    spy.move = 'b'
    expect(barDivisions(miniPattern(mini), 0)).toEqual({ ok: false, why: 'marked-copy-differs' })
  })
})
