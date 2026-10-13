/**
 * The bottom panel's open / chosen-tab store (#2002).
 *
 * Two things are pinned here. The store itself: it starts from what was saved, saves
 * every change, and tells its listeners only when something changed. And the reason it
 * exists: a call from OUTSIDE the panel opens it on a tab, which the panel's own state
 * could not be asked to do.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { render } from '@testing-library/react'

// jsdom's localStorage stub here has no getItem / setItem; see BottomPanel.test.tsx
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
import {
  __resetBottomPanelStateForTest,
  getBottomPanelState,
  setBottomPanelActiveTab,
  setBottomPanelOpen,
  showBottomPanelTab,
  subscribeToBottomPanelState,
} from '../panelState'
import { BOTTOM_PANEL_ACTIVE_TAB_KEY, BOTTOM_PANEL_OPEN_KEY } from '../persistence'

function reset(): void {
  __resetBottomPanelRegistryForTest()
  window.localStorage.clear()
  __resetBottomPanelStateForTest()
}
beforeEach(reset)
afterEach(reset)

describe('panelState — the store', () => {
  it('starts closed with no tab chosen when nothing was saved', () => {
    expect(getBottomPanelState()).toEqual({ open: false, activeTabId: null })
  })

  it('starts from what was saved', () => {
    window.localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, 'true')
    window.localStorage.setItem(BOTTOM_PANEL_ACTIVE_TAB_KEY, 'mixer')
    expect(getBottomPanelState()).toEqual({ open: true, activeTabId: 'mixer' })
  })

  it('saves each change as it is made, under the keys the panel always used', () => {
    setBottomPanelOpen(true)
    expect(window.localStorage.getItem(BOTTOM_PANEL_OPEN_KEY)).toBe('true')
    setBottomPanelActiveTab('pattern')
    expect(window.localStorage.getItem(BOTTOM_PANEL_ACTIVE_TAB_KEY)).toBe('pattern')
    setBottomPanelOpen(false)
    expect(window.localStorage.getItem(BOTTOM_PANEL_OPEN_KEY)).toBe('false')
    // no tab chosen is saved as no entry, as before
    setBottomPanelActiveTab(null)
    expect(window.localStorage.getItem(BOTTOM_PANEL_ACTIVE_TAB_KEY)).toBeNull()
  })

  it('tells a listener once per change, and not at all when nothing changed', () => {
    const heard = vi.fn()
    const stop = subscribeToBottomPanelState(heard)
    setBottomPanelOpen(false) // already closed
    setBottomPanelActiveTab(null) // already none
    expect(heard).toHaveBeenCalledTimes(0)
    setBottomPanelOpen(true)
    setBottomPanelActiveTab('a')
    expect(heard).toHaveBeenCalledTimes(2)
    // one change, not two, for "open on this tab"
    showBottomPanelTab('b')
    expect(heard).toHaveBeenCalledTimes(3)
    showBottomPanelTab('b') // already showing
    expect(heard).toHaveBeenCalledTimes(3)
    stop()
    setBottomPanelOpen(false)
    expect(heard).toHaveBeenCalledTimes(3)
  })

  it('hands back the same object until something changes', () => {
    const first = getBottomPanelState()
    expect(getBottomPanelState()).toBe(first)
    setBottomPanelOpen(true)
    expect(getBottomPanelState()).not.toBe(first)
  })
})

describe('panelState — the panel follows the store', () => {
  function registerTwo(): void {
    registerBottomPanelTab({ id: 'a', title: 'Alpha', content: <div data-testid="body-a">a</div> })
    registerBottomPanelTab({ id: 'b', title: 'Beta', content: <div data-testid="body-b">b</div> })
  }
  const selectedTab = (c: HTMLElement): string | null =>
    c.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null
  const body = (c: HTMLElement): Element | null => c.querySelector('[data-bottom-panel="body"]')

  it('a call from outside opens a closed panel on the tab it names', () => {
    registerTwo()
    const { container } = render(<BottomPanel />)
    expect(body(container)).toBeNull()
    expect(selectedTab(container)).toBe('a')

    act(() => showBottomPanelTab('b'))
    expect(body(container)).not.toBeNull()
    expect(selectedTab(container)).toBe('b')

    act(() => setBottomPanelOpen(false))
    expect(body(container)).toBeNull()
    // closing does not forget the tab
    expect(selectedTab(container)).toBe('b')
  })

  it('what the panel shows is what the store says: a tab pressed in the panel is readable outside', () => {
    registerTwo()
    const { container } = render(<BottomPanel />)
    const beta = container.querySelector<HTMLButtonElement>('[data-tab-id="b"]')
    act(() => beta!.click())
    expect(getBottomPanelState()).toEqual({ open: true, activeTabId: 'b' })
  })

  it('with nothing chosen, the first tab stands in and becomes the choice', () => {
    registerTwo()
    render(<BottomPanel />)
    expect(getBottomPanelState().activeTabId).toBe('a')
    expect(window.localStorage.getItem(BOTTOM_PANEL_ACTIVE_TAB_KEY)).toBe('a')
  })

  it('a chosen tab that is no longer registered gives way to the first one', () => {
    window.localStorage.setItem(BOTTOM_PANEL_ACTIVE_TAB_KEY, 'gone')
    registerTwo()
    const { container } = render(<BottomPanel />)
    expect(selectedTab(container)).toBe('a')
    expect(getBottomPanelState().activeTabId).toBe('a')
  })
})
