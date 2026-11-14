/**
 * FallbackVizRenderer (#247) — the startup-probation contract: a worker that
 * fails to start (throws or hangs before its first frame) degrades to the
 * main-thread renderer; a user-sketch error AFTER the worker is healthy does NOT
 * downgrade rendering. Pure unit test with fake renderers + fake timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { FallbackVizRenderer, PROBATION_MS } from '../renderers/FallbackVizRenderer'
import type { WorkerVizRenderer } from '../renderers/WorkerVizRenderer'
import type { VizRenderer } from '../types'

/** A fake renderer that records calls + exposes the onError it was mounted with. */
class FakeRenderer implements VizRenderer {
  mounted = false
  destroyed = false
  updates = 0
  resizes: Array<[number, number]> = []
  paused = false
  capturedOnError: ((e: Error) => void) | null = null
  mount(
    _c: HTMLDivElement,
    _comp: unknown,
    _s: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    this.mounted = true
    this.capturedOnError = onError
  }
  update(): void {
    this.updates++
  }
  resize(w: number, h: number): void {
    this.resizes.push([w, h])
  }
  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.paused = false
  }
  destroy(): void {
    this.destroyed = true
  }
}

/** A fake worker renderer — a FakeRenderer plus the `whenReady` / `whenAlive`
 *  hooks the wrapper arms before mount, and a `whenLoaded` it settles by hand. */
class FakeWorkerRenderer extends FakeRenderer {
  readyCb: (() => void) | null = null
  aliveCb: (() => void) | null = null
  warmed = false
  settleLoaded: () => void = () => {}
  private readonly loaded = new Promise<void>((r) => {
    this.settleLoaded = r
  })
  whenReady(cb: () => void): void {
    this.readyCb = cb
  }
  whenAlive(cb: () => void): void {
    this.aliveCb = cb
  }
  whenLoaded(): Promise<void> {
    return this.loaded
  }
  markWarmUp(): void {
    this.warmed = true
  }
}

