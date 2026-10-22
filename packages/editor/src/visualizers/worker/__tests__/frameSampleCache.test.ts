/**
 * FrameSampleCache (PV72, #302) — the per-rAF-tick memo behind the shared frame
 * pump. Asserts the dedup CONTRACT directly: one analyser read + one scheduler
 * query per shared input object per tick, transfer-safe per-consumer copies, and
 * NO false-sharing across distinct objects. The end-to-end parity (a cached sample
 * == an uncached sample) lives in signalParity.test.ts; here we test the cache in
 * isolation with counting stubs.
 */
import { describe, it, expect } from 'vitest'
import { FrameSampleCache } from '../frameSampleCache'
import { MASTER_KEY, type AnalyserBytes } from '../signalFrame'
import { MainSignalSampler } from '../signalSampler'
import type { BusAnalyser } from '../../signals/SignalBus'
import type { IRPattern } from '../../../codeView/ir/IRPattern'
import type { IREvent } from '../../../codeView/ir/IREvent'

function bytes(key: string, n: number, seed: number): AnalyserBytes {
  const freq = new Uint8Array(n)
  const time = new Uint8Array(n * 2)
  for (let i = 0; i < n; i++) freq[i] = (i + seed) % 256
  for (let i = 0; i < n * 2; i++) time[i] = (i * 2 + seed) % 256
  return { key, frequencyBinCount: n, freq, time, fftSize: n * 2, minDecibels: -100, maxDecibels: -30 }
}

/** An analyser whose read closure counts how many times it actually ran. */
function countingAnalyser(seed: number): { an: BusAnalyser; reads: () => number; read: (a: BusAnalyser) => AnalyserBytes } {
  let n = 0
  const an = { frequencyBinCount: 8, getByteFrequencyData: () => {}, getByteTimeDomainData: () => {} } as BusAnalyser
  return { an, reads: () => n, read: () => { n++; return bytes(MASTER_KEY, 8, seed) } }
}

function countingScheduler(events: IREvent[]): { sched: IRPattern; queries: () => number } {
  let n = 0
  const sched: IRPattern = { now: () => 0, query: () => { n++; return events } }
  return { sched, queries: () => n }
}

describe('FrameSampleCache — analyser read dedup', () => {
  it('reads a shared analyser ONCE per tick, however many consumers ask', () => {
    const cache = new FrameSampleCache()
    const { an, reads, read } = countingAnalyser(1)
    const a = cache.readAnalyser(MASTER_KEY, an, read)
    const b = cache.readAnalyser(MASTER_KEY, an, read)
    const c = cache.readAnalyser('$0', an, read) // SAME object, different display key
    expect(reads()).toBe(1) // one FFT, three consumers
    expect(a).not.toBeNull()
    // Same byte values to every consumer.
    expect(Array.from(b!.freq)).toEqual(Array.from(a!.freq))
    // The display key is stamped per call (same node, two keys).
    expect(a!.key).toBe(MASTER_KEY)
    expect(c!.key).toBe('$0')
  })

  it('returns TRANSFER-SAFE copies — distinct buffers per consumer (frame transfer detaches)', () => {
    const cache = new FrameSampleCache()
    const { an, read } = countingAnalyser(2)
    const a = cache.readAnalyser(MASTER_KEY, an, read)!
    const b = cache.readAnalyser(MASTER_KEY, an, read)!
    expect(a.freq.buffer).not.toBe(b.freq.buffer) // not the same backing buffer
    expect(a.time.buffer).not.toBe(b.time.buffer)
    // Detaching one consumer's buffer (transfer) must not corrupt the other's.
    const before = Array.from(b.freq)
    // Simulate transfer by mutating a's array; b is independent.
    a.freq.fill(0)
    expect(Array.from(b.freq)).toEqual(before)
  })

  it('does NOT false-share across DISTINCT analyser objects (per-track binding)', () => {
    const cache = new FrameSampleCache()
    const m = countingAnalyser(1)
    const t = countingAnalyser(9)
    cache.readAnalyser(MASTER_KEY, m.an, m.read)
    cache.readAnalyser('$0', t.an, t.read)
    expect(m.reads()).toBe(1)
    expect(t.reads()).toBe(1) // each distinct object read once — no collapse
  })

  it('memoizes a null (zero-bin) read so it is not re-attempted', () => {
    const cache = new FrameSampleCache()
    let n = 0
    const an = { frequencyBinCount: 0, getByteFrequencyData: () => {}, getByteTimeDomainData: () => {} } as BusAnalyser
    const read = () => { n++; return null }
    expect(cache.readAnalyser(MASTER_KEY, an, read)).toBeNull()
    expect(cache.readAnalyser(MASTER_KEY, an, read)).toBeNull()
    expect(n).toBe(1)
  })
})

