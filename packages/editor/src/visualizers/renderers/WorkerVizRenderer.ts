/**
 * WorkerVizRenderer — a `VizRenderer` that runs the p5 sketch in an
 * OffscreenCanvas Web Worker, off the main thread (Phase B / B-3, epic #228).
 *
 * It is the MAIN-side counterpart to `hostP5Worker`:
 *   - `mount`   — create a `<canvas>`, `transferControlToOffscreen()`, spawn a
 *     worker (via the app-injected factory), post a `mount` with the sketch CODE
 *     STRING + transferred canvas, and start ONE main `requestAnimationFrame`
 *     loop that `sample()`s the live signal feed + `writeFrame()`s it to the
 *     worker. That rAF is the single clock — the worker draws exactly one frame
 *     per `writeFrame` (1:1 → cadence can't drift; PK22).
 *   - `update`  — rebind the sampler's live inputs (re-evaluate swaps analysers /
 *     scheduler / hap stream), mirroring P5VizRenderer.update.
 *   - `resize`  — forward the new size + DPR to the worker.
 *   - `pause`/`resume` — stop/start the sampling loop + tell the worker.
 *   - `destroy` — stop the loop, tell the worker to tear down, terminate it.
 *
 * The ONLY per-frame main-thread cost is `sample()` (read analyser bytes + ONE
 * wide scheduler query + now) + a transferable `postMessage` — the heavy
 * `draw()` is gone from main. That residual is what the matrix measures (PLAN §8).
 *
 * Falls back is NOT handled here: `makeRenderer` only constructs a
 * WorkerVizRenderer when a worker factory is registered AND the transport is
 * worker-capable; otherwise it builds a `P5VizRenderer`. If the factory is
 * somehow absent at mount, `mount` reports via `onError` so the host can recover.
 *
 * REF: hostP5Worker.ts, signalSampler.ts, signalTransport.ts, vizWorkerFactory.ts,
 *      P5VizRenderer.ts (the lifecycle + alias contract mirrored here), PK22.
 */

import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { VizRenderer, VizOptions } from '../types'
import type { BusAnalyser } from '../signals/SignalBus'
import type { IRPattern } from '../../codeView'
import { MainSignalSampler } from '../worker/signalSampler'
import { createPostMessageWriter, type SignalTransportWriter } from '../worker/signalTransport'
import type { SignalFrameSource } from '../demoSignalSource'
import { getVizWorkerFactory } from '../vizWorkerFactory'
import { acquireVizWorker, releaseVizWorker } from '../vizWorkerPool'
import { isP5DirectCanvasEnabled, isVizWorkerPoolEnabled } from '../vizFlags'
import { getVizConfig, onVizConfigChange, pickWorkerVizConfig } from '../vizConfig'
import { vizGovernor } from '../vizGovernor'
import { vizFramePump, type PumpDriven } from '../vizFramePump'
import type { FrameSampleCache } from '../worker/frameSampleCache'
import { resolveAliasesForEngine, DEFAULT_VIZ_ENGINE } from '../signals/aliasMap'
import { getStoredSignalAliases } from '../../workspace/editorRegistry'
import { perf } from '../../perf/profiler'
import { emitLog } from '../../engine/engineLog'
import type {
  MountMessage,
  WorkerDiagMessage,
  WorkerReadyMessage,
  WorkerFrameAckMessage,
  WorkerVizLogMessage,
} from '../worker/workerMessages'
import { VizRendererBase } from './VizRendererBase'

let workerPerfSeq = 0
/** Tie-break counter for options bags that can't be serialized to a change key.
 *  Its own counter, NOT the perfId sequence — that one names renderers. */
let optionsKeySeq = 0

/** Order-independent serialization of an options bag — the change key `update()`
 *  compares against (#875). Key order varies between evaluates for an identical
 *  bag, so sort before stringifying or every re-publish would look like a change. */
function stableKey(options: VizOptions): string {
  try {
    return JSON.stringify(
      Object.keys(options)
        .sort()
        .map((k) => [k, options[k]]),
    )
  } catch {
    // Cyclic value survived the per-key clone check (a self-referencing object is
    // structured-cloneable but NOT JSON-serializable) — treat as always-changed.
    return `unserializable:${++optionsKeySeq}`
  }
}

