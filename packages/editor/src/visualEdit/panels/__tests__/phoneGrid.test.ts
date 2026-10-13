/**
 * Which part of a grid is on screen (#2006): the numbers the in-view bar is drawn from.
 * The browser spec (`touch-pattern-steps.spec.ts`) shows the bar following a drag.
 */
import { describe, expect, it } from 'vitest'

import { gridInView, PHONE_STEP_MIN } from '../phoneGrid'

describe('gridInView', () => {
  it('everything is in view when the grid fits', () => {
    expect(gridInView(0, 800, 800)).toEqual({ start: 0, end: 1, more: false })
    expect(gridInView(0, 800, 600)).toEqual({ start: 0, end: 1, more: false })
  })

  it('a pixel of rounding is not "more"', () => {
    expect(gridInView(0, 800, 801).more).toBe(false)
    expect(gridInView(0, 800, 802).more).toBe(true)
  })

  it('reports the visible part as fractions of the whole', () => {
    // a 390 px window on an 834 px grid, at its start, middle and end
    expect(gridInView(0, 390, 834)).toEqual({ start: 0, end: 390 / 834, more: true })
    const mid = gridInView(222, 390, 834)
    expect(mid.start).toBeCloseTo(222 / 834)
    expect(mid.end).toBeCloseTo(612 / 834)
    expect(gridInView(444, 390, 834).end).toBe(1)
  })

  it('stays inside 0..1 whatever a browser reports while it bounces', () => {
    expect(gridInView(-40, 390, 834).start).toBe(0)
    const over = gridInView(500, 390, 834)
    expect(over.end).toBe(1)
    expect(over.start).toBeLessThanOrEqual(over.end)
  })

  it('a grid that has not been laid out is all in view, not divided by zero', () => {
    expect(gridInView(0, 0, 0)).toEqual({ start: 0, end: 1, more: false })
    expect(gridInView(0, 390, 0)).toEqual({ start: 0, end: 1, more: false })
  })
})

describe('the phone step floor', () => {
  it('is 40 px: what #2006 measured a finger to need', () => {
    expect(PHONE_STEP_MIN).toBe(40)
  })
})
