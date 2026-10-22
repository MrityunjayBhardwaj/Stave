/**
 * The Pattern tab's right column can be put away, and the choice is kept (#2044).
 *
 * The panel's children are replaced with markers: this is about which columns the panel
 * draws and what the button says, not about what is in them. The browser spec
 * (`pattern-side-toggle.spec.ts`) shows the widths and the button's place in the header.
 */
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('../useActiveChunk', () => ({ useActiveChunk: () => ({ chunk: null }) }))
vi.mock('../../../codeView', () => ({ chunkSurface: () => null }))
vi.mock('../SequencerGrid', () => ({ SequencerGrid: () => null }))
vi.mock('../PianoRollGrid', () => ({ PianoRollGrid: () => null }))
vi.mock('../VisualEditStandby', () => ({ VisualEditStandby: () => <div data-standby /> }))
vi.mock('../../mixer/MixerPanel', () => ({ MixerPanel: () => <div data-mixer-body /> }))

import { PatternPanel } from '../PatternPanel'
import {
  PATTERN_SIDE_KEY,
  PATTERN_SIDE_TOGGLE_ATTR,
  PatternSideToggle,
  getPatternSideShown,
  setPatternSideShown,
} from '../patternSide'

// jsdom's localStorage stub here has no getItem / setItem; see panelState.test.tsx
beforeAll(() => {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
})

/** a browser whose main pointer is, or is not, a finger, on a screen this big */
function device(coarse: boolean, width: number, height: number): void {
  window.matchMedia = (() => ({
    matches: coarse,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  Object.defineProperty(window, 'screen', { configurable: true, value: { width, height } })
}

const originalMatchMedia = window.matchMedia
const originalScreen = Object.getOwnPropertyDescriptor(window, 'screen')
beforeEach(() => {
  device(false, 1440, 900)
  act(() => setPatternSideShown(true))
  window.localStorage.removeItem(PATTERN_SIDE_KEY)
})
afterEach(() => {
  cleanup()
  act(() => setPatternSideShown(true))
  window.matchMedia = originalMatchMedia
  if (originalScreen) Object.defineProperty(window, 'screen', originalScreen)
  else delete (window as { screen?: unknown }).screen
})

const column = (root: HTMLElement): Element | null => root.querySelector('[data-pattern-mixer]')
const grid = (root: HTMLElement): Element | null => root.querySelector('[data-pattern-grid]')
const button = (root: HTMLElement): HTMLButtonElement | null => root.querySelector(`[${PATTERN_SIDE_TOGGLE_ATTR}]`)

describe('the Pattern tab side panel button (#2044)', () => {
  it('a desktop starts with the column, and the button hides it and shows it again', () => {
    const { container } = render(
      <>
        <PatternSideToggle />
        <PatternPanel />
      </>,
    )
    expect(column(container)).not.toBeNull()
    expect(button(container)!.getAttribute('aria-expanded')).toBe('true')
    expect(button(container)!.getAttribute('aria-label')).toBe('Hide side panel')

    fireEvent.click(button(container)!)
    expect(column(container)).toBeNull()
    expect(grid(container)).not.toBeNull()
    expect(button(container)!.getAttribute('aria-expanded')).toBe('false')
    expect(button(container)!.getAttribute('aria-label')).toBe('Show side panel')

    fireEvent.click(button(container)!)
    expect(column(container)).not.toBeNull()
    expect(button(container)!.getAttribute('aria-expanded')).toBe('true')
  })

  it('each press is written down, so a reload finds the panel as it was left', () => {
    const { container } = render(<PatternSideToggle />)
    expect(window.localStorage.getItem(PATTERN_SIDE_KEY)).toBeNull()
    fireEvent.click(button(container)!)
    expect(window.localStorage.getItem(PATTERN_SIDE_KEY)).toBe('hidden')
    expect(getPatternSideShown()).toBe(false)
    fireEvent.click(button(container)!)
    expect(window.localStorage.getItem(PATTERN_SIDE_KEY)).toBe('shown')
  })

  it('what was written down is what a fresh load starts from', async () => {
    window.localStorage.setItem(PATTERN_SIDE_KEY, 'hidden')
    vi.resetModules()
    const fresh = await import('../patternSide')
    expect(fresh.getPatternSideShown()).toBe(false)

    window.localStorage.setItem(PATTERN_SIDE_KEY, 'shown')
    vi.resetModules()
    expect((await import('../patternSide')).getPatternSideShown()).toBe(true)

    // anything else written there is not a choice: the column shows, as it always did
    window.localStorage.setItem(PATTERN_SIDE_KEY, 'sideways')
    vi.resetModules()
    expect((await import('../patternSide')).getPatternSideShown()).toBe(true)
  })

  it('a phone has no button, and its grid is alone whatever was chosen on a desktop', () => {
    device(true, 390, 844)
    const { container } = render(
      <>
        <PatternSideToggle />
        <PatternPanel />
      </>,
    )
    expect(button(container)).toBeNull()
    expect(column(container)).toBeNull()
    expect(grid(container)).not.toBeNull()
  })

  it('a tablet has the button and the column', () => {
    device(true, 712, 1138)
    const { container } = render(
      <>
        <PatternSideToggle />
        <PatternPanel />
      </>,
    )
    expect(button(container)).not.toBeNull()
    expect(column(container)).not.toBeNull()
  })
})
