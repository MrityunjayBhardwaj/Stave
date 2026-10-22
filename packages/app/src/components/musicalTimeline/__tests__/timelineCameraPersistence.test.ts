import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadTimelineCamera,
  saveTimelineCamera,
} from '../timelineCameraPersistence'

// Every test already gets fresh in-memory storage from vitest.setup.ts (#2126);
// before that, the storage a test got depended on the Node version and could be
// non-functional. This file still installs its own Map-backed Storage, so the
// round-trip assertions exercise actual IO, and restores it afterwards.
function installStorage(): Storage {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return storage
}

describe('timelineCameraPersistence (#501/U4)', () => {
  let original: PropertyDescriptor | undefined

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    installStorage()
  })

  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original)
  })

  it('returns null when nothing is stored', () => {
    expect(loadTimelineCamera()).toBeNull()
  })

  it('round-trips zoom + expanded through localStorage', () => {
    saveTimelineCamera({ zoom: 3.5, expanded: ['d1', 'bd'] })
    expect(loadTimelineCamera()).toEqual({ zoom: 3.5, expanded: ['d1', 'bd'] })
  })

  it('persists an empty expanded set', () => {
    saveTimelineCamera({ zoom: 1, expanded: [] })
    expect(loadTimelineCamera()).toEqual({ zoom: 1, expanded: [] })
  })

  it('survives a fresh read after a separate save (between-sessions sim)', () => {
    saveTimelineCamera({ zoom: 8, expanded: ['lead'] })
    const loaded = loadTimelineCamera()
    expect(loaded?.zoom).toBe(8)
    expect(loaded?.expanded).toEqual(['lead'])
  })

  it('coerces a non-finite/missing zoom to NaN so the caller can fall back', () => {
    window.localStorage.setItem(
      'stave:timelineCamera',
      JSON.stringify({ expanded: ['x'] }),
    )
    const loaded = loadTimelineCamera()
    expect(loaded).not.toBeNull()
    expect(Number.isNaN(loaded!.zoom)).toBe(true)
    expect(loaded!.expanded).toEqual(['x'])
  })

  it('drops non-string entries from a corrupt expanded array', () => {
    window.localStorage.setItem(
      'stave:timelineCamera',
      JSON.stringify({ zoom: 2, expanded: ['ok', 5, null, 'two'] }),
    )
    expect(loadTimelineCamera()).toEqual({ zoom: 2, expanded: ['ok', 'two'] })
  })

  it('returns null on malformed JSON instead of throwing', () => {
    window.localStorage.setItem('stave:timelineCamera', '{not json')
    expect(() => loadTimelineCamera()).not.toThrow()
    expect(loadTimelineCamera()).toBeNull()
  })

  it('treats a non-array expanded as empty', () => {
    window.localStorage.setItem(
      'stave:timelineCamera',
      JSON.stringify({ zoom: 2, expanded: 'd1' }),
    )
    expect(loadTimelineCamera()).toEqual({ zoom: 2, expanded: [] })
  })

  it('never throws when the platform localStorage is non-functional', () => {
    // An object whose methods are undefined, as Node 25's own localStorage is
    // without --localstorage-file, and as a browser that blocks storage can be.
    Object.defineProperty(window, 'localStorage', {
      value: {} as Storage,
      configurable: true,
      writable: true,
    })
    expect(() => saveTimelineCamera({ zoom: 2, expanded: ['a'] })).not.toThrow()
    expect(loadTimelineCamera()).toBeNull()
  })
})
