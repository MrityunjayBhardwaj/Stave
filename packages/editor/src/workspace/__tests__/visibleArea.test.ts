/**
 * How much of a phone's screen is showing, and is the keyboard up (#2004)?
 *
 * The browser is stood in for: is the main pointer a finger, how big is the screen, how
 * tall is the window, and what does the visual viewport say. The browser spec
 * (`touch-keyboard.spec.ts`) shows the app following it; this pins the reading itself.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  KEYBOARD_ATTR,
  KEYBOARD_MIN_PX,
  VISIBLE_HEIGHT_VAR,
  VISIBLE_TOP_VAR,
  __resetVisibleAreaForTests,
  getVisibleArea,
  readVisibleArea,
  startVisibleArea,
  subscribeToVisibleArea,
} from '../visibleArea'

interface FakeViewport {
  height: number
  scale: number
  offsetTop: number
  fire(type: 'resize' | 'scroll'): void
}

/** a browser with this pointer, this screen, this window height and this visual viewport */
function browser(coarse: boolean, screen: { width: number; height: number }, innerHeight: number): FakeViewport {
  window.matchMedia = (() => ({
    matches: coarse,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  Object.defineProperty(window, 'screen', { configurable: true, value: screen })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: screen.width })
  const listeners: Record<string, Set<() => void>> = { resize: new Set(), scroll: new Set() }
  const vv: FakeViewport & { addEventListener: (t: string, fn: () => void) => void; removeEventListener: (t: string, fn: () => void) => void } = {
    height: innerHeight,
    scale: 1,
    offsetTop: 0,
    addEventListener: (t, fn) => void listeners[t]?.add(fn),
    removeEventListener: (t, fn) => void listeners[t]?.delete(fn),
    fire: (type) => [...listeners[type]].forEach((fn) => fn()),
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  return vv
}

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 712, height: 1138 }
const root = (): HTMLElement => document.documentElement

const originals = {
  matchMedia: window.matchMedia,
  screen: Object.getOwnPropertyDescriptor(window, 'screen'),
  innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
  innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth'),
  visualViewport: Object.getOwnPropertyDescriptor(window, 'visualViewport'),
}

beforeEach(() => {
  __resetVisibleAreaForTests()
  root().removeAttribute(KEYBOARD_ATTR)
  root().style.removeProperty(VISIBLE_HEIGHT_VAR)
  root().style.removeProperty(VISIBLE_TOP_VAR)
})
afterEach(() => {
  __resetVisibleAreaForTests()
  window.matchMedia = originals.matchMedia
  for (const key of ['screen', 'innerHeight', 'innerWidth', 'visualViewport'] as const) {
    const d = originals[key]
    if (d) Object.defineProperty(window, key, d)
    else delete (window as unknown as Record<string, unknown>)[key]
  }
})

describe('reading the visible area (#2004)', () => {
  it('a phone whose visual viewport is as tall as its window has no keyboard up', () => {
    browser(true, PHONE, 664)
    expect(readVisibleArea()).toEqual({ keyboardUp: false, height: null, top: 0 })
  })

  it('a phone whose visual viewport is 300 px shorter has the keyboard up, and that much is showing', () => {
    const vv = browser(true, PHONE, 664)
    vv.height = 364
    expect(readVisibleArea()).toEqual({ keyboardUp: true, height: 364, top: 0 })
  })

  it('a gap smaller than a keyboard is a browser bar, not a keyboard', () => {
    const vv = browser(true, PHONE, 664)
    vv.height = 664 - (KEYBOARD_MIN_PX - 1)
    expect(readVisibleArea().keyboardUp).toBe(false)
    vv.height = 664 - KEYBOARD_MIN_PX
    expect(readVisibleArea().keyboardUp).toBe(true)
  })

  it('a page the browser slid up under the keyboard reports how far', () => {
    const vv = browser(true, PHONE, 664)
    vv.height = 364
    vv.offsetTop = 120
    expect(readVisibleArea()).toEqual({ keyboardUp: true, height: 364, top: 120 })
  })

  it('a pinch-zoomed page is not a keyboard: the same screen is showing', () => {
    const vv = browser(true, PHONE, 664)
    // zoomed in twice: the visual viewport is half as many page pixels tall
    vv.scale = 2
    vv.height = 332
    vv.offsetTop = 90
    expect(readVisibleArea().keyboardUp).toBe(false)
    // zoomed AND the keyboard up: the height is in screen terms, and the pan is not the keyboard's push
    vv.height = 182
    expect(readVisibleArea()).toEqual({ keyboardUp: true, height: 364, top: 0 })
  })

  it('a tablet and a desktop are never read as having a keyboard up', () => {
    const tablet = browser(true, TABLET, 1000)
    tablet.height = 600
    expect(readVisibleArea().keyboardUp).toBe(false)
    const desktop = browser(false, { width: 1440, height: 900 }, 800)
    desktop.height = 400
    expect(readVisibleArea().keyboardUp).toBe(false)
  })
})

describe('following the keyboard (#2004)', () => {
  it('writes the height, the push and the attribute while it is up, and takes all three away when it goes', () => {
    const vv = browser(true, PHONE, 664)
    const calls: boolean[] = []
    subscribeToVisibleArea(() => calls.push(getVisibleArea().keyboardUp))
    expect(root().hasAttribute(KEYBOARD_ATTR)).toBe(false)

    vv.height = 364
    vv.fire('resize')
    expect(root().style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('364px')
    expect(root().style.getPropertyValue(VISIBLE_TOP_VAR)).toBe('0px')
    expect(root().hasAttribute(KEYBOARD_ATTR)).toBe(true)

    vv.offsetTop = 80
    vv.fire('scroll')
    expect(root().style.getPropertyValue(VISIBLE_TOP_VAR)).toBe('80px')

    vv.height = 664
    vv.offsetTop = 0
    vv.fire('resize')
    expect(root().style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('')
    expect(root().style.getPropertyValue(VISIBLE_TOP_VAR)).toBe('')
    expect(root().hasAttribute(KEYBOARD_ATTR)).toBe(false)
    // told once per change, and not for an event that changed nothing
    vv.fire('resize')
    expect(calls).toEqual([true, true, false])
  })

  it('starting twice listens once', () => {
    const vv = browser(true, PHONE, 664)
    startVisibleArea()
    startVisibleArea()
    let told = 0
    subscribeToVisibleArea(() => told++)
    vv.height = 364
    vv.fire('resize')
    expect(told).toBe(1)
  })
})
