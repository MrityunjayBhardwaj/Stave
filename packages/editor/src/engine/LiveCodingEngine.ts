import type { HapStream } from './HapStream'
import type { PatternScheduler } from '../visualizers/types'
import type { PatternIR } from '../codeView'
import type { IREvent } from '../codeView'
import type { SliderWidgetConfig } from './vendored/slider'

// ---------------------------------------------------------------------------
// Engine Component Bags
// ---------------------------------------------------------------------------

/** Real-time hap event stream for visualizers and highlighting. */
export interface StreamingComponent {
  hapStream: HapStream
}

/** Pattern query access -- scheduler for the combined pattern, per-track schedulers. */
export interface QueryableComponent {
  scheduler: PatternScheduler | null
  trackSchedulers: Map<string, PatternScheduler>
}

/** Web Audio nodes for analysis-based visualizers (scope, spectrum). */
export interface AudioComponent {
  analyser: AnalyserNode
  audioCtx: AudioContext
  /** Per-track AnalyserNodes for isolated inline viz. Keyed by track ID (e.g. "drums", "$0"). */
  trackAnalysers?: Map<string, AnalyserNode>
}

/**
 * Free-form per-render viz options bag, sourced from a Strudel viz call's
 * argument — e.g. `.pianoroll({ labels: 1, vertical: 1 })`. Flows engine →
 * component bag → renderer → `stave.options` so sketches can honour the
 * official `@strudel/draw` option vocabulary. Structurally a
 * `VizOptions` (visualizers/types) — kept as a local record alias here to
 * avoid an engine→visualizers import cycle.
 */
export type VizOptionsBag = Record<string, unknown>

/** Per-track inline visualization requests with line placement info. */
export interface InlineVizComponent {
  /**
   * Maps track ID (e.g. "$0", "d1") to viz placement info.
   * - vizId: descriptor ID (e.g. "pianoroll", "scope")
   * - afterLine: 1-indexed line number after which to place the view zone
   * - options: the viz call's argument (e.g. `{ labels: 1 }`), if any
   */
  vizRequests: Map<string, { vizId: string; afterLine: number; options?: VizOptionsBag }>
  /**
   * Optional per-track HapStreams for scoped inline viz.
   * When present, each inline zone subscribes to its track's stream only.
   * When absent, falls back to the global streaming component.
   */
  trackStreams?: Map<string, HapStream>
  /**
   * Backdrop viz requested via a non-underscore Strudel viz method
   * (e.g. `.scope()`, `.pianoroll()`) during the last evaluate. The
   * non-underscore form is Strudel's "big"/fullscreen viz; Stave maps it
   * to the project backdrop. `vizId` is the resolved Stave renderer id
   * (e.g. "scope", "pianoroll"). Absent when no such method was called.
   */
  backdropRequest?: { vizId: string; options?: VizOptionsBag }
  /**
   * #345 — the `slider(…)` calls in the evaluated code, as Strudel's transpiler
   * reported them (offsets into that code). The editor draws one slider on each.
   * Absent when there are none.
   */
  sliders?: readonly SliderWidgetConfig[]
}

/** Pattern IR derived from the last successful evaluate(). */
export interface IRComponent {
  /** Algebraic structure of the pattern (free monad tree). */
  patternIR: PatternIR | null
  /** Flattened event list derived from patternIR (for rendering). */
  irEvents: IREvent[]
}

/**
 * Component bag exposing engine capabilities.
 * Each slot is independently optional -- consumers MUST check existence before access.
 */
export interface EngineComponents {
  streaming: StreamingComponent
  queryable: QueryableComponent
  audio: AudioComponent
  inlineViz: InlineVizComponent
  /** Pattern IR — present after successful evaluate() on engines that support parsing. */
  ir: IRComponent
  /**
   * Per-render viz options for THIS zone's renderer — set by `viewZones` from
   * the inline request's `options` (or the backdrop request's), and read by
   * `P5VizRenderer` into `stave.options`. Per-zone, not a global engine slot.
   */
  options?: VizOptionsBag
}

// ---------------------------------------------------------------------------
// LiveCodingEngine Interface
// ---------------------------------------------------------------------------

/**
 * Engine-agnostic interface for live-coding audio engines.
 *
 * Lifecycle contract: init() -> evaluate() -> play() -> stop() -> dispose()
 * - init() must complete before evaluate()
 * - evaluate() may be called multiple times (re-evaluation)
 * - play()/stop() toggle scheduling
 * - dispose() releases all resources
 *
 * The `components` getter returns a partial bag -- which slots are present
 * depends on the engine's state (e.g. audio only after init, queryable after evaluate).
 */
export interface LiveCodingEngine {
  /** Initialize the engine (load modules, set up audio context). Must complete before evaluate(). */
  init(): Promise<void>

  /** Evaluate user code. Returns error info if evaluation fails. */
  evaluate(code: string): Promise<{ error?: Error }>

  /** Start the scheduler / begin playback. */
  play(): void

  /**
   * Ask the browser to start audio (#1987). Called SYNCHRONOUSLY inside the user's
   * gesture, before anything is awaited — a phone browser starts audio only when the
   * page asks from inside a touch. Safe before `init()` and safe to call again.
   * Optional: an engine with no audio of its own to start leaves it out.
   */
  unlockAudio?(): void
  /**
   * #2256 — load the sounds the first cycles will play, before the scheduler
   * starts (step 3a of the play lifecycle). Bounded; never rejects. Engines that
   * load nothing on demand leave it out.
   */
  warmSounds?(): Promise<void>

  /** Stop the scheduler / pause playback. */
  stop(): void

  /** Release all resources. Engine is unusable after this call. */
  dispose(): void

  /** Current engine capabilities. Slots appear as data becomes available. */
  readonly components: Partial<EngineComponents>

  /** Register a handler for runtime errors (fires during scheduling, not evaluation). */
  setRuntimeErrorHandler(handler: (err: Error) => void): void
}
