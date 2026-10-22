/**
 * SignalBus unit tests — PURE module, loads in isolation (P12: no p5/hydra).
 *
 * Covers the PLAN T1 (a)-(f) observations AND the two non-negotiable traps
 * (RESEARCH §5):
 *   1. Per-field feed — `.velocity`/`.note` from the SCHEDULER feed, never the
 *      envelope (HapEvent has NO velocity → silent zero).
 *   2. Two key spaces — `track('$0')` keys on `trackSchedulers.get('$0')`, NOT
 *      `IREvent.trackId` (which is `'d1'` for anonymous blocks).
 */

import { describe, it, expect } from 'vitest'
import {
  SignalBus,
  type BusHapEvent,
  type BusAnalyser,
} from '../signals/SignalBus'
import { ALIAS_MAP } from '../signals/aliasMap'
import type { IRPattern } from '../../codeView/ir/IRPattern'
import type { IREvent } from '../../codeView/ir/IREvent'

/** Build a fake IREvent with sensible defaults; override per test. */
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

/** A scheduler whose `query(now, now+ε)` returns a fixed event list, with a
 *  fixed `now()`. Used to drive the instantaneous (scheduler) feed. */
function makeScheduler(events: IREvent[], now = 0): IRPattern {
  return {
    now: () => now,
    query: (begin: number, end: number) =>
      events.filter((e) => e.begin >= begin && e.begin < end),
  }
}

/** A HapStream-shaped event for the envelope feed (`bump`). */
function hap(s: string, gain = 1, color: string | null = null): BusHapEvent {
  return { s, color, hap: { value: { gain } } }
}

/**
 * A fake AnalyserNode-shaped stub (P12 — structural, no DOM lib). `freqFill`
 * fills the magnitude buffer, `timeFill` the time-domain buffer, both per-index
 * so a known pattern can be asserted against the derived fields.
 */
function fakeAnalyser(
  bins: number,
  freqFill: (i: number) => number,
  timeFill: (i: number) => number = () => 128,
): BusAnalyser {
  return {
    frequencyBinCount: bins,
    getByteFrequencyData: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = freqFill(i)
    },
    getByteTimeDomainData: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = timeFill(i)
    },
  }
}

describe('SignalBus — .env feed (bump + decay)', () => {
  it('(a) bump then 3× tick decays envValue to ≈ 0.92³', () => {
    const bus = new SignalBus()
    bus.bump(hap('bd', 1))
    bus.tick()
    bus.tick()
    bus.tick()
    const expected = 0.92 ** 3
    expect(bus.envValue('bd')).toBeCloseTo(expected, 6)
  })

  it('bump clamps the level to 1 across repeated hits', () => {
    const bus = new SignalBus()
    bus.bump(hap('bd', 0.8))
    bus.bump(hap('bd', 0.8))
    // 0.8 + 0.8 = 1.6 → clamped to 1
    expect(bus.envValue('bd')).toBe(1)
  })

  it('decay is multiplicative — a never-fired sound stays 0', () => {
    const bus = new SignalBus()
    bus.tick()
    expect(bus.envValue('bd')).toBe(0)
  })
})

describe('SignalBus — alias resolution', () => {
  it('(b) uKick alias returns the bd envelope level', () => {
    const bus = new SignalBus()
    bus.bump(hap('bd', 1))
    expect(bus.envValue('uKick')).toBe(bus.envValue('bd'))
    expect(bus.envValue('uKick')).toBe(1)
  })

  it('(c) uTom array alias = MAX over lt / mt / ht', () => {
    const bus = new SignalBus()
    bus.bump(hap('lt', 0.3))
    bus.bump(hap('ht', 0.7))
    // max(0.3, 0, 0.7) = 0.7
    expect(bus.envValue('uTom')).toBeCloseTo(0.7, 6)
    expect(ALIAS_MAP.uTom).toEqual(['lt', 'mt', 'ht'])
  })

  it('a raw sound name (no alias) resolves to itself', () => {
    const bus = new SignalBus()
    bus.bump(hap('mysound', 0.5))
    expect(bus.envValue('mysound')).toBeCloseTo(0.5, 6)
  })
})

