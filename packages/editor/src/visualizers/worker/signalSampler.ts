/**
 * MainSignalSampler — samples the main-thread signal feed into a `SignalFrame`
 * each frame (Phase B / B-2). It is the MAIN-side half of the marshalling: it
 * does the work that is main-thread-bound (read `AnalyserNode` bytes, query the
 * scheduler, collect haps) so a worker `SignalBus` can run off those values.
 *
 * It mirrors exactly what `SignalBus` does on main today (P5VizRenderer __tick):
 *   - `now = scheduler.now()`
 *   - active events = `scheduler.query(now, now + ε)` (combined + per-track)
 *   - analyser bytes = `getByte{Frequency,TimeDomain}Data` per bound analyser
 *   - bumps = the haps that fired since the previous `sample()`
 *
 * No DOM/worker — it consumes the same structural types the bus does
 * (`BusAnalyser`, `IRPattern`, `HapStream`), so it unit-tests with plain stubs.
 */

import type { BusAnalyser } from '../signals/SignalBus'
import type { IRPattern } from '../../codeView'
import type { HapEvent } from '../../engine/HapStream'
import type { FrameSampleCache } from './frameSampleCache'
import { perf } from '../../perf/profiler'
import {
  MASTER_KEY,
  emptyFrame,
  type SignalFrame,
  type ActiveEventSummary,
  type BumpSummary,
  type AnalyserBytes,
  type RawHapSummary,
  type RawSchedulerFrame,
} from './signalFrame'

/** ε window for the query-at-now read — identical to `SignalBus.refreshActive`
 *  (`EPSILON = 0.001`). Kept in sync deliberately: the sampler stands in for the
 *  bus's own query, so the window must match or the worker sees a different slice. */
const EPSILON = 0.001

/**
 * Wide window (in scheduler time units — cycles for Strudel) the raw
 * `stave.scheduler` feed is queried over each frame (B-3). Sized to cover every
 * built-in sketch's own window so the worker shim can filter to any sub-window:
 * scope reaches `now-4`; pianoroll/wordfall reach `now+2`. The worker scheduler
 * shim narrows to the sketch's requested `[a,b]`, so over-querying here is
 * correct, just slightly more events shipped. Centralising ONE wide query is
 * also cheaper than each on-main sketch querying separately (the old path).
 */
const RAW_QUERY_BACK = 4
const RAW_QUERY_FWD = 2

/** Map a queried scheduler event to the lean raw-hap shape (drop loc/ids — heavy,
 *  viz-irrelevant). Defaults mirror the bus + the built-in sketches' `?? 1`. */
function summariseRawHap(e: {
  begin?: number
  end?: number
  endClipped?: number
  note?: number | string | null
  freq?: number | null
  midi?: number
  s?: string | null
  gain?: number
  velocity?: number
  color?: string | null
}): RawHapSummary {
  const begin = e.begin ?? 0
  const end = e.end ?? begin
  return {
    begin,
    end,
    endClipped: e.endClipped ?? end,
    note: e.note ?? null,
    freq: e.freq ?? null,
    midi: e.midi ?? null,
    s: e.s ?? null,
    gain: e.gain ?? 1,
    velocity: e.velocity ?? 1,
    color: e.color ?? null,
  }
}

/** The live inputs the sampler reads — the main-thread feed. All optional: any
 *  absent input degrades to the bus's zero (empty arrays / no events). */
export interface SamplerInputs {
  /** Combined scheduler (`now()` + `query()`). */
  scheduler?: IRPattern | null
  /** Per-track schedulers, SCHEDULER key space (`$0`/`d1` — TRAP §5). */
  trackSchedulers?: Map<string, IRPattern> | null
  /** Master/combined-mix analyser. */
  masterAnalyser?: BusAnalyser | null
  /** Per-track analysers, keyed the SAME as `trackSchedulers`. */
  trackAnalysers?: Map<string, BusAnalyser> | null
}

/** Minimal HapStream surface the sampler subscribes to (structural — the bus
 *  uses the same `.on`/`.off` guard discipline). */
interface HapSubscribable {
  on(handler: (e: HapEvent) => void): void
  off(handler: (e: HapEvent) => void): void
}

function summariseEvent(e: {
  s: string | null
  velocity: number
  note: number | string | null
  color: string | null
}): ActiveEventSummary {
  return { s: e.s, velocity: e.velocity, note: e.note, color: e.color }
}

/** Read one analyser's bytes into a fresh `AnalyserBytes` (fresh arrays so they
 *  can be transferred). Returns null for a zero-bin analyser (never ships empty
 *  buffers the worker would divide by). */
function readAnalyserBytes(key: string, an: BusAnalyser): AnalyserBytes | null {
  const n = an.frequencyBinCount | 0
  if (n <= 0) return null
  // Count ACTUAL analyser reads (the FFT-bearing getByteFrequencyData) — fires once
  // per real read in BOTH the cached and uncached paths (the cache's `read` closure
  // only runs on a miss). reads/frame = this ÷ produced frames: the direct PV72 gate
  // (N before the shared pump, ~1 after when N viz share the master). Zero-cost off.
  perf.inc('viz.sample.analyserReads')
  // Read the EXTRA AnalyserNode fields a raw `stave.analyser` shim needs (B-3).
  // `BusAnalyser` is structural (bus needs only binCount + getByte*), but the
  // real input is an `AnalyserNode` carrying `fftSize`/`min|maxDecibels`. Read
  // them defensively so the deterministic bus stubs (no fftSize) still work.
  const node = an as BusAnalyser & {
    fftSize?: number
    minDecibels?: number
    maxDecibels?: number
  }
  const fftSize = node.fftSize && node.fftSize > 0 ? node.fftSize : n * 2
  const freq = new Uint8Array(n)
  // Time-domain is FULL fftSize (a raw waveform sketch reads all of it); the bus
  // reads only the first `n` — parity unchanged (PK22 contract).
  const time = new Uint8Array(fftSize)
  an.getByteFrequencyData(freq)
  an.getByteTimeDomainData(time)
  return {
    key,
    frequencyBinCount: n,
    freq,
    time,
    fftSize,
    minDecibels: node.minDecibels ?? -100,
    maxDecibels: node.maxDecibels ?? -30,
  }
}

