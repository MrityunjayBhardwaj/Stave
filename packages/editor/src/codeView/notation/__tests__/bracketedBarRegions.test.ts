import { describe, it, expect } from 'vitest'

import { bracketedBarRegions } from '../parse'

/** the content's regions as `raw@[from,to)`, or null */
const read = (raw: string): string[] | null =>
  bracketedBarRegions(raw)?.map((r) => `${r.raw.trim()}@[${r.from},${r.to})`) ?? null

describe('bracketedBarRegions — one bracketed bar, asked of krill (#1855, #1942)', () => {
  it('reads the content of one `[…]` element as a step grid', () => {
    expect(read('[bd ~ bd ~]')).toEqual(['bd@[0,1)', '~@[1,2)', 'bd@[2,3)', '~@[3,4)'])
    // padding around the element is the region's, not the content's
    expect(read(' [~ sd ~ sd] ')).toEqual(['~@[0,1)', 'sd@[1,2)', '~@[2,3)', 'sd@[3,4)'])
  })

  it('is null for anything krill does not call one plain bracketed sequence', () => {
    for (const raw of [
      'bd', // an atom
      '[bd ~] [sd ~]', // two elements, though it starts with `[` and ends with `]`
      '<bd sd>', // an alternation
      '[bd, sd]', // a stack
      '[bd ~]*2', // an op
      '[bd ~]@2', // a weight
      '[bd ~]!2', // a replicate
      '[bd ~]?', // degrade
      '[bd ~', // krill throws
    ]) {
      expect(read(raw), raw).toBeNull()
    }
  })

  it('is null when the content is not one flat part', () => {
    expect(read('[<bd sd> hh]')).toBeNull()
  })
})
