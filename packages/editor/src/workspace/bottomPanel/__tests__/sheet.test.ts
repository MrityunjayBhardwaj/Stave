/**
 * The sheet's arithmetic (#2002): how tall it is at each stop, and where a pull leaves
 * it. The browser spec (`touch-panel-sheet.spec.ts`) shows the sheet on a phone; these
 * pin the numbers it is drawn from, including the screens the spec has no device for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sheetHeights, sheetStopAfterPull } from '../BottomPanel'
import { phoneLayout } from '../../usePhone'

describe('sheetHeights', () => {
  it('half is half the room; full is the room under the Play bar; closed is the strip', () => {
    // a Pixel 7 held upright: 791 px under the top bar, the Play bar ending 82 px down
    expect(sheetHeights({ height: 791, top: 82 })).toEqual({ closed: 49, half: 396, full: 709 })
  })

  it('with no Play bar to stop under, full is the whole room', () => {
    expect(sheetHeights({ height: 600, top: 0 }).full).toBe(600)
  })

  it('a half sheet keeps room for its panel on a short screen, but never passes full', () => {
    // half of 300 would leave a 101 px body; the floor is 120
    expect(sheetHeights({ height: 300, top: 82 }).half).toBe(169)
    // and when even that does not fit, half is full rather than taller than it
    const tiny = sheetHeights({ height: 200, top: 82 })
    expect(tiny.half).toBe(tiny.full)
    expect(tiny.full).toBe(118)
  })

  it('full is never shorter than the strip', () => {
    expect(sheetHeights({ height: 40, top: 82 }).full).toBe(49)
  })
})

describe('sheetStopAfterPull', () => {
  it('a pull up moves one stop up; a pull down one stop down', () => {
    expect(sheetStopAfterPull('closed', 60)).toBe('half')
    expect(sheetStopAfterPull('half', 60)).toBe('full')
    expect(sheetStopAfterPull('full', -60)).toBe('half')
    expect(sheetStopAfterPull('half', -60)).toBe('closed')
  })

  it('one pull is one stop, however long', () => {
    expect(sheetStopAfterPull('closed', 900)).toBe('half')
    expect(sheetStopAfterPull('full', -900)).toBe('half')
  })

  it('there is nothing past the ends', () => {
    expect(sheetStopAfterPull('full', 200)).toBe('full')
    expect(sheetStopAfterPull('closed', -200)).toBe('closed')
  })

  it('a pull under 24 px leaves the sheet where it was; 24 px moves it', () => {
    expect(sheetStopAfterPull('half', 23)).toBe('half')
    expect(sheetStopAfterPull('half', -23)).toBe('half')
    expect(sheetStopAfterPull('half', 24)).toBe('full')
    expect(sheetStopAfterPull('half', -24)).toBe('closed')
  })
})

describe('phoneLayout — which way up', () => {
  const original = { matchMedia: window.matchMedia, screen: window.screen, innerWidth: window.innerWidth }
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original.matchMedia })
    Object.defineProperty(window, 'screen', { configurable: true, value: original.screen })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original.innerWidth })
  })

  function device(coarse: boolean, screen: { width: number; height: number }, innerWidth: number): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: coarse, addEventListener: () => undefined, removeEventListener: () => undefined })),
    })
    Object.defineProperty(window, 'screen', { configurable: true, value: screen })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth })
  }

  it('a phone whose window is as wide as its short side is upright', () => {
    device(true, { width: 412, height: 915 }, 412)
    expect(phoneLayout()).toBe('upright')
  })

  it('turned, the window is wider than the short side — whichever way the browser reports the screen', () => {
    // Android: the screen's numbers turn with the phone
    device(true, { width: 915, height: 412 }, 863)
    expect(phoneLayout()).toBe('sideways')
    // an iPhone: they do not
    device(true, { width: 390, height: 844 }, 750)
    expect(phoneLayout()).toBe('sideways')
  })

  it('a tablet, and anything with a mouse, is not a phone either way up', () => {
    device(true, { width: 712, height: 1138 }, 712)
    expect(phoneLayout()).toBe('none')
    device(false, { width: 412, height: 915 }, 412)
    expect(phoneLayout()).toBe('none')
  })
})