export class MainSignalSampler {
  private inputs: SamplerInputs = {}
  private seq = 0
  /** Haps accumulated since the last `sample()` (the envelope feed). */
  private pendingBumps: BumpSummary[] = []
  private boundStream: HapSubscribable | null = null
  private readonly hapHandler = (e: HapEvent): void => {
    // Mirror SignalBus.bump's reads: s, color, gain (raw — the bus clamps).
    this.pendingBumps.push({
      s: e.s ?? null,
      color: e.color ?? null,
      gain: (e.hap?.value?.gain as number | undefined) ?? 1,
    })
  }

  /** Rebind the live inputs (mirror the renderer's in-place rebind on
   *  re-evaluate). Pass `null`/absent for demo / IR-only mode. */
  bind(inputs: SamplerInputs): void {
    this.inputs = inputs
  }

  /** (Re)subscribe to a HapStream for the envelope feed. Off the old, on the new
   *  — so the bump feed survives a re-evaluate that swaps the stream (mirror
   *  P5VizRenderer.update). A partial stream (no `.on`) degrades to no feed. */
  bindHapStream(stream: HapSubscribable | null): void {
    if (stream === this.boundStream) return
    if (this.boundStream && typeof this.boundStream.off === 'function') {
      this.boundStream.off(this.hapHandler)
    }
    this.boundStream = null
    this.pendingBumps = []
    if (stream && typeof stream.on === 'function') {
      stream.on(this.hapHandler)
      this.boundStream = stream
    }
  }

  /**
   * Produce one frame from the current inputs + the haps since the last call.
   * Drains the pending bumps (so each hap ships exactly once).
   *
   * `cache` (the shared frame pump, PV72) deduplicates the EXPENSIVE per-frame
   * work across every viz sampling in the same rAF tick: the analyser FFT read and
   * the scheduler query run ONCE per shared input object, not once per viz. It is
   * keyed by input-object IDENTITY, so two viz on DIFFERENT tracks (distinct
   * scheduler/analyser, viewZones.ts:341) don't false-share. Absent (unit tests /
   * pre-pump path) → every read runs locally, byte-identical to before.
   */
  sample(cache?: FrameSampleCache): SignalFrame {
    const { scheduler, trackSchedulers, masterAnalyser, trackAnalysers } =
      this.inputs
    const seq = ++this.seq
    const now = scheduler ? scheduler.now() : 0
    const begin = now
    const end = now + EPSILON

    // Query helper — routes through the per-tick cache when present (one query per
    // shared (scheduler, window); shared by reference, summarised per-viz below).
    const queryAt = (sched: IRPattern, a: number, b: number) =>
      cache ? cache.query(sched, a, b, () => sched.query(a, b)) : sched.query(a, b)

    const activeEvents: ActiveEventSummary[] = scheduler
      ? queryAt(scheduler, begin, end).map(summariseEvent)
      : []

    const activeByTrack: Array<[string, ActiveEventSummary[]]> = []
    if (trackSchedulers) {
      for (const [key, sched] of trackSchedulers) {
        activeByTrack.push([key, queryAt(sched, begin, end).map(summariseEvent)])
      }
    }

    // Analyser reads — the shared FFT (the duplicated cost PV72 targets). Through
    // the cache: one getByteFrequencyData per analyser object, a fresh transferable
    // slice per consumer (the bytes are transfer-detached, so each viz needs its own).
    const readBytes = (key: string, an: BusAnalyser): AnalyserBytes | null =>
      cache ? cache.readAnalyser(key, an, (a) => readAnalyserBytes(key, a)) : readAnalyserBytes(key, an)

    const analysers: AnalyserBytes[] = []
    if (masterAnalyser) {
      const b = readBytes(MASTER_KEY, masterAnalyser)
      if (b) analysers.push(b)
    }
    if (trackAnalysers) {
      for (const [key, an] of trackAnalysers) {
        const b = readBytes(key, an)
        if (b) analysers.push(b)
      }
    }

    const bumps = this.pendingBumps
    this.pendingBumps = []

    // ── raw scheduler feed (B-3) — one WIDE combined query for `stave.scheduler`
    // sketches. Separate from the bus's [now, now+ε] active query above (that
    // feeds the bus; this feeds raw sketches that scroll a window of haps). ──
    const rawScheduler: RawSchedulerFrame = {
      now,
      events: scheduler
        ? queryAt(scheduler, now - RAW_QUERY_BACK, now + RAW_QUERY_FWD).map(summariseRawHap)
        : [],
    }

    return { seq, now, analysers, activeEvents, activeByTrack, bumps, rawScheduler }
  }

  /** Unsubscribe + reset (renderer destroy). */
  dispose(): void {
    if (this.boundStream && typeof this.boundStream.off === 'function') {
      this.boundStream.off(this.hapHandler)
    }
    this.boundStream = null
    this.pendingBumps = []
    this.inputs = {}
  }

  /** The next seq an `emptyFrame` should carry (test/demo helper). */
  emptyFrame(): SignalFrame {
    return emptyFrame(++this.seq)
  }
}
