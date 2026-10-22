/**
 * The geometry of a stepped automation on a lane (#1463 Stage 2).
 *
 * Fixtures here are hand-built `SteppedAutomation`s, and that is deliberate
 * rather than a shortcut: the reader that produces them is pinned against the real
 * parser AND the real engine in `@stave/editor` (steppedAutomation.test.ts,
 * steppedAutomation.engine.test.ts). This file owns only what happens after — so
 * each fixture spells exactly the fields the reader was shown to produce, and the
 * `startCycle`s are the ones the reader derives from the weights.
 */
import { describe, it, expect } from 'vitest'
import type { FixedParameter, SteppedAutomation } from '@stave/editor'
import {
  automatableFixed,
  automateStepCount,
  snapToStep,
  stepAxis,
  stepDragValue,
  stepEdit,
  stepHitAt,
  stepSegments,
  stepTravel,
  stepY,
  travelledPx,
  withFineDrag,
  unitOnAxis,
  valueAtUnit,
  withStepValue,
  FINE_DRAG_RATIO,
  STEP_HIT_TOLERANCE_PX,
  type RangeFor,
  type StepAxis,
  type StepBand,
} from '../steppedLane'
import { stepIndexAtCycle } from '@stave/editor'

describe('stepHitAt — which step a press lands on (Stage 3\'s claim)', () => {
  const LIN: StepAxis = { lo: 0, hi: 1, scale: 'linear', step: 0.01 }
  // A 96px expanded row at y=100, 3px pad → a 90px band.
  const BAND: StepBand = { top: 100, rowHeight: 96, padY: 3, minBandH: 10 }
  const mk = (steps: [number, number?][], method = 'gain') => {
    let at = 0
    const built = steps.map(([value, weight = 1]) => {
      const s = { value, weight, startCycle: at, valueSpan: { start: 0, end: 1 } }
      at += weight
      return s
    })
    return { trackId: 'd1', paramKey: method, method, steps: built, periodCycles: at, offset: 0, placements: [[]] }
  }

  it('hits the step playing at the pointer\'s cycle, on its level', () => {
    const entry = { automation: mk([[0.2], [0.8]]), axis: LIN, stepAt: stepIndexAtCycle }
    const y08 = stepY(0.8, LIN, BAND)
    const hit = stepHitAt([entry], BAND, true, 1.4, y08 + 2)
    expect(hit?.index).toBe(1)
    expect(hit?.y).toBe(y08)
  })

  it('misses a level that is not playing at that cycle, even when the y matches', () => {
    // At cycle 0 the staircase is at 0.2; pressing at 0.8's height there is empty space.
    const entry = { automation: mk([[0.2], [0.8]]), axis: LIN, stepAt: stepIndexAtCycle }
    expect(stepHitAt([entry], BAND, true, 0.5, stepY(0.8, LIN, BAND))).toBeNull()
  })

  it('maps a press inside a weighted step to that step', () => {
    const entry = { automation: mk([[0.2, 2], [0.8]]), axis: LIN, stepAt: stepIndexAtCycle }
    // Cycle 1 is still inside step 0's weight of 2.
    expect(stepHitAt([entry], BAND, true, 1.9, stepY(0.2, LIN, BAND))?.index).toBe(0)
  })

  it('stops at the tolerance, both sides of the edge', () => {
    const entry = { automation: mk([[0.5]]), axis: LIN, stepAt: stepIndexAtCycle }
    const y = stepY(0.5, LIN, BAND)
    expect(stepHitAt([entry], BAND, true, 0, y + STEP_HIT_TOLERANCE_PX)).not.toBeNull()
    expect(stepHitAt([entry], BAND, true, 0, y + STEP_HIT_TOLERANCE_PX + 0.5)).toBeNull()
  })

  it('picks the NEAREST level when two parameters share the band', () => {
    const gain = { automation: mk([[0.5]]), axis: LIN, stepAt: stepIndexAtCycle }
    const room = { automation: mk([[0.52]], 'room'), axis: LIN, stepAt: stepIndexAtCycle }
    const yRoom = stepY(0.52, LIN, BAND)
    expect(stepHitAt([gain, room], BAND, true, 0, yRoom)?.entry).toBe(room)
    expect(stepHitAt([room, gain], BAND, true, 0, yRoom)?.entry).toBe(room)
  })

  it('claims nothing on a collapsed lane, or a band too short to draw', () => {
    const entry = { automation: mk([[0.5]]), axis: LIN, stepAt: stepIndexAtCycle }
    const y = stepY(0.5, LIN, BAND)
    expect(stepHitAt([entry], BAND, false, 0, y)).toBeNull()
    expect(stepHitAt([entry], { ...BAND, rowHeight: 14 }, true, 0, stepY(0.5, LIN, { ...BAND, rowHeight: 14 }))).toBeNull()
  })
})

