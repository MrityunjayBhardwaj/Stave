/**
 * BottomPanel component tests — Phase 20-01 PR-A T-07.
 *
 * Covers: zero-tabs returns null (Trap 2 — true zero pixel cost), seeded
 * render, default closed state, toggle to open, persisted state hydrates
 * before first paint (Trap 7), keyboard tab nav, display:none preserves
 * mount across tab switches (DA-02), vocabulary regression (Trap 1).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

// Install a Map-backed mock localStorage. jsdom's stub here lacks
// setItem/getItem/clear; production code guards via safeLocalStorage,
// but BottomPanel persistence reads/writes need a working store to
// exercise the hydration path.
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
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: mock,
  })
}

beforeAll(installMockLocalStorage)

import { BottomPanel } from '../BottomPanel'
import {
  __resetBottomPanelRegistryForTest,
  registerBottomPanelTab,
} from '../bottomPanelRegistry'
import { __resetBottomPanelStateForTest } from '../panelState'
import {
  BOTTOM_PANEL_ACTIVE_TAB_KEY,
  BOTTOM_PANEL_HEIGHT_KEY,
  BOTTOM_PANEL_OPEN_KEY,
} from '../persistence'

const FORBIDDEN_NOUNS =
  /snapshot|publishirsnapshot|loc\b|irevent|publishir/i

beforeEach(() => {
  // Reset BEFORE each test so the seedTabs side-effect import (which
  // ran when BottomPanel.tsx loaded) doesn't leak the placeholder
  // "Timeline" tab into "zero tabs registered" assertions.
  __resetBottomPanelRegistryForTest()
  window.localStorage.clear()
  // after the clear: the store reads localStorage afresh on its next use, as a page load does
  __resetBottomPanelStateForTest()
})

afterEach(() => {
  __resetBottomPanelRegistryForTest()
  window.localStorage.clear()
  __resetBottomPanelStateForTest()
})

function registerStubTab(
  id: string,
  title: string,
  body: React.ReactNode = null,
): void {
  registerBottomPanelTab({
    id,
    title,
    content: body ?? <div data-testid={`stub-${id}`}>{title}-body</div>,
  })
}

describe('BottomPanel — zero-cost when empty', () => {
  it('renders nothing when no tabs are registered (Trap 2)', () => {
    const { container } = render(<BottomPanel />)
    expect(container.firstChild).toBeNull()
  })
})

describe('BottomPanel — seeded render', () => {
  beforeEach(() => {
    registerStubTab('a', 'Alpha')
  })

  it('renders the bottom-panel root with the registered tab in the tab bar', () => {
    render(<BottomPanel />)
    const root = screen.getByRole('region', { name: /bottom panel/i })
    expect(root).toBeTruthy()
    const tab = screen.getByRole('tab', { name: 'Alpha' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
  })

  it('default state is closed: no body in DOM', () => {
    render(<BottomPanel />)
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })

  it('clicking the toggle opens the drawer; body is mounted', () => {
    render(<BottomPanel />)
    const toggle = screen.getByRole('button', { name: /show panel/i })
    fireEvent.click(toggle)
    expect(screen.getByRole('tabpanel')).toBeTruthy()
    // ARIA label flips
    expect(screen.getByRole('button', { name: /hide panel/i })).toBeTruthy()
  })

  it('closed-state height is exactly 29px (Trap 2 budget)', () => {
    const { container } = render(<BottomPanel />)
    const root = container.querySelector('[data-bottom-panel="root"]') as HTMLElement
    expect(root.style.flexBasis).toBe('29px')
  })

  it('open-state flexBasis equals the persisted height; default 240', () => {
    render(<BottomPanel />)
    const toggle = screen.getByRole('button', { name: /show panel/i })
    fireEvent.click(toggle)
    const root = screen.getByRole('region', { name: /bottom panel/i })
    expect((root as HTMLElement).style.flexBasis).toBe('240px')
  })

  it('clicking a tab when closed opens the drawer and selects the tab', () => {
    registerStubTab('b', 'Beta')
    render(<BottomPanel />)
    // default: closed; activeTabId = first ('a')
    const beta = screen.getByRole('tab', { name: 'Beta' })
    fireEvent.click(beta)
    // body should be present and Beta selected
    expect(screen.getByRole('tabpanel')).toBeTruthy()
    expect(beta.getAttribute('aria-selected')).toBe('true')
  })

  it('double-clicking the resize handle collapses the drawer (#616)', () => {
    const { container } = render(<BottomPanel />)
    const root = container.querySelector('[data-bottom-panel="root"]') as HTMLElement
    // open first
    fireEvent.click(screen.getByRole('button', { name: /show panel/i }))
    expect(root.style.flexBasis).toBe('240px')
    const handle = container.querySelector('[data-bottom-panel="resize-handle"]') as HTMLElement
    expect(handle).toBeTruthy()
    fireEvent.doubleClick(handle)
    // collapsed back to the closed budget; handle unmounts with the open body
    expect(root.style.flexBasis).toBe('29px')
    expect(container.querySelector('[data-bottom-panel="resize-handle"]')).toBeNull()
  })

  it('double-clicking a tab collapses the open drawer (#712)', () => {
    const { container } = render(<BottomPanel />)
    const root = container.querySelector('[data-bottom-panel="root"]') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: /show panel/i })) // open
    expect(root.style.flexBasis).toBe('240px')
    const tab = screen.getByRole('tab', { name: 'Alpha' })
    // A double-click arrives as two click events; the 2nd carries detail>=2.
    fireEvent.click(tab, { detail: 1 })
    fireEvent.click(tab, { detail: 2 })
    expect(root.style.flexBasis).toBe('29px') // collapsed
  })

  it('double-clicking a collapsed tab opens it (no flash-closed) (#712)', () => {
    const { container } = render(<BottomPanel />)
    const root = container.querySelector('[data-bottom-panel="root"]') as HTMLElement
    expect(root.style.flexBasis).toBe('29px') // default closed
    const tab = screen.getByRole('tab', { name: 'Alpha' })
    fireEvent.click(tab, { detail: 1 }) // opens
    fireEvent.click(tab, { detail: 2 }) // must NOT collapse — was closed at press
    expect(root.style.flexBasis).toBe('240px') // stays open
  })
})

describe('BottomPanel — keyboard tab navigation', () => {
  beforeEach(() => {
    registerStubTab('a', 'Alpha')
    registerStubTab('b', 'Beta')
    registerStubTab('c', 'Gamma')
  })

  it('ArrowRight cycles forward and wraps; ArrowLeft cycles back and wraps', () => {
    render(<BottomPanel />)
    const tablist = screen.getByRole('tablist', { name: /bottom panel tabs/i })
    // start: Alpha selected
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    // wraps to Alpha
    expect(
      screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(
      screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('Home jumps to the first tab; End jumps to the last', () => {
    render(<BottomPanel />)
    const tablist = screen.getByRole('tablist', { name: /bottom panel tabs/i })
    fireEvent.keyDown(tablist, { key: 'End' })
    expect(
      screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(tablist, { key: 'Home' })
    expect(
      screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('single tab + ArrowRight is a stable no-op (no error)', () => {
    __resetBottomPanelRegistryForTest()
    registerStubTab('only', 'Only')
    render(<BottomPanel />)
    const tablist = screen.getByRole('tablist', { name: /bottom panel tabs/i })
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(
      screen.getByRole('tab', { name: 'Only' }).getAttribute('aria-selected'),
    ).toBe('true')
  })
})

describe('BottomPanel — DA-02 display:none preserves child mount across tab switches', () => {
  it('mount count for each tab body stays at 1 across switches', () => {
    let alphaMounts = 0
    let betaMounts = 0
    function AlphaBody(): React.ReactElement {
      React.useEffect(() => {
        alphaMounts++
      }, [])
      return <div data-testid="alpha-body">Alpha</div>
    }
    function BetaBody(): React.ReactElement {
      React.useEffect(() => {
        betaMounts++
      }, [])
      return <div data-testid="beta-body">Beta</div>
    }
    registerBottomPanelTab({
      id: 'a',
      title: 'Alpha',
      content: <AlphaBody />,
    })
    registerBottomPanelTab({ id: 'b', title: 'Beta', content: <BetaBody /> })
    render(<BottomPanel />)
    // open the drawer to mount bodies
    fireEvent.click(screen.getByRole('button', { name: /show panel/i }))
    expect(alphaMounts).toBe(1)
    expect(betaMounts).toBe(1)
    // switch to Beta
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    // and back to Alpha
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }))
    // mount counts must NOT increment — display:none keeps them mounted
    expect(alphaMounts).toBe(1)
    expect(betaMounts).toBe(1)
  })
})

describe('BottomPanel — Trap 7 hydration before first paint', () => {
  it('persisted activeTabId is applied on FIRST render (no setState rerender)', () => {
    registerStubTab('first', 'First')
    registerStubTab('second', 'Second')
    window.localStorage.setItem(BOTTOM_PANEL_ACTIVE_TAB_KEY, 'second')
    render(<BottomPanel />)
    expect(
      screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('persisted open=true is applied on FIRST render (body present immediately)', () => {
    registerStubTab('a', 'Alpha')
    window.localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, 'true')
    render(<BottomPanel />)
    expect(screen.queryByRole('tabpanel')).not.toBeNull()
  })

  it('persisted height applied on FIRST render', () => {
    registerStubTab('a', 'Alpha')
    window.localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, 'true')
    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_KEY, '320')
    const { container } = render(<BottomPanel />)
    const root = container.querySelector('[data-bottom-panel="root"]') as HTMLElement
    expect(root.style.flexBasis).toBe('320px')
  })
})

describe('BottomPanel — registry sync (registered after mount)', () => {
  it('subscribes to registry; later registrations appear without remount', () => {
    registerStubTab('a', 'Alpha')
    render(<BottomPanel />)
    expect(screen.getByRole('tab', { name: 'Alpha' })).toBeTruthy()
    act(() => {
      registerStubTab('b', 'Beta')
    })
    expect(screen.getByRole('tab', { name: 'Beta' })).toBeTruthy()
  })
})

describe('BottomPanel — vocabulary regression (Trap 1)', () => {
  it('rendered DOM contains none of the forbidden IR-vocabulary nouns', () => {
    registerStubTab('a', 'Alpha')
    const { container } = render(<BottomPanel />)
    // closed
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN_NOUNS)
    // open
    fireEvent.click(screen.getByRole('button', { name: /show panel/i }))
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN_NOUNS)
  })

  it('aria labels do not contain forbidden nouns', () => {
    registerStubTab('a', 'Alpha')
    const { container } = render(<BottomPanel />)
    fireEvent.click(screen.getByRole('button', { name: /show panel/i }))
    const allAria = Array.from(
      container.querySelectorAll('[aria-label]'),
    ).map((el) => el.getAttribute('aria-label') ?? '')
    for (const label of allAria) {
      expect(label).not.toMatch(FORBIDDEN_NOUNS)
    }
  })
})

/**
 * #2022 — `hidden` draws nothing, and is not the user closing the panel: the
 * open/closed choice, the active tab and the height all come back untouched.
 */
