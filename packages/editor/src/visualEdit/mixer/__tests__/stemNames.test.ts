import { describe, it, expect } from 'vitest'

import { detectAllChunks } from '../../../codeView/chunkDetect'
import { buildStripModels } from '../../../codeView/mixer/stripModel'
import { countStemTracks, stemFileNames, SONG_LEVEL_STEM_NAME } from '../stemNames'
import { SONG_LEVEL_STEM } from '../../../engine/stemSplit'

/**
 * #1648 — a stem file is named as the mixer strip for the same track is named,
 * joined on the capture id the strip already carries for its meter.
 */

const DOC = `setcps(0.5)
drums: s("bd sd")
$: note("c3 e3").s("sawtooth")
_$: s("hh*8")
$: s("cp*2")`

describe('stemFileNames (#1648)', () => {
  it('names each stem after its mixer strip, numbered in document order', () => {
    const strips = buildStripModels(detectAllChunks(DOC), DOC).filter((s) => !s.muted)
    const ids = strips.map((s) => s.captureId)
    const names = stemFileNames(DOC, ids)
    expect(names).toEqual(strips.map((s, i) => `${String(i + 1).padStart(2, '0')}-${s.name.replace(/[^a-z0-9_-]+/gi, '_')}.wav`))
    // And concretely, so a change to what the strips are called shows up here too.
    expect(ids).toEqual(['drums', '$0', '$1'])
    expect(names[0]).toBe('01-drums.wav')
  })

  it('the song-level stem gets its own name', () => {
    expect(stemFileNames(DOC, ['drums', SONG_LEVEL_STEM])).toEqual(['01-drums.wav', `02-${SONG_LEVEL_STEM_NAME}.wav`])
  })

  it('an id no strip carries keeps the id, made file-safe', () => {
    expect(stemFileNames(DOC, ['$9'])).toEqual(['01-9.wav'])
  })

  it('two tracks the user could name alike are named apart upstream (#1667)', () => {
    // `d2:` is a legal label and the second track's positional name was `d2`
    // too, so this file used to have to de-duplicate them into
    // `02-d2-2.wav`. The strips no longer hand it a duplicate — the positional
    // name counts past anything a label claimed.
    const doc = `d2: s("bd*2")\n$: s("hh*4")`
    const strips = buildStripModels(detectAllChunks(doc), doc)
    expect(strips.map((s) => s.name)).toEqual(['d2', 'd3'])
    expect(stemFileNames(doc, strips.map((s) => s.captureId))).toEqual(['01-d2.wav', '02-d3.wav'])
  })

  it('still de-duplicates names it is handed directly', () => {
    // The suffix rule stays: `stemFileNames` takes ids, and an id no strip
    // carries falls back to the id itself, which nothing upstream de-duplicates
    // (`$0` and `_0` both sanitise to `0`). A stem file must never overwrite
    // another stem file, whatever the strips did.
    expect(stemFileNames('this is ( not code', ['$0', '_0'])).toEqual(['01-0.wav', '02-0-2.wav'])
  })

  it('a document the chunker cannot read still names its stems', () => {
    expect(stemFileNames('this is ( not code', ['$0'])).toEqual(['01-0.wav'])
  })
})

describe('countStemTracks — what the document says before it has ever run (#1666)', () => {
  it('counts one per track, from the text alone', () => {
    expect(
      countStemTracks(`setcps(0.5)
drums: s("bd*4")
$: note("c3 e3")
bass: note("c2")`),
    ).toBe(3)
  })

  it('counts a bare document as the one track it exports', () => {
    // No `$:` and no `name:`: nothing is registered with the engine, and the
    // whole played pattern is the single stem. The strips say one, which is
    // exactly what such a document exports — measured, not assumed; an earlier
    // version of this arm expected 0 and the strips disagreed.
    expect(countStemTracks('s("bd*4")')).toBe(1)
  })

  it('answers 0 rather than throwing on a document it cannot read', () => {
    expect(countStemTracks('$: note("c3"')).toBe(0)
  })
})
