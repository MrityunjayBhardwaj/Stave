/**
 * playbackCoordinator — unit tests.
 *
 * Single-source-at-a-time invariant: when a new source notifies
 * start, every OTHER registered source has its stop callback
 * called. The newly-started source's own stop is NOT called.
 *
 * Tests verify:
 *   1. Registration + unregistration
 *   2. Start notification fires other sources' stops
 *   3. Start notification does NOT fire the started source's own stop
 *   4. Stop notification clears the currently-playing marker
 *   5. Change listeners fire on transitions
 *   6. Idempotent: starting the currently-playing source is a no-op
 *   7. Stop exceptions don't break iteration
 *   8. Unregistering the currently-playing source clears the marker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerPlaybackSource,
  notifyPlaybackStarted,
  notifyPlaybackStopped,
  getCurrentlyPlaying,
  onPlaybackChanged,
  setAlongsideSources,
  __resetPlaybackCoordinatorForTests,
} from '../playbackCoordinator'

describe('playbackCoordinator', () => {
  beforeEach(() => {
    __resetPlaybackCoordinatorForTests()
  })

  it('registers a source and unregisters via the returned function', () => {
    const stop = vi.fn()
    const unregister = registerPlaybackSource('A', stop)
    notifyPlaybackStarted('B') // A should be stopped because it's not B
    expect(stop).toHaveBeenCalledTimes(1)
    stop.mockClear()
    unregister()
    notifyPlaybackStarted('C') // A is unregistered — stop should NOT fire
    expect(stop).not.toHaveBeenCalled()
  })

  it('starting a source fires stop() on all OTHER registered sources', () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    const stopC = vi.fn()
    registerPlaybackSource('A', stopA)
    registerPlaybackSource('B', stopB)
    registerPlaybackSource('C', stopC)
    notifyPlaybackStarted('B')
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).not.toHaveBeenCalled() // self — NOT stopped
    expect(stopC).toHaveBeenCalledTimes(1)
  })

  it('starting a source does NOT fire its own stop callback', () => {
    const stop = vi.fn()
    registerPlaybackSource('A', stop)
    notifyPlaybackStarted('A')
    expect(stop).not.toHaveBeenCalled()
  })

  it('getCurrentlyPlaying reflects the last notifyPlaybackStarted', () => {
    expect(getCurrentlyPlaying()).toBeNull()
    notifyPlaybackStarted('A')
    expect(getCurrentlyPlaying()).toBe('A')
    notifyPlaybackStarted('B')
    expect(getCurrentlyPlaying()).toBe('B')
  })

  it('notifyPlaybackStopped clears the marker only if ids match', () => {
    notifyPlaybackStarted('A')
    notifyPlaybackStopped('B') // wrong id — no change
    expect(getCurrentlyPlaying()).toBe('A')
    notifyPlaybackStopped('A')
    expect(getCurrentlyPlaying()).toBeNull()
  })

  it('fires change listeners on every transition', () => {
    const listener = vi.fn()
    onPlaybackChanged(listener)
    notifyPlaybackStarted('A')
    expect(listener).toHaveBeenLastCalledWith('A')
    notifyPlaybackStarted('B')
    expect(listener).toHaveBeenLastCalledWith('B')
    notifyPlaybackStopped('B')
    expect(listener).toHaveBeenLastCalledWith(null)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('starting the already-currently-playing source is a no-op', () => {
    const stop = vi.fn()
    registerPlaybackSource('A', stop)
    notifyPlaybackStarted('A')
    // Second identical notify should not fire any stops or changes.
    const listener = vi.fn()
    onPlaybackChanged(listener)
    notifyPlaybackStarted('A')
    expect(stop).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a throwing stop() does not prevent other stops from running', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stopA = vi.fn(() => {
      throw new Error('boom')
    })
    const stopB = vi.fn()
    const stopC = vi.fn()
    registerPlaybackSource('A', stopA)
    registerPlaybackSource('B', stopB)
    registerPlaybackSource('C', stopC)
    notifyPlaybackStarted('D') // stops all three
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).toHaveBeenCalledTimes(1)
    expect(stopC).toHaveBeenCalledTimes(1)
    consoleWarn.mockRestore()
  })

  it('unregistering the currently-playing source clears the marker', () => {
    const stop = vi.fn()
    const unregister = registerPlaybackSource('A', stop)
    notifyPlaybackStarted('A')
    expect(getCurrentlyPlaying()).toBe('A')
    unregister()
    expect(getCurrentlyPlaying()).toBeNull()
  })

  it('unsubscribing from onPlaybackChanged stops the listener', () => {
    const listener = vi.fn()
    const unsub = onPlaybackChanged(listener)
    notifyPlaybackStarted('A')
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    notifyPlaybackStarted('B')
    expect(listener).toHaveBeenCalledTimes(1) // no new calls
  })

  it('re-registering a source with the same id replaces the callback', () => {
    const oldStop = vi.fn()
    const newStop = vi.fn()
    registerPlaybackSource('A', oldStop)
    registerPlaybackSource('A', newStop)
    notifyPlaybackStarted('B')
    expect(oldStop).not.toHaveBeenCalled()
    expect(newStop).toHaveBeenCalledTimes(1)
  })

  // #2427 — a viz background's own example sound plays alongside patterns
  describe('sources that play alongside', () => {
    it('a pattern starting does not stop an alongside source, and still stops the rest', () => {
      const sample = vi.fn()
      const drums = vi.fn()
      registerPlaybackSource('__sample__', sample)
      registerPlaybackSource('__drums__', drums)
      setAlongsideSources(['__sample__'])
      notifyPlaybackStarted('song.strudel')
      expect(sample).not.toHaveBeenCalled()
      expect(drums).toHaveBeenCalledTimes(1)
    })

    it('an alongside source starting stops nothing, and does not take the playing marker', () => {
      const pattern = vi.fn()
      registerPlaybackSource('song.strudel', pattern)
      notifyPlaybackStarted('song.strudel')
      setAlongsideSources(['__sample__'])
      notifyPlaybackStarted('__sample__')
      expect(pattern).not.toHaveBeenCalled()
      expect(getCurrentlyPlaying()).toBe('song.strudel')
    })

    it('once no background uses it, the source is back under the one-at-a-time rule', () => {
      const sample = vi.fn()
      registerPlaybackSource('__sample__', sample)
      setAlongsideSources(['__sample__'])
      notifyPlaybackStarted('song.strudel')
      expect(sample).not.toHaveBeenCalled()
      notifyPlaybackStopped('song.strudel')
      setAlongsideSources([])
      notifyPlaybackStarted('song.strudel')
      expect(sample).toHaveBeenCalledTimes(1)
    })
  })
})
