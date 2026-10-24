/**
 * vizCompiler — p5 compiler tests (editor-fixes Task 3).
 *
 * The new p5 compiler supports two modes:
 *
 *   1. Full-lifecycle: user writes `function preload/setup/draw`
 *      declarations at the top level. The compiler inlines the
 *      source inside `with(p) { ... }` so bare p5 identifiers
 *      (`createCanvas`, `background`, `width`, `HSB`, …) resolve to
 *      the p5 instance, and returns the declared functions for
 *      assignment onto the instance.
 *
 *   2. Legacy: bare draw-body statements (no `function draw`). The
 *      compiler auto-wraps them in a default `setup`/`draw` pair so
 *      pre-existing viz presets written for the old compiler keep
 *      working without modification.
 *
 * Stave-specific inputs are exposed via a single `stave` namespace
 * object with LIVE getters over the renderer refs:
 *
 *     stave.scheduler  // PatternScheduler | null
 *     stave.analyser   // AnalyserNode | null
 *     stave.hapStream  // HapStream | null
 *
 * Live getters mean that reading `stave.scheduler` inside `draw()`
 * always returns the current ref value, so a mid-mount refresh from
 * `P5VizRenderer.update(components)` is picked up automatically.
 *
 * These tests exercise the compiler as a pure function — we don't
 * spin up a real p5 instance; instead we construct a fake `p` object
 * that records the setup/draw/preload assignments and the calls made
 * through `with(p)` resolution, then invoke the lifecycle functions
 * and assert on the recorded state.
 */

import { describe, it, expect, vi } from 'vitest'
// Import from the pure `p5Compiler` module (not `vizCompiler`) so
// the test's module graph doesn't transitively pull in p5 → gifenc
// through P5VizRenderer, which breaks the vitest ESM loader.
import { compileP5Code, isFullLifecycleSketch } from '../p5Compiler'
import {
  __resetEngineLogForTests,
  subscribeLog,
  getLogHistory,
  type LogEntry,
} from '../../engine/engineLog'
import type { HapStream } from '../../engine/HapStream'
import type { PatternScheduler, ContainerSize } from '../types'
import type { RefObject } from 'react'

// ---------------------------------------------------------------------------
// Test harness: a fake p5 instance that records calls
// ---------------------------------------------------------------------------

/**
 * Build a fake p5 instance whose methods are recording spies. The
 * fake captures `createCanvas`, `background`, `fill`, `rect`, and
 * `text` calls (the ones our tests actually exercise) plus exposes
 * stable `width` / `height` / `windowWidth` / `windowHeight` /
 * `HSB` / `RGB` values so bare-name lookups resolve.
 *
 * `installedLifecycle` is mutated when the compiled sketch function
 * runs — the compiler assigns `p.setup` / `p.draw` / `p.preload`.
 */
function makeFakeP5() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
    })

  const p: Record<string, unknown> = {
    // Size accessors — `width`/`height` are live p5 properties in
    // real usage; for these tests we pin them to constants.
    width: 400,
    height: 300,
    windowWidth: 1024,
    windowHeight: 768,
    // Color mode constants — the real p5 exposes these on the instance.
    RGB: 'RGB-const',
    HSB: 'HSB-const',
    PI: Math.PI,
    // Methods the tests call.
    createCanvas: record('createCanvas'),
    colorMode: record('colorMode'),
    background: record('background'),
    noStroke: record('noStroke'),
    fill: record('fill'),
    rect: record('rect'),
    ellipse: record('ellipse'),
    text: record('text'),
    textSize: record('textSize'),
    textFont: record('textFont'),
    noise: vi.fn(() => 0.5),
    map: vi.fn(
      (v: number, a: number, b: number, c: number, d: number) =>
        c + ((v - a) / (b - a)) * (d - c),
    ),
  }

  return { p, calls }
}

