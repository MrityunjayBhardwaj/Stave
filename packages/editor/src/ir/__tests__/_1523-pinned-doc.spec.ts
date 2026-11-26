/**
 * What does the document the #1096 pin froze parse to now?
 * Printed, not assumed, before that pin is rewritten.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

describe('the #1096 pinned document under #1523', () => {
  it('prints both parsers', () => {
    const code = 'let a = s("bd*4")\na.fast(2)\ns("hh*8")'
    const mono = parseStrudel(code)
    const staged = stripStageMeta(pipeline(code))
    console.log('MONOLITHIC\n' + JSON.stringify(mono, null, 2))
    console.log('STAGED\n' + JSON.stringify(staged, null, 2))
    expect(mono.tag).toBe(staged.tag)
  })
})
