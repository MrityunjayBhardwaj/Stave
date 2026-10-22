/**
 * WorkerBusFeed — drives a (pure) `SignalBus` from `SignalFrame`s on the WORKER
 * side (Phase B / B-2). The worker bus is the SAME `SignalBus` class as on main;
 * this feed reconstructs the bus's three inputs from a transported frame and runs
 * the per-frame sequence, so `bus` yields the same readings as a main-fed bus.
 *
 * No DOM, no worker API, no transport — pure object plumbing over `SignalBus`'s
 * public seams. Lives equally happily in a unit test (parity gate) or the real
 * `viz-worker` (B-3).
 *
 *   analysers → byte-backed `BusAnalyser` stubs whose identity is STABLE across
 *               frames (keyed by analyser key) so `SignalBus`'s per-analyser
 *               scratch-buffer cache (WeakMap on the stub) keeps hitting.
 *   scheduler → a minimal `IRPattern` stub `{ now, query }` returning the frame's
 *               `now` + active events (the bus only calls those two — IRPattern.ts).
 *   bumps     → replayed into `bus.bump()` (the envelope feed).
 *
 * Per-frame order (the worker frame contract): replay bumps → `tick()` →
 * `refreshActive(now)` → `readAudio()`. `readAudio` MUST follow `refreshActive`
 * (SignalBus Slice-2 ordering — `audioFor` resolves a sound→track via the active
 * map). The reference main-bus in the parity gate is driven the same way.
 */

import { SignalBus, type BusAnalyser } from '../signals/SignalBus'
import type { IRPattern } from '../../codeView'
import type { IREvent } from '../../codeView'
import { ALIAS_MAP } from '../signals/aliasMap'
import {
  MASTER_KEY,
  type SignalFrame,
  type ActiveEventSummary,
} from './signalFrame'

/** A byte-backed `BusAnalyser` with stable identity — bytes mutate in place each
 *  frame so the bus's WeakMap scratch cache (keyed on this object) survives. */
class FrameAnalyser implements BusAnalyser {
  frequencyBinCount = 0
  private freq = new Uint8Array(0)
  private time = new Uint8Array(0)

  /** Adopt this frame's bytes (copy in — the source buffers may be transferred
   *  away / reused by the transport after the frame is consumed). */
  set(frequencyBinCount: number, freq: Uint8Array, time: Uint8Array): void {
    this.frequencyBinCount = frequencyBinCount
    if (this.freq.length !== freq.length) this.freq = new Uint8Array(freq.length)
    if (this.time.length !== time.length) this.time = new Uint8Array(time.length)
    this.freq.set(freq)
    this.time.set(time)
  }

  getByteFrequencyData(arr: Uint8Array): void {
    arr.set(this.freq.subarray(0, arr.length))
  }

  getByteTimeDomainData(arr: Uint8Array): void {
    arr.set(this.time.subarray(0, arr.length))
  }
}

/** A minimal `IRPattern` whose `query` ignores its window and returns the frame's
 *  pre-queried active events (the main thread already queried at the same `now`).
 *  Active events are summaries; the bus only reads `s`/`velocity`/`note`/`color`,
 *  so we widen the summary to `IREvent` for the call site (other fields unread). */
function makeSchedulerStub(now: number, events: ActiveEventSummary[]): IRPattern {
  const widened = events as unknown as IREvent[]
  return {
    now: () => now,
    query: () => widened,
  }
}

export class WorkerBusFeed {
  readonly bus: SignalBus
  /** Stable analyser stubs by key (`'master'` + track keys). */
  private readonly analysers = new Map<string, FrameAnalyser>()
  private lastSeq = -1

  constructor(aliasMap: Record<string, string | string[]> = ALIAS_MAP) {
    this.bus = new SignalBus(aliasMap)
  }

  /** Push the merged alias map (the renderer reads impure settings on main and
   *  ships the map; the worker bus stays pure — mirrors P5VizRenderer). */
  setAliases(map: Record<string, string | string[]>): void {
    this.bus.setAliases(map)
  }

  /**
   * Apply one frame: rebuild the bus's inputs from `frame`, replay bumps, then
   * run the per-frame sequence. Idempotent on a duplicate/stale `seq` (no-op) so
   * a dropped or repeated transport frame can't double-decay the envelope.
   * Returns `true` if the frame advanced state, `false` if skipped as stale.
   */
  applyFrame(frame: SignalFrame): boolean {
    if (frame.seq <= this.lastSeq) return false
    this.lastSeq = frame.seq

    // ── analysers: reuse stubs by key (stable identity → cache hits) ──
    let master: BusAnalyser | null = null
    const trackAnalysers = new Map<string, BusAnalyser>()
    const present = new Set<string>()
    for (const a of frame.analysers) {
      present.add(a.key)
      let stub = this.analysers.get(a.key)
      if (!stub) {
        stub = new FrameAnalyser()
        this.analysers.set(a.key, stub)
      }
      stub.set(a.frequencyBinCount, a.freq, a.time)
      if (a.key === MASTER_KEY) master = stub
      else trackAnalysers.set(a.key, stub)
    }
    // Drop stubs for analysers no longer present (a now-unbound track) so they
    // can't report stale bytes if they reappear with a different identity.
    for (const key of [...this.analysers.keys()]) {
      if (!present.has(key)) this.analysers.delete(key)
    }

    // ── scheduler: stubs returning the frame's now + active events ──
    const scheduler = makeSchedulerStub(frame.now, frame.activeEvents)
    const trackSchedulers = new Map<string, IRPattern>()
    for (const [key, events] of frame.activeByTrack) {
      trackSchedulers.set(key, makeSchedulerStub(frame.now, events))
    }

    this.bus.bindScheduler(scheduler, trackSchedulers)
    this.bus.bindAnalysers(master, trackAnalysers)

    // ── envelope: replay this interval's haps ──
    for (const b of frame.bumps) {
      this.bus.bump({ s: b.s, color: b.color, hap: { value: { gain: b.gain } } })
    }

    // ── per-frame sequence (readAudio AFTER refreshActive — Slice 2) ──
    this.bus.tick()
    this.bus.refreshActive(frame.now)
    this.bus.readAudio()
    return true
  }
}
