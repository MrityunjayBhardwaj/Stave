/**
 * GLSLVizRenderer — the MAIN-THREAD `VizRenderer` for a single-pass GLSL/ShaderToy
 * sketch (issue #281). It is the ALWAYS-available path: used directly when the
 * worker path is off / unsupported, and as the `FallbackVizRenderer` target when a
 * GLSL worker fails to start (#247). The worker counterpart is `mountGLSL` in
 * `hostP5Worker.ts`; both drive the SAME `glslCore` pipeline (one implementation).
 *
 * Loop ownership mirrors `HydraVizRenderer`: we own a single rAF that reads the
 * master analyser and draws exactly one frame, so `pause()` (cancel the rAF) truly
 * halts rendering. There is no per-frame user JS — the shader runs on the GPU — so
 * `draw()` can't throw post-mount; the only failure point is shader compile/link,
 * caught at mount and surfaced via `onError` (→ fallback when wrapped).
 *
 * REF: glslCore.ts (the shared pipeline), HydraVizRenderer (the loop/gauge/pause
 *      idiom mirrored here), makeGLSLRenderer (#247 wrapping), perf.gauge('viz.glsl').
 */

import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { HapEvent } from '../../engine/HapStream'
import type { HapStream } from '../../engine/HapStream'
import type { VizRenderer } from '../types'
import { perf } from '../../perf/profiler'
import { SignalBus } from '../signals/SignalBus'
import { resolveAliasesForEngine, DEFAULT_VIZ_ENGINE } from '../signals/aliasMap'
import { getStoredSignalAliases } from '../../workspace/editorRegistry'
import { createGLSLProgram, type GLSLProgram, type AudioByteSource, type GL2 } from './glslCore'
import { glslFragmentErrorUserLine } from './glslShaderSource'
import { markVizErrorReported } from '../reportedVizErrors'
import { readGLSLEvents, readGLSLTracks } from './glslEvents'
import { emitLog } from '../../engine/engineLog'
import { VizRendererBase } from './VizRendererBase'

/** Monotone id source for a stable per-instance profiler key (`glsl#N`). */
let glslPerfSeq = 0

export class GLSLVizRenderer extends VizRendererBase {
  private canvas: HTMLCanvasElement | null = null
  private gl: GL2 | null = null
  private program: GLSLProgram | null = null
  private analyser: AnalyserNode | null = null
  private rafId: number | null = null
  private paused = false
  private destroyed = false
  private startMs = 0
  private size = { w: 400, h: 300 }
  private readonly perfId = `glsl#${++glslPerfSeq}`
  /** Named-signal bus → the `u*` event uniforms (#284), same as hydra/p5. Fed
   *  unconditionally (BLOCK-1 discipline mirrored from HydraVizRenderer). */
  private bus: SignalBus | null = new SignalBus()
  private hapStream: HapStream | null = null
  private busHapHandler: ((e: HapEvent) => void) | null = null

  /** `code` = the user's GLSL source; `name` = the workspace path, used to
   *  attribute a compile error to its file in the Console (#331). */
  constructor(
    private readonly code: string,
    private readonly name = '',
  ) {
    super()
  }

