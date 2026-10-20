// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrudelEngine } from '../StrudelEngine'

/**
 * #1627 — the ENGINE's side of the transport hold: `play`, `resume`, `stop`,
 * `pause` and `dispose` must each go through it. `transportHold.test.ts` pins
 * the hold's own rules with a fake transport; these arms pin that the engine's
 * public transport methods are wired to it, which a browser gate alone would
 * leave uncovered on a checkout that skips the browser.
 *
 * Same approach as `StrudelEngine.breakpoint.test.ts`: a stub `repl.scheduler`
 * on the private field, and a render stood in for by a promise the arm settles.
 */
describe('#1627 — StrudelEngine transport methods go through the render hold', () => {
  type FakeScheduler = {
    started: boolean
    start: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  let engine: StrudelEngine

  function fakeScheduler(started: boolean): FakeScheduler {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const s: FakeScheduler = {
      started,
      start: vi.fn<(...args: any[]) => any>(async () => { s.started = true }),
      pause: vi.fn<(...args: any[]) => any>(() => { s.started = false }),
      stop: vi.fn<(...args: any[]) => any>(() => { s.started = false }),
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return s
  }

  function install(s: FakeScheduler): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(engine as any).repl = { scheduler: s }
  }

  /** Hold the transport the way `renderOfflineReport` does; `release()` ends the render. */
  function startRender(): { release: () => void; done: Promise<unknown> } {
    let release!: () => void
    const render = new Promise<void>((r) => { release = r })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const done = (engine as any).transportHold.hold(() => render)
    return { release, done }
  }

  beforeEach(() => {
    engine = new StrudelEngine()
  })

  it('a playing transport is paused for the render and started again after it', async () => {
    const s = fakeScheduler(true)
    install(s)
    const r = startRender()
    expect(s.pause).toHaveBeenCalledTimes(1)
    r.release()
    await r.done
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it('play() during a render does not start the scheduler until the render ends', async () => {
    const s = fakeScheduler(false)
    install(s)
    const r = startRender()
    engine.play()
    expect(s.start, 'Play must not start into the render').not.toHaveBeenCalled()
    r.release()
    await r.done
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it('resume() during a render is deferred the same way', async () => {
    const s = fakeScheduler(false)
    install(s)
    const r = startRender()
    engine.resume()
    expect(s.start).not.toHaveBeenCalled()
    r.release()
    await r.done
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it('stop() during a render is not undone when the render ends', async () => {
    const s = fakeScheduler(true)
    install(s)
    const r = startRender()
    engine.stop()
    r.release()
    await r.done
    expect(s.start).not.toHaveBeenCalled()
  })

  it('pause() during a render is not undone when the render ends', async () => {
    const s = fakeScheduler(true)
    install(s)
    const r = startRender()
    engine.pause()
    r.release()
    await r.done
    expect(s.start).not.toHaveBeenCalled()
  })

  it('dispose() during a render does not start the scheduler of a repl built after it', async () => {
    const s = fakeScheduler(true)
    install(s)
    const r = startRender()
    engine.dispose()
    // dispose() drops the repl, so resuming it would be a silent no-op; the
    // hazard is the NEXT repl, which a later init() installs while the render
    // that was running is still to finish.
    const next = fakeScheduler(false)
    install(next)
    r.release()
    await r.done
    expect(next.start, 'a disposed engine must not restart playback').not.toHaveBeenCalled()
  })
})
