import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { HapStream, HapEvent } from '../../engine/HapStream'
import type { IRPattern } from '../../codeView'
import type { IREvent } from '../../codeView'
import type { VizRenderer } from '../types'
import { getVizConfig } from '../vizConfig'
import { SignalBus } from '../signals/SignalBus'
import { buildHydraStaveBag } from './hydraStaveBag'
import { resolveAliasesForEngine, DEFAULT_VIZ_ENGINE } from '../signals/aliasMap'
import { getStoredSignalAliases } from '../../workspace/editorRegistry'
import { perf } from '../../perf/profiler'
import { VizRendererBase } from './VizRendererBase'

/** Monotone id source so each hydra instance gets a stable profiler key
 *  (`hydra#1`, …) for per-instance frame/fps tracking (#228). */
let hydraPerfSeq = 0

/**
 * Stave-specific bag exposed to `.hydra` sketches as the second
 * function argument. Mirrors the `stave` namespace convention
 * already used by p5 sketches (see `p5Compiler.ts`). Stays present
 * across re-evaluations — `HydraVizRenderer.update()` rebinds the
 * fields on the same object so long-lived closures inside the
 * user sketch observe live references, not stale snapshots.
 *
 * `scheduler` / `tracks` are `null` / empty when no pattern runtime
 * is publishing — sketches must optional-chain (consistent with the
 * demo-mode path in `compiledVizProvider`).
 */
export interface HydraStaveBag {
  /**
   * The viz call's options bag — `.viz('mysketch', { intensity: 0.8 })` reads as
   * `stave.options.intensity` (#883). Mirrors p5's `stave.options`.
   *
   * A GETTER over the renderer's live slot, not a captured value: the slot is
   * REPLACED on every re-publish (so a removed key stops applying), and this bag
   * is built once per mount and mutated in place. Capturing the bag here would
   * pin the first evaluate's options forever.
   *
   * Empty object when the viz was called with no argument — never undefined, so
   * `stave.options.foo` is always a safe read from a sketch.
   */
  readonly options: Record<string, unknown>
  /** Combined pattern scheduler. Has `now()` and `query(begin, end)`. */
  scheduler: IRPattern | null
  /** Per-track schedulers keyed by trackId (e.g. "$0", "drums"). */
  tracks: Map<string, IRPattern>
  /**
   * Strudel-style pattern-to-hydra sugar. Returns a function Hydra can
   * call per frame:
   *
   *   osc(() => stave.H('drums')() * 10).out(o0)
   *
   * Equivalent Strudel idiom is `osc(H('drums')).out(o0)`. The outer
   * call picks the track; the inner call samples the track's current
   * event and reads `field` (default: `gain`). Returns `0` when no
   * event is active or the track doesn't exist — so sketches never
   * NaN a shader uniform even during silence.
   */
  H: (trackId: string, field?: keyof IREvent) => () => number

  // ── Signal namespace (Phase 21 / #351, D-01 hydra shape) ──────────────────
  /**
   * The single `sig` namespace (#351). One callable carrying every Stave signal
   * as `() => number` thunks (so hydra calls them natively each frame), plus the
   * per-sound/per-track accessor and master DSP:
   *
   *   osc(() => stave.sig.kick() * 10).out(o0)        // per-drum envelope thunk
   *   osc(() => stave.sig('bd').env() * 10).out(o0)   // one sound
   *   shape(() => stave.sig('bd').fft[0] * 4).out(o0) // arrays index natively
   *   stave.sig.track('$0').color()
   *   osc(() => stave.sig.rms() * 10).out(o0)         // master scalar thunk
   *   shape(() => stave.sig.fft[2] * 6).out(o0)        // master spectrum array
   *
   * The per-drum scalars (`sig.kick`…`sig.tom`), global `sig.keyVelocity`, and
   * master DSP (`sig.rms`…`sig.treble`) are all `() => number` thunks ON `sig`.
   * `sig('bd')` / `sig.track('$0')` return per-reading thunks; `sig.fft`/`sig.wave`
   * are live arrays; `sig.tracks`/`sig.sounds` enumerate. The bus ticks ONCE per
   * rAF in `pumpAudio` (U2 — never inside a thunk); thunks are pure reads.
   */
  sig: HydraSigAccessor

