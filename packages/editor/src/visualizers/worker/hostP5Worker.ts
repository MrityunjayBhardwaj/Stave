/**
 * hostVizWorker — the bundler-AGNOSTIC worker host that runs a viz sketch in a
 * `WorkerGlobalScope` and renders it to a transferred `OffscreenCanvas` (Phase B,
 * epic #228). Hosts every renderer kind, branching on `MountMessage.kind`:
 *   - `'p5'`    (B-3) — install the 6-part p5 DOM shim, compile via the shared
 *     `compileP5Code`, drive `redraw()` then BLIT p5's worker-local canvas onto the
 *     transferred presenting canvas (p5 makes its OWN canvases — Tier 2).
 *   - `'hydra'` (B-5) — install the 2-part hydra shim, `new Hydra({ canvas })` on
 *     the transferred canvas DIRECTLY (Tier 1: hydra accepts a canvas → no blit),
 *     feed `s.a.fft[]` from the frame's master bytes, drive `hydra.tick()`.
 *   - `'glsl'`  (#281) — raw WebGL2 on the transferred canvas.
 *   - `'three'` (#2516) — a plain three.js sketch run by `threeSketch.ts`; its
 *     renderer is built on the transferred canvas and its loop driven per frame.
 *
 * The app's `viz-worker.ts` (bundled by Next via `new Worker(new URL(...))`) is a
 * two-line shell: `hostVizWorker(self)`. ONE worker hosts ONE kind (B-3/B-5; a
 * pool that reuses a worker across kinds is B-6) — so only one shim ever installs.
 *
 * SHARED per frame (both kinds) — `applyAndDraw`: `feed.applyFrame` owns the ONE
 * bus tick (PK22) + refresh the raw shims, then the kind-specific `draw()` runs
 * EXACTLY ONCE (1:1 with the main sampler's frame → cadence can't drift). After
 * the first successful draw the host posts a one-shot `ready` (B-5 / #247): the
 * main `FallbackVizRenderer` waits for it; a throw or timeout BEFORE it falls the
 * renderer back to the main thread (a worker that throws/hangs at startup = blank).
 *
 * CADENCE (PK22): the p5 setup is wrapped to `noLoop()` (we drive `redraw()`); the
 * hydra instance is `autoLoop:false` (we drive `tick()`). `staveUniforms.__tick`
 * is a no-op in the worker (built without `onTick`) — the feed already ticked.
 *
 * REF: PV70 (.anvi/vyapti.md), PK22 (.anvi/krama.md), dom-shim.ts, rawShims.ts,
 *      workerBusFeed.ts, signalTransport.ts, p5Compiler.ts, hydraCompiler.ts,
 *      hydraStaveBag.ts (the shared bag builder), HydraVizRenderer (main contract).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  installWorkerDomShim,
  installWorkerHydraShim,
  wrapCanvas,
} from './dom-shim'
import { WorkerBusFeed } from './workerBusFeed'
import { RawAnalyserShim, RawSchedulerShim } from './rawShims'
import { createPostMessageReader, type SignalTransportReader } from './signalTransport'
import { MASTER_KEY, type SignalFrame, type AnalyserBytes } from './signalFrame'
import { buildStaveUniforms } from '../signals/staveUniforms'
import { buildHydraStaveBag } from '../renderers/hydraStaveBag'
import { compileP5Code } from '../p5Compiler'
import { compileHydraCode, getHydraLineOffset } from '../hydraCompiler'
import { createGLSLProgram, type GLSLProgram } from '../renderers/glslCore'
import { readGLSLEvents, readGLSLTracks } from '../renderers/glslEvents'
import { GLSLNoteFeed, droppedNotesMessage } from '../renderers/glslNotes'
import { compileThreeSketch, loadThreeModules, runThreeSketch } from '../renderers/threeSketch'
import { subscribeLog, type LogEntry } from '../../engine/engineLog'
import { parseStackLocation } from '../../engine/friendlyErrors'
import { getVizConfig, updateVizConfig } from '../vizConfig'
import {
  isControlMessage,
  type MountMessage,
  type WorkerControlMessage,
} from './workerMessages'

/** The minimal worker-global surface the host needs (a `DedicatedWorkerGlobalScope`
 *  on the real worker; structural so it's testable). */
