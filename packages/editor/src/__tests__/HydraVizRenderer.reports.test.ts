/**
 * #2219 — the main-thread Hydra renderer writes its own errors to the Console.
 *
 * An inline `.viz()` view zone passes `console.error` as onError, so an error
 * left to the host never reached the Console. A renderer that knows its file
 * writes the row itself and marks the error, so the preview (which also writes
 * rows) doesn't write it twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('hydra-synth', () => {
  const Hydra = vi.fn(function (this: Record<string, unknown>) {
    const chain: Record<string, unknown> = {}
    for (const k of ['osc', 'out']) chain[k] = vi.fn(() => chain)
    this.synth = Object.assign(chain, { a: { fft: [0, 0, 0, 0] } })
    this.a = { fft: [0, 0, 0, 0], setCutoff: vi.fn(), setBins: vi.fn() }
    this.tick = vi.fn()
    this.setResolution = vi.fn()
  })
  return { default: Hydra }
})
// makeHydraRenderer reads the worker gate from the p5 factory, whose module pulls
// in p5 → gifenc (the vitest loader can't take it); the main-thread path is the one under test.
vi.mock('../visualizers/renderers/makeP5Renderer', () => ({ shouldUseWorkerRenderer: () => false }))

import { HydraVizRenderer } from '../visualizers/renderers/HydraVizRenderer'
import { makeHydraRenderer } from '../visualizers/renderers/makeHydraRenderer'
import { compileHydraCode } from '../visualizers/hydraCompiler'
import { isReportedVizError } from '../visualizers/reportedVizErrors'
import { __resetEngineLogForTests, getLogHistory } from '../engine/engineLog'
import type { VizRenderer } from '../visualizers/types'

async function mountAndSettle(renderer: VizRenderer): Promise<Error[]> {
  const errors: Error[] = []
  renderer.mount(document.createElement('div'), {}, { w: 400, h: 300 }, (e) => errors.push(e))
  // initHydra awaits a dynamic import; let the chain settle
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  return errors
}

const rows = () => getLogHistory().map((e) => [e.runtime, e.source, e.message])

beforeEach(() => {
  __resetEngineLogForTests()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

describe('HydraVizRenderer — the errors it reports itself (#2219)', () => {
  it('a sketch that throws at mount is one row against its file, and the error is marked', async () => {
    const errors = await mountAndSettle(
      new HydraVizRenderer(compileHydraCode('osc(10).out()'), 'preset/viz/kaleidoscope.hydra'),
    )
    expect(rows()).toEqual([['hydra', 'preset/viz/kaleidoscope.hydra', '`osc` is on `s` here — write `s.osc(…)`.']])
    // the host still hears about it, and can tell it is already in the Console
    expect(errors).toHaveLength(1)
    expect(isReportedVizError(errors[0])).toBe(true)
  })

  it('a sketch that does not compile is reported at mount, on the line it was located at (#2220)', async () => {
    let renderer: VizRenderer | null = null
    expect(() => { renderer = makeHydraRenderer('s.osc(10).out(', 'preset/viz/kaleidoscope.hydra') }).not.toThrow()
    const errors = await mountAndSettle(renderer!)
    expect(getLogHistory().map((e) => [e.runtime, e.source, e.line, e.column, e.message])).toEqual([
      ['hydra', 'preset/viz/kaleidoscope.hydra', 1, 15, 'Unexpected end of code'],
    ])
    expect(errors[0].name).toBe('SyntaxError')
  })

  it('without a file (a built-in sketch) it leaves the error to the host, as before', async () => {
    const errors = await mountAndSettle(new HydraVizRenderer(compileHydraCode('osc(10).out()')))
    expect(rows()).toEqual([])
    expect(errors).toHaveLength(1)
    expect(isReportedVizError(errors[0])).toBe(false)
  })
})