const SPAN = { start: 0, end: 1 }

/** `<v0@w0 v1@w1 …>` as the reader returns it. */
function stepped(steps: [value: number, weight?: number][], method = 'gain'): SteppedAutomation {
  let at = 0
  const built = steps.map(([value, weight = 1]) => {
    const s = { value, weight, startCycle: at, valueSpan: SPAN }
    at += weight
    return s
  })
  return { trackId: 'd1', paramKey: method, method, steps: built, periodCycles: at, offset: 0, placements: [[]] }
}

const seg = (a: SteppedAutomation, from: number, to: number) =>
  stepSegments(a, from, to, stepIndexAtCycle).map((s) => [s.index, s.value, s.startCycle, s.endCycle])

describe('stepSegments — one segment per step, over absolute cycles', () => {
  it('a two-step alternation is one segment per cycle', () => {
    expect(seg(stepped([[0.2], [0.8]]), 0, 4)).toEqual([
      [0, 0.2, 0, 1],
      [1, 0.8, 1, 2],
      [0, 0.2, 2, 3],
      [1, 0.8, 3, 4],
    ])
  })

  it('a weighted step is ONE segment across its weight', () => {
    expect(seg(stepped([[0.2, 2], [0.8]]), 0, 6)).toEqual([
      [0, 0.2, 0, 2],
      [1, 0.8, 2, 3],
      [0, 0.2, 3, 5],
      [1, 0.8, 5, 6],
    ])
  })

  // The arm that decides what a segment IS. Merging by value would draw the
  // same staircase and give Stage 3 index 0 for a press on step 1.
  it('two adjacent steps holding the same number stay two segments', () => {
    expect(seg(stepped([[0.5], [0.5], [0.8]]), 0, 3)).toEqual([
      [0, 0.5, 0, 1],
      [1, 0.5, 1, 2],
      [2, 0.8, 2, 3],
    ])
  })

  // Two consequences of the one rule (same step index → same segment), kept in
  // one arm so they are read together: across a wrap the steps differ, so the
  // run breaks; a single-step pattern plays index 0 every cycle, so it is one line.
  it('a step met again across the wrap starts a new segment; a single-step pattern is one line', () => {
    expect(seg(stepped([[0.2, 2], [0.8, 2]]), 0, 8).map((s) => [s[0], s[2], s[3]])).toEqual([
      [0, 0, 2],
      [1, 2, 4],
      [0, 4, 6],
      [1, 6, 8],
    ])
    expect(seg(stepped([[0.8]]), 0, 4)).toEqual([[0, 0.8, 0, 4]])
  })

  it('a paged window starts mid-song and clips to its own span', () => {
    // Cycles 5.5 … 8.25 of `<0.2@2 0.8>` (period 3): cycle 5 is step 1, 6–7 step 0, 8 step 1.
    expect(seg(stepped([[0.2, 2], [0.8]]), 5.5, 8.25)).toEqual([
      [1, 0.8, 5.5, 6],
      [0, 0.2, 6, 8],
      [1, 0.8, 8, 8.25],
    ])
  })

  it('draws nothing for an empty or inverted span', () => {
    expect(stepSegments(stepped([[0.2], [0.8]]), 3, 3, stepIndexAtCycle)).toEqual([])
    expect(stepSegments(stepped([[0.2], [0.8]]), 4, 2, stepIndexAtCycle)).toEqual([])
  })
})

