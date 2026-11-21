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
  optionsKey,
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
/** warm requests for these names, each writing no options */
const req = (...names: string[]) => names.map((vizId) => ({ vizId, options: {} }))

beforeEach(() => {
  __resetInlineVizWarmupForTests()
  __resetVizLoadGateForTests()
})

describe('warmInlineViz (#2560)', () => {
  it('builds each named sketch hidden and paused, marked as a warm-up before mount', () => {
    const made: Fake[] = []
    const d = descriptor('Exchange', made)
    warmInlineViz('f', req('Exchange'), [d], SIZE)
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
    warmInlineViz('f', req('A', 'A'), [a, b], SIZE) // two tracks show A
    expect(made).toHaveLength(2)
    warmInlineViz('f', req('A', 'B'), [a, b], SIZE)
    expect(made).toHaveLength(3) // one A kept, one A destroyed, B built
    expect(made.filter((r) => r.calls.includes('destroy'))).toHaveLength(1)
    warmInlineViz('f', req(), [a, b], SIZE)
    expect(made.every((r) => r.calls.includes('destroy'))).toBe(true)
    expect(warmInlineVizCount()).toBe(0)
    expect(document.querySelectorAll('[data-viz-warm]')).toHaveLength(0)
  })

  it('a name that resolves to nothing warms nothing', () => {
    warmInlineViz('f', req('Nope'), [], SIZE)
    expect(warmInlineVizCount()).toBe(0)
  })

  it('a descriptor rebuilt from the same code keeps its warm sketch; changed code rebuilds', () => {
    const made: Fake[] = []
    const v1 = descriptor('A', made)
    setVizDescriptorSource(v1, 'three:code-1')
    warmInlineViz('f', req('A'), [v1], SIZE)
    const v1again = descriptor('A', made)
    setVizDescriptorSource(v1again, 'three:code-1')
    warmInlineViz('f', req('A'), [v1again], SIZE)
    expect(made).toHaveLength(1)
    const v2 = descriptor('A', made)
    setVizDescriptorSource(v2, 'three:code-2')
    warmInlineViz('f', req('A'), [v2], SIZE)
    expect(made).toHaveLength(2)
    expect(made[0].calls).toContain('destroy')
  })

  it('take hands one over and forgets it; release destroys the rest', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', req('A', 'A'), [a], SIZE)
    const got = takeWarmInlineViz('f', a, {})
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
    warmInlineViz('f', [{ vizId: 'A', options: { hue: 1 } }], [a], SIZE) // what the zone gets
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
      warmInlineViz('f', req('A'), [a], SIZE, play1.offerForReuse!())
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

// #2630 — a sketch may read `stave.options` once, when its code runs at mount (a
// hydra `s.solid(o.r, o.g, o.b)`). Warmed with no options and adopted at Play, it
// drew its defaults for good. So it warms with the options the code writes, and
// Play adopts it only when the zone's options are the same.
describe('a warm sketch carries the options it was mounted with (#2630)', () => {
  function editorWith(options: Record<string, unknown> | undefined) {
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
    const components = {
      inlineViz: { vizRequests: new Map([['$0', { vizId: 'A', afterLine: 1, ...(options ? { options } : {}) }]]) },
    } as never
    return { editor, components, domNodes }
  }
  const mountedOptions = (r: Fake) => (r.mount.mock.calls[0] as unknown[])[1] as { options: unknown }

  it('mounts with the options the code writes', () => {
    const made: Fake[] = []
    warmInlineViz('f', [{ vizId: 'A', options: { r: 1, g: 0, b: 0 } }], [descriptor('A', made)], SIZE)
    expect(mountedOptions(made[0]).options).toEqual({ r: 1, g: 0, b: 0 })
  })

  it('options only an evaluation can tell warm as none', () => {
    const made: Fake[] = []
    warmInlineViz('f', [{ vizId: 'A', options: null }], [descriptor('A', made)], SIZE)
    expect(mountedOptions(made[0]).options).toEqual({})
  })

  it('Play adopts it when the zone gets the same options, in any key order', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', [{ vizId: 'A', options: { r: 1, g: 0, b: 0 } }], [a], SIZE)
    const { editor, components } = editorWith({ b: 0, g: 0, r: 1 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addInlineViewZones(editor as any, components, [a], undefined, 'f')
    expect(made).toHaveLength(1)
    expect(made[0].mount).toHaveBeenCalledTimes(1)
  })

  it('Play builds it fresh, with the zone\'s options, when the warm one had others', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', req('A'), [a], SIZE) // warmed with none
    const { editor, components } = editorWith({ r: 1, g: 0, b: 0 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addInlineViewZones(editor as any, components, [a], undefined, 'f')
    expect(made).toHaveLength(2) // not adopted: built again
    expect(mountedOptions(made[1]).options).toEqual({ r: 1, g: 0, b: 0 })
    expect(made[1].markWarmUp).not.toHaveBeenCalled()
    releaseWarmInlineViz('f') // Play lets the surplus go
    expect(made[0].calls).toContain('destroy')
  })

  it('a change to the options the code writes rebuilds the warm sketch', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    warmInlineViz('f', [{ vizId: 'A', options: { r: 1 } }], [a], SIZE)
    warmInlineViz('f', [{ vizId: 'A', options: { r: 1 } }], [a], SIZE)
    expect(made).toHaveLength(1) // unchanged: kept
    warmInlineViz('f', [{ vizId: 'A', options: { r: 0 } }], [a], SIZE)
    expect(made).toHaveLength(2)
    expect(made[0].calls).toContain('destroy')
    expect(mountedOptions(made[1]).options).toEqual({ r: 0 })
  })

  it('after Stop, a zone sketch is reused only for the same options', () => {
    const made: Fake[] = []
    const a = descriptor('A', made)
    const { editor, components } = editorWith({ r: 1 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const play1 = addInlineViewZones(editor as any, components, [a], undefined, 'f')
    play1.pause()
    warmInlineViz('f', [{ vizId: 'A', options: { r: 0 } }], [a], SIZE, play1.offerForReuse!())
    expect(made).toHaveLength(2) // the code now writes other options: a new warm copy
    expect(made[0].destroy).not.toHaveBeenCalled() // the zone still owns its own
    warmInlineViz('f', [{ vizId: 'A', options: { r: 1 } }], [a], SIZE, play1.offerForReuse!())
    expect(made).toHaveLength(2) // the zone's sketch, reused
    expect(warmInlineVizCount('f')).toBe(1)
  })

  it('the options key ignores key order and never matches what JSON cannot write', () => {
    expect(optionsKey({ a: 1, b: { y: [1, 2], x: 'q' } })).toBe(optionsKey({ b: { x: 'q', y: [1, 2] }, a: 1 }))
    expect(optionsKey({})).toBe(optionsKey(null))
    const fn = () => 1
    expect(optionsKey({ f: fn })).not.toBe(optionsKey({ f: fn }))
    class Pat {}
    expect(optionsKey({ label: new Pat() })).not.toBe(optionsKey({ label: new Pat() }))
  })
})
