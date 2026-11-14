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
 *   - mount → start the worker renderer; arm `whenAlive` / `whenReady` callbacks
 *     + a timeout.
 *   - worker posts `alive` (it took the mount) → the TIMER is cleared. #2560: the
 *     timer asks "is the thread answering?", not "has it drawn yet?". A sketch
 *     that loads a 4K HDRI before its first frame is slow, not hung; moving it
 *     to the main thread (the one that schedules the music) for that would be
 *     the worst place for it. And since `alive` does not depend on frames, the
 *     timer runs while paused too: a paused warm-up is still judged.
 *   - worker posts `ready` (first successful frame) → HEALTHY. Subsequent errors
 *     surface normally (a user-sketch runtime error is NOT a worker-infrastructure
 *     failure — don't fall back).
 *   - a fatal error BEFORE `ready` (worker threw at import / compile / setup), OR
 *     the timeout before `alive` (the worker never answered) → tear down the
 *     worker attempt, clear the container, mount the main-thread renderer with
 *     the SAME components/size.
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

/** How long (ms) to wait for the worker's `alive` before assuming it never started
 *  and falling back. Generous — worker spawn + module load is well under a second
 *  even under load; this only catches a worker that never answers. #2560: it no
 *  longer waits for the first FRAME, which a heavy sketch may take far longer to
 *  reach. A throw is caught immediately via onError regardless of this timeout. */
export const PROBATION_MS = 8000

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
  /** #2560 — the worker took the mount; the probation timer has nothing to judge. */
  private alive = false
  private paused = false
  /** #2560 — settles when the active renderer has loaded (or there is nothing left
   *  to wait for). See `whenLoaded`. */
  private settleLoaded: () => void = () => {}
  private readonly loaded = new Promise<void>((resolve) => {
    this.settleLoaded = resolve
  })
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
    this.worker.whenAlive(() => {
      this.alive = true
      this.clearProbation()
    })
    // #2560 — `alive` does not wait on frames, so a paused mount is judged too.
    this.armProbation()
    // The worker's loaded settles ours unless a fallback took over first.
    void this.worker.whenLoaded().then(() => {
      if (!this.fellBack) this.settleLoaded()
    })

    // Route the worker's errors through the probation gate.
    this.worker.mount(container, components, size, (e) => this.onWorkerError(e))
  }

  private armProbation(): void {
    if (this.alive || this.ready || this.fellBack || this.probationTimer !== null) return
    this.probationTimer = setTimeout(() => {
      this.probationTimer = null
      if (!this.alive && !this.ready && !this.fellBack) {
        this.fallback(new Error('worker viz did not answer within probation'))
      }
    }, PROBATION_MS)
  }

  /** #2560 — see `VizRenderer.whenLoaded`. Follows whichever renderer is active:
   *  the worker's `loaded`, or — after a fallback — the main renderer's own
   *  (settled at once when it has none). Destroy settles it. */
  whenLoaded(): Promise<void> {
    return this.loaded
  }

  /** #2560 — see `VizRenderer.markWarmUp`. A warm-up mount is the worker's to draw;
   *  a main-thread fallback stays paused and draws nothing until revealed. */
  markWarmUp(): void {
    this.worker.markWarmUp()
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
      this.settleLoaded()
      this.hostOnError?.(e as Error)
      return
    }
    if (!this.container) {
      this.settleLoaded()
      return
    }
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
    const mainLoaded = this.active.whenLoaded?.()
    if (mainLoaded) void mainLoaded.then(() => this.settleLoaded())
    else this.settleLoaded()
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
    // #2560 — the probation keeps running: it waits for `alive`, which a paused
    // worker still sends (it never needed frames).
    this.paused = true
    this.active.pause()
  }

  resume(): void {
    this.paused = false
    this.active.resume()
  }

  destroy(): void {
    this.clearProbation()
    this.settleLoaded()
    this.active.destroy()
  }

  private clearProbation(): void {
    if (this.probationTimer !== null) {
      clearTimeout(this.probationTimer)
      this.probationTimer = null
    }
  }
}
