/**
 * #2571 — the upcoming notes a GLSL shader reads as `uNotes` / `staveNote(i)`.
 * Pure packing (no GL): a known window becomes the expected texels; over the
 * cap the nearest notes to now are kept, sorted by begin; a drum is midi −1;
 * an unchanged window version repacks nothing. The GL upload and the shader
 * reading it are checked in the browser (see the PR's test plan).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  GLSLNoteFeed,
  STAVE_MAX_NOTES,
  noteTrackIndex,
  selectNotes,
  writeNoteTexels,
  type NoteLike,
} from '../renderers/glslNotes'
import { buildGLSLFragmentSource } from '../renderers/glslShaderSource'

const ROW1 = STAVE_MAX_NOTES * 4

/** Texel `i` of row `row` as [r, g, b, a]. */
function texel(data: Float32Array, row: 0 | 1, i: number): number[] {
  const o = (row === 0 ? 0 : ROW1) + i * 4
  return Array.from(data.subarray(o, o + 4))
}

describe('writeNoteTexels — the texture layout', () => {
  it('row 0 = (begin, end, midi, gain), row 1 = (velocity, track, 0, 0)', () => {
    const out = new Float32Array(STAVE_MAX_NOTES * 2 * 4)
    const notes: NoteLike[] = [
      { begin: 10, end: 10.5, midi: 60, gain: 0.8, velocity: 0.5, trackKey: 'd1' },
      { begin: 10.5, end: 10.75, midi: null, gain: 1, velocity: 1, trackKey: '$0' },
    ]
    writeNoteTexels(notes, ['$0', 'd1'], out)
    expect(texel(out, 0, 0)).toEqual([10, 10.5, 60, Math.fround(0.8)])
    expect(texel(out, 1, 0)).toEqual([0.5, 1, 0, 0])
    expect(texel(out, 0, 1)).toEqual([10.5, 10.75, -1, 1])
    expect(texel(out, 1, 1)).toEqual([1, 0, 0, 0])
    // slots past the count are zero
    expect(texel(out, 0, 2)).toEqual([0, 0, 0, 0])
    expect(texel(out, 1, 2)).toEqual([0, 0, 0, 0])
  })

  it('a note with no pitch (a drum sample) gets midi −1', () => {
    const out = new Float32Array(STAVE_MAX_NOTES * 2 * 4)
    writeNoteTexels([{ begin: 0, end: 1 }, { begin: 1, end: 2, midi: undefined }, { begin: 2, end: 3, midi: NaN }], [], out)
    expect(out[2]).toBe(-1)
    expect(out[4 + 2]).toBe(-1)
    expect(out[8 + 2]).toBe(-1)
  })

  it('gain and velocity default to 1, as on the JS haps', () => {
    const out = new Float32Array(STAVE_MAX_NOTES * 2 * 4)
    writeNoteTexels([{ begin: 0, end: 1, midi: 40 }], [], out)
    expect(texel(out, 0, 0)[3]).toBe(1)
    expect(texel(out, 1, 0)[0]).toBe(1)
  })

  it('clears what a previous, longer pack left behind', () => {
    const out = new Float32Array(STAVE_MAX_NOTES * 2 * 4).fill(7)
    writeNoteTexels([{ begin: 1, end: 2, midi: 50 }], [], out)
    expect(texel(out, 0, 1)).toEqual([0, 0, 0, 0])
    expect(texel(out, 1, 1)).toEqual([0, 0, 0, 0])
  })
})

describe('noteTrackIndex — the index staveTrack(i) uses', () => {
  it('is the position of the note\'s track key in the bus track list', () => {
    expect(noteTrackIndex('$0', ['$0', 'drums', '$1'])).toBe(0)
    expect(noteTrackIndex('drums', ['$0', 'drums', '$1'])).toBe(1)
    expect(noteTrackIndex('$1', ['$0', 'drums', '$1'])).toBe(2)
  })
  it('is −1 for a key the bus does not know', () => {
    expect(noteTrackIndex('gone', ['$0'])).toBe(-1)
  })
  it('an untagged note is track 0 of a one-track (bare) document, else −1', () => {
    expect(noteTrackIndex(null, ['$0'])).toBe(0)
    expect(noteTrackIndex(undefined, ['$0', '$1'])).toBe(-1)
    expect(noteTrackIndex(null, [])).toBe(-1)
  })
})