describe('SignalBus — per-field feed (TRAP §5)', () => {
  it('(d) .velocity comes from the SCHEDULER event, NON-zero — never the envelope', () => {
    const bus = new SignalBus()
    // Envelope feed gives env, but carries NO velocity.
    bus.bump(hap('bd', 1))
    // Scheduler feed carries the real velocity.
    const scheduler = makeScheduler([makeEvent({ s: 'bd', velocity: 0.42 })])
    bus.bindScheduler(scheduler, new Map())
    bus.tick()
    bus.refreshActive(bus.now())

    const reading = bus.sound('bd')
    // .velocity sourced from the scheduler feed — NON-zero.
    expect(reading.velocity).toBe(0.42)
    // .env sourced from the envelope feed (decayed once).
    expect(reading.env).toBeCloseTo(0.92, 6)
  })

  it('.velocity is 0 (not silent-wrong) when only the envelope fed it', () => {
    // No scheduler bound → no scheduler feed → velocity has no source → 0.
    // Proves the envelope feed does NOT supply a bogus velocity.
    const bus = new SignalBus()
    bus.bump(hap('bd', 1))
    bus.refreshActive(bus.now())
    expect(bus.sound('bd').velocity).toBe(0)
    // …but .env IS present from the envelope feed.
    expect(bus.sound('bd').env).toBe(1)
  })

  it('.note preserves the user form (string name) from the scheduler feed', () => {
    const bus = new SignalBus()
    const scheduler = makeScheduler([makeEvent({ s: 'piano', note: 'c3' })])
    bus.bindScheduler(scheduler, new Map())
    bus.refreshActive(bus.now())
    expect(bus.sound('piano').note).toBe('c3')
    // noteToMidi only when a NUMBER is explicitly requested (P93).
    expect(bus.noteToMidi('c3')).toBe(48)
  })

  it('.color prefers the active IREvent, falls back to last-bumped hap color', () => {
    const bus = new SignalBus()
    // Last-bumped hap color is the fallback.
    bus.bump(hap('bd', 1, '#ff0000'))
    bus.refreshActive(bus.now())
    expect(bus.sound('bd').color).toBe('#ff0000')

    // Active IREvent color wins over the fallback.
    const scheduler = makeScheduler([makeEvent({ s: 'bd', color: '#00ff00' })])
    bus.bindScheduler(scheduler, new Map())
    bus.refreshActive(bus.now())
    expect(bus.sound('bd').color).toBe('#00ff00')
  })
})

describe('SignalBus — two key spaces (TRAP §5)', () => {
  it('(e) track("$0") keys on the scheduler map, finds events whose trackId is "d1"', () => {
    const bus = new SignalBus()
    // The event carries IREvent.trackId='d1' (the IR key space) but the
    // SCHEDULER key is '$0' (anonymous block). Keying on trackId would miss it.
    const trackSched = makeScheduler([
      makeEvent({ s: 'bd', velocity: 0.9, trackId: 'd1' }),
    ])
    const trackSchedulers = new Map<string, IRPattern>([['$0', trackSched]])
    bus.bindScheduler(makeScheduler([]), trackSchedulers)
    bus.refreshActive(bus.now())

    const t = bus.track('$0')
    expect(t.velocity).toBe(0.9)
    // Enumerates the SCHEDULER key, not the IREvent.trackId.
    expect(bus.tracks).toEqual(['$0'])
  })

  it('track(unknownKey) returns zeros, never throws', () => {
    const bus = new SignalBus()
    bus.bindScheduler(makeScheduler([]), new Map())
    bus.refreshActive(bus.now())
    const t = bus.track('nope')
    expect(t.env).toBe(0)
    expect(t.velocity).toBe(0)
    expect(t.note).toBeNull()
  })

  it('track.sound(alias) reads a specific sound within the track', () => {
    const bus = new SignalBus()
    bus.bump(hap('bd', 1))
    const trackSched = makeScheduler([
      makeEvent({ s: 'bd', velocity: 0.5, trackId: 'd1' }),
    ])
    bus.bindScheduler(
      makeScheduler([]),
      new Map<string, IRPattern>([['$0', trackSched]]),
    )
    bus.tick()
    bus.refreshActive(bus.now())
    const r = bus.track('$0').sound('uKick')
    expect(r.velocity).toBe(0.5)
    expect(r.env).toBeCloseTo(0.92, 6)
  })
})

