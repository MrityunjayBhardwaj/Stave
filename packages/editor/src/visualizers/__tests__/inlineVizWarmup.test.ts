/**
 * #2560 — inline sketches warm up hidden before Play, and Play's zones adopt them.
 *
 *   - each inline viz the code names gets a renderer, marked as a warm-up BEFORE
 *     it mounts, mounted into a container parked in a hidden off-screen host, and
 *     paused — so nothing shows before Play;
 *   - the warm set follows the code: kept when still named, destroyed when not;
 *   - at Play, `addInlineViewZones` adopts the warm renderer — no second build,
 *     the warm container becomes the zone's node — and registers it with the
 *     Play gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VizDescriptor, VizRenderer } from '../types'
import {
  warmInlineViz,
  takeWarmInlineViz,
  releaseWarmInlineViz,
  warmInlineVizCount,
  setVizDescriptorSource,
  __resetInlineVizWarmupForTests,
} from '../inlineVizWarmup'
import { addInlineViewZones } from '../viewZones'
import { pendingPatternVizLoads, __resetVizLoadGateForTests } from '../vizLoadGate'

// the off-screen teardown wrapper on (its default) or off, per test
const teardown = { on: true }
vi.mock('../../workspace/editorRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workspace/editorRegistry')>()
  return { ...actual, getInlineVizTeardownMs: () => (teardown.on ? 60_000 : 0) }
})

vi.mock('p5', () => ({ default: vi.fn() }))

function fakeRenderer() {
  const calls: string[] = []
  let load!: () => void
  const loaded = new Promise<void>((r) => (load = r))
  const r = {
    calls,
    load,
    container: null as HTMLDivElement | null,
    markWarmUp: vi.fn(() => calls.push('markWarmUp')),
    mount: vi.fn((c: HTMLDivElement) => {
      calls.push('mount')
      r.container = c
      c.appendChild(document.createElement('canvas'))
    }),
    update: vi.fn(() => calls.push('update')),
    resize: vi.fn(() => calls.push('resize')),
    pause: vi.fn(() => calls.push('pause')),
    resume: vi.fn(() => calls.push('resume')),
    destroy: vi.fn(() => calls.push('destroy')),
    whenLoaded: () => loaded,
  }
  return r
}
type Fake = ReturnType<typeof fakeRenderer>

function descriptor(id: string, made: Fake[]): VizDescriptor {
  return {
    id,
    label: id,
    factory: () => {
      const r = fakeRenderer()
      made.push(r)
      return r as unknown as VizRenderer
    },
  }
}
const SIZE = () => ({ w: 400, h: 200 })

beforeEach(() => {
  __resetInlineVizWarmupForTests()
  __resetVizLoadGateForTests()
})

describe('warmInlineViz (#2560)', () => {
  it('builds each named sketch hidden and paused, marked as a warm-up before mount', () => {
    const made: Fake[] = []
    const d = descriptor('Exchange', made)
    warmInlineViz('f', ['Exchange'], [d], SIZE)
    expect(made).toHaveLength(1)
    expect(made[0].calls).toEqual(['markWarmUp', 'mount', 'pause'])
    const host = made[0].container!.parentElement!
    expect(host.hasAttribute('data-viz-warm-host')).toBe(true)
    expect(host.style.visibility).toBe('hidden')
    expect(host.style.position).toBe('fixed')
    expect(parseInt(host.style.left, 10)).toBeLessThan(-10000)
    expect(warmInlineVizCount('f')).toBe(1)
  })

  it('follows the code: keeps what is still named, destroys what is not, builds what is new', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    const b = descriptor('B', made)
    warmInlineViz('f', ['A', 'A'], [a, b], SIZE) // two tracks show A
    expect(made).toHaveLength(2)
    warmInlineViz('f', ['A', 'B'], [a, b], SIZE)
    expect(made).toHaveLength(3) // one A kept, one A destroyed, B built
    expect(made.filter((r) => r.calls.includes('destroy'))).toHaveLength(1)
    warmInlineViz('f', [], [a, b], SIZE)
    expect(made.every((r) => r.calls.includes('destroy'))).toBe(true)
    expect(warmInlineVizCount()).toBe(0)
    expect(document.querySelectorAll('[data-viz-warm]')).toHaveLength(0)
  })

  it('a name that resolves to nothing warms nothing', () => {
    warmInlineViz('f', ['Nope'], [], SIZE)
    expect(warmInlineVizCount()).toBe(0)
  })

  it('a descriptor rebuilt from the same code keeps its warm sketch; changed code rebuilds', () => {
    const made: Fake[] = []
    const v1 = descriptor('A', made)
    setVizDescriptorSource(v1, 'three:code-1')
    warmInlineViz('f', ['A'], [v1], SIZE)
    const v1again = descriptor('A', made)
    setVizDescriptorSource(v1again, 'three:code-1')
    warmInlineViz('f', ['A'], [v1again], SIZE)
    expect(made).toHaveLength(1)
    const v2 = descriptor('A', made)
    setVizDescriptorSource(v2, 'three:code-2')
    warmInlineViz('f', ['A'], [v2], SIZE)
    expect(made).toHaveLength(2)
    expect(made[0].calls).toContain('destroy')
  })

  it('take hands one over and forgets it; release destroys the rest', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', ['A', 'A'], [a], SIZE)
    const got = takeWarmInlineViz('f', a)
    expect(got?.renderer).toBe(made[0])
    expect(warmInlineVizCount('f')).toBe(1)
    releaseWarmInlineViz('f')
    expect(made[1].calls).toContain('destroy')
    expect(made[0].calls).not.toContain('destroy') // the taken one is the caller's
  })
})

describe('addInlineViewZones adopts a warm sketch (#2560)', () => {
  function makeEditor() {
    const domNodes: HTMLElement[] = []
    const accessor = {
      addZone: vi.fn((z: { domNode: HTMLElement }) => {
        domNodes.push(z.domNode)
        return `z${domNodes.length}`
      }),
      removeZone: vi.fn(),
    }
    const editor = {
      changeViewZones: (cb: (a: typeof accessor) => void) => cb(accessor),
      getLayoutInfo: () => ({ contentWidth: 800 }),
      getModel: () => ({ getValue: () => '$: s("bd").viz("A")', getLineMaxColumn: () => 80 }),
      onDidChangeModelContent: () => ({ dispose() {} }),
      onDidLayoutChange: () => ({ dispose() {} }),
      onDidScrollChange: () => ({ dispose() {} }),
      onMouseMove: () => ({ dispose() {} }),
      createDecorationsCollection: () => ({ getRanges: () => [], clear() {} }),
      getDomNode: () => null,
    }
    return { editor, domNodes }
  }
  const components = {
    inlineViz: { vizRequests: new Map([['$0', { vizId: 'A', afterLine: 1, options: { hue: 1 } }]]) },
  } as never

  it('uses the warm renderer and its container: no second build, live components handed over', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', ['A'], [a], SIZE)
    const warm = made[0]
    const warmContainer = warm.container!
    const { editor, domNodes } = makeEditor()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addInlineViewZones(editor as any, components, [a], undefined, 'f')
    expect(made).toHaveLength(1) // not built again
    expect(domNodes[0]).toBe(warmContainer) // the warm container IS the zone
    expect(warmContainer.hasAttribute('data-viz-warm')).toBe(false)
    expect(warmContainer.hasAttribute('data-viz-zone')).toBe(true)
    expect(warm.mount).toHaveBeenCalledTimes(1) // mounted once, at warm-up
    expect(warm.update).toHaveBeenCalled() // got the zone's live components
    expect(warmInlineVizCount('f')).toBe(0)
    expect(pendingPatternVizLoads()).toBe(1) // Play waits for it
    warm.load()
  })

  it('builds at Play, as before, when nothing is warm', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    const { editor } = makeEditor()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addInlineViewZones(editor as any, components, [a], undefined, 'f')
    expect(made).toHaveLength(1)
    expect(made[0].markWarmUp).not.toHaveBeenCalled() // a zone at Play is not a warm-up
    expect(made[0].mount).toHaveBeenCalledTimes(1)
  })
})

// #2560 — after Stop the zones keep their paused sketch on screen. The warm-up
// reuses it instead of building a second copy, so a heavy sketch is held once;
// the next Play adopts it, so Play still starts at once.
describe('after Stop, the warm-up reuses the zone sketch (#2560)', () => {
  function editorOf() {
    const domNodes: HTMLElement[] = []
    const accessor = {
      addZone: vi.fn((z: { domNode: HTMLElement }) => {
        domNodes.push(z.domNode)
        return `z${domNodes.length}`
      }),
      removeZone: vi.fn(),
    }
    const editor = {
      changeViewZones: (cb: (a: typeof accessor) => void) => cb(accessor),
      getLayoutInfo: () => ({ contentWidth: 800 }),
      getModel: () => ({ getValue: () => '$: s("bd").viz("A")', getLineMaxColumn: () => 80 }),
      onDidChangeModelContent: () => ({ dispose() {} }),
      onDidLayoutChange: () => ({ dispose() {} }),
      onDidScrollChange: () => ({ dispose() {} }),
      onMouseMove: () => ({ dispose() {} }),
      createDecorationsCollection: () => ({ getRanges: () => [], clear() {} }),
      getDomNode: () => null,
    }
    return { editor, domNodes }
  }
  const components = {
    inlineViz: { vizRequests: new Map([['$0', { vizId: 'A', afterLine: 1 }]]) },
  } as never

  for (const on of [true, false]) {
    it(`one instance per sketch across Stop and the next Play (teardown wrapper ${on ? 'on' : 'off'})`, () => {
      teardown.on = on
      const made: Fake[] = []
      const a = descriptor('A', made)
      const { editor, domNodes } = editorOf()
      // Play 1: built at Play (nothing warm yet)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const play1 = addInlineViewZones(editor as any, components, [a], undefined, 'f')
      expect(made).toHaveLength(1)
      play1.pause() // Stop: the zone keeps its paused sketch on screen

      // the warm-up after Stop reuses it: no second build
      warmInlineViz('f', ['A'], [a], SIZE, play1.offerForReuse!())
      expect(made).toHaveLength(1)
      expect(warmInlineVizCount('f')).toBe(1)

      // Play 2: the old zones go, the reused sketch survives and is adopted
      play1.cleanup()
      expect(made[0].destroy).not.toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addInlineViewZones(editor as any, components, [a], undefined, 'f')
      expect(made).toHaveLength(1)
      expect(made[0].mount).toHaveBeenCalledTimes(1)
      expect(domNodes[1]).toBe(domNodes[0]) // same node, re-added as the new zone
      expect(domNodes[1].querySelectorAll('[data-viz-zone-resize]')).toHaveLength(1) // no stale strip
      teardown.on = true
    })
  }

  it('a claimed sketch cannot be claimed twice', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    const { editor } = editorOf()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = addInlineViewZones(editor as any, components, [a], undefined, 'f')
    const [offer] = h.offerForReuse!()
    expect(offer.claim()).not.toBeNull()
    expect(offer.claim()).toBeNull()
  })
})
