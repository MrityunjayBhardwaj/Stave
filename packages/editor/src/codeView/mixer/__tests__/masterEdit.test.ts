/**
 * masterEdit — the master strip's pure write path (all(x => …)), issue #792.
 *
 * These lock the pure `doc → OffsetEdit` boundary for the master fader and the
 * global backdrop, the same way `writeStrip.test.ts` locks the channel controls:
 * detect → edit → apply → assert the exact resulting source. No Monaco. The live
 * round-trip (drag → code, code → backdrop render) is the Playwright layer.
 */
import { describe, it, expect } from 'vitest'

import { applyEdits, type OffsetEdit } from '../../writeback'
import {
  detectMasterAll,
  detectMasterAudioAll,
  adaptMasterChunk,
  readMasterGain,
  readMasterMute,
  readMasterViz,
  masterGainEdit,
  masterMuteEdit,
  masterVizEdit,
  masterAudioLineEdit,
} from '../masterEdit'

/** apply a master edit to the source it was computed from */
function applied(src: string, edit: OffsetEdit | null): string {
  expect(edit).not.toBeNull()
  return applyEdits(src, [edit as OffsetEdit])
}

describe('detectMasterAll', () => {
  it('finds a top-level all(x => …) arrow statement and its chain', () => {
    const alls = detectMasterAll('$: s("bd")\nall(x => x.gain(0.85))')
    expect(alls).toHaveLength(1)
    expect(alls[0].chain.map((c) => c.name)).toEqual(['gain'])
    expect(alls[0].chain[0].args[0].numeric).toBe(0.85)
  })

  it('reads a combined gain().viz() chain in source order', () => {
    const alls = detectMasterAll('all(x => x.gain(0.8).viz("Prism", { backdrop: true }))')
    expect(alls[0].chain.map((c) => c.name)).toEqual(['gain', 'viz'])
  })

  it('ignores non-arrow all(fast(…)) and block-body arrows', () => {
    expect(detectMasterAll('all(fast("<2 3>"))')).toEqual([])
    expect(detectMasterAll('all(x => { return x.gain(1) })')).toEqual([])
  })

  it('returns [] for a doc that does not parse', () => {
    expect(detectMasterAll('all(x => x.gain(')).toEqual([])
  })
})

describe('readMasterGain', () => {
  it('reads the factor from an all() mul(postgain()) line', () => {
    expect(readMasterGain('all(x => x.mul(postgain(0.6)))')).toEqual({ value: 0.6, foreign: false })
  })

  it('still reads a legacy all() gain or postgain line, so the fader shows what the document says', () => {
    expect(readMasterGain('all(x => x.gain(0.6))')).toEqual({ value: 0.6, foreign: false })
    expect(readMasterGain('all(x => x.postgain(0.4))')).toEqual({ value: 0.4, foreign: false })
  })

  it('prefers the scaling form when a legacy line is also written', () => {
    expect(readMasterGain('all(x => x.gain(0.3))\nall(x => x.mul(postgain(0.7)))')).toEqual({ value: 0.7, foreign: false })
  })

  it('is unity when absent (the untouched master projects the default)', () => {
    expect(readMasterGain('$: s("bd")')).toEqual({ value: 1, foreign: false })
  })

  it('flags a signal gain as foreign (fader disables, shows unity)', () => {
    expect(readMasterGain('all(x => x.gain(sine))')).toEqual({ value: 1, foreign: true })
    expect(readMasterGain('all(x => x.mul(postgain(sine)))')).toEqual({ value: 1, foreign: true })
  })
})

