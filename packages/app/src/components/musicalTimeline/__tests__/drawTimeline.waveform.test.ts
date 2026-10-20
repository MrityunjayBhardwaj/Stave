import { describe, expect, it } from 'vitest'

import {
  WAVEFORM_COLUMN_BUDGET,
  drawTimeline,
  type DrawTheme,
  type DrawTransform,
  type WaveformSource,
} from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import { computeLaneLayout } from '../laneLayout'
import { MIN_WAVEFORM_H } from '../waveformLane'
import type { SceneNote, TimelineScene } from '../timelineScene'

/**
 * The waveform tier wired into the renderer (#1506).
 *
 * Assertions here are exact because the recording context reports what was
 * REQUESTED — this is the renderer's arithmetic, with no rasteriser and no
 * device in between. What a real canvas actually puts on screen is a separate
 * question and belongs to a browser arm.
 *
 * The claim each arm defends is that the feature is ADDITIVE: without a source,
 * or with one that has nothing decoded, the scene must draw byte-for-byte what
 * it drew before.
 */

interface Rect { x: number; y: number; w: number; h: number; style: string; alpha: number }

function mockCtx() {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '' as string,
    globalAlpha: 1,
    font: '' as string,
    textBaseline: '' as string,
    clearRect() {},
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha })
    },
    fillText() {},
    measureText(text: string) {
      return { width: text.length * 6 } as TextMetrics
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

const theme: DrawTheme = {
  background: '#000', rowAlt: '#111', section: '#222', sectionAlt: '#333',
  gridline: '#444', clipFill: '#555', clipCaption: '#fff', clipBorder: '#666',
  automationLine: '#777',
}

const LANE_COLOR = '#0af'

/** A named mark plays the file of that name at its pitch unless it says
 *  otherwise — what `timelineMarks` builds with no bank or number (#1764). */
const withSample = (n: SceneNote): SceneNote =>
  n.sample !== undefined || n.voice == null ? n : { ...n, sample: { s: n.voice, note: n.pitch } }

function sceneWith(raw: SceneNote[]): TimelineScene {
  const notes = raw.map(withSample)
  return {
    displayCycles: 4,
    windowOriginCycles: 0,
    period: 4,
    peakDensity: 2,
    notesCapped: false,
    sections: [{ startCycle: 0, endCycle: 4, laneKeys: ['drums'] }],
    lanes: [
      {
        laneKey: 'drums',
        displayName: 'drums', shownName: 'drums',
        color: LANE_COLOR,
        density: [1, 0, 0, 0],
        notes,
        pitchMin: null,
        pitchMax: null,
        voices: [{ key: 'take_1', label: 'take_1', melodic: false, pitchMin: null, pitchMax: null }],
        clips: [],
        sourceOffset: null,
        arrangeOffset: null,
        labelOffset: null,
        automations: [],
        stepped: [],
      },
    ],
  }
}

/** One percussive take at cycle 0, a quarter-cycle long. */
const oneTake: SceneNote[] = [{ cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'take_1' }]

/** A tall row, so the height gate is open and the width gate is what is tested. */
const tall = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 60, 88)
/** 1000px per cycle → a quarter-cycle mark is 250px wide. */
const transform: DrawTransform = { scrollLeft: 0, contentWidth: 4000, viewportWidth: 400, meter: DEFAULT_METER }

/** An envelope that is full-scale everywhere, so every column is unmistakable. */
function fullScalePeaks(duration: number, columns = 16) {
  const data = new Float32Array(columns * 2)
  for (let i = 0; i < columns; i++) {
    data[i * 2] = -1
    data[i * 2 + 1] = 1
  }
  return { data, columns, duration }
}

/** Columns are the renderer's waveform signature: 1px wide, in the lane colour. */
function waveformColumns(rects: Rect[]): Rect[] {
  return rects.filter((r) => r.w === 1 && r.style === LANE_COLOR)
}