interface WorkerScope {
  addEventListener(type: 'message', handler: (ev: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

/** A WebGL context viewed only through the `WEBGL_lose_context` extension — enough
 *  to release the GPU context (#266). A 2D context's `getExtension` returns null. */
interface GLLoseCtx {
  getExtension(name: string): { loseContext?: () => void } | null
  isContextLost?: () => boolean
}

/** The kind-specific half of a mount — the shared scaffolding wraps these. */
interface RendererStrategy {
  /** True once the renderer can draw (p5 setup is async; hydra is sync). */
  setupDone: () => boolean
  /** #2560 — settles once the sketch has finished setting up (assets in, setup
   *  run). Never rejects; may never settle for a sketch that never finishes, which
   *  is why everything waiting on it has a cap. */
  whenLoaded: () => Promise<void>
  /** Render exactly one frame from the (already-refreshed) shims. May throw — the
   *  caller catches + reports + suppresses the `ready` signal. */
  draw: () => void
  /** Apply a new size / DPR to the renderer + presenting canvas. */
  resizeKind: (w: number, h: number, dpr: number) => void
  /** Belt-and-suspenders teardown of the renderer instance. */
  teardown: () => void
  /** The kind's live WebGL context, or null for a 2D / no-GL sketch (#266). The
   *  host accounts it (`glctx+`) and explicitly loses it on teardown so a POOLED
   *  warm worker doesn't retain the context past Chrome's ~16-context cap. p5:
   *  `inst.drawingContext`; hydra: the presenting canvas context. */
  gl?: () => GLLoseCtx | null
  /** Swap the live `stave.options` bag without a remount (#875) — p5 only (it is
   *  the only kind whose compiler exposes `stave.options`). Mirrors the main-thread
   *  `P5VizRenderer.update`, which re-assigns its `optionsRef` on every re-publish. */
  setOptions?: (options: Record<string, unknown>) => void
}

interface MountState extends RendererStrategy {
  feed: WorkerBusFeed
  rawAnalyser: RawAnalyserShim
  rawScheduler: RawSchedulerShim
  containerSizeRef: { current: { w: number; h: number } }
  canvas: OffscreenCanvas
  reader: SignalTransportReader
  dpr: number
  paused: boolean
  /** One-shot guard for the `ready` liveness signal (#247). */
  readySent: boolean
}

/** Cached library constructors — imported once per worker (after the matching shim
 *  is installed). A worker hosts one kind, so only one is ever set. */
let P5ctor: any = null
let Hydractor: any = null

/** #266 diag messages — the worker reports WebGL-context lifecycle so the main
 *  thread can drive a `viz.glctx` gauge (live GL contexts), mirroring `viz.worker`. */
const GLCTX_UP = 'glctx+'
/** #266 fix toggle: when true, teardown explicitly loses the kind's WebGL context
 *  (`WEBGL_lose_context`) so a POOLED warm worker frees the context slot instead of
 *  leaving it to the idle worker's lazy GC. p5/hydra never call loseContext (p5
 *  2.2.3 source has no such call; hydra teardown only hush()es), so without this a
 *  parked worker retains its context toward Chrome's ~16-context cap. Flipped to
 *  false ONLY for the throwaway A/B that demonstrates the leak. */
const GLCTX_RELEASE = true

export function hostVizWorker(scope: WorkerScope): void {
  let state: MountState | null = null
  // Profiler bridge (#230 Phase F): wall-time of the last completed s.draw(),
  // piggybacked on the next frameAck → main records `viz.worker.draw`. Reset per
  // mount so a new sketch doesn't report the previous one's cost.
  let lastDrawMs: number | undefined

  const diag = (level: 'error' | 'info', message: string, stack?: string): void => {
    try {
      scope.postMessage({ type: 'diag', level, message, stack })
    } catch {
      /* postMessage can fail late in teardown — ignore */
    }
  }
  const signalReady = (): void => {
    try {
      scope.postMessage({ type: 'ready' })
    } catch {
      /* ignore */
    }
  }
  // #2560 — `alive`: the thread took the mount (the startup probation's question).
  // `loaded`: the sketch finished setting up (what Play waits on).
  const post = (type: 'alive' | 'loaded'): void => {
    try {
      scope.postMessage({ type })
    } catch {
      /* ignore */
    }
  }

  // #257 — surface viz runtime errors that are otherwise SWALLOWED in the worker.
  // p5Compiler wraps each user lifecycle hook (draw/setup) in a try/catch that
  // reports to the worker-LOCAL engineLog (emitLog) and SWALLOWS the throw — so it
  // never reaches the host's synchronous catch, and the worker engineLog isn't
  // wired to the main console → a per-frame draw() typo = silent blank. We RE-EMIT
  // those entries into the MAIN engineLog (`vizlog` → Console panel + squiggle,
  // like the main-thread path), NOT via `diag`/onError (a post-ready user typo must
  // surface WITHOUT tearing the worker down). Hydra's tick() is NOT emitLog-wrapped
  // → its sync throws come through the s.draw() catch below; both route to
  // postVizLog, deduped to once per unique error so a throw-every-frame sketch
  // reports once, not 60×/s.
  const seenWorkerErrors = new Set<string>()
  const currentRuntimeRef = { kind: 'p5' as LogEntry['runtime'] }
  const postVizLog = (entry: Omit<LogEntry, 'id' | 'ts'>): void => {
    const sig = `${entry.runtime}|${entry.message}|${entry.line ?? ''}`
    if (seenWorkerErrors.has(sig)) return
    if (seenWorkerErrors.size > 64) seenWorkerErrors.clear()
    seenWorkerErrors.add(sig)
    try {
      scope.postMessage({ type: 'vizlog', entry })
    } catch {
      /* postMessage can fail late in teardown — ignore */
    }
  }
  // Forward p5/hydra runtime errors the compiler routed to the worker engineLog.
  subscribeLog((entry) => {
    if (entry?.level === 'error') {
      const { id: _id, ts: _ts, ...rest } = entry
      postVizLog(rest)
    }
  })

  // #275 — surface hydra reactive-fn errors that hydra-synth SWALLOWS. hydra-synth
  // wraps every reactive-uniform fn (e.g. `.rotate(() => …)`) in its OWN try/catch and
  // console.warn()s the failure, then defaults the uniform (hydra-synth
  // format-arguments.js:78/82) — so the throw never escapes hydra.tick() and never
  // reaches the s.draw() catch below that re-emits p5 typos (#257). A hydra user with a
  // typo therefore gets a silent default + a warning buried in the DEDICATED worker's
  // devtools (vs p5, which surfaces in the main Console). Patch console.warn ONCE:
  // while a hydra sketch is live, re-emit hydra's two user-error markers through
  // postVizLog (deduped) so they reach the main Console like p5 errors, then ALWAYS
  // delegate to the real console.warn so devtools still shows the original. Gated on
  // kind==='hydra' + an exact string-marker match → p5/other warns and hydra/regl
  // internals pass through untouched.
  const HYDRA_WARN_THROW = 'ERROR' // format-arguments.js:82 — reactive fn threw
  const HYDRA_WARN_NAN = 'function does not return a number' // :78 — returned non-number
  const realConsoleWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]): void => {
    try {
      if (currentRuntimeRef.kind === 'hydra' && typeof args[0] === 'string') {
        if (args[0] === HYDRA_WARN_THROW) {
          // #330 — args[1] is the user's Error, thrown inside the reactive arrow.
          // Its stack points into the `new Function('s','stave',code)` body, so the
          // same parse+offset p5 uses (parseStackLocation − getHydraLineOffset, the
          // 2-line V8 header) maps it back to the EDITOR line → the squiggle lights
          // like a p5 typo. No line if the stack can't be parsed (graceful).
          const loc = parseStackLocation(args[1])
          const line = loc ? Math.max(1, loc.line - getHydraLineOffset()) : undefined
          postVizLog({
            level: 'error',
            runtime: 'hydra',
            message: `reactive fn: ${errMsg(args[1])}`,
            stack: errStack(args[1]),
            line,
          })
        } else if (args[0] === HYDRA_WARN_NAN) {
          postVizLog({ level: 'warn', runtime: 'hydra', message: 'reactive fn did not return a number' })
        }
      }
    } catch {
      /* never let surfacing break the real console.warn */
    }
    realConsoleWarn(...args)
  }

  // #266 WebGL-context accounting + release. Stashed at first-draw so destroy() can
  // explicitly lose the context even after `state` is cleared. `glLoseExt` holds the
  // WEBGL_lose_context extension; `glAccounted` guards the one-shot `glctx+` report
  // and the matching loseContext on teardown.
  let glLoseExt: { loseContext?: () => void } | null = null
  let glCtx: GLLoseCtx | null = null
  let glAccounted = false
  const accountGL = (): void => {
    if (glAccounted || !state) return
    try {
      const ctx = state.gl?.() ?? null
      const ext = ctx?.getExtension?.('WEBGL_lose_context') ?? null
      if (ext) {
        glLoseExt = ext
        glCtx = ctx
        glAccounted = true
        diag('info', GLCTX_UP) // main → perf.gauge('viz.glctx', +1)
      }
    } catch {
      /* best-effort accounting — never break the draw loop */
    }
  }
  const releaseGL = (): void => {
    if (!glAccounted) return
    glAccounted = false
    const ext = glLoseExt
    const ctx = glCtx
    glLoseExt = null
    glCtx = null
    try {
      // A kind whose teardown already lost the context (three: forceContextLoss)
      // needs nothing more; losing it twice is a WebGL error in the console.
      if (ctx?.isContextLost?.()) return
      if (GLCTX_RELEASE) ext?.loseContext?.() // #266 fix — free the context slot
    } catch {
      /* already lost / unsupported — ignore */
    }
  }

  scope.addEventListener('message', (ev) => {
    const data = ev.data
    // Signal frames (the `__staveSignalFrame` envelope) carry NO `type` — they're
    // handled by the reader installed in `mount`. Only control messages here.
    if (!isControlMessage(data)) return
    handleControl(data).catch((e) =>
      diag('error', `worker control '${(data as WorkerControlMessage).type}' failed: ${errMsg(e)}`, errStack(e)),
    )
  })

  async function handleControl(msg: WorkerControlMessage): Promise<void> {
    switch (msg.type) {
      case 'mount':
        await mount(msg)
        break
      case 'resize':
        resize(msg.w, msg.h, msg.dpr)
        break
      case 'pause':
        if (state) state.paused = true
        break
      case 'resume':
        if (state) state.paused = false
        break
      case 'destroy':
        destroy()
        break
      case 'config':
        // Live quality/LOD update (#269) — MERGE onto the worker's own vizConfig
        // singleton so the next draw reads it (e.g. `u.density`) without remount.
        updateVizConfig(msg.patch)
        break
      case 'options':
        // Live per-render options (#875) — REPLACE (the bag is the whole `{…}`
        // argument, so a removed key must disappear, unlike the config MERGE).
        // No-op for hydra/glsl, whose sketches have no `stave.options`.
        state?.setOptions?.(msg.options)
        break
    }
  }

  async function mount(msg: MountMessage): Promise<void> {
    // #2560 — the thread is up and took the mount. Said FIRST, before the sketch
    // runs: a sketch that is slow to set up (a big model, an HDRI) is alive, and
    // the probation must not move it to the main thread for being slow.
    post('alive')
    // Tear down a previous mount (a pooled/shared worker re-mount — B-6; harmless
    // for the one-shot worker).
    if (state) destroy()

    // Apply the marshalled vizConfig subset BEFORE building the sketch, so the
    // first frame's `getVizConfig()` reads (u.density, hydra bins) see the user's
    // settings rather than the worker bundle's DEFAULT_VIZ_CONFIG (#269 / #253).
    if (msg.config) updateVizConfig(msg.config)

    currentRuntimeRef.kind = msg.kind // #257 — attribute sync draw throws to the kind
    const dpr = msg.dpr > 0 ? msg.dpr : 1
    const feed = new WorkerBusFeed()
    if (msg.aliases) feed.setAliases(msg.aliases)
    const rawAnalyser = new RawAnalyserShim()
    const rawScheduler = new RawSchedulerShim()
    const containerSizeRef = { current: { w: msg.size.w, h: msg.size.h } }

    const strategy =
      msg.kind === 'hydra'
        ? await mountHydra(msg, feed, rawAnalyser, rawScheduler, dpr)
        : msg.kind === 'glsl'
          ? mountGLSL(msg, rawAnalyser, rawScheduler, feed)
          : msg.kind === 'three'
            ? await mountThree(msg, feed, rawScheduler, containerSizeRef, dpr)
            : await mountP5(msg, feed, rawAnalyser, rawScheduler, containerSizeRef, dpr)

    const reader = createPostMessageReader(scope as any)
    state = {
      feed,
      rawAnalyser,
      rawScheduler,
      containerSizeRef,
      canvas: msg.canvas,
      reader,
      dpr,
      paused: false,
      readySent: false,
      ...strategy,
    }
    reader.onFrame(applyAndDraw)
    diag('info', `mounted ${msg.kind} viz '${msg.name}' (${msg.size.w}×${msg.size.h}@${dpr})`)

    // #2560 — say `loaded` once the sketch has set up. A warm-up mount is paused
    // and hidden, so no frame will come to draw it: draw ONE here first, so its
    // shaders compile and its textures upload now rather than on Play's first
    // frame. The container is hidden, so nothing shows.
    const mine = state
    void strategy.whenLoaded().then(() => {
      if (state !== mine) return // destroyed or re-mounted meanwhile
      if (msg.warm) warmDraw(mine)
      post('loaded')
    })
  }

  /** #2560 — the one hidden frame of a warm-up mount (see `mount`). No signal
   *  frame has arrived, so the sketch reads silence; a throw is reported like any
   *  draw error and the sketch still counts as loaded (a broken sketch must not
   *  hold Play up). */
  function warmDraw(s: MountState): void {
    if (s.readySent) return
    const t0 = globalThis.performance?.now?.() ?? 0
    try {
      s.draw()
    } catch (e) {
      postVizLog({ level: 'error', runtime: currentRuntimeRef.kind, message: `draw(): ${errMsg(e)}`, stack: errStack(e) })
      return
    }
    lastDrawMs = (globalThis.performance?.now?.() ?? 0) - t0
    s.readySent = true
    signalReady()
    accountGL()
  }

  // ── p5 (Tier 2: makes its own canvases → blit) ─────────────────────────────
  async function mountP5(
    msg: MountMessage,
    feed: WorkerBusFeed,
    rawAnalyser: RawAnalyserShim,
    rawScheduler: RawSchedulerShim,
    containerSizeRef: { current: { w: number; h: number } },
    dpr: number,
  ): Promise<RendererStrategy> {
    // ── condition 1: shim BEFORE importing p5. makeCanvasEl mints a FRESH wrapped
    // OffscreenCanvas per createElement('canvas') (condition 5) — all worker-local;
    // we blit, not transfer, so none of these is the presenting surface. ──
    if (!P5ctor) {
      installWorkerDomShim(() => wrapCanvas(new OffscreenCanvas(1, 1)))
      const mod: any = await import('p5')
      P5ctor = mod.default || mod.p5 || mod
      P5ctor.disableFriendlyErrors = true // condition 3
    }

    // No `onTick` → `__tick` is a no-op: the feed drives the bus (PK22).
    const staveUniforms = buildStaveUniforms(feed.bus)
    // The compiler reads `stave.analyser`/`stave.scheduler` off these refs — the
    // SAME contract P5VizRenderer uses, so the sketch is none the wiser it's in a
    // worker. hapStream raw access is not marshalled (no built-in needs it) → null.
    const analyserRef = { current: rawAnalyser as unknown as AnalyserNode }
    const schedulerRef = { current: rawScheduler }
    const hapStreamRef = { current: null }
    // #875 — the sketch's `stave.options`, marshalled from main. This was an empty
    // literal (options never crossed the boundary), so every `.viz(name, {…})` /
    // `._pianoroll({…})` option was silently dropped on the DEFAULT worker path.
    const optionsRef = { current: (msg.options ?? {}) as Record<string, unknown> }
    const staveUniformsRef = { current: staveUniforms }

    const factory = compileP5Code(msg.code, msg.name)
    const userSketchFn = factory(
      hapStreamRef as any,
      analyserRef as any,
      schedulerRef as any,
      containerSizeRef as any,
      optionsRef as any,
      staveUniformsRef as any,
    )

    // #325 Tier A — p5 owns the transferred display canvas (no blit). p5 v2's
    // #_setup ALWAYS creates an internal default `createCanvas(100,100,P2D)` BEFORE the
    // user's setup, which the user's createCanvas then REPLACES (p5.esm.js:72541 + the
    // `if(this._renderer) this._renderer.remove()` in createCanvas:68303). So the FIRST
    // createElement('canvas') is the throwaway default, NOT the display canvas — binding
    // msg.canvas there would orphan it AND lock its context type. We instead wrap
    // createCanvas: call #1 (default) keeps a fresh factory canvas; call #2 (the user's
    // main createCanvas, inside setup) gets msg.canvas injected as the renderer `elt`
    // (Renderer{2D,3D}: `this.canvas = elt || createElement` — 53051/71083). createGraphics
    // does NOT route through createCanvas (own p5.Graphics canvas, 68556) → its buffers
    // stay separate factory OffscreenCanvases. No transfer → the canvas persists frame-to-
    // frame, so readback/trails work like hydra/glsl. Gated behind msg.p5DirectCanvas.
    const directCanvas = msg.p5DirectCanvas === true
    const RENDERER_CONSTS = new Set(['p2d', 'p2d-hdr', 'webgl', 'webgl2', 'webgpu'])
    // True once the user's main createCanvas has adopted msg.canvas (call #2). Lifted
    // to mount scope so draw() can branch: adopted → blit-free (canvas persists);
    // NOT adopted → a sketch that never called createCanvas (only p5's 100×100 default
    // exists, on a throwaway) — fall back to the blit so it still presents (parity with
    // the pre-#325 path; never a silent blank). The flag is final by the first draw
    // (createCanvas runs in setup, draws start after setupDone).
    let adopted = false

    let setup = false
    // #2560 — p5's setup is async (#_setup awaits preload); loaded = it ran.
    let markLoaded: () => void = () => {}
    const loadedP5 = new Promise<void>((resolve) => {
      markLoaded = resolve
    })
    // Wrap the sketch: after the user's setup runs, stop p5's auto-loop so WE drive
    // one redraw() per frame (1:1 cadence). p5 reads p.setup AFTER this fn assigns
    // it (instance-mode contract), so wrapping here is what #_setup calls.
    const sketchFn = (p: any): void => {
      if (directCanvas) {
        // Install the createCanvas adopter BEFORE the user sketch runs (the compiler's
        // `with(p)` resolves bare `createCanvas` to this instance-own override at call
        // time — p5's internal `this.createCanvas` does too).
        const displayEl = wrapCanvas(msg.canvas)
        let ccCalls = 0
        const origCreate = p.createCanvas.bind(p)
        p.createCanvas = function (w: number, h: number, renderer?: unknown, ...rest: unknown[]) {
          ccCalls += 1
          // call #1 = p5's internal default createCanvas(100,100,P2D) → throwaway canvas
          // (p5 ALWAYS makes one before user setup; it's replaced by the user's call).
          if (ccCalls === 1) return origCreate(w, h, renderer, ...rest)
          // EVERY user createCanvas (call #2+) adopts msg.canvas as the renderer `elt`. p5
          // never calls createCanvas internally beyond the default (resizeCanvas/pixelDensity
          // don't), so calls ≥2 are all the user's. Adopting on each (not just the first)
          // keeps a rare double-createCanvas of the SAME context type working (re-getContext
          // is idempotent). The ONE unsupported case — switching renderer TYPE across two
          // createCanvas calls in setup (P2D→WEBGL) — locks msg.canvas to the first type and
          // would blank; it also can't reuse an element across context types on the main
          // thread, and is covered by the `stave.viz.p5direct='0'` escape hatch. Pass a valid
          // renderer constant so our canvas lands in the `elt` slot (createCanvas treats a
          // non-constant 3rd arg as the elt → unshift; a bare createCanvas(w,h) needs an
          // explicit P2D to carry the elt positionally).
          adopted = true
          const rk = RENDERER_CONSTS.has(renderer as string) ? (renderer as string) : 'p2d'
          return origCreate(w, h, rk, displayEl)
        }
      }
      userSketchFn(p)
      const setup0 = p.setup
      p.setup = function (this: unknown) {
        if (typeof setup0 === 'function') setup0.call(this)
        try {
          p.noLoop()
        } catch {
          /* noLoop before renderer ready — redraw still drives draws */
        }
        setup = true
        markLoaded()
      }
    }
    const inst = new P5ctor(sketchFn)

    // Presenting surface. #325 Tier A direct path: p5 OWNS msg.canvas (adopted as its
    // main canvas above) and sizes it itself via createCanvas/pixelDensity — the host
    // takes NO context and does NO blit, so the canvas persists frame-to-frame. Blit
    // path (default): size the backing store to device pixels + claim a bitmaprenderer.
    let present: ImageBitmapRenderingContext | null = null
    if (!directCanvas) {
      msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr))
      msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr))
      try {
        present = msg.canvas.getContext('bitmaprenderer')
      } catch (e) {
        diag('error', `bitmaprenderer unavailable: ${errMsg(e)}`)
      }
    }

    return {
      setupDone: () => setup,
      whenLoaded: () => loadedP5,
      // #266 — p5's WEBGL context lives on its internal render canvas (drawingContext);
      // 2D sketches return a CanvasRenderingContext2D whose getExtension yields null.
      gl: () => (inst?.drawingContext as GLLoseCtx | undefined) ?? null,
      // #875 — the compiler closed over THIS ref, so the next draw() reads the new
      // bag; no remount, exactly like the main-thread renderer's ref re-assign.
      setOptions: (options: Record<string, unknown>) => {
        optionsRef.current = options
      },
      draw: () => {
        inst.redraw() // 1:1 with this frame. User-draw throws are swallowed by
        // p5Compiler's lifecycle wrap → forwarded via the engineLog subscription (#257).
        // #325 Tier A: p5 drew STRAIGHT into msg.canvas (adopted) — nothing to blit, and
        // crucially nothing CLEARS the canvas (no transferToImageBitmap) → readback and
        // skip-background() trails persist exactly like the main thread.
        if (directCanvas && adopted) return
        // Otherwise blit p5's worker-local render canvas → the presenting canvas. This is
        // the blit path (flag off) AND the direct-path fallback for a sketch that never
        // called createCanvas (only p5's 100×100 default exists → never adopted msg.canvas;
        // present it instead of blanking). The direct path skipped the eager bitmaprenderer
        // claim, so claim it lazily here (msg.canvas is untouched in the un-adopted case).
        if (directCanvas && !present) {
          msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr))
          msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr))
          try {
            present = msg.canvas.getContext('bitmaprenderer')
          } catch (e) {
            diag('error', `bitmaprenderer unavailable: ${errMsg(e)}`)
          }
        }
        if (!present) return
        const src: OffscreenCanvas | undefined = inst?.drawingContext?.canvas
        if (!src) return
        try {
          present.transferFromImageBitmap(src.transferToImageBitmap())
        } catch (e) {
          diag('error', `present blit failed: ${errMsg(e)}`)
        }
      },
      resizeKind: (w, h, dprNew) => {
        // Direct path: p5 owns msg.canvas; resizeCanvas resizes it in place
        // (p5.esm.js resizeCanvas → _renderer.resize, no element recreation) — the
        // host must NOT set msg.canvas.width or it fights p5's own sizing.
        if (!directCanvas) {
          msg.canvas.width = Math.max(1, Math.round(w * dprNew))
          msg.canvas.height = Math.max(1, Math.round(h * dprNew))
        }
        // p5 sizes its render canvas off stave.width/height (containerSizeRef) on
        // the next draw; nudge resizeCanvas so it matches before the next frame.
        inst?.resizeCanvas?.(w, h)
      },
      teardown: () => {
        markLoaded() // nothing left to wait for
        // Mirror P5VizRenderer.destroy's belt-and-suspenders teardown — neutralise
        // p5's async #_setup chain so a destroy mid-flight can't produce output.
        try {
          inst.hitCriticalError = true
          inst.setup = function () {}
          inst.draw = function () {}
          inst.preload = function () {}
          inst.createCanvas = function () {
            return null
          }
          inst._setupDone = true
          inst.remove?.()
        } catch {
          /* ignore */
        }
      },
    }
  }

  // ── hydra (Tier 1: accepts the canvas → render direct, no blit) ────────────
  async function mountHydra(
    msg: MountMessage,
    feed: WorkerBusFeed,
    rawAnalyser: RawAnalyserShim,
    rawScheduler: RawSchedulerShim,
    _dpr: number,
  ): Promise<RendererStrategy> {
    // condition 1: shim (window=self alias + thin document) BEFORE importing hydra
    // (it touches window at module-eval — mouseListen). 2-part subset (PV70).
    installWorkerHydraShim({ w: msg.size.w, h: msg.size.h })
    if (!Hydractor) {
      const mod: any = await import('hydra-synth')
      Hydractor = mod.default || mod
    }

    // #883 — the SAME live options slot idiom as mountP5 below: the bag reads
    // THROUGH this ref, and `setOptions` replaces `.current` on every re-publish.
    // Without this the worker builds an options-less bag, and since the worker is
    // the DEFAULT renderer (#245) hydra options would work inline and be dead
    // full-screen — which is exactly how #880 hid for six weeks.
    const optionsRef = { current: (msg.options ?? {}) as Record<string, unknown> }
    const bag = buildHydraStaveBag(feed.bus, optionsRef)
    // Combined raw scheduler shim → `stave.scheduler` + the `H()` fallback. Per-
    // track raw isn't marshalled (signalFrame ships combined only); per-track
    // signal still works via the bus-backed `u.track(id)` (fed by activeByTrack).
    bag.scheduler = rawScheduler

    const bins = getVizConfig().hydraAudioBins
    // Presenting canvas — size to CSS px (match the main HydraVizRenderer, which
    // does NOT dpr-scale its canvas); hydra renders into it DIRECTLY (no blit).
    msg.canvas.width = Math.max(1, Math.round(msg.size.w))
    msg.canvas.height = Math.max(1, Math.round(msg.size.h))

    const hydra = new Hydractor({
      canvas: msg.canvas,
      width: msg.size.w,
      height: msg.size.h,
      detectAudio: false, // no Meyda/getUserMedia/AudioContext in the worker
      makeGlobal: false, // generators live on hydra.synth
      autoLoop: false, // WE drive tick() (1:1 with the frame — PK22)
      enableStreamCapture: false, // OffscreenCanvas has no captureStream
    })
    const synth = hydra.synth

    // With makeGlobal:false the audio object is on the instance (hydra.a); bridge
    // it onto synth so preset patterns read `s.a.fft[]` (mirror initHydra 537-549).
    const audio = hydra.a
    if (audio) {
      synth.a = audio
      if (typeof audio.setCutoff === 'function') audio.setCutoff(bins)
      if (typeof audio.setBins === 'function') audio.setBins(bins)
      if (!Array.isArray(audio.fft) || audio.fft.length < bins) {
        audio.fft = new Array(bins).fill(0)
      }
    } else {
      synth.a = { fft: new Array(bins).fill(0) }
    }

    // Run the user sketch (a code string compiled in-worker — built-in hydra
    // closures are NOT worker-routed in B-5, deferred follow-up).
    compileHydraCode(msg.code)(synth, bag)

    // Reusable scratch for the s.a.fft downsample (avoid a per-frame alloc).
    let freqScratch = new Uint8Array(rawAnalyser.frequencyBinCount || 1024)

    return {
      setupDone: () => true, // pattern ran synchronously above; frames arrive after
      whenLoaded: () => Promise.resolve(),
      // #266 — hydra renders directly into the presenting canvas (regl owns its
      // WebGL context); re-getContext returns that same context for release.
      gl: () =>
        ((msg.canvas.getContext('webgl2') as GLLoseCtx | null) ??
          (msg.canvas.getContext('webgl') as GLLoseCtx | null)),
      // #883 — the bag closed over `optionsRef`, so the next frame reads the new
      // options with no remount; mirrors mountP5's setOptions.
      //
      // DEFENSIVE, not currently exercised: `WorkerVizRenderer.update` posts an
      // `options` message for EVERY kind, and the dispatcher does
      // `state?.setOptions?.(msg.options)` — so without this, a hydra options
      // message is silently swallowed, which is the exact failure class #883
      // exists to kill. Verified by neutering it: the e2e stays green, because an
      // inline re-eval REMOUNTS and the new bag rides in on MountMessage.options.
      // So this covers the no-remount path only, and no test reaches it yet.
      setOptions: (options: Record<string, unknown>) => {
        optionsRef.current = options
      },
      draw: () => {
        // Feed s.a.fft[] from the master analyser bytes (mirror pumpAudio 590-600).
        const a = hydra?.synth?.a
        if (a?.fft) {
          if (freqScratch.length !== rawAnalyser.frequencyBinCount) {
            freqScratch = new Uint8Array(rawAnalyser.frequencyBinCount)
          }
          rawAnalyser.getByteFrequencyData(freqScratch)
          const numBins = getVizConfig().hydraAudioBins
          const binSize = Math.max(1, Math.floor(freqScratch.length / numBins))
          for (let i = 0; i < numBins; i++) {
            let sum = 0
            for (let j = 0; j < binSize; j++) sum += freqScratch[i * binSize + j]
            a.fft[i] = sum / (binSize * 255)
          }
        }
        // The bus is already ticked by feed.applyFrame (PK22) — do NOT re-tick here.
        hydra.tick(performance.now()) // one shader frame (throws → caught)
      },
      resizeKind: (w, h) => {
        msg.canvas.width = Math.max(1, Math.round(w))
        msg.canvas.height = Math.max(1, Math.round(h))
        hydra?.setResolution?.(w, h)
      },
      teardown: () => {
        try {
          hydra?.synth?.hush?.()
        } catch {
          /* ignore */
        }
      },
    }
  }

  // ── glsl (Tier 1: raw WebGL2 on the canvas → render direct, no blit, no lib) ──
  function mountGLSL(
    msg: MountMessage,
    rawAnalyser: RawAnalyserShim,
    rawScheduler: RawSchedulerShim,
    feed: WorkerBusFeed,
  ): RendererStrategy {
    // Size the presenting canvas to CSS px (match HydraVizRenderer / mountHydra —
    // the Tier-1 direct-render sibling; maxDpr is 1 so backing == CSS anyway).
    msg.canvas.width = Math.max(1, Math.round(msg.size.w))
    msg.canvas.height = Math.max(1, Math.round(msg.size.h))

    const gl = msg.canvas.getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) throw new Error('glsl: WebGL2 unavailable in worker')
    // Compile/link NOW (sync) — a shader error throws here, propagates to mount's
    // caller → diag('error') → main onError → FallbackVizRenderer degrades to the
    // main-thread GLSLVizRenderer (#247), exactly like a p5/hydra compile error.
    const program: GLSLProgram = createGLSLProgram(gl, msg.code)
    const startMs = globalThis.performance?.now?.() ?? 0
    // Upcoming notes (#2571): the frame's `rawScheduler` window, packed into the
    // `uNotes` texture. Repacked only when the window's version moves.
    const notes = new GLSLNoteFeed()
    const warnDropped = (dropped: number, total: number): void =>
      postVizLog({ level: 'warn', runtime: 'glsl', source: msg.name || undefined, message: droppedNotesMessage(dropped, total) })

    return {
      setupDone: () => true, // program built synchronously above; draw on first frame
      whenLoaded: () => Promise.resolve(),
      // #266 — raw WebGL2 context we own; re-get returns the same context for the
      // host's accountGL/releaseGL. The EASIEST gl() of the three kinds (no search).
      gl: () => (msg.canvas.getContext('webgl2') as GLLoseCtx | null),
      draw: () => {
        // Feed the master analyser straight into the core (it uploads it to the
        // iChannel0 audio texture). rawAnalyser is refreshed by applyAndDraw before
        // this runs — the SAME already-refreshed shim mountHydra reads. No new seam.
        // Pattern EVENTS (#284): feed.bus is already ticked by applyAndDraw (PK22) —
        // read its named-signal levels into the u* uniforms (the SAME bus reads
        // hydra/p5 use). This is the contract's predicted generalization point: the
        // event feed is kind-specific (a uniform marshal), unlike the audio texture.
        const timeMs = (globalThis.performance?.now?.() ?? 0) - startMs
        if (program.readsNotes) {
          notes.update(
            rawScheduler.all(), rawScheduler.version(), rawScheduler.now(), rawScheduler.cps(),
            feed.bus.tracks, warnDropped,
          )
        }
        program.draw(
          rawAnalyser,
          { width: msg.canvas.width, height: msg.canvas.height, timeMs },
          readGLSLEvents(feed.bus),
          readGLSLTracks(feed.bus), // #297 per-track signals (same already-ticked bus)
          notes, // #2571 upcoming notes → uNotes / uNoteCount / uNow / uCps
        )
      },
      resizeKind: (w, h) => {
        msg.canvas.width = Math.max(1, Math.round(w))
        msg.canvas.height = Math.max(1, Math.round(h))
      },
      teardown: () => {
        try {
          program.dispose()
        } catch {
          /* ignore */
        }
      },
    }
  }

  // ── three (#2516: a plain three.js sketch; its renderer draws on the canvas) ──
  async function mountThree(
    msg: MountMessage,
    feed: WorkerBusFeed,
    rawScheduler: RawSchedulerShim,
    containerSizeRef: { current: { w: number; h: number } },
    dpr: number,
  ): Promise<RendererStrategy> {
    // A syntax error or an import outside the bundle throws here, before any
    // frame: mount's caller posts diag('error'), and the main FallbackVizRenderer
    // falls back to ThreeVizRenderer, which reports it on its line (GLSL's model).
    const compiled = compileThreeSketch(msg.code)
    if (compiled.syntaxError) throw compiled.syntaxError
    const loaded = await loadThreeModules(compiled)

    // No onTick: the feed has already ticked the bus this frame (PK22).
    const uniforms = buildStaveUniforms(feed.bus)
    const optionsRef = { current: (msg.options ?? {}) as Record<string, unknown> }
    let currentDpr = dpr
    msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr))
    msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr))

    // Before the first frame, an error belongs to the fallback (it re-runs the
    // sketch on the main thread and reports it there); after it, the worker
    // reports it itself, like a p5 draw() error (#257).
    let drawn = false
    let disposed = false
    const run = runThreeSketch(compiled, loaded, {
      canvas: msg.canvas,
      size: () => containerSizeRef.current,
      dpr: () => currentDpr,
      uniforms: () => uniforms,
      options: () => optionsRef.current,
      // #2570 — the same pre-queried window p5's `stave.scheduler` reads,
      // refreshed from each frame's `rawScheduler` before the draw.
      scheduler: () => rawScheduler,
      createCanvas: () => new OffscreenCanvas(1, 1),
      report: (entry) => {
        if (entry.level === 'error' && !drawn) return
        postVizLog({ ...entry, runtime: 'three' })
      },
    })
    void run.done.then(({ error }) => {
      if (error && !drawn && !disposed) diag('error', `three: ${error.message}`, errStack(error))
    })

    return {
      setupDone: () => run.ready(),
      // #2560 — top level done and every loader item in (the model, the HDRI).
      whenLoaded: () => run.whenLoaded(),
      gl: () => run.gl() as GLLoseCtx | null,
      setOptions: (options: Record<string, unknown>) => {
        optionsRef.current = options
      },
      draw: () => {
        // Set BEFORE the frame: an error inside the loop's first frame is the
        // worker's to report (the fallback would only re-run the same loop), and
        // the core reports each error once, so one dropped here is lost for good.
        drawn = true
        run.frame(globalThis.performance?.now?.() ?? 0)
      },
      resizeKind: (_w, _h, dprNew) => {
        // containerSizeRef already holds the new size; the sketch's own resize
        // listener (or Stave, when it has none) sizes the renderer and canvas.
        currentDpr = dprNew
        run.resize()
      },
      teardown: () => {
        disposed = true
        run.dispose()
      },
    }
  }

  function applyAndDraw(frame: SignalFrame): void {
    const s = state
    if (!s) return
    // #261 backpressure: ack EVERY received frame (on receipt, not draw success —
    // a pre-setup frame that doesn't draw must still ack or the bounded pipeline
    // deadlocks before p5's async setup completes). The main side caps unacked
    // frames in flight so it can't flood a slow worker into a stale backlog.
    try {
      // Carry the LAST completed draw's duration (known from the prior frame) —
      // this ack is sent on receipt, before THIS frame draws (#230 Phase F bridge).
      scope.postMessage({ type: 'frameAck', drawMs: lastDrawMs })
    } catch {
      /* ignore late-teardown failures */
    }
    // Bus tick (PK22 — drops stale seq, ticks once) + refresh the raw shims.
    s.feed.applyFrame(frame)
    let master: AnalyserBytes | undefined
    for (const a of frame.analysers) if (a.key === MASTER_KEY) master = a
    s.rawAnalyser.set(master)
    s.rawScheduler.set(frame.rawScheduler)

    if (!s.setupDone() || s.paused) return
    const drawT0 = globalThis.performance?.now?.() ?? 0
    try {
      s.draw() // kind-specific (p5 redraw+blit | hydra fft+tick)
    } catch (e) {
      // #257 — sync throws (hydra tick, blit). p5's are emitLog-routed above.
      postVizLog({ level: 'error', runtime: currentRuntimeRef.kind, message: `draw(): ${errMsg(e)}`, stack: errStack(e) })
      return
    }
    // Record this draw's wall-time for the NEXT ack to carry (#230 Phase F).
    lastDrawMs = (globalThis.performance?.now?.() ?? 0) - drawT0
    // First successful frame → one-shot liveness signal (#247 fallback gate).
    if (!s.readySent) {
      s.readySent = true
      signalReady()
      accountGL() // #266 — the GL context exists once a frame has drawn
    }
  }

  function resize(w: number, h: number, dpr: number): void {
    const s = state
    if (!s) return
    s.dpr = dpr > 0 ? dpr : 1
    s.containerSizeRef.current = { w, h }
    try {
      s.resizeKind(w, h, s.dpr)
    } catch (e) {
      diag('error', `resize failed: ${errMsg(e)}`)
    }
  }

  function destroy(): void {
    const s = state
    state = null
    lastDrawMs = undefined // don't carry a dead sketch's draw cost into the next mount
    if (!s) return
    try {
      s.reader.dispose()
    } catch {
      /* ignore */
    }
    try {
      s.teardown()
    } catch {
      /* ignore */
    }
    // #266 — after the kind has neutralised its instance, explicitly lose the
    // (now-orphaned) WebGL context so a POOLED warm worker frees the slot. On the
    // terminate path this is harmless; on reuse the next mount creates a fresh
    // canvas+context, so losing the old one can't affect it.
    releaseGL()
  }
}

/** Back-compat alias — the app's worker entry historically called `hostP5Worker`.
 *  The host now serves both kinds; the name is retained so existing wiring (and
 *  the worker-safe `index.ts` export) keeps resolving. Prefer `hostVizWorker`. */
export const hostP5Worker = hostVizWorker

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function errStack(e: unknown): string | undefined {
  return e instanceof Error
    ? String(e.stack || '').split('\n').slice(0, 6).join('\n')
    : undefined
}
