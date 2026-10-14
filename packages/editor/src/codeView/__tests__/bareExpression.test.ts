import { describe, it, expect } from 'vitest'

import { playsBareExpression } from '../bareExpression'

// Where the bare expression a song plays starts (#2066, #2067), or null.
describe('playsBareExpression', () => {
  it('a song of one bare expression plays it', () => {
    expect(playsBareExpression('s("bd*4")\n')).toBe(0)
  })

  it('the last statement is the one that plays', () => {
    const code = 's("hh*8")\nstack(s("bd"), s("sd"))\n'
    expect(playsBareExpression(code)).toBe(code.indexOf('stack'))
  })

  it('under muted labels, the bare line still plays', () => {
    const code = '_$: s("hh*2")\nmel_: note("c")\ns("bd")\n'
    expect(playsBareExpression(code)).toBe(code.indexOf('s("bd")'))
  })

  it('a live label means the labels play, not the bare line', () => {
    expect(playsBareExpression('$: s("hh*2")\ns("bd")\n')).toBeNull()
  })

  it('a named live label counts as live', () => {
    expect(playsBareExpression('drums: s("hh*2")\ns("bd")\n')).toBeNull()
  })

  it('a song ending in a muted label plays nothing', () => {
    expect(playsBareExpression('s("bd")\n_$: s("hh*2")\n')).toBeNull()
  })

  it('a song ending in a setup call plays nothing', () => {
    expect([
      playsBareExpression('s("bd")\nsetcps(1)\n'),
      playsBareExpression('s("bd")\nsamples("github:x/y")\n'),
      playsBareExpression('s("bd")\nawait samples("github:x/y")\n'),
    ]).toEqual([null, null, null])
  })

  it('a chain that ends in a setup-named method is still a pattern', () => {
    expect(playsBareExpression('s("bd").setcps(1)\n')).toBe(0)
  })

  it('no code, or code that does not parse, plays no bare expression', () => {
    expect([playsBareExpression(''), playsBareExpression('s("bd"')]).toEqual([null, null])
  })
})
