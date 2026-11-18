/**
 * #2560 — the inline viz a pattern's code asks for, read without running it, so
 * their sketches can warm up before Play. Mirrors the engine's capture rules.
 */
import { describe, it, expect } from 'vitest'
import { readInlineVizNames, readInlineVizCalls } from '../inlineVizCalls'

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

// #2630 — the warm-up mounts each sketch with the options its code writes, so a
// sketch that reads them once at mount gets them; what only an evaluation can
// tell is null (warmed with none, and Play adopts it only if the zone gets none).
describe('readInlineVizCalls (#2630)', () => {
  const opts = (doc: string) => readInlineVizCalls(doc)?.map((c) => c.options) ?? null

  it('a .viz() call with literal options: the values', () => {
    expect(readInlineVizCalls('$: note("c4").viz("probe", { r: 1, g: 0, b: 0 })')).toEqual([
      { name: 'probe', options: { r: 1, g: 0, b: 0 } },
    ])
  })
  it('no options argument: none', () => {
    expect(opts('$: s("bd").viz("A")')).toEqual([{}])
  })
  it('a viz method passes its options first', () => {
    expect(opts('$: note("c4")._pianoroll({ fold: 1 })')).toEqual([{ fold: 1 }])
  })
  it('a value only an evaluation can produce: null', () => {
    expect(opts('$: s("bd").viz("A", { r: slider(0.5) })')).toEqual([null])
    expect(opts('const o = { r: 1 }\n$: s("bd").viz("A", o)')).toEqual([null])
  })
  it('the last inline call on a chain wins, with its own options', () => {
    expect(readInlineVizCalls('$: s("bd").viz("A", { r: 1 }).viz("B")')).toEqual([{ name: 'B', options: {} }])
  })
  it('names read the same as before', () => {
    const doc = '$: s("bd").viz("A", { r: 1 })\n$: note("c")._pianoroll()\n_$: s("x").viz("C")'
    expect(readInlineVizNames(doc)).toEqual(readInlineVizCalls(doc)!.map((c) => c.name))
  })
})
