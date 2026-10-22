/**
 * #1918 — a chain that names a control twice plays the LAST call. Every reader and
 * the setter must land on that call, or a control moves while the sound does not.
 *
 * The first block asks Strudel itself which value plays, so the rule these tests
 * hold the code to is the runtime's and not ours.
 */
import { describe, it, expect } from 'vitest'
import * as strudelCore from '@strudel/core'
import { detectAllChunks, type ChunkInfo } from '../chunkDetect'
import { applyEdits, type OffsetEdit } from '../writeback'
import { playingCall, readNumberCall, readChainMethod } from '../chainMethod'
import { setNumberCall } from '../chainEdit'
import { readGainState } from '../mixer/gain'
import { gainEdit, panEdit } from '../mixer/writeStrip'
import { buildStripModels } from '../mixer/stripModel'
import { readChunkGain, gridWriteEdits } from '../notation/gainEdit'
import { regionTrimEdit } from '../regionTrim'

// the package's types do not list its control functions; they exist at runtime
const s: (v: string) => any = (strudelCore as any).s
const chunk = (doc: string): ChunkInfo => detectAllChunks(doc)[0]
const after = (doc: string, edit: OffsetEdit | readonly OffsetEdit[] | null): string =>
  edit === null ? doc : applyEdits(doc, Array.isArray(edit) ? [...edit] : [edit as OffsetEdit])
const played = (pat: any, key: string): unknown => pat.queryArc(0, 1)[0].value[key]

describe('the call that plays (#1918)', () => {
  // Each row is a document and the same pattern built in code, so Strudel can say
  // which value it plays.
  const rows: { doc: string; pat: any; names: string[]; key: string }[] = [
    { doc: '$: s("bd").gain(0.5).gain(0.8)', pat: s('bd').gain(0.5).gain(0.8), names: ['gain'], key: 'gain' },
    { doc: '$: s("bd").gain(0.8).gain(0.5)', pat: s('bd').gain(0.8).gain(0.5), names: ['gain'], key: 'gain' },
    { doc: '$: s("bd").pan(0.1).pan(0.9)', pat: s('bd').pan(0.1).pan(0.9), names: ['pan'], key: 'pan' },
    { doc: '$: s("bd").begin(0.2).begin(0.6)', pat: s('bd').begin(0.2).begin(0.6), names: ['begin'], key: 'begin' },
  ]
  for (const r of rows) {
    it(`reads what Strudel plays: ${r.doc}`, () => {
      expect(readNumberCall(chunk(r.doc), r.names)).toBe(played(r.pat, r.key))
    })
  }

  it('an alias counts as the same control: `.s("bd").sound("hh")` plays hh', () => {
    const doc = '$: s("bd").sound("hh")'
    expect(played(s('bd').sound('hh'), 's')).toBe('hh')
    expect(readChainMethod(chunk(doc), ['sound', 's'])?.value).toBe('hh')
  })

  it('a bare call is the playing call, and it is not a number', () => {
    // `.gain()` wraps the event into `gain` rather than leaving 0.5 playing
    const pat = (s('bd') as any).gain(0.5).gain()
    expect(played(pat, 'gain')).not.toBe(0.5)
    const doc = '$: s("bd").gain(0.5).gain()'
    expect(playingCall(chunk(doc), ['gain'])?.args).toEqual([])
    expect(readNumberCall(chunk(doc), ['gain'])).toBeNull()
    expect(setNumberCall(chunk(doc), ['gain'], 'gain', 0.3)).toBeNull()
  })

  it('keeps written-but-not-a-number apart from absent', () => {
    expect(readNumberCall(chunk('$: s("bd").gain(sine)'), ['gain'])).toBeNull()
    expect(readNumberCall(chunk('$: s("bd")'), ['gain'])).toBe('absent')
    // the earlier number does not rescue a later signal: the signal is what plays
    expect(readNumberCall(chunk('$: s("bd").gain(0.5).gain(sine)'), ['gain'])).toBeNull()
  })
})

describe('every surface lands on the playing call (#1918)', () => {
  const doubled = '$: s("bd").gain(0.5).gain(0.8)'

  it('the setter writes the last call', () => {
    expect(after(doubled, setNumberCall(chunk(doubled), ['gain'], 'gain', 0.3))).toBe('$: s("bd").gain(0.5).gain(0.3)')
  })

  it('the fader reads and writes the last call', () => {
    const g = readGainState(chunk(doubled))
    expect(g.kind === 'scalar' && g.value).toBe(0.8)
    expect(after(doubled, gainEdit(chunk(doubled), 0.3))).toBe('$: s("bd").gain(0.5).gain(0.3)')
  })

  it('pan reads and writes the last call', () => {
    const doc = '$: s("bd").pan(0.1).pan(0.9)'
    expect(buildStripModels(detectAllChunks(doc), doc)[0].pan).toBe(0.9)
    expect(after(doc, panEdit(chunk(doc), 0.4))).toBe('$: s("bd").pan(0.1).pan(0.4)')
  })

  it('a later signal makes pan foreign even after a number', () => {
    const doc = '$: s("bd").pan(0.1).pan(sine)'
    const m = buildStripModels(detectAllChunks(doc), doc)[0]
    expect(m.pan).toBeNull()
    expect(m.panForeign).toBe(true)
    expect(panEdit(chunk(doc), 0.4)).toBeNull()
  })

  it('grid velocity reads and replaces the last call', () => {
    const doc = '$: s("bd bd").gain(0.5).gain("0.2 0.9")'
    expect(readChunkGain(chunk(doc)).mini).toBe('0.2 0.9')
    const edits = gridWriteEdits(chunk(doc), 'bd ~', { kind: 'write', value: '0.4 0.6', quoted: true })
    expect(after(doc, edits)).toBe('$: s("bd ~").gain(0.5).gain("0.4 0.6")')
  })

  it('the region trim still lands on the last call', () => {
    const doc = '$: s("take").begin(0.2).begin(0.6)'
    expect(after(doc, regionTrimEdit(chunk(doc), 'begin', 0.3).edit)).toBe('$: s("take").begin(0.2).begin(0.3)')
  })
})
