/**
 * trackLabel — the Song-timeline DISPLAY-name resolver (#579 STEP 2).
 *
 * Offsets below mirror the LIVE dump (#579): for `bass:/$:/d3:/$:/lead:/$:`
 * the lanes' `dollarPos` point exactly at each statement head, so reading the
 * source there yields the label (`bass`, `lead`, `d3`) or anonymous (`$`).
 */
import { describe, it, expect } from 'vitest'
import { resolveLaneName, resolveLaneShownName } from '../trackLabel'
// The reader is the editor's since #1921; this file pins the timeline's use of it.
import { labelAtOffset } from '@stave/editor'

// The exact mixed doc the live probe used; offsets are the observed dollarPos.
const SONG =
  'bass: note("c2 e2").s("sawtooth")\n$: s("bd*4")\nd3: s("hh*8")\n$: s("cp*2")\nlead: note("c4").s("piano")\n$: s("oh*2")'

describe('labelAtOffset', () => {
  it('reads a named track label at its statement offset', () => {
    expect(labelAtOffset(SONG, 0)).toBe('bass') // `bass: note(...)`
    expect(labelAtOffset(SONG, 47)).toBe('d3') // `d3: s("hh*8")`
    expect(labelAtOffset(SONG, 74)).toBe('lead') // `lead: note(...)`
  })

  it('returns null for an anonymous `$:` track (keep d{N})', () => {
    expect(labelAtOffset(SONG, 34)).toBeNull() // `$: s("bd*4")`
    expect(labelAtOffset(SONG, 61)).toBeNull() // `$: s("cp*2")`
    expect(labelAtOffset(SONG, 102)).toBeNull() // `$: s("oh*2")`
  })

  it('strips the `_` mute marker — a muted named track still reads its bare label', () => {
    expect(labelAtOffset('_bass: s("bd")', 0)).toBe('bass')
    expect(labelAtOffset('_lead: note("c")', 0)).toBe('lead')
  })

  it('strips a TRAILING `_` mute marker too (#1679)', () => {
    expect(labelAtOffset('bass_: s("bd")', 0)).toBe('bass')
    expect(labelAtOffset('$_: s("bd")', 0)).toBeNull() // muted anonymous
  })

  it('a muted anonymous `_$:` is still anonymous (null)', () => {
    expect(labelAtOffset('_$: s("bd")', 0)).toBeNull()
  })

  it('tolerates leading indentation at the offset', () => {
    expect(labelAtOffset('   bass: s("bd")', 0)).toBe('bass')
  })

  it('returns null for a non-label head or out-of-range offset', () => {
    expect(labelAtOffset('s("bd*4")', 0)).toBeNull() // bare expression, no label
    expect(labelAtOffset(SONG, -1)).toBeNull()
    expect(labelAtOffset(SONG, 9999)).toBeNull()
  })

  it('a track whose label is literally `d3` reads `d3` (no special-casing)', () => {
    expect(labelAtOffset('d3: s("hh")', 0)).toBe('d3')
  })
})

describe('resolveLaneName', () => {
  it('named lane → label; anon lane → laneKey (d{N})', () => {
    expect(resolveLaneName('d1', 0, SONG)).toBe('bass') // d1 is the bass: track
    expect(resolveLaneName('d2', 34, SONG)).toBe('d2') // anon → keep d2
    expect(resolveLaneName('d5', 74, SONG)).toBe('lead')
  })

  it('keeps laneKey when there is no source or no label offset (producer lane)', () => {
    expect(resolveLaneName('d1', null, SONG)).toBe('d1')
    expect(resolveLaneName('d1', 0, null)).toBe('d1')
    expect(resolveLaneName('chord-0', undefined, SONG)).toBe('chord-0')
  })
})

describe('a non-Latin label is read like any other (#1683)', () => {
  it('reads 節奏 at its statement head, and drums as the control', () => {
    const doc = '節奏: s("bd*4")\ndrums: s("hh")'
    expect(labelAtOffset(doc, 0)).toBe('節奏')
    expect(labelAtOffset(doc, doc.indexOf('drums'))).toBe('drums')
  })
})

describe('resolveLaneShownName — what a lane header shows (#2151)', () => {
  it('anonymous lanes show `Track N`; named lanes and a written `d3:` show their label', () => {
    expect(resolveLaneShownName('d2', 34, SONG)).toBe('Track 2') // `$: s("bd*4")`
    expect(resolveLaneShownName('d1', 0, SONG)).toBe('bass')
    expect(resolveLaneShownName('d3', 47, SONG)).toBe('d3') // the user wrote `d3:`
  })

  it('keeps the name it would have shown before for every named lane', () => {
    for (const [key, at] of [['d1', 0], ['d3', 47], ['d5', 74]] as const) {
      expect(resolveLaneShownName(key, at, SONG)).toBe(resolveLaneName(key, at, SONG))
    }
  })

  it('a lane with no source provenance still shows `Track N` for a positional key', () => {
    expect(resolveLaneShownName('d4', null, SONG)).toBe('Track 4')
    expect(resolveLaneShownName('d4', 61, null)).toBe('Track 4')
    expect(resolveLaneShownName('chords', null, SONG)).toBe('chords')
  })
})
