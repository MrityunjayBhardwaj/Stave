/**
 * #1730 — a lane whose every sound is a file draws as an audio track when
 * collapsed. Two pure pieces: `markAudioLanes` decides WHICH lanes, and
 * `laneMarkBands` gives such a lane's collapsed band its whole height. The pixels
 * are read back off the real canvas in `take-waveform.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import { laneMarkBands, markRect } from '../drawTimeline'
import { computeLaneLayout } from '../laneLayout'
import type { SampleRef } from '@stave/editor'
import { longRecordingLanes, markAudioLanes, markBarsLanes, NO_VOICE, type TimelineScene, type SceneNote } from '../timelineScene'

/** A named mark plays the file of that name unless it says otherwise — what
 *  `timelineMarks` builds for a plain `s` with no bank or number (#1764). */
const withSample = (n: SceneNote): SceneNote =>
  n.sample !== undefined || n.voice == null || n.voice === NO_VOICE ? n : { ...n, sample: { s: n.voice } }

function sceneOf(raw: SceneNote[], pitchMin: number | null = null, pitchMax: number | null = null): TimelineScene {
  const notes = raw.map(withSample)
  return {
    lanes: [
      {
        laneKey: 'a',
        displayName: 'a',
        color: '#f00',
        density: [1, 1],
        notes,
        pitchMin,
        pitchMax,
        voices: [],
        clips: [{ armIndex: -1, startCycle: 0, endCycle: 2, label: null, nameRange: null, sectionName: '' }],
        sourceOffset: null,
        arrangeOffset: null,
        labelOffset: null,
        automations: [],
        stepped: [],
      },
    ],
    sections: [],
    displayCycles: 2,
    windowOriginCycles: 0,
    period: null,
    peakDensity: 1,
    notesCapped: false,
  }
}

/** The registry, as a set of names that are files. */
/** A fake registry of file names, joined the way the resolver joins a bank (no aliases here). */
const files = (...names: string[]) => (sample: SampleRef) =>
  names.includes(sample.bank ? `${sample.bank}_${sample.s}` : sample.s)

describe('markAudioLanes — which lanes are audio tracks (#1730)', () => {
  it('a lane whose every mark plays a file is an audio lane', () => {
    const scene = sceneOf([
      { cycle: 0, end: 1, pitch: null, gain: 1, voice: 'take_1' },
      { cycle: 1, end: 2, pitch: 62, gain: 1, voice: 'casio' },
    ])
    expect(markAudioLanes(scene, files('take_1', 'casio')).lanes[0].audio).toBe(true)
  })

  it('one synth note on the lane keeps the ordinary row', () => {
    const scene = sceneOf([
      { cycle: 0, end: 1, pitch: null, gain: 1, voice: 'take_1' },
      { cycle: 1, end: 2, pitch: 48, gain: 1, voice: 'sawtooth' },
    ])
    expect(markAudioLanes(scene, files('take_1')).lanes[0].audio ?? false).toBe(false)
  })

  it('a note with no sound name is not a file', () => {
    const scene = sceneOf([{ cycle: 0, end: 1, pitch: 60, gain: 1, voice: NO_VOICE }])
    expect(markAudioLanes(scene, () => true).lanes[0].audio ?? false).toBe(false)
  })

  it('asks about the file the mark PLAYS, not the name on its row (#1764)', () => {
    // `s("bd").bank("RolandTR909")`: the row says bd, the mark's sample carries the
    // bank, and the resolver asks for RolandTR909_bd (#1767). The fake registry
    // below stands in for that resolver, so it keys on the bank the mark carries.
    const banked = sceneOf([{ cycle: 0, end: 1, pitch: null, gain: 1, voice: 'bd', sample: { s: 'bd', bank: 'RolandTR909' } }])
    expect(markAudioLanes(banked, files('RolandTR909_bd')).lanes[0].audio).toBe(true)
    // CONTROL — a registry that knows only the plain name does not make it one.
    expect(markAudioLanes(banked, files('bd')).lanes[0].audio ?? false).toBe(false)
  })

  it('a lane with no marks is not an audio lane', () => {
    expect(markAudioLanes(sceneOf([]), () => true).lanes[0].audio ?? false).toBe(false)
  })

  it('without a registry nothing changes, and an unchanged answer keeps the scene', () => {
    const scene = sceneOf([{ cycle: 0, end: 1, pitch: null, gain: 1, voice: 'take_1' }])
    expect(markAudioLanes(scene, undefined)).toBe(scene)
    const once = markAudioLanes(scene, files('take_1'))
    expect(markAudioLanes(once, files('take_1'))).toBe(once)
  })
})

describe('laneMarkBands — an audio lane in overview (#1730)', () => {
  const take: SceneNote[] = [
    { cycle: 0, end: 1, pitch: 60, gain: 1, voice: 'casio' },
    { cycle: 1, end: 2, pitch: 72, gain: 1, voice: 'casio' },
  ]
  const ROW = 25

  function bands(audio: boolean, expanded: boolean) {
    const scene = markAudioLanes(sceneOf(take, 60, 72), audio ? files('casio') : files())
    const layout = computeLaneLayout(scene.lanes, new Set(expanded ? ['a'] : []), ROW, 100, ROW)
    const box = layout.boxes[0]
    const band = laneMarkBands(scene.lanes[0], box)[0]
    const rects = take.map((n) => markRect(n, band, 100, 400, 0, 2, (c) => c * 100)!)
    return { box, band, rects }
  }

  it('collapsed: every mark fills the row, at the same height whatever its pitch', () => {
    const { box, rects } = bands(true, false)
    for (const r of rects) {
      expect(r.y).toBe(box.top + 3)
      expect(r.h).toBe(ROW - 6)
    }
  })

  it('the same lane NOT playing files keeps the pitch contour — the control', () => {
    const { rects } = bands(false, false)
    expect(rects[0].h).toBeLessThan(ROW / 2)
    expect(rects[0].y).not.toBe(rects[1].y)
  })

  it('expanded: the editing view is untouched, audio lane or not', () => {
    const audio = bands(true, true)
    const plain = bands(false, true)
    expect(audio.band).toEqual(plain.band)
  })
})