/**
 * Max SignalFrames allowed in flight (written but not yet acked by the worker)
 * before the main sampler stops producing — the #261 backpressure cap. The main
 * rAF can fire at the display rate (e.g. 120fps) while a heavy-WEBGL worker draws
 * far slower (~20fps); without a bound, the surplus backlogs in the worker's
 * postMessage queue and the worker renders seconds-stale data (looks "static").
 * A small cap keeps the worker's queue ~1 frame deep (always drawing the freshest
 * sampled frame) while leaving one frame buffered so it never idles waiting.
 */
const MAX_FRAMES_IN_FLIGHT = 2

/** Effective device pixel ratio for worker viz, capped by `vizConfig.maxDpr`
 *  (#261). The worker p5 sketch renders at 1×; capping the presenting canvas to
 *  match avoids compositing an upscaled 1× image at 2× for nothing. */
function effectiveDpr(): number {
  const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  const cap = getVizConfig().maxDpr
  return cap > 0 ? Math.min(raw, cap) : raw
}

/** Minimum ms between produced frames for the `vizConfig.maxFps` cap (#261).
 *  0 when uncapped (maxFps ≤ 0) → produce every rAF (subject to backpressure). */
function minFrameMs(): number {
  const fps = getVizConfig().maxFps
  return fps > 0 ? 1000 / fps : 0
}

export class WorkerVizRenderer extends VizRendererBase implements PumpDriven {
  private worker: Worker | null = null
  private writer: SignalTransportWriter | null = null
  private readonly sampler = new MainSignalSampler()
  /** When set (viz PREVIEWS, #838), supersedes the live sampler in the pump: the
   *  frame comes from this muted demo feed instead of the analyser/scheduler, so a
   *  card can render its viz audio-reactively while nothing is playing. Null =
   *  the normal live path. */
  private demoSource: SignalFrameSource | null = null
  private running = false
  /** Frames written but not yet acked by the worker (#261 backpressure). The
   *  sampler skips producing while this is at the cap so a slow worker can't be
   *  flooded into a stale backlog. Reset to 0 on (re)start so a resume can't be
   *  wedged by acks owed for frames written before a pause. */
  private inFlight = 0
  /** rAF timestamp of the last produced frame — the `vizConfig.maxFps` cap clock
   *  (#261). Reset on (re)start. */
  private lastProduceTs = 0
  /** Governor render-resolution scale currently applied to the backing store
   *  (lever 3, P122/PV91). 1 = full (the no-op common case). The tick re-posts a
   *  scaled `resize` only when `vizGovernor.resolutionScale()` crosses a quantized
   *  step, so the (relatively expensive) backing-store realloc fires rarely. */
  private govResScale = 1
  private size = { w: 400, h: 300 }
  private onError: ((e: Error) => void) | null = null
  /** Stable id — the `vizGovernor` round-robin key AND the `vizFramePump` registry
   *  key (public for the `PumpDriven` contract). */
  readonly perfId = `worker#${++workerPerfSeq}`
  private diagHandler: ((ev: MessageEvent) => void) | null = null
  /** The presenting <canvas> this renderer appended (transferred to the worker).
   *  Tracked so destroy() removes it — else a fallback to the main-thread renderer
   *  would leave a dead, frozen canvas behind it (#247). */
  private canvasEl: HTMLCanvasElement | null = null
  /** Fired ONCE when the worker posts its first-frame `ready` (#247). The
   *  `FallbackVizRenderer` sets this to learn the worker is healthy. */
  private onReady: (() => void) | null = null
  /** Unsubscribe from vizConfig changes — re-marshals the worker subset on a
   *  quality/LOD change (#269). Cleared in destroy() so a torn-down renderer
   *  doesn't post to a terminated worker. */
  private configUnsub: (() => void) | null = null
  /** Whether this renderer drew its worker from the reuse POOL (#263 A). Decided
   *  at mount; on destroy a pooled worker is PARKED (kept warm) instead of
   *  terminated, so the next mount reuses the thread (no fresh allocation). */
  private pooled = false
  /** Set once the worker reports its first `ready` frame. Only a HEALTHY worker
   *  is returned to the pool on destroy — a never-ready (broken/fallback) worker
   *  is terminated so it can't poison a future acquire. */
  private ready = false
  /** Set when the worker reports it created a WebGL context (`glctx+`, #266) — so
   *  destroy() can decrement the `viz.glctx` gauge reliably (the worker's release
   *  happens after we've detached its listener, so we account it main-side). */
  private glAccounted = false
  /** Serialized options last posted to the worker (#875) — `update()` only re-posts
   *  when the bag actually changed, so a re-publish with identical options costs
   *  nothing. `null` until mount. */
  private lastOptionsKey: string | null = null