describe('SignalBus — enumeration', () => {
  it('(f) tracks lists the scheduler keys, sounds lists bumped sounds', () => {
    const bus = new SignalBus()
    bus.bump(hap('bd'))
    bus.bump(hap('sd'))
    bus.bump(hap('bd')) // duplicate — distinct set
    bus.bindScheduler(
      makeScheduler([]),
      new Map<string, IRPattern>([
        ['$0', makeScheduler([])],
        ['$1', makeScheduler([])],
      ]),
    )
    expect(bus.tracks).toEqual(['$0', '$1'])
    expect(bus.sounds.sort()).toEqual(['bd', 'sd'])
  })

  it('demo mode (no scheduler bound) — tracks empty, now() = 0', () => {
    const bus = new SignalBus()
    expect(bus.tracks).toEqual([])
    expect(bus.now()).toBe(0)
  })
})

describe('SignalBus — purity / live-ref rebind', () => {
  it('bindScheduler rebinds live refs in place (mirror renderer update)', () => {
    const bus = new SignalBus()
    const schedA = makeScheduler([makeEvent({ s: 'bd', velocity: 0.1 })])
    bus.bindScheduler(schedA, new Map())
    bus.refreshActive(bus.now())
    expect(bus.sound('bd').velocity).toBe(0.1)

    const schedB = makeScheduler([makeEvent({ s: 'bd', velocity: 0.8 })])
    bus.bindScheduler(schedB, new Map())
    bus.refreshActive(bus.now())
    expect(bus.sound('bd').velocity).toBe(0.8)
  })

  it('accepts a custom alias map (D-04 override seam)', () => {
    const bus = new SignalBus({ uBoom: 'bd' })
    bus.bump(hap('bd', 1))
    expect(bus.envValue('uBoom')).toBe(1)
    // The built-in uKick is absent from the custom map → treated as raw name.
    expect(bus.envValue('uKick')).toBe(0)
  })
})

