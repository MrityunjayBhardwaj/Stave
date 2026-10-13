/**
 * The panel on a phone held sideways (#2003): no header, and an open panel is its body
 * alone. Which view shows is set from outside, through the store.
 *
 * The browser spec (`touch-sideways-views.spec.ts`) shows the views filling the screen;
 * this pins what the panel draws, and that an upright phone and a desktop still get
 * their header.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { render } from '@testing-library/react'

function installMockLocalStorage(): void {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock })
}
beforeAll(installMockLocalStorage)

import { BottomPanel } from '../BottomPanel'
import { __resetBottomPanelRegistryForTest, registerBottomPanelTab } from '../bottomPanelRegistry'
import { __resetBottomPanelStateForTest, setBottomPanelOpen, showBottomPanelTab } from '../panelState'

const original = { matchMedia: window.matchMedia, screen: window.screen, innerWidth: window.innerWidth }

function device(coarse: boolean, screen: { width: number; height: number }, innerWidth: number): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: coarse, addEventListener: () => undefined, removeEventListener: () => undefined })),
  })
  Object.defineProperty(window, 'screen', { configurable: true, value: screen })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth })
}

function reset(): void {
  __resetBottomPanelRegistryForTest()
  window.localStorage.clear()
  __resetBottomPanelStateForTest()
}
beforeEach(() => {
  reset()
  registerBottomPanelTab({ id: 'a', title: 'Alpha', content: <div data-testid="body-a">a</div> })
  registerBottomPanelTab({ id: 'b', title: 'Beta', content: <div data-testid="body-b">b</div> })
})
afterEach(() => {
  reset()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: original.matchMedia })
  Object.defineProperty(window, 'screen', { configurable: true, value: original.screen })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original.innerWidth })
})

const root = (c: HTMLElement): HTMLElement | null => c.querySelector('[data-bottom-panel="root"]')
const header = (c: HTMLElement): Element | null => c.querySelector('[data-bottom-panel="header"]')
const body = (c: HTMLElement): Element | null => c.querySelector('[data-bottom-panel="body"]')

describe('BottomPanel — a phone held sideways (#2003)', () => {
  beforeEach(() => device(true, { width: 915, height: 412 }, 863))

  it('closed, it draws nothing a finger could meet: no header, no body, a hidden root', () => {
    const { container } = render(<BottomPanel />)
    expect(header(container)).toBeNull()
    expect(body(container)).toBeNull()
    expect(root(container)?.getAttribute('data-whole-view')).toBe('closed')
    expect(root(container)?.hidden).toBe(true)
  })

  it('a view chosen from outside is its body alone, on that tab', () => {
    const { container, queryByTestId } = render(<BottomPanel />)
    act(() => showBottomPanelTab('b'))
    expect(root(container)?.getAttribute('data-whole-view')).toBe('open')
    expect(root(container)?.hidden).toBe(false)
    expect(header(container)).toBeNull()
    expect(body(container)).not.toBeNull()
    expect(queryByTestId('body-b')?.parentElement?.hidden).toBe(false)
    expect(queryByTestId('body-a')?.parentElement?.hidden).toBe(true)

    act(() => setBottomPanelOpen(false))
    expect(body(container)).toBeNull()
    expect(root(container)?.hidden).toBe(true)
  })

  it('is not a sheet: no stop, no handle', () => {
    const { container } = render(<BottomPanel />)
    act(() => showBottomPanelTab('a'))
    expect(root(container)?.hasAttribute('data-sheet')).toBe(false)
    expect(container.querySelector('[data-bottom-panel="sheet-handle"]')).toBeNull()
  })
})

describe('BottomPanel — the header is still there everywhere else', () => {
  it('an upright phone has its strip, as a sheet', () => {
    device(true, { width: 412, height: 915 }, 412)
    const { container } = render(<BottomPanel />)
    expect(header(container)).not.toBeNull()
    expect(root(container)?.getAttribute('data-sheet')).toBe('closed')
    expect(root(container)?.hasAttribute('data-whole-view')).toBe(false)
  })

  it('a desktop has its header, and is neither', () => {
    device(false, { width: 1440, height: 900 }, 1440)
    const { container } = render(<BottomPanel />)
    expect(header(container)).not.toBeNull()
    expect(root(container)?.hasAttribute('data-sheet')).toBe(false)
    expect(root(container)?.hasAttribute('data-whole-view')).toBe(false)
  })
})
