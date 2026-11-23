/**
 * #2516 — the three.js sketch core: imports, the page shims, the frame pump and
 * teardown. jsdom has no WebGL, so the renderer is a fake built the way three's
 * own is: every method assigned per instance in the constructor (WebGLRenderer.js
 * `this.render = function …`), which is exactly what a prototype override would
 * miss.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  compileThreeSketch,
  loadThreeModules,
  runThreeSketch,
  ThreeImportError,
  THREE_LINE_OFFSET,
  type ThreeModules,
  type ThreeSketchHost,
} from '../threeSketch'
import { HOST_CHAIN } from '../../libraries/hostModules'
import type { ImportChain } from '../../libraries/resolver'

function fakeThree() {
  const made: FakeRenderer[] = []
  class FakeRenderer {
    canvas: unknown
    renders = 0
    disposed = false
    lost = false
    internalLoopStarted = false
    setAnimationLoop: (cb: unknown) => void
    render: (s: unknown, c: unknown) => void
    dispose: () => void
    forceContextLoss: () => void
    getContext: () => { isContextLost: () => boolean }
    setSize: (w: number, h: number, u?: boolean) => void
    size = { w: 0, h: 0 }
    styleWrites = 0
    constructor(params: { canvas?: unknown } = {}) {
      this.canvas = params.canvas
      made.push(this)
      // three's own setAnimationLoop starts an rAF-driven animation of its own
      this.setAnimationLoop = () => {
        this.internalLoopStarted = true
      }
      this.render = () => {
        this.renders++
      }
      this.dispose = () => {
        this.disposed = true
      }
      this.forceContextLoss = () => {
        this.lost = true
      }
      this.getContext = () => ({ isContextLost: () => this.lost })
      // three's own: updateStyle defaults to true and writes canvas.style
      this.setSize = (w, h, updateStyle = true) => {
        this.size = { w, h }
        if (updateStyle) this.styleWrites++
      }
    }
  }
  const THREE = { WebGLRenderer: FakeRenderer, TextureLoader: class {}, Scene: class {}, marker: 'three' }
  return { THREE, made }
}

function makeHost(over: Partial<ThreeSketchHost> = {}) {
  const reports: { level: string; message: string; line?: number }[] = []
  let size = { w: 320, h: 200 }
  const uniforms = { sig: Object.assign(() => ({}), { bass: 0.5, kick: 0 }) } as never
  const host: ThreeSketchHost = {
    canvas: document.createElement('canvas'),
    size: () => size,
    dpr: () => 2,
    uniforms: () => uniforms,
    options: () => ({ hue: 0.3 }),
    scheduler: () => null,
    createCanvas: () => document.createElement('canvas'),
    report: (e) => reports.push(e),
    ...over,
  }
  return { host, reports, setSize: (s: { w: number; h: number }) => (size = s) }
}

async function start(code: string, over: Partial<ThreeSketchHost> = {}) {
  const compiled = compileThreeSketch(code)
  expect(compiled.syntaxError).toBeNull()
  const fake = fakeThree()
  const loaded: ThreeModules = { THREE: fake.THREE, modules: compiled.imports.map(() => null) }
  const h = makeHost(over)
  const run = runThreeSketch(compiled, loaded, h.host)
  const result = await run.done
  return { run, result, ...h, made: fake.made, out: (globalThis as Record<string, unknown>).__out as Record<string, unknown> }
}

describe('compileThreeSketch', () => {
  it('binds imports up front and keeps every line where it was written', () => {
    const code = [
      "import * as THREE from 'three'",
      "import { RoomEnvironment as Room } from 'three/addons/environments/RoomEnvironment.js'",
      '',
      'const x = 1',
    ].join('\n')
    const c = compileThreeSketch(code)
    expect(c.imports).toEqual([
      { spec: 'three', line: 1 },
      { spec: 'three/addons/environments/RoomEnvironment.js', line: 2 },
    ])
    expect(c.source).toContain('const THREE = __mod[0];')
    expect(c.source).toContain('const Room = __mod[1].RoomEnvironment;')
    // user line 4 sits THREE_LINE_OFFSET - 2 lines into the body (V8 adds two)
    const bodyLines = c.source.split('\n')
    expect(bodyLines[4 + THREE_LINE_OFFSET - 3]).toBe('const x = 1')
  })

  it('gives a syntax error its line in the file', () => {
    const c = compileThreeSketch("import * as THREE from 'three'\n\nconst a = (\n")
    expect(c.syntaxError).not.toBeNull()
    expect(c.syntaxError!.line).toBe(4)
  })
})

describe('loadThreeModules', () => {
  it('names an import outside the bundle, on its line', async () => {
    const c = compileThreeSketch("import * as THREE from 'three'\nimport GUI from 'lil-gui'\n")
    const e = await loadThreeModules(c).catch((x) => x)
    expect(e).toBeInstanceOf(ThreeImportError)
    expect(e.line).toBe(2)
    expect(e.message).toMatch(/'lil-gui' isn't available in Stave/)
  })

  it('says OrbitControls needs pointer input rather than "not found"', async () => {
    const c = compileThreeSketch("import { OrbitControls } from 'three/addons/controls/OrbitControls.js'\n")
    const e = await loadThreeModules(c).catch((x) => x)
    expect(e.message).toMatch(/needs pointer input/)
  })

  it('loads three and a named addon, accepting the older examples/jsm path', async () => {
    const c = compileThreeSketch(
      "import * as THREE from 'three'\nimport { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'\n",
    )
    const m = await loadThreeModules(c)
    expect(typeof m.THREE.WebGLRenderer).toBe('function')
    expect(m.modules[0]).toBeNull()
    expect(typeof (m.modules[1] as { RoomEnvironment: unknown }).RoomEnvironment).toBe('function')
  })
})

describe('the import chain (#2637)', () => {
  const extra = { marker: 'extra' }
  const chain: ImportChain = {
    links: [
      ...HOST_CHAIN.links,
      { name: 'extra', resolve: (s) => (s === 'lil-gui' || s === 'three' ? { kind: 'module', load: async () => extra } : null) },
    ],
    refusal: (s) => `no ${s}`,
  }

  it('asks each link in order: the host answers three, a later link answers what the host does not', async () => {
    const c = compileThreeSketch("import * as THREE from 'three'\nimport GUI from 'lil-gui'\n")
    const m = await loadThreeModules(c, chain)
    expect(m.modules[0]).toBeNull() // three = the host's, not the later link's
    expect(m.modules[1]).toBe(extra)
    expect(m.chain).toBe(chain)
  })

  it("refuses with the chain's own message when no link knows the specifier", async () => {
    const c = compileThreeSketch("import x from 'nope'\n")
    const e = await loadThreeModules(c, chain).catch((x) => x)
    expect(e).toBeInstanceOf(ThreeImportError)
    expect(e.message).toBe('no nope')
    expect(e.line).toBe(1)
  })

  it('routes a dynamic import() through the same chain', async () => {
    const compiled = compileThreeSketch("globalThis.__out = { gui: await import('lil-gui') }\n")
    const fake = fakeThree()
    const h = makeHost()
    const run = runThreeSketch(compiled, { THREE: fake.THREE, modules: [], chain }, h.host)
    expect((await run.done).error).toBeNull()
    expect(((globalThis as Record<string, unknown>).__out as { gui: unknown }).gui).toBe(extra)
  })
})

describe('runThreeSketch', () => {
  it('puts the renderer on the viz canvas and drives setAnimationLoop from the pump', async () => {
    const { run, made, host } = await start(`
      import * as THREE from 'three'
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      document.body.appendChild(renderer.domElement)
      globalThis.__out = { frames: 0 }
      renderer.setAnimationLoop((t) => { __out.frames++; __out.t = t; renderer.render({}, {}) })
    `)
    expect(made).toHaveLength(1)
    expect(made[0].canvas).toBe(host.canvas)
    // three's own loop (rAF on self) must never start — Stave's pump drives it
    expect(made[0].internalLoopStarted).toBe(false)
    expect(run.ready()).toBe(true)
    run.frame(16)
    run.frame(32)
    const out = (globalThis as Record<string, any>).__out
    expect(out.frames).toBe(2)
    expect(out.t).toBe(32)
    expect(made[0].renders).toBe(2)
    expect(run.rendered()).toBe(true)
  })

  it('runs requestAnimationFrame one frame at a time', async () => {
    const { run } = await start(`
      globalThis.__out = { n: 0 }
      function tick(t) { __out.n++; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    `)
    run.frame(1)
    run.frame(2)
    run.frame(3)
    expect((globalThis as Record<string, any>).__out.n).toBe(3)
    expect(run.rendered()).toBe(false)
  })

  it('exposes sig, stave.options, stave size and the viz size as innerWidth', async () => {
    await start(`
      globalThis.__out = {
        bass: sig.bass, hue: stave.options.hue, w: stave.width, h: stave.height,
        iw: innerWidth, ih: window.innerHeight, dpr: devicePixelRatio,
      }
    `)
    expect((globalThis as Record<string, any>).__out).toEqual({ bass: 0.5, hue: 0.3, w: 320, h: 200, iw: 320, ih: 200, dpr: 2 })
  })

  it('exposes stave.scheduler: now() and query() over the notes around now (#2570)', async () => {
    const notes = [
      { begin: 10, end: 10.5, note: 'c4' },
      { begin: 11, end: 11.25, note: 'e4' },
      { begin: 13, end: 13.5, note: 'g4' },
    ]
    const scheduler = {
      now: () => 10.2,
      query: (a: number, b: number) => notes.filter((n) => n.begin < b && n.end > a),
    }
    await start(
      `
      const now = stave.scheduler.now()
      globalThis.__out = { now, ahead: stave.scheduler.query(now, now + 2).map((h) => h.note) }
    `,
      { scheduler: () => scheduler as never },
    )
    expect((globalThis as Record<string, any>).__out).toEqual({ now: 10.2, ahead: ['c4', 'e4'] })
  })

  it('stave.scheduler is null until there is a scheduler (#2570)', async () => {
    await start(`globalThis.__out = { s: stave.scheduler }`)
    expect((globalThis as Record<string, any>).__out).toEqual({ s: null })
  })

  it('fires resize listeners with the new size', async () => {
    const h = await start(`
      globalThis.__out = { sizes: [] }
      window.addEventListener('resize', () => __out.sizes.push([innerWidth, innerHeight]))
    `)
    h.setSize({ w: 640, h: 360 })
    h.run.resize()
    expect((globalThis as Record<string, any>).__out.sizes).toEqual([[640, 360]])
  })

  it('resizes the renderer itself when the sketch has no resize listener', async () => {
    const h = await start(`
      import * as THREE from 'three'
      new THREE.WebGLRenderer()
    `)
    h.setSize({ w: 500, h: 250 })
    h.run.resize()
    expect(h.made[0].size).toEqual({ w: 500, h: 250 })
  })

  it("lets the sketch size its render but never the canvas's box on the page", async () => {
    const h = await start(`
      import * as THREE from 'three'
      const r = new THREE.WebGLRenderer()
      r.setSize(innerWidth, innerHeight)
    `)
    expect(h.made[0].size).toEqual({ w: 320, h: 200 })
    expect(h.made[0].styleWrites).toBe(0)
  })

  it('reports a top-level error on its line', async () => {
    const { result, reports } = await start("import * as THREE from 'three'\n\nconst a = 1\nnotDefined()\n")
    expect(result.error).not.toBeNull()
    expect(reports).toEqual([expect.objectContaining({ level: 'error', line: 4 })])
    expect(reports[0].message).toMatch(/notDefined/)
  })

  it('reports an error inside the loop once, on its line, and keeps running', async () => {
    const { run, reports } = await start(['globalThis.__out = { n: 0 }', 'requestAnimationFrame(function f() {', '  requestAnimationFrame(f)', '  __out.n++', '  boom()', '})'].join('\n'))
    run.frame(1)
    run.frame(2)
    run.frame(3)
    expect((globalThis as Record<string, any>).__out.n).toBe(3)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ level: 'error', line: 5 })
  })

  it('warns, on the line, when a sketch listens for pointer input', async () => {
    const { reports } = await start("\n\nwindow.addEventListener('pointermove', () => {})\n")
    expect(reports).toEqual([expect.objectContaining({ level: 'warn', line: 3 })])
    expect(reports[0].message).toMatch(/pointer or keyboard input/)
  })

  it('warns when a sketch builds an HTML overlay, but keeps running', async () => {
    const { reports, result } = await start(`
      const info = document.createElement('div')
      info.textContent = 'hello'
      document.body.appendChild(info)
    `)
    expect(result.error).toBeNull()
    expect(reports[0]?.message).toMatch(/HTML overlays/)
  })

  it('gives a canvas for document.createElement("canvas")', async () => {
    await start(`globalThis.__out = { c: document.createElement('canvas').getContext !== undefined }`)
    expect((globalThis as Record<string, any>).__out.c).toBe(true)
  })

  it('awaits at the top level', async () => {
    const { run } = await start(`
      import * as THREE from 'three'
      globalThis.__out = {}
      const mod = await import('three')
      __out.same = mod === THREE
    `)
    expect((globalThis as Record<string, any>).__out.same).toBe(true)
    expect(run.ready()).toBe(true)
  })

  it('on dispose stops the loop, disposes the renderer and loses its context', async () => {
    const { run, made } = await start(`
      import * as THREE from 'three'
      globalThis.__out = { n: 0 }
      const r = new THREE.WebGLRenderer()
      r.setAnimationLoop(() => __out.n++)
    `)
    run.frame(1)
    run.dispose()
    run.frame(2)
    expect((globalThis as Record<string, any>).__out.n).toBe(1)
    expect(made[0].disposed).toBe(true)
    expect(made[0].lost).toBe(true)
    run.dispose() // idempotent
  })

  it('refuses a renderer made after the sketch was stopped', async () => {
    const report = vi.fn()
    const compiled = compileThreeSketch(`
      import * as THREE from 'three'
      await new Promise((r) => setTimeout(r, 5))
      new THREE.WebGLRenderer()
    `)
    const fake = fakeThree()
    const h = makeHost({ report })
    const run = runThreeSketch(compiled, { THREE: fake.THREE, modules: [null] }, h.host)
    run.dispose()
    const { error } = await run.done
    expect(error?.message).toMatch(/stopped/)
    expect(fake.made).toHaveLength(0)
    expect(report).not.toHaveBeenCalled() // a stopped sketch reports nothing
  })
})

// #2560 — "loaded": the top level finished AND no three.js loader item is in
// flight, so a model loaded with a callback (and what the callback builds) is
// part of the load.
describe('runThreeSketch whenLoaded (#2560)', () => {
  /** A loader that reports to the manager like three's own (FileLoader.js:90,
   *  GLTFLoader.js:335-337: the callback runs BEFORE itemEnd). */
  function withLoader() {
    const fake = fakeThree()
    const manager = {
      itemStart(_url: string) {},
      itemEnd(_url: string) {},
    }
    class SlowLoader {
      load(url: string, cb: () => void, ms = 30) {
        manager.itemStart(url)
        setTimeout(() => {
          cb()
          manager.itemEnd(url)
        }, ms)
      }
    }
    const THREE = { ...fake.THREE, DefaultLoadingManager: manager, SlowLoader }
    return { THREE, manager }
  }
  async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
  }
  function run(code: string, THREE: Record<string, unknown>) {
    const compiled = compileThreeSketch(code)
    return runThreeSketch(compiled, { THREE, modules: compiled.imports.map(() => null) }, makeHost().host)
  }

  it('waits for a callback load, and for a load the callback starts', async () => {
    const { THREE } = withLoader()
    const r = run(
      `
      import * as THREE from 'three'
      globalThis.__out = { a: false, b: false }
      new THREE.SlowLoader().load('a', () => {
        __out.a = true
        new THREE.SlowLoader().load('b', () => { __out.b = true })
      })
    `,
      THREE,
    )
    await r.done // the top level is done at once…
    expect(await settledWithin(r.whenLoaded(), 10)).toBe(false) // …but 'a' is loading
    expect(await settledWithin(r.whenLoaded(), 300)).toBe(true)
    expect((globalThis as Record<string, any>).__out).toEqual({ a: true, b: true })
  })

  it('a load started from a timer after the last one ended is still waited for', async () => {
    const { THREE } = withLoader()
    const r = run(
      `
      import * as THREE from 'three'
      globalThis.__out = { b: false }
      new THREE.SlowLoader().load('a', () => {
        setTimeout(() => new THREE.SlowLoader().load('b', () => { __out.b = true }), 0)
      }, 5)
    `,
      THREE,
    )
    await r.whenLoaded()
    expect((globalThis as Record<string, any>).__out.b).toBe(true)
  })

  it('waits for an awaited top level', async () => {
    const { THREE } = withLoader()
    const r = run(
      `
      import * as THREE from 'three'
      await new Promise((ok) => setTimeout(ok, 40))
    `,
      THREE,
    )
    expect(await settledWithin(r.whenLoaded(), 10)).toBe(false)
    expect(await settledWithin(r.whenLoaded(), 300)).toBe(true)
  })

  it('a top level that never finishes never loads, until disposed', async () => {
    const { THREE } = withLoader()
    const r = run(`import * as THREE from 'three'\nawait new Promise(() => {})`, THREE)
    const p = r.whenLoaded()
    expect(await settledWithin(p, 50)).toBe(false)
    r.dispose()
    expect(await settledWithin(p, 50)).toBe(true)
  })
})