describe('markBarsLanes — a track set to Bars (#1738)', () => {
  const take: SceneNote[] = [{ cycle: 0, end: 1, pitch: null, gain: 1, voice: 'take_1' }]
  const set = (display: 'bars' | 'waveform') => new Map([['a', display]])
  const LONG = new Set(['a'])

  it('marks the lane whose display name is set to Bars', () => {
    expect(markBarsLanes(sceneOf(take), set('bars'), LONG).lanes[0].bars).toBe(true)
  })

  it('returns the SAME scene when no lane is Bars', () => {
    const scene = sceneOf(take)
    expect(markBarsLanes(scene, new Map(), LONG)).toBe(scene)
    expect(markBarsLanes(scene, set('waveform'), new Set())).toBe(scene)
  })

  it('a lane set to Bars is never an audio lane, even when every mark is a file', () => {
    const bars = markBarsLanes(sceneOf(take), set('bars'), LONG)
    expect(markAudioLanes(bars, files('take_1')).lanes[0].audio ?? false).toBe(false)
    // CONTROL — the same lane left on Waveform is one.
    const wave = markBarsLanes(sceneOf(take), set('waveform'), LONG)
    expect(markAudioLanes(wave, files('take_1')).lanes[0].audio).toBe(true)
  })
})

describe('the default type (#2079): Bars, unless the lane is a long recording', () => {
  const take: SceneNote[] = [{ cycle: 0, end: 1, pitch: null, gain: 1, voice: 'take_1' }]

  it('a lane with no saved type draws as Bars', () => {
    expect(markBarsLanes(sceneOf(take), new Map(), new Set()).lanes[0].bars).toBe(true)
  })

  it('a long recording with no saved type keeps its waveform', () => {
    expect(markBarsLanes(sceneOf(take), new Map(), new Set(['a'])).lanes[0].bars ?? false).toBe(false)
  })

  it('a saved type wins over the default, both ways', () => {
    expect(markBarsLanes(sceneOf(take), new Map([['a', 'waveform']]), new Set()).lanes[0].bars ?? false).toBe(false)
    expect(markBarsLanes(sceneOf(take), new Map([['a', 'bars']]), new Set(['a'])).lanes[0].bars).toBe(true)
  })
})

describe('longRecordingLanes — which lanes play long recordings (#2079)', () => {
  // At 0.5 cycles per second a bar (one cycle) lasts 2 s.
  const source = (durations: Record<string, number>, cps: number | null = 0.5) => ({
    cps,
    isFileBacked: (s: SampleRef) => s.s in durations,
    peaksFor: (s: SampleRef) =>
      durations[s.s] === undefined || Number.isNaN(durations[s.s])
        ? null
        : { data: new Float32Array(0), columns: 0, duration: durations[s.s] },
  })
  const note = (voice: string): SceneNote => ({ cycle: 0, end: 1, pitch: null, gain: 1, voice })

  it('a lane whose every file is longer than a bar is a long recording', () => {
    expect([...longRecordingLanes(sceneOf([note('vocal')]), source({ vocal: 12 }))]).toEqual(['a'])
  })

  it('a drum kit (short hits) is not', () => {
    expect([...longRecordingLanes(sceneOf([note('bd'), note('sd')]), source({ bd: 0.4, sd: 0.3 }))]).toEqual([])
  })

  it('one short file on the lane makes it not one', () => {
    expect([...longRecordingLanes(sceneOf([note('vocal'), note('bd')]), source({ vocal: 12, bd: 0.4 }))]).toEqual([])
  })

  it('a synth note makes it not one', () => {
    expect([...longRecordingLanes(sceneOf([note('vocal'), note('sawtooth')]), source({ vocal: 12 }))]).toEqual([])
  })

  it('a file whose length is not known yet does not count as long', () => {
    expect([...longRecordingLanes(sceneOf([note('vocal')]), source({ vocal: NaN }))]).toEqual([])
  })

  it('a bar is measured at the song tempo', () => {
    // 3 s is longer than a bar at 0.5 cps (2 s), shorter than one at 0.25 cps (4 s).
    expect([...longRecordingLanes(sceneOf([note('loop')]), source({ loop: 3 }, 0.5))]).toEqual(['a'])
    expect([...longRecordingLanes(sceneOf([note('loop')]), source({ loop: 3 }, 0.25))]).toEqual([])
    // With no tempo there is no bar to measure against, so nothing is long.
    // (The app's source always has one: it assumes Strudel's starting tempo.)
    expect([...longRecordingLanes(sceneOf([note('loop')]), source({ loop: 3 }, null))]).toEqual([])
  })

  it('an empty lane, or no source at all, has none', () => {
    expect([...longRecordingLanes(sceneOf([]), source({}))]).toEqual([])
    expect([...longRecordingLanes(sceneOf([note('vocal')]), undefined)]).toEqual([])
  })
})
