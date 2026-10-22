/**
 * useTrackColourBars — unit tests for the pure `trackBarSegments` projection
 * (#608). Drives REAL strips (`buildStripModels(detectAllChunks(code))`) through
 * a fake position-model so the offset→line-range, the config-statement filter,
 * the multi-line span, and the custom-colour override layering are all verified
 * without a live Monaco editor. (The pixel positioning — incl. word-wrap — is
 * covered by the e2e observation, which needs a real layout engine.)
 */
import { describe, it, expect } from 'vitest'
import { trackBarSegments, type PositionModel } from './useTrackColourBars'
import { detectAllChunks } from '../codeView/chunkDetect'
import { buildStripModels } from '../codeView/mixer/stripModel'
import { colorForTrack } from '../codeView/trackColor'
import type { TrackMeta } from '../workspace/WorkspaceFile'

/** A PositionModel that maps a 0-based char offset → Monaco 1-based position. */
function fakeModel(source: string): PositionModel {
  return {
    getPositionAt(offset: number) {
      const clamped = Math.max(0, Math.min(offset, source.length))
      let line = 1
      let lastNl = -1
      for (let i = 0; i < clamped; i++) {
        if (source[i] === '\n') {
          line++
          lastNl = i
        }
      }
      return { lineNumber: line, column: clamped - lastNl }
    },
  }
}

const EMPTY: ReadonlyMap<string, TrackMeta> = new Map()

function segsFor(source: string, trackMeta: ReadonlyMap<string, TrackMeta> = EMPTY) {
  const strips = buildStripModels(detectAllChunks(source), source)
  return trackBarSegments(strips, fakeModel(source), trackMeta)
}

describe('trackBarSegments', () => {
  it('one segment per single-line track, coloured by the display key', () => {
    const src = `bass: s("bd*4")\n$: s("hh*8")`
    // bass → label key; the anonymous $ is the 2nd track → display key d2.
    expect(segsFor(src)).toEqual([
      { startLine: 1, endLine: 1, color: colorForTrack('bass') },
      { startLine: 2, endLine: 2, color: colorForTrack('d2') },
    ])
  })

  it('spans the whole line range of a multi-line (chained) track', () => {
    const src = `bass: s("bd*4")\n  .gain(0.8)\n  .lpf(800)`
    expect(segsFor(src)).toEqual([
      { startLine: 1, endLine: 3, color: colorForTrack('bass') },
    ])
  })

  it('skips config/transport statements (setcps) — they are not tracks', () => {
    const src = `setcps(0.5)\nbass: s("bd*4")`
    expect(segsFor(src)).toEqual([
      { startLine: 2, endLine: 2, color: colorForTrack('bass') },
    ])
  })

  it('layers the per-file custom-colour override over the deterministic palette', () => {
    const src = `bass: s("bd*4")\nlead: note("c e g")`
    const override: ReadonlyMap<string, TrackMeta> = new Map([['bass', { color: '#ff0000' }]])
    expect(segsFor(src, override)).toEqual([
      { startLine: 1, endLine: 1, color: '#ff0000' }, // overridden
      { startLine: 2, endLine: 2, color: colorForTrack('lead') }, // default palette
    ])
  })

  it('returns no segments for an empty document', () => {
    expect(segsFor('')).toEqual([])
  })
})
