/**
 * The Pattern tab on a PHONE shows the grid alone; a tablet and a desktop keep the
 * right column (#1990).
 *
 * The panel's children are replaced with markers: this is about which columns the
 * panel draws, not about what is in them. What the browser says about the device — is
 * the main pointer a finger, how big is the screen — is a stand-in the test can change
 * while the panel is mounted.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('../useActiveChunk', () => ({ useActiveChunk: () => ({ chunk: null }) }))
vi.mock('../../../codeView', () => ({ chunkSurface: () => null }))
vi.mock('../SequencerGrid', () => ({ SequencerGrid: () => null }))
vi.mock('../PianoRollGrid', () => ({ PianoRollGrid: () => null }))
vi.mock('../VisualEditStandby', () => ({ VisualEditStandby: () => <div data-standby /> }))
vi.mock('../../mixer/MixerPanel', () => ({ MixerPanel: () => <div data-mixer-body /> }))

import { PatternPanel } from '../PatternPanel'
import { PHONE_SHORT_SIDE_PX, TOUCH_POINTER_QUERY } from '../../../workspace/usePhone'
import { PATTERN_SIDE_DRAWER_ATTR, PATTERN_SIDE_RAIL_ATTR, PATTERN_SIDE_SCRIM_ATTR } from '../patternSide'

interface Device {
  finger(next: boolean): void
  screen(width: number, height: number): void
  asked: string[]
}

/** a browser on a device with this pointer and this screen; both can change while mounted */
function device(coarse: boolean, width: number, height: number): Device {
  let matches = coarse
  const listeners = new Set<() => void>()
  const asked: string[] = []
  const mql = {
    get matches() {
      return matches
    },
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  }
  window.matchMedia = ((q: string) => {
    asked.push(q)
    return mql
  }) as unknown as typeof window.matchMedia
  const setScreen = (w: number, h: number): void => {
    Object.defineProperty(window, 'screen', { configurable: true, value: { width: w, height: h } })
  }
  setScreen(width, height)
  return {
    asked,
    finger(next) {
      matches = next
      for (const fn of [...listeners]) fn()
    },
    screen(w, h) {
      setScreen(w, h)
      window.dispatchEvent(new Event('resize'))
    },
  }
}

const originalMatchMedia = window.matchMedia
const originalScreen = Object.getOwnPropertyDescriptor(window, 'screen')
afterEach(() => {
  cleanup()
  window.matchMedia = originalMatchMedia
  if (originalScreen) Object.defineProperty(window, 'screen', originalScreen)
  else delete (window as { screen?: unknown }).screen
})

const mixer = (root: HTMLElement): Element | null => root.querySelector('[data-pattern-mixer]')
const grid = (root: HTMLElement): Element | null => root.querySelector('[data-pattern-grid]')
const drawn = (coarse: boolean, w: number, h: number): boolean => {
  device(coarse, w, h)
  const { container } = render(<PatternPanel />)
  const there = mixer(container) !== null
  expect(grid(container)).not.toBeNull()
  cleanup()
  return there
}

describe('PatternPanel — the right column, by device', () => {
  it('a desktop: the grid and the column, as before, however small its screen', () => {
    const d = device(false, 1440, 900)
    const { container } = render(<PatternPanel />)
    expect(grid(container)).not.toBeNull()
    expect(mixer(container)).not.toBeNull()
    expect(container.querySelector('[data-mixer-body]')).not.toBeNull()
    // the one question put to matchMedia is the pointer one — never a window width
    expect(new Set(d.asked)).toEqual(new Set([TOUCH_POINTER_QUERY]))
    cleanup()
    expect(drawn(false, 390, 844)).toBe(true)
  })

  it('a phone: the grid alone — upright or on its side', () => {
    expect(drawn(true, 390, 844)).toBe(false) // iPhone 14
    expect(drawn(true, 844, 390)).toBe(false) // the same phone turned sideways
    expect(drawn(true, 412, 915)).toBe(false) // Pixel 7
    expect(drawn(true, 320, 568)).toBe(false) // the smallest phones
  })

  it('a tablet: the column stays', () => {
    expect(drawn(true, 810, 1080)).toBe(true) // iPad
    expect(drawn(true, 1080, 810)).toBe(true) // iPad on its side
    expect(drawn(true, 744, 1133)).toBe(true) // iPad mini
    expect(drawn(true, 712, 1138)).toBe(true) // Galaxy Tab S4
  })

  it('the line is the short side of the screen, at exactly the stated size', () => {
    expect(drawn(true, PHONE_SHORT_SIDE_PX - 1, 2000)).toBe(false)
    expect(drawn(true, PHONE_SHORT_SIDE_PX, 2000)).toBe(true)
    expect(drawn(true, 2000, PHONE_SHORT_SIDE_PX - 1)).toBe(false)
  })

  it('follows the pointer and the screen while the panel is open', () => {
    const d = device(false, 390, 844)
    const { container } = render(<PatternPanel />)
    expect(mixer(container)).not.toBeNull()
    act(() => d.finger(true))
    expect(mixer(container)).toBeNull()
    // a folding phone opened flat
    act(() => d.screen(884, 1104))
    expect(mixer(container)).not.toBeNull()
    act(() => d.screen(390, 844))
    expect(mixer(container)).toBeNull()
    act(() => d.finger(false))
    expect(mixer(container)).not.toBeNull()
  })

  it('a browser that cannot say is a desktop: no matchMedia, or no screen size', () => {
    ;(window as { matchMedia?: unknown }).matchMedia = undefined
    const first = render(<PatternPanel />)
    expect(mixer(first.container)).not.toBeNull()
    cleanup()
    expect(drawn(true, 0, 0)).toBe(true)
  })
})