/** A promise's state, read after the microtask queue drains. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(() => {
    done = true
  })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  return done
}

function makeContainer(): HTMLDivElement {
  return document.createElement('div')
}

describe('FallbackVizRenderer — startup probation (#247)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('worker error BEFORE ready → falls back to the main renderer', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    const onError = vi.fn()
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, onError)

    expect(worker.mounted).toBe(true)
    expect(main.mounted).toBe(false)

    // Worker throws at startup (e.g. the i18n import bug) — BEFORE any ready.
    worker.capturedOnError?.(new Error('import failed'))

    expect(worker.destroyed).toBe(true)
    expect(main.mounted).toBe(true)
    // The startup error is NOT surfaced to the host — it was recovered by falling back.
    expect(onError).not.toHaveBeenCalled()
  })

  it('worker error AFTER ready → surfaces, does NOT fall back (user sketch error)', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    const onError = vi.fn()
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, onError)

    // Worker drew its first frame → healthy.
    worker.readyCb?.()
    // Later, the user's sketch throws on a frame.
    const err = new Error('draw threw')
    worker.capturedOnError?.(err)

    expect(main.mounted).toBe(false) // no downgrade
    expect(worker.destroyed).toBe(false)
    expect(onError).toHaveBeenCalledWith(err) // surfaced normally
  })

  it('worker never frames within probation → timeout falls back', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())

    expect(main.mounted).toBe(false)
    vi.advanceTimersByTime(8001) // past PROBATION_MS
    expect(worker.destroyed).toBe(true)
    expect(main.mounted).toBe(true)
  })

  it('ready before timeout → no fallback on timer fire', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    worker.readyCb?.() // healthy before the timer
    vi.advanceTimersByTime(20000)
    expect(main.mounted).toBe(false)
    expect(worker.destroyed).toBe(false)
  })

  it('delegates update/resize/pause/destroy to the active renderer', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    worker.readyCb?.() // stay on the worker

    fb.update({})
    fb.resize(640, 480)
    fb.pause()
    fb.resume()
    fb.destroy()

    expect(worker.updates).toBe(1)
    expect(worker.resizes).toEqual([[640, 480]])
    expect(worker.destroyed).toBe(true)
  })

  it('after fallback, update/resize delegate to the MAIN renderer', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    worker.capturedOnError?.(new Error('boom')) // fall back

    fb.update({})
    fb.resize(800, 600)
    expect(main.updates).toBe(1)
    expect(main.resizes).toEqual([[800, 600]])
  })

  // ── #2560: the probation judges ALIVE (the worker took the mount), not LOADED
  // (its first frame). A heavy sketch loading a big asset before its first frame
  // is slow, not hung, and must stay off the main thread.
  it('an ALIVE worker that has not framed for 20 s is NOT moved to the main thread', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    worker.aliveCb?.() // took the mount; now loading a 4K HDRI…
    vi.advanceTimersByTime(20000) // far past PROBATION_MS, still no first frame
    expect(main.mounted).toBe(false)
    expect(worker.destroyed).toBe(false)
  })

  it('a worker that never answers is moved to the main thread after PROBATION_MS', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    vi.advanceTimersByTime(PROBATION_MS - 1)
    expect(main.mounted).toBe(false)
    vi.advanceTimersByTime(2)
    expect(worker.destroyed).toBe(true)
    expect(main.mounted).toBe(true)
  })

  it('a PAUSED worker is judged too: alive is not a frame, so pausing does not suspend it', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    fb.pause() // a hidden warm-up, or off-screen
    vi.advanceTimersByTime(PROBATION_MS + 1) // never answered
    expect(main.mounted).toBe(true)
    expect(main.paused).toBe(true) // and the fallback stays paused
  })

  it('a paused worker that answered stays on the worker however long it waits', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    fb.pause()
    worker.aliveCb?.()
    vi.advanceTimersByTime(60000)
    fb.resume()
    vi.advanceTimersByTime(60000)
    expect(main.mounted).toBe(false)
  })

  it('whenLoaded follows the worker, and settles at fallback and at destroy', async () => {
    const mk = () => {
      const worker = new FakeWorkerRenderer()
      const main = new FakeRenderer()
      const fb = new FallbackVizRenderer(
        () => worker as unknown as WorkerVizRenderer,
        () => main,
      )
      fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
      return { worker, fb }
    }
    const a = mk()
    expect(await settled(a.fb.whenLoaded())).toBe(false)
    a.worker.settleLoaded()
    expect(await settled(a.fb.whenLoaded())).toBe(true)

    const b = mk() // falls back to a main renderer with no loaded signal
    b.worker.capturedOnError?.(new Error('import failed'))
    expect(await settled(b.fb.whenLoaded())).toBe(true)

    const c = mk()
    c.fb.destroy()
    expect(await settled(c.fb.whenLoaded())).toBe(true)
  })

  it('markWarmUp reaches the worker renderer', () => {
    const worker = new FakeWorkerRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => new FakeRenderer(),
    )
    fb.markWarmUp()
    expect(worker.warmed).toBe(true)
  })

  it('resume after ready does NOT re-arm probation (already healthy)', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    worker.readyCb?.() // healthy
    fb.pause()
    fb.resume()
    vi.advanceTimersByTime(20000)
    expect(main.mounted).toBe(false) // no probation to re-arm
    expect(worker.destroyed).toBe(false)
  })

  it('fallback that occurs WHILE paused leaves the main renderer paused', () => {
    const worker = new FakeWorkerRenderer()
    const main = new FakeRenderer()
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => main,
    )
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, vi.fn())
    fb.pause()
    // A pre-ready worker ERROR still falls back immediately (error ≠ stuck) —
    // but the new main renderer must inherit the paused state, not start running.
    worker.capturedOnError?.(new Error('import failed'))
    expect(main.mounted).toBe(true)
    expect(main.paused).toBe(true)
  })

  it('a main renderer that cannot be built goes to onError, not out of the handler (#2220)', () => {
    // building the main renderer compiles the sketch; a syntax error threw out
    // of the worker-message handler to the global catch
    const worker = new FakeWorkerRenderer()
    const broken = new SyntaxError('Unexpected end of code')
    const fb = new FallbackVizRenderer(
      () => worker as unknown as WorkerVizRenderer,
      () => {
        throw broken
      },
    )
    const onError = vi.fn()
    fb.mount(makeContainer(), {}, { w: 100, h: 100 }, onError)
    expect(() => worker.capturedOnError?.(new Error('compile failed'))).not.toThrow()
    expect(onError).toHaveBeenCalledWith(broken)
    expect(worker.destroyed).toBe(true)
    // what's left is inert: the destroyed worker isn't driven or destroyed again
    worker.destroyed = false
    fb.update({})
    fb.resize(10, 10)
    fb.pause()
    fb.resume()
    fb.destroy()
    expect(worker.updates).toBe(0)
    expect(worker.resizes).toEqual([])
    expect(worker.destroyed).toBe(false)
  })
})