describe('masterGainEdit (#1711 — the master SCALES the mix: mul(postgain()), never a set)', () => {
  // A Strudel control method SETS its value, so `all(x => x.gain(N))` replaced
  // every track's own gain with N — and `all(x => x.postgain(N))` would do the
  // same to the 1 in 11 real songs whose tracks set their own postgain.
  // `mul(postgain(N))` multiplies a postgain a track already has and supplies N
  // where it has none (Strudel's key-wise arithmetic on controls), so every
  // track is scaled by the same factor.
  it('patches the factor in an existing all() mul(postgain()) line', () => {
    const src = 'all(x => x.mul(postgain(0.6)))'
    expect(applied(src, masterGainEdit(src, 0.85))).toBe('all(x => x.mul(postgain(0.85)))')
  })

  it('inserts a fresh all() mul(postgain()) line when absent (appended as a new line)', () => {
    const src = '$: s("bd*4")'
    expect(applied(src, masterGainEdit(src, 0.85))).toBe('$: s("bd*4")\nall(x => x.mul(postgain(0.85)))')
  })

  it('materializes into an empty document with no leading newline', () => {
    expect(applied('', masterGainEdit('', 0.7))).toBe('all(x => x.mul(postgain(0.7)))')
  })

  it('writes the literal factor 1 at unity (decision 4 — matches channel gainEdit)', () => {
    const src = '$: s("bd")'
    expect(applied(src, masterGainEdit(src, 1))).toBe('$: s("bd")\nall(x => x.mul(postgain(1)))')
  })

  it('moving the fader on a legacy gain or postgain line turns THAT call into the scaling form', () => {
    // The line is the one being edited, so it is the one rewritten; the track
    // lines — including one that sets its own postgain — are not touched.
    const src = '$: s("bd").gain(0.3).postgain(0.5)\nall(x => x.gain(0.6))'
    expect(applied(src, masterGainEdit(src, 0.5))).toBe('$: s("bd").gain(0.3).postgain(0.5)\nall(x => x.mul(postgain(0.5)))')
    const set = 'all(x => x.postgain(0.6))'
    expect(applied(set, masterGainEdit(set, 0.5))).toBe('all(x => x.mul(postgain(0.5)))')
  })

  it('binds to a hand-combined chain, patching only the master call', () => {
    const src = 'all(x => x.mul(postgain(0.8)).viz("Prism", { backdrop: true }))'
    expect(applied(src, masterGainEdit(src, 0.5))).toBe(
      'all(x => x.mul(postgain(0.5)).viz("Prism", { backdrop: true }))',
    )
    const legacy = 'all(x => x.gain(0.8).room(0.3))'
    expect(applied(legacy, masterGainEdit(legacy, 0.5))).toBe('all(x => x.mul(postgain(0.5)).room(0.3))')
  })

  it('leaves an unrelated mul() alone', () => {
    // `mul` of something other than a single postgain is the user's arithmetic,
    // not the master fader's line: a fresh master line is added beside it.
    const src = 'all(x => x.mul(speed(2)))'
    expect(readMasterGain(src)).toEqual({ value: 1, foreign: false })
    expect(applied(src, masterGainEdit(src, 0.5))).toBe('all(x => x.mul(speed(2)))\nall(x => x.mul(postgain(0.5)))')
  })

  it('disables (null) on a foreign signal gain', () => {
    expect(masterGainEdit('all(x => x.gain(sine))', 0.5)).toBeNull()
    expect(masterGainEdit('all(x => x.mul(postgain(sine)))', 0.5)).toBeNull()
  })

  it('round-trips: edit then re-read yields the written value', () => {
    const src = '$: s("bd")'
    const next = applied(src, masterGainEdit(src, 0.42))
    expect(readMasterGain(next)).toEqual({ value: 0.42, foreign: false })
  })
})

describe('readMasterMute', () => {
  it('is true when an all(x => silence) line is present', () => {
    expect(readMasterMute('$: s("bd")\nall(x => silence)')).toBe(true)
  })

  it('is false when absent', () => {
    expect(readMasterMute('$: s("bd")\nall(x => x.gain(0.8))')).toBe(false)
  })

  it('ignores a gain/pan line (only the silence sentinel counts)', () => {
    expect(readMasterMute('all(x => x.gain(0.8).pan(0.3))')).toBe(false)
  })
})

describe('masterMuteEdit', () => {
  it('inserts the silence line on mute', () => {
    const src = '$: s("bd")'
    expect(applied(src, masterMuteEdit(src, true))).toBe('$: s("bd")\nall(x => silence)')
  })

  it('removes the silence line on unmute (exact inverse)', () => {
    const src = '$: s("bd")\nall(x => silence)'
    expect(applied(src, masterMuteEdit(src, false))).toBe('$: s("bd")')
  })

  it('is a no-op (null) when already in the requested state', () => {
    expect(masterMuteEdit('$: s("bd")\nall(x => silence)', true)).toBeNull()
    expect(masterMuteEdit('$: s("bd")', false)).toBeNull()
  })

  it('is ORTHOGONAL to gain — mute leaves the fader line untouched, unmute restores it', () => {
    const src = 'all(x => x.gain(0.42))'
    const muted = applied(src, masterMuteEdit(src, true))
    expect(muted).toBe('all(x => x.gain(0.42))\nall(x => silence)')
    // the gain the fader reads is unchanged while muted (V-mixer-2)
    expect(readMasterGain(muted)).toEqual({ value: 0.42, foreign: false })
    // unmute is the exact inverse
    expect(applied(muted, masterMuteEdit(muted, false))).toBe(src)
  })
})

describe('detectMasterAudioAll', () => {
  it('picks the gain/insert line as the audio line', () => {
    const m = detectMasterAudioAll('$: s("bd")\nall(x => x.gain(0.8).room(0.3))')
    expect(m).toBeDefined()
    expect(m!.chain.map((c) => c.name)).toEqual(['gain', 'room'])
  })

  it('skips the mute sentinel line (x => silence)', () => {
    expect(detectMasterAudioAll('all(x => silence)')).toBeUndefined()
    // when a real audio line coexists with the mute line, the audio line wins
    const m = detectMasterAudioAll('all(x => x.gain(0.8))\nall(x => silence)')
    expect(m!.chain.map((c) => c.name)).toEqual(['gain'])
  })

  it('skips a pure backdrop-viz line (presentation, not audio)', () => {
    expect(detectMasterAudioAll('all(x => x.viz("Prism", { backdrop: true }))')).toBeUndefined()
  })

  it('treats an identity all(x => x) as an audio base (the scaffold)', () => {
    const m = detectMasterAudioAll('all(x => x)')
    expect(m).toBeDefined()
    expect(m!.chain).toEqual([])
  })
})

