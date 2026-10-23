/**
 * #2209 — a worker viz's runtime error reaches the Console named by its file.
 *
 * The worker builds its hydra rows (reactive fn, draw()) without a file: it
 * doesn't know one. The renderer that re-emits them does — `name` is the
 * workspace path — and a row needs a file for its squiggle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { WorkerVizRenderer } from '../renderers/WorkerVizRenderer'
import { setVizWorkerFactory } from '../vizWorkerFactory'
import { __resetEngineLogForTests, getLogHistory } from '../../engine/engineLog'
import type { EngineComponents } from '../../engine/LiveCodingEngine'

/** A Worker stand-in that lets the test speak as the worker. */
class FakeWorker {
  private listeners: Array<(ev: MessageEvent) => void> = []
  postMessage(): void {}
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    if (type === 'message') this.listeners.push(fn)
  }
  removeEventListener(): void {}
  terminate(): void {}
  say(data: unknown): void {
    for (const fn of this.listeners) fn({ data } as MessageEvent)
  }
}

let worker: FakeWorker

function mount(name: string): void {
  const r = new WorkerVizRenderer('hydra', 's.osc().out()', name)
  r.mount(document.createElement('div'), {} as Partial<EngineComponents>, { w: 400, h: 300 }, () => {})
}

beforeEach(() => {
  __resetEngineLogForTests()
  worker = new FakeWorker()
  setVizWorkerFactory(() => worker as unknown as Worker)
  ;(HTMLCanvasElement.prototype as unknown as Record<string, unknown>).transferControlToOffscreen =
    function transferControlToOffscreen() {
      return {} as OffscreenCanvas
    }
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  setVizWorkerFactory(null)
  vi.unstubAllGlobals()
})

describe('WorkerVizRenderer — worker rows name their file (#2209)', () => {
  it('a row the worker sent without a file is written with this renderer’s file', () => {
    mount('preset/viz/kaleidoscope.hydra')
    worker.say({
      type: 'vizlog',
      entry: { level: 'error', runtime: 'hydra', message: "reactive fn: Cannot read properties of undefined (reading 'x')", line: 2 },
    })
    expect(getLogHistory().map((e) => [e.runtime, e.source, e.line])).toEqual([
      ['hydra', 'preset/viz/kaleidoscope.hydra', 2],
    ])
  })

  it('a row that already names its file keeps it', () => {
    mount('preset/viz/kaleidoscope.hydra')
    worker.say({
      type: 'vizlog',
      entry: { level: 'error', runtime: 'p5', source: 'sketch.p5', message: 'draw(): boom', line: 4 },
    })
    expect(getLogHistory().map((e) => e.source)).toEqual(['sketch.p5'])
  })
})
