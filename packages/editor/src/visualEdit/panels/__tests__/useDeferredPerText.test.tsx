/**
 * The tree views' expensive answer is kept per text and, for a new text, asked once the
 * typing pauses (#1834): never once per keystroke.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { DEFER_MS, perText, useDeferredPerText } from '../useDeferredPerText'

afterEach(() => {
  vi.useRealTimers()
})

describe('useDeferredPerText', () => {
  it('a kept text is answered at once; new texts typed in a burst are asked once, after the pause', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const f = perText((t: string) => {
      calls.push(t)
      return t.length
    })
    f('abc')
    calls.length = 0
    const { result, rerender } = renderHook(({ text }) => useDeferredPerText(text, f), { initialProps: { text: 'abc' as string | null } })
    expect(result.current).toBe(3)
    // five keystrokes, each a new text, faster than the pause
    for (const t of ['abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh']) {
      rerender({ text: t })
      act(() => {
        vi.advanceTimersByTime(DEFER_MS / 5)
      })
    }
    expect(calls).toEqual([])
    act(() => {
      vi.advanceTimersByTime(DEFER_MS)
    })
    expect(calls).toEqual(['abcdefgh'])
    expect(result.current).toBe(8)
    // no text: nothing asked, nothing drawn
    rerender({ text: null })
    expect(result.current).toBeNull()
  })
})
