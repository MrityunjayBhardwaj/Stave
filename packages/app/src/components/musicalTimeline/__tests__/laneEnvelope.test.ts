/**
 * #1731 — a synth lane draws its own rendered loudness when collapsed. Three
 * pure pieces: `envelopeTrackIds` says which tracks to render, `attachEnvelopes`
 * puts each render on its lane, and `drawTimeline` draws it behind the marks.
 * The pixels are read back off the real canvas in `synth-lane-envelope.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import { ENVELOPE_ALPHA, ENVELOPE_STALE_ALPHA, MARK_GAP_PX, drawTimeline, type DrawTheme, type DrawTransform } from '../drawTimeline'
import { computeLaneLayout, lanesInView } from '../laneLayout'
import { DEFAULT_METER } from '../../../lib/meter'
import {
  attachEnvelopes,
  envelopeNotices,
  envelopeTrackIds,
  type LaneEnvelope,
  type SceneLane,
  type SceneNote,
  type TimelineScene,
} from '../timelineScene'

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

const synth: SceneNote[] = [{ cycle: 0, end: 0.5, pitch: 48, gain: 1, voice: 'sawtooth' }]

function lane(key: string, notes: SceneNote[], extra: Partial<SceneLane> = {}): SceneLane {
  return {
    laneKey: key,
    displayName: key, shownName: key,
    color: '#0af',
    density: [1, 1, 1, 1],
    notes,
    pitchMin: 48,
    pitchMax: 48,
    voices: [],
    clips: [],
    sourceOffset: null,
    arrangeOffset: null,
    labelOffset: null,
    automations: [],
    stepped: [],
    ...extra,
  }
}

function sceneOf(lanes: SceneLane[]): TimelineScene {
  return {
    displayCycles: 4,
    windowOriginCycles: 0,
    period: 4,
    peakDensity: 1,
    notesCapped: false,
    sections: [],
    lanes,
  }
}

/** Silent first half, loud second half: 8 columns over 4 cycles. */
function swell(stale = false): LaneEnvelope {
  const data = new Float32Array(16)
  for (let c = 4; c < 8; c++) {
    data[2 * c] = -0.2
    data[2 * c + 1] = 0.2
  }
  return { data, columns: 8, cycles: 4, stale }
}

describe('envelopeTrackIds — which tracks to render (#1731)', () => {
  it('names the track behind every non-audio lane with marks, once, in lane order', () => {
    const scene = sceneOf([
      lane('d1', synth),
      lane('d2', synth, { audio: true }),
      lane('d3', []),
      lane('d4', synth),
      lane('d5', synth),
    ])
    const byLane = new Map([
      ['d1', '$0'],
      ['d2', '$1'],
      ['d3', '$2'],
      ['d4', '$3'],
      ['d5', '$3'],
    ])
    expect(envelopeTrackIds(scene, byLane)).toEqual(['$0', '$3'])
  })

  it('asks for a Bars lane\'s track too, after every Waveform lane, so it has a render ready (#1748)', () => {
    const scene = sceneOf([
      lane('d1', synth, { bars: true }),
      lane('d2', synth),
      lane('d3', synth, { bars: true }),
      lane('d4', synth),
    ])
    const byLane = new Map([
      ['d1', '$0'],
      ['d2', '$1'],
      ['d3', '$2'],
      ['d4', '$3'],
    ])
    expect(envelopeTrackIds(scene, byLane)).toEqual(['$1', '$3', '$0', '$2'])
  })

  it('a track behind both a Waveform and a Bars lane is asked for once, with the Waveform lanes', () => {
    const scene = sceneOf([lane('d1', synth, { bars: true }), lane('d2', synth), lane('d3', synth)])
    const byLane = new Map([
      ['d1', '$0'],
      ['d2', '$1'],
      ['d3', '$0'],
    ])
    expect(envelopeTrackIds(scene, byLane)).toEqual(['$1', '$0'])
  })

  it('never asks for the track behind a Bars lane of files: its Waveform view is the files, not a render (#2138)', () => {
    const scene = sceneOf([
      lane('d1', synth, { bars: true }),
      lane('d2', synth, { bars: true, files: true }),
    ])
    const byLane = new Map([
      ['d1', '$0'],
      ['d2', '$1'],
    ])
    // The Bars synth lane is still asked for (#1748); the Bars drum lane is not.
    expect(envelopeTrackIds(scene, byLane)).toEqual(['$0'])
  })

  it('asks for nothing without the lane→track join', () => {
    expect(envelopeTrackIds(sceneOf([lane('d1', synth)]), undefined)).toEqual([])
  })

  it('puts the Waveform lanes in view first, then the rest, and Bars lanes still last (#1760)', () => {
    const scene = sceneOf([
      lane('d1', synth),
      lane('d2', synth, { bars: true }),
      lane('d3', synth),
      lane('d4', synth),
      lane('d5', synth, { bars: true }),
    ])
    const byLane = new Map(['d1', 'd2', 'd3', 'd4', 'd5'].map((k, i) => [k, `$${i}`]))
    // Scrolled to the bottom: d4 and d5 on screen.
    expect(envelopeTrackIds(scene, byLane, new Set(['d4', 'd5']))).toEqual(['$3', '$0', '$2', '$4', '$1'])
    // Nothing measured yet: lane order, as before.
    expect(envelopeTrackIds(scene, byLane, new Set())).toEqual(['$0', '$2', '$3', '$1', '$4'])
  })
})

