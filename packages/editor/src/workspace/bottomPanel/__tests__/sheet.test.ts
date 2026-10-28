/**
 * The sheet's arithmetic (#2002): how tall it is at each stop, and where a pull leaves
 * it (#2260). The browser spec (`touch-panel-sheet.spec.ts`) shows the sheet on a phone; these
 * pin the numbers it is drawn from, including the screens the spec has no device for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sheetHeights, sheetRestAfterPull } from '../BottomPanel'
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

describe('sheetRestAfterPull (#2260)', () => {
  // a Pixel 7 held upright: 915 px screen, so a fifth of it is 183 px
  const heights = sheetHeights({ height: 791, top: 82 }) // closed 49, half 396, full 709
  const screen = 915

  it('let go in the middle, the sheet stays where it was let go', () => {
    expect(sheetRestAfterPull(500, heights, screen)).toBe(500)
    expect(sheetRestAfterPull(300.4, heights, screen)).toBe(300)
    // half is not a stop a pull falls into: near it is just where it was let go
    expect(sheetRestAfterPull(410, heights, screen)).toBe(410)
  })

  it('within a fifth of the screen of the strip, it closes; one pixel more and it stays', () => {
    expect(sheetRestAfterPull(49 + 183, heights, screen)).toBe('closed')
    expect(sheetRestAfterPull(49, heights, screen)).toBe('closed')
    expect(sheetRestAfterPull(49 + 184, heights, screen)).toBe(233)
  })

  it('within a fifth of the screen of full, it goes full; one pixel less and it stays', () => {
    expect(sheetRestAfterPull(709 - 183, heights, screen)).toBe('full')
    expect(sheetRestAfterPull(709, heights, screen)).toBe('full')
    expect(sheetRestAfterPull(709 - 184, heights, screen)).toBe(525)
  })

  it('the zone is a fifth of the SCREEN, not of the room the sheet has', () => {
    // the same room on a taller screen has wider zones
    expect(sheetRestAfterPull(260, heights, 1100)).toBe('closed') // 1100 / 5 = 220 ≥ 211
    expect(sheetRestAfterPull(260, heights, screen)).toBe(260)
  })

  it('on a screen so short the zones overlap, the nearer end wins', () => {
    const short = sheetHeights({ height: 300, top: 82 }) // closed 49, full 218
    // a 600 px screen: zones of 120, and only 169 px between the ends, so both points are in both
    expect(sheetRestAfterPull(100, short, 600)).toBe('closed') // 51 from closed, 118 from full
    expect(sheetRestAfterPull(160, short, 600)).toBe('full') // 111 from closed, 58 from full
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