  // ── Custom alias thunks (Phase 21 aliases) ─────────────────────────────────
  // A user-defined alias (e.g. `kick → bd`) is injected at mount as a
  // `() => number` thunk on the bag (the bag IS `stave`, so `stave.kick()`
  // works natively in hydra — there is no bare scope). The index signature
  // lets `bag[name] = () => bus.envValue(name)` typecheck under strict TS
  // without widening the named fields above. Custom names that collide with a
  // built-in bag property are skipped (the typed field wins).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [customAlias: string]: any
}

/** A per-sound or per-track reading exposed as `() => value` thunks (D-01).
 *  DSP scalars (`rms`/`bass`/`mid`/`treble`) are thunks (same shape as `.env`);
 *  DSP arrays (`fft`/`wave`) are LIVE `number[]` so hydra indexes them natively
 *  (`() => u('bd').fft[i]`) — NOT thunk-of-number per element, NOT thunk-of-array. */
export interface HydraSignalThunks {
  env: () => number
  velocity: () => number
  note: () => number | string | null
  color: () => string | null
  // ── DSP feed (analyser — Slice 2) ─────────────────────────────────────────
  /** Time-domain RMS, 0..1 (thunk, re-reads the bus each call). */
  rms: () => number
  /** Low-band magnitude, 0..1 (thunk). */
  bass: () => number
  /** Mid-band magnitude, 0..1 (thunk). */
  mid: () => number
  /** High-band magnitude, 0..1 (thunk). */
  treble: () => number
  /** Live normalized magnitude spectrum, `number[]` (index natively). */
  fft: number[]
  /** Live time-domain waveform -1..1, `number[]` (index natively). */
  wave: number[]
}

/** The callable `u(...)` with attached `.track`/`.tracks`/`.sounds` props AND
 *  the MASTER-mix DSP feed (Slice 2): scalar thunks + live arrays. */
export interface HydraSigAccessor {
  (sound: string): HydraSignalThunks
  /** Per-track reading, keyed on the scheduler key space (`$0`/`drums`). */
  track: (id: string) => HydraSignalThunks
  /** Enumerate published track keys (scheduler key space). */
  tracks: string[]
  /** Enumerate distinct sounds seen through the envelope feed. */
  sounds: string[]
  // ── Per-drum envelopes (0..1 thunks; were `uKick…uTom`) ────────────────────
  kick: () => number
  snare: () => number
  hat: () => number
  openHat: () => number
  clap: () => number
  rim: () => number
  tom: () => number
  /** Active event velocity, global, 0..1 thunk (was `uKeyVelocity`). */
  keyVelocity: () => number
  // ── Master-mix DSP (Slice 2) — `sig.rms()` thunk, `sig.fft` live array ─────
  /** Master-mix time-domain RMS, 0..1 (thunk). */
  rms: () => number
  /** Master-mix low-band magnitude, 0..1 (thunk). */
  bass: () => number
  /** Master-mix mid-band magnitude, 0..1 (thunk). */
  mid: () => number
  /** Master-mix high-band magnitude, 0..1 (thunk). */
  treble: () => number
  /** Live master-mix magnitude spectrum, `number[]` (index natively). */
  fft: number[]
  /** Live master-mix waveform -1..1, `number[]` (index natively). */
  wave: number[]
}

export type HydraPatternFn = (synth: any, stave: HydraStaveBag) => void

/**
 * Energy envelope derived from HapStream events.
 * When per-track audio routing isn't available, this provides per-track
 * reactivity by converting note events into synthetic FFT-like bins.
 *
 * Bins are mapped by MIDI pitch:
 *   bin 0 = bass      (MIDI  0–35)
 *   bin 1 = low-mid   (MIDI 36–59)
 *   bin 2 = high-mid  (MIDI 60–83)
 *   bin 3 = treble    (MIDI 84+)
 *   unpitched (drums) → bin 0 + bin 1 (broad energy)
 */
