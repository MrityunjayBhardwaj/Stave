/**
 * #1744 — an expanded lane with a pitch range sizes its bars from the Timeline
 * sub-row setting, as a drum lane's per-voice sub-rows already do, instead of a
 * fixed 4 px sliver. The rest of the lane is pitch travel.
 */
import { describe, it, expect } from 'vitest'
import { laneMarkBands } from '../drawTimeline'
import { computeLaneLayout } from '../laneLayout'
import type { SceneLane, SceneNote, SceneVoice } from '../timelineScene'

function lane(key: string, notes: SceneNote[], voices: SceneVoice[], pitchMin: number | null, pitchMax: number | null, extra: Partial<SceneLane> = {}): SceneLane {
  return {
    laneKey: key,
    displayName: key, shownName: key,
    color: '#0af',
    density: [1, 1],
    notes,
    pitchMin,
    pitchMax,
    voices,
    clips: [],
    sourceOffset: null,
    arrangeOffset: null,
    labelOffset: null,
    automations: [],
    stepped: [],
    ...extra,
  }
}

/** A bass line: one melodic voice, eb1..bb1 — the Whiskey demo's range. */
const bass = lane(
  'bass',
  [
    { cycle: 0, end: 1, pitch: 39, gain: 1, voice: 'sawtooth' },
    { cycle: 1, end: 2, pitch: 46, gain: 1, voice: 'sawtooth' },
  ],
  [{ key: 'sawtooth', label: 'sawtooth', melodic: true, pitchMin: 39, pitchMax: 46 }],
  39,
  46,
)

/** A drum kit: two percussive voices, so it expands into sub-rows. */
const drums = lane(
  'drums',
  [
    { cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'bd' },
    { cycle: 0.5, end: 0.75, pitch: null, gain: 1, voice: 'sd' },
  ],
  [
    { key: 'bd', label: 'bd', melodic: false, pitchMin: null, pitchMax: null },
    { key: 'sd', label: 'sd', melodic: false, pitchMin: null, pitchMax: null },
  ],
  null,
  null,
)

const bandOf = (l: SceneLane, sub: number) => {
  const layout = computeLaneLayout([l], new Set([l.laneKey]), 25, 88, sub)
  return { band: laneMarkBands(l, layout.boxes[0])[0], box: layout.boxes[0] }
}

describe('an expanded pitched lane sizes its bars from the sub-row setting (#1744)', () => {
  it('default sub-row 22 → a 6 px bar, not the old 4 px sliver', () => {
    expect(bandOf(bass, 22).band.markH).toBe(6)
  })

  it('sub-row 40 → a 24 px bar: the bar grows with the setting', () => {
    expect(bandOf(bass, 40).band.markH).toBe(24)
  })

  it('is the same bar a drum voice gets from one sub-row, at every setting', () => {
    for (const sub of [22, 30, 40, 60]) {
      expect(bandOf(bass, sub).band.markH).toBe(bandOf(drums, sub).band.markH)
    }
  })

  it('the rest of the lane is pitch travel: a higher note sits higher, both inside the lane', () => {
    const { band, box } = bandOf(bass, 22)
    const yOf = (pitch: number) => band.bandTop + (1 - (pitch - band.pMin!) / (band.pMax! - band.pMin!)) * band.bandH
    expect(yOf(46)).toBeLessThan(yOf(39))
    expect(yOf(46)).toBeGreaterThanOrEqual(box.top)
    expect(yOf(39) + band.markH).toBeLessThanOrEqual(box.top + box.height)
    expect(band.bandH).toBe(box.height - 2 * 3 - band.markH)
  })

  it('an automation floor that raises the lane does not raise the bar', () => {
    const stepped = { ...bass, stepped: [{} as never] }
    const tall = computeLaneLayout([stepped], new Set(['bass']), 25, 88, 22)
    const plain = computeLaneLayout([bass], new Set(['bass']), 25, 88, 22)
    expect(laneMarkBands(stepped, tall.boxes[0])[0].markH).toBe(laneMarkBands(bass, plain.boxes[0])[0].markH)
  })

  it('CONTROL: a collapsed lane still sizes its bar from the row height', () => {
    const layout = computeLaneLayout([bass], new Set(), 25, 88, 40)
    expect(laneMarkBands(bass, layout.boxes[0])[0].markH).toBe(7) // 25 − 6 − 12
  })
})