// #2641 — what a sketch starts that outlives its renderer: workers, blob URLs,
// intervals. jsdom has no Worker and no blob URLs, so both are fakes that record
// what was ended.
describe('runThreeSketch teardown of workers, blob URLs and intervals (#2641)', () => {
  const G = globalThis as Record<string, any>
  class FakeWorker {
    static live = new Set<FakeWorker>()
    terminated = 0
    constructor(readonly url: string) {
      FakeWorker.live.add(this)
    }
    terminate() {
      this.terminated++
      FakeWorker.live.delete(this)
    }
  }
  const blobs = new Set<string>()
  let seq = 0
  // Installed for the whole file run: the realm patch wraps whatever Worker and
  // createObjectURL exist the first time an `ownsRealm` sketch runs.
  G.Worker = FakeWorker
  URL.createObjectURL = ((): string => {
    const u = `blob:fake/${++seq}`
    blobs.add(u)
    return u
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = ((u: string) => {
    blobs.delete(u)
  }) as typeof URL.revokeObjectURL

  const SKETCH = `
    import * as THREE from 'three'
    __out.a = new Worker(URL.createObjectURL(new Blob(['a'])))
    __out.b = new self.Worker(window.URL.createObjectURL(new Blob(['b'])))
    __out.kept = URL.createObjectURL(new Blob(['c']))
    __out.ticks = 0
    __out.iv = setInterval(() => __out.ticks++, 5)
  `

  it('ends the workers, blob URLs and intervals the sketch left running', async () => {
    FakeWorker.live.clear()
    blobs.clear()
    const { run, out } = await start(SKETCH)
    expect(FakeWorker.live.size).toBe(2)
    expect(blobs.size).toBe(3)
    await new Promise((r) => setTimeout(r, 30))
    expect(out.ticks as number).toBeGreaterThan(0)
    run.dispose()
    expect(FakeWorker.live.size, 'no worker outlives the sketch').toBe(0)
    expect(blobs.size, 'no blob URL outlives the sketch').toBe(0)
    const ticks = out.ticks as number
    await new Promise((r) => setTimeout(r, 30))
    expect(out.ticks, 'the interval stopped').toBe(ticks)
  })

  it('leaves what the sketch already ended alone, and ends late arrivals on sight', async () => {
    FakeWorker.live.clear()
    blobs.clear()
    const { run, out } = await start(`
      import * as THREE from 'three'
      const u = URL.createObjectURL(new Blob(['a']))
      __out.w = new Worker(u)
      __out.w.terminate()
      URL.revokeObjectURL(u)
      __out.later = async () => {
        await new Promise((r) => setTimeout(r, 5))
        __out.late = new Worker('x.js')
        __out.lateIv = setInterval(() => {}, 5)
      }
      __out.done = __out.later()
    `)
    run.dispose()
    expect((out.w as FakeWorker).terminated, 'terminated once, by the sketch').toBe(1)
    await out.done
    expect((out.late as FakeWorker).terminated, 'a worker made after stop ends at once').toBe(1)
    expect(out.lateIv, 'no interval starts after stop').toBe(0)
    expect(FakeWorker.live.size).toBe(0)
  })

  it('with ownsRealm, also ends what code it did not compile made through the realm (a library)', async () => {
    FakeWorker.live.clear()
    blobs.clear()
    // `globalThis.Worker` is the realm's own: what a library module reaches.
    const LIB = `
      import * as THREE from 'three'
      __out.lib = new globalThis.Worker(globalThis.URL.createObjectURL(new Blob(['lib'])))
    `
    const plain = await start(LIB)
    plain.run.dispose()
    expect(FakeWorker.live.size, 'without ownsRealm the realm is not for Stave to clean').toBe(1)
    FakeWorker.live.clear()
    blobs.clear()

    const owned = await start(LIB, { ownsRealm: true })
    expect(FakeWorker.live.size).toBe(1)
    owned.run.dispose()
    expect(FakeWorker.live.size, 'the worker of the library ends with the sketch').toBe(0)
    expect(blobs.size, 'and its blob URL is revoked').toBe(0)

    // After the sketch stops the realm's Worker passes straight through again.
    const after = new (G.Worker as typeof FakeWorker)('host.js')
    owned.run.dispose()
    expect(after.terminated).toBe(0)
  })
})