class HapEnergyEnvelope {
  /** Per-bin energy levels (0..1), decayed each frame. */
  readonly bins: number[]
  private readonly decay: number
  private readonly numBins: number

  constructor(numBins: number, decay = 0.92) {
    this.numBins = numBins
    this.bins = new Array(numBins).fill(0)
    this.decay = decay
  }

  /** Call when a hap event fires. */
  onHap(event: HapEvent): void {
    const gain = Math.min(1, Math.max(0, event.hap?.value?.gain ?? 1))
    const midi = event.midiNote

    if (midi != null) {
      // Pitched — map to bin by MIDI range
      const bin = Math.min(this.numBins - 1, Math.floor((midi / 127) * this.numBins))
      this.bins[bin] = Math.min(1, this.bins[bin] + gain)
    } else {
      // Unpitched (drums) — distribute across bass bins
      this.bins[0] = Math.min(1, this.bins[0] + gain * 0.8)
      if (this.numBins > 1) {
        this.bins[1] = Math.min(1, this.bins[1] + gain * 0.4)
      }
    }
  }

  /** Call once per animation frame to apply decay. */
  tick(): void {
    for (let i = 0; i < this.numBins; i++) {
      this.bins[i] *= this.decay
    }
  }
}

/**
 * VizRenderer that uses hydra-synth for audio-reactive WebGL visuals.
 * Lazily loads hydra-synth on first mount to avoid bloating the main bundle.
 *
 * Audio source priority:
 *   1. AnalyserNode (real FFT) — always preferred when available.
 *   2. HapStream energy envelope (synthetic FFT from note events) —
 *      ONLY used as a fallback when no analyser is published. The
 *      envelope is only useful when there's no shared audio routing
 *      (e.g., a future runtime that emits hap events without exposing
 *      an analyser); in every current source — Strudel, the built-in
 *      examples, the (future) Sonic Pi runtime — an analyser is
 *      published and takes priority.
 *
 * The historical priority was (hapStream → envelope) → (analyser),
 * which broke audio reactivity for every built-in example source
 * because those sources published a HapStream that they never
 * actually emitted on. The renderer would lock onto the silent
 * envelope and ignore the working analyser, leaving s.a.fft[] at
 * all-zero forever and the shader visually unresponsive. Issue #7.
 *
 * Reads `hydraAudioBins` from the active VizConfig.
 *
 * ## Pause / loop ownership
 *
 * Hydra is constructed with `autoLoop: false` so the renderer (not
 * hydra) owns the animation loop. Our `pumpAudio` rAF callback both
 * polls the FFT data into `s.a.fft[]` AND calls `hydra.tick(time)` to
 * advance the shader by exactly one frame. This single-loop ownership
 * is what makes `pause()` actually pause:
 *   - With `autoLoop: true` (the old behavior), hydra's internal rAF
 *     keeps running independently. Setting our `paused` flag would
 *     stop FFT polling but hydra would keep rendering its last shader
 *     state, so the canvas never visibly froze. The user-visible
 *     symptom: the Stop button did nothing on hydra previews.
 *   - With `autoLoop: false`, cancelling our rAF in `pause()` halts
 *     the only path that ticks hydra. Resume re-arms the rAF and
 *     hydra picks up where it left off.
 *
 * The `hydraAutoLoop` config flag is no longer read — pause requires
 * us to own the loop. The flag is left in `vizConfig.ts` for now and
 * will be removed in a follow-up cleanup.
 */