describe('drawTimeline — waveform tier', () => {
  it('draws exactly what it always drew when no source is supplied', () => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall)
    expect(waveformColumns(rects)).toEqual([])
  })

  it('draws exactly what it always drew while the sample is undecoded', () => {
    const { ctx: a, rects: before } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall)

    const cold: WaveformSource = { cps: 1, peaksFor: () => null }
    const { ctx: b, rects: after } = mockCtx()
    drawTimeline(b, sceneWith(oneTake), transform, theme, tall, undefined, cold)

    // Byte-for-byte, not merely "no waveform": a cold cache must be invisible.
    expect(after).toEqual(before)
  })

  it('draws one 1px column per pixel of audio once the sample is decoded', () => {
    // 0.1s at 1 cps over 1000px/cycle = 100px of audio inside a 250px mark.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)

    const cols = waveformColumns(rects)
    expect(cols).toHaveLength(100)
    // They start at the mark's own left edge and run contiguously from it.
    expect(cols[0].x).toBe(0)
    expect(cols[cols.length - 1].x).toBe(99)
    // Full-scale peaks span the mark's full height, centred on it.
    expect(cols[0].h).toBeCloseTo(rects.find((r) => r.w === 250)!.h, 6)
  })

  it('a lane set to Bars draws no waveform, even with its sample decoded (#1738)', () => {
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const scene = sceneWith(oneTake)
    const bars: TimelineScene = { ...scene, lanes: [{ ...scene.lanes[0], bars: true }] }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, bars, transform, theme, tall, undefined, warm)
    expect(waveformColumns(rects)).toEqual([])
    // CONTROL — the same lane without the setting draws its 100 columns.
    const { ctx: c2, rects: control } = mockCtx()
    drawTimeline(c2, scene, transform, theme, tall, undefined, warm)
    expect(waveformColumns(control)).toHaveLength(100)
  })

  // ── #1512 — the mark draws the slice it PLAYS ────────────────────────────
  //
  // The renderer's half of the region work: that `note.region` reaches
  // `waveformFit` and `waveformColumn` at all. What the pixels then look like is
  // a device question and belongs to the browser arm — a mock reports that a
  // fill was requested, never that anything appeared.

  it('sizes a chopped mark by the quarter it plays, not by the file', () => {
    // 0.4s file at 1 cps over 1000px/cycle = 400px of audio, clipped to the
    // 250px mark. One quarter of it is 100px, which fits.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.4) }
    const chopped: SceneNote[] = [
      {
        ...oneTake[0],
        region: { begin: 0.5, end: 0.75, speed: 1, unit: null },
      },
    ]
    const { ctx: a, rects: whole } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    const { ctx: b, rects: quarter } = mockCtx()
    drawTimeline(b, sceneWith(chopped), transform, theme, tall, undefined, warm)

    expect(waveformColumns(whole)).toHaveLength(250) // the file overruns the mark
    expect(waveformColumns(quarter)).toHaveLength(100) // its quarter does not
  })

  it('reads the region’s own columns, so two chops of one file differ', () => {
    // An envelope that is silent in its first half and full-scale in its second.
    // Two marks, same file, same width — the only difference is which half each
    // one plays, and that must be the only difference in what is drawn.
    const columns = 16
    const data = new Float32Array(columns * 2)
    for (let i = columns / 2; i < columns; i++) {
      data[i * 2] = -1
      data[i * 2 + 1] = 1
    }
    const warm: WaveformSource = { cps: 1, peaksFor: () => ({ data, columns, duration: 0.2 }) }
    const half = (begin: number, end: number): SceneNote[] => [
      { ...oneTake[0], region: { begin, end, speed: 1, unit: null } },
    ]

    const { ctx: a, rects: firstHalf } = mockCtx()
    drawTimeline(a, sceneWith(half(0, 0.5)), transform, theme, tall, undefined, warm)
    const { ctx: b, rects: secondHalf } = mockCtx()
    drawTimeline(b, sceneWith(half(0.5, 1)), transform, theme, tall, undefined, warm)

    const quiet = waveformColumns(firstHalf)
    const loud = waveformColumns(secondHalf)
    // Same count — the two slices are the same length.
    expect(quiet).toHaveLength(loud.length)
    // …and opposite content: the silent half draws minimum-height columns, the
    // full-scale half spans the mark.
    expect(Math.max(...quiet.map((r) => r.h))).toBe(1)
    expect(Math.min(...loud.map((r) => r.h))).toBeGreaterThan(1)
  })

  it('is byte-for-byte unchanged for a mark with no region', () => {
    // The compatibility claim at the RENDERER, not only in the arithmetic.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx: a, rects: before } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    const explicit: SceneNote[] = [
      { ...oneTake[0], region: { begin: 0, end: 1, speed: 1, unit: null } },
    ]
    const { ctx: b, rects: after } = mockCtx()
    drawTimeline(b, sceneWith(explicit), transform, theme, tall, undefined, warm)
    expect(after).toEqual(before)
  })

  it('declines a region too short to draw, leaving the plain bar', () => {
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const sliver: SceneNote[] = [
      { ...oneTake[0], region: { begin: 0, end: 0.01, speed: 1, unit: null } },
    ]
    const { ctx: a, rects: bare } = mockCtx()
    drawTimeline(a, sceneWith(oneTake), transform, theme, tall)
    const { ctx: b, rects: declined } = mockCtx()
    drawTimeline(b, sceneWith(sliver), transform, theme, tall, undefined, warm)
    // 1px of audio is under MIN_WAVEFORM_W, so nothing is drawn — and "nothing"
    // must mean the bar it drew before a source existed at all.
    expect(waveformColumns(declined)).toEqual([])
    expect(declined).toEqual(bare)
  })

  it('stops at the mark’s edge for a sample longer than its slot', () => {
    // 10s of audio in a 250px mark: the mark's width is the whole allowance.
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(10) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    expect(waveformColumns(rects)).toHaveLength(250)
  })

  /**
   * The arm this feature actually needed, and the one it did not have.
   *
   * The bar is drawn at `0.4 + 0.6 × gain` in the lane colour, and the waveform
   * is drawn INSIDE the bar's own height in that same colour. At `gain: 1` the
   * bar is fully opaque, so before the bed existed the shape was painted
   * invisibly — and every geometry arm above still passed, because a recording
   * context reports that a fill was requested, not that anything can be seen.
   */
  it('clears a bed so the shape is visible against a FULL-GAIN bar', () => {
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const loudest = sceneWith([{ cycle: 0, end: 0.25, pitch: null, gain: 1, voice: 'take_1' }])
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, loudest, transform, theme, tall, undefined, warm)

    const bar = rects.find((r) => r.w === 250 && r.style === LANE_COLOR)!
    expect(bar.alpha).toBe(1) // the bar really is opaque at this gain

    // A recessed bed exists, exactly as wide as the audio, over the bar's band.
    const bed = rects.find(
      (r) => r.style === theme.background && r.w === 100 && r.y === bar.y && r.h === bar.h,
    )
    expect(bed).toBeDefined()
    expect(bed!.alpha).toBeLessThan(1)
  })

  it('draws a waveform at the DEFAULT row height, with no settings changed', () => {
    // The product-level guarantee behind "a take can be seen": 25 is the default
    // sub-row height, giving a 7px mark. If a change ever pushes the threshold
    // above that, takes stop drawing for everyone who has not gone looking for a
    // size setting — and every other arm here, which uses a tall row, stays green.
    const defaultRow = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 25, 88)
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, defaultRow, undefined, warm)
    expect(waveformColumns(rects).length).toBeGreaterThan(0)
  })

  it('never asks about a synth note, which has no sample to draw', () => {
    const asked: string[] = []
    const source: WaveformSource = {
      cps: 1,
      peaksFor: (sample) => {
        asked.push(sample.s)
        return fullScalePeaks(0.1)
      },
    }
    const synth = sceneWith([{ cycle: 0, end: 0.25, pitch: 60, gain: 1, voice: null }])
    const { ctx } = mockCtx()
    drawTimeline(ctx, synth, transform, theme, tall, undefined, source)
    expect(asked).toEqual([])
  })

  it('declines on a short row, however wide the mark is', () => {
    const shortRow = computeLaneLayout(sceneWith(oneTake).lanes, new Set(), 22, 88)
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, shortRow, undefined, warm)
    // The bar is still there; only the detail is gone.
    expect(waveformColumns(rects)).toEqual([])
    expect(rects.some((r) => r.style === LANE_COLOR)).toBe(true)
    // …and the reason is the row, not the source: it is under the height gate.
    expect(rects.find((r) => r.w === 250)!.h).toBeLessThan(MIN_WAVEFORM_H)
  })

  /**
   * Asserted by the WORK AVOIDED, not by the pixels produced. Two marks of the
   * same voice yield identical columns whether the lookup is memoised or not, so
   * comparing output could not fail; counting lookups can.
   */
  it('looks a voice up once per draw, not once per mark', () => {
    const notes: SceneNote[] = Array.from({ length: 8 }, (_, i) => ({
      cycle: i * 0.4, end: i * 0.4 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    let lookups = 0
    const counting: WaveformSource = {
      cps: 1,
      peaksFor: () => {
        lookups++
        return fullScalePeaks(0.1)
      },
    }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, counting)

    expect(waveformColumns(rects).length).toBeGreaterThan(100) // several marks drew
    expect(lookups).toBe(1) // 1, not 8
  })

  it('reads the tempo once per draw, not once per mark', () => {
    // `cps` is a getter onto the live runtime. Reading it per mark meant a dense
    // lane asked the transport for the tempo two thousand times a frame to be
    // told the same number. Asserted by the reads it makes, not by the pixels:
    // the drawing is identical either way, so only the count can fail.
    const notes: SceneNote[] = Array.from({ length: 12 }, (_, i) => ({
      cycle: i * 0.02, end: i * 0.02 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    let cpsReads = 0
    const counting: WaveformSource = {
      get cps() {
        cpsReads++
        return 1
      },
      peaksFor: () => fullScalePeaks(0.1),
    }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, counting)

    expect(waveformColumns(rects).length).toBeGreaterThan(100) // marks really drew
    expect(cpsReads).toBe(1) // 1, not 12
  })

  it('asks again for a different pitch, because that can be a different file', () => {
    const asked: (number | string | null | undefined)[] = []
    const source: WaveformSource = {
      cps: 1,
      peaksFor: (sample) => {
        asked.push(sample.note)
        return fullScalePeaks(0.1)
      },
    }
    const notes: SceneNote[] = [
      { cycle: 0, end: 0.25, pitch: 48, gain: 1, voice: 'piano' },
      { cycle: 0.4, end: 0.65, pitch: 72, gain: 1, voice: 'piano' },
      { cycle: 0.8, end: 1.05, pitch: 48, gain: 1, voice: 'piano' },
    ]
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, source)
    expect(asked).toEqual([48, 72]) // the repeat of 48 was memoised
  })

  it('asks for the file each mark plays: a bank or a sample number is a different file (#1764)', () => {
    const asked: string[] = []
    const source: WaveformSource = {
      cps: 1,
      peaksFor: (sample) => {
        asked.push(`${sample.s}:${sample.n ?? 0}`)
        return fullScalePeaks(0.1)
      },
    }
    // One row, all `bd`: the default kit's first, the 909's, and the default's fourth.
    const notes: SceneNote[] = [
      // All three inside the 400px viewport (1000px per cycle), so none is culled.
      { cycle: 0, end: 0.1, pitch: null, gain: 1, voice: 'bd', sample: { s: 'bd' } },
      { cycle: 0.12, end: 0.22, pitch: null, gain: 1, voice: 'bd', sample: { s: 'RolandTR909_bd' } },
      { cycle: 0.24, end: 0.34, pitch: null, gain: 1, voice: 'bd', sample: { s: 'bd', n: 3 } },
    ]
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, source)
    expect(asked).toEqual(['bd:0', 'RolandTR909_bd:0', 'bd:3'])
  })

  it('spends no more than its per-frame column budget', () => {
    // 400 overlapping 250px marks packed inside the 400px viewport, so ~100k
    // columns are ASKED for. Spacing matters: at a coarser spacing the marks
    // scroll off-screen and are culled before the budget is reached, which makes
    // the cap true for a reason that has nothing to do with the cap.
    const notes: SceneNote[] = Array.from({ length: 400 }, (_, i) => ({
      cycle: i * 0.001, end: i * 0.001 + 0.25, pitch: null, gain: 1, voice: 'take_1',
    }))
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(10) }
    const layout = computeLaneLayout(sceneWith(notes).lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(notes), transform, theme, layout, undefined, warm)
    // Exactly the budget: spent to the last column and not one past it. An
    // inequality would also hold if the cap were never reached at all.
    expect(waveformColumns(rects)).toHaveLength(WAVEFORM_COLUMN_BUDGET)
  })

  it('keeps the waveform when a sample lane is EXPANDED (#1713)', () => {
    // Expanding is how you ask to see more of a track. A sample mark has no pitch
    // to place, so the thin pitch sliver an expanded melodic lane uses has
    // nothing to encode here — and at 4px it is under the waveform's height gate,
    // so expanding used to swap the waveform for a flat bar.
    const lanes = sceneWith(oneTake).lanes
    const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
    const collapsed = mockCtx()
    drawTimeline(collapsed.ctx, sceneWith(oneTake), transform, theme,
      computeLaneLayout(lanes, new Set(), 60, 88, 60), undefined, warm)
    const expanded = mockCtx()
    drawTimeline(expanded.ctx, sceneWith(oneTake), transform, theme,
      computeLaneLayout(lanes, new Set(['drums']), 60, 88, 60), undefined, warm)

    expect(waveformColumns(collapsed.rects).length).toBeGreaterThan(0) // control: the shape exists
    expect(waveformColumns(expanded.rects).length).toBe(waveformColumns(collapsed.rects).length)
    // Not merely "some columns": the mark is as tall as the collapsed one, so
    // expanding never shows less of the take than collapsing does.
    const barH = (rects: Rect[]) => rects.find((r) => r.w === 250 && r.style === LANE_COLOR)!.h
    expect(barH(expanded.rects)).toBe(barH(collapsed.rects))
  })

  it('an expanded MELODIC lane places each note by pitch, its bar one sub-row tall (#1713, #1744)', () => {
    // The other side of the same rule: where there IS a pitch range, the expanded
    // band spends its height on pitch-Y. Each bar is the size one sub-row's bar is
    // (#1744) — it was a fixed 4 px sliver, whatever the sub-row setting.
    const notes: SceneNote[] = [
      { cycle: 0, end: 0.25, pitch: 48, gain: 1, voice: 'piano' },
      { cycle: 0.4, end: 0.65, pitch: 72, gain: 1, voice: 'piano' },
    ]
    const base = sceneWith(notes)
    const melodic: TimelineScene = {
      ...base,
      lanes: [{
        ...base.lanes[0],
        pitchMin: 48,
        pitchMax: 72,
        voices: [{ key: 'piano', label: 'piano', melodic: true, pitchMin: 48, pitchMax: 72 }],
      }],
    }
    const layout = computeLaneLayout(melodic.lanes, new Set(['drums']), 60, 88, 60)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, melodic, transform, theme, layout)
    const bars = rects.filter((r) => r.w === 250 && r.style === LANE_COLOR)
    expect(bars).toHaveLength(2)
    // Sub-row 60 → 60 − 2·2 padding − 12 pitch reserve = 44 px.
    expect(bars.every((r) => r.h === 44)).toBe(true)
    // …and still at two heights: the higher note sits higher.
    const [low, high] = [...bars].sort((a, b) => a.x - b.x)
    expect(high.y).toBeLessThan(low.y)
    expect(bars[0].y).not.toBe(bars[1].y) // two pitches, two heights in the band
  })
})