describe('BottomPanel — hidden while the active pane is a visual (#2022)', () => {
  beforeEach(() => {
    registerStubTab('a', 'Alpha')
    registerStubTab('b', 'Beta')
  })

  it('draws nothing while hidden, header strip included', () => {
    const { container } = render(<BottomPanel hidden />)
    expect(container.firstChild).toBeNull()
  })

  it('an OPEN panel comes back open, on the same tab', () => {
    const { rerender, container } = render(<BottomPanel />)
    fireEvent.click(screen.getByRole('button', { name: /show panel/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    expect(screen.getByRole('tabpanel')).toBeTruthy()

    rerender(<BottomPanel hidden />)
    expect(container.firstChild).toBeNull()
    // hiding is not closing: what is remembered still says open
    expect(window.localStorage.getItem(BOTTOM_PANEL_OPEN_KEY)).toBe('true')

    rerender(<BottomPanel />)
    expect(screen.getByRole('tabpanel')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('stub-b')).toBeTruthy()
  })

  it('a CLOSED panel comes back closed', () => {
    const { rerender } = render(<BottomPanel />)
    expect(screen.queryByRole('tabpanel')).toBeNull()
    rerender(<BottomPanel hidden />)
    rerender(<BottomPanel />)
    expect(screen.getByRole('region', { name: /bottom panel/i })).toBeTruthy()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(window.localStorage.getItem(BOTTOM_PANEL_OPEN_KEY)).not.toBe('true')
  })

  it('starting hidden with a remembered open panel shows it open once unhidden', () => {
    window.localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, 'true')
    const { rerender, container } = render(<BottomPanel hidden />)
    expect(container.firstChild).toBeNull()
    expect(window.localStorage.getItem(BOTTOM_PANEL_OPEN_KEY)).toBe('true')
    rerender(<BottomPanel />)
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })
})
