/**
 * FrameSampleCache — the per-rAF-tick memo that makes the shared frame pump a win
 * (PV72, #302). It collapses the work that N worker viz duplicate every frame when
 * they read the SAME live input object:
 *
 *   - ANALYSER READS — the expensive `getByteFrequencyData` (an FFT magnitude
 *     recompute + dB + byte quantize, O(fftSize)) on a SHARED master analyser runs
 *     ONCE per tick; each consumer gets its own TRANSFER-SAFE copy (a cheap slice),
 *     because `frameTransferables` detaches the buffer on postMessage (a single read
 *     could only be transferred to one worker). 1 FFT + k slices ≪ k FFTs.
 *   - SCHEDULER QUERIES — a `query(a,b)` over the SAME (scheduler, window) runs ONCE;
 *     the result is shared BY REFERENCE across consumers (each `.map`s it read-only,
 *     and postMessage structured-clones it per worker), so there is no per-consumer
 *     cost beyond the one query. Distinct schedulers (per-track binding,
 *     viewZones.ts:341) key separately → no false sharing.
 *
 * Constructed fresh by `vizFramePump` each tick and discarded after the tick — so it
 * can never serve a stale read across frames. Keyed by INPUT-OBJECT IDENTITY (not a
 * string key): two viz sharing the master analyser object hit the cache; two viz on
 * different track analysers don't (their data genuinely differs).
 *
 * Generic over the read/query implementations (injected by the caller) so this module
 * imports no sampler internals and stays DOM-free / plain-object testable.
 *
 * REF: PV72, signalSampler.ts (the injector), signalFrame.ts:frameTransferables (why
 *      copies are needed), viewZones.ts:341 (per-track binding → identity keys), #302.
 */

import type { BusAnalyser } from '../signals/SignalBus'
import type { IRPattern } from '../../codeView'
import type { AnalyserBytes } from './signalFrame'

export class FrameSampleCache {
  /** Raw read per analyser object (key-independent bytes). `null` = a zero-bin
   *  analyser already attempted (so we don't re-attempt). `.has()` distinguishes
   *  "not read yet" from "read → null". The stored arrays are NEVER transferred —
   *  only the per-call slices are — so they stay intact for the whole tick. */
  private readonly analyserReads = new Map<BusAnalyser, AnalyserBytes | null>()
  /** Query results per (scheduler object → `"a:b"` window). Shared by reference. */
  private readonly queries = new Map<object, Map<string, unknown[]>>()

  /**
   * Read `an` at most once this tick; return a TRANSFER-SAFE copy stamped with
   * `key`. The first caller for a given analyser runs `read` (the FFT); later
   * callers (a shared master, or the same node read under both `'master'` and its
   * track key) get a fresh-buffer slice of the cached bytes — no second FFT.
   */
  readAnalyser(
    key: string,
    an: BusAnalyser,
    read: (a: BusAnalyser) => AnalyserBytes | null,
  ): AnalyserBytes | null {
    let raw: AnalyserBytes | null
    if (this.analyserReads.has(an)) {
      raw = this.analyserReads.get(an) ?? null
    } else {
      raw = read(an)
      this.analyserReads.set(an, raw)
    }
    if (raw === null) return null
    // Fresh buffers so the consumer can transfer them; caller's display key.
    return { ...raw, key, freq: raw.freq.slice(), time: raw.time.slice() }
  }

  /**
   * Run `scheduler.query(a, b)` at most once this tick per (scheduler, window).
   * Returns the SHARED result array (callers must treat it read-only — they
   * `.map`/summarise it into their own frame). `run` is the actual query closure.
   */
  query<T>(scheduler: IRPattern, a: number, b: number, run: () => T[]): T[] {
    let windows = this.queries.get(scheduler)
    if (!windows) {
      windows = new Map()
      this.queries.set(scheduler, windows)
    }
    const k = `${a}:${b}`
    let result = windows.get(k)
    if (!result) {
      result = run() as unknown[]
      windows.set(k, result)
    }
    return result as T[]
  }
}
