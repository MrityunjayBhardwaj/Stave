/**
 * knobScale (#1581) — the one map between a value and its place on a dial, and
 * the mixer knob reading it.
 *
 * ⚠ EVERY EXPECTATION HERE IS A LITERAL. Computing one through `positionOfValue`
 * or `valueAtPosition` would make the arm move with the rule it is supposed to
 * pin: change the log map and a computed expectation changes with it, so the
 * test stays green while the two surfaces drift. The numbers below were worked
 * out by hand — `20 * sqrt(1000)` is `632.45…`, which on a 1 Hz grid is `632`.
 *
 * The lane's half of the pair lives in the app package
 * (`musicalTimeline/__tests__/steppedLane.test.ts`); together they are the break
 * test the refactor owes: change one rule here and an arm reddens on BOTH
 * surfaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Knob } from '../Knob'
import type { KnobRange } from '../knobRanges'
import { positionOfValue, snapToStep, valueAtPosition } from '../knobScale'

afterEach(() => cleanup())

const GAIN: KnobRange = { min: 0, max: 1, step: 0.01, scale: 'linear' }
const CUTOFF: KnobRange = { min: 20, max: 20000, step: 1, scale: 'log' }
/** A quantum that is NOT a power of ten, where landing on the grid and merely
 *  cutting the decimals are different answers (`resonance`, from the range table). */
const RESONANCE: KnobRange = { min: 0, max: 40, step: 0.5, scale: 'linear' }

describe('positionOfValue', () => {
  it('spreads a linear range evenly', () => {
    expect(positionOfValue(0.25, 0, 1, 'linear')).toBe(0.25)
    expect(positionOfValue(-1, -2, 2, 'linear')).toBe(0.25)
  })

  it('puts each decade the same distance apart on a log range', () => {
    expect(positionOfValue(20, 20, 20000, 'log')).toBe(0)
    expect(positionOfValue(200, 20, 20000, 'log')).toBeCloseTo(1 / 3, 10)
    expect(positionOfValue(2000, 20, 20000, 'log')).toBeCloseTo(2 / 3, 10)
    expect(positionOfValue(20000, 20, 20000, 'log')).toBe(1)
  })

  it('clamps: a value off the ends has no place on the dial but the ends', () => {
    expect(positionOfValue(-1, 0, 1, 'linear')).toBe(0)
    expect(positionOfValue(1.4, 0, 1, 'linear')).toBe(1)
  })

  it('falls back to linear where a log map has no floor to measure from', () => {
    // A frequency control a document set to 0 widens its range down to 0.
    expect(positionOfValue(10000, 0, 20000, 'log')).toBe(0.5)
    expect(positionOfValue(0, 20, 20000, 'log')).toBe(0)
  })

  it('answers 0 for a span that is not positive, or a value that is not a number', () => {
    expect(positionOfValue(5, 5, 5, 'linear')).toBe(0)
    expect(positionOfValue(Number.NaN, 0, 1, 'linear')).toBe(0)
  })
})

describe('valueAtPosition', () => {
  it('is positionOfValue run backwards, on both scales', () => {
    for (const v of [0, 0.25, 0.5, 0.8, 1]) {
      expect(valueAtPosition(positionOfValue(v, 0, 1, 'linear'), 0, 1, 'linear')).toBeCloseTo(v, 10)
    }
    for (const v of [20, 200, 2000, 20000]) {
      expect(valueAtPosition(positionOfValue(v, 20, 20000, 'log'), 20, 20000, 'log')).toBeCloseTo(v, 6)
    }
  })

  it('reads the log halfway point as the geometric middle, not the arithmetic one', () => {
    expect(valueAtPosition(0.5, 20, 20000, 'log')).toBeCloseTo(632.4555, 3)
  })

  it('clamps its position and treats a non-number as the floor', () => {
    expect(valueAtPosition(-1, 0, 1, 'linear')).toBe(0)
    expect(valueAtPosition(2, 0, 1, 'linear')).toBe(1)
    expect(valueAtPosition(Number.NaN, 20, 20000, 'log')).toBe(20)
  })
})

describe('snapToStep', () => {
  it('lands on the grid and spells it without float noise', () => {
    expect(snapToStep(0.30000000000000004, 0.01)).toBe(0.3)
    expect(snapToStep(0.4312, 0.01)).toBe(0.43)
    expect(snapToStep(632.4555, 1)).toBe(632)
    expect(snapToStep(3.7, 0.5)).toBe(3.5)
  })

  it('passes a value through where there is no grid', () => {
    expect(snapToStep(0.4312, 0)).toBe(0.4312)
    expect(snapToStep(Number.NaN, 0.01)).toBeNaN()
  })
})

describe('Knob — the dial reads the shared map (#1581)', () => {
  // ⚠ Built as MouseEvents on purpose. jsdom has no `PointerEvent`, so
  // `fireEvent.pointerDown(el, { clientY })` dispatches a bare `Event` and the
  // coordinate is silently DROPPED (measured here: both a native listener and a
  // React handler read `undefined`). The drag then reads `undefined`, every
  // arithmetic step is NaN, and the dial reports its floor — a failure that
  // looks exactly like a broken map, so the arm would accuse the code under
  // test. The app's timeline arms meet the same wall and answer it the other
  // way, with a `PointerEvent extends MouseEvent` shim at the top of
  // `FullSongTimeline.test.tsx`; either works, and a knob drag needs one.
  const drag = (fromY: number, toY: number): void => {
    const dial = screen.getByRole('slider')
    fireEvent(dial, new MouseEvent('pointerdown', { bubbles: true, clientY: fromY }))
    fireEvent(dial, new MouseEvent('pointermove', { bubbles: true, clientY: toY }))
    fireEvent(dial, new MouseEvent('pointerup', { bubbles: true, clientY: toY }))
  }

  it('a linear drag of half the sweep moves half the range', () => {
    const onChange = vi.fn()
    render(<Knob label="gain" value={0.5} range={GAIN} onChange={onChange} />)
    // 160px sweeps the whole range; 16px up is a tenth of it.
    drag(100, 84)
    expect(onChange).toHaveBeenCalledWith(0.6)
  })

  it('a log drag of half the sweep from the floor lands on the geometric middle', () => {
    const onChange = vi.fn()
    render(<Knob label="cutoff" value={20} range={CUTOFF} onChange={onChange} />)
    drag(100, 20) // 80px up = half the sweep
    expect(onChange).toHaveBeenCalledWith(632)
  })

  it('an arrow nudge from an off-grid value lands ON the grid (#1581 behaviour change)', () => {
    // 3.2 is off the 0.5 grid — a number the document, not the dial, wrote. Up
    // used to land on 3.7 (the decimals cut, the grid ignored); it now lands on
    // 3.5. Still upward: rounding to nearest moves a value by at most half a
    // step, so a nudge can never reverse the direction pressed.
    const onChange = vi.fn()
    render(<Knob label="resonance" value={3.2} range={RESONANCE} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(3.5)
  })

  it('an arrow nudge from a value already on the grid moves exactly one step', () => {
    const onChange = vi.fn()
    render(<Knob label="gain" value={0.43} range={GAIN} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(0.44)
  })

  it('a value past the end of its range anchors the drag where the dial draws it', () => {
    const onChange = vi.fn()
    render(<Knob label="gain" value={1.4} range={GAIN} onChange={onChange} />)
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1.4')
    drag(100, 116) // 16px down = a tenth of the range, from the ceiling it draws at
    expect(onChange).toHaveBeenCalledWith(0.9)
  })
})