const rail = (root: HTMLElement): HTMLElement | null => root.querySelector(`[${PATTERN_SIDE_RAIL_ATTR}]`)
const drawer = (root: HTMLElement): HTMLElement | null => root.querySelector(`[${PATTERN_SIDE_DRAWER_ATTR}]`)
const scrim = (root: HTMLElement): HTMLElement | null => root.querySelector(`[${PATTERN_SIDE_SCRIM_ATTR}]`)
const body = (root: HTMLElement): Element | null => root.querySelector('[data-mixer-body]')
const isOpen = (root: HTMLElement): boolean => drawer(root)?.getAttribute(PATTERN_SIDE_DRAWER_ATTR) === 'open'

describe('PatternPanel — the side panel on a phone slides in over the grid (#2252)', () => {
  it('starts collapsed: a rail, no pinned column, and the panel not built yet', () => {
    device(true, 390, 844)
    const { container } = render(<PatternPanel />)
    expect(rail(container)).not.toBeNull()
    expect(rail(container)!.getAttribute('aria-expanded')).toBe('false')
    expect(mixer(container)).toBeNull()
    expect(isOpen(container)).toBe(false)
    expect(body(container)).toBeNull()
  })

  it('the rail opens it with the same panel in it; the close button puts it away and keeps it built', () => {
    device(true, 390, 844)
    const { container, getByLabelText } = render(<PatternPanel />)
    fireEvent.click(rail(container)!)
    expect(isOpen(container)).toBe(true)
    expect(rail(container)!.getAttribute('aria-expanded')).toBe('true')
    expect(drawer(container)!.querySelector('[data-mixer-body]')).not.toBeNull()
    // focus goes to the close button, then back to the rail
    expect(document.activeElement).toBe(getByLabelText('Hide inspector'))
    fireEvent.click(getByLabelText('Hide inspector'))
    expect(isOpen(container)).toBe(false)
    expect(document.activeElement).toBe(rail(container))
    expect(body(container)).not.toBeNull()
    // still no pinned column: the drawer is not the column
    expect(mixer(container)).toBeNull()
  })

  it('a tap on the dimmed grid closes it and goes no further; so does Escape', () => {
    device(true, 390, 844)
    const below = vi.fn()
    const { container } = render(
      <div onPointerDown={below} onClick={below}>
        <PatternPanel />
      </div>,
    )
    fireEvent.click(rail(container)!)
    below.mockClear()
    fireEvent.pointerDown(scrim(container)!)
    fireEvent.click(scrim(container)!)
    expect(isOpen(container)).toBe(false)
    expect(below).not.toHaveBeenCalled()

    fireEvent.click(rail(container)!)
    expect(isOpen(container)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isOpen(container)).toBe(false)
    // closed, Escape is not listened for
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isOpen(container)).toBe(false)
  })

  it('upright and on its side alike; a tablet and a desktop draw no rail and no drawer', () => {
    for (const [coarse, w, h, phone] of [
      [true, 390, 844, true],
      [true, 844, 390, true],
      [true, 810, 1080, false],
      [false, 1440, 900, false],
    ] as const) {
      device(coarse, w, h)
      const { container } = render(<PatternPanel />)
      expect(rail(container) !== null).toBe(phone)
      expect(drawer(container) !== null).toBe(phone)
      cleanup()
    }
  })

  it('a folding phone opened flat swaps the drawer for the pinned column', () => {
    const d = device(true, 390, 844)
    const { container } = render(<PatternPanel />)
    fireEvent.click(rail(container)!)
    act(() => d.screen(884, 1104))
    expect(drawer(container)).toBeNull()
    expect(rail(container)).toBeNull()
    expect(mixer(container)).not.toBeNull()
  })
})