export class HydraVizRenderer extends VizRendererBase {
  private hydra: any = null
  private canvas: HTMLCanvasElement | null = null
  private analyser: AnalyserNode | null = null
  private freqData: Uint8Array<ArrayBuffer> | null = null
  private rafId: number | null = null
  private paused = false
  private destroyed = false
  private hapStream: HapStream | null = null
  private envelope: HapEnergyEnvelope | null = null
  private hapHandler: ((e: HapEvent) => void) | null = null
  private useEnvelope = false
  /** Stable per-instance profiler key (`hydra#N`) — frame/fps + bus/draw timing (#228). */
  private readonly perfId = `hydra#${++hydraPerfSeq}`
  /**
   * Per-renderer named-signal bus (Phase 21). Generalizes `H()` /
   * `HapEnergyEnvelope`: per-sound `.env` (bump+decay) + per-track query
   * (`.velocity`/`.note`/`.color`). Fed UNCONDITIONALLY — NOT analyser-gated
   * like the envelope (BLOCK-1): the bus is IR-grounded and must stay live
   * whenever a real analyser is published (which is normal playback), or
   * `uKick` is dead in the headline use case.
   */
  private bus: SignalBus | null = new SignalBus()
  /**
   * The bus's own HapStream subscription — SEPARATE from `hapHandler` (the
   * analyser-fallback envelope handler) so `destroy()` can off it
   * independently and unconditionally. The bus feed is never gated on
   * `useEnvelope`.
   */
  private busHapHandler: ((e: HapEvent) => void) | null = null
  /**
   * Live `stave` bag handed to the user's sketch function. Built once
   * per mount; `update()` mutates its fields in place so sketches that
   * capture `scheduler` or `tracks` in a per-frame closure observe the
   * latest refs without needing a re-compile. This is the same
   * live-ref idiom the p5 sketch bag uses.
   *
   * `H` closes over `this.staveBag` (the object, not the current field
   * values) so each per-frame invocation reads the current scheduler
   * / tracks — survives `update()` re-assignments. No rebuild needed
   * when the pattern runtime swaps underneath.
   */
  private staveBag: HydraStaveBag
  constructor(private pattern?: HydraPatternFn) {
    super()
    // The bag's signal thunks read `this.bus` LIVE each call (the bus instance is
    // stable for the renderer's life; only its scheduler refs swap, in-place, on
    // `update()`). Built by the shared pure builder so the worker host (kind
    // 'hydra') produces the identical bag from its own bus — no fork (B-5).
    this.staveBag = buildHydraStaveBag(this.bus as SignalBus, this.optionsRef)
  }

