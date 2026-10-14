// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  interruptBackgroundRenders,
  offlineGraphBusy,
  onLiveGraph,
  registerBackgroundRender,
  withOfflineGraph,
  whenGraphFree,
  withUserRender,
  type BackgroundRenderer,
} from './offlineGraph'
import { createTrackEnvelopeScheduler, type TrackEnvelopeScheduler } from './trackEnvelopes'

/**
 * #1733 — superdough's globals are one per page, so the rules for borrowing them
 * are page-wide. Driven with plain promises; the renders are fakes.
 */

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A background renderer that only answers `interrupt`. */
const interruptOnly = (interrupt: () => Promise<void> | null): BackgroundRenderer => ({
  interrupt,
  exclusive: (fn) => fn(),
})

describe('withOfflineGraph', () => {
  it('never lets two renders borrow the graph at once, from any engine', async () => {
    const log: string[] = []
    let releaseA!: () => void
    const a = withOfflineGraph(async () => {
      log.push('a start')
      await new Promise<void>((r) => (releaseA = r))
      log.push('a end')
      return 'a'
    })
    const b = withOfflineGraph(async () => {
      log.push('b start')
      return 'b'
    })
    await tick()
    expect(log).toEqual(['a start'])
    expect(offlineGraphBusy()).toBe(true)
    releaseA()
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(log).toEqual(['a start', 'a end', 'b start'])
    expect(offlineGraphBusy()).toBe(false)
  })

  it('a render that fails still hands the graph on', async () => {
    const failed = withOfflineGraph(async () => {
      throw new Error('boom')
    })
    const next = withOfflineGraph(async () => 'next')
    await expect(failed).rejects.toThrow('boom')
    expect(await next).toBe('next')
  })
})

describe('onLiveGraph', () => {
  it('plays at once, in the same call, when nothing is rendering', () => {
    let played = false
    onLiveGraph(() => {
      played = true
    })
    expect(played).toBe(true)
  })

  it('interrupts a background render and plays once it has let go', async () => {
    let letGo!: () => void
    let interrupted = 0
    const off = registerBackgroundRender(interruptOnly(() => {
      interrupted++
      return new Promise<void>((r) => (letGo = r))
    }))
    try {
      let played = false
      onLiveGraph(() => {
        played = true
      })
      expect(interrupted).toBe(1)
      await tick()
      expect(played).toBe(false) // the render still holds the graph
      letGo()
      await tick()
      expect(played).toBe(true)
    } finally {
      off()
    }
  })

  it('asks every registered renderer, and none after it is removed', () => {
    const asked: string[] = []
    const offA = registerBackgroundRender(interruptOnly(() => (asked.push('a'), null)))
    const offB = registerBackgroundRender(interruptOnly(() => (asked.push('b'), null)))
    expect(interruptBackgroundRenders()).toBeNull()
    offA()
    offB()
    expect(interruptBackgroundRenders()).toBeNull()
    expect(asked).toEqual(['a', 'b'])
  })
})

/**
 * #1735 — one file's engine, as far as the page lock can see it: a real display
 * scheduler whose renders borrow the graph through `withOfflineGraph`. A render
 * runs until `finish` is called or its signal aborts, which is when a real one
 * lets go at its next pause.
 */
function fileEngine(name: string, log: string[]) {
  let finish: (() => void) | null = null
  const scheduler: TrackEnvelopeScheduler = createTrackEnvelopeScheduler({
    isPlaying: () => false,
    cps: () => 0.5,
    exists: () => true,
    fingerprint: (id) => id,
    render: (id, _cycles, signal) =>
      withOfflineGraph(
        () =>
          new Promise((resolve, reject) => {
            log.push(`${name} render ${id}`)
            finish = () => resolve({ data: new Float32Array([-1, 1]), columns: 1, cycles: 4 })
            signal.addEventListener('abort', () => {
              log.push(`${name} let go`)
              reject(new Error('cancelled'))
            })
          }),
      ),
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    onChange: () => {},
    debounceMs: 5,
    capSeconds: 1000,
  })
  const off = registerBackgroundRender(scheduler)
  return {
    scheduler,
    finish: () => finish?.(),
    status: () => scheduler.status(),
    dispose: () => {
      off()
      scheduler.dispose()
    },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 30))

describe('withUserRender', () => {
  it("does not wait out ANOTHER file's display render: that one lets go at once", async () => {
    const log: string[] = []
    const a = fileEngine('A', log)
    const b = fileEngine('B', log)
    try {
      b.scheduler.request(['t'], 4)
      await settle()
      expect(b.status().rendering).toBe('t')
      // File A bounces while file B's render is in flight and never finishes
      // on its own.
      const bounce = withUserRender(() =>
        withOfflineGraph(async () => {
          log.push('A bounce')
          return 'wav'
        }),
      )
      expect(await bounce).toBe('wav')
      expect(log).toEqual(['B render t', 'B let go', 'A bounce'])
    } finally {
      a.dispose()
      b.dispose()
    }
  })

  it('keeps every file from starting a render until the whole user render ends', async () => {
    const log: string[] = []
    const a = fileEngine('A', log)
    const b = fileEngine('B', log)
    try {
      b.scheduler.request(['t'], 4)
      await settle()
      // A stems export: two renders with a pause between them far longer than
      // the settle time a display render waits before starting.
      const stems = withUserRender(async () => {
        await withOfflineGraph(async () => log.push('A stem 1'))
        await settle()
        await withOfflineGraph(async () => log.push('A stem 2'))
      })
      // A render that slipped in between would hold stem 2 off: read the order
      // instead of waiting on it.
      await Promise.race([stems, new Promise((r) => setTimeout(r, 200))])
      expect(log).toEqual(['B render t', 'B let go', 'A stem 1', 'A stem 2'])
      await stems
      // … and file B's render comes back once it has ended.
      await settle()
      expect(log.at(-1)).toBe('B render t')
      b.finish()
      await settle()
      expect(b.scheduler.get('t')).not.toBeNull()
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})

describe('whenGraphFree (#2064)', () => {
  it('runs at once, in the same call, when no render holds the graph', () => {
    let ran = false
    whenGraphFree(() => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('waits while a render holds the graph, and runs once it lets go', async () => {
    let release!: () => void
    const render = withOfflineGraph(() => new Promise<void>((r) => (release = r)))
    await tick()
    const order: string[] = []
    whenGraphFree(() => order.push('free'))
    await tick()
    order.push('still rendering')
    release()
    await render
    await tick()
    expect(order).toEqual(['still rendering', 'free'])
  })

  it('waits for a render queued behind the one in flight too', async () => {
    let releaseA!: () => void
    let releaseB!: () => void
    const a = withOfflineGraph(() => new Promise<void>((r) => (releaseA = r)))
    const b = withOfflineGraph(() => new Promise<void>((r) => (releaseB = r)))
    await tick()
    let ran = false
    whenGraphFree(() => {
      ran = true
    })
    releaseA()
    await a
    await tick()
    const afterA = ran
    releaseB()
    await b
    await tick()
    expect([afterA, ran]).toEqual([false, true])
  })
})
