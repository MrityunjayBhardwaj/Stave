/**
 * SignalBus — renderer-agnostic per-sound / per-track musical-signal bus.
 *
 * PURE module (P12): imports ONLY types + `noteToMidi`. NO p5 / hydra /
 * renderer import — anything that transitively imports the bus (every unit
 * test) must load in isolation. Renderers WRAP the shape (p5 getter-numbers,
 * hydra `() => number` thunks, D-01); the bus only knows numbers, maps, and
 * the alias constant.
 *
 * It generalizes two pre-existing per-renderer feeds:
 *   - `.env`  — `HapEnergyEnvelope`'s bump+decay (decay 0.92, clamp 0..1),
 *               but keyed `Map<sound, level>` on `e.s` ('bd'), NOT by MIDI bin.
 *   - instantaneous (`.velocity`/`.note`/`.color`) — `H()`'s query-at-now read
 *               (`scheduler.query(now, now + ε)`), ε = 0.001.
 *
 * ## Two key spaces (RESEARCH §5 — TRAP)
 * `track(id)` keys on the SCHEDULER key space — `trackSchedulers.get(id)` whose
 * keys are `$0`/`$1` (anonymous) or `d1`/`drums` (named). It does NOT key on
 * `IREvent.trackId` (which is `d1`/`d{N}` and DIFFERS from the scheduler key for
 * anonymous blocks). Keying on `IREvent.trackId` silently breaks anonymous-block
 * addressing.
 *
 * ## Per-field feed (RESEARCH §5 — TRAP)
 * `.env`      ← the envelope feed (`bump()` + `tick()` decay).
 * `.velocity` ← the SCHEDULER-query feed (active IREvent). `HapEvent` carries NO
 *               `velocity` — sourcing it from the envelope feed = silent ZERO.
 * `.note`     ← the scheduler-query feed (preserves the user's form, name|number).
 * `.color`    ← either feed (prefer the active IREvent; fall back to last bump).
 */

import { noteToMidi } from '../../engine/noteToMidi'
import type { IRPattern } from '../../codeView'
import type { IREvent } from '../../codeView'
import { ALIAS_MAP } from './aliasMap'

/** Minimal shape the `.env` feed consumes off a HapStream event.
 *  We deliberately type only the fields the bus reads (`s`, optional gain via
 *  `hap.value.gain`, optional color) so the bus does NOT import HapEvent and
 *  stays decoupled from the engine event class (P12 — structural typing). */