describe('SignalBus — DSP feed (analyser reads, Slice 2)', () => {
  // 32 raw bins → binSize 1 → fft[i] = freq[i]/255 directly (clean to assert).
  // Magnitude pattern: low third (bins 0..9) = 255, rest = 0 → bass=1, mid=treble=0.
  // FFT_BINS = 32; third = floor(32/3) = 10 → bass = mean(fft[0..10)),
  // mid = mean(fft[10..20)), treble = mean(fft[20..32)).
  const lowEnergyFreq = (i: number) => (i < 10 ? 255 : 0)
  // Time-domain all 255 → (255-128)/128 = 0.9921875 → rms = that, wave = that.
  const fullScaleTime = () => 255
  const EXPECTED_FULL = (255 - 128) / 128 // 0.9921875

  it('(g) .fft is normalized 0..1 and .bass/.mid/.treble are the band means', () => {
    const bus = new SignalBus()
    const master = fakeAnalyser(32, lowEnergyFreq)
    bus.bindAnalysers(master, new Map())
    bus.readAudio()

    const r = bus.master()
    expect(r.fft.length).toBe(32)
    // Low third saturated (1.0), rest silent (0.0) — normalized, never >1.
    expect(r.fft.slice(0, 10).every((v) => v === 1)).toBe(true)
    expect(r.fft.slice(10).every((v) => v === 0)).toBe(true)
    // bass = mean of bins 0..9 (all 1) = 1; mid/treble silent thirds = 0.
    expect(r.bass).toBeCloseTo(1, 6)
    expect(r.mid).toBeCloseTo(0, 6)
    expect(r.treble).toBeCloseTo(0, 6)
  })

  it('(h) .rms + .wave derive from a known time-domain buffer (clamped 0..1)', () => {
    const bus = new SignalBus()
    const master = fakeAnalyser(16, () => 0, fullScaleTime)
    bus.bindAnalysers(master, new Map())
    bus.readAudio()

    const r = bus.master()
    // rms = sqrt(mean(((255-128)/128)²)) = (255-128)/128, clamped ≤ 1.
    expect(r.rms).toBeCloseTo(EXPECTED_FULL, 6)
    expect(r.rms).toBeLessThanOrEqual(1)
    // wave normalized -1..1; every sample = the full-scale value.
    expect(r.wave.length).toBe(16)
    expect(r.wave.every((v) => Math.abs(v - EXPECTED_FULL) < 1e-9)).toBe(true)
  })

  it('mid-band isolation — energy ONLY in the mid third lifts .mid, not bass/treble', () => {
    const bus = new SignalBus()
    // Bins 10..19 saturated → mid = 1, bass = treble = 0.
    const master = fakeAnalyser(32, (i) => (i >= 10 && i < 20 ? 255 : 0))
    bus.bindAnalysers(master, new Map())
    bus.readAudio()
    const r = bus.master()
    expect(r.mid).toBeCloseTo(1, 6)
    expect(r.bass).toBeCloseTo(0, 6)
    expect(r.treble).toBeCloseTo(0, 6)
  })

  it('(i) audioFor — isolated: bd in EXACTLY one active track reads THAT track analyser', () => {
    const bus = new SignalBus()
    // bd plays in only one anonymous track ($0). Its isolated analyser is a
    // saturated-bass node; the master is silent — so a bass reading proves the
    // per-track (not master) analyser was chosen.
    const trackSched = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    bus.bindScheduler(
      makeScheduler([makeEvent({ s: 'bd', velocity: 1 })]),
      new Map<string, IRPattern>([['$0', trackSched]]),
    )
    const isolated = fakeAnalyser(32, (i) => (i < 10 ? 255 : 0)) // bass = 1
    const silentMaster = fakeAnalyser(32, () => 0) // bass = 0
    bus.bindAnalysers(silentMaster, new Map([['$0', isolated]]))
    bus.refreshActive(bus.now())
    bus.readAudio()

    // bd resolves to the $0 isolated analyser → bass = 1 (NOT the silent master).
    expect(bus.sound('bd').bass).toBeCloseTo(1, 6)
  })

  it('(j) audioFor — fallback: bd spanning TWO active tracks reads the master mix', () => {
    const bus = new SignalBus()
    // bd is active in BOTH $0 and $1 → not isolated → master.
    const tA = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    const tB = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    bus.bindScheduler(
      makeScheduler([makeEvent({ s: 'bd', velocity: 1 })]),
      new Map<string, IRPattern>([
        ['$0', tA],
        ['$1', tB],
      ]),
    )
    // Per-track analysers are bass-saturated; the master is treble-saturated —
    // so a treble reading proves the MASTER (not a track) was chosen.
    const trackAn = fakeAnalyser(32, (i) => (i < 10 ? 255 : 0)) // bass
    const master = fakeAnalyser(32, (i) => (i >= 20 ? 255 : 0)) // treble
    bus.bindAnalysers(
      master,
      new Map([
        ['$0', trackAn],
        ['$1', trackAn],
      ]),
    )
    bus.refreshActive(bus.now())
    bus.readAudio()

    const r = bus.sound('bd')
    expect(r.treble).toBeCloseTo(1, 6) // master mix, not the per-track bass
    expect(r.bass).toBeCloseTo(0, 6)
  })

  it('audioFor — no per-track analyser for the isolated track falls back to master', () => {
    const bus = new SignalBus()
    const trackSched = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    bus.bindScheduler(
      makeScheduler([makeEvent({ s: 'bd', velocity: 1 })]),
      new Map<string, IRPattern>([['$0', trackSched]]),
    )
    // bd is isolated in $0, but NO analyser is bound for $0 → master mix.
    const master = fakeAnalyser(32, (i) => (i < 10 ? 255 : 0)) // bass
    bus.bindAnalysers(master, new Map()) // empty trackAnalysers
    bus.refreshActive(bus.now())
    bus.readAudio()
    expect(bus.sound('bd').bass).toBeCloseTo(1, 6) // from the master
  })

  it('u.track(id) reads that track key-spaced analyser (TRAP §5 keying)', () => {
    const bus = new SignalBus()
    const trackSched = makeScheduler([makeEvent({ s: 'bd', velocity: 1 })])
    bus.bindScheduler(
      makeScheduler([]),
      new Map<string, IRPattern>([['$0', trackSched]]),
    )
    const trackAn = fakeAnalyser(32, (i) => (i >= 20 ? 255 : 0)) // treble
    bus.bindAnalysers(fakeAnalyser(32, () => 0), new Map([['$0', trackAn]]))
    bus.refreshActive(bus.now())
    bus.readAudio()
    expect(bus.track('$0').treble).toBeCloseTo(1, 6)
  })

  it('(k) absent analyser → rms 0, fft/wave empty — never NaN', () => {
    const bus = new SignalBus()
    // No analysers bound at all (IR-only / demo mode).
    bus.bindScheduler(makeScheduler([makeEvent({ s: 'bd' })]), new Map())
    bus.refreshActive(bus.now())
    bus.readAudio()

    const r = bus.sound('bd')
    expect(r.rms).toBe(0)
    expect(Number.isNaN(r.rms)).toBe(false)
    expect(r.fft).toEqual([])
    expect(r.wave).toEqual([])
    expect(r.bass).toBe(0)
    expect(r.mid).toBe(0)
    expect(r.treble).toBe(0)
    // master() with no master bound is also the zero reading (no NaN).
    expect(bus.master().rms).toBe(0)
    expect(bus.master().fft).toEqual([])
  })

  it('readAudio is rebind-friendly — a new analyser ref re-reads next frame', () => {
    const bus = new SignalBus()
    bus.bindAnalysers(fakeAnalyser(32, () => 0), new Map())
    bus.readAudio()
    expect(bus.master().bass).toBeCloseTo(0, 6)

    // Rebind to a bass-saturated master (mirror bindScheduler live-rebind).
    bus.bindAnalysers(fakeAnalyser(32, (i) => (i < 10 ? 255 : 0)), new Map())
    bus.readAudio()
    expect(bus.master().bass).toBeCloseTo(1, 6)
  })

  // ── Custom alias merge (Phase 21 aliases — T2) ─────────────────────────────
  describe('setAliases (custom alias merge — T2)', () => {
    it('resolves a NEW array alias (kick → [bd, kick9]) as MAX over members', () => {
      const bus = new SignalBus()
      // The bus starts with ONLY the built-in ALIAS_MAP — `kick` is unknown,
      // so it resolves to the raw sound name `kick` (env 0, nothing fired).
      expect(bus.envValue('kick')).toBe(0)

      // The renderer pushes a merged map (built-ins + custom). Custom `kick`
      // maps to two members — env resolves as the MAX over them.
      bus.setAliases({ ...ALIAS_MAP, kick: ['bd', 'kick9'] })

      // bump bd → kick (alias) reflects bd's level.
      bus.bump(hap('bd', 1))
      expect(bus.envValue('kick')).toBeCloseTo(1, 6) // max(bd=1, kick9=0)

      // bump kick9 higher is impossible (gain clamps to 1); bump a SECOND
      // member to prove MAX-over-members, not just the first.
      bus.bump(hap('kick9', 1))
      expect(bus.envValue('kick')).toBeCloseTo(1, 6) // max(bd=1, kick9=1)

      // A built-in alias still resolves AFTER the merge (custom didn't clobber).
      expect(bus.envValue('uKick')).toBeCloseTo(1, 6) // uKick → bd → 1
    })

    it('resolves a NEW single-string alias (lead → sawtooth)', () => {
      const bus = new SignalBus()
      bus.setAliases({ ...ALIAS_MAP, lead: 'sawtooth' })
      bus.bump(hap('sawtooth', 1))
      expect(bus.envValue('lead')).toBeCloseTo(1, 6)
    })

    it('custom WINS on collision with a built-in key', () => {
      const bus = new SignalBus()
      // Override the built-in `uKick → bd` to point at a DIFFERENT sound.
      bus.setAliases({ ...ALIAS_MAP, uKick: 'tabla' })
      bus.bump(hap('bd', 1))
      // bd fired but uKick now maps to `tabla` → custom override wins → 0.
      expect(bus.envValue('uKick')).toBe(0)
      bus.bump(hap('tabla', 1))
      expect(bus.envValue('uKick')).toBeCloseTo(1, 6)
    })
  })
})