describe('envelopeNotices — what the timeline says about lanes with no shape (#1748)', () => {
  const byLane = new Map([
    ['d1', '$0'],
    ['d2', '$1'],
    ['d3', '$2'],
  ])

  it('names a Waveform lane whose track has no render yet as waiting', () => {
    const scene = sceneOf([lane('d1', synth), lane('d2', synth, { envelope: swell() }), lane('d3', synth)])
    const got = envelopeNotices(scene, byLane, { rendering: null, overCap: [], waiting: ['$0', '$2'] })
    expect(got.waiting).toEqual(['d1', 'd3'])
  })

  it('never names a Bars lane or an audio lane as waiting, though its track is', () => {
    const scene = sceneOf([lane('d1', synth, { bars: true }), lane('d2', synth, { audio: true })])
    const got = envelopeNotices(scene, byLane, { rendering: null, overCap: [], waiting: ['$0', '$1'] })
    expect(got.waiting).toEqual([])
  })

  it('counts only Waveform lanes past the budget: a Bars track the budget leaves out is not "too long to draw"', () => {
    const scene = sceneOf([lane('d1', synth), lane('d2', synth, { bars: true }), lane('d3', synth)])
    const got = envelopeNotices(scene, byLane, { rendering: null, overCap: ['$1', '$2'], waiting: [] })
    expect(got.overCap).toBe(1)
  })

  it('says nothing without a status', () => {
    expect(envelopeNotices(sceneOf([lane('d1', synth)]), byLane, null)).toEqual({ overCap: 0, waiting: [] })
  })
})

describe('attachEnvelopes — each render on its lane (#1731)', () => {
  it('puts a track\'s envelope on its lane, and none on an audio lane', () => {
    const env = swell()
    const scene = sceneOf([lane('d1', synth), lane('d2', synth, { audio: true })])
    const out = attachEnvelopes(scene, new Map([['d1', '$0'], ['d2', '$1']]), () => env)
    expect(out.lanes[0].envelope).toBe(env)
    expect(out.lanes[1].envelope).toBeUndefined()
  })

  it('puts no envelope on a lane set to Bars (#1738)', () => {
    const env = swell()
    const scene = sceneOf([lane('d1', synth, { bars: true }), lane('d2', synth)])
    const out = attachEnvelopes(scene, new Map([['d1', '$0'], ['d2', '$1']]), () => env)
    expect(out.lanes[0].envelope).toBeUndefined()
    expect(out.lanes[1].envelope).toBe(env)
  })

  it('drops an envelope the engine no longer has', () => {
    const scene = sceneOf([lane('d1', synth, { envelope: swell() })])
    const out = attachEnvelopes(scene, new Map([['d1', '$0']]), () => null)
    expect('envelope' in out.lanes[0]).toBe(false)
  })

  it('returns the same scene when nothing changes', () => {
    const scene = sceneOf([lane('d1', synth)])
    expect(attachEnvelopes(scene, new Map([['d1', '$0']]), () => null)).toBe(scene)
    expect(attachEnvelopes(scene, undefined, () => swell())).toBe(scene)
  })
})