export interface BusHapEvent {
  /** Instrument/sample name — the env-map key. */
  s: string | null
  /** From `.color()` in the pattern (last-bumped fallback for `.color`). */
  color?: string | null
  /** Full Strudel hap — gain is read from `hap?.value?.gain`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hap?: any
}

/** What an accessor returns for a single sound or track. */
export interface SignalReading {
  /** Decayed envelope level 0..1 (envelope feed). */
  env: number
  /** Active-event velocity 0..1 (scheduler feed — NOT the envelope). */
  velocity: number
  /** Active-event note in the user's form (name|number|null — scheduler feed). */
  note: number | string | null
  /** Display color (active event preferred, else last-bumped hap). */
  color: string | null
  // ── DSP feed (analyser — Slice 2) ─────────────────────────────────────────
  /** Time-domain RMS 0..1 from the resolved analyser. 0 if no analyser bound. */
  rms: number
  /** Mean of the LOW third of `fft` (0..1). 0 if no analyser bound. */
  bass: number
  /** Mean of the MID third of `fft` (0..1). 0 if no analyser bound. */
  mid: number
  /** Mean of the HIGH third of `fft` (0..1). 0 if no analyser bound. */
  treble: number
  /** Normalized magnitude spectrum, `FFT_BINS` buckets, each 0..1. `[]` if no
   *  analyser bound (never NaN). */
  fft: number[]
  /** Time-domain waveform normalized -1..1. `[]` if no analyser bound. */
  wave: number[]
}

/** Master/per-analyser DSP reading — the audio half of a `SignalReading`. */
export interface AudioReading {
  rms: number
  bass: number
  mid: number
  treble: number
  fft: number[]
  wave: number[]
}

/** A zero DSP reading — the graceful-degradation value when no analyser is
 *  bound or resolvable. Empty arrays + 0 scalars, NEVER NaN (pre-mortem). */
const ZERO_AUDIO: AudioReading = {
  rms: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  fft: [],
  wave: [],
}

/** ε window for the query-at-now read — matches `H()`'s 1ms window
 *  (`HydraVizRenderer.ts:175`): below one audio sample at 48kHz, so a
 *  correctly-scheduled event is caught at least once. */
const EPSILON = 0.001

/** Decay constant — reused from `HapEnergyEnvelope` (`HydraVizRenderer.ts:60`). */
const DEFAULT_DECAY = 0.92

/** Number of normalized spectrum buckets the bus publishes on `.fft`. The raw
 *  analyser `frequencyBinCount` (typically 1024) is downsampled into this many
 *  buckets — the SAME `sum/(binSize*255)` scheme `HydraVizRenderer.pumpAudio`
 *  uses (`:447-455`). 32 is a documented default; `bass/mid/treble` are the
 *  means of the low / mid / high THIRD of these bins. */
const FFT_BINS = 32

/** Structural shape the bus reads off a Web-Audio `AnalyserNode` (DOM type).
 *  Typed minimally so tests can feed a plain stub (P12 — structural typing,
 *  no DOM-lib dependency for the fake). */
export interface BusAnalyser {
  /** Real `AnalyserNode` exposes `frequencyBinCount = fftSize / 2`. */
  frequencyBinCount: number
  /** Fill `arr` with the current magnitude spectrum (0..255 per bin). */
  getByteFrequencyData(arr: Uint8Array): void
  /** Fill `arr` with the current time-domain waveform (0..255, 128 = silence). */
  getByteTimeDomainData(arr: Uint8Array): void
}

export class SignalBus {
  /** Per-sound envelope levels (0..1), decayed each frame. Keyed on `e.s`. */
  private readonly envMap = new Map<string, number>()
  /** Last-bumped color per sound — the `.color` fallback feed. */
  private readonly colorMap = new Map<string, string | null>()
  private readonly decay: number
  /** Active alias map (built-ins + any merged custom). NOT `readonly` — the
   *  renderer pushes the merged map in via `setAliases` at mount, mirroring the
   *  in-place rebind discipline of `bindScheduler`/`bindAnalysers`. The bus
   *  stays PURE (P12): it NEVER reads the editorRegistry settings surface — the
   *  renderer reads the impure settings and pushes the map down. */
  private aliasMap: Record<string, string | string[]>

  /** Live refs — mutable so `bindScheduler()` rebinds in place
   *  (mirrors `HydraVizRenderer.update` live-ref discipline, `:369-371`). */
  private scheduler: IRPattern | null = null
  private trackSchedulers: Map<string, IRPattern> = new Map()

  /** Per-frame snapshot of active events from the combined scheduler feed
   *  (set by `refreshActive`). The instantaneous feed for `sound()`. */
  private activeEvents: IREvent[] = []
  /** Per-frame snapshot of active events per track-key (scheduler key space). */
  private activeByTrack = new Map<string, IREvent[]>()
  /** Every distinct `e.s` ever bumped — backs `get sounds()`. */
  private readonly seenSounds = new Set<string>()

