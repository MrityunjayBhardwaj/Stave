/**
 * #2109 — the user's limit on how many cycles the Song timeline looks through.
 *
 * The store is read once at module load, so each arm seeds localStorage and
 * loads a fresh copy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEY = 'stave:songCycleLimit'

async function fresh() {
  vi.resetModules()
  return import('../songCycleLimit')
}

// jsdom's storage is not usable under this runner; a Map stands in, as in
// backdropCropStore.test.ts.
let originalStorage: PropertyDescriptor | undefined
beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const map = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
    },
    configurable: true,
    writable: true,
  })
})
afterEach(() => {
  if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
})

describe('song cycle limit (#2109)', () => {
  it('is 64 cycles until the user picks otherwise', async () => {
    const m = await fresh()
    expect(m.getSongCycleLimit()).toBe(64)
  })

  it('keeps a choice across a reload', async () => {
    const a = await fresh()
    a.setSongCycleLimit(192)
    expect(window.localStorage.getItem(KEY)).toBe('192')
    const b = await fresh()
    expect(b.getSongCycleLimit()).toBe(192)
  })

  it('stays inside 16..256 and lands on a step of 16', async () => {
    const m = await fresh()
    m.setSongCycleLimit(1000)
    expect(m.getSongCycleLimit()).toBe(256)
    m.setSongCycleLimit(0)
    expect(m.getSongCycleLimit()).toBe(16)
    m.setSongCycleLimit(70)
    expect(m.getSongCycleLimit()).toBe(64)
  })

  it('a stored value that is not a number falls back to the default; one out of range is clamped', async () => {
    window.localStorage.setItem(KEY, 'lots')
    expect((await fresh()).getSongCycleLimit()).toBe(64)
    window.localStorage.setItem(KEY, '4096')
    expect((await fresh()).getSongCycleLimit()).toBe(256)
  })

  it('tells subscribers of a change, once, and not of a no-op', async () => {
    const m = await fresh()
    const seen: number[] = []
    const off = m.subscribeSongCycleLimit((c) => seen.push(c))
    m.setSongCycleLimit(128)
    m.setSongCycleLimit(128)
    m.setSongCycleLimit(130) // rounds to 128: no change
    off()
    m.setSongCycleLimit(32)
    expect(seen).toEqual([128])
  })
})
