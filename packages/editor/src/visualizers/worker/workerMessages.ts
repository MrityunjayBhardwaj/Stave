/**
 * Control-message protocol for the viz worker (B-3) — the lifecycle commands the
 * main `WorkerVizRenderer` posts to the worker `hostP5Worker`. These share the
 * worker's `postMessage` channel with the per-frame `SignalFrame`s; the two are
 * disambiguated structurally — control messages carry a `type: string`, signal
 * frames carry the `__staveSignalFrame` envelope tag and NO `type` (signalTransport.ts).
 * So each side ignores the other's messages by checking for `.type`.
 */
import type { WorkerVizConfig } from '../vizConfig'
import type { VizOptions } from '../types'
import type { LogEntry } from '../../engine/engineLog'

/** MAIN → WORKER: create the renderer instance against a transferred OffscreenCanvas. */
export interface MountMessage {
  type: 'mount'
  /** Renderer kind — `'p5'` (B-3), `'hydra'` (B-5), or `'glsl'` (#281). The host
   *  installs the matching shim (none for glsl — raw WebGL2) + imports the matching
   *  library (none for glsl) + drives the matching draw. */
  kind: 'p5' | 'hydra' | 'glsl' | 'three'
  /** The sketch source (a transferable string, compiled in-worker — PLAN §7.3). */
  code: string
  /** Source label for error attribution (the workspace path). */
  name: string
  /** The presenting surface, transferred via `transferControlToOffscreen`. */
  canvas: OffscreenCanvas
  /** CSS size of the preview pane. */
  size: { w: number; h: number }
  /** Device pixel ratio at mount (the worker sizes the backing store ×dpr). */
  dpr: number
  /** Merged signal-alias map (built on main from impure settings — the worker
   *  bus stays pure, mirrors P5VizRenderer). */
  aliases?: Record<string, string | string[]>
  /** Worker-relevant vizConfig subset marshalled from main (#269). The worker
   *  bundle has its OWN vizConfig singleton (P105) that otherwise stays at
   *  DEFAULT_VIZ_CONFIG; this carries main's effective values (`density` for the
   *  `u.density` LOD getter, `hydraAudioBins` — closes #253) so the worker sketch
   *  reads the user's settings, not the bundle default. Applied via
   *  `updateVizConfig` (merge) before the first draw. */
  config?: WorkerVizConfig
  /** #325 Tier A (p5 only, DEFAULT ON) — render p5 DIRECTLY into the transferred
   *  display canvas (`canvas`) instead of into a private worker-local canvas we
   *  blit from. When true the host adopts `canvas` as p5's MAIN canvas (skipping
   *  the internal default P2D + injecting it as the user createCanvas `elt`), takes
   *  NO `bitmaprenderer` context, and the draw path does NOT `transferToImageBitmap`
   *  → the canvas persists frame-to-frame, so readback/trails work like hydra/GLSL.
   *  The main side sets this from `isP5DirectCanvasEnabled()` (default ON; escape
   *  hatch `localStorage['stave.viz.p5direct']='0'` reverts to the blit path). */
  p5DirectCanvas?: boolean
  /** Per-render viz options — the `.viz(name, {…})` / `._pianoroll({…})` /
   *  `.pianoroll({…})` argument, read by the sketch as `stave.options` (#875).
   *  The main-thread `P5VizRenderer` hands these to the compiler via an
   *  `optionsRef`; the worker host must receive them the same way or every option
   *  is silently dropped — which it was, on the DEFAULT path, from #245 until this
   *  was threaded. Structured-cloned, so non-cloneable values are dropped on main
   *  before posting (`cloneableOptions`). */
  options?: VizOptions
  /** #2560 — a pre-Play WARM-UP mount: the renderer sits hidden and paused, so no
   *  signal frame will arrive to draw it. Once the sketch has loaded, the worker
   *  draws ONE frame itself (shaders compile, GPU uploads happen) before it says
   *  `loaded`, so Play reveals a sketch that is ready to move. */
  warm?: boolean
}

/** MAIN → WORKER: live update of the per-render viz options (#875). Posted when a
 *  re-evaluate changes the options bag, mirroring the main-thread renderer, whose
 *  `update()` re-assigns `optionsRef.current` (P5VizRenderer:220) — so editing
 *  `{background:'#cc1133'}` re-paints WITHOUT a remount. */
export interface OptionsMessage {
  type: 'options'
  options: VizOptions
}

/** MAIN → WORKER: the preview pane resized / DPR changed. */
export interface ResizeMessage {
  type: 'resize'
  w: number
  h: number
  dpr: number
}

/** MAIN → WORKER: pause / resume the draw loop (off-screen, Phase C). */
export interface PauseMessage {
  type: 'pause'
}
export interface ResumeMessage {
  type: 'resume'
}

