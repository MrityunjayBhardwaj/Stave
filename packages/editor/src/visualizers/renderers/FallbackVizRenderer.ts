/**
 * FallbackVizRenderer — wraps a worker viz renderer so a worker that FAILS to
 * start (throws at import/compile/first-draw, or hangs) transparently falls back
 * to the main-thread renderer instead of leaving a blank pane (#247, Phase B/B-5).
 *
 * Why: today a worker crash = blank viz. The B-3 i18n bug (every mount threw)
 * WOULD have shipped a blank viz had observation not caught it (P105). This wrapper
 * makes the worker path SAFE to ship ON: any startup failure degrades to the proven
 * `P5VizRenderer` / `HydraVizRenderer` automatically.
 *
 * Probation model (startup-only, so a USER sketch error doesn't permanently
 * downgrade rendering to the main thread):
 *   - mount → start the worker renderer; arm a `whenReady` callback + a timeout.
 *   - worker posts `ready` (first successful frame) → HEALTHY; clear the timer.
 *     Subsequent errors surface normally (a user-sketch runtime error is NOT a
 *     worker-infrastructure failure — don't fall back).
 *   - a fatal error BEFORE `ready`, OR the timeout fires before `ready` (worker
 *     threw at import / hung / never framed) → tear down the worker attempt, clear
 *     the container, mount the main-thread renderer with the SAME components/size.
 *
 * Renderer-agnostic: it only knows `makeWorker()` (→ a `WorkerVizRenderer`, for the
 * `whenReady` hook) and `makeMain()` (→ any `VizRenderer`). Used by `makeP5Renderer`
 * / `makeHydraRenderer` when the worker path is selected.
 *
 * REF: #247, WorkerVizRenderer (whenReady + canvas cleanup), PV70/P105, PHASE-B-PLAN §5 B-5.
 */

import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { VizRenderer } from '../types'
import type { WorkerVizRenderer } from './WorkerVizRenderer'

/** How long (ms) to wait for the worker's first-frame `ready` before assuming it
 *  hung and falling back. Generous — worker spawn + library import + first draw is
 *  well under a second even under load; this only catches a genuinely stuck worker.
 *  A throw is caught immediately via onError regardless of this timeout. */
const PROBATION_MS = 8000

/** What's left when the main-thread renderer couldn't be built (#2220). */
const INERT: VizRenderer = {
  mount() {},
  update() {},
  resize() {},
  pause() {},
  resume() {},
  destroy() {},
}

export class FallbackVizRenderer implements VizRenderer {
  private readonly worker: WorkerVizRenderer
  private active: VizRenderer
  private fellBack = false
  private ready = false
  private paused = false
  private probationTimer: ReturnType<typeof setTimeout> | null = null

  // Captured at mount so the fallback can re-mount the main renderer identically.
  private container: HTMLDivElement | null = null
  private components: Partial<EngineComponents> = {}
  private size = { w: 400, h: 300 }
  private hostOnError: ((e: Error) => void) | null = null

  constructor(
    makeWorker: () => WorkerVizRenderer,
    private readonly makeMain: () => VizRenderer,
  ) {
    this.worker = makeWorker()
    this.active = this.worker
  }

  mount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    this.container = container
    this.components = components
    this.size = { w: size.w, h: size.h }
    this.hostOnError = onError

    this.worker.whenReady(() => {
      this.ready = true
      this.clearProbation()
    })
    // Don't arm probation if the viz mounted already paused (off-screen / hidden
    // tab) — a paused worker won't frame, so the timer would fire a spurious
    // fallback. resume() arms it then (Phase C, #258).
    if (!this.paused) this.armProbation()

    // Route the worker's errors through the probation gate.
    this.worker.mount(container, components, size, (e) => this.onWorkerError(e))
  }

  private armProbation(): void {
    if (this.ready || this.fellBack || this.probationTimer !== null) return
    this.probationTimer = setTimeout(() => {
      if (!this.ready && !this.fellBack) {
        this.fallback(new Error('worker viz did not produce a frame within probation'))
      }
    }, PROBATION_MS)
  }

  private onWorkerError(e: Error): void {
    if (!this.fellBack && !this.ready) {
      this.fallback(e)
    } else {
      // Post-ready (user sketch) error, or already fell back → surface normally.
      this.hostOnError?.(e)
    }
  }

  private fallback(reason: Error): void {
    if (this.fellBack) return
    this.fellBack = true
    this.clearProbation()
    // eslint-disable-next-line no-console
    console.warn(
      `[viz] worker renderer failed (${reason.message}) — falling back to the main thread`,
    )
    try {
      this.worker.destroy() // removes its (frozen) canvas — leaves a clean container
    } catch {
      /* ignore */
    }
    try {
      // #2220 — building the renderer used to compile the sketch, so a sketch
      // that didn't parse threw here. p5 and Hydra now report that at mount
      // instead (#2219), but building a renderer can still throw, and this runs
      // from a worker message, where a throw left uncaught reaches only the
      // global catch (no file, no line).
      this.active = this.makeMain()
    } catch (e) {
      // nothing to draw; the worker is already destroyed, and destroying it
      // again would count its gauges down twice
      this.active = INERT
      this.hostOnError?.(e as Error)
      return
    }
    if (!this.container) return
    try {
      this.active.mount(
        this.container,
        this.components,
        this.size,
        this.hostOnError ?? (() => {}),
      )
      // If we fell back WHILE paused (off-screen), keep the new main renderer
      // paused too — it must not start running just because the worker failed.
      if (this.paused) this.active.pause()
    } catch (e) {
      this.hostOnError?.(e as Error)
    }
  }

  update(components: Partial<EngineComponents>): void {
    this.components = components
    this.active.update(components)
  }

  resize(w: number, h: number): void {
    this.size = { w, h }
    this.active.resize(w, h)
  }

  pause(): void {
    this.paused = true
    // Suspend probation while paused — the worker is intentionally not framing,
    // so the timer must not fire a spurious fallback. resume() re-arms it.
    if (!this.ready && !this.fellBack) this.clearProbation()
    this.active.pause()
  }

  resume(): void {
    this.paused = false
    // Re-arm probation if the worker still hasn't readied (it was paused before
    // its first frame); a now-visible worker gets its fair probation window.
    if (!this.ready && !this.fellBack) this.armProbation()
    this.active.resume()
  }

  destroy(): void {
    this.clearProbation()
    this.active.destroy()
  }

  private clearProbation(): void {
    if (this.probationTimer !== null) {
      clearTimeout(this.probationTimer)
      this.probationTimer = null
    }
  }
}