describe('masterAudioLineEdit (#1889 — the base line the first master insert appends onto)', () => {
  const apply = (doc: string): string => {
    const edit = masterAudioLineEdit(doc)
    return edit ? applyEdits(doc, [edit]) : doc
  }

  it('adds `all(x => x)` as the last line, on its own line', () => {
    expect(apply('$: s("bd*4")')).toBe('$: s("bd*4")\nall(x => x)')
  })

  it('adds no second newline when the document already ends in one', () => {
    expect(apply('$: s("bd*4")\n')).toBe('$: s("bd*4")\nall(x => x)')
  })

  it('writes just the line into an empty document', () => {
    expect(apply('')).toBe('all(x => x)')
  })

  it('the line it adds is the one the drawer then binds to', () => {
    const doc = apply('$: s("bd*4")')
    const line = detectMasterAudioAll(doc)
    expect(line && doc.slice(line.statementRange[0], line.statementRange[1])).toBe('all(x => x)')
  })

  it('writes nothing when the document already has a master audio line', () => {
    expect(masterAudioLineEdit('$: s("bd*4")\nall(x => x.room(0.4))')).toBeNull()
    expect(masterAudioLineEdit('all(x => x.mul(postgain(0.8)))')).toBeNull()
  })

  it('a mute line or a backdrop line is not an audio line — the base is still added', () => {
    expect(apply('all(x => silence)')).toBe('all(x => silence)\nall(x => x)')
    const viz = 'all(x => x.viz("scope", { backdrop: true }))'
    expect(apply(viz)).toBe(`${viz}\nall(x => x)`)
  })
})

describe('adaptMasterChunk', () => {
  it('prepends a synthetic head so effects start at index 1 (channel-parity)', () => {
    const doc = 'all(x => x.gain(0.8).room(0.3))'
    const m = detectMasterAudioAll(doc)!
    const chunk = adaptMasterChunk(doc, m)
    // chain[0] is the inert head; the inserts follow
    expect(chunk.chain.map((c) => c.name)).toEqual(['x', 'gain', 'room'])
    expect(chunk.chain[0].args).toEqual([])
    // exprRange is the arrow body, so a new .fx() appends at the chain end
    expect(doc.slice(chunk.exprRange[0], chunk.exprRange[1])).toBe('x.gain(0.8).room(0.3)')
    expect(chunk.miniString).toBeNull()
  })

  it('adapts an identity scaffold to a head-only chunk (empty inserts)', () => {
    const doc = 'all(x => x)'
    const chunk = adaptMasterChunk(doc, detectMasterAudioAll(doc)!)
    expect(chunk.chain.map((c) => c.name)).toEqual(['x'])
    expect(doc.slice(chunk.exprRange[0], chunk.exprRange[1])).toBe('x')
  })
})

describe('readMasterViz', () => {
  it('reads the backdrop viz name', () => {
    expect(readMasterViz('all(x => x.viz("Prism", { backdrop: true }))')).toEqual({ name: 'Prism' })
  })

  it('is null when no master backdrop is declared', () => {
    expect(readMasterViz('all(x => x.gain(0.8))')).toBeNull()
  })

  it('ignores a channel-scoped inline viz (no backdrop flag)', () => {
    expect(readMasterViz('$: s("bd").viz("pianoroll")')).toBeNull()
  })
})

describe('masterVizEdit', () => {
  it('inserts a fresh backdrop line when absent (split from any gain line)', () => {
    const src = 'all(x => x.gain(0.85))'
    expect(applied(src, masterVizEdit(src, 'Prism'))).toBe(
      'all(x => x.gain(0.85))\nall(x => x.viz("Prism", { backdrop: true }))',
    )
  })

  it('patches the name of an existing backdrop viz', () => {
    const src = 'all(x => x.viz("Prism", { backdrop: true }))'
    expect(applied(src, masterVizEdit(src, 'fscope'))).toBe(
      'all(x => x.viz("fscope", { backdrop: true }))',
    )
  })

  it('clears by removing the whole all() line when the viz is all it carries', () => {
    const src = '$: s("bd")\nall(x => x.viz("Prism", { backdrop: true }))'
    expect(applied(src, masterVizEdit(src, null))).toBe('$: s("bd")')
  })

  it('clears surgically from a combined chain (keeps the gain)', () => {
    const src = 'all(x => x.gain(0.8).viz("Prism", { backdrop: true }))'
    expect(applied(src, masterVizEdit(src, null))).toBe('all(x => x.gain(0.8))')
  })

  it('is a no-op (null) when clearing with no master backdrop present', () => {
    expect(masterVizEdit('all(x => x.gain(0.8))', null)).toBeNull()
  })

  it('round-trips: set then re-read yields the written name', () => {
    const src = '$: s("bd")'
    const next = applied(src, masterVizEdit(src, 'spectrum'))
    expect(readMasterViz(next)).toEqual({ name: 'spectrum' })
  })
})
