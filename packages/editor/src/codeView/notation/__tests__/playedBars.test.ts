import { describe, it, expect } from 'vitest'
import { parseStepGrid, parsePianoRoll } from '../parse'

/**
 * How long a pattern is: one rule for the grid, the roll and the Song view (#1931).
 * The four projections (reached when the syntactic core declines) ask `detectPeriod`
 * from ir/songAnalysis.ts. These pin what they must keep answering: silence is
 * "nothing to show", not a period; a period within the cap is that many bars; one
 * past the cap is refused. The inputs are corpus patterns that reach the projections
 * (the core opens a plain `~ ~ ~` or `<c3 e3 g3 b3 d4>` itself).
 */
describe('#1931 — a pattern is as many bars as the period it repeats at', () => {
  it('a pattern that plays nothing is refused as having nothing to show, on both surfaces', () => {
    expect(parseStepGrid('{~}')).toMatchObject({ ok: false, gate: 'no-note-content' })
    expect(parsePianoRoll('{~}')).toMatchObject({ ok: false, gate: 'no-note-content' })
    expect(parseStepGrid('<~@33 ht mt lt>')).toMatchObject({ ok: false, gate: 'no-note-content' })
  })

  it('a period past the roll cap of four bars is refused, not cut short', () => {
    expect(parsePianoRoll('<0 .1 .4 .6 1>')).toMatchObject({ ok: false, gate: 'unstable-period' })
    expect(parsePianoRoll('{g d c b a}%16')).toMatchObject({ ok: false, gate: 'unstable-period' })
  })

  it('a period within the cap is that many bars', () => {
    expect(parsePianoRoll('<0 .1 .4 .6>')).toMatchObject({ ok: true, model: { bars: 4 } })
  })
})