describe('stepSegments and stepHitAt inside an arrangement section (#1585)', () => {
  // `<0.2 0.8>` in a 3-cycle section followed by a 1-cycle one: it plays cycles 0–2
  // and 4–6 by its OWN count, and nothing in cycles 3 and 7. The placements are the
  // reader's (`steppedAutomation.test.ts`); this file owns what the lane does with them.
  const inSection = (): SteppedAutomation => ({
    ...stepped([[0.2], [0.8]]),
    placements: [[{ startCycle: 0, cycles: 3, total: 4 }]],
  })

  it('a silent bar has no segment, and the next pass carries on from the section\'s own count', () => {
    // Cycle 4 is the section's fourth cycle: step 1, where the song's cycle says step 0.
    expect(seg(inSection(), 0, 8)).toEqual([
      [0, 0.2, 0, 1],
      [1, 0.8, 1, 2],
      [0, 0.2, 2, 3],
      [1, 0.8, 4, 5],
      [0, 0.2, 5, 6],
      [1, 0.8, 6, 7],
    ])
  })

  it('two appearances side by side holding the same step are one segment across the seam', () => {
    // `arrange([1, a], [1, a], [1, b])`: bars 0 and 1 are each appearance's first cycle.
    const twice: SteppedAutomation = {
      ...stepped([[0.2], [0.8]]),
      placements: [[{ startCycle: 0, cycles: 1, total: 3 }], [{ startCycle: 1, cycles: 1, total: 3 }]],
    }
    expect(seg(twice, 0, 6)).toEqual([
      [0, 0.2, 0, 2],
      [1, 0.8, 3, 5],
    ])
  })

  it('a press lands on the section\'s own step, and over a silent bar on nothing', () => {
    const LIN: StepAxis = { lo: 0, hi: 1, scale: 'linear', step: 0.01 }
    const BAND: StepBand = { top: 100, rowHeight: 96, padY: 3, minBandH: 10 }
    const entry = { automation: inSection(), axis: LIN, stepAt: stepIndexAtCycle }
    expect(stepHitAt([entry], BAND, true, 4.5, stepY(0.8, LIN, BAND))?.index).toBe(1)
    expect(stepHitAt([entry], BAND, true, 3.5, stepY(0.8, LIN, BAND))).toBeNull()
    expect(stepHitAt([entry], BAND, true, 3.5, stepY(0.2, LIN, BAND))).toBeNull()
  })
})

describe('stepAxis — the knob range, widened to every step', () => {
  // A stand-in with `knobRangeFor`'s contract: a known control widens only to the
  // ONE value it is handed.
  const knownGain: RangeFor = (_m, v) => ({ min: Math.min(0, v), max: Math.max(1, v), step: 0.01, scale: 'linear' })

  it('uses the control range when every step fits inside it', () => {
    expect(stepAxis(stepped([[0.2], [0.8]]), knownGain)).toEqual({ lo: 0, hi: 1, scale: 'linear', step: 0.01 })
  })

  it('widens to the LARGEST step — asking with one step would clip the rest', () => {
    // Asked only with the first step (0.2) this would be 0..1, and 1.4 would
    // draw pinned to the ceiling as if it were 1.
    expect(stepAxis(stepped([[0.2], [1.4]]), knownGain).hi).toBe(1.4)
    expect(stepAxis(stepped([[1.4], [0.2]]), knownGain).hi).toBe(1.4)
  })

  it('widens to the SMALLEST step too', () => {
    expect(stepAxis(stepped([[-0.5], [0.8]]), knownGain).lo).toBe(-0.5)
  })

  it('keeps a log axis for a frequency control, and drops it when a step is not positive', () => {
    const freq: RangeFor = (_m, v) => ({ min: Math.min(20, v), max: Math.max(20000, v), step: 1, scale: 'log' })
    expect(stepAxis(stepped([[200], [2000]], 'lpf'), freq)).toEqual({ lo: 20, hi: 20000, scale: 'log', step: 1 })
    expect(stepAxis(stepped([[0], [2000]], 'lpf'), freq).scale).toBe('linear')
  })

  it('asks with the method the user TYPED — the knob table is keyed on it', () => {
    const asked: string[] = []
    stepAxis(stepped([[200], [2000]], 'lpf'), (m, v) => (asked.push(m), { min: 0, max: v, step: 1, scale: 'linear' }))
    expect(new Set(asked)).toEqual(new Set(['lpf']))
  })

  it('takes the FINER quantum when the two askings disagree (#1578)', () => {
    // An unknown control's step is derived from the value it is asked with: 0.5
    // gets 0.01, 40 gets 1. A drag snapped to 1 could never write back the 0.5.
    const unknown: RangeFor = (_m, v) => ({ min: 0, max: Math.max(1, v * 2), step: v <= 1 ? 0.01 : 1, scale: 'linear' })
    expect(stepAxis(stepped([[0.5], [40]], 'wobble'), unknown).step).toBe(0.01)
    expect(stepAxis(stepped([[40], [0.5]], 'wobble'), unknown).step).toBe(0.01)
  })
})

