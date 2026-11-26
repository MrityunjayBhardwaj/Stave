import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
const j = (n: unknown) => JSON.stringify(n, (k, v) => (k === 'loc' ? undefined : v))
describe('#1547 — does the PATTERN map resolve a shadowed arrow param?', () => {
  it('prints both', () => {
    const noShadow = parseStrudel(`let p = s("bd")\n$: s("x").every(2, y => y.cat(p))`)
    const shadowed = parseStrudel(`let p = s("bd")\n$: s("x").every(2, p => p.cat(p))`)
    // CONTROL: the same shadowed document with NO document-level p at all.
    const nodoc    = parseStrudel(`$: s("x").every(2, p => p.cat(p))`)
    console.log('\nNO SHADOW  ' + j(noShadow))
    console.log('\nSHADOWED   ' + j(shadowed))
    console.log('\nNO DOC-P   ' + j(nodoc))
    console.log('\nshadowed === nodoc ? ' + (j(shadowed) === j(nodoc)))
    console.log('shadowed === noShadow ? ' + (j(shadowed) === j(noShadow)))
    expect(true).toBe(true)
  })
})
