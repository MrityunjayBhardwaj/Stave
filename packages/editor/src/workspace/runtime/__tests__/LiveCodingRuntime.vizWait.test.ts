/**
 * #2560 — Play waits for the pattern's sketches, capped.
 *
 * A Play from a stopped transport publishes (the zones adopt their warm
 * sketches, the background is already mounted), then holds the engine's start
 * until every registered sketch has loaded — but never past
 * PLAY_VIZ_WAIT_CAP_MS, so a sketch that never loads can't hold the music. Stop
 * ends the wait; a re-evaluate of a running song never waits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LiveCodingRuntime } from '../LiveCodingRuntime'
import { __resetWorkspaceAudioBusForTests } from '../../WorkspaceAudioBus'
import type { LiveCodingEngine } from '../../../engine/LiveCodingEngine'
import type { VizRenderer } from '../../../visualizers/types'
import {
  PLAY_VIZ_WAIT_CAP_MS,
  trackPatternVizLoad,
  isWaitingForVisuals,
  pendingPatternVizLoads,
  waitForPatternViz,
  __resetVizLoadGateForTests,
} from '../../../visualizers/vizLoadGate'

function mockEngine() {
  const log: string[] = []
  const engine = {
    init: vi.fn(async () => {
      log.push('init')
    }),
    evaluate: vi.fn(async () => {
      log.push('evaluate')
      return {}
    }),
    play: vi.fn(() => {
      log.push('play')
    }),
    stop: vi.fn(() => {
      log.push('stop')
    }),
    dispose: vi.fn(),
    get components() {
      return {}
    },
    setRuntimeErrorHandler: vi.fn(),
  } as unknown as LiveCodingEngine & { play: ReturnType<typeof vi.fn> }
  return { engine, log }
}

/** A sketch whose load the test settles by hand. */
function sketch(): { renderer: VizRenderer; load: () => void } {
  let load!: () => void
  const loaded = new Promise<void>((r) => {
    load = r
  })
  const renderer = { whenLoaded: () => loaded } as unknown as VizRenderer
  return { renderer, load }
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetWorkspaceAudioBusForTests()
  __resetVizLoadGateForTests()
})
afterEach(() => {
  vi.useRealTimers()
  __resetVizLoadGateForTests()
})

describe('Play waits for the pattern sketches (#2560)', () => {
  it('holds the engine start until a loading sketch is ready', async () => {
    const { engine } = mockEngine()
    const s = sketch()
    trackPatternVizLoad(s.renderer)
    const rt = new LiveCodingRuntime('f', engine, () => 'code')
    const p = rt.play()
    await vi.advanceTimersByTimeAsync(3000)
    expect(engine.play).not.toHaveBeenCalled()
    expect(isWaitingForVisuals()).toBe(true)
    expect(rt.getIsPlaying()).toBe(false)
    s.load()
    await p
    expect(engine.play).toHaveBeenCalledTimes(1)
    expect(isWaitingForVisuals()).toBe(false)
    expect(rt.getIsPlaying()).toBe(true)
  })

  it('starts the music at the cap when a sketch never loads', async () => {
    const { engine } = mockEngine()
    trackPatternVizLoad(sketch().renderer) // never loads
    const rt = new LiveCodingRuntime('f', engine, () => 'code')
    const p = rt.play()
    await vi.advanceTimersByTimeAsync(PLAY_VIZ_WAIT_CAP_MS - 10)
    expect(engine.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    await p
    expect(engine.play).toHaveBeenCalledTimes(1)
    expect(rt.getIsPlaying()).toBe(true)
    expect(isWaitingForVisuals()).toBe(false)
  })

  it('Stop during the wait ends it and keeps the transport stopped', async () => {
    const { engine } = mockEngine()
    trackPatternVizLoad(sketch().renderer)
    const rt = new LiveCodingRuntime('f', engine, () => 'code')
    const p = rt.play()
    await vi.advanceTimersByTimeAsync(500)
    expect(isWaitingForVisuals()).toBe(true)
    rt.stop()
    await p
    expect(isWaitingForVisuals()).toBe(false)
    await vi.advanceTimersByTimeAsync(PLAY_VIZ_WAIT_CAP_MS)
    expect(engine.play).not.toHaveBeenCalled()
    expect(rt.getIsPlaying()).toBe(false)
  })

  it('plays at once when nothing is loading', async () => {
    const { engine } = mockEngine()
    const s = sketch()
    trackPatternVizLoad(s.renderer)
    s.load()
    await Promise.resolve()
    expect(pendingPatternVizLoads()).toBe(0)
    const rt = new LiveCodingRuntime('f', engine, () => 'code')
    await rt.play()
    expect(engine.play).toHaveBeenCalledTimes(1)
  })

  it('a re-evaluate of a running song never waits', async () => {
    const { engine } = mockEngine()
    const rt = new LiveCodingRuntime('f', engine, () => 'code')
    await rt.play()
    expect(engine.play).toHaveBeenCalledTimes(1)
    trackPatternVizLoad(sketch().renderer) // a new sketch, still loading
    await rt.play() // re-evaluate while playing
    expect(engine.play).toHaveBeenCalledTimes(2)
  })
})

describe('waitForPatternViz (#2560)', () => {
  it('outcomes: none, loaded, cap, cancelled', async () => {
    expect(await waitForPatternViz()).toBe('none')

    const a = sketch()
    trackPatternVizLoad(a.renderer)
    const w1 = waitForPatternViz(1000)
    a.load()
    expect(await w1).toBe('loaded')

    trackPatternVizLoad(sketch().renderer)
    const w2 = waitForPatternViz(1000)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await w2).toBe('cap')

    let cancel!: () => void
    const w3 = waitForPatternViz(1000, new Promise<void>((r) => (cancel = r)))
    cancel()
    expect(await w3).toBe('cancelled')
  })

  it('a cap of 0 never waits (the "start at once" setting)', async () => {
    trackPatternVizLoad(sketch().renderer)
    expect(await waitForPatternViz(0)).toBe('none')
  })

  it('a renderer without whenLoaded is taken as loaded', () => {
    trackPatternVizLoad({} as VizRenderer)
    expect(pendingPatternVizLoads()).toBe(0)
  })
})
