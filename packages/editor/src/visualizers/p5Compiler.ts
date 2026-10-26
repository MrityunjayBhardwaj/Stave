/**
 * p5 viz compiler — pure compilation logic with no renderer dependencies.
 *
 * Kept separate from `vizCompiler.ts` so that tests and tooling can
 * import the compile functions without pulling the full p5 /
 * gifenc / renderer stack through the module graph. (The same
 * isolation trick used by `namedVizBridge.ts` vs. `vizPresetBridge.ts`.)
 *
 * The descriptor wiring layer lives in `vizCompiler.ts` and calls
 * into here for the actual source-to-factory conversion.
 */

import type { HapStream } from '../engine/HapStream'
import type { PatternScheduler, ContainerSize } from './types'
import type { RefObject } from 'react'
import { emitLog } from '../engine/engineLog'
import {
  formatFriendlyError,
  parseStackLocation,
} from '../engine/friendlyErrors'
import { P5_DOCS_INDEX } from '../monaco/docs/p5'
import { VizSyntaxError, locateVizSyntaxError } from './vizSyntaxError'

/**
 * The live `stave` namespace handed to user p5 sketches. Fields are
 * implemented as getters over the renderer refs so reads always see
 * the current value.
 *
 * `width` and `height` expose the preview container's current
 * dimensions (NOT `window.innerWidth` / `innerHeight`, which is what
 * p5's built-in `windowWidth` / `windowHeight` track). Sketches
 * should use `createCanvas(stave.width, stave.height)` in setup so
 * the canvas matches the preview pane regardless of the browser
 * window size.
 */
interface StaveContext {
  readonly scheduler: PatternScheduler | null
  readonly analyser: AnalyserNode | null
  readonly hapStream: HapStream | null
  readonly width: number
  readonly height: number
  /**
   * Per-render options bag from the Strudel viz call's argument — e.g.
   * `.pianoroll({ labels: 1 })` surfaces `{ labels: 1 }` here. `{}` when the
   * viz was called with no argument. Lets a sketch honour the official
   * `@strudel/draw` option vocabulary without recompiling.
   */
  readonly options: Record<string, unknown>
  /**
   * Phase 21 / #351 — the `sig` namespace mirrored onto the stave namespace
   * (D-02). Same `sig` object exposed bare via `with (staveUniforms)`. Reads
   * `sig('bd')`, `sig.track('$0')`, `sig.kick`, `sig.fft`, `sig.tracks`.
   */
  readonly sig: SigAccessor
}

/** A per-sound or per-track reading as live NUMBERS (p5 D-01 shape — getters,
 *  NOT thunks; the renderer reads them directly inside `draw`). DSP scalars
 *  (`rms`/`bass`/`mid`/`treble`) are live numbers; DSP arrays (`fft`/`wave`)
 *  are live `number[]` indexed directly (`sig('bd').fft[i]`). All read fresh per
 *  access — the reading object is produced by a getter through `with`. */
export interface P5SignalReading {
  env: number
  velocity: number
  note: number | string | null
  color: string | null
  // ── DSP feed (analyser — Slice 2) ─────────────────────────────────────────
  /** Time-domain RMS, 0..1. */
  rms: number
  /** Low-band magnitude, 0..1. */
  bass: number
  /** Mid-band magnitude, 0..1. */
  mid: number
  /** High-band magnitude, 0..1. */
  treble: number
  /** Normalized magnitude spectrum, `number[]`. */
  fft: number[]
  /** Time-domain waveform -1..1, `number[]`. */
  wave: number[]
}

/** The single `sig` namespace (#351) — a callable carrying every Stave-injected
 *  viz signal. p5 shape (D-01): `sig('bd').env` is a NUMBER (live each read), not
 *  a thunk; the per-drum scalars (`sig.kick`…) and master DSP (`sig.rms`/`sig.fft`)
 *  are live getters on the SAME object. */
