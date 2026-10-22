import { declarePlayback, startAudio, startAudioOnNextGesture } from './audioStart'
import { HapStream } from './HapStream'
import { BreakpointStore } from './BreakpointStore'
import { LiveRecorder } from './LiveRecorder'
import { perf } from '../perf/profiler'
import { WavEncoder, SilentCaptureError } from './WavEncoder'
import { emitLog } from './engineLog'
import { renderPatternOffline, describeSkipped, RenderCancelledError, type OfflineGraphDeps, type SkippedSounds } from './renderPatternOffline'
import { canPauseOfflineRender, piecesOf, renderInPieces } from './pieceRender'
import { renderStemsInOrder, type StemOutcome } from './renderStemsInOrder'
import { planStems, tagTrack } from './stemSplit'
import { createTransportHold } from './transportHold'
import { onLiveGraph, registerBackgroundRender, whenGraphFree, withOfflineGraph, withUserRender } from './offlineGraph'
import { displayRenderRate } from './displayRate'
import {
  createTrackEnvelopeScheduler,
  digest,
  envelopeFromChannels,
  type TrackEnvelope,
  type TrackEnvelopeAccess,
} from './trackEnvelopes'
import { createLiveTriggerDrain } from './liveTriggerDrain'
import { normalizeStrudelHap, declaredLocationKeys } from './NormalizedHap'
import type { HapEvent } from './HapStream'
import type { PatternScheduler } from '../visualizers/types'
import { scanVizRequestLines } from './vizLineScan'
import type { LiveCodingEngine, EngineComponents } from './LiveCodingEngine'
import { parseStrudel } from '../codeView/ir/parseStrudel'
import { buildNodeLocIndex } from '../codeView/ir/nodeIdentity'
import type { PatternIR, IREvent } from '../codeView'
import { getTierFlags, type TierFlags } from './tierFlags'
import { aliasSoundValue } from './aliases'
import { canOpenAudioFrame, offlineContextInFrame } from './audioFrame'
import { isSoundfontZoneError, soundfontRangeMessage } from './friendlyErrors'
import { locateEvalError, measureEvalFrame, type EvalFrameShape } from './evalErrorLocation'
import { installMiniStringParser } from './stringParser'
import { resolveBareCaptureId } from './bareCapture'
import { normalizeLoopRange, type LoopRange } from './transportFrame'
import { STRUDEL_VIZ_METHODS } from './strudelVizMethods'
import { sliderFunctions, sliderWidgets, type SliderWidgetConfig } from './vendored/slider'

type HapHandler = (event: HapEvent) => void

/**
 * Can this value answer a time query? The bare-capture fallback takes whatever
 * the repl returned, and that is not always a Pattern — a document whose every
 * track is `_`-muted leaves Strudel with nothing to play and it substitutes its
 * own repl handle. Asking for the CAPABILITY the callers use (`queryArc`) rather
 * than for a Pattern brand keeps this honest across Strudel's own wrappers.
 */
function isQueryablePattern(p: unknown): p is { queryArc: (a: number, b: number) => unknown[] } {
  return !!p && typeof (p as { queryArc?: unknown }).queryArc === 'function'
}

/**
 * Reconstruct a literal viz name from whatever the user passed to
 * `.viz(...)` after Strudel's transpiler has reified it.
 *
 * Strudel runs every string argument through `reify()` which parses
 * it as mini-notation. The mini-notation tokenizer treats spaces as
 * sequence operators and `:` as the sample-index operator, so a
 * literal name like `"Piano Roll"` ends up as a 2-step Pattern, and
 * `"pianoroll:hydra"` ends up as a 1-step Pattern whose value is the
 * array `["pianoroll", "hydra"]`. We undo both transformations to
 * recover the user's original string.
 *
 * Exported (and pure) so it can be unit-tested without booting the
 * full Strudel runtime.
 *
 * @remarks
 * Names that contain other mini-notation operators (`*`, `[`, `<`,
 * `,`, `?`, etc.) won't roundtrip cleanly — those characters change
 * the Pattern shape in ways we can't unambiguously reverse. The
 * documented allowed character set for viz names is alphanumerics +
 * spaces + `:`.
 */
export function extractVizName(rawArg: unknown): string | undefined {
  if (typeof rawArg === 'string') return rawArg || undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pat = rawArg as any
  if (!pat || !pat._Pattern || typeof pat.queryArc !== 'function') {
    return undefined
  }
  const renderHapValue = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.join(':')
    if (v == null) return ''
    return String(v)
  }
  let haps: Array<{ value: unknown }>
  try {
    haps = pat.queryArc(0, 1)
  } catch {
    return undefined
  }
  if (haps.length === 0) return undefined
  if (haps.length === 1) {
    const out = renderHapValue(haps[0].value)
    return out === '' ? undefined : out
  }
  // Multi-token sequence — rejoin with spaces.
  const out = haps.map((h) => renderHapValue(h.value)).join(' ')
  return out === '' ? undefined : out
}

// The vocabulary lives in its own module so the static-IR readers can use it
// without importing the engine (#1592); re-exported so every existing import holds.
export { STRUDEL_VIZ_METHODS }

/**
 * Deadline for any third-party manifest fetch during engine boot (#1214).
 *
 * Chosen against the measured shape of the failure, not by feel: a healthy
 * manifest load settles in a few hundred milliseconds, and a stalled one never
 * settles at all — the distribution is bimodal with nothing in between. So the
 * cut only has to sit clear of "slow but working", and buying extra seconds
 * beyond that buys nothing: there is no population of loads that take four
 * seconds. Three is already more than ten times the healthy median.
 *
 * ⚠ IT IS ALSO A CEILING ON HOW LONG A STALL COSTS, which is what set the final
 * number. An earlier 8s draft worked — boot completed and the timeline drew —
 * but measured 9.8s end to end under a held-open manifest, which is longer than
 * the ten-second budget much of the app and its suite allow for "the song has
 * drawn". A deadline that keeps the app alive but blows every downstream wait
 * has only moved the failure. At 3s the same path lands near 4.5s, inside those
 * budgets with room to spare.
 */
const MANIFEST_DEADLINE_MS = 3_000

/**
 * Ceiling on the manifest phase AS A WHOLE (#1217).
 *
 * The per-call deadline above bounds one fetch. It does not bound boot, because
 * the loads run in sequence — the Dirt-Samples index, then the b-cdn banks,
 * then the alias table — so with only a per-call ceiling a total outage pays
 * one wait per stage. Measured on the unfixed path: one unreachable host added
 * 3.55s to boot, all of them added 8.14s. The second number is what downstream
 * waits actually see when a machine is offline or behind a captive portal, and
 * it does not fit in the ten seconds they allow.
 *
 * Four seconds is derived from the consumer side, same as its sibling: it keeps
 * a total outage near 4.5s end to end, which leaves the same margin under those
 * waits that a single stall was given. It is NOT derived from how slow the
 * network might be — that question is what the per-call deadline answers.
 */
const MANIFEST_BUDGET_MS = 4_000

/**
 * Ceiling on ALL of engine boot (#1215).
 *
 * The manifest budget bounds the optional half of init. This bounds the whole
 * of it, including the nine module imports, `evalScope` and `initAudio` — the
 * steps there is no engine without. Same derivation as its siblings, from the
 * consumer side: the app and its suite widely allow ten seconds for "the song
 * has drawn", so boot must fail or finish inside that with room, and six leaves
 * the manifest phase its full four while a required stall still gives up in
 * three. Healthy boot spends a small fraction of it — measured end to end at
 * roughly a second.
 *
 * Every bounded step takes `min(its own ceiling, what remains of this)`, so
 * adding a step can never extend boot past this number. That is the property
 * #1217 had to be re-fixed to get, and it is why nothing here gets an
 * independent deadline of its own.
 */
const INIT_BUDGET_MS = 6_000

/**
 * Ceiling on one REQUIRED boot step — a module import, `evalScope`, `initAudio`.
 *
 * Same bimodal argument as the manifest deadline: a chunk request either
 * answers quickly or does not answer, and there is no population in between, so
 * three seconds is far past healthy and still far short of forever.
 *
 * ⚠ THE FAILURE MODE IS DIFFERENT FROM ITS SIBLINGS, AND THAT IS THE POINT.
 * A missing sample bank degrades; a missing `@strudel/core` does not — there is
 * nothing to continue with. So a required step that runs out of time THROWS
 * rather than warning and returning null. That is not a worse outcome than the
 * hang it replaces, it is a categorically better one: `init()` clears its
 * memoised promise on rejection, so a bounded failure can be retried by
 * evaluating again, while a hang is joined by every later caller forever. The
 * rule from #1214 was never "don't fail" — it was "can this fail to ANSWER?".
 */
const REQUIRED_STEP_MS = 3_000

/**
 * A shrinking allowance. `remaining()` is what is left of `totalMs` since the
 * budget was opened, and it goes negative once spent — callers clamp.
 *
 * Opened per boot rather than per module, so a second engine or a re-init after
 * dispose starts from full. A module-level clock would mean the first page load
 * spends the allowance and every later one believes it has none.
 */
function openBudget(totalMs: number): () => number {
  const startedAt = Date.now()
  return () => totalMs - (Date.now() - startedAt)
}

/**
 * A required boot step that did not complete. The engine cannot start.
 *
 * ⚠ THE STEP KNOWS WHICH STEP IT WAS; THE CATCHER DOES NOT — and until #1218
 * the only way to recover that upstream was to match the message text, which
 * is a second copy of a rule that lives here and drifts the first time the
 * wording is improved. The label and the deadline now ride on the error as
 * DATA, so a caller can decide what to show without re-deriving anything.
 */
export interface BootStepFailure extends Error {
  /** the step's own label — `@strudel/transpiler`, `evalScope`, `initAudio` */
  readonly bootStep: string
  /** the ceiling it was given, or 0 when the budget was already spent */
  readonly bootStepDeadlineMs: number
}

/**
 * Is this a required-boot-step failure?
 *
 * ⚠ BRANDED, NOT `instanceof` — deliberately. This package ships ESM and CJS,
 * and a page that ends up holding both copies gets two of every class, so an
 * `instanceof` check would answer `false` for a perfectly real failure and the
 * app would silently fall back to the generic error path. An own-property brand
 * survives duplicate module instances, which is the failure this codebase has
 * already been bitten by once.
 */
export function isBootStepFailure(err: unknown): err is BootStepFailure {
  return (
    err instanceof Error &&
    typeof (err as Partial<BootStepFailure>).bootStep === 'string'
  )
}

/** Attach the brand to whatever a step threw, without replacing the error. */
function asBootStepFailure(err: unknown, step: string, deadlineMs: number): BootStepFailure {
  const e = (err instanceof Error ? err : new Error(String(err))) as Error & {
    bootStep: string
    bootStepDeadlineMs: number
  }
  e.bootStep = step
  e.bootStepDeadlineMs = deadlineMs
  return e
}

/**
 * Run one REQUIRED boot step under the init budget, and reject if it stalls.
 *
 * The warning is emitted here, before the throw, deliberately: whoever catches
 * this upstream may well be a best-effort path that swallows it, and #1214 cost
 * what it cost because nothing on the path said anything. The step knows which
 * step it was; the catcher does not.
 */