/**
 * Build a `{ current: ... }` ref pair (one for each of the three
 * inputs the sketch factory closes over). Tests mutate `.current`
 * directly to simulate the renderer updating the refs on source
 * changes / payload swaps.
 */
function makeRefs(initialSize: ContainerSize = { w: 800, h: 600 }) {
  const hapStreamRef: { current: HapStream | null } = { current: null }
  const analyserRef: { current: AnalyserNode | null } = { current: null }
  const schedulerRef: { current: PatternScheduler | null } = { current: null }
  const containerSizeRef: { current: ContainerSize } = { current: initialSize }
  return {
    hapStreamRef: hapStreamRef as unknown as RefObject<HapStream | null>,
    analyserRef: analyserRef as unknown as RefObject<AnalyserNode | null>,
    schedulerRef: schedulerRef as unknown as RefObject<PatternScheduler | null>,
    containerSizeRef: containerSizeRef as unknown as RefObject<ContainerSize>,
  }
}

/**
 * Compile a user source, invoke the returned factory with fresh
 * refs + a fake p5 instance, and return everything the tests want
 * to inspect: the fake p, the call log, the raw refs, and the
 * post-install `p.setup` / `p.draw` / `p.preload`.
 */
function compileAndMount(userCode: string) {
  const factory = compileP5Code(userCode)
  const refs = makeRefs()
  const sketchFn = factory(
    refs.hapStreamRef,
    refs.analyserRef,
    refs.schedulerRef,
    refs.containerSizeRef,
  )
  const { p, calls } = makeFakeP5()
  sketchFn(p)
  return { p, calls, refs }
}

// ---------------------------------------------------------------------------
// isFullLifecycleSketch — detection helper
// ---------------------------------------------------------------------------

