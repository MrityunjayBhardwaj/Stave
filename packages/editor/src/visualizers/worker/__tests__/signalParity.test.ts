/**
 * B-2 PARITY GATE (deterministic) — a worker-fed `SignalBus` (sampler → frame →
 * transport roundtrip → WorkerBusFeed) yields the SAME readings as a main-fed bus
 * driven the "today" way, for the same inputs. Proves the marshalling is lossless
 * before any worker/canvas (PK19 — observe parity, don't infer).
 *
 * The transport is simulated with `structuredClone` (the postMessage semantics
 * without transfer-neutering); the real worker + transferable/SAB transport are
 * observed live in the app spike (B-2a) and re-run on SAB (B-2b).
 */
import { describe, it, expect } from 'vitest'
import { SignalBus, type BusAnalyser } from '../../signals/SignalBus'
import type { IRPattern } from '../../../codeView/ir/IRPattern'
import type { IREvent } from '../../../codeView/ir/IREvent'
import type { HapEvent } from '../../../engine/HapStream'
import { MainSignalSampler } from '../signalSampler'
import { WorkerBusFeed } from '../workerBusFeed'

// ── deterministic stubs ─────────────────────────────────────────────────────

/** A BusAnalyser with fixed bytes (a sloped spectrum + a sine-ish waveform). */
function stubAnalyser(bins: number, seed: number): BusAnalyser {
  const freq = new Uint8Array(bins)
  const time = new Uint8Array(bins)
  for (let i = 0; i < bins; i++) {
    freq[i] = (i * 3 + seed * 7) % 256
    time[i] = (128 + Math.round(80 * Math.sin((i + seed) * 0.3))) % 256
  }
  return {
    frequencyBinCount: bins,
    getByteFrequencyData: (a) => a.set(freq.subarray(0, a.length)),
    getByteTimeDomainData: (a) => a.set(time.subarray(0, a.length)),
  }
}

function ev(
  s: string | null,
  velocity: number,
  note: number | string | null,
  color: string | null,
): IREvent {
  // The bus reads only s/velocity/note/color off an active event.
  return { s, velocity, note, color } as unknown as IREvent
}

/** A scheduler stub: fixed now + fixed active events for any query window. */
function stubScheduler(now: number, events: IREvent[]): IRPattern {
  return { now: () => now, query: () => events }
}

/** A minimal in-memory HapStream. */
function stubHapStream() {
  const handlers = new Set<(e: HapEvent) => void>()
  return {
    on: (h: (e: HapEvent) => void) => handlers.add(h),
    off: (h: (e: HapEvent) => void) => handlers.delete(h),
    emit: (e: HapEvent) => handlers.forEach((h) => h(e)),
  }
}

function hap(s: string, gain: number, color: string | null = null): HapEvent {
  return {
    s,
    color,
    hap: { value: { gain } },
    audioTime: 0,
    audioDuration: 0,
    scheduledAheadMs: 0,
    midiNote: null,
    loc: null,
  }
}

// ── the parity scenario ─────────────────────────────────────────────────────

const NOW = 4.25
const MASTER = stubAnalyser(64, 1)
const TRACK0 = stubAnalyser(64, 2)
const ACTIVE = [ev('bd', 0.9, 'c2', '#f00'), ev('sd', 0.5, null, '#0f0')]
const TRACK0_ACTIVE = [ev('bd', 0.9, 'c2', '#f00')]
const HAPS = [hap('bd', 1, '#f00'), hap('sd', 0.7), hap('bd', 0.4)]

/** Drive a fresh main-fed bus the "today" way (bumps → tick → refreshActive →
 *  readAudio), the exact sequence WorkerBusFeed replays. The reference truth. */
function mainFedBus(): SignalBus {
  const bus = new SignalBus()
  bus.bindScheduler(
    stubScheduler(NOW, ACTIVE),
    new Map([['$0', stubScheduler(NOW, TRACK0_ACTIVE)]]),
  )
  bus.bindAnalysers(MASTER, new Map([['$0', TRACK0]]))
  for (const h of HAPS) bus.bump({ s: h.s, color: h.color, hap: h.hap })
  bus.tick()
  bus.refreshActive(NOW)
  bus.readAudio()
  return bus
}

