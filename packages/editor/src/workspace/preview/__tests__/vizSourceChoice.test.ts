/**
 * vizSourceChoice — the per-file source picked in a viz's ⚙ → Source (#2429).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  getVizSourceChoice,
  setVizSourceChoice,
  onVizSourceChoiceChange,
  forgetVizSourceChoicesFor,
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
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
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

  // #2452 — deleting the pattern a viz listens to
  describe('a chosen file is deleted', () => {
    it('every viz that chose it goes back to "default", and listeners hear it', () => {
      setVizSourceChoice('v1', { kind: 'file', fileId: 'song' })
      setVizSourceChoice('v2', { kind: 'file', fileId: 'song' })
      const cb = vi.fn()
      onVizSourceChoiceChange(cb)
      forgetVizSourceChoicesFor('song')
      expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
      expect(getVizSourceChoice('v2')).toEqual({ kind: 'default' })
      expect(cb).toHaveBeenCalledWith('v1', { kind: 'default' })
      expect(cb).toHaveBeenCalledWith('v2', { kind: 'default' })
    })

    it('drops the stored entry, so a reload does not bring the dead choice back', () => {
      setVizSourceChoice('v1', { kind: 'file', fileId: 'song' })
      forgetVizSourceChoicesFor('song')
      expect(window.localStorage.getItem('stave:vizSource:v1')).toBeNull()
      __resetVizSourceChoiceForTests() // a reload
      expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
    })

    it('finds stored choices not yet read this session (after a reload)', () => {
      window.localStorage.setItem('stave:vizSource:v1', JSON.stringify({ kind: 'file', fileId: 'song' }))
      forgetVizSourceChoicesFor('song')
      expect(window.localStorage.getItem('stave:vizSource:v1')).toBeNull()
      expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
    })

    it('leaves choices naming other sources alone', () => {
      setVizSourceChoice('v1', { kind: 'file', fileId: 'other' })
      setVizSourceChoice('v2', { kind: 'file', fileId: '__sample__' })
      setVizSourceChoice('v3', { kind: 'none' })
      const cb = vi.fn()
      onVizSourceChoiceChange(cb)
      forgetVizSourceChoicesFor('song')
      expect(getVizSourceChoice('v1')).toEqual({ kind: 'file', fileId: 'other' })
      expect(getVizSourceChoice('v2')).toEqual({ kind: 'file', fileId: '__sample__' })
      expect(getVizSourceChoice('v3')).toEqual({ kind: 'none' })
      expect(cb).not.toHaveBeenCalled()
    })

    it('a deleted viz’s own entry goes too', () => {
      setVizSourceChoice('v1', { kind: 'file', fileId: '__sample__' })
      forgetVizSourceChoicesFor('v1')
      expect(window.localStorage.getItem('stave:vizSource:v1')).toBeNull()
      expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
    })
  })

  it('a malformed stored entry reads as "default"', () => {
    window.localStorage.setItem('stave:vizSource:v1', '{not json')
    window.localStorage.setItem('stave:vizSource:v2', '{"kind":"file"}')
    expect(getVizSourceChoice('v1')).toEqual({ kind: 'default' })
    expect(getVizSourceChoice('v2')).toEqual({ kind: 'default' })
  })
})