export interface SigAccessor {
  (sound: string): P5SignalReading
  /** Per-track reading, keyed on the scheduler key space (`$0`/`drums`). */
  track: (id: string) => P5SignalReading
  /** Enumerate published track keys (scheduler key space). */
  tracks: string[]
  /** Enumerate distinct sounds seen through the envelope feed. */
  sounds: string[]
  // ── Per-drum envelopes (0..1, live getters; were bare `uKick…uTom`) ────────
  kick: number
  snare: number
  hat: number
  openHat: number
  clap: number
  rim: number
  tom: number
  /** Loudest active hit 0..1, global (was `uKeyVelocity`). */
  keyVelocity: number
  // ── Master-mix DSP (Slice 2) — live getters / arrays ──────────────────────
  /** Master-mix time-domain RMS, 0..1 (live getter). */
  rms: number
  /** Master-mix low-band magnitude, 0..1 (live getter). */
  bass: number
  /** Master-mix mid-band magnitude, 0..1 (live getter). */
  mid: number
  /** Master-mix high-band magnitude, 0..1 (live getter). */
  treble: number
  /** Live master-mix magnitude spectrum, `number[]`. */
  fft: number[]
  /** Live master-mix waveform -1..1, `number[]`. */
  wave: number[]
  /**
   * Quality / level-of-detail multiplier in `(0, 1]`, live (#269). `1` = full
   * detail (default); "performance mode" lowers it. A CPU-tessellation-bound
   * sketch (line meshes — the class a resolution drop does NOT help, #232)
   * should scale its segment / history COUNT by this, e.g.
   * `Math.max(2, Math.round(BASE_SEGMENTS * sig.density))`. Fill/fragment-bound
   * sketches gain nothing here and instead ride the render-resolution knob the
   * renderer applies composite-side. Reads `vizConfig.density` fresh each access
   * (worker: its marshalled singleton — the config-marshal channel feeds it). */
  density: number
}

/**
 * Phase 21 / #351 — the live signal object handed to a p5 sketch as the THIRD
 * `new Function` arg. It exposes the single `sig` namespace (mirrored onto
 * `stave.sig`, D-02), resolved bare per-frame through the inner
 * `with (staveUniforms)`. The per-drum scalars / master DSP are getters ON `sig`
 * itself (`sig.kick`, `sig.fft`) — p5 D-01: live numbers, NOT thunks.
 *
 * `__tick` is a NON-enumerable hook the draw wrapper calls ONCE per frame
 * (`bus.tick(); bus.refreshActive(bus.now())`) — the decay tick fires exactly
 * once per draw (U2), NEVER inside a getter (a getter-tick double-ticks when a
 * sketch reads N signals → decay collapses to 0). Built by `P5VizRenderer`,
 * which owns the (pure) SignalBus; the compiler stays renderer-agnostic and
 * only consumes the shape.
 */