  /** @param kind renderer kind (`'p5'` B-3 / `'hydra'` B-5 / `'glsl'` #281).
   *  @param code raw sketch source. @param name workspace path (error attribution). */
  constructor(
    private readonly kind: 'p5' | 'hydra' | 'glsl',
    private readonly code: string,
    private readonly name: string,
  ) {
    super()
  }

  /** Register a callback fired once when the worker reports its first successful
   *  frame (`ready`). Used by `FallbackVizRenderer` to end the startup probation;
   *  must be set BEFORE `mount`. */
  whenReady(cb: () => void): void {
    this.onReady = cb
  }

  /** Drive this renderer from a muted DEMO signal feed instead of the live
   *  analyser/scheduler (viz PREVIEWS, #838). Set before/after mount; null
   *  restores the live path. The pump reads `next(ts)` each produced frame. */
  setDemoSource(src: SignalFrameSource | null): void {
    this.demoSource = src
  }

  protected onMount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    this.onError = onError
    this.size = { w: size.w, h: size.h }
    perf.gauge('viz.worker', 1) // live worker-viz gauge (#228); -1 in destroy()

    const make = getVizWorkerFactory()
    if (!make) {
      onError(new Error('WorkerVizRenderer: no viz-worker factory registered'))
      return
    }
    this.pooled = isVizWorkerPoolEnabled()