  protected onMount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    perf.gauge('viz.glsl', 1) // live GLSL-instance gauge; -1 in destroy()
    try {
      this.size = { w: size.w, h: size.h }
      this.analyser = (components.audio?.analyser as AnalyserNode | undefined) ?? null

      // Bind the named-signal bus for the u* event uniforms (#284) — same
      // unconditional bind discipline as HydraVizRenderer (the bus degrades to 0
      // absent feeds, so never gate the bind).
      this.bus?.bindScheduler(components.queryable?.scheduler, components.queryable?.trackSchedulers)
      this.bus?.bindAnalysers(components.audio?.analyser, components.audio?.trackAnalysers)
      this.bus?.setAliases(resolveAliasesForEngine(getStoredSignalAliases(), DEFAULT_VIZ_ENGINE))
      this.hapStream = components.streaming?.hapStream ?? null
      if (this.hapStream && this.bus) {
        this.busHapHandler = (e: HapEvent) => this.bus?.bump(e)
        this.hapStream.on(this.busHapHandler)
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(size.w))
      canvas.height = Math.max(1, Math.round(size.h))
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      container.appendChild(canvas)
      this.canvas = canvas

      const gl = canvas.getContext('webgl2')
      if (!gl) throw new Error('GLSLVizRenderer: WebGL2 not available')
      this.gl = gl
      // Throws on a shader compile/link error → onError (fallback when wrapped).
      this.program = createGLSLProgram(gl, this.code)

      this.startMs = performance.now()
      if (!this.paused && !this.destroyed && this.rafId == null) {
        this.rafId = requestAnimationFrame(this.loop)
      }
    } catch (e) {
      // #331 — a shader compile/link failure (or a both/neither-mode friendly
      // error) is a USER authoring error. Surface it to the main Console like a
      // p5 (#257) / hydra (#275) typo — GLSL's info log even carries a line, which
      // we map back through the wrapper preamble to the editor line. This is the
      // ONLY place every broken GLSL terminates: worker→FallbackVizRenderer→here,
      // or main-direct→here. emitLog dedups on (level,runtime,source,line,message)
      // so a re-mount of the same broken shader won't spam the panel.
      const err = e as Error
      emitLog({
        level: 'error',
        runtime: 'glsl',
        source: this.name || undefined,
        message: err.message,
        line: glslFragmentErrorUserLine(err.message, this.code),
      })
      markVizErrorReported(err) // #2210 — so a host's onError doesn't write it again
      onError(err)
    }
  }

  private loop = (now: number): void => {
    if (this.paused || this.destroyed || !this.program) {
      this.rafId = null
      return
    }
    perf.frame(this.perfId)
    perf.begin('glsl.draw')
    try {
      // Tick the bus ONCE per frame (decay → scheduler snapshot → DSP), in the
      // same order as HydraVizRenderer, then read its named signals into events.
      let events
      let tracks
      if (this.bus) {
        this.bus.tick()
        this.bus.refreshActive(this.bus.now())
        this.bus.readAudio()
        events = readGLSLEvents(this.bus)
        tracks = readGLSLTracks(this.bus) // #297 per-track signals (same tick)
      }
      this.program.draw(
        this.analyser as AudioByteSource | null,
        { width: this.size.w, height: this.size.h, timeMs: now - this.startMs },
        events,
        tracks,
      )
    } finally {
      perf.end('glsl.draw')
    }
    this.rafId = requestAnimationFrame(this.loop)
  }

  protected onUpdate(components: Partial<EngineComponents>): void {
    // Rebind the analyser (iChannel0) AND the bus's live scheduler/analyser refs
    // in place (the u* events) so a re-evaluate keeps the shader reactive — same
    // live-ref discipline as HydraVizRenderer.
    this.analyser = (components.audio?.analyser as AnalyserNode | undefined) ?? null
    this.bus?.bindScheduler(components.queryable?.scheduler ?? null, components.queryable?.trackSchedulers)
    this.bus?.bindAnalysers(components.audio?.analyser ?? null, components.audio?.trackAnalysers)
  }

  resize(w: number, h: number): void {
    this.size = { w, h }
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(w))
      this.canvas.height = Math.max(1, Math.round(h))
    }
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
    // iTime tracks wall-clock from mount; a pause lets it advance (v1 — shaders
    // are continuous-time, no freeze needed). Just re-arm the loop.
    if (this.rafId == null && !this.destroyed) {
      this.rafId = requestAnimationFrame(this.loop)
    }
  }

  destroy(): void {
    this.destroyed = true
    perf.gauge('viz.glsl', -1)
    perf.dropFrames(this.perfId)
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.program?.dispose()
    this.program = null
    // Release the WebGL context explicitly (mirrors #266 hygiene on the worker
    // path) — p5/hydra rely on lazy GC, but a raw context we own we can free.
    try {
      this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* already lost / unsupported — ignore */
    }
    this.gl = null
    this.canvas?.remove()
    this.canvas = null
    this.analyser = null
    // Unsubscribe the bus feed + drop the bus (#284).
    if (this.hapStream && this.busHapHandler) {
      this.hapStream.off(this.busHapHandler)
      this.busHapHandler = null
    }
    this.hapStream = null
    this.bus = null
  }
}
