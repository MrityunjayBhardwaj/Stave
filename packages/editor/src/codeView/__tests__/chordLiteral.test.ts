import { describe, it, expect } from 'vitest'
import { detectChunk } from '../chunkDetect'
import { chunkSurface } from '../surface/surfaceRoute'

/**
 * #2142 — a chord progression written inside `chord("…")` opens in the Pattern tab, as
 * the same progression through a name (`chord(v)`) already did.
 */

/** the surface the tab opens with the cursor on the first `chord(` */
const surfaceAt = (doc: string) => chunkSurface(detectChunk(doc, doc.indexOf('chord(') + 2))

describe('chord(…) literals in the Pattern tab (#2142)', () => {
  it('opens a chord progression written in the call, like one written through a name', () => {
    expect(surfaceAt('$: chord("<Em9 A13>").voicing().s("piano")')).toBe('step')
    expect(surfaceAt('const v = "<Em9 A13>"\n$: chord(v).voicing().s("piano")')).toBe('step')
  })

  it('keeps bare triads a chord chart, in both spellings, not three notes for the roll', () => {
    expect(surfaceAt('$: chord("<C F G>").voicing()')).toBe('step')
    expect(surfaceAt('const v = "<C F G>"\n$: chord(v).voicing()')).toBe('step')
  })

  it('leaves a string that is a control value, not the music, in standby', () => {
    // the scoping chunkSurface keeps on purpose: `lpf`'s string is a filter setting
    const lpf = '$: lpf("0 1 2")'
    expect(chunkSurface(detectChunk(lpf, 4))).toBeNull()
    const gain = '$: gain("[0 1]*2.5")'
    expect(chunkSurface(detectChunk(gain, 4))).toBeNull()
  })
})