  // ── DSP feed (analyser refs + per-frame cache, Slice 2) ───────────────────
  /** Live master analyser ref — mutable so `bindAnalysers()` rebinds in place
   *  (mirrors `bindScheduler`). Null in IR-only / demo mode. */
  private masterAnalyser: BusAnalyser | null = null
  /** Per-track analyser refs, keyed the SAME as `trackSchedulers` (the SCHEDULER
   *  key space `$0`/`d1`, TRAP §5) — `trackAnalysers` is published with those
   *  keys by the engine (LiveCodingEngine.ts:25). */
  private trackAnalysers: Map<string, BusAnalyser> = new Map()
  /** Scratch byte buffers per analyser (freq + time), allocated/resized lazily
   *  keyed on analyser identity so a rebind to a new node re-allocates. */
  private readonly freqBufs = new WeakMap<BusAnalyser, Uint8Array>()
  private readonly waveBufs = new WeakMap<BusAnalyser, Uint8Array>()
  /** Per-frame derived DSP reading per analyser — filled by `readAudio()`,
   *  read by the accessors. Cleared each `readAudio()` so a now-unbound
   *  analyser stops reporting stale data. */
  private audioByAnalyser = new Map<BusAnalyser, AudioReading>()

  constructor(aliasMap: Record<string, string | string[]> = ALIAS_MAP) {
    this.aliasMap = aliasMap
    this.decay = DEFAULT_DECAY
  }

  /** Store live scheduler refs (mutable rebind — mirror the renderer's
   *  in-place update discipline). Pass `null`/empty in demo mode. */
  bindScheduler(
    scheduler: IRPattern | null | undefined,
    trackSchedulers: Map<string, IRPattern> | null | undefined,
  ): void {
    this.scheduler = scheduler ?? null
    this.trackSchedulers = trackSchedulers ?? new Map()
  }

  /** Store live analyser refs (mutable rebind — mirror `bindScheduler`). The
   *  orbit is the shared reference: a sound resolves to its orbit, which has
   *  BOTH events (the scheduler feed) AND an analyser (this DSP feed). Pass
   *  `null`/empty in IR-only / demo mode → DSP fields degrade to 0/[]. */
  bindAnalysers(
    master?: BusAnalyser | null,
    trackAnalysers?: Map<string, BusAnalyser> | null,
  ): void {
    this.masterAnalyser = master ?? null
    this.trackAnalysers = trackAnalysers ?? new Map()
  }

  /** Replace the active alias map in place (mirror `bindScheduler`'s mutable
   *  rebind). The RENDERER builds the merged map — `{ ...ALIAS_MAP, ...custom }`
   *  with custom WINNING on collision — and pushes it here at mount. The bus
   *  stays PURE (P12): it does NOT import `getSignalAliases`; it only stores the
   *  numbers/maps it is handed. `envValue`/`resolveSounds` resolve ANY key
   *  through this map, so a freshly-set custom alias resolves with no other
   *  change. */
  setAliases(map: Record<string, string | string[]>): void {
    this.aliasMap = map
  }

  // ── .env feed (envelope: bump + decay) ──────────────────────────────────

  /** Bump the envelope for an event's sound. Mirrors `HapEnergyEnvelope.onHap`
   *  (`:67-82`): gain clamped 0..1, level = min(1, prev + gain). Keyed on
   *  `e.s` (NOT a MIDI bin). No-ops for an event with no sound name. */
  bump(e: BusHapEvent): void {
    const sound = e.s
    if (sound == null) return
    const gain = Math.min(1, Math.max(0, e.hap?.value?.gain ?? 1))
    const prev = this.envMap.get(sound) ?? 0
    this.envMap.set(sound, Math.min(1, prev + gain))
    if (e.color != null) this.colorMap.set(sound, e.color)
    else if (!this.colorMap.has(sound)) this.colorMap.set(sound, null)
    this.seenSounds.add(sound)
  }

  /** Apply decay to every envelope entry. Call ONCE per frame, BEFORE
   *  `refreshActive` (mirror `HapEnergyEnvelope.tick`, `:85-89`). */
  tick(): void {
    for (const [sound, level] of this.envMap) {
      this.envMap.set(sound, level * this.decay)
    }
  }

  // ── instantaneous feed (scheduler query-at-now) ─────────────────────────

