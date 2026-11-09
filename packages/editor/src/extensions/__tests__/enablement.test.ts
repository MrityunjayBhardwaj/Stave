/**
 * #2509 — the per-user on/off store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { enabledExtensionIds, isExtensionEnabled, setExtensionEnabled, onExtensionsEnabledChange } from '../enablement'

// jsdom's localStorage is a non-functional stub under this package's vitest config, so a
// Map-backed one is installed per test (the same as vizFlags.test.ts). `refuse` makes
// writes throw, as a full or blocked storage does.
let store: Map<string, string>
let refuse = false
beforeEach(() => {
  store = new Map()
  refuse = false
  const mock = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      if (refuse) throw new Error('quota')
      store.set(k, String(v))
    },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock })
})

describe('extension switches', () => {
  it('start off, switch on and off, and are saved as a sorted list', () => {
    expect(isExtensionEnabled('voice')).toBe(false)
    setExtensionEnabled('voice', true)
    setExtensionEnabled('vim', true)
    expect(localStorage.getItem('stave:extensions')).toBe('["vim","voice"]')
    expect([...enabledExtensionIds()]).toEqual(['vim', 'voice'])
    setExtensionEnabled('voice', false)
    expect(isExtensionEnabled('voice')).toBe(false)
    expect(localStorage.getItem('stave:extensions')).toBe('["vim"]')
  })

  it('tells subscribers only when something changed, and stops after unsubscribe', () => {
    const fn = vi.fn()
    const off = onExtensionsEnabledChange(fn)
    setExtensionEnabled('voice', true)
    setExtensionEnabled('voice', true)
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    setExtensionEnabled('voice', false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reads anything unreadable as nothing switched on', () => {
    localStorage.setItem('stave:extensions', '{not json')
    expect([...enabledExtensionIds()]).toEqual([])
    localStorage.setItem('stave:extensions', '{"voice":true}')
    expect([...enabledExtensionIds()]).toEqual([])
    localStorage.setItem('stave:extensions', '["voice", 3]')
    expect([...enabledExtensionIds()]).toEqual(['voice'])
  })

  it('when storage refuses the write, the switch holds for this page and a later save keeps it', () => {
    refuse = true
    setExtensionEnabled('voice', true)
    expect(isExtensionEnabled('voice')).toBe(true)
    expect(localStorage.getItem('stave:extensions')).toBeNull()
    refuse = false
    setExtensionEnabled('vim', true)
    expect(localStorage.getItem('stave:extensions')).toBe('["vim","voice"]')
    setExtensionEnabled('voice', false)
    setExtensionEnabled('vim', false)
  })
})
