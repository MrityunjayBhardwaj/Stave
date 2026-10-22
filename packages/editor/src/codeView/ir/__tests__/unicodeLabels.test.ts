/**
 * #1683 — a track label is any JavaScript identifier, not only ASCII.
 *
 * Strudel turns every labelled statement acorn can parse into `.p('label')`
 * (`@strudel/transpiler` `transpiler.mjs:468-470`), and acorn reads `節奏` as an
 * identifier. So `節奏: s("bd*4")` is a track named `節奏`. Each place that
 * recognises a label is asked the same question here, with the ASCII `drums` as
 * the control, so no site can quietly keep the old ASCII-only class.
 */
import { describe, it, expect } from 'vitest'
import { extractTracks, parseStrudel } from '../parseStrudel'
import { scanVizRequestLines } from '../../../engine/vizLineScan'
import { startsNamedTrack } from '../../../visualizers/blockScan'
import { isValidTrackLabel } from '../../mixer/writeStrip'
import { buildStripModels } from '../../mixer/stripModel'
import { detectAllChunks } from '../../chunkDetect'

const DOC = '節奏: s("bd*4")\n弦律: note("c e g")\ndrums: s("hh*8")'

describe('a non-Latin label names its track, everywhere a label is read (#1683)', () => {
  it('the parser reads each label, commented or live', () => {
    expect(extractTracks(DOC).map((t) => t.label)).toEqual(['節奏', '弦律', 'drums'])
    expect(extractTracks('//節奏: s("bd")\n弦律: s("hh")').map((t) => `${t.commented ? '//' : ''}${t.label}`)).toEqual(['//節奏', '弦律'])
  })

  it('the Song timeline names the tracks by their labels', () => {
    const ir = parseStrudel(DOC)
    const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
    expect(roots.map((t) => (t.tag === 'Track' ? t.trackId : t.tag))).toEqual(['節奏', '弦律', 'drums'])
  })

  it('the Mixer reads the same names', () => {
    expect(buildStripModels(detectAllChunks(DOC), DOC).map((s) => s.name)).toEqual(['節奏', '弦律', 'drums'])
  })

  it('an inline viz on a non-Latin track is keyed by its label, as the engine keys it', () => {
    const doc = '節奏: s("bd*4").pianoroll()\ndrums: s("hh*8").pianoroll()'
    const out = scanVizRequestLines(new Map([['節奏', 'pianoroll'], ['drums', 'pianoroll']]), doc)
    expect([...out.keys()].sort()).toEqual(['drums', '節奏'].sort())
  })

  it('a non-Latin label starts a named track block', () => {
    expect(startsNamedTrack('節奏: s("bd")')).toBe(true)
    expect(startsNamedTrack('drums: s("bd")')).toBe(true)
    expect(startsNamedTrack('1x: s("bd")')).toBe(false)
  })

  it('a rename may use a non-Latin name, and still refuses what is not an identifier', () => {
    expect(isValidTrackLabel('節奏')).toBe(true)
    expect(isValidTrackLabel('drums')).toBe(true)
    expect(isValidTrackLabel('名前2')).toBe(true)
    expect(isValidTrackLabel('1x')).toBe(false)
    expect(isValidTrackLabel('a-b')).toBe(false)
    expect(isValidTrackLabel('if')).toBe(false)
  })
})
