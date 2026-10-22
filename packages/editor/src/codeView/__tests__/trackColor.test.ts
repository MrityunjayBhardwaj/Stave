/**
 * trackColor — the one track palette, read by the Mixer and the Song timeline.
 *
 * These arms used to run against the app's mirrored copy (`musicalTimeline/colors.ts`)
 * and reached this file only through a drift test. #1943 retired the copy, so they
 * run here, against the original.
 */
import { describe, it, expect } from 'vitest'
import { TRACK_PALETTE_32, paletteForTrack, trackIndexOf, colorForTrack, trackIdentity } from '../trackColor'

describe('20-11 — 32-palette + paletteForTrack + trackIndexOf', () => {
  it('TRACK_PALETTE_32 has 32 entries', () => {
    expect(TRACK_PALETTE_32.length).toBe(32)
  })

  it('paletteForTrack(0, undefined) returns a valid hex string', () => {
    expect(/^#[0-9a-f]{6}$/i.test(paletteForTrack(0))).toBe(true)
  })

  it('paletteForTrack with drum sample returns drum-family color', () => {
    // trackIndex=0, sample='bd' → hueGroup=0 (drums) → slot=(0*4+0)%32=0 → drums lightest.
    expect(paletteForTrack(0, 'bd')).toBe(TRACK_PALETTE_32[0])
  })

  it('paletteForTrack with bass sample biases toward bass family', () => {
    // trackIndex=0, sample='bass1' → hueGroup=1 (bass) → slot=(0*4+1)%32=1.
    expect(paletteForTrack(0, 'bass1')).toBe(TRACK_PALETTE_32[1])
  })

  it('paletteForTrack(33, undefined) wraps mod 32', () => {
    expect(paletteForTrack(33, undefined)).toBe(paletteForTrack(1, undefined))
  })

  it('trackIndexOf("d1") === 0; trackIndexOf("d12") === 11', () => {
    expect(trackIndexOf('d1')).toBe(0)
    expect(trackIndexOf('d12')).toBe(11)
  })

  it('trackIndexOf("custom") returns a stable hash 0..31', () => {
    const a = trackIndexOf('custom')
    const b = trackIndexOf('custom')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(32)
  })

  it('trackIndexOf("d33") === 0 (mod 32 wrap)', () => {
    expect(trackIndexOf('d33')).toBe(0)
  })
})

describe('colorForTrack and trackIdentity compose the palette', () => {
  it('colorForTrack(key) is paletteForTrack(trackIndexOf(key), key)', () => {
    for (const k of ['d1', 'd33', 'bd', 'bass', 'pad', 'lead', '#0', '$0', 'drums', '$default', '']) {
      expect(colorForTrack(k)).toBe(paletteForTrack(trackIndexOf(k), k))
    }
  })

  it('trackIdentity takes a custom colour over the palette, and falls back without one', () => {
    expect(trackIdentity('d1')).toEqual({ key: 'd1', name: 'd1', color: colorForTrack('d1') })
    expect(trackIdentity('d1', '#abcdef').color).toBe('#abcdef')
    expect(trackIdentity('d1', undefined).color).toBe(colorForTrack('d1'))
  })
})
