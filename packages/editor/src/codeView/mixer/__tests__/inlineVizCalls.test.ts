/**
 * #2560 — the inline viz a pattern's code asks for, read without running it, so
 * their sketches can warm up before Play. Mirrors the engine's capture rules.
 */
import { describe, it, expect } from 'vitest'
import { readInlineVizNames } from '../inlineVizCalls'

describe('readInlineVizNames (#2560)', () => {
  it('one name per track that shows an inline viz, in source order', () => {
    const doc = [
      'setcpm(30)',
      '$: s("bd*4").viz("Exchange")',
      'lead: note("c e g").s("piano")._pianoroll()',
      '$: s("hh*8")',
      '$: s("sd").viz("Exchange")',
    ].join('\n')
    expect(readInlineVizNames(doc)).toEqual(['Exchange', 'pianoroll', 'Exchange'])
  })

  it('skips backgrounds: the master line, backdrop: true, and plain viz methods', () => {
    const doc = [
      '$: s("bd").viz("Fold", { backdrop: true })',
      '$: s("hh").scope()',
      'all(x => x.viz("Exchange"))',
    ].join('\n')
    expect(readInlineVizNames(doc)).toEqual([])
  })

  it('a muted track is never captured, so it gets no zone', () => {
    expect(readInlineVizNames('_$: s("bd").viz("A")\n$_: s("bd").viz("B")\n_drums: s("bd").viz("C")')).toEqual([])
  })

  it('the last inline call on a track wins (one zone per track)', () => {
    expect(readInlineVizNames('$: s("bd").viz("A").gain(1).viz("B")')).toEqual(['B'])
  })

  it('a name only evaluation can tell is not read', () => {
    expect(readInlineVizNames('const n = "A"\n$: s("bd").viz(n)')).toEqual([])
  })

  it('a document that does not parse reads as null (keep what is warm)', () => {
    expect(readInlineVizNames('$: s("bd").viz("A"')).toBeNull()
  })
})