describe('isFullLifecycleSketch', () => {
  it('returns true when the source declares function draw', () => {
    expect(isFullLifecycleSketch('function draw() { background(0) }')).toBe(true)
  })

  it('returns true for a setup-only sketch (one-shot, no animation)', () => {
    // A sketch with only `function setup` used to fall through to the
    // legacy draw-body wrap; the user's setup declaration ended up
    // nested inside a synthetic draw and never ran. The detector now
    // matches any lifecycle entry point.
    expect(
      isFullLifecycleSketch(
        'function setup() { createCanvas(100, 100); print("hi") }',
      ),
    ).toBe(true)
  })

  it('returns true for a preload-only sketch', () => {
    expect(
      isFullLifecycleSketch('function preload() { loadImage("a.png") }'),
    ).toBe(true)
  })

  it('returns true even when draw is preceded by other declarations', () => {
    expect(
      isFullLifecycleSketch(
        'let x = 0\nfunction setup() {}\nfunction draw() { x++ }',
      ),
    ).toBe(true)
  })

  it('tolerates extra whitespace in the function declaration', () => {
    expect(isFullLifecycleSketch('function  draw  ( )  { }')).toBe(true)
  })

  it('returns false for bare draw-body snippets (legacy)', () => {
    expect(isFullLifecycleSketch('background(0); ellipse(50, 50, 20)')).toBe(false)
  })

  it('returns false for the empty string', () => {
    expect(isFullLifecycleSketch('')).toBe(false)
  })

  it('does NOT match `const draw = ...` (that is not a declaration)', () => {
    expect(isFullLifecycleSketch('const draw = () => background(0)')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Full-lifecycle mode
// ---------------------------------------------------------------------------

describe('compileP5Code — full-lifecycle mode', () => {
  it('installs user-declared setup and draw on the p5 instance', () => {
    const source = `
      function setup() {
        createCanvas(windowWidth, windowHeight)
      }
      function draw() {
        background(0)
      }
    `
    const { p, calls } = compileAndMount(source)

    // Both lifecycle slots should be populated with functions.
    expect(typeof p.setup).toBe('function')
    expect(typeof p.draw).toBe('function')

    // Invoke setup — createCanvas should be called with the p5
    // instance's windowWidth/windowHeight (accessed via with(p)).
    ;(p.setup as () => void)()
    expect(
      calls.find((c) => c.method === 'createCanvas')?.args,
    ).toEqual([1024, 768])

    // Invoke draw — background(0) should reach p.background(0)
    // through the captured `with(p)` binding.
    ;(p.draw as () => void)()
    expect(calls.find((c) => c.method === 'background')?.args).toEqual([0])
  })

  it('installs a user-declared preload when present', () => {
    const source = `
      function preload() { background(42) }
      function draw() { background(0) }
    `
    const { p, calls } = compileAndMount(source)
    expect(typeof p.preload).toBe('function')
    ;(p.preload as () => void)()
    // preload invoked background(42)
    expect(
      calls.some((c) => c.method === 'background' && c.args[0] === 42),
    ).toBe(true)
  })

  it('falls back to a default setup when user only declared draw', () => {
    const source = 'function draw() { background(0) }'
    const { p, calls } = compileAndMount(source)
    expect(typeof p.setup).toBe('function')
    ;(p.setup as () => void)()
    // The default setup creates a canvas from windowWidth/windowHeight.
    expect(
      calls.find((c) => c.method === 'createCanvas')?.args,
    ).toEqual([1024, 768])
  })

  it('lets setup and draw share state via a top-level let', () => {
    // Shared state is a common p5 idiom: declare variables at the
    // top level, initialize them in setup, read/mutate them in draw.
    // With the compiler's `with(p) { ${code} }` wrapping, the `let`
    // declaration lives in the with-block scope and is captured by
    // both setup and draw's closures.
    const source = `
      let counter
      function setup() {
        counter = 10
        createCanvas(windowWidth, windowHeight)
      }
      function draw() {
        counter = counter + 1
        text(counter, 10, 10)
      }
    `
    const { p, calls } = compileAndMount(source)
    ;(p.setup as () => void)()
    ;(p.draw as () => void)()
    ;(p.draw as () => void)()
    ;(p.draw as () => void)()

    // After three draws, the last text call should be '13' (seeded
    // at 10 in setup, incremented three times).
    const textCalls = calls.filter((c) => c.method === 'text')
    expect(textCalls.length).toBe(3)
    expect(textCalls[textCalls.length - 1].args[0]).toBe(13)
  })

  it('resolves bare p5 constants like HSB through with(p)', () => {
    const source = `
      function setup() {
        colorMode(HSB, 360, 100, 100)
      }
      function draw() {}
    `
    const { p, calls } = compileAndMount(source)
    ;(p.setup as () => void)()
    const colorModeCall = calls.find((c) => c.method === 'colorMode')
    // `HSB` should have resolved to `p.HSB` (our fake value 'HSB-const').
    expect(colorModeCall?.args).toEqual(['HSB-const', 360, 100, 100])
  })
})

// ---------------------------------------------------------------------------
// stave namespace — live getter behavior
// ---------------------------------------------------------------------------

describe('compileP5Code — stave namespace', () => {
  it('exposes scheduler / analyser / hapStream via stave.*', () => {
    // The sketch writes observed stave.* values directly onto the
    // p5 instance (which we control via the test fake), since the
    // compiler's lifecycle object only exposes setup/draw/preload.
    // This is a test-harness trick, not a user-facing pattern.
    const source = `
      function draw() {
        p.seenScheduler = stave.scheduler
        p.seenAnalyser = stave.analyser
        p.seenHapStream = stave.hapStream
      }
    `
    const factory = compileP5Code(source)
    const refs = makeRefs()
    const fakeScheduler = { id: 'sched-a' } as unknown as PatternScheduler
    const fakeAnalyser = { frequencyBinCount: 1024 } as unknown as AnalyserNode
    const fakeHapStream = { id: 'hs-a' } as unknown as HapStream
    ;(refs.schedulerRef as unknown as { current: PatternScheduler | null })
      .current = fakeScheduler
    ;(refs.analyserRef as unknown as { current: AnalyserNode | null })
      .current = fakeAnalyser
    ;(refs.hapStreamRef as unknown as { current: HapStream | null })
      .current = fakeHapStream

    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)

    ;(p.draw as () => void)()
    expect(p.seenScheduler).toBe(fakeScheduler)
    expect(p.seenAnalyser).toBe(fakeAnalyser)
    expect(p.seenHapStream).toBe(fakeHapStream)
  })

  it('exposes the per-render options bag via stave.options, live (#214)', () => {
    // The viz options bag (`.pianoroll({ labels: 1 })` argument) is the 5th
    // factory ref → `stave.options`. Defaults to `{}` when not wired, and is
    // LIVE so a re-eval with new options is picked up without recompiling.
    const source = `function draw() { p.seenOptions = stave.options }`
    const factory = compileP5Code(source)
    const refs = makeRefs()
    const optionsRef: { current: Record<string, unknown> } = { current: {} }

    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
      optionsRef as unknown as RefObject<Record<string, unknown>>,
    )
    const { p } = makeFakeP5()
    sketchFn(p)

    ;(p.draw as () => void)()
    expect(p.seenOptions).toEqual({}) // default empty bag

    optionsRef.current = { labels: 1, vertical: true }
    ;(p.draw as () => void)()
    expect(p.seenOptions).toEqual({ labels: 1, vertical: true }) // live swap
  })

  it('stave.options defaults to {} when the optionsRef is not wired (back-compat)', () => {
    const source = `function draw() { p.opt = stave.options }`
    const refs = makeRefs()
    // 4-arg call (no optionsRef) — the legacy P5SketchFactory signature.
    const sketchFn = compileP5Code(source)(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)
    ;(p.draw as () => void)()
    expect(p.opt).toEqual({})
  })

  it('stave fields are LIVE — mid-mount ref swaps are visible on next read', () => {
    // This is the safety net for `P5VizRenderer.update(components)`:
    // when the audio source payload changes within a mount (same
    // sourceRef), the renderer mutates its refs in place. The sketch
    // must see the new values on its next `stave.*` read without
    // having to re-compile.
    const source = `
      function draw() { p.seenAnalyser = stave.analyser }
    `
    const factory = compileP5Code(source)
    const refs = makeRefs()
    const analyserA = { tag: 'A' } as unknown as AnalyserNode
    const analyserB = { tag: 'B' } as unknown as AnalyserNode
    ;(refs.analyserRef as unknown as { current: AnalyserNode | null })
      .current = analyserA

    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)

    ;(p.draw as () => void)()
    expect(p.seenAnalyser).toBe(analyserA)

    // Simulate P5VizRenderer.update() — swap the analyser in place.
    ;(refs.analyserRef as unknown as { current: AnalyserNode | null })
      .current = analyserB

    // Next draw should see the NEW analyser, not a cached A.
    ;(p.draw as () => void)()
    expect(p.seenAnalyser).toBe(analyserB)
  })
})

// ---------------------------------------------------------------------------
// Container size — stave.width / stave.height
// ---------------------------------------------------------------------------

describe('compileP5Code — stave.width / stave.height', () => {
  it('exposes the container size via stave.width and stave.height', () => {
    // The canvas-size fix: user sketches write
    // `createCanvas(stave.width, stave.height)` instead of
    // `windowWidth/windowHeight` so the canvas matches the preview
    // pane, not the browser window. The compiler reads from the
    // container size ref the renderer passes in.
    const source = `
      function setup() {
        createCanvas(stave.width, stave.height)
      }
      function draw() {}
    `
    const factory = compileP5Code(source)
    const refs = makeRefs({ w: 640, h: 480 })
    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
    )
    const { p, calls } = makeFakeP5()
    sketchFn(p)
    ;(p.setup as () => void)()

    const createCanvasCall = calls.find((c) => c.method === 'createCanvas')
    expect(createCanvasCall?.args).toEqual([640, 480])
  })

  it('stave.width / stave.height are LIVE — ref updates are visible on the next read', () => {
    // ResizeObserver in the mounter updates the containerSizeRef on
    // every resize. If a draw() call reads `stave.width` each frame,
    // it must see the updated value without a re-mount.
    const source = `
      function draw() {
        p.seenWidth = stave.width
        p.seenHeight = stave.height
      }
    `
    const factory = compileP5Code(source)
    const refs = makeRefs({ w: 100, h: 200 })
    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)

    ;(p.draw as () => void)()
    expect(p.seenWidth).toBe(100)
    expect(p.seenHeight).toBe(200)

    // Simulate ResizeObserver → renderer.resize(w, h) → ref update.
    ;(refs.containerSizeRef as unknown as { current: ContainerSize })
      .current = { w: 800, h: 500 }

    ;(p.draw as () => void)()
    expect(p.seenWidth).toBe(800)
    expect(p.seenHeight).toBe(500)
  })

  it('falls back to 400x300 when the factory is called without a container size ref', () => {
    // Backwards compat: if a caller doesn't thread a container-size
    // ref (e.g., a test or an older embedder), stave.width/height
    // should still return usable defaults rather than crash.
    const source = `
      function draw() {
        p.seenWidth = stave.width
        p.seenHeight = stave.height
      }
    `
    const factory = compileP5Code(source)
    const refs = makeRefs()
    // Invoke WITHOUT the fourth arg — the compiler's default
    // fallback container size ref kicks in.
    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)
    ;(p.draw as () => void)()
    expect(p.seenWidth).toBe(400)
    expect(p.seenHeight).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Legacy mode — bare draw-body auto-wrap
// ---------------------------------------------------------------------------

describe('compileP5Code — legacy mode (backwards compat)', () => {
  it('auto-wraps bare draw-body statements in a default setup + draw', () => {
    // Pre-existing viz presets for the old compiler were written as
    // bare statements that were historically evaluated directly
    // inside `p.draw`. They must keep working without modification.
    const source = 'background(0); rect(10, 20, 30, 40)'
    const { p, calls } = compileAndMount(source)

    // Default setup should be installed.
    expect(typeof p.setup).toBe('function')
    ;(p.setup as () => void)()
    expect(
      calls.find((c) => c.method === 'createCanvas')?.args,
    ).toEqual([1024, 768])
    // Default setup also sets colorMode to RGB.
    expect(
      calls.find((c) => c.method === 'colorMode')?.args,
    ).toEqual(['RGB-const'])

    // The draw body should contain the user's statements.
    ;(p.draw as () => void)()
    expect(
      calls.some((c) => c.method === 'background' && c.args[0] === 0),
    ).toBe(true)
    expect(
      calls.find((c) => c.method === 'rect')?.args,
    ).toEqual([10, 20, 30, 40])
  })

  it('legacy snippets can access scheduler/analyser/hapStream as bare names', () => {
    // The old compiler exposed scheduler/analyser/hapStream as
    // function-scope locals. The new legacy-mode wrapper preserves
    // that contract by aliasing `stave.*` to bare identifiers inside
    // the synthetic draw body.
    const source = `
      if (scheduler) {
        rect(1, 2, 3, 4)
      }
    `
    const factory = compileP5Code(source)
    const refs = makeRefs()
    ;(refs.schedulerRef as unknown as { current: PatternScheduler | null })
      .current = { id: 's' } as unknown as PatternScheduler

    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
    )
    const { p, calls } = makeFakeP5()
    sketchFn(p)
    ;(p.draw as () => void)()

    // Scheduler was non-null, so rect should have fired.
    expect(
      calls.find((c) => c.method === 'rect')?.args,
    ).toEqual([1, 2, 3, 4])
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('compileP5Code — compile errors', () => {
  it('reports a syntax error when the sketch mounts, on its line in the file (#2220)', async () => {
    // It used to throw from compileP5Code. The compile runs when the renderer
    // is built, which after a worker failure is inside a worker-message
    // handler, so the throw reached only the global catch: a "Stave" row with
    // no file and no line.
    __resetEngineLogForTests()
    const source = `
      function draw() {
        background(
      }
    `
    const factory = compileP5Code(source, 'tests/broken.p5')
    const refs = makeRefs()
    const sketchFn = factory(refs.hapStreamRef, refs.analyserRef, refs.schedulerRef, refs.containerSizeRef)
    const { p, calls } = makeFakeP5()
    sketchFn(p)
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const history = getLogHistory()
    expect(history.map((e) => [e.runtime, e.source, e.line, e.column, e.message])).toEqual([
      ['p5', 'tests/broken.p5', 4, 7, "Unexpected token '}'"],
    ])
    // and the canvas says so too
    ;(p.draw as () => void)()
    expect(calls.some((c) => c.method === 'text' && c.args[0] === "Unexpected token '}'")).toBe(true)
  })

  it('a sketch that ends early says so, after the last thing written (#2220)', async () => {
    __resetEngineLogForTests()
    const factory = compileP5Code('function draw() {\n  background(0)\n', 'tests/open.p5')
    const refs = makeRefs()
    factory(refs.hapStreamRef, refs.analyserRef, refs.schedulerRef, refs.containerSizeRef)(makeFakeP5().p)
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    expect(getLogHistory().map((e) => [e.source, e.line, e.column, e.message])).toEqual([
      ['tests/open.p5', 2, 16, 'Unexpected end of code'],
    ])
  })

  it('bridges draw-time runtime errors to engineLog (the `zoom` typo case)', async () => {
    __resetEngineLogForTests()
    const entries: LogEntry[] = []
    subscribeLog((entry) => {
      if (entry) entries.push(entry)
    })

    // Declares `zom` but references `zoom` inside draw — valid syntax,
    // resolves fine at compile and at factory invocation, throws only
    // when p5 calls draw().
    const source = `
      let zom = -100
      function draw() {
        const v = zoom + 1
      }
    `
    const factory = compileP5Code(source, 'tests/zoom.p5')
    const refs = makeRefs()
    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)
    // Simulate p5 invoking draw three times. The wrap must swallow
    // the throw so p5's loop doesn't halt; emitLog's dedupe collapses
    // the per-frame flood to one Console row.
    ;(p.draw as () => void)()
    ;(p.draw as () => void)()
    ;(p.draw as () => void)()

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    // Listener fires once per emit (so UIs can re-flash toasts) but
    // engineLog's dedupe collapses identical entries in history —
    // exactly the behaviour we want for a 60fps per-frame flood.
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const history = getLogHistory()
    expect(history).toHaveLength(1)
    expect(history[0].runtime).toBe('p5')
    expect(history[0].level).toBe('error')
    expect(history[0].message).toMatch(/draw.*zoom/)
    expect(history[0].source).toBe('tests/zoom.p5')
  })

  it('bridges top-level runtime errors (new Mp()) to engineLog', async () => {
    __resetEngineLogForTests()
    const entries: LogEntry[] = []
    subscribeLog((entry) => {
      if (entry) entries.push(entry)
    })

    // Top-level ReferenceError — the factory's internal catch used to
    // swallow this into `installErrorSketch` only. Now it also emits.
    const source = `
      let x = new Mp()
      function draw() { background(0) }
    `
    const factory = compileP5Code(source, 'tests/mp.p5')
    const refs = makeRefs()
    const sketchFn = factory(
      refs.hapStreamRef,
      refs.analyserRef,
      refs.schedulerRef,
      refs.containerSizeRef,
    )
    const { p } = makeFakeP5()
    sketchFn(p)

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(entries).toHaveLength(1)
    expect(entries[0].runtime).toBe('p5')
    expect(entries[0].level).toBe('error')
    expect(entries[0].source).toBe('tests/mp.p5')
    expect(entries[0].message).toMatch(/Mp/)
  })
})