describe('FrameSampleCache — scheduler query dedup', () => {
  it('runs a shared (scheduler, window) query ONCE, shared by reference', () => {
    const cache = new FrameSampleCache()
    const events = [{ s: 'bd' } as unknown as IREvent]
    const { sched, queries } = countingScheduler(events)
    const r1 = cache.query(sched, 0, 0.001, () => sched.query(0, 0.001))
    const r2 = cache.query(sched, 0, 0.001, () => sched.query(0, 0.001))
    expect(queries()).toBe(1)
    expect(r1).toBe(r2) // same array ref — consumers summarise read-only
  })

  it('keys by WINDOW — different windows on the same scheduler query separately', () => {
    const cache = new FrameSampleCache()
    const { sched, queries } = countingScheduler([])
    cache.query(sched, 0, 0.001, () => sched.query(0, 0.001)) // active window
    cache.query(sched, -4, 2, () => sched.query(-4, 2)) // wide window
    expect(queries()).toBe(2)
  })

  it('does NOT false-share across DISTINCT scheduler objects', () => {
    const cache = new FrameSampleCache()
    const a = countingScheduler([])
    const b = countingScheduler([])
    cache.query(a.sched, 0, 0.001, () => a.sched.query(0, 0.001))
    cache.query(b.sched, 0, 0.001, () => b.sched.query(0, 0.001))
    expect(a.queries()).toBe(1)
    expect(b.queries()).toBe(1)
  })
})

describe('MainSignalSampler.sample(cache) — byte-identical to no cache (PV75)', () => {
  // A real analyser stub (slope + sine) so the frequency/time bytes are non-trivial.
  function realAnalyser(seed: number): BusAnalyser {
    const fbins = 32
    const fft = 64
    const freq = new Uint8Array(fbins)
    const time = new Uint8Array(fft)
    for (let i = 0; i < fbins; i++) freq[i] = (i * 3 + seed * 7) % 256
    for (let i = 0; i < fft; i++) time[i] = (128 + Math.round(80 * Math.sin((i + seed) * 0.3))) % 256
    return {
      frequencyBinCount: fbins,
      fftSize: fft,
      getByteFrequencyData: (a) => a.set(freq.subarray(0, a.length)),
      getByteTimeDomainData: (a) => a.set(time.subarray(0, a.length)),
    } as unknown as BusAnalyser
  }
  const ACTIVE = [{ s: 'bd', velocity: 0.9, note: 'c2', color: '#f00' } as unknown as IREvent]
  function freshSampler(): MainSignalSampler {
    const s = new MainSignalSampler()
    s.bind({
      scheduler: { now: () => 4.25, query: () => ACTIVE },
      trackSchedulers: new Map<string, IRPattern>([['$0', { now: () => 4.25, query: () => ACTIVE }]]),
      masterAnalyser: realAnalyser(1),
      trackAnalysers: new Map<string, BusAnalyser>([['$0', realAnalyser(2)]]),
    })
    return s
  }

  it('produces a frame byte-identical to the uncached path (modulo seq)', () => {
    const plain = freshSampler().sample()
    const cached = freshSampler().sample(new FrameSampleCache())
    // Same structure + same bytes — the cache only dedups WHO reads, not WHAT.
    expect(cached.now).toBe(plain.now)
    expect(cached.activeEvents).toEqual(plain.activeEvents)
    expect(cached.activeByTrack).toEqual(plain.activeByTrack)
    expect(cached.rawScheduler).toEqual(plain.rawScheduler)
    expect(cached.analysers.map((a) => a.key)).toEqual(plain.analysers.map((a) => a.key))
    for (let i = 0; i < plain.analysers.length; i++) {
      expect(Array.from(cached.analysers[i].freq)).toEqual(Array.from(plain.analysers[i].freq))
      expect(Array.from(cached.analysers[i].time)).toEqual(Array.from(plain.analysers[i].time))
      expect(cached.analysers[i].fftSize).toBe(plain.analysers[i].fftSize)
    }
  })

  it('two samplers SHARING a master analyser read it ONCE through one cache, with identical bytes', () => {
    const master = realAnalyser(5)
    let reads = 0
    const counting: BusAnalyser = {
      frequencyBinCount: master.frequencyBinCount,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fftSize: (master as any).fftSize,
      getByteFrequencyData: (a) => { reads++; master.getByteFrequencyData(a) },
      getByteTimeDomainData: (a) => master.getByteTimeDomainData(a),
    } as unknown as BusAnalyser
    const mk = () => {
      const s = new MainSignalSampler()
      s.bind({ scheduler: { now: () => 0, query: () => [] }, masterAnalyser: counting })
      return s
    }
    const cache = new FrameSampleCache()
    const f1 = mk().sample(cache)
    const f2 = mk().sample(cache)
    expect(reads).toBe(1) // ONE FFT for two viz — the PV72 collapse
    expect(Array.from(f1.analysers[0].freq)).toEqual(Array.from(f2.analysers[0].freq))
    // Distinct buffers → each is independently transferable.
    expect(f1.analysers[0].freq.buffer).not.toBe(f2.analysers[0].freq.buffer)
  })
})