describe('a collapsed audio lane draws each mark as a clip body (#1730)', () => {
  // 0.1s at 1 cps over 1000px/cycle = 100px of audio inside a 250px mark: the
  // audio ends well before the mark does, which is where the two rules differ.
  const warm: WaveformSource = { cps: 1, peaksFor: () => fullScalePeaks(0.1) }
  const audioScene = (): TimelineScene => {
    const s = sceneWith(oneTake)
    return { ...s, lanes: [{ ...s.lanes[0], audio: true }] }
  }
  /** Background-coloured scrims — the bed a waveform is drawn against. The
   *  canvas's own background fill spans the viewport and is not one. */
  const beds = (rects: Rect[]) =>
    rects.filter((r) => r.style === theme.background && r.h > 1 && r.w < transform.viewportWidth)

  it('recedes the WHOLE mark, not only the audio’s extent', () => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, audioScene(), transform, theme, tall, undefined, warm)
    const widest = Math.max(...beds(rects).map((r) => r.w))
    expect(widest).toBe(250)
    // …and lays that bed once: no second, darker bed under the audio.
    expect(beds(rects).length).toBe(1)
    expect(waveformColumns(rects).length).toBe(100)
  })

  it('an ordinary lane keeps its bar past the audio — the control', () => {
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, sceneWith(oneTake), transform, theme, tall, undefined, warm)
    expect(Math.max(...beds(rects).map((r) => r.w))).toBe(100)
  })

  it('before the sample decodes, the audio lane is still a body, not a full-weight slab', () => {
    const cold: WaveformSource = { cps: 1, peaksFor: () => null }
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, audioScene(), transform, theme, tall, undefined, cold)
    expect(beds(rects).map((r) => r.w)).toEqual([250])
    expect(waveformColumns(rects).length).toBe(0)
  })
})