describe('unitOnAxis', () => {
  it('maps linearly between the bounds and clamps outside them', () => {
    const axis = { lo: 0, hi: 1, scale: 'linear', step: 0.01 } as const
    expect(unitOnAxis(0.25, axis)).toBe(0.25)
    expect(unitOnAxis(-1, axis)).toBe(0)
    expect(unitOnAxis(2, axis)).toBe(1)
  })

  it('maps a log axis by ratio — 200 sits a third of the way from 20 to 20000', () => {
    const axis = { lo: 20, hi: 20000, scale: 'log', step: 1 } as const
    expect(unitOnAxis(200, axis)).toBeCloseTo(1 / 3, 10)
    expect(unitOnAxis(2000, axis)).toBeCloseTo(2 / 3, 10)
  })

  it('returns the floor for a degenerate axis or a non-finite value', () => {
    expect(unitOnAxis(0.5, { lo: 1, hi: 1, scale: 'linear', step: 0.01 })).toBe(0)
    expect(unitOnAxis(Number.NaN, { lo: 0, hi: 1, scale: 'linear', step: 0.01 })).toBe(0)
  })
})

describe('stepEdit — what typed text may become (Stage 3)', () => {
  const LIN: StepAxis = { lo: 0, hi: 1, scale: 'linear', step: 0.01 }
  const automation: SteppedAutomation = {
    trackId: 'd1',
    paramKey: 'gain',
    method: 'gain',
    steps: [
      { value: 0.2, weight: 1, startCycle: 0, valueSpan: { start: 10, end: 13 } },
      { value: 0.8, weight: 1, startCycle: 1, valueSpan: { start: 14, end: 17 } },
    ],
    periodCycles: 2,
    offset: 0,
    placements: [[]],
  }
  const hit = { entry: { automation, axis: LIN, stepAt: stepIndexAtCycle }, index: 1, y: 0 }
  const spy = () => {
    const calls: [SteppedAutomation, number, string][] = []
    const edit = (a: SteppedAutomation, index: number, text: string) => {
      calls.push([a, index, text])
      return { range: [0, 1] as [number, number], text: text.trim() }
    }
    return { calls, edit }
  }

  // What the text may be (empty is not zero, words are not numbers) is the
  // writer's rule now, `stepTextEdit` in the editor, tested beside it (#1918).
  it('hands the step\'s own automation, its index and the typed text to the writer', () => {
    const { calls, edit } = spy()
    expect(stepEdit(hit, ' 0.4 ', edit)).toEqual({ range: [0, 1], text: '0.4' })
    expect(calls).toEqual([[automation, 1, ' 0.4 ']])
  })

  it('passes the writer\'s refusal through rather than inventing an edit', () => {
    expect(stepEdit(hit, '0.8', () => null)).toBeNull()
  })
})

