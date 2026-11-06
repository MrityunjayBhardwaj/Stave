/**
 * vizSourceChoice — the per-file source picked in a viz's ⚙ → Source (#2429).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  getVizSourceChoice,
  setVizSourceChoice,
  onVizSourceChoiceChange,
  __resetVizSourceChoiceForTests,
} from '../vizSourceChoice'

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

describe('vizSourceChoice', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetVizSourceChoiceForTests()
  })

  it('is "default" for a file that never picked one', () => {
    expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
  })

  it('survives a reload: a fresh cache reads it back from storage', () => {
    setVizSourceChoice('v1', { kind: 'file', fileId: '__sample__' })
    __resetVizSourceChoiceForTests() // a reload: memory gone, storage kept
    expect(getVizSourceChoice('v1')).toEqual({ kind: 'file', fileId: '__sample__' })
    expect(getVizSourceChoice('v2')).toEqual({ kind: 'default' })
  })

  it('keeps one value per file', () => {
    setVizSourceChoice('v1', { kind: 'none' })
    setVizSourceChoice('v2', { kind: 'file', fileId: 'song' })
    expect(getVizSourceChoice('v1')).toEqual({ kind: 'none' })
    expect(getVizSourceChoice('v2')).toEqual({ kind: 'file', fileId: 'song' })
  })

  it('going back to "default" removes the stored entry', () => {
    setVizSourceChoice('v1', { kind: 'none' })
    setVizSourceChoice('v1', { kind: 'default' })
    expect(window.localStorage.getItem('stave:vizSource:v1')).toBeNull()
  })

  it('tells listeners which file changed, and only when it changed', () => {
    const cb = vi.fn()
    const off = onVizSourceChoiceChange(cb)
    setVizSourceChoice('v1', { kind: 'file', fileId: 'a' })
    setVizSourceChoice('v1', { kind: 'file', fileId: 'a' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('v1', { kind: 'file', fileId: 'a' })
    off()
    setVizSourceChoice('v1', { kind: 'none' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('a malformed stored entry reads as "default"', () => {
    window.localStorage.setItem('stave:vizSource:v1', '{not json')
    window.localStorage.setItem('stave:vizSource:v2', '{"kind":"file"}')
    expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
    expect(getVizSourceChoice('v2')).toEqual({ kind: 'default' })
  })
})
