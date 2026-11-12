/**
 * ThreeVizRenderer — the main-thread renderer for a `.three` sketch (#2516).
 *
 * The worker path (`hostVizWorker`, kind `'three'`) is the default; this is its
 * fallback and the path for browsers that can't offload, exactly as
 * `GLSLVizRenderer` is for GLSL. Both run the SAME core, `threeSketch.ts`, so a
 * sketch behaves the same on either side.
 *
 * It is also where a broken sketch ends up when it runs in the worker: an import
 * outside the bundle or an error at the top level fails the worker before its
 * first frame, the fallback mounts this, and this reports the error to Stave's
 * console against the file and line (the GLSL model, #331).
 *
 * REF: threeSketch.ts (the shared core), GLSLVizRenderer (the bus + loop idiom
 *      mirrored here), makeThreeRenderer, perf.gauge('viz.three').
 */

import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { HapEvent, HapStream } from '../../engine/HapStream'
import { perf } from '../../perf/profiler'
import { SignalBus } from '../signals/SignalBus'
import { buildStaveUniforms } from '../signals/staveUniforms'
import { markVizErrorReported } from '../reportedVizErrors'
import { emitLog } from '../../engine/engineLog'
import type { StaveUniforms } from '../p5Compiler'
import type { IRPattern } from '../../codeView'
import { VizRendererBase } from './VizRendererBase'
import { currentVizSignalAliases, effectiveDpr } from './WorkerVizRenderer'
import {
  compileThreeSketch,
  loadThreeModules,
  runThreeSketch,
  ThreeImportError,
  type ThreeSketchRun,
} from './threeSketch'

let threePerfSeq = 0

export class ThreeVizRenderer extends VizRendererBase {
  private canvas: HTMLCanvasElement | null = null
  private run: ThreeSketchRun | null = null
  private rafId: number | null = null
  private paused = false
  private destroyed = false
  private size = { w: 400, h: 300 }
  /** The live scheduler, for the sketch's `stave.scheduler` (#2570). */
  private scheduler: IRPattern | null = null
  private readonly perfId = `three#${++threePerfSeq}`
  private bus: SignalBus | null = new SignalBus()
  private readonly uniforms: StaveUniforms
  private hapStream: HapStream | null = null
  private busHapHandler: ((e: HapEvent) => void) | null = null

  /** `code` = the sketch; `name` = its workspace path, for error attribution. */
  constructor(
    private readonly code: string,
    private readonly name = '',
  ) {
    super()
    // No onTick: the loop below ticks the bus once per frame, as GLSL's does.
    this.uniforms = buildStaveUniforms(this.bus!)
  }

  protected onMount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    perf.gauge('viz.three', 1) // live instance gauge; -1 in destroy()
    this.size = { w: size.w, h: size.h }
    this.scheduler = (components.queryable?.scheduler ?? null) as IRPattern | null
    this.bus?.bindScheduler(components.queryable?.scheduler, components.queryable?.trackSchedulers)
    this.bus?.bindAnalysers(components.audio?.analyser, components.audio?.trackAnalysers)
    this.bus?.setAliases(currentVizSignalAliases())
    this.hapStream = components.streaming?.hapStream ?? null
    if (this.hapStream && this.bus) {
      this.busHapHandler = (e: HapEvent) => this.bus?.bump(e)
      this.hapStream.on(this.busHapHandler)
    }

    const canvas = document.createElement('canvas')
    // The worker path's pixel ratio (the user's maxDpr cap), so both paths match.
    const dpr = effectiveDpr()
    canvas.width = Math.max(1, Math.round(size.w * dpr))
    canvas.height = Math.max(1, Math.round(size.h * dpr))
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)
    this.canvas = canvas

    void this.start(onError)
  }

  /** A sketch that can't start: one Console row on its line, then the host's onError. */
  private fail(err: Error, line: number | undefined, onError: (e: Error) => void): void {
    emitLog({ level: 'error', runtime: 'three', source: this.name || undefined, message: err.message, line })
    markVizErrorReported(err) // #2210 — the host's onError mustn't write it again
    onError(err)
  }

  private async start(onError: (e: Error) => void): Promise<void> {
    const compiled = compileThreeSketch(this.code)
    if (compiled.syntaxError) {
      this.fail(compiled.syntaxError, compiled.syntaxError.line, onError)
      return
    }
    let loaded
    try {
      loaded = await loadThreeModules(compiled)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      this.fail(err, e instanceof ThreeImportError ? e.line : undefined, onError)
      return
    }
    if (this.destroyed || !this.canvas) return
    this.run = runThreeSketch(compiled, loaded, {
      canvas: this.canvas,
      size: () => this.size,
      dpr: effectiveDpr,
      uniforms: () => this.uniforms,
      options: () => this.optionsRef.current ?? {},
      // #2570 — on the main thread the sketch queries the live scheduler itself,
      // over only the window it asks for (as P5VizRenderer's sketches do).
      scheduler: () => this.scheduler,
      createCanvas: () => document.createElement('canvas'),
      // The core places each problem on its line; runtime and file come from here.
      report: (entry) => emitLog({ ...entry, runtime: 'three', source: this.name || undefined }),
    })
    void this.run.done.then(({ error }) => {
      // The top level failed: already in the Console (via report), so mark it and
      // let the host know (a fallback stops treating the viz as live).
      if (error && !this.destroyed) {
        markVizErrorReported(error)
        onError(error)
      }
    })
    if (!this.paused && !this.destroyed && this.rafId == null) {
      this.rafId = requestAnimationFrame(this.loop)
    }
  }

  private loop = (now: number): void => {
    if (this.paused || this.destroyed || !this.run) {
      this.rafId = null
      return
    }
    perf.frame(this.perfId)
    perf.begin('three.draw')
    try {
      // Tick the bus once per frame (decay → scheduler snapshot → DSP), the
      // GLSL/hydra order, then let the sketch's own loop read `sig`.
      if (this.bus) {
        this.bus.tick()
        this.bus.refreshActive(this.bus.now())
        this.bus.readAudio()
      }
      this.run.frame(now)
    } finally {
      perf.end('three.draw')
    }
    this.rafId = requestAnimationFrame(this.loop)
  }

  protected onUpdate(components: Partial<EngineComponents>): void {
    this.scheduler = (components.queryable?.scheduler ?? null) as IRPattern | null
    this.bus?.bindScheduler(components.queryable?.scheduler ?? null, components.queryable?.trackSchedulers)
    this.bus?.bindAnalysers(components.audio?.analyser ?? null, components.audio?.trackAnalysers)
  }

  resize(w: number, h: number): void {
    this.size = { w, h }
    this.run?.resize()
  }

  pause(): void {
    this.paused = true
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resume(): void {
    this.paused = false
    if (this.rafId == null && !this.destroyed && this.run) {
      this.rafId = requestAnimationFrame(this.loop)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    perf.gauge('viz.three', -1)
    perf.dropFrames(this.perfId)
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    // Stops the loop, disposes every renderer the sketch made and loses its
    // WebGL context, whatever the sketch did or didn't clean up.
    this.run?.dispose()
    this.run = null
    this.canvas?.remove()
    this.canvas = null
    if (this.hapStream && this.busHapHandler) {
      this.hapStream.off(this.busHapHandler)
      this.busHapHandler = null
    }
    this.hapStream = null
    this.bus = null
  }
}
