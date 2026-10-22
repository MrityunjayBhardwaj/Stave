/**
 * glslEvents unit tests (#297, #284) — PURE: drive a real `SignalBus` through one
 * frame and assert the GLSL uniform snapshots. `readGLSLTracks` packs `bus.track()`
 * readings two-vec3-per-track (`a = env/velocity/rms`, `b = bass/mid/treble`) in
 * `bus.tracks` order, capped at `MAX_GLSL_TRACKS`. No GL — the texture upload is
 * covered by the Playwright glsl e2e.
 */

import { describe, it, expect } from 'vitest'
import { readGLSLEvents, readGLSLTracks } from '../renderers/glslEvents'
import { MAX_GLSL_TRACKS } from '../renderers/glslCore'
import { SignalBus, type BusAnalyser } from '../signals/SignalBus'
import type { IRPattern } from '../../codeView/ir/IRPattern'
import type { IREvent } from '../../codeView/ir/IREvent'

function makeEvent(over: Partial<IREvent>): IREvent {
  return {
    begin: 0,
    end: 0.1,
    endClipped: 0.1,
    note: 0,
    freq: 0,
    s: null,
    gain: 1,
    velocity: 1,
    color: null,
    ...over,
  }
}

/** Scheduler whose query returns its fixed events for the [now, now+ε) window. */
function makeScheduler(events: IREvent[], now = 0): IRPattern {
  return {
    now: () => now,
    query: (begin: number, end: number) =>
      events.filter((e) => e.begin >= begin && e.begin < end),
  }
}

/** Structural analyser stub — constant freq fill → known bass/mid/treble. */
function fakeAnalyser(bins: number, freqByte: number): BusAnalyser {
  return {
    frequencyBinCount: bins,
    getByteFrequencyData: (arr: Uint8Array) => arr.fill(freqByte),
    getByteTimeDomainData: (arr: Uint8Array) => arr.fill(128), // silence center
  }
}

/** Run the per-frame sequence (mirror GLSLVizRenderer.loop / WorkerBusFeed). */
function tickFrame(bus: SignalBus): void {
  bus.tick()
  bus.refreshActive(bus.now())
  bus.readAudio()
}

describe('readGLSLTracks (#297)', () => {
  it('no tracks bound → count 0, full-length zero payloads', () => {
    const bus = new SignalBus()
    tickFrame(bus)
    const tr = readGLSLTracks(bus)
    expect(tr.count).toBe(0)
    expect(tr.a).toHaveLength(MAX_GLSL_TRACKS * 3)
    expect(tr.b).toHaveLength(MAX_GLSL_TRACKS * 3)
    expect(Array.from(tr.a).every((v) => v === 0)).toBe(true)
    expect(Array.from(tr.b).every((v) => v === 0)).toBe(true)
  })

  it('packs env/velocity per track in bus.tracks order', () => {
    const bus = new SignalBus()
    const d1 = makeScheduler([makeEvent({ s: 'bd', velocity: 0.7 })])
    const d2 = makeScheduler([makeEvent({ s: 'sd', velocity: 0.5 })])
    bus.bindScheduler(makeScheduler([]), new Map([['d1', d1], ['d2', d2]]))
    bus.bump({ s: 'bd', color: null, hap: { value: { gain: 0.6 } } })
    bus.bump({ s: 'sd', color: null, hap: { value: { gain: 0.4 } } })
    tickFrame(bus) // tick decays 0.6→0.552, 0.4→0.368 BEFORE refreshActive

    expect(bus.tracks).toEqual(['d1', 'd2'])
    const tr = readGLSLTracks(bus)
    expect(tr.count).toBe(2)
    // track d1 (index 0): a = (env, velocity, rms)
    expect(tr.a[0]).toBeCloseTo(0.6 * 0.92, 5) // env (decayed once)
    expect(tr.a[1]).toBeCloseTo(0.7, 5) // velocity (scheduler feed)
    expect(tr.a[2]).toBe(0) // rms — no analyser bound
    // track d2 (index 1)
    expect(tr.a[3]).toBeCloseTo(0.4 * 0.92, 5)
    expect(tr.a[4]).toBeCloseTo(0.5, 5)
  })

  it('packs per-track DSP (bass/mid/treble) from the track analyser into b', () => {
    const bus = new SignalBus()
    const d1 = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    bus.bindScheduler(makeScheduler([]), new Map([['d1', d1]]))
    // Full-scale magnitude (255) across all bins → bass=mid=treble≈1.
    bus.bindAnalysers(null, new Map([['d1', fakeAnalyser(96, 255)]]))
    tickFrame(bus)

    const tr = readGLSLTracks(bus)
    expect(tr.count).toBe(1)
    expect(tr.b[0]).toBeCloseTo(1, 2) // bass
    expect(tr.b[1]).toBeCloseTo(1, 2) // mid
    expect(tr.b[2]).toBeCloseTo(1, 2) // treble
  })

  it('clamps count to MAX_GLSL_TRACKS, dropping the overflow', () => {
    const bus = new SignalBus()
    const entries = new Map<string, IRPattern>()
    for (let i = 0; i < MAX_GLSL_TRACKS + 4; i++) {
      entries.set(`d${i}`, makeScheduler([makeEvent({ s: `s${i}` })]))
    }
    bus.bindScheduler(makeScheduler([]), entries)
    tickFrame(bus)

    const tr = readGLSLTracks(bus)
    expect(bus.tracks.length).toBe(MAX_GLSL_TRACKS + 4)
    expect(tr.count).toBe(MAX_GLSL_TRACKS)
    expect(tr.a).toHaveLength(MAX_GLSL_TRACKS * 3)
  })
})

describe('readGLSLEvents (#284) — regression', () => {
  it('reads named drum envelopes + master DSP, all 0 in silence', () => {
    const bus = new SignalBus()
    tickFrame(bus)
    const ev = readGLSLEvents(bus)
    expect(ev.uKick).toBe(0)
    expect(ev.uRms).toBe(0)
    expect(ev.uVelocity).toBe(0)
  })
})