function createRequiredStep(
  initRemaining: () => number,
): <T>(label: string, fn: () => Promise<T>) => Promise<T> {
  return async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const deadlineMs = Math.min(REQUIRED_STEP_MS, initRemaining())
    // ⚠ THE CLOSING CLAUSE USED TO SAY "evaluating again starts a fresh
    // attempt", and #1218 measured that to be FALSE for the case that
    // dominates here. `init()` does clear its memo on rejection, so a retry
    // genuinely re-enters — and a stalled module import still cannot succeed,
    // because the module registry hands back the same dead pending request and
    // issues no second fetch. The old sentence told the user to do the one
    // thing that cannot work; this one names what actually recovers.
    const fail = (why: string): BootStepFailure =>
      asBootStepFailure(
        new Error(
          `[StrudelEngine] boot step "${label}" ${why}. This is usually a network, proxy or ` +
            `service-worker problem rather than a code fault. A stalled load cannot be retried ` +
            `in place — reload the page to start over.`,
        ),
        label,
        Math.max(0, deadlineMs),
      )

    if (deadlineMs <= 0) {
      const err = fail(`was not attempted: boot's ${INIT_BUDGET_MS}ms budget was already spent`)
      console.warn(err.message)
      throw err
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(fail(`did not answer within ${deadlineMs}ms`)), deadlineMs)
        }),
      ])
    } catch (err) {
      console.warn(
        `[StrudelEngine] boot step "${label}" failed; the engine cannot start without it.`,
        err,
      )
      // Branded on the way out, not only on the deadline path: a step that
      // REJECTS on its own (a 404 chunk, a transpiler that throws) is just as
      // fatal to boot as one that never answers, and the caller deciding what
      // to show must not have to tell those two apart.
      throw asBootStepFailure(err, label, Math.max(0, deadlineMs))
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * ⚠ THE TWO NUMBERS ABOVE HAVE TO BE READ TOGETHER, and the gap between them is
 * load-bearing. A shared budget raises an obvious worry: the first stalled host
 * spends it, and every manifest after it — reachable ones included — is skipped,
 * silently costing the user the piano and the drum machines to save a few
 * hundred milliseconds. That worry is why an explicit per-call floor was drafted
 * here and then removed: with a 4s budget and a 3s ceiling, one stall always
 * leaves a full second, which is several times what a healthy manifest needs.
 * The gap IS the floor, so a second constant could never change an outcome — it
 * could only lengthen a total outage. The arm in
 * `boot-survives-stalled-sample-manifest.spec.ts` asserting that no REACHABLE
 * manifest is skipped is what holds this together; if the two numbers are ever
 * moved closer, that arm is the one that will notice.
 */

/**
 * Run one third-party boot fetch with a deadline, and never let it be fatal.
 *
 * WHY THIS EXISTS (#1214). `initInternal` loads sample manifests over the
 * network, and the loader beneath them (`superdough/sampler.mjs`) issues its
 * fetches with no AbortController, no signal and no timeout. A stalled request
 * therefore produced an await that never settled — and because `init()`
 * memoises its in-flight promise so callers join one run, every later caller
 * joined the same dead promise instead of retrying. The engine never
 * initialised, nothing threw, nothing logged, and the app sat there with a
 * blank timeline and no way back but a reload. Roughly one page load in ten.
 *
 * THE RULE THIS ENFORCES. An init that every feature path awaits may not
 * contain an unbounded wait on anything it does not control. The question to
 * ask of such a call is not "can it fail?" — a rejection was always survivable
 * here — but "can it fail to ANSWER?". Silence is the case that needs the
 * deadline, and it is the case a try/catch cannot see.
 *
 * ⚠ WHAT THIS DOES NOT DO. `Promise.race` does not cancel the losing side, and
 * `samples()` accepts no abort signal, so a stalled request stays pending in
 * the background after we walk away from it. That is deliberate and it is the
 * best available: a pending request nobody awaits is inert, whereas the awaited
 * one was fatal. If superdough ever takes a signal, pass one and drop this note.
 *
 * Returns null when the step timed out or threw. Every caller treats that as
 * "these samples are unavailable", which is a content gap, not a broken engine.
 */
type BoundedManifestLoad = <T>(label: string, fn: () => Promise<T>) => Promise<T | null>

/**
 * Return a loader for OPTIONAL boot steps — the ones boot is allowed to lose.
 *
 * Every call waits for whichever is smallest: its own ceiling, what is left of
 * boot's overall budget, and (when the caller supplies one) what is left of a
 * phase sub-budget. The sub-budget is what stops a group of sibling steps
 * stacking their deadlines against each other (#1217); the init budget is what
 * stops the group outliving boot as a whole (#1215).
 *
 * Budgets are opened per boot, not per module: a second engine, or a re-init
 * after dispose, gets fresh clocks. A module-level start time would mean the
 * first page load spends the allowance and every later one believes it has none.
 */
function createOptionalStep(
  initRemaining: () => number,
  phaseRemaining?: () => number,
): BoundedManifestLoad {
  return async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    const remaining = Math.min(phaseRemaining?.() ?? Number.POSITIVE_INFINITY, initRemaining())
    if (remaining <= 0) {
      // Skip WITHOUT calling fn: with nothing left there is no wait to give it,
      // and starting a request we will not await only adds a connection to a
      // host that has already proved unreachable.
      console.warn(
        `[StrudelEngine] optional boot step "${label}" did not load; continuing without it.`,
        new Error("boot's budget was already spent"),
      )
      return null
    }
    const deadlineMs = Math.min(MANIFEST_DEADLINE_MS, remaining)

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${deadlineMs}ms`)),
            deadlineMs,
          )
        }),
      ])
    } catch (err) {
      console.warn(
        `[StrudelEngine] optional boot step "${label}" did not load; continuing without it.`,
        err,
      )
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/** #1731 — settle time after the last evaluate, stop or request before a display render starts. */
const TRACK_ENVELOPE_DEBOUNCE_MS = 700
/** #1731 — seconds of audio one display pass may render, summed over tracks. */
const TRACK_ENVELOPE_CAP_SECONDS = 1200
/** #1731 — envelope resolution: 10 ms columns. */
const TRACK_ENVELOPE_COLUMNS_PER_SECOND = 100
/**
 * #1771 — where a render cannot pause (Firefox), the display render is split
 * into pieces this long, each started this much early so what rings into it is
 * heard (`pieceRender.ts`). Measured at these values only, not tuned: a redraw
 * of two 512 s tracks went from 112.5 s to 9.1 s in Firefox (Chromium 10–11 s).
 * The lead-in is rendered and dropped, so a piece renders 1.5× its audio.
 */
const DISPLAY_PIECE_SECONDS = 8
const DISPLAY_PIECE_LEAD_SECONDS = 4

/**
 * Single source of truth for audio in Stave.
 * Wraps @strudel/webaudio (which wraps superdough) via webaudioRepl().
 *
 * API surface matches ARCHITECTURE.md.
 * One instance per page. Must be init()'d after a user gesture.
 */
export class StrudelEngine implements LiveCodingEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private repl: any = null
  /**
   * #1627 — holds the live transport still while an offline render borrows
   * superdough's globals, and restores it after. See `transportHold.ts`.
   */
  /** #1656 — live triggers still under way, so a render can wait for them. */
  private liveTriggers = createLiveTriggerDrain()
  private transportHold = createTransportHold({
    isPlaying: () => Boolean(this.repl?.scheduler?.started),
    pause: () => this.repl?.scheduler?.pause?.(),
    resume: async () => {
      await this.repl?.scheduler?.start?.()
      this.followMasterAnalyser()
    },
    onResumeError: (error) =>
      emitLog({
        level: 'warn',
        runtime: 'strudel',
        message: `Playback could not resume after the bounce: ${error instanceof Error ? error.message : String(error)}`,
      }),
    drain: async () => {
      const ctx = this.audioCtx
      if (!ctx || this.liveTriggers.pending() === 0) return
      const { gaveUp } = await this.liveTriggers.drain({
        now: () => ctx.currentTime,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        capSeconds: 2,
        marginSeconds: 0.05,
      })
      if (gaveUp > 0) {
        emitLog({
          level: 'warn',
          runtime: 'strudel',
          message:
            `The bounce started while ${gaveUp} live ${gaveUp === 1 ? 'sound was' : 'sounds were'} still loading. ` +
            `${gaveUp === 1 ? 'It' : 'They'} will not play; the bounce itself is unaffected.`,
        })
      }
    },
  })
  /**
   * #1731 — each wanted synth track rendered offline for the Song timeline to
   * draw, only while the transport is stopped. See `trackEnvelopes.ts`.
   */
  private trackEnvelopeListeners = new Set<() => void>()
  private trackEnvelopes = createTrackEnvelopeScheduler({
    isPlaying: () => Boolean(this.repl?.scheduler?.started),
    cps: () => this.getCps() ?? 0.5,
    exists: (trackId) => this.songPatterns.has(trackId),
    fingerprint: (trackId, cycles) => this.trackFingerprint(trackId, cycles),
    render: (trackId, cycles, signal) => this.renderTrackEnvelope(trackId, cycles, signal),
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    onChange: () => {
      for (const listener of this.trackEnvelopeListeners) listener()
    },
    debounceMs: TRACK_ENVELOPE_DEBOUNCE_MS,
    capSeconds: TRACK_ENVELOPE_CAP_SECONDS,
    weight: (trackId) => {
      const live = this.audioCtx?.sampleRate
      const rate = this.displayRates.get(trackId)
      return live && rate ? rate / live : 1
    },
  })
  /** #1759 — the rate each track's display render uses, decided with its fingerprint. */
  private displayRates = new Map<string, number>()
  /**
   * #1733 — an audition anywhere on the page interrupts this engine's display
   * render; #1735 — so does a user render in any file, for as long as it runs.
   */
  private unregisterBackgroundRender = registerBackgroundRender(this.trackEnvelopes)
  private audioCtx: AudioContext | null = null
  /** takes off the "start audio on the next gesture" listeners (#1987) */
  private stopAskingForAudio: (() => void) | null = null
  /** Notes handed to superdough after their start time, which it drops (#1348). */
  private lateNotes = 0
  /** Above zero while the scheduler's own query runs (#2173). See `watchSkippedTicks`. */
  private schedulerQuery = { depth: 0 }
  /** takes off the `strudel.log` listener that raises play-time errors (#2173) */
  private stopListeningForPlayErrors: (() => void) | null = null
  private analyserNode: AnalyserNode | null = null
  private hapStream: HapStream = new HapStream()
  // #339 — monotonic evaluate() generation, stamped onto every emitted hap
  // via hapStream.setEpoch. Lets useHighlighting tell a fresh eval (loc
  // offsets reset) from the running pattern re-emitting stale-coordinate locs.
  private evalEpoch = 0
  private initialized = false
  /** The one in-flight `init()`, shared by every overlapping caller (#815). */
  private initPromise: Promise<void> | null = null
  // Resolve function for the current in-flight evaluate() call
  private evalResolve: ((result: { error?: Error }) => void) | null = null
  // Runtime audio error handler (e.g. "sound X not found" during scheduling)
  private runtimeErrorHandler: ((err: Error) => void) | null = null
  // #2175 — what the repl last transpiled, and how its evaluate wraps the
  // result, so an error thrown while the code runs can be mapped to its line.
  private lastTranspile: { code: string; options: Record<string, unknown>; run: (options: Record<string, unknown>) => unknown } | null = null
  private evalFrame: EvalFrameShape | null = null
  // Sound names registered after init() — used for editor autocompletion
  private loadedSoundNames: string[] = []
  // Per-track PatternSchedulers captured during the last evaluate() call.
  // These hold the pattern in the SCHEDULER frame — `.late(transportOffset)`
  // applied — because every consumer (viz, signal bus, meters, the live
  // playhead) reads them against the wall clock.
  private trackSchedulers: Map<string, PatternScheduler> = new Map()
  // #863 — the same per-track patterns in the SONG frame: captured BEFORE the
  // `.late(transportOffset)` seek wrap, so cycle 0 is the start of the song
  // rather than the start of the current scheduler window. The Song timeline
  // draws static marks on a song-absolute axis against IR-derived lanes, so it
  // must read from here (`getTimelineEvents`) — a shifted query would drift the
  // marks off their lanes by the offset after any seek. Kept in lock-step with
  // `trackSchedulers` (assigned together on a successful evaluate).
  private songPatterns: Map<string, any> = new Map() // eslint-disable-line @typescript-eslint/no-explicit-any
  // Per-track viz requests captured during the last evaluate() call
  private vizRequests: Map<string, string> = new Map()
  // Per-track viz options (the `.pianoroll({...})` argument), keyed by the
  // same captureId as vizRequests. Empty when no viz call passed an argument.
  private vizOptions: Map<string, Record<string, unknown>> = new Map()
  // Options for the backdrop viz call (`.pianoroll({...})`), null when none.
  private backdropVizOptions: Record<string, unknown> | null = null
  // Backdrop viz requested by a non-underscore Strudel viz method (e.g.
  // `.scope()`, `.pianoroll()`) during the last evaluate(). Strudel's
  // non-underscore viz methods are its "big"/fullscreen form — we map them
  // to Stave's backdrop instead of drawing strudel's own fullscreen canvas.
  // Resolved renderer id (e.g. 'scope', 'pianoroll'); null when none called.
  private backdropVizRequest: string | null = null
  // Reference to superdough audio controller (set during init)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private audioController: any = null
  // Per-track AnalyserNodes keyed by captureId, side-tapped off the
  // superdough Orbit each captured pattern plays through.
  private trackAnalysers: Map<string, AnalyserNode> = new Map()
  // The orbit each tracked analyser is tapped from — lets re-evaluate reuse
  // existing analysers when the captureId/orbit pair hasn't changed.
  private trackOrbit: Map<string, number> = new Map()
  // Code from the last successful evaluate() — used by buildVizRequestsWithLines
  private lastEvaluatedCode: string = ''
  // Pattern IR from the last successful evaluate() — parsed from the user code.
  private lastPatternIR: PatternIR | null = null
  // PV38 clause 2 — loc-keyed lookup over the IR's Play leaves (loc → irNodeId);
  // both queryArc callbacks (per-track + convenience) read this to enrich haps
  // with `irNodeId`. Built from `buildNodeLocIndex(lastPatternIR)` on eval
  // success (node identity is a structural property of the IR — #975/#982),
  // cleared on failure.
  private lastIRNodeLocLookup: ReadonlyMap<string, IREvent[]> | null = null
  // #1619 — the spans the last SUCCESSFUL evaluate's transpiler declared, as
  // `start:end` keys (`declaredLocationKeys`). Unlike the IR lookup it is KEPT on a
  // failed evaluate: that evaluate also keeps the last good patterns (`songPatterns`,
  // `trackSchedulers`), and these are the spans those patterns' haps were located
  // against. Null = unknown, which filters nothing.
  private lastDeclaredLocations: ReadonlySet<string> | null = null
  // #345 — the `slider(…)` calls the last SUCCESSFUL evaluate's transpiler reported, as
  // it reported them. Kept on a failed evaluate for the same reason as the spans above:
  // the patterns still playing read those sliders' values.
  private lastSliders: SliderWidgetConfig[] = []
  /**
   * #1344 — what the last SUCCESSFUL evaluate handed the repl to play, with the
   * seek and loop in force at that moment (the `.p` hook wrapped the pattern in
   * both). `renderLoadedReport` renders exactly this. Cleared by a failed
   * evaluate: the old pattern keeps playing, but it is no longer the document.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loadedRender: {
    pattern: any
    transportOffset: number
    loopRange: LoopRange | null
    /** #1648 — the tracks of this load, in document order (the `songPatterns` keys). */
    trackIds: string[]
    /** #1648 — false for a bare document: nothing went through `.p`, so nothing is tagged. */
    tagged: boolean
  } | null = null

  // Phase 20-07 (PK13 step 9) — engine-attached breakpoint registry.
  // Per-engine scope (PV33). The hit-check in `wrappedOutput` reads
  // `breakpointStore.has(irNodeId)` on the audio scheduler hot path.
  private breakpointStore: BreakpointStore = new BreakpointStore()
  // Phase 20-07 — engine-driven pause state. Mirrored to consumers via
  // `onPausedChanged` listeners. Set when the hit-check pauses the
  // scheduler (engine pauses ITSELF on hit) and via the public pause()
  // method. Idempotence guarded by setPaused().
  private isPausedState: boolean = false
  private pauseChangedListeners: Set<(paused: boolean) => void> = new Set()

  // #384 — transport seek offset, in cycles. The song position the user sees
  // is `scheduler.now() - transportOffset` (folded into the loop span when one
  // is armed — see `loopRange` below); `0` means normal playback (no
  // seek). Set by `setTransportOffset()` (the runtime's `seekTo` computes
  // `now - targetCycle`). Applied at the `.p` capture seam inside evaluate()
  // by wrapping the pattern with `.late(transportOffset)` — the IR-level
  // transport wrap — so the scheduler plays song-cycle `songPosition` at
  // wall-clock `now`. This is the ONLY place a time-shift touches
  // Pattern.prototype; the runtime must never do so (PV2 / P2 source-grep
  // guard). Exact only for stateless-cyclic patterns; state-accumulating
  // patterns seek approximately (documented edge, design §7.4).
  private transportOffset = 0

  // #1570 — the user's loop range, in SONG cycles, or `null` when the transport
  // runs straight through. Applied at the same `.p` capture seam as the seek
  // wrap, as `.ribbon(startCycle, cycles)` BEFORE the `.late()` — so the span
  // repeats natively, applied once when the range changes rather than on every
  // lap. (Looping by seeking would re-evaluate the whole document every few
  // seconds: `seekTo` ends in `play()`.)
  //
  // ⚠ `ribbon` re-bases the slice to cycle 0, so this field is only ever half a
  // decision: the transport offset that keeps song position song-absolute is the
  // other half, and `transportFrame.ts` owns the arithmetic that binds them.
  private loopRange: LoopRange | null = null

  // Phase 20-14 α-5 — tier flags read at boot. β-4 wires `midi` to call
  // enableWebMidi(); the other 7 (csound, tidal, osc, serial, gamepad,
  // motion, mqtt) land as one follow-up issue each. Mid-session toggle
  // changes are NOT picked up here — settings modal shows the "Changes
  // take effect on reload" caption.
  private tierFlags: TierFlags | null = null

  // Phase 20-14 β-2 — alias-resolution accumulator. Reset at `evaluate()`
  // entry; appended to by `wrappedOutput` whenever the alias map rewrites
  // a hap's `s` field. β-5's friendly-error builder reads this to surface
  // "tried alias `kick` → `bd` (resolved)" on a related error. Owned by
  // the engine instance (NOT module state) so concurrent engines don't
  // collide and a stale accumulator can't leak across evals.
  private lastAliasResolutions: Array<{ from: string; to: string }> = []

  // Phase 20-14 β-2 — live reference to superdough's `soundMap`. Captured
  // at init() (when `@strudel/webaudio` resolves). `wrappedOutput` reads
  // `soundMap.get()[name]` at trigger time to honour the Strategy A guard
  // — user-registered names always win over the curated alias map.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private soundMapRef: any = null

  /** Read-only snapshot of the tier flags consumed at this engine's init(). */
  getTierFlagsSnapshot(): Readonly<TierFlags> | null {
    return this.tierFlags
  }

  /**
   * #384 — set the transport seek offset (cycles). Does NOT re-evaluate by
   * itself: the runtime's `seekTo` calls this and then `play()`, whose
   * re-eval re-reads `transportOffset` and applies the `.late()` wrap at the
   * `.p` seam. Kept off the `LiveCodingEngine` interface (v1) and reached via
   * `(engine as any).setTransportOffset?.()` so non-Strudel engines no-op,
   * mirroring the pause/resume delegation convention.
   */
  setTransportOffset(offset: number): void {
    this.transportOffset = Number.isFinite(offset) ? offset : 0
  }

  /** #384 — current transport offset (cycles). `0` when no seek is active. */
  getTransportOffset(): number {
    return this.transportOffset
  }

  /**
   * #1570 — set the user's loop range (song cycles), or `null` to clear it.
   * Like `setTransportOffset`, this does NOT re-evaluate by itself: the
   * runtime's `setLoopRange` pairs it with a compensating transport offset and
   * then re-evals through the normal hot-swap, which re-reads both here and
   * applies them together at the `.p` seam.
   *
   * ⚠ THE PAIRING IS NOT OPTIONAL. `ribbon` re-bases the slice to cycle 0, so a
   * range set without the matching offset leaves the scheduler clock counting
   * loop-relative cycles while every readout is song-absolute. The arithmetic
   * that keeps them in one frame lives in `transportFrame.ts`, and both this
   * engine and the runtime read it rather than re-deriving it.
   *
   * Input is normalised here (not at the caller): an inverted or zero-length
   * drag becomes "no loop" rather than a wrap that cannot be heard.
   *
   * Kept off the `LiveCodingEngine` interface (v1) and reached via
   * `(engine as any).setLoopRange?.()` so non-Strudel engines no-op, mirroring
   * the `setTransportOffset` convention.
   */
  setLoopRange(range: { startCycle: number; cycles: number } | null): void {
    this.loopRange = normalizeLoopRange(range)
  }

  /** #1570 — the armed loop range, or `null` when the transport runs straight through. */
  getLoopRange(): LoopRange | null {
    return this.loopRange
  }

  /**
   * Phase 20-14 β-2 — read-only snapshot of alias rewrites that have fired
   * during the current evaluate() window. Each entry is one hap rewrite;
   * the same `from → to` pair may appear multiple times if the rewrite
   * fired across multiple cycles.
   *
   * Lifecycle: reset to empty at `evaluate()` entry, appended to by
   * `wrappedOutput`, read by friendlyErrors at message-build time.
   */
  getLastAliasResolutions(): ReadonlyArray<{ from: string; to: string }> {
    return this.lastAliasResolutions
  }

  /**
   * Initialise the engine, at most once, no matter how many callers overlap.
   *
   * The flag alone was not enough (#815). `initInternal` sets `initialized`
   * only at the very END of a long async body, so every caller that arrives
   * before that point passes the `if (this.initialized) return` gate and runs
   * the whole body — and the body assigns `this.repl` near its own end. With
   * several inits in flight the last one to finish wins, which is fine right up
   * until `play()` has already started the scheduler on an earlier repl: the
   * engine then holds a repl nobody started, while the abandoned one keeps
   * making sound. Measured in the real app as five concurrent inits on one
   * engine, a scheduler reporting `started === false` mid-playback, and no
   * playhead (#1185, #1171).
   *
   * A flag is a sequential guard. Mutual exclusion needs the in-flight promise
   * itself, so late callers join the run already happening instead of starting
   * their own.
   *
   * The rejection path clears the cached promise deliberately: a failed init
   * must not be remembered, or every later caller re-awaits the same failure
   * with no way to retry. Cleared here, the next `init()` starts a fresh
   * attempt — which is what `StrudelEngine.test.ts` pins.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.initInternal().catch((err: unknown) => {
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  private async initInternal(): Promise<void> {
    // Phase 20-14 α-5: tier-flag consume-at-init contract. Read ONCE here
    // and stash on the instance. β-4 (MIDI wiring) reads from
    // `this.tierFlags`. The dev-console log is the consumed-at-init
    // proof — α-5's Lokayata gate looks for it on reload.
    this.tierFlags = getTierFlags()
    // eslint-disable-next-line no-console
    console.log('[StrudelEngine] tierFlags read at init:', this.tierFlags)

    // #1215: one clock for the whole of boot, opened before the first await.
    // Every bounded step below draws from it, so no step — present or future —
    // can extend boot past `INIT_BUDGET_MS`. `required` rejects when it runs
    // out (there is no engine without those steps, and a rejection is
    // retryable); the manifest loader warns and degrades.
    const initRemaining = openBudget(INIT_BUDGET_MS)
    const required = createRequiredStep(initRemaining)
    const optional = createOptionalStep(initRemaining)

    // Load all strudel modules up-front so evalScope can register their
    // exports (note, s, gain, stack, etc.) into globalThis.  The eval'd user
    // code runs inside Function() with no special scope, so every function it
    // calls must be a global.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // #1215: bounded as ONE step. These are same-origin chunk requests, which
    // usually reject rather than hang — but a proxy, a captive portal or a
    // stuck service worker holds the connection open instead, and then this is
    // #1214 at a different await: unbounded, memoised, never rejecting.
    const [coreMod, miniMod, tonalMod, webaudioMod, soundfontsMod, xenMod, midiMod, mondoMod] = await required('strudel modules', () => Promise.all([
      import('@strudel/core') as Promise<any>,
      import('@strudel/mini') as Promise<any>,
      import('@strudel/tonal') as Promise<any>,
      import('@strudel/webaudio') as Promise<any>,
      import('@strudel/soundfonts') as Promise<any>,
      import('@strudel/xen') as Promise<any>,
      import('@strudel/midi') as Promise<any>,
      // Phase 20-14 α-1: audio-pure addition. Exposes `mondo`, `mondi`,
      // `mondolang`, `getLocations` on globalThis via evalScope. Verified
      // exports against upstream npm @strudel/mondo@1.1.6 (dist/mondough.mjs).
      // @strudel/edo (also called for by upstream loadModules at the pinned SHA)
      // is intentionally NOT added here — it is not yet published to npm
      // (registry.npmjs.org returns 404 for @strudel/edo on 2026-05-15).
      // Tracked as a follow-up when upstream publishes it.
      import('@strudel/mondo') as Promise<any>,
    ]))

    // Register all module exports into globalThis so eval'd patterns can use them
    // (note, s, gain, stack, etc. must be globals — user code runs in Function())
    // midi: uses onTrigger (additive) — highlighting still fires for every hap.
    //        enableWebMidi() is gated by the `midi` tier flag (β-4 below).
    //        The module import is unconditional (80 KB, audio-pure); only
    //        the permission-triggering call is gated.
    // drawMod (@strudel/draw) intentionally excluded: it injects a full-screen canvas
    // into document.body (id="test-canvas") the first time any draw function runs.
    // Stave uses its own visualizer system, so strudel's canvas draw functions
    // (pianoroll, drawFrequencyScope, etc.) are not exposed to user code.
    // #345 — `slider(…)`: the transpiler rewrites it to `sliderWithID`, which Strudel
    // ships in its CodeMirror package; the two functions are vendored instead.
    await required('evalScope', () =>
      coreMod.evalScope(coreMod, miniMod, tonalMod, webaudioMod, soundfontsMod, xenMod, midiMod, mondoMod, sliderFunctions(coreMod)),
    )

    // Phase 20-14 β-4: thread the `midi` tier flag through engine init.
    // When the flag is ON, call `enableWebMidi()` after evalScope resolves so
    // `Pattern.prototype.midi` and the WebMIDI hookup go live. The browser
    // permission prompt fires during init (early-prompt UX per RESEARCH §4 +
    // CONTEXT gray-area #3) — the settings row caption telegraphs this so
    // the user opts in deliberately.
    //
    // When the flag is OFF (default), the call is skipped — preserves the
    // pre-α behavior where `@strudel/midi` was loaded but no permission
    // prompt fired. The other 7 tier flags (csound/tidal/osc/serial/gamepad/
    // motion/mqtt) are NOT threaded here — each has its own follow-up issue
    // (#124-#130) from β-3.
    if (this.tierFlags?.midi) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enableWebMidi = (midiMod as any)?.enableWebMidi
      if (typeof enableWebMidi === 'function') {
        // #1215: bounded, and this is the likeliest hang in the whole function
        // even though the issue did not list it. `enableWebMidi()` raises a
        // browser permission prompt, and a user who simply never answers it
        // leaves the promise pending forever — boot then waits on a dialog
        // nobody is looking at. The try/catch that used to sit here caught a
        // DENIAL, which was never the dangerous case: a denial rejects, and a
        // rejection is survivable. Silence is not.
        await optional('enableWebMidi', () => enableWebMidi())
      } else {
        console.warn('[StrudelEngine] tierFlags.midi is ON but @strudel/midi did not export enableWebMidi.')
      }
    }

    // Set up mini-notation string parser (parses "c3 e3 g3" strings as patterns).
    //
    // NOT `miniAllStrings()`, which installs `mini` bare and makes it throw on any string
    // that is not mini notation — `s('bd').label('🍕')` and single-quoted bytebeat source
    // are both real, and both took the whole evaluation down (#1018). The shared
    // installer falls back to the plain value instead, so a single-quoted mini still
    // pattern-parses and a single-quoted anything-else stays what it was.
    installMiniStringParser({ core: coreMod as never, mini: miniMod as never })

    // Transpiler converts $: pattern syntax → pattern.p("$") and handles
    // mini-notation template literals. Required for $: to work correctly.
    const { transpiler } = await required('@strudel/transpiler', () => import('@strudel/transpiler'))

    const { initAudio, getAudioContext, webaudioOutput, webaudioRepl } = webaudioMod

    // #1215: `initAudio`'s worklet is a data: URL in our bundle, so it is NOT a
    // network wait — that part of the issue's premise did not survive checking.
    // It is bounded anyway because it awaits `audioContext.resume()`, which can
    // sit pending when the context cannot start, and because the point of a
    // budget is that it does not depend on today's inventory of what inside it
    // might block.
    await required('initAudio', () => initAudio())
    // Register built-in oscillator synths (sine, sawtooth, square, triangle, user, one)
    // and noise generators (pink, white, brown, crackle).
    // Without this, superdough throws "sound sine not found! Is it loaded?"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(webaudioMod as any).registerSynthSounds()
    // Register ZZFX procedural sounds (zzfx, z_sine, z_sawtooth, z_triangle, z_square, z_tan, z_noise).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(webaudioMod as any).registerZZFXSounds()
    // Register all 128 GM soundfont instruments (piano, bass, guitar, strings, etc.).
    // Fonts are lazy-loaded from felixroos.github.io/webaudiofontdata on first use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(soundfontsMod as any).registerSoundfonts()
    // Load Dirt-Samples manifest so bd, hh, sd, cp, rim, cr, rd etc. resolve at runtime.
    // Individual samples are lazy-loaded on first play; only the index JSON is fetched here.
    // Worklet-based effects (crush, coarse, distort, djf, bytebeat) are loaded by initAudio() above.
    // #1214/#1217: every manifest load below goes through ONE budget, opened
    // here. Individually bounding each fetch was not enough — the loads are
    // sequential, so per-call ceilings add up when more than one host is
    // unreachable. The clock has to start before the first of them.
    const bounded = createOptionalStep(initRemaining, openBudget(MANIFEST_BUDGET_MS))
    // #1214: bounded. This was the specific call that wedged boot — it was also
    // the only manifest load here with no protection at all, while every b-cdn
    // sibling below at least had a catch. The catch was never the missing part.
    await bounded('Dirt-Samples', () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (webaudioMod as any).samples('github:tidalcycles/Dirt-Samples/master'),
    )

    // Phase 20-14 α-2: mirror upstream `prebake.mjs` sample-manifest fetches.
    // Upstream b-cdn manifests unlock `s("piano")` (Salamander), `.bank("tr909")`
    // (tidal-drum-machines), uzu-drumkit/wavetables, mridangam, VCSL orchestra,
    // and the inline Dirt-Samples bank set (casio/crow/insect/wind/jazz/metal/
    // east/space/numbers/num). See upstream prebake.mjs lines 25-155 at SHA
    // f73b395648645aabe699f91ba0989f35a6fd8a3c.
    //
    // Each samples() call is wrapped in try/catch so a b-cdn outage does NOT
    // break engine boot — the previously-loaded Dirt-Samples + synths still
    // serve unaffected. Documented as accepted risk in 20-14-PLAN.md §6.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const samplesFn = (webaudioMod as any).samples
    const baseCDN = 'https://strudel.b-cdn.net'  // upstream prebake.mjs:11
    // #1214: was try/catch only. A catch is blind to a request that never
    // answers, and every one of these calls could wedge boot the same way the
    // Dirt-Samples index did. They now share the budget opened above.
    const safeSamples = bounded
    await Promise.all([
      // Salamander piano — unlocks `s("piano")`. Closes the symptom of issue #110.
      safeSamples('piano', () => samplesFn(`${baseCDN}/piano.json`, `${baseCDN}/piano/`, { prebake: true })),
      // VCSL orchestral library (CC0).
      safeSamples('vcsl', () => samplesFn(`${baseCDN}/vcsl.json`, `${baseCDN}/VCSL/`, { prebake: true })),
      // tidal-drum-machines — unlocks `.bank("tr909")`, `.bank("RolandTR808")`, etc.
      safeSamples('tidal-drum-machines', () => samplesFn(`${baseCDN}/tidal-drum-machines.json`, `${baseCDN}/tidal-drum-machines/machines/`, { prebake: true, tag: 'drum-machines' })),
      // uzu-drumkit — extra drum banks.
      safeSamples('uzu-drumkit', () => samplesFn(`${baseCDN}/uzu-drumkit.json`, `${baseCDN}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' })),
      // uzu-wavetables — wavetable synth fodder.
      safeSamples('uzu-wavetables', () => samplesFn(`${baseCDN}/uzu-wavetables.json`, `${baseCDN}/uzu-wavetables/`, { prebake: true })),
      // mridangam — percussion bank.
      safeSamples('mridangam', () => samplesFn(`${baseCDN}/mridangam.json`, `${baseCDN}/mrid/`, { prebake: true, tag: 'drum-machines' })),
      // Inline Dirt-Samples categories (casio/crow/insect/wind/jazz/metal/east/
      // space/numbers/num) served from b-cdn. Upstream prebake.mjs:42-155.
      // The earlier `github:tidalcycles/Dirt-Samples/master` call (above) registers
      // bd/hh/sd/etc.; soundMap.setKey overwrites on duplicate so this call wins
      // for shared keys — matches upstream behavior (RESEARCH §1c).
      safeSamples('dirt-extras', () => samplesFn({
        casio: ['casio/high.wav', 'casio/low.wav', 'casio/noise.wav'],
        crow: ['crow/000_crow.wav', 'crow/001_crow2.wav', 'crow/002_crow3.wav', 'crow/003_crow4.wav'],
        insect: [
          'insect/000_everglades_conehead.wav',
          'insect/001_robust_shieldback.wav',
          'insect/002_seashore_meadow_katydid.wav',
        ],
        wind: [
          'wind/000_wind1.wav', 'wind/001_wind10.wav', 'wind/002_wind2.wav', 'wind/003_wind3.wav',
          'wind/004_wind4.wav', 'wind/005_wind5.wav', 'wind/006_wind6.wav', 'wind/007_wind7.wav',
          'wind/008_wind8.wav', 'wind/009_wind9.wav',
        ],
        jazz: [
          'jazz/000_BD.wav', 'jazz/001_CB.wav', 'jazz/002_FX.wav', 'jazz/003_HH.wav',
          'jazz/004_OH.wav', 'jazz/005_P1.wav', 'jazz/006_P2.wav', 'jazz/007_SN.wav',
        ],
        metal: [
          'metal/000_0.wav', 'metal/001_1.wav', 'metal/002_2.wav', 'metal/003_3.wav',
          'metal/004_4.wav', 'metal/005_5.wav', 'metal/006_6.wav', 'metal/007_7.wav',
          'metal/008_8.wav', 'metal/009_9.wav',
        ],
        east: [
          'east/000_nipon_wood_block.wav', 'east/001_ohkawa_mute.wav', 'east/002_ohkawa_open.wav',
          'east/003_shime_hi.wav', 'east/004_shime_hi_2.wav', 'east/005_shime_mute.wav',
          'east/006_taiko_1.wav', 'east/007_taiko_2.wav', 'east/008_taiko_3.wav',
        ],
        space: [
          'space/000_0.wav', 'space/001_1.wav', 'space/002_11.wav', 'space/003_12.wav',
          'space/004_13.wav', 'space/005_14.wav', 'space/006_15.wav', 'space/007_16.wav',
          'space/008_17.wav', 'space/009_18.wav', 'space/010_2.wav', 'space/011_3.wav',
          'space/012_4.wav', 'space/013_5.wav', 'space/014_6.wav', 'space/015_7.wav',
          'space/016_8.wav', 'space/017_9.wav',
        ],
        numbers: [
          'numbers/0.wav', 'numbers/1.wav', 'numbers/2.wav', 'numbers/3.wav', 'numbers/4.wav',
          'numbers/5.wav', 'numbers/6.wav', 'numbers/7.wav', 'numbers/8.wav',
        ],
        num: [
          'num/00.wav', 'num/01.wav', 'num/02.wav', 'num/03.wav', 'num/04.wav', 'num/05.wav',
          'num/06.wav', 'num/07.wav', 'num/08.wav', 'num/09.wav', 'num/10.wav', 'num/11.wav',
          'num/12.wav', 'num/13.wav', 'num/14.wav', 'num/15.wav', 'num/16.wav', 'num/17.wav',
          'num/18.wav', 'num/19.wav', 'num/20.wav',
        ],
      }, `${baseCDN}/Dirt-Samples/`, { prebake: true })),
    ])

    // Phase 20-14 α-3: aliasBank() registers 69 bank-name aliases (e.g.
    //   RolandTR909 → 909, KorgKR55 → KR55) so users can spell drum-machine
    //   banks the way upstream tunes do. See upstream prebake.mjs:158.
    //
    // Merge-vs-replace semantics (RESEARCH §3 open question #3):
    //   superdough/superdough.mjs:86-117 (aliasBankMap) reads the current
    //   soundMap.get() dictionary, MUTATES it in place to add aliased keys
    //   (e.g. `909_bd` aliased from `RolandTR909_bd`), then calls
    //   soundMap.set({...soundDictionary}). That spread is a SHALLOW MERGE
    //   of the same dict back onto itself plus the new alias keys — so the
    //   post-aliasBank count is monotonically ≥ the pre-count. We log
    //   BEFORE/AFTER to make the contract observable; α-7 SUMMARY pins this.
    //
    // Wrapped in try/catch for the same boot-resilience reason as α-2.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const soundMapRef = (webaudioMod as any).soundMap
    // β-2 — stash the live soundMap on the instance so wrappedOutput's
    // Strategy A guard can read it at trigger time. Live read (not snapshot);
    // user `samples()` calls between init and trigger should be honored.
    this.soundMapRef = soundMapRef
    // #804 — expose the live registry on globalThis so the app's instrument-
    // picker bridge (StaveApp `readDict`) can enumerate the FULL ~1852 sounds,
    // not just the curated 78 in soundCatalog.ts. Superdough keeps `soundMap`
    // module-scoped and never publishes it; this mirrors vanilla strudel.cc's
    // `window.soundMap`. The picker's own poll (StaveApp) notices the count
    // rise and refreshes. Live ref, not a snapshot — later `samples()` calls
    // keep flowing through.
    if (soundMapRef) {
      ;(globalThis as unknown as { soundMap?: unknown }).soundMap = soundMapRef
    }
    const preAliasCount = soundMapRef?.get ? Object.keys(soundMapRef.get()).length : 0
    // #1214: no try/catch here any more, and its absence is the point —
    // the bounded loader already swallows and warns, so a catch around it could
    // never fire. Leaving one in place would read as live protection at exactly
    // the site whose real hazard is a request that never answers at all.
    await bounded('tidal-drum-machines aliases', () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (webaudioMod as any).aliasBank(`${baseCDN}/tidal-drum-machines-alias.json`),
    )
    const postAliasCount = soundMapRef?.get ? Object.keys(soundMapRef.get()).length : 0
    // Dev-only observation log — α-7 SUMMARY cites this for the merge-vs-replace
    // gate. Drop noisily if a future review wants quieter boot — keep the
    // observation visible until structural parity ships.
    console.log(`[StrudelEngine] aliasBank: soundMap keys ${preAliasCount} → ${postAliasCount} (Δ ${postAliasCount - preAliasCount}; expect non-negative)`)

    // Snapshot all registered sound names (synths + Dirt-Samples) for editor autocompletion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const soundMapData: Record<string, unknown> = (webaudioMod as any).soundMap?.get() ?? {}
    this.loadedSoundNames = Object.keys(soundMapData).filter(k => !k.startsWith('_'))
    this.audioCtx = getAudioContext()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const audioCtx = this.audioCtx!
    // #1987 — the context was made at boot, before any gesture, so it is suspended and
    // nothing upstream resumes it. A Play pressed before this line had no context to
    // ask; the next touch or key does.
    this.stopAskingForAudio?.()
    this.stopAskingForAudio = startAudioOnNextGesture(audioCtx)

    // Tap superdough's master output for analysis.
    // connectToDestination() wires a node as a SOURCE into superdough's mix — wrong for
    // an analyser because nothing feeds into the analyser's INPUT, so it sees silence.
    // Correct approach: get the master destinationGain and connect it → analyserNode
    // as a side-tap. Audio still flows unchanged to audioCtx.destination.
    this.analyserNode = audioCtx.createAnalyser()
    this.analyserNode.fftSize = 2048
    this.analyserNode.smoothingTimeConstant = 0.8
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioController = (webaudioMod as any).getSuperdoughAudioController()
    this.audioController = audioController
    audioController.output.destinationGain.connect(this.analyserNode)
    // Track which destinationGain the analyser taps, so `followMasterAnalyser`
    // can DETACH this connection if the node is ever replaced (superdough swaps
    // it on every evaluate) and re-tap the live one — otherwise the analyser sums
    // a stale node and the master meter freezes.
    this.taggedDestinationGain = audioController.output.destinationGain
    // Keep the controller GETTER (not just the cached controller): superdough has
    // one GLOBAL controller (setSuperdoughAudioController). In dev, React Strict
    // Mode mounts two engines → two cached controllers, but only the global one
    // is live. The master meter must always tap the GLOBAL destinationGain, so we
    // resolve it fresh on every re-tap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.superdoughControllerFn = (webaudioMod as any).getSuperdoughAudioController ?? null
    // #2058 — Stave's superdough patch: stops every sound still playing (Stop).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.stopAllSoundsFn = (webaudioMod as any).stopAllSounds ?? null

    // Wrap the native output trigger so we can fan events to HapStream subscribers
    const hapStream = this.hapStream
    const audioCtxRef = audioCtx

    // Strudel's scheduler calls: onTrigger(hap, deadline, duration, cps, t)
    // (cyclist.mjs:64-71). NOTE the signature is the inverse of what the
    // names suggest:
    //   deadline = targetTime − phase — a small RELATIVE lookahead (~latency
    //              0.1s), flagged "dumb and only here for backwards
    //              compatibility" upstream. NOT an absolute time.
    //   duration = note duration in seconds
    //   cps = cycles per second
    //   t = targetTime — the ABSOLUTE AudioContext time the note sounds.
    // HapStream wants the absolute play-time as its 2nd arg (it stores it as
    // `audioTime` and derives `scheduledAheadMs = (it − currentTime)`), so we
    // pass `t`, NOT `deadline` (#512: passing the relative deadline made
    // scheduledAheadMs grow hugely negative with session uptime).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedOutput = async (hap: any, deadline: number, duration: number, cps: number, t: number) => {
      perf.inc('audio.triggers') // #228 — scheduler event throughput (rate = count/uptime)
      // Phase 20-14 β-2 — Strategy A sound-alias intercept. We are POST-
      // reify (P1): `hap.value.s` is the final per-event string Strudel's
      // scheduler resolved. If the bare name is not in the live soundMap
      // AND the curated alias map has a target, rewrite the hap so
      // superdough sees the canonical name. User-registered names ALWAYS
      // win (RESEARCH §3 + §7 open-question #4). Sub-microsecond per hap
      // (one Map.get + one Object index lookup); negligible vs scheduler
      // overhead.
      // #1635 — the same step the offline render applies (`renderPatternReport`),
      // so a name like `kick` sounds the same live and in a bounce. Live read of
      // the sound map: user `samples(...)` calls between init and trigger count.
      // The step returns a shallow copy, so consumers that snapshot the original
      // hap reference see a stable shape.
      if (hap) {
        const aliased = aliasSoundValue(hap.value, this.soundMapRef?.get?.() ?? undefined)
        if (aliased.resolution) {
          this.lastAliasResolutions.push(aliased.resolution)
          hap.value = aliased.value
        }
      }

      // Phase 20-07 (T-α-2) — emit returns the enriched HapEvent so the
      // breakpoint hit-check below reads `irNodeId` in O(1) without
      // re-running findMatchedEvent. P50 single-strategy match preserved.
      // #1621 — the declared spans too, read at emit time like the lookup, so the
      // highlighter, the hit-check and the Inspector pulse see document offsets only.
      const enriched = hapStream.emit(hap, t, duration, cps, audioCtxRef.currentTime, this.lastIRNodeLocLookup ?? undefined, this.lastDeclaredLocations ?? undefined)

      // Phase 20-07 (PK13 step 9 / DEC-AMENDED-3) — breakpoint hit-check.
      // PERF: O(1) Set.has() on the audio scheduler hot path; do NOT
      // extend to predicate evaluation here (D-03 forbids).
      // Order: emit fired ABOVE so the user SEES which row caused the
      // break before the scheduler pauses (DEC-AMENDED-3). PV37 alignment
      // — undefined `irNodeId` never hits.
      if (enriched.irNodeId && this.breakpointStore.has(enriched.irNodeId)) {
        this.repl?.scheduler?.pause()  // ← pause, NOT stop (DEC-AMENDED-1; cyclist.mjs:112-116 vs :117-122)
        this.setPaused(true)
        return  // skip audio dispatch — synchronous early return
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // #1656 — tracked until it settles, so a render can wait for it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // #1348 — a note handed over after its start time is DROPPED: superdough
        // warns and returns (`superdough.mjs:462-466`). That check runs before
        // superdough's first `await`, i.e. synchronously inside this very call,
        // so the same comparison here counts exactly the notes it drops.
        if (t < audioCtxRef.currentTime) this.lateNotes++
        const triggered = (webaudioOutput as any)(hap, deadline, duration, cps, t) as Promise<unknown>
        this.liveTriggers.track(Promise.resolve(triggered), t)
        return await triggered
      } catch (err) {
        // Route scheduler-time errors (e.g. "sound X not found", "cannot parse as numeral")
        // through the registered handler so they surface in the editor UI, not just the console.
        const error = err instanceof Error ? err : new Error(String(err))
        // A "no soundfont zone found" throw means this note's pitch fell outside the
        // loaded instrument's sampled key-range. Upstream drops the preset + pitch
        // from the message (`new Error(msg, name, ...)` ignores extra args —
        // @strudel/soundfonts/fontloader.mjs:87), so the raw message is empty and
        // useless. We still hold the offending `hap` here, so recover the note +
        // instrument from it and rewrite the message into something actionable (#561).
        if (isSoundfontZoneError(error.message)) {
          const better = soundfontRangeMessage(hap?.value)
          if (better) error.message = better
          // The hap's own `loc` is unreliable for these (chord members collapse
          // to a degenerate offset — observed all → offset 1, #567). Instead tag
          // the error with the offending INSTRUMENT so the app can locate the
          // owning track's line via `statementOffsetForSource` (the stack itself
          // is bundle-only). Read in StrudelEditorClient's onError.
          const instrument = hap?.value?.s
          if (typeof instrument === 'string') {
            ;(error as Error & { staveLocateSource?: string }).staveLocateSource = instrument
          }
        }
        this.runtimeErrorHandler?.(error)
      }
    }

    // #2175 — note what each evaluate transpiles, so on an error the same code
    // can be transpiled again with a source map (only then: no cost per eval).
    this.evalFrame = await measureEvalFrame()
    this.repl = webaudioRepl({
      transpiler: (code: string, options: Record<string, unknown> = {}) => {
        this.lastTranspile = { code, options, run: (o) => transpiler(code, o) }
        return transpiler(code, options)
      },
      defaultOutput: wrappedOutput,
      onEvalError: (err: Error) => {
        this.evalResolve?.({ error: err })
        this.evalResolve = null
      },
    })
    // #1348 — count the notes a late scheduler tick drops. See `watchSkippedTicks`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    watchSkippedTicks((this.repl as any).scheduler, (n) => { this.lateNotes += n }, this.schedulerQuery)
    // #2173 — an error raised while the played pattern is queried (a bad
    // `.scale()` name, a callback that throws) is caught by Strudel and only
    // logged, so it never reached the Console. Raise the ones logged during
    // the scheduler's own query through the runtime error handler, like a
    // trigger error. Anything logged outside one — a visualiser's query, the
    // quiet timeline evaluate while typing (#1172) — stays out.
    this.stopListeningForPlayErrors?.()
    this.stopListeningForPlayErrors = listenForPlayTimeErrors(
      STRUDEL_LOG_EVENT,
      this.schedulerQuery,
      (error) => this.runtimeErrorHandler?.(error),
    )

    // Phase 20-14 α-4: vendor upstream `piano.mjs` chain method. Side-effect
    // import — attaches Pattern.prototype.piano once at boot. evalScope
    // populated Pattern on globalThis ~200 lines above, so by here the
    // prototype exists to extend. NOT re-imported per evaluate (UV2 / P2
    // safe — `.piano` is not in the injectPatternMethods overwrite list).
    await import('./vendored/piano')

    this.initialized = true
  }

  async evaluate(code: string): Promise<{ error?: Error }> {
    if (!this.initialized) await this.init()
    // #1731 — an evaluate rebuilds the per-track analysers against superdough's
    // CURRENT controller, which during a display render is the offline one. So
    // it waits for any display render to let go (at most one render window), and
    // a successful one re-fingerprints the tracks that render draws.
    return this.trackEnvelopes.exclusive(async () => {
      const result = await this.evaluateCode(code)
      if (!result.error) this.trackEnvelopes.evaluated()
      return result
    })
  }

  private async evaluateCode(code: string): Promise<{ error?: Error }> {
    this.lastEvaluatedCode = code
    // Phase 20-14 β-2 — reset alias-resolution accumulator at the entry
    // of every evaluate(). β-5's friendly-error builder reads this; a
    // stale accumulator from a previous eval would surface aliases that
    // are unrelated to the current error. Reset must be the FIRST
    // statement after lastEvaluatedCode, NOT buried in a helper.
    this.lastAliasResolutions = []

    const capturedPatterns = new Map<string, any>() // eslint-disable-line @typescript-eslint/no-explicit-any
    // #863 — the same patterns in the SONG frame (pre-`.late` seek wrap).
    const capturedSongPatterns = new Map<string, any>() // eslint-disable-line @typescript-eslint/no-explicit-any
    const capturedVizRequests = new Map<string, string>()
    // Per-track viz options from a `.pianoroll({ ... })` / `._pianoroll({ ... })`
    // argument, keyed by captureId — flows to the renderer's `stave.options`.
    const capturedVizOptions = new Map<string, Record<string, unknown>>()
    // Backdrop viz requested via a non-underscore method this evaluate.
    // Singular (last `.scope()`/`.pianoroll()` call wins); set directly by
    // the method wrappers below via this closure, independent of `.p()`
    // capture so a bare top-level `.scope()` still registers.
    let capturedBackdropViz: string | null = null
    let capturedBackdropVizOptions: Record<string, unknown> | null = null
    // #571 — fallback for an inline viz request (`.viz()` / `._pianoroll()` …)
    // that ISN'T the terminal chain call. The request is tagged on the returned
    // Pattern instance (`_pendingViz`), but Strudel patterns are immutable so any
    // method AFTER it (`.gain()`, `.sound()`, …) returns a fresh instance that
    // drops the tag, and the transpiler-appended `.p()` then sees nothing. The
    // viz wraps also record the LATEST request here (latest-wins, matching "last
    // viz in the chain wins"); `.p()` snapshots + clears it at every track
    // boundary so it's recovered for this track and never leaks to the next.
    let pendingChainViz: string | null = null
    let pendingChainVizOptions: Record<string, unknown> | null = null
    let anonIndex = 0
    // Auto-orbit counter: each captured $: block with a .viz() request but no
    // explicit .orbit(N) gets its own unique orbit number starting high enough
    // that it won't collide with user-set orbits (typically 1..8). Without this
    // every viz defaults to orbit 1 and every inline viz shows the master mix
    // rather than its own track. Numbers ≥ 100 + captureId keep the mapping
    // stable across evaluates.
    let autoOrbitNext = 100
    // #384 — snapshot the seek offset for this evaluate. `this` is the engine
    // here (evaluate's body); the `.p` value function below closes over this
    // const, so each re-eval (every play()/seekTo) applies the current offset.
    const transportOffset = this.transportOffset
    // #1570 — snapshot the loop range for this evaluate, beside the seek offset
    // and for the same reason: the `.p` value function below closes over both,
    // so one re-eval applies the pair the runtime decided together.
    const loopRange = this.loopRange
    const probeExplicitOrbit = (pat: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        const haps = pat.queryArc(0, 1)
        for (const h of haps) {
          if (h?.value?.orbit !== undefined) return true
        }
        // Also check a longer window — slow patterns may not have a hap in the first cycle.
        const more = pat.queryArc(0, 4)
        for (const h of more) {
          if (h?.value?.orbit !== undefined) return true
        }
      } catch { /* silent patterns throw or return empty */ }
      return false
    }

    // Dynamic import — Pattern is from @strudel/core which is already loaded after init()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Pattern } = await import('@strudel/core') as any

    // Save current descriptor (may be value descriptor from previous injectPatternMethods)
    const savedDescriptor = Object.getOwnPropertyDescriptor(Pattern.prototype, 'p')
    const savedVizDescriptor = Object.getOwnPropertyDescriptor(Pattern.prototype, 'viz')

    // Strudel-official viz methods (see STRUDEL_VIZ_METHODS). Both chain
    // forms of every name are intercepted below; we save the prior
    // descriptors (some non-underscore forms are live @strudel/webaudio
    // methods) so they restore cleanly after evaluate.
    const savedLegacyDescriptors = new Map<string, PropertyDescriptor | undefined>()

    // Install setter trap — fires when injectPatternMethods does Pattern.prototype.p = fn
    // This intercepts the assignment so we can wrap Strudel's fn with our capturing logic.
    // IMPORTANT: .viz() and legacy method wrappers are installed INSIDE this setter,
    // AFTER injectPatternMethods finishes — because injectPatternMethods overwrites
    // any .viz() we install beforehand (Strudel has its own .viz() from @strudel/draw).
    Object.defineProperty(Pattern.prototype, 'p', {
      configurable: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set(strudelFn: (id: string) => any) {
        // NOW install .viz() wrapper — after injectPatternMethods has set Strudel's .viz()
        // Wrap Strudel's existing .viz() so it still renders, but also capture the viz name.
        const strudelViz = Pattern.prototype.viz // eslint-disable-line @typescript-eslint/no-explicit-any
        Object.defineProperty(Pattern.prototype, 'viz', {
          configurable: true,
          writable: true,
          value: function(this: any, vizName: any, opts?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
            // Extract viz name — see `extractVizName` for the full
            // explanation of Strudel's reify-induced shapes. Pure
            // helper exported for unit testing.
            const resolvedName = extractVizName(vizName)
            const optsObj =
              opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : null
            // #364 (350b): `.viz('name', { backdrop: true })` promotes the
            // viz to the BACKDROP slot — a code-override source alongside the
            // non-underscore `.scope()`/`.pianoroll()` forms below — instead of
            // an inline view-zone. Sets the SAME `capturedBackdropViz` closure
            // those methods use; the app's handleCodeBackdropChange →
            // setBackgroundOverride (#363) then makes it an active-pane override.
            // opacity/quality ride along in the options bag → backdropRequest.options
            // (per-pane application is #365). We still chain to Strudel's `.viz()`
            // for parity but DELIBERATELY do not tag `_pendingViz`, so the `.p()`
            // wrapper never registers an inline request for a backdrop viz.
            // G3: in a NON-active program this only mutates the closure, which the
            // singular engine commits for the active evaluate alone → effectively a
            // no-op until that program is active. `.viz('name')` (no flag) stays inline.
            if (resolvedName && optsObj && optsObj.backdrop === true) {
              capturedBackdropViz = resolvedName
              capturedBackdropVizOptions = optsObj
              return strudelViz ? strudelViz.call(this, vizName) : this
            }
            // Chain to Strudel's .viz() if it exists
            const result = strudelViz ? strudelViz.call(this, vizName) : this
            // Tag the RETURNED pattern with the resolved viz name
            if (resolvedName) {
              result._pendingViz = resolvedName
              pendingChainViz = resolvedName // #571 — survive non-terminal chains
            }
            // Carry the `.viz(name, {...})` options object so the `.p()` wrapper
            // keys it to this track's captureId → stave.options — the same path
            // `._pianoroll({...})` uses. Without this, `.viz` options were
            // silently dropped (#215).
            if (opts && typeof opts === 'object') {
              result._pendingVizOptions = opts
              pendingChainVizOptions = opts as Record<string, unknown> // #571
            }
            return result
          },
        })

        // Install Strudel-official viz method wrappers AFTER injectPatternMethods.
        // For each official viz name we intercept BOTH chain forms so pasted
        // Strudel code works out of the gate:
        //   - `._name()` (underscore) → inline viz zone  (tags `_pendingViz`,
        //      read by the `.p()` wrapper below → capturedVizRequests)
        //   - `.name()`  (non-underscore) → Stave backdrop  (sets the
        //      `capturedBackdropViz` closure directly; does not depend on `.p()`)
        // Neither form chains to Strudel's real method: `@strudel/draw` isn't
        // loaded, and the live webaudio `scope`/`spectrum`/`fscope` would draw
        // strudel's fullscreen `#test-canvas`. Returning `this` keeps the chain
        // intact while Stave renders the viz its own way.
        for (const [name, renderer] of Object.entries(STRUDEL_VIZ_METHODS)) {
          // Underscore form → inline viz zone.
          const underscore = `_${name}`
          savedLegacyDescriptors.set(underscore, Object.getOwnPropertyDescriptor(Pattern.prototype, underscore))
          Object.defineProperty(Pattern.prototype, underscore, {
            configurable: true,
            writable: true,
            value: function(this: any, opts?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
              this._pendingViz = renderer
              pendingChainViz = renderer // #571 — survive non-terminal chains
              // Carry the `.pianoroll({...})` argument so the `.p()` wrapper
              // can key it to this track's captureId → stave.options.
              if (opts && typeof opts === 'object') {
                this._pendingVizOptions = opts
                pendingChainVizOptions = opts as Record<string, unknown> // #571
              }
              return this
            },
          })
          // Non-underscore form → backdrop (Strudel's "big"/fullscreen form).
          savedLegacyDescriptors.set(name, Object.getOwnPropertyDescriptor(Pattern.prototype, name))
          Object.defineProperty(Pattern.prototype, name, {
            configurable: true,
            writable: true,
            value: function(this: any, opts?: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
              capturedBackdropViz = renderer
              capturedBackdropVizOptions = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : null
              return this
            },
          })
        }

        // Wrap Strudel's .p() fn with our capturing logic
        Object.defineProperty(Pattern.prototype, 'p', {
          configurable: true,
          writable: true,
          value: function (this: any, id: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
            // #571 — snapshot + clear the chain-viz fallback at EVERY `.p()`
            // boundary (incl. `_`-muted tracks whose capture is skipped below),
            // so a mid-chain `.viz()` on THIS statement is recovered here and
            // never leaks to the next track.
            const chainViz = pendingChainViz
            const chainVizOptions = pendingChainVizOptions
            pendingChainViz = null
            pendingChainVizOptions = null
            if (typeof id === 'string' && !(id.startsWith('_') || id.endsWith('_'))) {
              let captureId = id
              if (id.includes('$')) {
                captureId = `$${anonIndex}`
                anonIndex++
              }

              // Resolve pending .viz() request — .viz() fires BEFORE .p() in chain.
              // The instance tag is exact for a TERMINAL `.viz()`; the closure
              // fallback (chainViz) recovers a `.viz()` followed by more chain
              // methods, which drop the tag on Strudel's immutable patterns (#571).
              let vizName: string = ''
              if (this._pendingViz && typeof this._pendingViz === 'string') {
                vizName = this._pendingViz
                capturedVizRequests.set(captureId, vizName)
                delete this._pendingViz
              } else if (chainViz) {
                vizName = chainViz
                capturedVizRequests.set(captureId, vizName)
              }
              // Resolve pending viz options (`.pianoroll({...})` argument).
              if (this._pendingVizOptions && typeof this._pendingVizOptions === 'object') {
                capturedVizOptions.set(captureId, this._pendingVizOptions as Record<string, unknown>)
                delete this._pendingVizOptions
              } else if (chainVizOptions) {
                capturedVizOptions.set(captureId, chainVizOptions)
              }

              // Per-track audio isolation: strudel's default orbit is 1, so every
              // $: block without an explicit .orbit(N) call lands on the SAME
              // superdough Orbit. That makes every inline viz see the master mix
              // rather than its own track. For captured blocks that have a .viz()
              // request and NO user-set orbit, wrap the pattern with a unique
              // auto-orbit so it routes through its own Orbit node — which is
              // what StrudelEngine.rebuildTrackAnalysers() side-taps.
              let effectivePattern = this
              if (vizName && typeof this.orbit === 'function' && !probeExplicitOrbit(this)) {
                const autoOrbit = autoOrbitNext++
                try { effectivePattern = this.orbit(autoOrbit) } catch { /* fall back to this */ }
              }
              // #384 — transport seek. Shift the whole captured pattern in time
              // so the scheduler plays song-cycle `now - transportOffset` at
              // wall-clock `now`. `.late(offset)` delays onsets by `offset`
              // cycles (negative = seek forward, i.e. `.early`). Applied AFTER
              // the auto-orbit wrap so routing is preserved, and to the SAME
              // `effectivePattern` used for both audio (`strudelFn.call`) and
              // capture (viz/timeline queryArc) — keeping every consumer in one
              // coherent scheduler frame. Guarded: only when seeking, and only
              // if `.late` is present (registered @strudel/core; exotic
              // patterns may lack it → keep unshifted). PV2: this time-shift on
              // Pattern.prototype lives engine-side only.
              // #863 — the SONG-frame pattern is the one BEFORE the seek wrap:
              // its cycle 0 is the start of the song, which is the axis the Song
              // timeline's static marks (and the IR lanes they sit in) are drawn
              // on. Captured post-orbit so both frames route identically.
              capturedSongPatterns.set(captureId, effectivePattern)
              // #1570 — the LOOP wrap. `.ribbon(start, cycles)` cuts the span
              // and repeats it natively, so the loop costs ONE re-eval when the
              // range changes rather than a hot-swap per lap (which is what
              // looping via `seekTo` would cost — it ends in `play()`).
              //
              // Placed AFTER the song-frame capture above and BEFORE the seek
              // wrap below, and both placements are load-bearing:
              //   · after the capture, because the ribbon folds song time onto
              //     itself — marks read from a ribboned pattern would repeat the
              //     looped bars across the whole song axis (#863's shape);
              //   · before `.late`, because the offset the runtime paired with
              //     this range is a SCHEDULER-frame shift of the already-cut
              //     ribbon. Applied the other way round it would shift the cut
              //     instead, and the audio would sound a span the user never set.
              // Guarded like the seek wrap: exotic patterns may lack `.ribbon`
              // (registered by @strudel/core) → keep them unlooped rather than
              // throwing inside the `.p` seam.
              if (loopRange && typeof effectivePattern.ribbon === 'function') {
                try {
                  effectivePattern = effectivePattern.ribbon(loopRange.startCycle, loopRange.cycles)
                } catch { /* keep unlooped */ }
              }
              if (transportOffset !== 0 && typeof effectivePattern.late === 'function') {
                try { effectivePattern = effectivePattern.late(transportOffset) } catch { /* keep unshifted */ }
              }
              capturedPatterns.set(captureId, effectivePattern)
              // #1648 — TAG what the repl registers, and only that. Strudel stacks
              // the registered patterns and applies `all(...)` after this point, so
              // the tag is how a played hap still names its track (`stemSplit.ts`).
              // The captures above stay untagged: they already know their track.
              return strudelFn.call(tagTrack(effectivePattern, captureId), id)
            }
            // Strudel's `.p()` only accepts strings (registers pattern in
            // D registry keyed by the id). Strudel's double-quoted-string-
            // to-mini transformer turns `.p("name")` into `.p(<Pattern>)`
            // at the transpiler stage — passing a Pattern blows up
            // `k.includes("$")`. Guard the delegation: if id isn't a
            // string, no-op (return `this`) so the chain doesn't crash.
            // User-facing fix: use single quotes (`p('name')`) or pass a
            // numeric orbit via `.orbit(N)`. PV35: invalid input is
            // dropped silently here, not promoted to a runtime hap.
            if (typeof id !== 'string') return this
            return strudelFn.call(this, id)
          },
        })
      },
    })

    try {
      // repl.evaluate() never rejects — errors go to the onEvalError callback
      // set during repl construction. We bridge via evalResolve.
      //
      // #1094 — the resolved value is the pattern the repl actually PLAYS, and it
      // is the only handle on a document that never called `.p()`.
      //
      // Read below only on the success path, and that is safe by ORDER, not by
      // luck: the assignment happens before `evalResolve({})` in the same
      // callback, so an awaited result with no error has already seen it. The
      // error path resolves from `onEvalError` instead and never reads this.
      let playedPattern: unknown
      const result = await new Promise<{ error?: Error }>((resolve) => {
        this.evalResolve = resolve
        // ⚠ THE SECOND ARGUMENT IS `autostart`, AND ITS DEFAULT IS `true` (#1186).
        // Strudel's `evaluate(code, autostart = true, shouldHush = true)`
        // (@strudel/core/repl.mjs:222) forwards the flag through `setPattern`
        // (:272 → :105-107) into `cyclist.setPattern(pat, autostart)`, which
        // starts the clock outright (cyclist.mjs:123-126). Omitting it meant
        // evaluating STARTED THE TRANSPORT — so merely mounting the Song view,
        // which evaluates to draw its pre-play marks, made the app emit notes
        // with no Play, no click and no keystroke (measured: 45 note events).
        //
        // Starting playback belongs to `play()` and nowhere else — it is step 8
        // of the play lifecycle, and `play()` calls `scheduler.start()` itself.
        // That is not only tidiness: play()'s step-3b supersession gate aborts
        // BEFORE step 8 precisely so a Stop landing mid-evaluate cannot leave
        // audio running (#811), and an evaluate that starts the scheduler on its
        // own walks straight past that gate.
        //
        // Passing `false` is inert once playing: `setPattern` only starts when
        // `!this.started`, so a live-coding re-evaluate mid-playback is
        // unaffected. The only behaviour that changes is the one nobody asked
        // for.
        this.repl.evaluate(code, false).then((pattern: unknown) => {
          playedPattern = pattern
          // If onEvalError didn't fire, evaluation succeeded
          if (this.evalResolve) { this.evalResolve({}); this.evalResolve = null }
        }).catch((err: unknown) => {
          // ⚠ THE ONLY SETTLE PATH USED TO BE THE SUCCESS CALLBACK (#1193).
          // The comment above says repl.evaluate never rejects, and errors
          // arrive via onEvalError instead. That is a claim about someone
          // else's function, and if it is ever false — a throw before the
          // repl's own try/catch is installed, a transpile failure that
          // escapes it — `evalResolve` is never called and THIS PROMISE NEVER
          // SETTLES. `evaluate()` then hangs forever, `runExclusiveEval` holds
          // its gate against every later caller, and the snapshot publish that
          // is sequenced behind it never happens: no IR, no lanes, a Song view
          // permanently reading "press play" about a loaded document, and not
          // one error anywhere. Measured as the cause of a rotating ~0.1%
          // failure across the browser suite.
          //
          // So this does not TRUST the claim, it makes it not matter: a
          // rejection resolves the bridge with the error, the same shape
          // onEvalError produces, and every caller carries on.
          if (this.evalResolve) {
            this.evalResolve({ error: err instanceof Error ? err : new Error(String(err)) })
            this.evalResolve = null
          }
        })
      })

      // #2175 — an error thrown while the code ran: where it was written, read
      // back through a source map of the code that ran (`evalErrorLocation`).
      // Only when the last transpile was this code; otherwise it stays unplaced.
      const ran = this.lastTranspile
      if (result.error && ran?.code === code) {
        const at = locateEvalError(
          result.error,
          () => ran.run({ ...ran.options, sourceMap: true }) as { map?: { mappings: string } },
          this.evalFrame,
        )
        if (at) (result.error as Error & { staveLocation?: { line: number; column: number } }).staveLocation = at
      }

      if (!result.error) {
        // #339 — bump the eval generation ONLY on a SUCCESSFUL evaluate, the
        // moment a new pattern is committed and its haps (carrying fresh
        // new-text loc offsets) begin to flow. A FAILED eval (half-written
        // syntax) leaves the OLD pattern playing with OLD-coordinate offsets,
        // so the epoch must NOT change — else useHighlighting would reset its
        // anchors and re-project the still-old offsets onto the edited model,
        // reintroducing the wrong-line drift. Runs synchronously before any
        // new-pattern hap can emit (no await between here and return).
        this.evalEpoch++
        this.hapStream.setEpoch(this.evalEpoch)

        // #1094 — A BARE DOCUMENT SOUNDS THROUGH THE REPL'S OTHER BRANCH.
        // Strudel picks what to play two ways: with at least one `.p()` it stacks
        // the registered patterns, and with none it plays the document's LAST
        // EXPRESSION. Every capture above hangs off the `.p()` wrapper, so the
        // second branch produced no captured pattern at all — `songPatterns`
        // empty, `getTimelineEvents()` empty, and (since the collect interpreter
        // was retired, and every timeline row is now built from eval haps) no
        // Song row for a pattern that is plainly audible.
        //
        // The guard is the SAME CONDITION the repl branches on, not a guess about
        // document shape: Strudel skips its registry exactly when nothing entered
        // it, and nothing enters it in precisely the cases nothing is captured
        // here (a `_`-muted id is refused on both sides). So this can never
        // shadow a registered track — where one exists, the bare expression is
        // not what plays either.
        //
        // Keyed `$0`, the id an anonymous `$:` would have taken: the hap→lane
        // join maps `$N` to the positional `d{N+1}`, so the haps land on `d1` —
        // the lane the IR already produces for a bare statement (measured: every
        // bare document in the corpus walks to exactly one lane, `d1`; 41 of 41).
        //
        // SONG FRAME ONLY, deliberately. `capturedPatterns` (the scheduler frame)
        // also feeds the mixer's per-track meters and the per-track analyser
        // side-taps, so adding a bare entry there would grow a strip and an
        // analyser this change was not asked for and has not measured. That a
        // bare document has no mixer strip is the same gap one surface over, and
        // it belongs to its own issue.
        //
        // Not seek-shifted either: the `.late(transportOffset)` wrap lives inside
        // the `.p()` hook, so a bare document's AUDIO is unshifted today, and
        // shifting the marks alone would draw them where the sound is not. The
        // song frame is the pre-seek frame by definition (#863), so this is also
        // the frame the entry belongs in.
        //
        // #1097 — ONE CAPTURE POINT, four readers. #1095 wrote the song frame
        // here and deliberately left the rest; the maps below are the rest, and
        // they are written together precisely so they cannot disagree about
        // which track the bare pattern is. `resolveBareCaptureId` owns that
        // decision — it resolves to the LAST track, the expression strudel
        // plays, and refuses any document with a labelled track because there
        // the `.p()` registry is what sounds (see bareCapture.ts).
        const bareId = capturedSongPatterns.size === 0 && isQueryablePattern(playedPattern)
          ? resolveBareCaptureId(code)
          : null
        if (bareId !== null) {
          capturedSongPatterns.set(bareId, playedPattern)
          // THE SAME PATTERN OBJECT, unwrapped, into the scheduler frame — and
          // that is a substantive choice, not a shortcut. The `.p()` path may
          // wrap with `.orbit()` and `.late()` because there it is wrapping
          // BEFORE handing the result to strudel to play. Here the pattern has
          // ALREADY been evaluated and scheduled by the repl, so a wrap would
          // produce an object that routes differently from the audio the user
          // can hear — the analyser would tap an orbit nothing plays through
          // and the meter would query a pattern that is not the sounding one.
          // Storing it as-is keeps every consumer in the same frame as the
          // sound, and adds no node to the graph.
          capturedPatterns.set(bareId, playedPattern)
          // The inline `.viz()` request, recovered from the chain-viz closure.
          // `.viz()` sets it and only the `.p()` wrapper clears it, so on this
          // branch it is still here. Note it gets NO auto-orbit for the reason
          // above, so a bare track's viz taps the shared orbit-1 bus — which is
          // already true of every track that is not `.viz`/`.orbit`-isolated
          // (`useTrackMeters`'s swap test), so this is the existing behaviour
          // extended by one entry rather than a new class of wrongness.
          if (pendingChainViz) capturedVizRequests.set(bareId, pendingChainViz)
          if (pendingChainVizOptions) capturedVizOptions.set(bareId, pendingChainVizOptions)
        }
        // Build PatternSchedulers from captured patterns
        const sched = (this.repl as any).scheduler // eslint-disable-line @typescript-eslint/no-explicit-any
        this.trackSchedulers = new Map<string, PatternScheduler>()
        for (const [id, pattern] of capturedPatterns) {
          const captured = pattern // close over this specific pattern instance
          const trackId = id // capture for the closure below
          this.trackSchedulers.set(id, {
            now: () => sched.now(),
            query: (begin: number, end: number) => {
              try {
                return captured
                  .queryArc(begin, end)
                  .map((hap: unknown) => normalizeStrudelHap(hap, trackId, this.lastIRNodeLocLookup ?? undefined, this.lastDeclaredLocations ?? undefined))
              } catch {
                return []
              }
            },
          })
        }
        // #863 — assigned WITH trackSchedulers so the two frames never diverge:
        // a re-eval that publishes new schedulers publishes new song patterns.
        this.songPatterns = capturedSongPatterns
        this.vizRequests = capturedVizRequests
        this.vizOptions = capturedVizOptions
        this.backdropVizRequest = capturedBackdropViz
        this.backdropVizOptions = capturedBackdropVizOptions

        // Per-track analyser side-taps: for each captured pattern, discover the
        // orbit it plays through and connect the orbit's output GainNode to a
        // dedicated AnalyserNode. Lets inline .viz() show per-track FFT instead
        // of the master mix. Reuses existing analysers when (captureId, orbit)
        // persists across re-evaluates — avoids reconnect churn + flicker.
        this.rebuildTrackAnalysers(capturedPatterns)

        // Parse the ORIGINAL user code string (not transpiled) so the parser
        // sees idiomatic Strudel patterns rather than reified output, then
        // build the PV38-clause-2 loc→irNodeId lookup the queryArc callbacks
        // read to enrich haps with `irNodeId`. Node identity is a STRUCTURAL
        // property of the IR (loc + tag), so it comes from `buildNodeLocIndex`
        // (a pure IR walk) — NOT from running collect's behaviour interpreter.
        // #975/#982: this replaces the old propagate→collect→lastIREvents path;
        // `buildNodeLocIndex` reproduces the collect-derived lookup byte-for-byte
        // (nodeIdentity.test.ts) without the onset engine.
        this.lastPatternIR = parseStrudel(code)
        this.lastIRNodeLocLookup = this.lastPatternIR
          ? buildNodeLocIndex(this.lastPatternIR)
          : null
        // #1619 — read after the repl's own `updateState` (`repl.mjs:273`), which runs
        // before its `evaluate` resolves, so these are THIS evaluate's spans.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.lastDeclaredLocations = declaredLocationKeys((this.repl as any)?.state?.miniLocations) ?? null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.lastSliders = sliderWidgets((this.repl as any)?.state?.widgets)
        // #1344 — the pattern the repl PLAYS, after Strudel's own `$:` stacking,
        // solo selection and `all(...)`/`each(...)` (`repl.mjs:230-262`), none of
        // which the per-track captures above see. The two snapshots are the
        // frame the `.p` hook wrapped it in, read from the same consts it used.
        this.loadedRender = {
          pattern: isQueryablePattern(playedPattern) ? playedPattern : null,
          transportOffset,
          loopRange,
          trackIds: [...capturedSongPatterns.keys()],
          tagged: bareId === null,
        }
      } else {
        // Failed evaluate — clear stale IR
        this.lastPatternIR = null
        this.lastIRNodeLocLookup = null
        this.backdropVizRequest = null
        this.loadedRender = null
      }

      return result
    } finally {
      // Always restore Pattern.prototype.p — even on error
      if (savedDescriptor) {
        Object.defineProperty(Pattern.prototype, 'p', savedDescriptor)
      } else {
        delete (Pattern.prototype as any).p // eslint-disable-line @typescript-eslint/no-explicit-any
      }

      // Restore Pattern.prototype.viz — same pattern as .p restoration above
      if (savedVizDescriptor) {
        Object.defineProperty(Pattern.prototype, 'viz', savedVizDescriptor)
      } else {
        delete (Pattern.prototype as any).viz // eslint-disable-line @typescript-eslint/no-explicit-any
      }

      // Restore legacy ._vizName() methods
      for (const [methodName, desc] of savedLegacyDescriptors) {
        if (desc) {
          Object.defineProperty(Pattern.prototype, methodName, desc)
        } else {
          delete (Pattern.prototype as any)[methodName] // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      }
    }
  }

  get components(): Partial<EngineComponents> {
    const bag: Partial<EngineComponents> = {
      streaming: { hapStream: this.hapStream },
    }
    if (this.analyserNode && this.audioCtx) {
      bag.audio = {
        analyser: this.analyserNode,
        audioCtx: this.audioCtx,
        trackAnalysers: this.trackAnalysers.size > 0 ? this.trackAnalysers : undefined,
      }
    }
    bag.queryable = {
      scheduler: this.getPatternScheduler(),
      trackSchedulers: this.trackSchedulers,
    }
    // Build inlineViz from vizRequests + line scanning. Created when there's
    // EITHER an inline viz request OR a code-driven backdrop request, so a
    // bare `.scope()` (backdrop, no inline `.viz()`) still surfaces.
    const hasInlineViz = this.vizRequests.size > 0 && this.lastEvaluatedCode
    if (hasInlineViz || this.backdropVizRequest || this.lastSliders.length > 0) {
      bag.inlineViz = {
        vizRequests: hasInlineViz
          ? this.buildVizRequestsWithLines(this.vizRequests, this.lastEvaluatedCode!)
          : new Map(),
        backdropRequest: this.backdropVizRequest
          ? { vizId: this.backdropVizRequest, options: this.backdropVizOptions ?? undefined }
          : undefined,
        sliders: this.lastSliders.length > 0 ? this.lastSliders : undefined,
      }
    }
    // Expose Pattern IR if available. `irEvents` is retained on the component
    // type but is no longer populated by the engine: the collect onset stream it
    // once carried has no reader (viz components read `queryable`/`streaming`),
    // and node identity now flows via `lastIRNodeLocLookup` (#975/#982). Kept `[]`
    // so the `IRComponent` shape is stable; the dead field is a cleanup candidate.
    if (this.lastPatternIR) {
      bag.ir = {
        patternIR: this.lastPatternIR,
        irEvents: [],
      }
    }
    return bag
  }

  /**
   * Scans code for $: blocks and maps each track's viz request to the line
   * after the last line of that block. Mirrors the line-scanning logic in
   * viewZones.ts but returns structured data instead of creating DOM zones.
   */
  private buildVizRequestsWithLines(
    requests: Map<string, string>,
    code: string,
  ): Map<string, { vizId: string; afterLine: number; contentHash: string; options?: Record<string, unknown> }> {
    // Delegates to the pure `scanVizRequestLines` — extracted so the `$:` /
    // named-label ($:-vs-`drums:`) line-scan is unit-testable without a browser
    // (#725). Handles the anonymous `$:` form (positional `$N` keys) AND named
    // labels keyed by name — both agreeing with the `.p()` capture side above.
    return scanVizRequestLines(requests, code, this.vizOptions)
  }

  /**
   * #1987 — ask the browser to start audio, inside the gesture that asked for Play.
   * Before `init()` there is no context yet: the listeners `initInternal` installs
   * cover that case on the next gesture.
   */
  unlockAudio(): void {
    declarePlayback()
    startAudio(this.audioCtx)
  }

  play(): void {
    this.transportGeneration++ // #2064 — a fade deferred by an earlier Stop no longer applies
    // #1731 — a display render never makes Play wait for the whole track: it is
    // aborted here, stops being fed at its next pause, and the Play deferred
    // below starts then.
    this.trackEnvelopes.playing()
    // #1627 — a Play pressed while an offline render holds the transport starts
    // when the render finishes, not into it.
    if (this.transportHold.requestPlay()) return
    this.repl?.scheduler?.start()
    // Re-tap the master analyser on the live output node. superdough recreates
    // its shared `destinationGain` on every evaluate/reset, so the analyser —
    // connected once at init — must follow the swap or the master meter freezes.
    // play() is where a just-started file (re)asserts the tap. The master TRIM
    // itself lives in the document as `all(x => x.mul(postgain()))` (#792/#794/#1711), not here.
    this.followMasterAnalyser()
  }

  /** #2058 — superdough's stop-every-sound (Stave's patch), once audio is up. */
  private stopAllSoundsFn: ((fade?: number) => number) | null = null
  /** #2064 — moves on every Play and Stop, so a deferred fade knows it is stale. */
  private transportGeneration = 0

  /** the destinationGain node our master analyser is currently tapping. */
  private taggedDestinationGain: AudioNode | null = null
  /** resolves superdough's GLOBAL audio controller (the live one). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private superdoughControllerFn: (() => any) | null = null

  /**
   * Keep the master `AnalyserNode` tapped to the LIVE output node. superdough
   * RECREATES `destinationGain` on reset (resetGlobalEffects → SuperdoughOutput
   * .reset(), superdoughoutput.mjs:151-159) — every evaluate swaps it for a fresh
   * GainNode. The analyser was connected once at init (line 478), so after a swap
   * it taps a dead node while the live mix flows through the new one and the
   * master meter freezes. On a swap, detach from the stale node and re-tap the
   * live one. Read-only side-tap — audio still flows unchanged to the destination
   * (no routing mutation, V-mixer-3). Master gain is NOT applied here anymore:
   * the master trim is the document's `all(x => x.mul(postgain()))` (#794 removed the
   * synthetic per-file output-gain seam).
   */
  private followMasterAnalyser(): void {
    // Resolve the GLOBAL controller fresh (not the per-engine cached one) so the
    // analyser taps the live output even when a dev double-mount created a second
    // engine with a stale cached controller.
    const ctrl = this.superdoughControllerFn?.() ?? this.audioController
    const dg = ctrl?.output?.destinationGain as AudioNode | undefined
    // audio not initialized yet, or already tapping the live node — play() re-taps later.
    if (!dg || !this.analyserNode || this.taggedDestinationGain === dg) return
    // Detach from the previous (now-stale) node first, else the analyser sums
    // taps from several destinationGains across swaps and over-reads the level.
    try {
      this.taggedDestinationGain?.disconnect(this.analyserNode)
    } catch {
      /* already disconnected */
    }
    try {
      dg.connect(this.analyserNode)
    } catch {
      /* already connected */
    }
    this.taggedDestinationGain = dg
  }

  stop(): void {
    // #1627 — a Stop pressed during an offline render must not be undone when
    // the render resumes the transport it paused.
    this.transportHold.cancelResume()
    this.repl?.scheduler?.stop()
    // #2058 — the scheduler's stop only stops NEW notes. A sample plays its whole
    // length unless something cuts it, so a long file kept sounding after Stop
    // (measured: still at full level fifteen seconds later). Fade out what is
    // playing — on the LIVE graph: while a bounce renders, superdough's context
    // and its live-sound map are the bounce's, and the fade would land in the file
    // (#2064). So it waits for every render to let go, and is dropped if Play was
    // pressed in the meantime, or it would cut the new notes.
    const stopAll = this.stopAllSoundsFn
    if (stopAll) {
      const at = ++this.transportGeneration
      whenGraphFree(() =>
        onLiveGraph(() => {
          if (at === this.transportGeneration) stopAll(0.03)
        }),
      )
    }
    this.trackEnvelopes.stopped() // #1731 — stopped: render what is missing or stale
  }

  /**
   * Phase 20-07 (DEC-AMENDED-1) — debugger pause. Calls
   * `scheduler.pause()` (NOT `.stop()`) — pause keeps lastEnd
   * (cyclist.mjs:112-116), stop rewinds lastEnd to 0 (cyclist.mjs:117-122).
   * ⚠ Pause does NOT hold the song at the paused cycle: the clock keeps its
   * next tick time (zyklus.mjs:44), so the next start() runs every tick missed
   * while paused, skipping their notes (zyklus.mjs:27-31, cyclist.mjs:53-56).
   * Position after resume = paused position + paused seconds × cps.
   * Idempotent: setPaused() guards against double-fire of listeners (T17).
   */
  pause(): void {
    this.transportHold.cancelResume() // #1627 — same reason as stop()
    this.repl?.scheduler?.pause?.()
    this.setPaused(true)
  }

  /**
   * Phase 20-07 — debugger resume. Calls `scheduler.start()`, which picks up
   * where the song would be NOW, not at the paused cycle (see pause() above;
   * cyclist.mjs:101-111). Idempotent.
   */
  resume(): void {
    this.trackEnvelopes.playing() // #1731 — same as play()
    // #1627 — deferred to the end of an offline render, like play().
    if (!this.transportHold.requestPlay()) this.repl?.scheduler?.start?.()
    this.setPaused(false)
  }

  /** Current debugger pause state (true after a breakpoint hit). */
  getPaused(): boolean {
    return this.isPausedState
  }

  /**
   * Subscribe to engine pause-state transitions. Mirrors the
   * subscriber-set pattern used by `LiveCodingRuntime.onPlayingChanged`
   * (RESEARCH Q3). Returns a disposer.
   */
  onPausedChanged(listener: (paused: boolean) => void): () => void {
    this.pauseChangedListeners.add(listener)
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.pauseChangedListeners.delete(listener)
    }
  }

  /**
   * Phase 20-07 — accessor onto the engine's BreakpointStore. The
   * runtime exposes this through its own `getBreakpointStore()` so the
   * editor's useBreakpoints hook (Wave β) and the Inspector (Wave γ)
   * share a single store.
   */
  getBreakpointStore(): BreakpointStore {
    return this.breakpointStore
  }

  /**
   * Internal — flip pause state and fan out to subscribers, with an
   * idempotence guard (T17): both Inspector + Monaco "Resume" surfaces
   * may fire setPaused(false) simultaneously; this short-circuits the
   * second call so listeners never see a redundant transition.
   */
  private setPaused(paused: boolean): void {
    if (this.isPausedState === paused) return
    this.isPausedState = paused
    for (const l of this.pauseChangedListeners) {
      try {
        l(paused)
      } catch {
        /* listener errors don't break dispatch */
      }
    }
  }

  /**
   * Resolve once the master output has been QUIET for a sustained window, or
   * when `maxMs` elapses. Returns whether quiet was actually reached (#1356).
   *
   * `stop()` halts Strudel's scheduler but does not cancel Web Audio nodes
   * already scheduled in the lookahead window, so the graph keeps sounding
   * after the transport reads stopped — measured at near-full level for a full
   * second, gone by 1.25s. A bounce started in that window sums the previous
   * take under the opening of the new one (+24% RMS over the first 1.5s).
   *
   * Waiting on the ANALYSER rather than on a fixed delay means the common case
   * — a graph that is already silent — costs one hold window, and the wait can
   * never be shorter than the tail actually is.
   */
  async waitUntilQuiet(maxMs = 2500, threshold = 0.005): Promise<boolean> {
    const analyser = this.analyserNode
    if (!analyser) return true
    const buf = new Float32Array(analyser.fftSize)
    // Hold long enough that a rest between notes cannot read as silence. RMS
    // over the whole fftSize window is already robust to zero crossings.
    const HOLD_MS = 150
    const STEP_MS = 25
    const need = Math.ceil(HOLD_MS / STEP_MS)
    const deadline = Date.now() + maxMs
    let streak = 0
    for (;;) {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      if (Math.sqrt(sum / buf.length) <= threshold) {
        if (++streak >= need) return true
      } else {
        streak = 0
      }
      if (Date.now() >= deadline) return false
      await new Promise((r) => setTimeout(r, STEP_MS))
    }
  }

  /**
   * Capture `durationSeconds` of the LIVE master output as a WAV Blob.
   *
   * This is the honest bounce: it taps the same analyser the meters read, so
   * what you hear is what you get — unlike `renderOffline`, which re-evaluates
   * the code in an OfflineAudioContext and cannot currently reach a Stave
   * document at all (#1344).
   *
   * ⚠ It records the graph as it is, so the caller must start playback first.
   * If nothing is playing this now REJECTS with `SilentCaptureError` rather
   * than resolving with a valid WAV of silence and no error (#1402) — the
   * check lives at the capture boundary in `WavEncoder`, not here, because a
   * rule addressed to callers is one every caller can decline. Pass `signal`
   * to stop early and keep what was captured; a cancelled take is allowed to
   * be silent.
   */
  async record(durationSeconds: number, signal?: AbortSignal): Promise<Blob> {
    if (!this.analyserNode || !this.audioCtx) {
      throw new Error('StrudelEngine not initialized — call init() first')
    }
    return LiveRecorder.capture(
      this.analyserNode,
      this.audioCtx,
      durationSeconds,
      signal
    )
  }

  /**
   * Render `duration` seconds of `code` to a WAV, faster than real time, through
   * the same superdough graph the live engine plays — samples, soundfonts and
   * effects included (#1353). The report form is `renderOfflineReport`.
   */
  async renderOffline(
    code: string,
    duration: number,
    sampleRate?: number
  ): Promise<Blob> {
    return (await this.renderOfflineReport(code, duration, sampleRate)).blob
  }

  /**
   * `renderOffline`, plus what the render could and could not play.
   *
   * ⚠ IT USED TO DROP EVERY DRUM, WITH NO ERROR (#1353). `renderOffline` went
   * through `OfflineRenderer` (since removed, #1630), a hand-rolled oscillator
   * renderer that skipped
   * any sound it could not map to a waveform and any hap without a pitch. A drum
   * pattern stacked into a synth came back byte-identical to the synth alone.
   * Its stated reason — worklets cannot be registered on a fresh
   * `OfflineAudioContext` — was measured false (#1398); `renderPatternOffline`
   * is the real graph, and what it changes from upstream is in its header.
   *
   * ⚠ A SOUND THAT FAILS IS REPORTED, NOT DROPPED. Every hap superdough refuses
   * is counted by reason, returned in `skipped`, and emitted as one warning
   * BEFORE encoding — so a render in which nothing could play still says why
   * when `WavEncoder` refuses it as silent (#1402).
   *
   * ⚠ REQUIRES `init()`. Sample banks, synth sounds and the string parser are
   * registered there; before it, every drum is "not found" and the render would
   * report exactly that. Same contract as `record()`.
   *
   * ⚠ TEMPO IS THE ENGINE'S ONE READING (`getCps`), falling back to Strudel's
   * 0.5 — never a regex over the source. The old renderer's regex defaulted to
   * 1 and rendered at double speed (#1345).
   *
   * ⚠ IT HOLDS THE LIVE TRANSPORT FOR THE RENDER (#1627). While it runs,
   * superdough's module globals name the OFFLINE context, so anything the live
   * scheduler triggered in that window would be rendered into the bounce rather
   * than played. A playing transport is paused for the render and resumed after
   * it, on every exit; a stopped one is left stopped; Stop during the render
   * cancels the resume and Play is deferred to its end (`transportHold.ts`).
   * Resuming picks up where the song would be NOW, not where it paused: Strudel's
   * clock keeps its next tick time through a pause and catches up on start,
   * skipping the notes it missed (`zyklus.mjs:27-31`, `cyclist.mjs:40-52`).
   *
   * ⚠ `code` is evaluated with `@strudel/core`'s `evaluate`, outside this
   * engine's evaluate window, so `setcps`, `$:` and `.viz` are still refused
   * here, and that is by decision (#1344): taking arbitrary code through the
   * engine's window would replace the document loaded to play. To bounce a real
   * document, load it and call `renderLoadedReport` —
   * `LiveCodingRuntime.bounceOffline` does both.
   */
  async renderOfflineReport(
    code: string,
    duration: number,
    sampleRate?: number
  ): Promise<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }> {
    if (!this.audioCtx) {
      throw new Error('StrudelEngine not initialized — call init() first')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wa: any = await import('@strudel/webaudio')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core: any = await import('@strudel/core')
    const { transpiler } = await import('@strudel/transpiler')

    const evaluated = await core.evaluate(code, transpiler)
    const pattern = evaluated?.pattern
    if (!pattern) {
      throw new Error('renderOffline: no pattern returned from evaluate()')
    }
    return this.renderPatternReport(pattern, duration, sampleRate)
  }

  /**
   * Render the document this engine has LOADED — the pattern its last successful
   * `evaluate` handed the repl — through the same real graph as
   * `renderOfflineReport` (#1344).
   *
   * ⚠ WHY THIS, AND NOT `renderOfflineReport(code)`. That one evaluates with
   * `@strudel/core`'s raw `evaluate`, outside this engine's evaluate window, so
   * `setcps`, `$:` and `.viz` do not exist there. Evaluating the render's code
   * through the engine instead was measured to REPLACE what is loaded to play:
   * after a render taken while playing, the speakers resumed the render's code
   * (live RMS 0.054 → 0.118). Rendering what is already loaded has neither
   * problem: every word of the document went through the real window, and
   * nothing is swapped, because the render's document is the document.
   *
   * ⚠ IT RENDERS WHAT STRUDEL PLAYS, not the per-track captures. Those are taken
   * inside the `.p` hook, before Strudel applies `all(...)` — which 42 corpus
   * documents call on a live line, some to set level — so a mix built from them
   * would be wrong without an error.
   *
   * ⚠ REFUSES A SEEKED OR LOOPED LOAD. The `.p` hook wraps every track in the
   * seek (`.late`) and the loop (`.ribbon`) in force at evaluate, so rendering
   * that pattern would bounce a shifted or looped song, silently. The caller
   * clears both and evaluates first: `LiveCodingRuntime.bounceOffline` does.
   *
   * Also refuses when nothing is loaded, when the last evaluate failed (the old
   * pattern still plays, but it is not the document), and when the loaded
   * document plays nothing. Tempo is `getCps()`, which the document's own
   * `setcps`/`setcpm` set during that evaluate.
   */
  async renderLoadedReport(
    duration: number,
    sampleRate?: number,
    /** #1655 — stops the render at its next pause; it then rejects with `RenderCancelledError`. */
    signal?: AbortSignal,
    /** #1650 — seconds of the song rendered so far, at each pause and at the end. */
    onProgress?: (renderedSeconds: number) => void
  ): Promise<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }> {
    const loaded = this.renderableLoad('renderLoadedReport')
    return this.renderPatternReport(loaded.pattern, duration, sampleRate, signal, onProgress)
  }

  /**
   * #1648 — render the LOADED document as one WAV per track, each the full
   * `duration` and lined up with the master `renderLoadedReport` makes.
   *
   * A stem is its track's share of what PLAYS: the played pattern filtered to the
   * track's tag (`stemSplit.ts`), so `all(...)`, solo and each track's own sends
   * are all in it — what Ableton calls exporting individual tracks with "Include
   * Return and Main Effects". Sound that `all(...)` adds and no track owns comes
   * back as `SONG_LEVEL_STEM`, so the stems add up to the master. Measured in the
   * browser: within 0.4% of the master's RMS, except where a render draws fresh
   * randomness (supersaw phases, reverb impulse responses, #1665).
   *
   * Same refusals as `renderLoadedReport`, one transport hold for the whole set
   * (#1627), stems in document order, one at a time (`renderStemsInOrder`). A
   * stem that fails or is silent is `{ ok: false }` and costs no other stem. A
   * cancel stops the set and rejects with `RenderCancelledError`. `onProgress`
   * reports seconds rendered across the whole set, out of `duration` × stems.
   */
  async renderLoadedStemsReport(
    duration: number,
    sampleRate?: number,
    signal?: AbortSignal,
    onProgress?: (renderedSeconds: number, totalSeconds: number) => void
  ): Promise<{
    order: string[]
    stems: Record<string, StemOutcome<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }>>
  }> {
    const loaded = this.renderableLoad('renderLoadedStemsReport')
    const cps = this.getCps() ?? 0.5
    const planned = planStems(loaded.pattern, loaded.trackIds, loaded.tagged, Math.ceil(duration * cps))
    const byId: Record<string, unknown> = {}
    for (const p of planned) byId[p.id] = p.pattern
    const total = duration * planned.length
    const stems = await withUserRender(() => this.transportHold.hold(() =>
      renderStemsInOrder(
        byId,
        (pattern, _id, i) =>
          this.renderPatternReport(pattern, duration, sampleRate, signal, (s) => onProgress?.(i * duration + s, total)),
        undefined,
        signal ? { signal, error: () => new RenderCancelledError() } : undefined
      )
    ))
    return { order: planned.map((p) => p.id), stems }
  }

  /** The load both loaded renders use, or the reason it cannot be rendered. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private renderableLoad(caller: string): { pattern: any; trackIds: string[]; tagged: boolean } {
    if (!this.audioCtx) {
      throw new Error('StrudelEngine not initialized — call init() first')
    }
    const loaded = this.loadedRender
    if (!loaded) {
      throw new Error(`${caller}: no document is loaded — the last evaluate failed or never ran`)
    }
    if (loaded.transportOffset !== 0 || loaded.loopRange !== null) {
      throw new Error(
        `${caller}: the document was evaluated with a seek or a loop armed, so the render ` +
          'would be shifted or looped — clear both and evaluate again'
      )
    }
    if (!loaded.pattern) {
      throw new Error(`${caller}: the loaded document plays nothing`)
    }
    return loaded
  }

  /** The render both entry points share: hold the transport, render, report, encode. */
  private async renderPatternReport(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pattern: any,
    duration: number,
    sampleRate?: number,
    signal?: AbortSignal,
    onProgress?: (renderedSeconds: number) => void
  ): Promise<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }> {
    // #1731 #1735 — a user's render goes first: every file's display render is
    // aborted and waited for, and none starts until this one ends.
    const result = await withUserRender(() =>
      this.renderPatternRaw(pattern, duration, sampleRate, signal, onProgress),
    )

    if (result.skipped.length > 0) {
      const left = result.skipped.reduce((n, s) => n + s.count, 0)
      emitLog({
        level: 'warn',
        runtime: 'strudel',
        message:
          `Bounce left out ${left} of ${result.haps} sounds: ` +
          describeSkipped(result.skipped),
      })
    }

    let blob: Blob
    try {
      blob = WavEncoder.encode(result.buffer)
    } catch (err) {
      // #1635 — a render is silent most often because every sound was left out,
      // and the refusal alone says only "silent". Name what was left out on the
      // error the caller reads. The instance is kept: callers branch on it and
      // read `refused` from it.
      if (err instanceof SilentCaptureError && result.skipped.length > 0) {
        const left = result.skipped.reduce((n, s) => n + s.count, 0)
        err.message = `${err.message} The render left out ${left} of ${result.haps} sounds: ${describeSkipped(result.skipped)}`
      }
      throw err
    }

    return { blob, haps: result.haps, played: result.played, skipped: result.skipped }
  }

  /**
   * The render every path shares: hold the transport and render through the
   * real graph. User renders reach it through `renderPatternReport`, inside
   * `withUserRender`; the display render (#1731) calls it directly,
   * because it IS the render that exclusivity waits for.
   */
  private async renderPatternRaw(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pattern: any,
    duration: number,
    sampleRate?: number,
    signal?: AbortSignal,
    onProgress?: (renderedSeconds: number) => void
  ) {
    if (!this.audioCtx) {
      throw new Error('StrudelEngine not initialized — call init() first')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wa: any = await import('@strudel/webaudio')
    const options = {
      signal,
      onProgress,
      cps: this.getCps() ?? 0.5,
      duration,
      sampleRate: sampleRate ?? this.audioCtx.sampleRate,
    }
    // #1733 — superdough's globals are one per PAGE, so a render waits for any
    // other engine's render to hand them back. A render cancelled while it
    // waited never borrows them at all.
    return withOfflineGraph(() => {
      if (signal?.aborted) return Promise.reject(new RenderCancelledError())
      return this.transportHold.hold(() => renderPatternOffline(pattern, options, this.offlineGraphDeps(wa)))
    })
  }

  /**
   * What an offline render borrows from the engine: superdough's module globals,
   * the alias step, the reverb wait and where its context is built.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private offlineGraphDeps(wa: any): OfflineGraphDeps {
    return {
      getAudioContext: wa.getAudioContext,
      setAudioContext: wa.setAudioContext,
      getSuperdoughAudioController: wa.getSuperdoughAudioController,
      setSuperdoughAudioController: wa.setSuperdoughAudioController,
      initAudio: wa.initAudio,
      // #1635 — the alias step live playback applies in `wrappedOutput`. The
      // render calls superdough directly, so without this `kick` was "not
      // found" in a bounce while it played live.
      superdough: (value, t, hapDuration, cps, cycle) =>
        wa.superdough(aliasSoundValue(value, this.soundMapRef?.get?.() ?? undefined).value, t, hapDuration, cps, cycle),
      // #1675 — a reverb's impulse response lands asynchronously; the render
      // waits for it at each window instead of rendering the room silent.
      settle: wa.reverbsReady,
      // #1758 — a render that loads worklets is built in a frame of its own,
      // so disposing it frees the context; Chromium never frees it otherwise.
      // Samples it loads are decoded on the LIVE context: superdough caches a
      // load page-wide, and a decode left on a removed frame never settles.
      createContext: (frames, rate, { worklets }) =>
        worklets && canOpenAudioFrame()
          ? offlineContextInFrame(2, frames, rate, { decodeWith: () => this.audioCtx })
          : new OfflineAudioContext(2, frames, rate),
    }
  }

  /**
   * #1771 — `renderPatternRaw` for a browser whose offline context cannot pause:
   * the song rendered as short pieces and joined (`pieceRender.ts`), so its cost
   * grows with the length rather than its square. Display renders only: a join
   * cuts whatever rings past the lead-in. Holds the graph and the transport once
   * for every piece, so no Play starts between two of them.
   */
  private async renderPatternInPieces(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pattern: any,
    duration: number,
    sampleRate: number,
    signal: AbortSignal,
  ): Promise<Float32Array[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wa: any = await import('@strudel/webaudio')
    const deps = this.offlineGraphDeps(wa)
    const cps = this.getCps() ?? 0.5
    const pieces = piecesOf(duration, DISPLAY_PIECE_SECONDS, DISPLAY_PIECE_LEAD_SECONDS)
    return withOfflineGraph(() => {
      if (signal.aborted) return Promise.reject(new RenderCancelledError())
      return this.transportHold.hold(() =>
        renderInPieces(
          duration,
          sampleRate,
          pieces,
          async (start, seconds) => {
            const { buffer } = await renderPatternOffline(pattern, { signal, cps, duration: seconds, sampleRate, start }, deps)
            return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
          },
          signal,
          () => new RenderCancelledError(),
        ),
      )
    })
  }

  /**
   * #1731 — the Song timeline's handle on the synth-track renders: which tracks
   * it wants, their envelopes, and a change signal. Renders run only while the
   * transport is stopped, one track at a time, and only for tracks whose events
   * changed since their last render (`trackEnvelopes.ts`).
   */
  readonly trackEnvelopeAccess: TrackEnvelopeAccess = {
    request: (trackIds, cycles) => this.trackEnvelopes.request(trackIds, cycles),
    get: (trackId) => this.trackEnvelopes.get(trackId),
    status: () => this.trackEnvelopes.status(),
    subscribe: (listener) => {
      this.trackEnvelopeListeners.add(listener)
      return () => {
        this.trackEnvelopeListeners.delete(listener)
      }
    },
  }

  /**
   * #1731 — what a track plays over `[0, cycles)`, as a digest: every onset's
   * span and value, plus tempo and span. Two evaluates that leave a track's
   * events alone give the same digest, so its envelope survives an edit to
   * another track. Queried from `songPatterns`, the frame before the seek and
   * loop wraps, which is also what `renderTrackEnvelope` renders.
   */
  private trackFingerprint(trackId: string, cycles: number): string | null {
    const pattern = this.songPatterns.get(trackId)
    if (!pattern) return null
    let text = `${this.getCps() ?? 0.5}|${cycles}|`
    const values: unknown[] = []
    try {
      for (const hap of pattern.queryArc(0, cycles)) {
        if (hap.whole == null) continue
        if (typeof hap.hasOnset === 'function' && !hap.hasOnset()) continue
        text += `${Number(hap.whole.begin)},${Number(hap.whole.end)},${JSON.stringify(hap.value)};`
        values.push(hap.value)
      }
    } catch {
      // Unreadable events cannot be compared: stale after every evaluate.
      this.displayRates.delete(trackId)
      return `unreadable:${this.evalEpoch}`
    }
    // #1759 — decided from the same events the fingerprint stamps, so a render
    // for this fingerprint always uses this rate.
    if (this.audioCtx) this.displayRates.set(trackId, displayRenderRate(values, this.audioCtx.sampleRate))
    return digest(text)
  }

  /**
   * #1731 — render one track's own pattern over `[0, cycles)` and reduce it to
   * an envelope; null when it is silent.
   *
   * ⚠ IT RENDERS THE PER-TRACK CAPTURE, NOT WHAT PLAYS. `songPatterns` is taken
   * inside the `.p` hook, before Strudel applies `all(...)`, so the drawn shape
   * is the track's own sound before master-level processing. That is also what
   * lets it render after a seek or with a loop armed, where the loaded render
   * refuses: the capture predates both wraps.
   *
   * ⚠ AT 24 kHz ONLY FOR A TRACK OF PLAIN OSCILLATORS, ELSE THE LIVE RATE
   * (#1759, `displayRate.ts`). superdough caches decoded samples, noise and
   * soundfont zones page-wide by name, decoded on whatever context is current,
   * so a low-rate render that loaded one first would leave live playback a
   * low-rate copy. The rate is decided in `trackFingerprint`, from the events
   * this render plays.
   *
   * ⚠ IN PIECES WHERE A RENDER CANNOT PAUSE (#1771, Firefox): 8 s pieces joined,
   * each with a 4 s lead-in (`renderPatternInPieces`). What rings longer than
   * the lead-in is cut at a join, and a supersaw's voices take their phase from
   * the note's time on the piece's clock, so its fine beating differs from a
   * single render's: an equally valid draw, as live playback is another.
   */
  private async renderTrackEnvelope(trackId: string, cycles: number, signal: AbortSignal): Promise<TrackEnvelope | null> {
    const pattern = this.songPatterns.get(trackId)
    if (!pattern || !this.audioCtx) return null
    const duration = cycles / (this.getCps() ?? 0.5)
    const rate = this.displayRates.get(trackId) ?? this.audioCtx.sampleRate
    let channels: Float32Array[]
    if (canPauseOfflineRender()) {
      const { buffer } = await this.renderPatternRaw(pattern, duration, rate, signal)
      channels = []
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
    } else {
      channels = await this.renderPatternInPieces(pattern, duration, rate, signal)
    }
    const env = envelopeFromChannels(channels, Math.max(1, Math.ceil(duration * TRACK_ENVELOPE_COLUMNS_PER_SECOND)))
    return env ? { ...env, cycles } : null
  }

  /**
   * Render each stem's standalone program to its own WAV, through the same real
   * graph as `renderOfflineReport`, and report what happened to every stem.
   *
   * ⚠ IT USED TO DROP EVERY DRUM, AND ONE SILENT STEM LOST THEM ALL (#1409). It
   * went through `OfflineRenderer` (since removed, #1630), which skipped any
   * sample-based sound, and it
   * rendered with `Promise.all`, so the first stem `WavEncoder` refused as
   * silent rejected the whole set — stems that had already rendered included.
   *
   * ⚠ ONE STEM AT A TIME, on purpose. The real-graph render borrows superdough's
   * module globals for its duration, so two at once would corrupt each other.
   * `renderStemsInOrder` owns that ordering and says why.
   *
   * ⚠ A STEM THAT FAILS IS `{ ok: false, error }` AND COSTS NO OTHER STEM. A
   * silent one's `error` is a `SilentCaptureError`, whose `refused` still holds
   * the take — reached through the error, never handed back as a result (#1410).
   *
   * Same contracts as `renderOfflineReport`: requires `init()`, holds the live
   * transport (once for the whole set, so playback does not stutter back to
   * life between stems, #1627), and `setcps`/`$:`/`.viz` in a stem are still
   * refused, for the same reason as there (#1344). `onProgress` fires after each stem settles, in input order.
   */
  async renderStems(
    stems: Record<string, string>,
    duration: number,
    onProgress?: (stem: string, i: number, total: number) => void
  ): Promise<
    Record<
      string,
      StemOutcome<{ blob: Blob; haps: number; played: number; skipped: SkippedSounds[] }>
    >
  > {
    if (!this.audioCtx) {
      throw new Error('StrudelEngine not initialized — call init() first')
    }
    const sampleRate = this.audioCtx.sampleRate
    return withUserRender(() => this.transportHold.hold(() =>
      renderStemsInOrder(
        stems,
        (code) => this.renderOfflineReport(code, duration, sampleRate),
        onProgress
      )
    ))
  }

  getAnalyser(): AnalyserNode {
    if (!this.analyserNode) throw new Error('StrudelEngine not initialized')
    return this.analyserNode
  }

  getAudioContext(): AudioContext {
    if (!this.audioCtx) throw new Error('StrudelEngine not initialized')
    return this.audioCtx
  }

  on(_event: 'hap', handler: HapHandler): void {
    this.hapStream.on(handler)
  }

  off(_event: 'hap', handler: HapHandler): void {
    this.hapStream.off(handler)
  }

  getHapStream(): HapStream {
    return this.hapStream
  }

  /**
   * The tempo the scheduler is ACTUALLY running at, in cycles per second, or
   * `null` when there is no scheduler yet (engine not initialised).
   *
   * ⚠ WHY THIS EXISTS ALONGSIDE `extractBpmFromCode`. That helper reads the
   * tempo the CODE sets (`codeView/tempo.ts`, the setter family `setcps`/
   * `setcpm` and their camel-case twins, #1925) and is what feeds the status
   * bar's BPM readout. It cannot see two things the scheduler knows: a tempo
   * left at Strudel's default of `0.5` (`cyclist.mjs:24`) by a document that
   * sets none, and a cps CHANGED mid-pattern from a hap value
   * (`cyclist.mjs:72-74`). So `undefined` from it means "the code sets no tempo
   * it can read", never "there is no tempo" — a distinction that matters the
   * moment anything converts cycles to seconds.
   *
   * Deliberately NOT folded into `PatternScheduler`: that adapter is consumed by
   * ~10 visualiser modules, and a tempo read does not need their blast radius.
   */
  /**
   * Two running counts of trouble a listener can hear (#1348), one per thread:
   *
   *  - `lateNotes` — notes the main thread handed over too late, which
   *    superdough dropped. A busy main thread (a heavy evaluation, a long
   *    task) shows up here.
   *  - `underruns` — times the AUDIO thread missed its deadline and the output
   *    glitched (`AudioContext.playbackStats.underrunEvents`). Null where the
   *    browser does not report it, never a made-up zero.
   *
   * Neither is a CPU percentage: the browser exposes no such number for Web
   * Audio (`AudioContext.renderCapacity` is not shipped in the Chromium this
   * app is tested on). These are the events a load percentage would only
   * predict.
   */
  getAudioHealth(): { lateNotes: number; underruns: number | null } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const under = (this.audioCtx as any)?.playbackStats?.underrunEvents
    return { lateNotes: this.lateNotes, underruns: typeof under === 'number' ? under : null }
  }

  getCps(): number | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cps = (this.repl as any)?.scheduler?.cps
    return typeof cps === 'number' && Number.isFinite(cps) && cps > 0 ? cps : null
  }

  /**
   * Returns a thin PatternScheduler wrapper around the Strudel scheduler.
   * Only available after evaluate() succeeds (scheduler.pattern is set then).
   */
  getPatternScheduler(): PatternScheduler | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sched = (this.repl as any)?.scheduler
    const pattern = sched?.pattern
    if (!sched || !pattern) return null
    return {
      now: () => sched.now(),
      query: (begin: number, end: number) => {
        // Side-fix (closes #101): the previous bare normalizeStrudelHap reference
        // passed directly to Array#map received the `index` arg as trackId
        // (latent bug since the trackId param landed). Arrow-wrap explicitly
        // to pass undefined trackId AND the loc lookup. PV38 clause 2 + Trap 8.
        try {
          return pattern
            .queryArc(begin, end)
            .map((hap: unknown) => normalizeStrudelHap(hap, undefined, this.lastIRNodeLocLookup ?? undefined, this.lastDeclaredLocations ?? undefined))
        } catch { return [] }
      },
    }
  }

  /**
   * Returns per-track PatternSchedulers captured during the last evaluate() call.
   * Each $: block gets its own scheduler that queries its Pattern directly via queryArc.
   * Keys: anonymous "$:" → "$0", "$1"; named "d1:" → "d1".
   * Empty Map before first evaluate or after evaluate error.
   */
  getTrackSchedulers(): Map<string, PatternScheduler> {
    return this.trackSchedulers
  }

  /**
   * Evaluated note events across all tracks over `[0, ceil(cycles))`, for the
   * Song timeline's DISPLAY marks (#861). Iterates the per-track schedulers
   * captured during the last evaluate() and concatenates their normalized haps
   * (`sched.query` → `normalizeStrudelHap`), so every event carries the RESOLVED
   * note (`n("0 2 4").scale("C:major")` → `note:"C3","E3","G3"`, Strudel applies
   * the scale at query time) plus its `context.locations`.
   *
   * This is the eval-backed source of truth for what PLAYS — distinct from the
   * static IR (`collectCycles`), which carries the raw source token (`note:"0"`)
   * and drops `.scale` to an unused param, and so is source-lossy for pitch/scale
   * (PV174). Display must degrade to evaluation; the IR stays the source of truth
   * for structure (lanes/clips) and editing. Empty before the first evaluate; a
   * FAILED evaluate leaves the last good eval's patterns in place (as
   * `trackSchedulers` does — neither is reassigned outside the success branch),
   * which the timeline never sees, because it also needs the IR and the engine
   * DOES clear that on error. A per-track query that throws is skipped.
   *
   * SONG FRAME, not the scheduler frame (#863). Queries `songPatterns` — the
   * patterns as captured BEFORE the `.late(transportOffset)` seek wrap — so
   * cycle 0 is the start of the SONG. The timeline draws these marks on a
   * song-absolute axis, inside lanes/clips derived from the (unshifted) static
   * IR; querying the shifted `trackSchedulers` instead would slide every mark by
   * the transport offset after a seek and rotate the loop's tail into the window,
   * desyncing marks from their own lanes. The live surfaces that DO want the
   * scheduler frame (viz, signal bus, meters, playhead overlay) keep reading
   * `trackSchedulers` — the two frames coincide only while `transportOffset` is 0.
   */
  getTimelineEvents(cycles: number): IREvent[] {
    const n = Math.max(1, Math.ceil(Number.isFinite(cycles) ? cycles : 1))
    return this.getTimelineEventsBand(0, n)
  }

  /**
   * The same events over an ARBITRARY BAND `[startCycle, endCycle)` instead of a
   * prefix from zero. Same song frame, same normalisation, same `trackId`
   * stamping as `getTimelineEvents` — only the queried arc differs.
   *
   * ── WHY THIS EXISTS (#1197) ─────────────────────────────────────────────────
   * `analyzeSong`'s collector interface is already band-limited
   * (`(startCycle, endCycle) => IREvent[]`) and it collects the progressive
   * horizon in `sliceCycles`-sized bands. But with only a prefix accessor to call,
   * the app's collector had to query `[0, endCycle)` for every slice and discard
   * everything before the band. Derived over the production defaults (hint 8,
   * cap 256, slice 4), a document that runs to the cap queried 8320 cycles to
   * cover 256 — 32.5× the work for an identical answer, paid on every re-eval and
   * heaviest on exactly the documents that are most expensive to analyse.
   *
   * ⚠ THE CALLER STILL OWNS ONSET ATTRIBUTION, and must keep filtering.
   * `queryArc` returns every hap OVERLAPPING the arc, so a hap beginning at cycle
   * 3.5 is returned by both `queryArc(0, 4)` and `queryArc(4, 8)`. Analysis
   * buckets an onset by `floor(begin)` (`accumulateLanes`), so a caller walking
   * adjacent bands must drop haps whose `floor(begin)` precedes its band or it
   * will count that onset twice — which changes fingerprints, and therefore the
   * detected period. Deliberately NOT done here: overlap is `queryArc`'s honest
   * answer about what sounds during the band, and only the caller knows whether
   * it is walking bands or asking a one-off question.
   *
   * Equivalence to the prefix path it replaces, which is what makes the swap
   * safe: a hap with `floor(begin) ∈ [start, end)` has `begin ∈ [start, end)` and
   * so necessarily overlaps the band — every event that survived the old
   * `queryArc(0, end)` + filter survives `queryArc(start, end)` + the same filter.
   */
  getTimelineEventsBand(startCycle: number, endCycle: number): IREvent[] {
    const from = Math.max(0, Math.floor(Number.isFinite(startCycle) ? startCycle : 0))
    const to = Math.max(from + 1, Math.ceil(Number.isFinite(endCycle) ? endCycle : from + 1))
    const out: IREvent[] = []
    for (const [trackId, pattern] of this.songPatterns) {
      try {
        const haps = pattern.queryArc(from, to) as unknown[]
        for (const hap of haps) {
          out.push(normalizeStrudelHap(hap, trackId, this.lastIRNodeLocLookup ?? undefined, this.lastDeclaredLocations ?? undefined))
        }
      } catch { /* per-track query failure — skip this track */ }
    }
    return out
  }

  /**
   * The capture keys of every pattern the last evaluate() registered — the SAME
   * ids `getTimelineEvents` stamps on each hap as `trackId`, in the same order.
   *
   * Exists so a caller can tell "this track has not played yet" from "there is no
   * such track" (#1107). Deriving that from the events alone is impossible: a
   * track that has not sounded within the queried window contributes nothing to
   * distinguish itself from one that does not exist. Reading the REGISTERED set
   * is the only way to know the difference, and this is the one place that knows
   * it — `songPatterns` is private and mirrors what the repl actually plays, so a
   * `_`-muted track (never registered, `@strudel/core/repl.mjs:172-175`) is
   * correctly absent and can never be waited on.
   */
  getSongTrackIds(): string[] {
    return [...this.songPatterns.keys()]
  }

  /**
   * Returns per-track viz requests captured during the last evaluate() call.
   * Maps track keys ("$0", "$1", "d1") to viz descriptor IDs ("pianoroll", "scope").
   * Only patterns that called .viz("name") in user code appear in this map.
   * Empty Map before first evaluate or if no patterns use .viz().
   */
  getVizRequests(): Map<string, string> {
    return this.vizRequests
  }


  /** Register a handler for runtime audio errors (fires during scheduling, not evaluation). */
  setRuntimeErrorHandler(handler: (err: Error) => void): void {
    this.runtimeErrorHandler = handler
  }

  /** Returns all sound names registered after init() — useful for editor autocompletion. */
  getSoundNames(): string[] {
    return this.loadedSoundNames
  }

  dispose(): void {
    // #1627 — like stop(): a render still running must not restart playback
    // (on this repl, or on the one a later init() builds) when it finishes.
    this.transportHold.cancelResume()
    this.stopAskingForAudio?.()
    this.stopAskingForAudio = null
    this.stopListeningForPlayErrors?.()
    this.stopListeningForPlayErrors = null
    this.trackEnvelopes.dispose()
    this.trackEnvelopeListeners.clear()
    this.unregisterBackgroundRender()
    this.repl?.scheduler?.stop()
    this.hapStream.dispose()
    this.analyserNode?.disconnect()
    for (const analyser of this.trackAnalysers.values()) {
      try { analyser.disconnect() } catch { /* already disconnected */ }
    }
    this.trackAnalysers.clear()
    this.trackOrbit.clear()
    // Phase 20-07 — clear breakpoint registry + pause listeners on dispose.
    this.breakpointStore.dispose()
    this.pauseChangedListeners.clear()
    this.initialized = false
    // Drop the cached init alongside the flag, or a disposed engine would hand
    // every later caller a promise for a run whose repl has just been torn down.
    this.initPromise = null
    this.repl = null
  }

  /**
   * Query a pattern for its first non-silent hap within [0, lookahead) cycles
   * and return the orbit it uses. Default orbit is 1 (superdough's default).
   * Returns 1 for silent patterns — falls back to orbit 1 just like superdough.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveOrbit(pattern: any): number {
    const tryArc = (begin: number, end: number): number | null => {
      try {
        const haps = pattern.queryArc(begin, end) as Array<{ value?: { orbit?: number } }>
        for (const h of haps) {
          const o = h?.value?.orbit
          if (typeof o === 'number') return o
        }
      } catch { /* pattern may throw on empty/invalid arcs */ }
      return null
    }
    return tryArc(0, 1) ?? tryArc(0, 4) ?? 1
  }

  /**
   * Reconcile trackAnalysers against capturedPatterns.
   * - Creates analysers for new captureIds, tapped off their orbit's GainNode.
   * - Reuses analysers when (captureId, orbit) is unchanged.
   * - Rewires when a captureId's orbit changed (disconnect old, tap new).
   * - Removes+disconnects analysers for captureIds no longer present.
   *
   * Safe to call repeatedly. No-op if audioController isn't available yet.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rebuildTrackAnalysers(capturedPatterns: Map<string, any>): void {
    if (!this.audioController || !this.audioCtx) return

    const seen = new Set<string>()
    for (const [captureId, pattern] of capturedPatterns) {
      seen.add(captureId)
      const orbit = this.resolveOrbit(pattern)
      const existingOrbit = this.trackOrbit.get(captureId)
      const existingAnalyser = this.trackAnalysers.get(captureId)

      if (existingAnalyser && existingOrbit === orbit) continue // reuse — same tap

      // Force-create orbit if it doesn't exist yet — superdough lazy-creates
      // orbits on first hap, but we need the GainNode available NOW to tap.
      let orbitNode: { output?: AudioNode } | null = null
      try {
        orbitNode = this.audioController.getOrbit(orbit, [0, 1])
      } catch (err) {
        console.warn(`[stave] Could not resolve superdough orbit ${orbit} for "${captureId}":`, err)
      }
      const orbitOutput = orbitNode?.output
      if (!orbitOutput) {
        // No orbit available — if we had an analyser, keep it for now; consumer's
        // last value is better than suddenly null. Do not pollute the map.
        continue
      }

      // Reuse the existing AnalyserNode when the track persists but its orbit
      // changed. This keeps the AnalyserNode identity stable across
      // re-evaluates — consumers can hold references without flicker. We just
      // rewire the tap: disconnect old orbit source, connect new.
      const analyser = existingAnalyser ?? this.audioCtx.createAnalyser()
      if (!existingAnalyser) {
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.8
      } else {
        // Source changed — drop incoming connections so the analyser only hears
        // the new orbit. disconnect() with no args is fine on AnalyserNode; the
        // downstream consumers (viz canvases) read via getByteFrequencyData and
        // have no graph connection to sever.
        try { analyser.disconnect() } catch { /* noop */ }
      }
      try {
        orbitOutput.connect(analyser)
      } catch (err) {
        console.warn(`[stave] Could not tap orbit ${orbit} for "${captureId}":`, err)
        continue
      }
      this.trackAnalysers.set(captureId, analyser)
      this.trackOrbit.set(captureId, orbit)
    }

    // Purge analysers for captureIds no longer present.
    for (const captureId of [...this.trackAnalysers.keys()]) {
      if (seen.has(captureId)) continue
      const a = this.trackAnalysers.get(captureId)
      if (a) { try { a.disconnect() } catch { /* noop */ } }
      this.trackAnalysers.delete(captureId)
      this.trackOrbit.delete(captureId)
    }
  }
}