  protected onMount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void
  ): void {
    perf.gauge('viz.hydra', 1) // live hydra-instance gauge (#228); -1 in destroy()
    try {
      const config = getVizConfig()

      // Audio source resolution — see class jsdoc for the priority
      // rationale (issue #7).
      this.analyser = components.audio?.analyser ?? null
      this.hapStream = components.streaming?.hapStream ?? null

      // Scheduler + per-track schedulers — forwarded verbatim to the
      // `stave` bag so user sketches can read pattern state via the
      // IRPattern interface (`scheduler.now()`, `scheduler.query()`).
      // Issue #32: without this, hydra sketches were FFT-reactive only
      // — no path for pattern values to drive shader uniforms.
      this.staveBag.scheduler = components.queryable?.scheduler ?? null
      this.staveBag.tracks =
        components.queryable?.trackSchedulers ?? new Map()

      // ── Named signal bus feed (Phase 21) — UNCONDITIONAL (BLOCK-1) ───────
      // Bind the live scheduler refs, then subscribe the bus's `.env` feed
      // to the HapStream. This MUST live OUTSIDE the `if (this.analyser) …
      // else if (this.hapStream) …` block below: the envelope's `.on()` in
      // the `else if` branch is SKIPPED whenever a real analyser is present
      // (normal playback always publishes one — compiledVizProvider.tsx:297).
      // The bus is IR-grounded (works with zero audio routing) and must NOT
      // inherit the envelope's analyser gating, or `uKick` is dead in real
      // playback (the headline). Its handler ref is SEPARATE from
      // `hapHandler` so `destroy()` offs it independently.
      this.bus?.bindScheduler(
        components.queryable?.scheduler,
        components.queryable?.trackSchedulers
      )
      // Bind the orbit analysers (Slice 2) — UNCONDITIONAL, same BLOCK-1
      // discipline as bindScheduler: this MUST live OUTSIDE the
      // `if (this.analyser) … else if …` block below. Those branches are
      // SKIPPED whenever a real analyser is present (normal playback), which is
      // exactly when the DSP feed (`u('bd').rms`/`.fft`) must be live. The bus
      // internally degrades absent analysers to 0/[] — never gate the bind.
      this.bus?.bindAnalysers(
        components.audio?.analyser,
        components.audio?.trackAnalysers
      )
      // ── Custom alias merge + thunk injection (Phase 21 aliases) ──────────
      // Read the impure settings surface HERE (the renderer, NOT the bus —
      // P12) and build the merged map ONCE: built-ins first, custom LAST so a
      // user override WINS on collision. Push it into the (pure) bus, then
      // expose every custom name as a `stave.<name>()` thunk on the bag (the
      // bag IS `stave`; hydra has no bare scope). The thunk reads
      // `bus.envValue(name)` LIVE each call (U2 — never captured), resolving
      // through the alias map we just set. Skip names already on the bag so a
      // collision with a built-in thunk (`uKick`, `u`, `H`, …) is preserved.
      // Resolve built-ins + custom aliases for the ACTIVE viz engine (Strudel
      // today; the single wire-point — when Sonic Web lands, source the
      // engine from the running LiveCodingEngine here). Custom wins on collision.
      const mergedAliases = resolveAliasesForEngine(
        getStoredSignalAliases(),
        DEFAULT_VIZ_ENGINE,
      )
      this.bus?.setAliases(mergedAliases)
      const bus = this.bus
      if (bus) {
        for (const name of Object.keys(mergedAliases)) {
          if (name in this.staveBag) continue
          this.staveBag[name] = () => bus.envValue(name)
        }
      }
      if (this.hapStream && this.bus) {
        this.busHapHandler = (e: HapEvent) => this.bus?.bump(e)
        this.hapStream.on(this.busHapHandler)
      }

      if (this.analyser) {
        // Real-FFT path. Allocate the byte buffer once; pumpAudio
        // reads into it on every frame.
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
        this.useEnvelope = false
      } else if (this.hapStream) {
        // Fallback: synthesize FFT from hap events. Used only when
        // no analyser is published.
        this.envelope = new HapEnergyEnvelope(config.hydraAudioBins)
        this.hapHandler = (e: HapEvent) => this.envelope?.onHap(e)
        this.hapStream.on(this.hapHandler)
        this.useEnvelope = true
      }
      // If neither is present we fall through with all flags false;
      // pumpAudio will still tick hydra (the shader's time-driven
      // baseline animates regardless), but s.a.fft[] stays at zero.

      this.canvas = document.createElement('canvas')
      this.canvas.width = size.w
      this.canvas.height = size.h
      this.canvas.style.width = '100%'
      this.canvas.style.height = '100%'
      container.appendChild(this.canvas)

      this.initHydra(size).catch(onError)
    } catch (e) {
      onError(e as Error)
    }
  }

  private async initHydra(size: { w: number; h: number }): Promise<void> {
    const { default: Hydra } = await import('hydra-synth')
    const config = getVizConfig()

    if (!this.canvas || this.destroyed) return // destroyed before load finished

    this.hydra = new Hydra({
      canvas: this.canvas,
      width: size.w,
      height: size.h,
      detectAudio: false,
      makeGlobal: false,
      // We OWN the animation loop (see class jsdoc) — hydra must
      // not run its own rAF, or pause() can't actually halt the
      // shader render. `pumpAudio` calls `hydra.tick(time)` itself.
      autoLoop: false,
    })

    const synth = this.hydra.synth

    // With makeGlobal:false, the audio object is on the Hydra instance (this.hydra.a),
    // NOT on synth. Bridge it so preset patterns can use s.a.fft[] naturally.
    const audio = this.hydra.a
    if (audio) {
      synth.a = audio
      if (typeof audio.setCutoff === 'function') audio.setCutoff(config.hydraAudioBins)
      if (typeof audio.setBins === 'function') audio.setBins(config.hydraAudioBins)
      if (!Array.isArray(audio.fft) || audio.fft.length < config.hydraAudioBins) {
        audio.fft = new Array(config.hydraAudioBins).fill(0)
      }
    } else {
      synth.a = { fft: new Array(config.hydraAudioBins).fill(0) }
    }

    if (this.pattern) {
      this.pattern(synth, this.staveBag)
    } else {
      this.defaultPattern(synth)
    }

    // Schedule the first rAF — don't tick hydra synchronously here.
    // The next animation frame draws the first shader output. This
    // way pause() is observable from frame 1: if pause() runs before
    // the first rAF fires, no tick ever happens.
    if (!this.paused && !this.destroyed && this.rafId == null) {
      this.rafId = requestAnimationFrame(this.pumpAudio)
    }
  }

  private defaultPattern(s: any): void {
    s.osc(10, 0.1, () => s.a.fft[0] * 4)
      .color(1.0, 0.5, () => s.a.fft[1] * 2)
      .rotate(() => s.a.fft[2] * 6.28)
      .modulate(s.noise(3, () => s.a.fft[3] * 0.5), 0.02)
      .out()
  }

  private pumpAudio = (now?: number): void => {
    // Defensive: if pause() ran between scheduling this rAF and the
    // browser firing it, bail out without re-scheduling. (pause()
    // sets rafId=null and would normally have already called
    // cancelAnimationFrame, but the browser may have already queued
    // the callback at that point — this guard makes the cancellation
    // race-free.)
    if (this.paused || this.destroyed) {
      this.rafId = null
      return
    }
    const a = this.hydra?.synth?.a
    if (a?.fft) {
      // Real-FFT path takes priority when an analyser is published
      // (issue #7). The envelope path is only used when no analyser
      // is available — see mount() for the resolution logic.
      if (this.analyser && this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData)
        const numBins = getVizConfig().hydraAudioBins
        const binSize = Math.floor(this.freqData.length / numBins)
        for (let i = 0; i < numBins; i++) {
          let sum = 0
          for (let j = 0; j < binSize; j++) {
            sum += this.freqData[i * binSize + j]
          }
          a.fft[i] = sum / (binSize * 255)
        }
      } else if (this.useEnvelope && this.envelope) {
        // Fallback: synthetic energy from hap events.
        this.envelope.tick()
        const numBins = getVizConfig().hydraAudioBins
        for (let i = 0; i < numBins; i++) {
          a.fft[i] = this.envelope.bins[i]
        }
      }
    }
    // ── Named signal bus tick (Phase 21) — UNCONDITIONAL (BLOCK-1) ─────────
    // Tick the bus EXACTLY ONCE per rAF, guarded ONLY by the paused/destroyed
    // early-return above — NOT by the analyser/envelope branch. The
    // `this.envelope?.tick()` at the FFT block above is analyser-gated (only
    // runs in envelope-fallback mode); the bus must decay + re-snapshot every
    // frame regardless of the FFT source, or `uKick` is dead under real
    // playback (BLOCK-1). `tick()` (decay) then `refreshActive(now)`
    // (scheduler snapshot) — in that order, ONCE (U2 — never in a thunk).
    // Profiler (#228): pumpAudio is the hydra rAF body → one frame beat here +
    // time the bus's per-frame work. Both no-op when profiling is disabled.
    perf.frame(this.perfId)
    if (this.bus) {
      perf.begin('hydra.bus')
      this.bus.tick()
      this.bus.refreshActive(this.bus.now())
      // readAudio MUST run AFTER refreshActive (Slice 2): `audioFor` resolves a
      // sound → its trackKey via `activeByTrack`, which refreshActive populates.
      // Wrong order = sound-keyed DSP reads stale/empty. Once per frame (U2),
      // reusing this same tick site — no second rAF.
      this.bus.readAudio()
      perf.end('hydra.bus')
    }

    // We own the loop — tick hydra exactly once per rAF. Without
    // this call hydra would never advance its shader because we
    // construct it with `autoLoop: false`. The `tick(time)`
    // signature matches what hydra-synth uses internally when
    // `autoLoop: true` mode runs the loop on its own.
    if (this.hydra && typeof this.hydra.tick === 'function') {
      perf.begin('hydra.draw')
      try {
        this.hydra.tick(now ?? performance.now())
      } catch {
        // Non-fatal — a broken shader shouldn't tear down the
        // renderer; the error will already have surfaced via
        // hydra's onError path or as a console message.
      } finally {
        perf.end('hydra.draw') // close the span even if tick() threw (#228)
      }
    }
    this.rafId = requestAnimationFrame(this.pumpAudio)
  }

  protected onUpdate(components: Partial<EngineComponents>): void {
    const newAnalyser = components.audio?.analyser ?? null
    if (newAnalyser !== this.analyser) {
      this.analyser = newAnalyser
      // Real-FFT path always wins when an analyser arrives (issue
      // #7). Re-allocate freqData for the new analyser, and flip
      // off the envelope path so future frames pull from the real
      // analyser instead of the (possibly empty) envelope.
      this.freqData = newAnalyser
        ? new Uint8Array(newAnalyser.frequencyBinCount)
        : null
      if (newAnalyser) {
        this.useEnvelope = false
      }
    }

    // Rebind scheduler fields in place. User sketch closures hold a
    // reference to `this.staveBag`; mutating fields is what makes the
    // live-ref work without re-compiling. Identity-guard unnecessary
    // — a re-assign is free when the source is already the same ref.
    this.staveBag.scheduler = components.queryable?.scheduler ?? null
    this.staveBag.tracks =
      components.queryable?.trackSchedulers ?? this.staveBag.tracks

    // Re-bind the bus's live scheduler refs in place (Phase 21) so the SAME
    // thunk closures captured by the sketch observe the swapped scheduler /
    // trackSchedulers without re-compiling — mirrors the staveBag in-place
    // rebind discipline above. Fall back to the current tracks ref (not an
    // empty Map) so a partial update doesn't blank the track schedulers.
    this.bus?.bindScheduler(
      components.queryable?.scheduler ?? null,
      components.queryable?.trackSchedulers ?? this.staveBag.tracks
    )
    // Re-bind the orbit analysers in place (Slice 2) — same live-ref discipline
    // as the scheduler rebind above. A fresh engine re-publishes new analyser
    // nodes; the SAME bus must point at them so the DSP feed stays live across
    // re-evaluates. Unconditional (BLOCK-1) — the bus degrades absent → 0/[].
    this.bus?.bindAnalysers(
      components.audio?.analyser ?? null,
      components.audio?.trackAnalysers
    )
  }

  resize(w: number, h: number): void {
    if (this.canvas) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.hydra?.setResolution?.(w, h)
  }

  pause(): void {
    this.paused = true
    // Cancel the animation loop synchronously so hydra stops
    // rendering on the next frame. The pumpAudio guard at the top
    // also bails if `paused` is true, in case the browser already
    // queued the callback before cancelAnimationFrame could run.
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resume(): void {
    this.paused = false
    // Re-arm the loop. Idempotent: if a callback is already
    // scheduled (e.g., resume() called twice), the second call is
    // a no-op because rafId is non-null.
    if (this.rafId == null && !this.destroyed) {
      this.rafId = requestAnimationFrame(this.pumpAudio)
    }
  }

  destroy(): void {
    this.destroyed = true
    perf.gauge('viz.hydra', -1) // #228 — release the live-instance gauge + frame history
    perf.dropFrames(this.perfId)
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    // Unsubscribe from HapStream
    if (this.hapStream && this.hapHandler) {
      this.hapStream.off(this.hapHandler)
      this.hapHandler = null
    }
    // Unsubscribe the bus feed UNCONDITIONALLY (Phase 21, BLOCK-1) — it is a
    // SEPARATE subscription from `hapHandler` (the analyser-fallback envelope
    // handler) and exists regardless of FFT mode, so its teardown must not be
    // gated on `useEnvelope` or the `hapHandler` guard above.
    if (this.hapStream && this.busHapHandler) {
      this.hapStream.off(this.busHapHandler)
      this.busHapHandler = null
    }
    this.bus = null
    this.canvas?.remove()
    this.canvas = null
    this.hydra = null
    this.analyser = null
    this.freqData = null
    this.envelope = null
    this.hapStream = null
    this.staveBag.scheduler = null
    this.staveBag.tracks = new Map()
  }
}
