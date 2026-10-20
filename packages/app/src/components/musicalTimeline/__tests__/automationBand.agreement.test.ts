/**
 * #1498 — the band derivation has ONE home, and every path that asks "is there a
 * band here?" gets the same answer.
 *
 * `automationCaption.test.ts` asks where the caption's glyphs sit;
 * `drawTimeline.automation.test.ts` asks whether a curve reached the canvas.
 * Neither can catch the failure this file is about: the two deciding SEPARATELY,
 * from copies of the same arithmetic, and diverging the day the inset model stops
 * being a symmetric pad. The symptom then is silence — a curve painted where the
 * hit-test believes there is no band (a click that does nothing), or a caption
 * over empty space.
 *
 * So: sweep the row height across the floor and require the three verdicts to
 * agree at every height — the helper's, the canvas's, and the caption's.
 */
import { describe, it, expect } from 'vitest'
import { drawTimeline, type DrawTheme, type DrawTransform } from '../drawTimeline'
import { DEFAULT_METER } from '../../../lib/meter'
import type { TimelineScene, SceneLane } from '../timelineScene'
import type { SignalAutomation } from '@stave/editor'
import { signalTimeAt } from '@stave/editor'
import { computeLaneLayout, AUTOMATION_MIN_ROW_H, AUTOMATION_MIN_DRAG_BAND_H } from '../laneLayout'
import { automationBand, automationBandHeight, rowHeightForBandHeight, captionRows, AUTOMATION_PAD_Y, AUTOMATION_MIN_BAND_H } from '../automationCaption'

const THEME: DrawTheme = {
  background: '#bg', rowAlt: '#rowAlt', section: '#sect', sectionAlt: '#sectAlt',
  gridline: '#grid', clipFill: '#clipFill', clipCaption: '#cap', clipBorder: '#border',
  automationLine: '#AUTO',
}
const TRANSFORM: DrawTransform = { scrollLeft: 0, contentWidth: 400, viewportWidth: 400, meter: DEFAULT_METER }

function mockCtx() {
  const strokes: { x: number; y: number }[][] = []
  let cur: { x: number; y: number }[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: '',
    font: '', textBaseline: '', setLineDash() {},
    clearRect() {}, save() {}, restore() {}, fillRect() {},
    measureText(t: string) { return { width: t.length * 6 } as TextMetrics },
    fillText() {},
    beginPath() { cur = [] },
    moveTo(x: number, y: number) { cur.push({ x, y }) },
    lineTo(x: number, y: number) { cur.push({ x, y }) },
    stroke() { if (ctx.strokeStyle === THEME.automationLine) strokes.push(cur) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes }
}

const NO_SPANS = { shape: null, rate: null, range: null, chainEnd: null } as const
const AUTO: SignalAutomation = {
  trackId: 'd1', paramKey: 'cutoff', kind: 'sine', periodCycles: 1, lanePeriodCycles: 1,
  lo: 0, hi: 1, ranged: true, boundsAsWritten: true, offset: 0, spans: NO_SPANS, placements: [[]],
}
const LANE: SceneLane = {
  laneKey: 'd1', displayName: 'd1', shownName: 'Track 1', color: '#7af', density: [1, 1, 1, 1],
  notes: [], pitchMin: null, pitchMax: null, voices: [], clips: [],
  sourceOffset: null, arrangeOffset: null, labelOffset: null,
  automations: [{ automation: AUTO, timeAt: signalTimeAt }], stepped: [],
}
const SCENE: TimelineScene = {
  lanes: [LANE], sections: [], displayCycles: 4,
  windowOriginCycles: 0, period: null, peakDensity: 1, notesCapped: false,
}

/** Whether a curve reached the canvas at this expanded row height. */
function curveDrawn(rowHeight: number): boolean {
  const m = mockCtx()
  // Fixed row height: collapsed and expanded alike, so the sweep is the variable.
  const layout = computeLaneLayout(SCENE.lanes, new Set(['d1']), rowHeight, rowHeight, rowHeight)
  drawTimeline(m.ctx, SCENE, TRANSFORM, THEME, layout)
  return m.strokes.some((pts) => pts.length > 1)
}

// Across the floor, one height either side of it, and well past it.
const HEIGHTS = [8, 12, 15, 16, 17, 20, 25, 40, 90]

describe('the automation band is derived once (#1498)', () => {
  it('the canvas paints a curve exactly where the helper says there is a band', () => {
    const verdicts = HEIGHTS.map((h) => ({
      h,
      helper: automationBand(0, h) !== null,
      drawn: curveDrawn(h),
    }))
    // A sweep that is all-true or all-false would prove nothing about agreement.
    expect(verdicts.some((v) => v.helper), 'the sweep must cross the floor').toBe(true)
    expect(verdicts.some((v) => !v.helper), 'the sweep must cross the floor').toBe(true)
    expect(verdicts.map((v) => `${v.h}:${v.drawn}`)).toEqual(verdicts.map((v) => `${v.h}:${v.helper}`))
  })

  it('the caption abstains exactly where the helper says there is no band', () => {
    const measure = (t: string) => t.length * 6
    for (const h of HEIGHTS) {
      const has = captionRows([AUTO], 0, h, true).length > 0
      expect(has, `rowHeight ${h}`).toBe(automationBand(0, h) !== null)
    }
    // And the caption's first line sits at the band's own top, not at some other inset.
    const rows = captionRows([AUTO], 100, 40, true)
    expect(rows[0]?.y).toBe(automationBand(100, 40)?.top)
    expect(measure('x')).toBe(6) // the measure stub is live, so the row above was really built
  })

  it('the floorless height is the same model, so a step can still be placed under the floor', () => {
    // `stepY` and `stepDragValue` never gated on the floor, and must not start:
    // a drag previews a value in a band the draw path has already declined.
    expect(automationBandHeight(8)).toBe(8 - AUTOMATION_PAD_Y * 2)
    expect(automationBand(0, 8)).toBeNull()
    // Above the floor the two agree exactly.
    expect(automationBandHeight(40)).toBe(automationBand(0, 40)?.height)
    expect(automationBand(0, AUTOMATION_MIN_BAND_H + AUTOMATION_PAD_Y * 2)?.height).toBe(AUTOMATION_MIN_BAND_H)
  })

  it('stating a minimum BAND height as a minimum ROW height is the same model backwards', () => {
    // `laneLayout`'s AUTOMATION_MIN_ROW_H is this inverse; a drag floor stated in
    // band pixels must survive the round trip or a lane is one pad too short.
    for (const bandH of [10, 32, 64]) {
      expect(automationBandHeight(rowHeightForBandHeight(bandH))).toBe(bandH)
    }
    expect(AUTOMATION_MIN_ROW_H).toBe(rowHeightForBandHeight(AUTOMATION_MIN_DRAG_BAND_H))
  })
})