/**
 * Count the notes a LATE scheduler tick drops (#1348).
 *
 * Strudel's scheduler runs a tick every few tens of milliseconds and queries
 * the stretch of song since the last one. When a tick itself runs late (the
 * page was busy), it skips the query outright — "skip query: too late" — and
 * every note in that stretch is lost without ever reaching superdough
 * (`@strudel/core` `cyclist.mjs:52-56`). That, not a note arriving late at
 * superdough, is how a busy page drops notes.
 *
 * The stretches are contiguous: each tick queries from where the last one
 * ended (`begin = this.lastEnd`, `:47-50`), skipped or not. So a gap between
 * one scheduler query's end and the next one's start is exactly what was
 * skipped, and its onsets are the dropped notes. Only the scheduler's own
 * queries are watched — it tags them `{ cyclist: 'cyclist' }` (`:59`); a
 * visualiser querying any arc it likes passes straight through. A query that
 * starts EARLIER than the last one ended is a restart (`stop()` resets
 * `lastEnd` to 0, `:120`), not a gap.
 *
 * The pattern is wrapped where the scheduler keeps it, so every way a pattern
 * reaches it (`setPattern`, or a direct assignment) is covered, and the wrapper
 * inherits everything else from the real pattern.
 *
 * #2173 — `inQuery`, when given, is above zero exactly while one of the
 * scheduler's own queries runs. Strudel catches an error raised there and only
 * logs it, synchronously (`pattern.mjs` `queryArc`, `tonal.mjs`), so a log
 * listener that reads this counter knows the error came from the pattern being
 * played, not from a visualiser or the quiet timeline evaluate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function watchSkippedTicks(scheduler: any, onDropped: (notes: number) => void, inQuery?: { depth: number }): void {
  if (!scheduler || typeof scheduler !== 'object') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stored: any = scheduler.pattern ? watched(scheduler.pattern, onDropped, inQuery) : scheduler.pattern
  Object.defineProperty(scheduler, 'pattern', {
    configurable: true,
    enumerable: true,
    get: () => stored,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: (pat: any) => {
      stored = pat ? watched(pat, onDropped, inQuery) : pat
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function watched(pat: any, onDropped: (notes: number) => void, inQuery?: { depth: number }): any {
  if (typeof pat.queryArc !== 'function') return pat
  let expected: number | null = null
  const w = Object.create(pat)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  w.queryArc = function (begin: number, end: number, state?: any) {
    if (state?.cyclist !== 'cyclist') return pat.queryArc(begin, end, state)
    if (inQuery) inQuery.depth++
    try {
      if (expected !== null && begin > expected) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lost = pat.queryArc(expected, begin, state).filter((h: any) => h.hasOnset?.()).length
          if (lost > 0) onDropped(lost)
        } catch {
          /* counting is best-effort; it must never break playback */
        }
      }
      expected = end
      return pat.queryArc(begin, end, state)
    } finally {
      if (inQuery) inQuery.depth--
    }
  }
  return w
}