  /** Snapshot the active events at `now` from the combined scheduler and each
   *  per-track scheduler. Call ONCE per frame, AFTER `tick()`. The window is
   *  [now, now + ε) — the same tight window `H()` uses (`:175`). */
  refreshActive(now: number): void {
    const begin = now
    const end = now + EPSILON
    this.activeEvents = this.scheduler ? this.scheduler.query(begin, end) : []
    this.activeByTrack.clear()
    // Key on the SCHEDULER key space (TRAP §5) — trackSchedulers.keys() are
    // `$0`/`$1`/`d1`/`drums`, NOT IREvent.trackId.
    for (const [key, sched] of this.trackSchedulers) {
      this.activeByTrack.set(key, sched.query(begin, end))
    }
  }

  /** Current scheduler time (mirror `H()`'s `sched.now()`), 0 in demo mode. */
  now(): number {
    return this.scheduler ? this.scheduler.now() : 0
  }

  // ── DSP feed (analyser read-at-now) ───────────────────────────────────────

  /** Snapshot every bound analyser's spectrum + waveform for this frame. Call
   *  ONCE per frame, AFTER `refreshActive` — `audioFor()` resolves a sound to a
   *  trackKey via `activeByTrack`, which `refreshActive` populates (ordering is
   *  the T2 call-site's responsibility). Reads each analyser via
   *  `getByteFrequencyData` + `getByteTimeDomainData` (mirrors
   *  `HydraVizRenderer.pumpAudio:445-455`) and caches the derived
   *  `AudioReading`. An analyser that's no longer bound drops out of the cache. */
  readAudio(): void {
    this.audioByAnalyser.clear()
    if (this.masterAnalyser) this.readOne(this.masterAnalyser)
    for (const an of this.trackAnalysers.values()) this.readOne(an)
  }

  /** Read one analyser into the per-frame cache (idempotent within a frame). */
  private readOne(an: BusAnalyser): void {
    if (this.audioByAnalyser.has(an)) return
    this.audioByAnalyser.set(an, deriveAudio(an, this.freqBufs, this.waveBufs))
  }

  /** Resolve a sound (or alias) → the analyser whose mix it lives in. Find the
   *  trackKey(s) in `activeByTrack` (SCHEDULER key space, TRAP §5 — NOT
   *  IREvent.trackId) whose active events include any resolved sound. EXACTLY
   *  one such track AND that track has a bound analyser → its isolated analyser.
   *  Otherwise (multi-track, none, or no per-track analyser) → the master
   *  analyser (the combined mix — still meaningful, never silent-zero-as-bug). */
  private audioFor(soundOrAlias: string): BusAnalyser | null {
    const resolved = new Set(this.resolveSounds(soundOrAlias))
    let onlyKey: string | null = null
    for (const [key, events] of this.activeByTrack) {
      const hit = events.some((e) => e.s != null && resolved.has(e.s))
      if (!hit) continue
      if (onlyKey != null) return this.masterAnalyser // spans 2+ tracks → master
      onlyKey = key
    }
    if (onlyKey != null) {
      const isolated = this.trackAnalysers.get(onlyKey)
      if (isolated) return isolated
    }
    return this.masterAnalyser
  }

  /** Cached DSP reading for an analyser (this frame), or the zero reading. */
  private audioReading(an: BusAnalyser | null): AudioReading {
    if (an == null) return ZERO_AUDIO
    return this.audioByAnalyser.get(an) ?? ZERO_AUDIO
  }

  /** Master DSP reading (the combined-mix analyser). Surfaces `u.rms`/`u.fft`
   *  etc. — the T3 master accessor path. Zero reading if no master bound. */
  master(): AudioReading {
    return this.audioReading(this.masterAnalyser)
  }

  // ── accessors ───────────────────────────────────────────────────────────

  /** Resolve an alias OR a raw sound name to a list of concrete sound names.
   *  `'uKick'` → `['bd']`, `'uTom'` → `['lt','mt','ht']`, `'bd'` → `['bd']`. */
  private resolveSounds(soundOrAlias: string): string[] {
    const mapped = this.aliasMap[soundOrAlias]
    if (mapped == null) return [soundOrAlias]
    return Array.isArray(mapped) ? mapped : [mapped]
  }