describe('the drag geometry — a level that follows the pointer (#1578)', () => {
  const LIN: StepAxis = { lo: 0, hi: 1, scale: 'linear', step: 0.01 }
  const LOG: StepAxis = { lo: 20, hi: 20000, scale: 'log', step: 1 }
  // A 96px expanded row at y=100, 3px pad → a 90px band.
  const BAND: StepBand = { top: 100, rowHeight: 96, padY: 3, minBandH: 10 }

  it('valueAtUnit is unitOnAxis backwards, on both scales', () => {
    for (const v of [0, 0.25, 0.5, 0.8, 1]) expect(valueAtUnit(unitOnAxis(v, LIN), LIN)).toBeCloseTo(v, 10)
    for (const v of [20, 200, 2000, 20000]) expect(valueAtUnit(unitOnAxis(v, LOG), LOG)).toBeCloseTo(v, 6)
    // A third of the way up a 20…20000 log axis is 200, not 6680.
    expect(valueAtUnit(1 / 3, LOG)).toBeCloseTo(200, 6)
    expect(valueAtUnit(-1, LIN)).toBe(0)
    expect(valueAtUnit(2, LIN)).toBe(1)
  })

  it('snaps to the knob\'s quantum and spells it without float noise', () => {
    // The control: the multiply alone DOES leave noise for this pair.
    expect(Math.round(0.3 / 0.1) * 0.1).not.toBe(0.3)
    expect(snapToStep(0.3, 0.1)).toBe(0.3)
    expect(snapToStep(0.4312, 0.01)).toBe(0.43)
    expect(String(snapToStep(0.43000000000000005, 0.01))).toBe('0.43')
    expect(snapToStep(1234.6, 1)).toBe(1235)
    expect(snapToStep(0.8, 0.25)).toBe(0.75)
    expect(snapToStep(0.4312, 0)).toBe(0.4312)
  })

  it('moves the value by the pointer\'s TRAVEL — no travel, no change, whatever the press height', () => {
    expect(stepDragValue(0.8, 0, LIN, BAND)).toBe(0.8)
    // Up is louder: 9px of a 90px band is a tenth of the axis.
    expect(stepDragValue(0.8, -9, LIN, BAND)).toBe(0.9)
    expect(stepDragValue(0.8, 9, LIN, BAND)).toBe(0.7)
  })

  // ── #1582: the fine drag ──────────────────────────────────────────────────
  // A SHORT band is the whole reason this exists, so these arms use one: an
  // expanded lane can be 25px when the panel has no room to grow it, and 25px
  // leaves a 19px band.
  const SHORT: StepBand = { top: 0, rowHeight: 25, padY: 3, minBandH: 10 }

  it('prices travel at a tenth while the modifier is held', () => {
    const coarse = stepTravel(100, false)
    expect(travelledPx(coarse, 110)).toBe(10)
    const fine = stepTravel(100, true)
    expect(travelledPx(fine, 110)).toBeCloseTo(1, 10)
    expect(FINE_DRAG_RATIO).toBe(0.1)
  })

  it('a modifier pressed mid-drag banks what was travelled and re-prices only what follows', () => {
    // 10px of plain travel, then the key goes down where the pointer stands.
    const before = stepTravel(100, false)
    const after = withFineDrag(before, 110, true)
    // The level must not move on the keypress itself.
    expect(travelledPx(after, 110)).toBe(travelledPx(before, 110))
    // The next 10px are worth 1.
    expect(travelledPx(after, 120)).toBeCloseTo(11, 10)
    // And releasing it banks again: the 10 after that are worth 10.
    const released = withFineDrag(after, 120, false)
    expect(travelledPx(released, 120)).toBeCloseTo(11, 10)
    expect(travelledPx(released, 130)).toBeCloseTo(21, 10)
  })

  it('returns the same travel when the mode has not changed', () => {
    const t = stepTravel(100, false)
    expect(withFineDrag(t, 150, false)).toBe(t)
  })

  it('makes 0.60 reachable from 0.9 on a 19px band, which a plain drag cannot (#1582)', () => {
    // The issue's own complaint, stated as an arm: on this band one pixel is
    // about 0.05 of gain, so the values a plain drag can produce SKIP 0.60. Both
    // sweeps below travel the same 80 screen pixels — the only difference is the
    // modifier, which is what makes this a control rather than two claims.
    const sweep = (fine: boolean): Set<number> => {
      const travel = stepTravel(0, fine)
      const out = new Set<number>()
      for (let px = 0; px <= 80; px++) out.add(stepDragValue(0.9, travelledPx(travel, px), LIN, SHORT))
      return out
    }
    const plain = sweep(false)
    const held = sweep(true)
    expect(plain.has(0.6), 'a plain drag could already land on 0.60').toBe(false)
    // The control on the control: the plain sweep DOES land either side of 0.6,
    // so its miss is the band's coarseness and not an empty sweep. These are the
    // issue's own measured neighbours — 4px gives 0.69, 5px 0.64, 6px 0.58.
    expect(plain.has(0.64) && plain.has(0.58), 'the plain sweep produced nothing near 0.6 — wrong band?').toBe(true)
    expect(held.has(0.6)).toBe(true)
    // Not merely "more values": every hundredth from 0.5 to 0.9 is now landable.
    for (let v = 50; v <= 90; v++) expect(held.has(v / 100), `missing ${v / 100}`).toBe(true)
  })

  it('the drawn level lands where the pointer went — on a log axis too', () => {
    // The pair the gesture depends on: value from travel, then the staircase's own y.
    for (const [axis, start] of [[LIN, 0.5], [LOG, 200]] as const) {
      for (const dy of [-30, -12, 15, 30]) {
        const moved = stepY(stepDragValue(start, dy, axis, BAND), axis, BAND)
        // Within the snap: 1Hz near 200Hz and 0.01 of 90px are both under a pixel.
        expect(Math.abs(moved - (stepY(start, axis, BAND) + dy)), `${axis.scale} dy=${dy}`).toBeLessThan(1)
      }
    }
  })

  it('stops at the axis — a drag cannot widen it', () => {
    expect(stepDragValue(0.8, -1000, LIN, BAND)).toBe(1)
    expect(stepDragValue(0.8, 1000, LIN, BAND)).toBe(0)
    expect(stepDragValue(200, 1000, LOG, BAND)).toBe(20)
  })

  it('previews ONE step of ONE automation, matched by identity, and keeps every axis', () => {
    const a = stepped([[0.2], [0.8]])
    const twin = stepped([[0.2], [0.8]], 'room')
    const entries = [{ automation: a, axis: LIN, stepAt: stepIndexAtCycle }, { automation: twin, axis: LOG, stepAt: stepIndexAtCycle }]
    const out = withStepValue(entries, a, 1, 0.4)
    expect(out[0].automation.steps.map((s) => s.value)).toEqual([0.2, 0.4])
    expect(out[0].axis).toBe(LIN)
    // The preview keeps the step selection too — without it the dragged staircase
    // would have no way to place its steps, and would vanish mid-drag (#1585).
    expect(out[0].stepAt).toBe(stepIndexAtCycle)
    expect(out[0].automation.placements).toBe(a.placements)
    // The document's automation is not mutated — the preview is a copy.
    expect(a.steps.map((s) => s.value)).toEqual([0.2, 0.8])
    // Equal steps on another parameter are a different automation.
    expect(out[1]).toBe(entries[1])
    // An index that does not exist changes nothing.
    expect(withStepValue(entries, a, 5, 0.4)[0]).toBe(entries[0])
  })
})