/**
 * The event Strudel's logger dispatches on `document` (`@strudel/core/logger.mjs`,
 * `logKey`). A test pins it to the real `logger.key`, so a rename upstream turns
 * red instead of silently muting #2173.
 */
export const STRUDEL_LOG_EVENT = 'strudel.log'

/**
 * #2173 — the error a `strudel.log` entry reports, or `null` when it is not one
 * Stave should raise. Strudel's `errorLogger` writes `[origin] error: message`
 * (`@strudel/core/logger.mjs`). `[eval]` entries are left out: an evaluate
 * error already reaches Stave through `onEvalError`, and raising it here too
 * would show it twice.
 */
export function playTimeErrorFrom(detail: unknown): Error | null {
  const message = (detail as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return null
  const m = message.match(/^\[([^\]]+)\] error: ([\s\S]+)$/)
  if (!m || m[1] === 'eval') return null
  return new Error(m[2])
}

/**
 * #2173 — raise every error Strudel logs while `inQuery` says the scheduler's
 * own query is running. Strudel's logger dispatches its event synchronously,
 * inside the query that failed, so the counter is still up when it arrives.
 * Returns the function that removes the listener; a no-op without a document.
 */
export function listenForPlayTimeErrors(
  logKey: string,
  inQuery: { depth: number },
  onError: (error: Error) => void,
): () => void {
  if (typeof document === 'undefined') return () => {}
  const onLog = (event: Event) => {
    if (inQuery.depth === 0) return
    const error = playTimeErrorFrom((event as CustomEvent).detail)
    if (error) onError(error)
  }
  document.addEventListener(logKey, onLog)
  return () => document.removeEventListener(logKey, onLog)
}