describe('drawTimeline — a collapsed synth lane draws its envelope INSIDE its bars (#1731, #1740)', () => {
  // 100 px per cycle.
  const transform: DrawTransform = { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }
  // 10 px per cycle: below COARSEN_PX, so the lane draws density, not bars.
  const zoomedOut: DrawTransform = { scrollLeft: 0, contentWidth: 40, viewportWidth: 400, meter: DEFAULT_METER }

  /** Envelope columns: 1 px wide, in the lane colour (or the stale caption
   *  colour). Bars are 50+ px; an expanded lane's beat gridlines are 1 px too,
   *  in the gridline colour. */
  const columns = (rects: Rect[]) => rects.filter((r) => r.w === 1 && (r.style === '#0af' || r.style === theme.clipCaption))
  const inX = (rects: Rect[], x0: number, x1: number) => rects.filter((r) => r.x >= x0 && r.x < x1)
  /** A one-cycle bar: the 100 px slot less the gap before the next mark (#2157). */
  const BAR_W = 100 - MARK_GAP_PX
  /** The bar drawn for a note starting at `x` (lane colour, full width). */
  const barAt = (rects: Rect[], x: number, w: number) => rects.find((r) => r.x === x && r.w === w && r.style === '#0af')!

  /** Loud (±v) across `from..to` of 8 columns over 4 cycles, silent elsewhere. */
  function loud(from: number, to: number, v = 0.2, stale = false): LaneEnvelope {
    const data = new Float32Array(16)
    for (let c = from; c < to; c++) {
      data[2 * c] = -v
      data[2 * c + 1] = v
    }
    return { data, columns: 8, cycles: 4, stale }
  }

  /** A low note in cycle 0 and a high note in cycle 1 — two bars at two heights. */
  const lowHigh: SceneNote[] = [
    { cycle: 0, end: 1, pitch: 36, gain: 1, voice: 'sawtooth' },
    { cycle: 1, end: 2, pitch: 60, gain: 1, voice: 'sawtooth' },
  ]
  const pitched = (notes: SceneNote[], envelope: LaneEnvelope) =>
    sceneOf([lane('d1', notes, { envelope, pitchMin: 36, pitchMax: 60 })])

  it('draws each moment inside the bar sounding then, centred on THAT bar', () => {
    const scene = pitched(lowHigh, loud(0, 4))
    const layout = computeLaneLayout(scene.lanes, new Set(), 48, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const low = barAt(rects, 0, BAR_W)
    const high = barAt(rects, 100, BAR_W)
    expect(low.y).toBeGreaterThan(high.y) // PRECONDITION: two heights
    for (const [bar, x0] of [[low, 0], [high, 100]] as const) {
      const cols = inX(columns(rects), x0, x0 + bar.w)
      expect(cols).toHaveLength(bar.w)
      for (const c of cols) {
        expect(c.y).toBeGreaterThanOrEqual(bar.y - 1e-6)
        expect(c.y + c.h).toBeLessThanOrEqual(bar.y + bar.h + 1e-6)
        expect(c.y + c.h / 2).toBeCloseTo(bar.y + bar.h / 2, 5)
      }
    }
  })

  it('the track\'s loud level fills the bar, not the row', () => {
    const scene = pitched(lowHigh, loud(0, 4))
    const layout = computeLaneLayout(scene.lanes, new Set(), 48, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const bar = barAt(rects, 0, BAR_W)
    expect(bar.h).toBeLessThan(layout.boxes[0].height - 6)
    expect(inX(columns(rects), 0, 100)[0].h).toBeCloseTo(bar.h, 5)
  })

  it('an onset click does not set the scale: the held level fills the bar', () => {
    const data = new Float32Array(200)
    for (let c = 0; c < 100; c++) {
      const v = c % 25 === 0 ? 1 : 0.25
      data[2 * c] = -v
      data[2 * c + 1] = v
    }
    const notes: SceneNote[] = [0, 1, 2, 3].map((c) => ({ cycle: c, end: c + 1, pitch: 48, gain: 1, voice: 'sawtooth' }))
    const scene = sceneOf([lane('d1', notes, { envelope: { data, columns: 100, cycles: 4, stale: false } })])
    const layout = computeLaneLayout(scene.lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const held = inX(columns(rects), 50, 51) // mid-note: column 12
    expect(held).toHaveLength(1)
    expect(held[0].h).toBeCloseTo(barAt(rects, 0, BAR_W).h, 5)
  })

  it('draws over its bar, on a recessed bed, so the bar does not hide it', () => {
    const scene = pitched(lowHigh, loud(0, 4))
    const layout = computeLaneLayout(scene.lanes, new Set(), 48, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const bar = rects.findIndex((r) => r.x === 0 && r.w === BAR_W && r.style === '#0af')
    const bed = rects.findIndex((r, i) => i > bar && r.x === 0 && r.w === BAR_W && r.style === theme.background)
    const firstColumn = rects.findIndex((r) => r.w === 1 && r.x === 0 && r.style === '#0af')
    expect(bed).toBeGreaterThan(bar)
    expect(firstColumn).toBeGreaterThan(bed)
    expect(rects[firstColumn].alpha).toBe(1)
    expect(rects[firstColumn].style).toBe('#0af')
  })

  it('a chord: every bar sounding at a moment carries that moment', () => {
    const chord: SceneNote[] = [
      { cycle: 0, end: 1, pitch: 36, gain: 1, voice: 'triangle' },
      { cycle: 0, end: 1, pitch: 60, gain: 1, voice: 'triangle' },
    ]
    const scene = pitched(chord, loud(0, 2))
    const layout = computeLaneLayout(scene.lanes, new Set(), 48, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const atX = inX(columns(rects), 40, 41)
    expect(atX).toHaveLength(2)
    expect(new Set(atX.map((c) => c.y + c.h / 2)).size).toBe(2)
  })

  it('a release tail continues at its bar\'s height, fainter, until the sound stops', () => {
    // Note 0..0.5 (x 0..50); sound through column 1 (x 0..100), silent after.
    const notes: SceneNote[] = [{ cycle: 0, end: 0.5, pitch: 48, gain: 1, voice: 'sawtooth' }]
    const scene = sceneOf([lane('d1', notes, { envelope: loud(0, 2) })])
    const layout = computeLaneLayout(scene.lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const bar = barAt(rects, 0, 50 - MARK_GAP_PX)
    // From the bar's end through x 99, then silence. With no bar after it, the
    // tail runs through the gap: the sound is still there.
    const tail = inX(columns(rects), bar.w, 400)
    expect(tail).toHaveLength(100 - bar.w)
    for (const c of tail) {
      expect(c.alpha).toBeCloseTo(ENVELOPE_ALPHA, 9)
      expect(c.y + c.h / 2).toBeCloseTo(bar.y + bar.h / 2, 5)
    }
  })

  it('a tail stops where the next bar starts', () => {
    const notes: SceneNote[] = [
      { cycle: 0, end: 0.5, pitch: 48, gain: 1, voice: 'sawtooth' },
      { cycle: 1, end: 2, pitch: 48, gain: 1, voice: 'sawtooth' },
    ]
    const scene = sceneOf([lane('d1', notes, { envelope: loud(0, 8) })])
    const layout = computeLaneLayout(scene.lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const faint = columns(rects).filter((c) => Math.abs(c.alpha - ENVELOPE_ALPHA) < 1e-9)
    expect(Math.min(...faint.map((c) => c.x))).toBe(50 - MARK_GAP_PX)
    expect(faint.filter((c) => c.x < 200 - MARK_GAP_PX).every((c) => c.x < 100)).toBe(true)
    // …and stops short of the gap before it, which would otherwise fill back in
    // and join the two bars (#2157).
    expect(columns(rects).some((c) => c.x === 100 - MARK_GAP_PX)).toBe(false)
  })

  it('a stale envelope draws in the muted caption colour', () => {
    const scene = pitched(lowHigh, loud(0, 4, 0.2, true))
    const layout = computeLaneLayout(scene.lanes, new Set(), 48, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const cols = inX(columns(rects), 0, 200)
    expect(cols).toHaveLength(200 - MARK_GAP_PX) // all but the gap between the two bars (#2157)
    expect(cols.every((r) => r.style === theme.clipCaption)).toBe(true)
  })

  it('zoomed out to density there are no bars to follow: the row carries it, as before', () => {
    const scene = sceneOf([lane('d1', synth, { envelope: loud(4, 8) })])
    const layout = computeLaneLayout(scene.lanes, new Set(), 60, 88)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, zoomedOut, theme, layout)
    const cols = columns(rects).filter((r) => Math.abs(r.alpha - ENVELOPE_ALPHA) < 1e-9)
    expect(cols.length).toBe(20) // x 20..39: the loud half at 10 px per cycle
    expect(cols[0].h).toBeCloseTo(layout.boxes[0].height - 2 * 3, 5)
  })

  it('an EXPANDED lane draws it inside its bars too, each at its own pitch height (#1745)', () => {
    const scene = sceneOf([lane('d1', lowHigh, {
      envelope: loud(0, 4),
      pitchMin: 36,
      pitchMax: 60,
      voices: [{ key: 'sawtooth', label: 'sawtooth', melodic: true, pitchMin: 36, pitchMax: 60 }],
    })])
    const layout = computeLaneLayout(scene.lanes, new Set(['d1']), 25, 88, 40)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const low = barAt(rects, 0, BAR_W)
    const high = barAt(rects, 100, BAR_W)
    expect(low.h).toBe(24) // PRECONDITION: the sub-row bar (#1744), room for a shape
    expect(low.y).toBeGreaterThan(high.y)
    for (const [bar, x0] of [[low, 0], [high, 100]] as const) {
      const cols = inX(columns(rects), x0, x0 + bar.w)
      expect(cols).toHaveLength(bar.w)
      for (const c of cols) expect(c.y + c.h / 2).toBeCloseTo(bar.y + bar.h / 2, 5)
    }
  })

  it('an expanded lane with several synth voices carries the shape in each voice row', () => {
    const notes: SceneNote[] = [
      { cycle: 0, end: 1, pitch: 48, gain: 1, voice: 'sawtooth' },
      { cycle: 0, end: 1, pitch: 60, gain: 1, voice: 'square' },
    ]
    const scene = sceneOf([lane('d1', notes, {
      envelope: loud(0, 2),
      pitchMin: 48,
      pitchMax: 60,
      voices: [
        { key: 'sawtooth', label: 'sawtooth', melodic: true, pitchMin: 48, pitchMax: 48 },
        { key: 'square', label: 'square', melodic: true, pitchMin: 60, pitchMax: 60 },
      ],
    })])
    const layout = computeLaneLayout(scene.lanes, new Set(['d1']), 25, 88, 40)
    expect(layout.boxes[0].subRows).toHaveLength(2) // PRECONDITION: two voice rows
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    const atX = inX(columns(rects), 40, 41)
    expect(atX).toHaveLength(2)
    const rows = layout.boxes[0].subRows!
    const centres = atX.map((c) => c.y + c.h / 2).sort((a, b) => a - b)
    expect(centres[0]).toBeGreaterThan(rows[0].top)
    expect(centres[0]).toBeLessThan(rows[0].top + rows[0].height)
    expect(centres[1]).toBeGreaterThan(rows[1].top)
    expect(centres[1]).toBeLessThan(rows[1].top + rows[1].height)
  })

  it('an expanded lane set to Bars draws no shape, even with a render attached', () => {
    const scene = sceneOf([lane('d1', lowHigh, { envelope: loud(0, 4), pitchMin: 36, pitchMax: 60, bars: true })])
    const layout = computeLaneLayout(scene.lanes, new Set(['d1']), 25, 88, 40)
    const { ctx, rects } = mockCtx()
    drawTimeline(ctx, scene, transform, theme, layout)
    expect(columns(rects)).toHaveLength(0)
  })
})

describe('lanesInView — which lanes show in the grid (#1760)', () => {
  const layout = computeLaneLayout(
    ['a', 'b', 'c', 'd'].map((laneKey) => ({ laneKey })),
    new Set(),
    20,
    60,
  )

  it('names every lane any part of which is inside the visible band', () => {
    expect(lanesInView(layout, 0, 40)).toEqual(['a', 'b'])
    expect(lanesInView(layout, 30, 20)).toEqual(['b', 'c']) // b's lower half, c's upper half
    expect(lanesInView(layout, 40, 1000)).toEqual(['c', 'd'])
  })

  it('a lane whose edge only touches the band is not in view, and an unmeasured grid shows none', () => {
    expect(lanesInView(layout, 20, 20)).toEqual(['b'])
    expect(lanesInView(layout, 0, 0)).toEqual([])
  })
})