  /** Decayed envelope level for a sound or alias. Array aliases (`uTom`)
   *  resolve as MAX over members. Demo-mode / never-fired → 0. */
  envValue(soundOrAlias: string): number {
    let max = 0
    for (const sound of this.resolveSounds(soundOrAlias)) {
      const v = this.envMap.get(sound) ?? 0
      if (v > max) max = v
    }
    return max
  }

  /** Find the first active IREvent (combined feed) whose `s` is in `sounds`. */
  private activeEventForSounds(sounds: string[]): IREvent | undefined {
    const set = new Set(sounds)
    for (const ev of this.activeEvents) {
      if (ev.s != null && set.has(ev.s)) return ev
    }
    return undefined
  }

  /** Per-sound reading — merged across tracks via the combined active feed
   *  (D-03). `.env` from the envelope; `.velocity`/`.note` from the active
   *  IREvent (NOT the envelope — silent-zero trap §5); `.color` from the
   *  active IREvent, falling back to the last-bumped hap color. */
  sound(soundOrAlias: string): SignalReading {
    const sounds = this.resolveSounds(soundOrAlias)
    const env = this.envValue(soundOrAlias)
    const ev = this.activeEventForSounds(sounds)
    // DSP from the sound's resolved orbit analyser (isolated if the sound owns
    // exactly one active track, else the combined master mix — `audioFor`).
    const audio = this.audioReading(this.audioFor(soundOrAlias))
    return {
      env,
      velocity: ev?.velocity ?? 0,
      note: ev?.note ?? null,
      color: ev?.color ?? this.colorFallback(sounds),
      ...audio,
    }
  }

  /** Last-bumped color over the resolved sounds (the `.color` fallback feed). */
  private colorFallback(sounds: string[]): string | null {
    for (const sound of sounds) {
      const c = this.colorMap.get(sound)
      if (c != null) return c
    }
    return null
  }

  /** Per-track reading, keyed on the SCHEDULER key space (TRAP §5 —
   *  `trackSchedulers.get(id)`, NOT IREvent.trackId). `.env` is the max env over
   *  the sounds this track fired this frame; `.velocity`/`.note`/`.color` come
   *  from the track's first active IREvent (scheduler feed). A `sound(s)`
   *  sub-accessor reads a specific sound within the track. Unknown id → zeros. */
  track(id: string): SignalReading & { sound: (s: string) => SignalReading } {
    const events = this.activeByTrack.get(id) ?? []
    const first = events[0]
    const trackSounds = events
      .map((e) => e.s)
      .filter((s): s is string => s != null)
    let env = 0
    for (const s of trackSounds) {
      const v = this.envMap.get(s) ?? 0
      if (v > env) env = v
    }
    // DSP for the whole track — its own analyser (SCHEDULER key space, §5),
    // master mix as the graceful fallback when no per-track analyser is bound.
    const trackAudio = this.audioReading(
      this.trackAnalysers.get(id) ?? this.masterAnalyser,
    )
    const soundIn = (soundOrAlias: string): SignalReading => {
      const resolved = new Set(this.resolveSounds(soundOrAlias))
      const ev = events.find((e) => e.s != null && resolved.has(e.s))
      let sEnv = 0
      for (const s of this.resolveSounds(soundOrAlias)) {
        const v = this.envMap.get(s) ?? 0
        if (v > sEnv) sEnv = v
      }
      return {
        env: sEnv,
        velocity: ev?.velocity ?? 0,
        note: ev?.note ?? null,
        color: ev?.color ?? null,
        // A specific sound within a named track reads that track's mix.
        ...trackAudio,
      }
    }
    return {
      env,
      velocity: first?.velocity ?? 0,
      note: first?.note ?? null,
      color: first?.color ?? null,
      ...trackAudio,
      sound: soundIn,
    }
  }