describe('automate a fixed value (#1601)', () => {
  const fixed = (method: string, sectionCycles: number | null = null): FixedParameter => ({
    trackId: 'd1',
    paramKey: method,
    method,
    value: 0.8,
    valueText: '0.8',
    argSpan: { start: 0, end: 3 },
    sectionCycles,
    offset: 0,
    placements: [[]],
  })
  // A stand-in for `hasKnownKnobRange` that ranges the tempo too, as the real table does.
  const hasRange = (m: string) => ['gain', 'lpf', 'cps', 'slow'].includes(m)

  it('offers controls with a knob range of their own — not routing, and not the tempo', () => {
    const offered = automatableFixed([fixed('gain'), fixed('orbit'), fixed('cps'), fixed('slow'), fixed('lpf')], hasRange)
    expect(offered.map((f) => f.method)).toEqual(['gain', 'lpf'])
  })

  it('writes one step per bar the lane shows, or per bar of the section', () => {
    expect(automateStepCount(fixed('gain'), 4)).toBe(4)
    expect(automateStepCount(fixed('gain'), 6)).toBe(6)
    expect(automateStepCount(fixed('gain'), 0)).toBe(1)
    // A section counts its own bars, whatever the lane's span.
    expect(automateStepCount(fixed('gain', 3), 8)).toBe(3)
  })
})
