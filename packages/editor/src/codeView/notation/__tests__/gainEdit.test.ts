/**
 * What one grid write changes in the document (#409 velocity; #1887).
 *
 * `gridWriteEdits` is asked with a real chunk, read off real source by the chunk
 * detector, and its edits are APPLIED — so each case states the document before and
 * the document after, which is the only thing a user would see go wrong.
 */
import { describe, it, expect } from 'vitest'
import { detectAllChunks, type ChunkInfo } from '../../chunkDetect'
import type { OffsetEdit } from '../../writeback'
import type { GainWrite } from '../model'
import { gridWriteEdits, readChunkGain, gainUnchanged } from '../gainEdit'

const chunkOf = (doc: string): ChunkInfo => {
  const chunks = detectAllChunks(doc)
  if (chunks.length !== 1) throw new Error(`expected one chunk in ${doc}, got ${chunks.length}`)
  return chunks[0]
}
const apply = (doc: string, edits: OffsetEdit[]): string =>
  [...edits].sort((a, b) => b.range[0] - a.range[0]).reduce((d, e) => d.slice(0, e.range[0]) + e.text + d.slice(e.range[1]), doc)
/** The document after a grid writes `mini` with gain intent `g`. */
const written = (doc: string, mini: string, g: GainWrite | null): string => {
  const edits = gridWriteEdits(chunkOf(doc), mini, g)
  if (!edits) throw new Error(`no edits for ${doc}`)
  return apply(doc, edits)
}
const PER_COLUMN: GainWrite = { kind: 'write', value: '1 ~ 0.5 ~', quoted: true }
const UNIFORM: GainWrite = { kind: 'write', value: '0.8', quoted: false }

describe('gridWriteEdits — the mini and its .gain, as one edit list', () => {
  it('a panel with no velocity writes the mini and nothing else', () => {
    expect(written('s("bd ~ sd ~").gain(0.5)', 'bd bd sd ~', null)).toBe('s("bd bd sd ~").gain(0.5)')
    expect(gridWriteEdits(chunkOf('s("bd ~ sd ~")'), 'bd bd sd ~', null)).toHaveLength(1)
  })

  it('appends .gain after the whole expression when the chunk has none', () => {
    expect(written('s("bd ~ sd ~")', 'bd ~ sd ~', PER_COLUMN)).toBe('s("bd ~ sd ~").gain("1 ~ 0.5 ~")')
    expect(written('s("bd ~ sd ~").pan(0.3)', 'bd ~ sd ~', UNIFORM)).toBe('s("bd ~ sd ~").pan(0.3).gain(0.8)')
  })

  it('replaces the argument in place, swapping number and string as needed', () => {
    expect(written('s("bd ~ sd ~").gain(0.5).pan(0.3)', 'bd ~ sd ~', PER_COLUMN)).toBe('s("bd ~ sd ~").gain("1 ~ 0.5 ~").pan(0.3)')
    expect(written('s("bd ~ sd ~").gain("1 ~ 0.5 ~")', 'bd ~ sd ~', UNIFORM)).toBe('s("bd ~ sd ~").gain(0.8)')
  })

  it('clear removes the whole call it manages, and nothing when there is none', () => {
    expect(written('s("bd ~ sd ~").gain("1 ~ 0.5 ~").pan(0.3)', 'bd ~ sd ~', { kind: 'clear' })).toBe('s("bd ~ sd ~").pan(0.3)')
    expect(written('s("bd ~ sd ~").gain(0.5)', 'bd ~ sd ~', { kind: 'clear' })).toBe('s("bd ~ sd ~")')
    expect(gridWriteEdits(chunkOf('s("bd ~ sd ~")'), 'bd ~ sd ~', { kind: 'clear' })).toHaveLength(1)
  })

  it('clear leaves a .gain it does not manage byte-identical', () => {
    expect(written('s("bd ~ sd ~").gain(sine.range(0.2, 1))', 'bd bd sd ~', { kind: 'clear' }))
      .toBe('s("bd bd sd ~").gain(sine.range(0.2, 1))')
  })

  it('skip writes the mini and leaves any .gain alone', () => {
    expect(written('s("bd ~ sd ~").gain("1 ~ 0.5 ~")', 'bd bd sd ~', { kind: 'skip' })).toBe('s("bd bd sd ~").gain("1 ~ 0.5 ~")')
  })

  it('a chunk with no mini range gets no edit list at all — not an empty one', () => {
    const c = { ...chunkOf('s("bd ~ sd ~")'), miniRange: null }
    expect(gridWriteEdits(c, 'bd', PER_COLUMN)).toBeNull()
    expect(gridWriteEdits(c, 'bd', null)).toBeNull()
  })
})

describe('readChunkGain — what the chunk\'s .gain reads as', () => {
  it('absent, a number, a string, and anything else', () => {
    expect(readChunkGain(chunkOf('s("bd sd")'))).toEqual({ mini: null, numeric: null, foreign: false })
    expect(readChunkGain(chunkOf('s("bd sd").gain(0.4)'))).toEqual({ mini: null, numeric: 0.4, foreign: false })
    expect(readChunkGain(chunkOf('s("bd sd").gain("1 0.5")'))).toEqual({ mini: '1 0.5', numeric: null, foreign: false })
    expect(readChunkGain(chunkOf('s("bd sd").gain(sine)'))).toEqual({ mini: null, numeric: null, foreign: true })
  })
})

describe('gainUnchanged — does the document already say what the model would write', () => {
  const none = readChunkGain(chunkOf('s("bd sd")'))
  const scalar = readChunkGain(chunkOf('s("bd sd").gain(0.8)'))
  const str = readChunkGain(chunkOf('s("bd sd").gain("1 ~ 0.5 ~")'))

  it('skip never forces a reseed', () => {
    for (const cur of [none, scalar, str]) expect(gainUnchanged({ kind: 'skip' }, cur)).toBe(true)
  })

  it('clear matches only a chunk with no managed gain', () => {
    expect(gainUnchanged({ kind: 'clear' }, none)).toBe(true)
    expect(gainUnchanged({ kind: 'clear' }, scalar)).toBe(false)
    expect(gainUnchanged({ kind: 'clear' }, str)).toBe(false)
  })

  it('a write matches the same string, or the same number however it is spelled', () => {
    expect(gainUnchanged(PER_COLUMN, str)).toBe(true)
    expect(gainUnchanged({ kind: 'write', value: '1 ~ 0.6 ~', quoted: true }, str)).toBe(false)
    expect(gainUnchanged(UNIFORM, scalar)).toBe(true)
    expect(gainUnchanged({ kind: 'write', value: '0.80', quoted: false }, scalar)).toBe(true)
    expect(gainUnchanged(UNIFORM, str)).toBe(false)
    expect(gainUnchanged(PER_COLUMN, scalar)).toBe(false)
    expect(gainUnchanged(UNIFORM, none)).toBe(false)
  })
})