  /** Enumerate the published track keys — the SCHEDULER key space
   *  (`trackSchedulers.keys()`, §5), e.g. `['$0','$1']` or `['d1','drums']`. */
  get tracks(): string[] {
    return [...this.trackSchedulers.keys()]
  }

  /** Enumerate distinct sounds ever bumped through the envelope feed. */
  get sounds(): string[] {
    return [...this.seenSounds]
  }

  /** Normalize a note to a MIDI number (P93 — only when a NUMBER is explicitly
   *  requested; the raw `.note` preserves the user's name|number form). Returns
   *  null for percussion sample names / unrecognized input. */
  noteToMidi(note: number | string | null): number | null {
    if (note == null) return null
    return noteToMidi(note)
  }
}

// ── DSP derivation (pure, module-level — no class state) ────────────────────

/**
 * Read one analyser and derive its `AudioReading`:
 *   - `fft[FFT_BINS]`  — magnitude spectrum downsampled into `FFT_BINS`
 *     buckets, each `sum/(binSize*255)` so 0..1 (mirror
 *     `HydraVizRenderer.pumpAudio:447-455`). If `frequencyBinCount < FFT_BINS`
 *     (`binSize` would be 0) we map 1:1 and pad — never divide by zero.
 *   - `bass/mid/treble` — mean of the low / mid / high THIRD of `fft`.
 *   - `wave[]` — time-domain normalized `(v-128)/128` ∈ -1..1.
 *   - `rms` — `sqrt(mean(((v-128)/128)²))`, clamped 0..1.
 * Scratch byte buffers are cached per analyser (allocated/resized on identity).
 */
function deriveAudio(
  an: BusAnalyser,
  freqBufs: WeakMap<BusAnalyser, Uint8Array>,
  waveBufs: WeakMap<BusAnalyser, Uint8Array>,
): AudioReading {
  const n = an.frequencyBinCount | 0
  if (n <= 0) return { ...ZERO_AUDIO, fft: [], wave: [] }

  let freq = freqBufs.get(an)
  if (!freq || freq.length !== n) {
    freq = new Uint8Array(n)
    freqBufs.set(an, freq)
  }
  let time = waveBufs.get(an)
  if (!time || time.length !== n) {
    time = new Uint8Array(n)
    waveBufs.set(an, time)
  }

  an.getByteFrequencyData(freq)
  an.getByteTimeDomainData(time)

  // fft — downsample n raw magnitude bins into FFT_BINS buckets, normalized.
  const fft = new Array<number>(FFT_BINS).fill(0)
  const binSize = Math.floor(n / FFT_BINS)
  if (binSize >= 1) {
    for (let i = 0; i < FFT_BINS; i++) {
      let sum = 0
      for (let j = 0; j < binSize; j++) sum += freq[i * binSize + j]
      fft[i] = sum / (binSize * 255)
    }
  } else {
    // Fewer raw bins than buckets (tiny fftSize) — map 1:1, leave the rest 0.
    for (let i = 0; i < n; i++) fft[i] = freq[i] / 255
  }

  // bass / mid / treble — mean of the low / mid / high third of fft.
  const third = Math.floor(FFT_BINS / 3)
  const bass = meanSlice(fft, 0, third)
  const mid = meanSlice(fft, third, 2 * third)
  const treble = meanSlice(fft, 2 * third, FFT_BINS)

  // wave + rms from the time-domain buffer (128 = silence center).
  const wave = new Array<number>(n)
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const v = (time[i] - 128) / 128
    wave[i] = v
    sumSq += v * v
  }
  const rms = Math.min(1, Math.max(0, Math.sqrt(sumSq / n)))

  return { rms, bass, mid, treble, fft, wave }
}

/** Mean of `arr[from, to)`; 0 for an empty range (never NaN). */
function meanSlice(arr: number[], from: number, to: number): number {
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += arr[i]
  return sum / (to - from)
}