export interface StaveUniforms {
  readonly sig: SigAccessor
  /** Per-frame tick hook (non-enumerable). Optional so a sketch compiled
   *  without a bus (tests, demo mode) still runs — the wrapper null-checks. */
  __tick?: () => void
  /**
   * Custom alias getters (Phase 21 aliases). A user-defined alias (e.g.
   * `kick → bd`) is injected at mount by `P5VizRenderer` as a live getter
   * (`Object.defineProperty(uniforms, name, { get: () => bus.envValue(name) })`)
   * for every merged-map name NOT already a built-in signal. The index
   * signature lets `uniforms[name]` typecheck under strict TS; reads resolve
   * per-frame through the inner `with (staveUniforms)` (full-lifecycle) and the
   * legacy `with (staveUniforms)` wrap (legacy draw-body). `__tick` is read via
   * the optional field above, never via this index (it's non-enumerable). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [customAlias: string]: any
}

/**
 * Detect whether a p5 code snippet uses the new full-lifecycle form
 * (`function setup/draw/preload` declarations) or is a legacy
 * draw-body snippet (bare statements that were historically
 * evaluated directly inside `p.draw`).
 *
 * We look for `function draw` specifically — if the user has
 * declared their own draw handler we assume they know what they're
 * doing and treat the whole snippet as a full sketch. Legacy
 * snippets without `function draw` get auto-wrapped with a default
 * setup + a draw body that contains the user's statements verbatim.
 */
export function isFullLifecycleSketch(code: string): boolean {
  // Tolerate leading whitespace, comments, and alternate formatting.
  // The key signal is: the user declared ANY of p5's lifecycle
  // entry points — `draw`, `setup`, or `preload`. A sketch that only
  // has setup (e.g. a one-shot drawing that doesn't animate) used
  // to fall through to the legacy draw-body wrap, where the user's
  // `function setup` ended up declared inside a synthetic draw and
  // never actually ran — nothing threw, nothing drew, nothing
  // reached engineLog.
  return /\bfunction\s+(?:draw|setup|preload)\s*\(/.test(code)
}

/**
 * `new Function(args, body)` wraps the body with its own header, which
 * V8 generates as two lines:
 *
 *   function anonymous(p,stave
 *   ) {
 *     <body starts here on line 3>
 *
 * Every stack-parsed line coming out of a runtime error — and every
 * line number embedded in a p5 FES message — counts from that header.
 * We subtract this offset plus the wrapper-specific prefix count to
 * translate back into the user's original file.
 */
const NEW_FUNCTION_HEADER_LINES = 2

/**
 * Return the number of wrapper lines sitting between `function
 * anonymous(...)` and the start of the user's code. Call-sites that
 * need to translate a wrapped-body line back to a user-file line
 * subtract this value.
 *
 *   userLine = wrappedLine - getP5LineOffset(userCode)
 *
 * Clamps the result to at least 0 so a caller that forgets to guard
 * an already-too-small line doesn't produce a negative.
 */
export function getP5LineOffset(code: string): number {
  return isFullLifecycleSketch(code)
    ? FULL_LIFECYCLE_PREFIX_LINES + NEW_FUNCTION_HEADER_LINES
    : LEGACY_PREFIX_LINES + NEW_FUNCTION_HEADER_LINES
}

/**
 * Compile a p5 code string into a `P5SketchFactory`. The factory is
 * invoked once per mount by `P5VizRenderer` with the three ref objects
 * the renderer uses to bridge the engine component bag.
 *
 * Execution model:
 *
 *   1. Build a `stave` namespace whose fields are LIVE getters over
 *      the renderer refs. Reading `stave.analyser` inside `draw()`
 *      always returns the current `analyserRef.current`, so a refresh
 *      from `renderer.update(components)` is picked up without the
 *      sketch having to re-subscribe.
 *
 *   2. Wrap the user source inside a `with(p) { ... }` block so that
 *      bare p5 identifiers (`createCanvas`, `background`, `fill`,
 *      `width`, `height`, `mouseX`, `HSB`, `PI`, etc.) resolve to the
 *      matching members of the p5 instance. Functions declared inside
 *      a `with` block capture the object environment in their scope
 *      chain, so when `draw()` is later called by p5, `background(0)`
 *      still resolves to `p.background(0)`.
 *
 *   3. Return an object `{ setup, draw, preload }` containing the
 *      user's declared lifecycle functions. The outer sketch function
 *      assigns those onto the p5 instance so p5 picks them up through
 *      its instance-mode contract.
 *
 *   4. Legacy snippets (no `function draw`) are auto-wrapped: a
 *      default `setup()` creates a full-window canvas, and the
 *      user's code goes inside a synthetic `draw()`. Pre-existing
 *      viz presets written for the old compiler keep working.
 *
 *   5. Compile errors are caught and surfaced via a fallback sketch
 *      that renders the error message on the canvas. Runtime errors
 *      in user code bubble up to p5's own error handler, which the
 *      `P5VizRenderer.mount` path already catches.
 *
 * Non-strict mode note: `new Function` creates a non-strict function
 * unless the body begins with `'use strict'`. We intentionally do NOT
 * add strict mode because `with` is forbidden in strict mode, and
 * `with(p)` is central to letting users write idiomatic bare-name p5
 * code.
 */
export function compileP5Code(code: string, source?: string) {
  // Build the body ONCE per compile. The compiled function is reused
  // for every mount of this sketch (p5 calls it once per `new p5(...)`).
  const body = isFullLifecycleSketch(code)
    ? buildFullLifecycleBody(code)
    : buildLegacyBody(code)
  const lineOffset = getP5LineOffset(code)

  // Pre-validate syntax synchronously, with the same arity as the real compile
  // below (Phase 21 added the THIRD arg `staveUniforms`) or the check would
  // diverge from the executed function.
  //
  // #2220 — a sketch that doesn't parse doesn't throw from here. The compile
  // runs when the renderer is built (`makeP5Renderer`), and when the worker
  // fails first that is inside the fallback's worker-message handler, where a
  // throw reached only the global catch: a "Stave" row with no file and no line.
  // Instead the sketch reports the error itself when it mounts, against its file
  // and on its line in the user's code (V8's SyntaxError has neither), and shows
  // it on the canvas, the way a top-level error below does. That works wherever
  // the sketch runs: the preview, `.viz()`, the worker.
  let syntaxError: VizSyntaxError | null = null
  try {
    new Function('p', 'stave', 'staveUniforms', body)
  } catch (err) {
    const located = locateVizSyntaxError(code, err)
    if (!(located instanceof VizSyntaxError)) throw located
    syntaxError = located
  }

  // P5SketchFactory signature — fourth arg is the container-size ref
  // maintained by the renderer so `stave.width` / `stave.height`
  // expose the preview pane dimensions. Optional (and defaulted) so
  // callers that don't wire the ref still get a usable stave,
  // falling back to window.innerWidth / innerHeight.
  //
  // The SIXTH arg (`staveUniformsRef`, Phase 21) carries the live named-signal
  // uniform object built by `P5VizRenderer` from its per-renderer SignalBus.
  // Optional + defaulted to an inert object so callers that don't wire signals
  // (tests, demo) still compile — `sig.kick` then reads 0, `sig(...)` returns
  // zeros, and `__tick` is a no-op.
  return (
    hapStreamRef: RefObject<HapStream | null>,
    analyserRef: RefObject<AnalyserNode | null>,
    schedulerRef: RefObject<PatternScheduler | null>,
    containerSizeRef: RefObject<ContainerSize> = {
      current: { w: 400, h: 300 },
    } as RefObject<ContainerSize>,
    optionsRef: RefObject<Record<string, unknown>> = {
      current: {},
    } as RefObject<Record<string, unknown>>,
    staveUniformsRef: RefObject<StaveUniforms> = {
      current: makeInertStaveUniforms(),
    } as RefObject<StaveUniforms>,
  ) => {

    return (p: unknown) => {
      if (syntaxError) {
        installErrorSketch(p, syntaxError.message, containerSizeRef)
        emitLog({
          level: 'error',
          runtime: 'p5',
          source,
          message: syntaxError.message,
          line: syntaxError.line,
          column: syntaxError.column,
        })
        return
      }
      // The live named-signal uniform object (Phase 21). Read off the ref so a
      // `renderer.update()` that swaps the bus refs is picked up — but in
      // practice the bus instance is stable for the renderer's life and only
      // its scheduler refs swap in place, so the SAME object's getters stay
      // live across updates. Falls back to an inert object when no signals are
      // wired (tests / demo mode).
      const staveUniforms: StaveUniforms =
        staveUniformsRef.current ?? makeInertStaveUniforms()

      // Live stave namespace — getters forward to the refs so reads
      // inside setup/draw/preload always see the CURRENT values.
      // Caching `const a = stave.analyser` in module scope still
      // stores a reference to whatever was live at cache time; to
      // stay safe, read `stave.*` inside the function body.
      const stave: StaveContext = {
        get scheduler(): PatternScheduler | null {
          return schedulerRef.current
        },
        get analyser(): AnalyserNode | null {
          return analyserRef.current
        },
        get hapStream(): HapStream | null {
          return hapStreamRef.current
        },
        get width(): number {
          return containerSizeRef.current?.w ?? 400
        },
        get height(): number {
          return containerSizeRef.current?.h ?? 300
        },
        get options(): Record<string, unknown> {
          return optionsRef.current ?? {}
        },
        // D-02 — mirror the signal namespace onto the stave namespace.
        // `stave.sig` is the SAME `sig` object exposed bare via `with`.
        get sig(): SigAccessor {
          return (staveUniformsRef.current ?? staveUniforms).sig
        },
      }

      let lifecycle: {
        preload?: () => void
        setup?: () => void
        draw?: () => void
      }
      try {
        const compile = new Function('p', 'stave', 'staveUniforms', body) as (
          p: unknown,
          stave: StaveContext,
          staveUniforms: StaveUniforms,
        ) => typeof lifecycle
        lifecycle = compile(p, stave, staveUniforms)
      } catch (err) {
        // Top-level runtime error inside the user sketch — the most
        // common shape is a ReferenceError from a typo'd identifier
        // (`new Mp()` instead of `new Map()`) at module scope. The
        // compile-time pre-validation at the top of compileP5Code
        // only catches SyntaxErrors; references resolve at execute
        // time. Two things happen here:
        //   1. Canvas fallback: `installErrorSketch` paints the
        //      error in the preview pane so a user who has the
        //      Console panel closed still sees something.
        //   2. engineLog bridge: `emitLog` pushes the error through
        //      the shared pipe (Console row, toast, status-bar chip,
        //      Monaco squiggle). Without this, the preview pane was
        //      the ONLY surface that showed the error.
        const error = err instanceof Error ? err : new Error(String(err))
        installErrorSketch(p, error.message, containerSizeRef)
        const parts = formatFriendlyError(error, 'p5', {
          index: P5_DOCS_INDEX,
        })
        const loc = parseStackLocation(error)
        const userLine =
          loc && lineOffset > 0 ? Math.max(1, loc.line - lineOffset) : loc?.line
        emitLog({
          level: 'error',
          runtime: 'p5',
          source,
          message: parts.message,
          suggestion: parts.suggestion,
          stack: parts.stack,
          line: userLine,
          column: loc?.column,
        })
        return
      }

      installLifecycle(p, lifecycle, source, lineOffset, staveUniforms)
    }
  }
}

/**
 * An inert `StaveUniforms` — all signals 0, `sig(...)` returns zeros, `__tick` a
 * no-op. Used when a sketch is compiled without a wired SignalBus (unit tests,
 * demo mode). Keeps `sig.kick` / `sig('bd')` safe (never `undefined`) so a
 * sketch written for live signals still runs silently rather than throwing.
 */
function makeInertStaveUniforms(): StaveUniforms {
  const zeroReading = (): P5SignalReading => ({
    env: 0,
    velocity: 0,
    note: null,
    color: null,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    fft: [],
    wave: [],
  })
  const sig = ((_sound: string): P5SignalReading =>
    zeroReading()) as SigAccessor
  sig.track = (_id: string): P5SignalReading => zeroReading()
  sig.tracks = []
  sig.sounds = []
  // Per-drum envelope + global-velocity zeros.
  sig.kick = 0
  sig.snare = 0
  sig.hat = 0
  sig.openHat = 0
  sig.clap = 0
  sig.rim = 0
  sig.tom = 0
  sig.keyVelocity = 0
  // Master-mix DSP zeros (Slice 2) — `sig.rms`/… are inert numbers, `sig.fft`/…
  // are empty arrays, so a sketch reading them in demo mode never NaNs / throws.
  sig.rms = 0
  sig.bass = 0
  sig.mid = 0
  sig.treble = 0
  sig.fft = []
  sig.wave = []
  sig.density = 1
  return {
    sig,
    __tick: () => {},
  }
}

/**
 * Produce a function body for `new Function('p', 'stave', body)` that
 * evaluates a full-lifecycle sketch. The user's source is inlined
 * verbatim inside `with(p) { ... }`, so their `function setup/draw/
 * preload` declarations capture `p` (and therefore the bare p5
 * method names) in their scope chain. After the declarations, a
 * synthetic return collects whichever of the three lifecycle names
 * the user actually defined.
 *
 * `typeof X === 'function'` guards let us tolerate partial sketches —
 * a user who only wrote `draw` gets a working sketch with just draw.
 */
/**
 * Prefix preceding `${userCode}` in the full-lifecycle body template.
 * Counted at module load so the emit-time line offset tracks the
 * template verbatim (change the template → offset self-updates).
 */
// Phase 21 / #351 — a SECOND `with (staveUniforms)` nests inside `with (p)` so
// that the bare `sig` namespace (and `stave.sig`) resolves LIVE through the
// object's GETTERS every frame, exactly the way `width` / `mouseX` resolve
// through `with (p)` (see the execution-model jsdoc above, :120-128). Reading
// `sig.kick` per-frame stays fresh because `sig`'s props are getters — a
// top-level `const k = sig.kick` would capture ONCE and freeze (U2 trap). The
// prefix is counted at module load so the emit-time line offset self-updates
// from the template string (change the template → the offset tracks it).
const FULL_LIFECYCLE_PREFIX = '\nwith (p) {\n  with (staveUniforms) {\n  '
const FULL_LIFECYCLE_PREFIX_LINES = (FULL_LIFECYCLE_PREFIX.match(/\n/g) || [])
  .length

function buildFullLifecycleBody(userCode: string): string {
  return `${FULL_LIFECYCLE_PREFIX}${userCode}
  return {
    setup: typeof setup === 'function' ? setup : undefined,
    draw: typeof draw === 'function' ? draw : undefined,
    preload: typeof preload === 'function' ? preload : undefined,
  }
  }
}
  `
}

/**
 * Legacy auto-wrap: the user wrote bare draw-body statements (the
 * old compiler's contract). We produce a lifecycle object whose
 * `setup` creates a full-window canvas and whose `draw` runs the
 * user's statements inside `with(p)` every frame. `stave.scheduler`
 * / `stave.analyser` / `stave.hapStream` are also aliased to bare
 * `scheduler` / `analyser` / `hapStream` inside the draw body so
 * snippets written for the OLD compiler (which exposed those as
 * locals) keep working without modification.
 */
/**
 * Prefix preceding `${userCode}` in the legacy draw-body template.
 *
 * Phase 21 / #351 — `const sig = staveUniforms.sig` is declared INSIDE the
 * synthetic `draw` body, NOT at top level — re-read EVERY frame (mirroring the
 * existing `const scheduler = stave.scheduler` aliasing). A top-level const
 * would evaluate ONCE at `compile(p, stave, staveUniforms)` time, before any
 * draw fires, and freeze (U2 trap). `sig`'s own props are getters, so
 * `sig.kick` stays live each draw. `stave.sig` is the same object mirrored on
 * the stave namespace (D-02).
 *
 * Phase 21 ALIASES — the draw body is ALSO wrapped in `with (staveUniforms)`
 * (nested inside `with (p)`), the SAME inner-`with` the full-lifecycle body
 * already uses. WITHOUT it, a CUSTOM bare alias (e.g. `kick` from a
 * user-defined `kick → bd` map) would be DEAD here: the hardcoded `const`s
 * above only cover the BUILT-IN names, and the pure compiler can't know the
 * runtime-dynamic custom names. The inner `with` resolves any custom getter
 * `Object.defineProperty`'d onto `staveUniforms` at mount, per frame (LIVE — no
 * capture, U2). The built-in `const`s are kept (they shadow the with-resolved
 * built-ins harmlessly and keep `LEGACY_PREFIX_LINES` self-counting). The
 * inner `with` adds lines to the prefix — `LEGACY_PREFIX_LINES` recounts the
 * template at module load so `getP5LineOffset` self-corrects.
 */
const LEGACY_PREFIX = `
with (p) {
  with (staveUniforms) {
  return {
    setup: function () {
      createCanvas(p.windowWidth, p.windowHeight)
      colorMode(RGB)
    },
    draw: function () {
      const scheduler = stave.scheduler
      const analyser = stave.analyser
      const hapStream = stave.hapStream
      const sig = staveUniforms.sig
      `
const LEGACY_PREFIX_LINES = (LEGACY_PREFIX.match(/\n/g) || []).length

function buildLegacyBody(userCode: string): string {
  return `${LEGACY_PREFIX}${userCode}
    },
    preload: undefined,
  }
  }
}
  `
}

/**
 * Assign the compiled lifecycle functions onto the p5 instance. If
 * the user didn't supply `setup`, fall back to a default that just
 * creates a full-window canvas — without SOME setup, p5 throws.
 *
 * Each user lifecycle hook is wrapped in a try/catch that forwards
 * the error to `emitLog`. p5 v2 swallows draw-time throws internally
 * (sets `hitCriticalError`, halts the loop, never reaches the
 * browser console or FES). Without this wrap, a `translate(0, 0,
 * zoom)` where `zoom` is undefined just produced a black canvas and
 * dead silence — no Console row, no toast, no squiggle. The wrap
 * also keeps the tight per-frame flood in check: `emitLog`'s dedupe
 * collapses identical consecutive entries so 60fps of ReferenceError
 * becomes one Console row.
 */
function installLifecycle(
  p: unknown,
  lifecycle: { preload?: () => void; setup?: () => void; draw?: () => void },
  source: string | undefined,
  lineOffset: number,
  staveUniforms?: StaveUniforms,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pi = p as any
  const reportLifecycleError = (hook: string, err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err))
    const parts = formatFriendlyError(error, 'p5', { index: P5_DOCS_INDEX })
    const loc = parseStackLocation(error)
    const userLine =
      loc && lineOffset > 0
        ? Math.max(1, loc.line - lineOffset)
        : loc?.line
    emitLog({
      level: 'error',
      runtime: 'p5',
      source,
      message: `${hook}(): ${parts.message}`,
      suggestion: parts.suggestion,
      stack: parts.stack,
      line: userLine,
      column: loc?.column,
    })
  }
  const wrap = (
    hook: string,
    fn: (() => void) | undefined,
  ): (() => void) | undefined => {
    if (!fn) return undefined
    return function (this: unknown, ...args: unknown[]) {
      try {
        return (fn as (...a: unknown[]) => unknown).apply(this, args)
      } catch (err) {
        reportLifecycleError(hook, err)
        // Swallow — returning normally lets p5 continue. The dedupe
        // in engineLog keeps per-frame floods from drowning the
        // Console panel; the user still sees one clear row.
      }
    }
  }
  if (lifecycle.preload) pi.preload = wrap('preload', lifecycle.preload)
  pi.setup =
    wrap('setup', lifecycle.setup) ??
    function () {
      pi.createCanvas(pi.windowWidth, pi.windowHeight)
    }
  // Phase 21 — fire the signal-bus tick EXACTLY ONCE per draw frame, BEFORE the
  // user's draw body so the `sig.kick` getters it reads see the freshly
  // decayed + re-snapshotted bus state. The tick lives HERE (the renderer-owned
  // draw wrapper), NEVER inside a uniform getter — a getter-driven tick would
  // double-tick when a sketch reads N uniforms in one frame (decay collapses to
  // 0, U2). `__tick` is a no-op for inert/demo uniforms.
  //
  // KNOWN LIMITATION (FLAG-3): we only attach `pi.draw` — and therefore the
  // tick — when the sketch declared a `draw`. A setup-only / static sketch
  // never ticks, so `.env` never decays for it. ACCEPTABLE for Slice 1 (every
  // reactive sketch has a draw); `.env` reactivity REQUIRES a `draw()`. A
  // static sketch needing reactive signals would attach the tick to a
  // renderer-owned hook instead — out of scope here.
  if (lifecycle.draw) {
    const wrappedDraw = wrap('draw', lifecycle.draw)
    // p5 calls `draw()` with no args — the tick fires first (once per frame),
    // then the user's (error-wrapped) draw body runs and reads fresh uniforms.
    pi.draw = function (this: unknown) {
      staveUniforms?.__tick?.()
      return wrappedDraw?.call(this)
    }
  }
}

/**
 * Replace the sketch with a tiny error-display sketch. Used as the
 * fallback when `new Function` itself throws (syntax error). Runtime
 * errors during draw/setup still bubble up through p5's own handler.
 */
function installErrorSketch(
  p: unknown,
  message: string,
  containerSizeRef: RefObject<ContainerSize>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pi = p as any
  pi.setup = function () {
    // #2225 — the preview's size, as `stave.width` / `stave.height` give a
    // sketch. In the viz worker the canvas is shown at the preview's size, so
    // one sized from the window was stretched to fit; both hosts resize it
    // with the preview after this.
    const size = containerSizeRef.current
    pi.createCanvas(size?.w ?? 400, size?.h ?? 300)
  }
  pi.draw = function () {
    pi.background(20, 20, 24)
    pi.noStroke()
    pi.fill(255, 120, 120)
    pi.textFont('monospace')
    pi.textSize(12)
    pi.text('p5 viz compile error:', 12, 24)
    pi.fill(230)
    pi.textSize(11)
    pi.text(message, 12, 48, pi.width - 24, pi.height - 60)
  }
}