    try {
      // ── presenting canvas: the worker owns it via transferControlToOffscreen;
      // the browser composites the worker's draws into this element. ──
      const dpr = effectiveDpr()
      const canvas = document.createElement('canvas')
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      canvas.width = Math.max(1, Math.round(size.w * dpr))
      canvas.height = Math.max(1, Math.round(size.h * dpr))
      container.appendChild(canvas)
      this.canvasEl = canvas
      const offscreen = canvas.transferControlToOffscreen()

      // Reuse a warm parked worker when the pool is on (#263 A) — else spawn a
      // fresh one. acquireVizWorker falls back to the factory when no parked
      // worker is free, so it never returns null while `make` exists.
      const worker = this.pooled ? (acquireVizWorker() ?? make()) : make()
      this.worker = worker
      this.writer = createPostMessageWriter(worker)

      // Worker → main diagnostics (sketch errors, ready). Forward errors to the
      // host's onError so the existing engineLog/console surfacing applies.
      this.diagHandler = (ev: MessageEvent) => {
        const d = ev.data as
          | WorkerDiagMessage
          | WorkerReadyMessage
          | WorkerFrameAckMessage
          | WorkerVizLogMessage
          | undefined
        if (!d) return
        if (d.type === 'frameAck') {
          // The worker consumed a frame — free a slot in the bounded pipeline (#261).
          if (this.inFlight > 0) this.inFlight--
          // Profiler bridge (#230 Phase F): the ack carries the prior draw's
          // wall-time → record it so the default worker path is no longer a
          // profiler blind spot. Aggregated section (like p5.bus / hydra.draw).
          if (typeof d.drawMs === 'number') perf.record('viz.worker.draw', d.drawMs)
          return
        }
        if (d.type === 'vizlog') {
          // #257 — a worker viz RUNTIME error (p5/hydra draw/setup throw). Re-emit
          // into the MAIN engineLog so it surfaces in the Console panel + squiggle
          // like the main-thread path. NOT onError → no fallback (post-ready user
          // typo must not tear the worker down). Worker already deduped per error.
          emitLog(d.entry)
          return
        }
        if (d.type === 'ready') {
          // First successful worker frame — end the fallback probation (#247) and
          // mark the worker HEALTHY so destroy() may pool it (#263 A). A worker
          // that never reaches ready (broken/fallback path) is NEVER pooled — else
          // the next acquire would reuse a broken worker and fail again.
          this.ready = true
          this.onReady?.()
          return
        }
        if (d.type !== 'diag') return
        if (d.message === 'glctx+') {
          // Worker created a WebGL context (#266). Track the live count via a gauge
          // mirroring `viz.worker`; decremented main-side in destroy() (the worker's
          // own release fires after we detach this listener, so we can't rely on it).
          this.glAccounted = true
          perf.gauge('viz.glctx', 1)
          return
        }
        if (d.level === 'error') {
          // Surface the WORKER-side stack (the throw site) — the forwarded Error
          // only carries the message, so the worker stack would otherwise be lost.
          // eslint-disable-next-line no-console
          console.error(`[viz worker ${this.name}] ${d.message}`, d.stack ? `\n${d.stack}` : '')
          onError(new Error(`[viz worker ${this.name}] ${d.message}`))
        }
      }
      worker.addEventListener('message', this.diagHandler)

      // Bind the live signal feed, then ship the mount with the transferred canvas.
      this.bindSampler(components)
      const aliases = resolveAliasesForEngine(getStoredSignalAliases(), DEFAULT_VIZ_ENGINE)
      const mountOptions = this.postOptions(components)
      const mountMsg: MountMessage = {
        type: 'mount',
        kind: this.kind,
        code: this.code,
        name: this.name,
        canvas: offscreen,
        size: { w: size.w, h: size.h },
        dpr,
        aliases,
        // Marshal the worker-relevant vizConfig subset (#269) so the worker's own
        // singleton reflects the user's quality/LOD settings, not the bundle default.
        config: pickWorkerVizConfig(),
        // #325 Tier A — p5 renders direct into `canvas` (default ON); hydra/glsl already do.
        p5DirectCanvas: this.kind === 'p5' && isP5DirectCanvasEnabled(),
        // #875 — the sketch's `stave.options`. The main-thread renderer hands the
        // bag straight to the compiler; the worker can only get it by value.
        options: mountOptions,
      }
      this.lastOptionsKey = stableKey(mountOptions)
      worker.postMessage(mountMsg, [offscreen])

      // Re-marshal on any later quality/LOD change so the worker sketch updates
      // live (e.g. dragging the performance-mode setting) without a remount (#269).
      this.configUnsub = onVizConfigChange(() => {
        this.worker?.postMessage({ type: 'config', patch: pickWorkerVizConfig() })
      })

      this.start()
    } catch (e) {
      onError(e as Error)
    }
  }

  protected onUpdate(components: Partial<EngineComponents>): void {
    if (!this.worker) return
    this.bindSampler(components)
    // #875 — a re-evaluate can change the options bag (editing the `{…}` argument).
    // The main-thread renderer just re-assigns its ref; the worker needs a message.
    // Post only on an actual CHANGE: update() runs on every component re-publish,
    // and the bag is unchanged in the overwhelming majority of them.
    const next = this.postOptions(components)
    const key = stableKey(next)
    if (key !== this.lastOptionsKey) {
      this.lastOptionsKey = key
      this.worker.postMessage({ type: 'options', options: next })
    }
  }

  /** The options bag as the worker can receive it: structured-CLONED, not shared.
   *  A non-cloneable value (a function passed to `.viz(name, {…})`) would throw
   *  DataCloneError from `postMessage` and take the whole mount down — so drop
   *  those keys instead. They could never have reached a worker sketch anyway, and
   *  dropping one key degrades exactly as far as the pre-fix behaviour did.
   *
   *  PURE — it must not touch `lastOptionsKey`. (It did, briefly: `update()` then
   *  compared the fresh key against the one this call had just written, so it saw
   *  "no change" every time and never posted. A silent no-op fix for a silent
   *  no-op bug.) */
  private postOptions(components: Partial<EngineComponents>): VizOptions {
    const src = components.options
    if (!src) return {}
    const out: VizOptions = {}
    for (const [k, v] of Object.entries(src)) {
      try {
        structuredClone(v)
        out[k] = v
      } catch {
        /* non-cloneable (function / DOM node) — drop the key, keep the viz */
      }
    }
    return out
  }

  resize(w: number, h: number): void {
    this.size = { w, h }
    this.postBackingSize()
  }

  /** Post a `resize` sizing the worker backing store to the CSS size scaled by the
   *  governor's render-resolution lever (P122/PV91). At scale 1 (disabled/smooth)
   *  this is byte-identical to posting the raw CSS size — transparent. Under stress
   *  it shrinks the backing store (smaller buffer, CSS size unchanged → stretched to
   *  fill, aspect-preserved PV76); ¼ the fragment work at scale 0.5. We scale `w,h`,
   *  NOT `dpr`, because the GLSL + hydra worker `resizeKind` IGNORE dpr (size to CSS
   *  px directly) — and those are exactly the heavy GPU-bound kinds this targets. */
  private postBackingSize(): void {
    if (!this.worker) return
    const s = this.govResScale
    const w = Math.max(1, Math.round(this.size.w * s))
    const h = Math.max(1, Math.round(this.size.h * s))
    this.worker.postMessage({ type: 'resize', w, h, dpr: effectiveDpr() })
  }

  pause(): void {
    this.stop()
    this.worker?.postMessage({ type: 'pause' })
  }

  resume(): void {
    this.worker?.postMessage({ type: 'resume' })
    this.start()
  }

  destroy(): void {
    perf.gauge('viz.worker', -1)
    if (this.glAccounted) {
      perf.gauge('viz.glctx', -1) // #266 — releases the WebGL-context slot count
      this.glAccounted = false
    }
    perf.dropFrames(this.perfId)
    this.stop()
    // Stop re-marshalling config to a worker that's about to be terminated (#269).
    this.configUnsub?.()
    this.configUnsub = null
    const worker = this.worker
    this.worker = null
    if (worker) {
      try {
        worker.postMessage({ type: 'destroy' })
      } catch {
        /* ignore */
      }
      if (this.diagHandler) worker.removeEventListener('message', this.diagHandler)
      if (this.pooled && this.ready) {
        // Keep the HEALTHY thread WARM for reuse (#263 A): the `destroy` message
        // above frees the worker's p5/hydra instance AND explicitly loses its WebGL
        // context (#266 — p5/hydra never call loseContext, so without that the
        // parked worker would retain the context toward Chrome's ~16-context cap
        // until lazy GC). So the parked worker holds no live context — only its
        // warm isolate + imported modules, which the next mount re-mounts onto a
        // new OffscreenCanvas. NO terminate → no fresh-thread allocation on reuse.
        // A never-ready worker (broken / fell back to main) is NOT pooled — it's
        // terminated below so a future acquire can't reuse a poisoned worker.
        releaseVizWorker(worker)
      } else {
        // Terminate after the destroy message is delivered (terminate is
        // immediate; the message would otherwise be dropped). The worker's own
        // teardown also runs on destroy, so this is belt-and-braces.
        try {
          worker.terminate()
        } catch {
          /* ignore */
        }
      }
    }
    this.diagHandler = null
    try {
      this.writer?.dispose()
    } catch {
      /* ignore */
    }
    this.writer = null
    this.sampler.dispose()
    // Remove the (now frozen) presenting canvas — its control was transferred to
    // the terminated worker, so it can never paint again; leaving it in the DOM
    // would stack a dead canvas behind a fallback main-thread renderer (#247).
    try {
      this.canvasEl?.remove()
    } catch {
      /* ignore */
    }
    this.canvasEl = null
  }

  /** Bind the sampler's live inputs from the component bag (mirror P5VizRenderer:
   *  scheduler + per-track schedulers, master + per-track analysers, hap stream). */
  private bindSampler(components: Partial<EngineComponents>): void {
    this.sampler.bind({
      scheduler: (components.queryable?.scheduler ?? null) as IRPattern | null,
      trackSchedulers: (components.queryable?.trackSchedulers ?? null) as Map<string, IRPattern> | null,
      masterAnalyser: (components.audio?.analyser ?? null) as BusAnalyser | null,
      trackAnalysers: (components.audio?.trackAnalysers ?? null) as Map<string, BusAnalyser> | null,
    })
    this.sampler.bindHapStream(components.streaming?.hapStream ?? null)
  }

  /** Join the shared frame pump — the SINGLE rAF + shared sampler now drives this
   *  renderer's per-frame produce via `pumpTick` (PV72), instead of each renderer
   *  owning its own rAF. Still registers with the governor for the GPU-budget pool. */
  private start(): void {
    if (this.running) return
    this.running = true
    this.inFlight = 0 // fresh pipeline on (re)start — drop any owed acks (#261)
    this.lastProduceTs = 0 // fresh fps-cap clock
    vizGovernor.register(this.perfId) // join the global GPU-budget pool
    vizFramePump.register(this) // join the single-rAF shared sampler (PV72, #302)
  }

  /**
   * One produce step, called by `vizFramePump` once per rAF tick while registered
   * (PumpDriven). This is the EXACT gate sequence the old per-renderer rAF ran —
   * resolution lever → #261 backpressure → maxFps cap → governor concurrency gate
   * → sample+write — moved verbatim, with two differences: the pump owns the rAF
   * (no self-reschedule) and calls `vizGovernor.observeFrame` once for all viz (it
   * was idempotent per ts, so equivalent); and `sample(cache)` routes the analyser
   * read + scheduler query through the SHARED per-tick cache, so N viz on the same
   * input collapse N reads → 1 (the PV72 win). The frame is still per-viz (own
   * sampler/bumps/seq) → byte-identical reactivity (PV75). Guarded so a throw can't
   * stall the pump's other renderers (PumpDriven contract).
   */
  pumpTick(ts: number, cache: FrameSampleCache | undefined): void {
    if (!this.running || !this.writer) return
    try {
      // Governor resolution lever (P122/PV91): under sustained stress shrink the
      // worker backing store. Re-post a scaled resize ONLY when the quantized step
      // changes (rare) — the realloc isn't free. No-op at scale 1 (smooth/disabled).
      const rs = vizGovernor.resolutionScale()
      if (rs !== this.govResScale) {
        this.govResScale = rs
        this.postBackingSize()
      }
      // #261 backpressure: only produce while the worker hasn't fallen `cap` frames
      // behind. The pump keeps ticking (so we resume the instant an ack frees a
      // slot), but we skip sample()+writeFrame() when the pipeline is full — this
      // paces main's output to the worker's actual draw rate, so the worker always
      // draws the freshest frame instead of a stale backlog. NOT sampling when
      // skipped is deliberate: hap bumps accumulate into the NEXT produced frame
      // (envelope energy preserved, PK22) and it saves the duplicated main sample
      // work when the worker is the bottleneck.
      //
      // #261 fps cap: also skip if we produced a frame less than minFrameMs ago, so
      // a 120fps display doesn't blit/composite/sample twice as often as a music
      // viz can use. The `- 1` biases toward hitting the target rather than
      // undershooting on a high-refresh display (skipping is always safe — it can
      // only lower the rate, never exceed the cap). Composed with backpressure.
      const gap = minFrameMs()
      const due = gap <= 0 || this.lastProduceTs === 0 || ts - this.lastProduceTs >= gap - 1
      // Global GPU-budget gate: under sustained jank the governor throttles this
      // viz's rate + round-robins which viz draw each frame, so N heavy viz can't
      // co-saturate the shared GPU and starve the editor's compositing. A total
      // no-op when frames are healthy (stress 0 → always true), so it never touches
      // the smooth common case or the reactivity contract (PV75).
      if (this.inFlight < MAX_FRAMES_IN_FLIGHT && due && vizGovernor.mayProduce(this.perfId, ts)) {
        this.lastProduceTs = ts
        perf.frame(this.perfId)
        // Decompose the per-frame main cost into its two parts so the matrix can
        // attribute it (B-4 decision gate, #249): `sample` = analyser reads + the
        // wide scheduler query (duplicated work — the shared `cache` removes the N×,
        // PV72); `write` = transport (envelope structured-clone + postMessage —
        // bytes already transferred zero-copy).
        perf.begin('viz.worker.sample')
        // Viz previews (#838) drive from a muted demo feed keyed off the rAF
        // clock; everything else samples the live analyser/scheduler.
        const frame = this.demoSource ? this.demoSource.next(ts) : this.sampler.sample(cache)
        perf.end('viz.worker.sample')
        perf.begin('viz.worker.write')
        this.writer.writeFrame(frame)
        perf.end('viz.worker.write')
        this.inFlight++
      }
    } catch (e) {
      // A produce-step throw must not stall the pump's other renderers. Surface it
      // through the host error path (post-ready → Console; pre-ready → fallback).
      this.onError?.(e as Error)
    }
  }

  private stop(): void {
    this.running = false
    vizFramePump.unregister(this.perfId) // leave the single-rAF shared sampler
    vizGovernor.unregister(this.perfId) // leave the GPU-budget pool (pause/destroy)
  }
}