describe('selectNotes — the cap', () => {
  it('under the cap keeps every note, sorted by begin', () => {
    const { notes, dropped } = selectNotes([{ begin: 3, end: 4 }, { begin: 1, end: 2 }, { begin: 2, end: 3 }], 0)
    expect(notes.map((n) => n.begin)).toEqual([1, 2, 3])
    expect(dropped).toBe(0)
  })

  it('over the cap keeps the STAVE_MAX_NOTES nearest to now, then sorts them by begin', () => {
    // 400 notes, 1/64 cycle apart, spanning now−3 … now+3.25; now = 100.
    const now = 100
    const events: NoteLike[] = []
    for (let i = 0; i < 400; i++) {
      const begin = now - 3 + i / 64
      events.push({ begin, end: begin + 1 / 64, midi: i })
    }
    // feed them shuffled so the result can't be an accident of input order
    const shuffled = [...events].sort((a, b) => ((a.midi! * 7919) % 400) - ((b.midi! * 7919) % 400))
    const { notes, dropped } = selectNotes(shuffled, now)
    expect(notes).toHaveLength(STAVE_MAX_NOTES)
    expect(dropped).toBe(400 - STAVE_MAX_NOTES)
    // sorted by begin
    for (let i = 1; i < notes.length; i++) expect(notes[i].begin).toBeGreaterThan(notes[i - 1].begin)
    // the kept set is exactly the nearest: every kept note is no farther from now
    // than every dropped one
    const dist = (n: NoteLike) => (n.begin > now ? n.begin - now : n.end < now ? now - n.end : 0)
    const kept = new Set(notes)
    const maxKept = Math.max(...notes.map(dist))
    const minDropped = Math.min(...events.filter((e) => !kept.has(e)).map(dist))
    expect(maxKept).toBeLessThanOrEqual(minDropped)
    // the note sounding at now is kept
    expect(notes.some((n) => n.begin <= now && n.end > now)).toBe(true)
  })

  it('a long note sounding at now counts as distance 0 even though its onset is far back', () => {
    const now = 50
    const events: NoteLike[] = [{ begin: now - 3.9, end: now + 1, midi: 1 }]
    for (let i = 0; i < 300; i++) events.push({ begin: now - 2 + i / 100, end: now - 2 + i / 100 + 0.01, midi: 100 })
    const { notes } = selectNotes(events, now)
    expect(notes.some((n) => n.midi === 1)).toBe(true)
    expect(notes[0].midi).toBe(1) // and it sorts first by begin
  })
})

describe('GLSLNoteFeed — repack only when the window changed', () => {
  const ev: NoteLike[] = [{ begin: 1, end: 2, midi: 60, trackKey: '$0' }]

  it('repacks on a new window version, not on an equal one', () => {
    const f = new GLSLNoteFeed()
    expect(f.update(ev, 1, 1.5, 0.5, ['$0'])).toBe(true)
    const v = f.version
    expect(f.count).toBe(1)
    // same window version, later now: no repack, no version bump — but now/cps move
    expect(f.update(ev, 1, 1.6, 0.5, ['$0'])).toBe(false)
    expect(f.version).toBe(v)
    expect(f.now).toBe(1.6)
    // new window version → repack
    expect(f.update([], 2, 1.7, 0.5, ['$0'])).toBe(true)
    expect(f.version).toBe(v + 1)
    expect(f.count).toBe(0)
  })

  it('repacks when the track list changes under the same window (indices moved)', () => {
    const f = new GLSLNoteFeed()
    f.update(ev, 1, 0, 0.5, ['$0'])
    expect(f.data[ROW1 + 1]).toBe(0)
    expect(f.update(ev, 1, 0, 0.5, ['$x', '$0'])).toBe(true)
    expect(f.data[ROW1 + 1]).toBe(1)
  })

  it('an unknown window version always repacks', () => {
    const f = new GLSLNoteFeed()
    expect(f.update(ev, undefined, 0, 0.5, [])).toBe(true)
    expect(f.update(ev, undefined, 0, 0.5, [])).toBe(true)
  })

  it('warns once per feed when notes are dropped', () => {
    const many: NoteLike[] = Array.from({ length: STAVE_MAX_NOTES + 10 }, (_, i) => ({ begin: i, end: i + 1 }))
    const onDrop = vi.fn()
    const f = new GLSLNoteFeed()
    f.update(many, 1, 0, 0.5, [], onDrop)
    f.update(many, 2, 0, 0.5, [], onDrop)
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledWith(10, STAVE_MAX_NOTES + 10)
    expect(f.count).toBe(STAVE_MAX_NOTES)
    expect(f.dropped).toBe(10)
  })
})

describe('the shader preamble declares the notes API (#2571)', () => {
  const SHADERTOY = 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }'
  const RAW = 'out vec4 o;\nvoid main() { o = vec4(1.0); }'

  it.each([['ShaderToy', SHADERTOY], ['raw', RAW]])('%s mode', (_m, src) => {
    const out = buildGLSLFragmentSource(src)
    expect(out).toContain('uniform highp sampler2D uNotes;')
    expect(out).toContain('uniform int uNoteCount;')
    expect(out).toContain('uniform float uNow;')
    expect(out).toContain('uniform float uCps;')
    expect(out).toContain(`#define STAVE_MAX_NOTES ${STAVE_MAX_NOTES}`)
    expect(out).toMatch(/struct StaveNote \{\s*float begin;\s*float end;\s*float midi;\s*float gain;\s*float velocity;\s*int track;\s*\};/)
    expect(out).toContain('StaveNote staveNote(int i)')
    expect(out).toContain('texelFetch(uNotes, ivec2(i, 0), 0)')
    expect(out).toContain('texelFetch(uNotes, ivec2(i, 1), 0)')
    // declared before the user's code, so a user redeclaration collides
    expect(out.indexOf('StaveNote staveNote(int i)')).toBeLessThan(out.indexOf(src.slice(0, 10)))
  })
})