/** Drive a worker-fed bus through the full marshalling path. */
function workerFedBus(): WorkerBusFeed {
  const sampler = new MainSignalSampler()
  const stream = stubHapStream()
  sampler.bindHapStream(stream)
  sampler.bind({
    scheduler: stubScheduler(NOW, ACTIVE),
    trackSchedulers: new Map([['$0', stubScheduler(NOW, TRACK0_ACTIVE)]]),
    masterAnalyser: MASTER,
    trackAnalysers: new Map([['$0', TRACK0]]),
  })
  for (const h of HAPS) stream.emit(h) // haps fire before the frame is sampled
  const frame = sampler.sample()
  const transported = structuredClone(frame) // simulate the transport
  const feed = new WorkerBusFeed()
  feed.applyFrame(transported)
  return feed
}

describe('B-2 signal-transport parity — worker-fed bus == main-fed bus', () => {
  it('master() DSP reading matches exactly', () => {
    const ref = mainFedBus().master()
    const got = workerFedBus().bus.master()
    expect(got.rms).toBeCloseTo(ref.rms, 12)
    expect(got.bass).toBeCloseTo(ref.bass, 12)
    expect(got.mid).toBeCloseTo(ref.mid, 12)
    expect(got.treble).toBeCloseTo(ref.treble, 12)
    expect(got.fft).toEqual(ref.fft)
    expect(got.wave).toEqual(ref.wave)
  })

  it('per-sound reading (active event fields + DSP) matches', () => {
    const ref = mainFedBus().sound('bd')
    const got = workerFedBus().bus.sound('bd')
    expect(got.velocity).toBe(ref.velocity)
    expect(got.note).toBe(ref.note)
    expect(got.color).toBe(ref.color)
    expect(got.rms).toBeCloseTo(ref.rms, 12)
    expect(got.fft).toEqual(ref.fft)
  })

  it('per-track reading matches (SCHEDULER key space)', () => {
    const ref = mainFedBus().track('$0')
    const got = workerFedBus().bus.track('$0')
    expect(got.velocity).toBe(ref.velocity)
    expect(got.note).toBe(ref.note)
    expect(got.color).toBe(ref.color)
    expect(got.rms).toBeCloseTo(ref.rms, 12)
    expect(got.fft).toEqual(ref.fft)
  })

  it('envelope (bump feed) matches — both decayed once after the bumps', () => {
    const ref = mainFedBus()
    const got = workerFedBus().bus
    // bd bumped twice (1 + 0.4 → clamp 1), sd once (0.7), one tick decay (0.92).
    expect(got.envValue('bd')).toBeCloseTo(ref.envValue('bd'), 12)
    expect(got.envValue('sd')).toBeCloseTo(ref.envValue('sd'), 12)
    expect(got.envValue('bd')).toBeGreaterThan(0)
  })

  it('published tracks + sounds match', () => {
    const ref = mainFedBus()
    const got = workerFedBus().bus
    expect(got.tracks).toEqual(ref.tracks)
    expect([...got.sounds].sort()).toEqual([...ref.sounds].sort())
  })
})

describe('WorkerBusFeed — frame lifecycle guards', () => {
  it('drops a stale/duplicate seq (no double-decay)', () => {
    const feed = new WorkerBusFeed()
    const sampler = new MainSignalSampler()
    sampler.bind({ masterAnalyser: MASTER })
    const f1 = sampler.sample()
    expect(feed.applyFrame(f1)).toBe(true)
    expect(feed.applyFrame(f1)).toBe(false) // same seq → skipped
    expect(feed.applyFrame({ ...f1, seq: f1.seq + 1 })).toBe(true)
  })

  it('empty frame yields the zero master reading (never NaN)', () => {
    const feed = new WorkerBusFeed()
    feed.applyFrame(new MainSignalSampler().emptyFrame())
    const m = feed.bus.master()
    expect(m.rms).toBe(0)
    expect(m.fft).toEqual([])
    expect(Number.isNaN(m.rms)).toBe(false)
  })
})
