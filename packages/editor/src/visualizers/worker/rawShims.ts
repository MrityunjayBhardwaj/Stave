/**
 * Worker-side RAW feed shims for `stave.analyser` and `stave.scheduler` (B-3).
 *
 * The signal BUS is fed by `WorkerBusFeed` (B-2). But the heavy real sketches —
 * the matrix-gate `synthterrain` and all 7 legacy built-ins — bypass the bus and
 * read the RAW engine inputs a p5 sketch is handed:
 *   - `stave.analyser` — an `AnalyserNode` (they call `getFloat*Data` / `getByte*`).
 *   - `stave.scheduler` — an `IRPattern` (they call `now()` / `query(a, b)`).
 *
 * These shims reconstruct those two objects from a transported `SignalFrame`'s
 * raw fields (the master `AnalyserBytes` + `rawScheduler`), so the worker can hand
 * the SAME `analyserRef` / `schedulerRef` to `compileP5Code` that `P5VizRenderer`
 * does on main — no compiler fork. Stable identity (mutated in place each frame)
 * so a sketch caching `const a = stave.analyser` keeps reading live data.
 *
 * REF: signalFrame.ts (AnalyserBytes / RawSchedulerFrame), P5VizRenderer (the main
 *      analyserRef/schedulerRef contract), builtinP5Code.ts (the consumers).
 */

import type { IRPattern } from '../../codeView'
import type { IREvent } from '../../codeView'
import type { AnalyserBytes, RawSchedulerFrame, RawHapSummary } from './signalFrame'

/**
 * An `AnalyserNode`-shaped shim backed by one frame's master `AnalyserBytes`.
 * Serves both the byte API (verbatim) and the float API (byte→float
 * reconstruction), so sketches reading either get live data:
 *
 *   - `getByteTimeDomainData` / `getByteFrequencyData` — copy the shipped bytes.
 *   - `getFloatTimeDomainData` — `(byte - 128) / 128` (the Web Audio inverse;
 *     128 = silence → 0.0, range -1..1).
 *   - `getFloatFrequencyData` — `minDb + byte·(maxDb - minDb)/255` (the inverse of
 *     `getByteFrequencyData`'s dB→byte quantisation, using the shipped dB range).
 *
 * Time-domain is the FULL `fftSize`; frequency is `frequencyBinCount`. Float
 * reconstruction is sub-LSB lossy vs a native node (byte step ≈ 1/128 on the
 * waveform) — visually identical for a scaled terrain/scope (sub-pixel), and the
 * only path that keeps the DSP off the main thread.
 */
export class RawAnalyserShim {
  fftSize = 2048
  frequencyBinCount = 1024
  minDecibels = -100
  maxDecibels = -30
  smoothingTimeConstant = 0.8

  /** Latest frame's bytes (own copies — the transport may neuter the source). */
  private freq = new Uint8Array(0)
  private time = new Uint8Array(0)

  /** Adopt the master analyser bytes from a frame. Absent (silent / no analyser)
   *  → zero everything so the float reads return 0.0 (128 byte = silence). */
  set(bytes: AnalyserBytes | null | undefined): void {
    if (!bytes) {
      this.freq = new Uint8Array(this.frequencyBinCount)
      // 128 = silence in byte time-domain → 0.0 float.
      this.time = new Uint8Array(this.fftSize).fill(128)
      return
    }
    this.frequencyBinCount = bytes.frequencyBinCount
    this.fftSize =
      bytes.fftSize && bytes.fftSize > 0
        ? bytes.fftSize
        : bytes.frequencyBinCount * 2
    if (typeof bytes.minDecibels === 'number') this.minDecibels = bytes.minDecibels
    if (typeof bytes.maxDecibels === 'number') this.maxDecibels = bytes.maxDecibels
    if (this.freq.length !== bytes.freq.length) this.freq = new Uint8Array(bytes.freq.length)
    if (this.time.length !== bytes.time.length) this.time = new Uint8Array(bytes.time.length)
    this.freq.set(bytes.freq)
    this.time.set(bytes.time)
  }

  getByteFrequencyData(arr: Uint8Array): void {
    arr.set(this.freq.subarray(0, arr.length))
  }

  getByteTimeDomainData(arr: Uint8Array): void {
    if (this.time.length) arr.set(this.time.subarray(0, arr.length))
    else arr.fill(128)
  }

  getFloatTimeDomainData(arr: Float32Array): void {
    const n = Math.min(arr.length, this.time.length)
    for (let i = 0; i < n; i++) arr[i] = (this.time[i] - 128) / 128
    for (let i = n; i < arr.length; i++) arr[i] = 0
  }

  getFloatFrequencyData(arr: Float32Array): void {
    const range = this.maxDecibels - this.minDecibels
    const n = Math.min(arr.length, this.freq.length)
    for (let i = 0; i < n; i++) {
      arr[i] = this.minDecibels + (this.freq[i] * range) / 255
    }
    // Beyond available bins: the silence floor (a native node reports minDecibels).
    for (let i = n; i < arr.length; i++) arr[i] = this.minDecibels
  }
}

/**
 * An `IRPattern`-shaped shim for `stave.scheduler`, backed by one frame's
 * `rawScheduler` (the combined scheduler pre-queried over a WIDE window on main).
 * `query(a, b)` NARROWS the shipped events to the sketch's sub-window — returning
 * events that INTERSECT `[a, b)` (`begin < b && end > a`), which is a superset of
 * onset-in-window and so also catches a note still sounding at `now` whose onset
 * is earlier (synthterrain's active-at-now filter needs this).
 *
 * The events are plain `RawHapSummary` objects; sketches read `h.begin`/`h.note`/
 * `h.gain`/… exactly as on main. Widened to `IREvent` at the call boundary (the
 * extra IREvent fields are simply absent — viz sketches don't read them).
 */
export class RawSchedulerShim implements IRPattern {
  private _now = 0
  private events: RawHapSummary[] = []

  set(raw: RawSchedulerFrame | null | undefined): void {
    this._now = raw?.now ?? 0
    this.events = raw?.events ?? []
  }

  now(): number {
    return this._now
  }

  query(begin: number, end: number): IREvent[] {
    const out: RawHapSummary[] = []
    for (const h of this.events) {
      if (h.begin < end && h.end > begin) out.push(h)
    }
    return out as unknown as IREvent[]
  }
}