/** MAIN → WORKER: tear down the p5 instance + stop consuming frames. */
export interface DestroyMessage {
  type: 'destroy'
}

/** MAIN → WORKER: live update of the marshalled vizConfig subset (#269). Posted
 *  when the user changes a quality / LOD setting. Applied via `updateVizConfig`
 *  (MERGE, not reset — so a `{ density }` patch can't wipe `hydraAudioBins`), so
 *  the worker sketch's next frame reads the new value WITHOUT a remount. */
export interface ConfigMessage {
  type: 'config'
  patch: Partial<WorkerVizConfig>
}

export type WorkerControlMessage =
  | MountMessage
  | ResizeMessage
  | PauseMessage
  | ResumeMessage
  | DestroyMessage
  | ConfigMessage
  | OptionsMessage

/** WORKER → MAIN: diagnostics (sketch compile/runtime error, first-frame ready).
 *  B-3 forwards worker errors to the main console; richer engineLog bridging is
 *  Phase B-7 (#230 profiler-in-worker). */
export interface WorkerDiagMessage {
  type: 'diag'
  level: 'error' | 'info'
  message: string
  /** Optional stack (first frames) for an error. */
  stack?: string
}

/** WORKER → MAIN: a viz RUNTIME log entry (a p5/hydra draw/setup error) to
 *  RE-EMIT into the MAIN engineLog (#257). p5Compiler wraps user lifecycle hooks
 *  and routes throws to the worker-LOCAL engineLog, which isn't wired to the main
 *  console — so a per-frame draw() typo was a silent blank. Re-emitting on main
 *  surfaces it in the Console panel + squiggle EXACTLY like the main-thread path,
 *  WITHOUT the `onError`/fallback semantics (a post-ready user typo must not tear
 *  the worker down). Distinct from `diag` (level:error) which IS fatal/fallback. */
export interface WorkerVizLogMessage {
  type: 'vizlog'
  entry: Omit<LogEntry, 'id' | 'ts'>
}

/** WORKER → MAIN: the worker drew its FIRST frame successfully (B-5 / #247). One-
 *  shot health signal: `FallbackVizRenderer` treats an error BEFORE it as a
 *  startup failure (fall back to the main thread) and an error after it as the
 *  sketch's own. Whether the worker is answering at all is `alive` (#2560). */
export interface WorkerReadyMessage {
  type: 'ready'
}

/** WORKER → MAIN (#2560): the worker took the `mount` message — the thread is up
 *  and answering. This, not the first frame, is what the startup probation waits
 *  for: a sketch that loads a large asset before its first frame is slow, not
 *  hung, and must not be moved onto the thread that schedules the music. */
export interface WorkerAliveMessage {
  type: 'alive'
}

/** WORKER → MAIN (#2560): the sketch has finished setting up — its top level ran,
 *  the assets it asked for arrived (three.js: every loader item is done; p5: its
 *  `setup()` ran) and, for a warm-up mount, one hidden frame was drawn. Sent once
 *  per mount. Play waits on it (with a cap) so the picture can move at once. */
export interface WorkerLoadedMessage {
  type: 'loaded'
}

/** WORKER → MAIN: the worker consumed one transported `SignalFrame` (#261). The
 *  main `WorkerVizRenderer` bounds the number of UNACKED frames in flight, so it
 *  stops sampling+writing once the worker has fallen `cap` frames behind. Without
 *  this, the main rAF produces frames (e.g. 120fps) far faster than a heavy-WEBGL
 *  worker can draw (~20fps); the surplus backlogs in the worker's postMessage
 *  queue and the worker renders seconds-stale audio data (looks "static"). Acked
 *  on RECEIPT (not draw success) so p5's async setup phase can't deadlock the
 *  pipeline. */
export interface WorkerFrameAckMessage {
  type: 'frameAck'
  /** Profiler bridge (#230 Phase F): the wall-time (ms) of the LAST completed
   *  `s.draw()` in this worker — the default worker path is otherwise a profiler
   *  blind spot (the worker bundle never imported `perf`). Carried on the next
   *  ack (which is sent on RECEIPT, before this frame's draw) so it costs ZERO
   *  extra messages and doesn't change the ack-on-receipt deadlock guarantee.
   *  `undefined` until the first draw completes. Main records it as the section
   *  `viz.worker.draw` (aggregated across instances, like `p5.bus`/`hydra.draw`). */
  drawMs?: number
}

/** Structural guard — is this a control message (has a string `type`) rather than
 *  a `SignalFrame` envelope? */
export function isControlMessage(data: unknown): data is WorkerControlMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  )
}
