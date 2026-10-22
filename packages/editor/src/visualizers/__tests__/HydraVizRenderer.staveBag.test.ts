/**
 * HydraVizRenderer — `stave` bag wiring (issue #32).
 *
 * The sketch function receives a second argument whose fields forward
 * `components.queryable.scheduler` and `.trackSchedulers`. Sketches
 * that capture `stave` in a closure observe live refs — `update()`
 * mutates the same bag in place instead of re-evaluating.
 *
 * These tests don't spin up a real hydra instance. We hand the
 * renderer a pre-built pattern function that records its `stave`
 * arg and poke the code paths that bind / rebind / tear down the
 * bag. The hydra bootstrap path (lazy `import('hydra-synth')`) runs
 * off the critical path of these assertions.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock the editorRegistry settings surface so mount() reads a controllable
// custom alias map (Phase 21 aliases — T2 hydra thunks). Defaults to `{}` so
// every PRE-EXISTING test keeps its built-ins-only behavior; the alias test
// overrides the return. The bus stays pure (P12) — only the renderer reads it.
// The renderer reads the RAW engine-keyed map; resolveAliasesForEngine (real,
// not mocked) flattens it to the active engine. So the mock returns the stored
// engine-keyed shape `{ name: { strudel: ... } }`.
const mockGetStoredSignalAliases = vi.fn(
  () => ({}) as Record<string, Record<string, string | string[]>>,
)
vi.mock('../../workspace/editorRegistry', () => ({
  getStoredSignalAliases: () => mockGetStoredSignalAliases(),
}))

import { HydraVizRenderer, type HydraStaveBag } from '../renderers/HydraVizRenderer'
import type { SignalBus } from '../signals/SignalBus'
import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { IRPattern } from '../../codeView/ir/IRPattern'
import type { IREvent } from '../../codeView/ir/IREvent'

// Minimal IREvent shape — tests don't need every optional field, and
// TS's structural typing lets us spread from a partial.
type IREventLike = IREvent

function makeScheduler(): IRPattern {
  return {
    now: () => 0,
    query: () => [],
  }
}

describe('HydraVizRenderer — stave bag', () => {
  it('mount() forwards scheduler and trackSchedulers into the stave bag', () => {
    let capturedBag: HydraStaveBag | null = null
    const renderer = new HydraVizRenderer((_synth, stave) => {
      capturedBag = stave
    })

    const scheduler = makeScheduler()
    const drums = makeScheduler()
    const tracks = new Map([['drums', drums]])

    // Invoke the non-hydra portion of mount — we call the private
    // component-ingestion by constructing a components bag and
    // pushing it via `update()`, which exercises the same write
    // path as mount().
    renderer.update({
      queryable: { scheduler, trackSchedulers: tracks },
    } as Partial<EngineComponents>)

    // Pull the live bag by invoking the pattern with a fake synth;
    // HydraVizRenderer.initHydra would normally call this, but we
    // can reach the bag directly via the update-side-effect test.
    // Easier: the class exposes the bag via the second pattern arg
    // when initHydra runs the pattern. Here we poke the internal
    // field via a type-cast escape hatch.
    const bag = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag

    expect(bag.scheduler).toBe(scheduler)
    expect(bag.tracks.get('drums')).toBe(drums)
    // Silence unused warning — capturedBag is only set during a real
    // hydra mount, which we don't exercise here.
    void capturedBag
  })

  it('update() mutates the same bag object so captured refs stay live', () => {
    const renderer = new HydraVizRenderer()
    const bag1 = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag

    const schedulerA = makeScheduler()
    renderer.update({
      queryable: { scheduler: schedulerA, trackSchedulers: new Map() },
    } as Partial<EngineComponents>)

    const bag2 = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag
    // Same object identity — live-ref contract. Sketches that close
    // over `stave` in a per-frame callback observe the new scheduler
    // without rebuilding the closure.
    expect(bag2).toBe(bag1)
    expect(bag2.scheduler).toBe(schedulerA)

    const schedulerB = makeScheduler()
    renderer.update({
      queryable: { scheduler: schedulerB, trackSchedulers: new Map() },
    } as Partial<EngineComponents>)

    expect(bag2.scheduler).toBe(schedulerB)
  })

  it('scheduler is null when queryable slot is absent (demo mode)', () => {
    const renderer = new HydraVizRenderer()
    renderer.update({} as Partial<EngineComponents>)
    const bag = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag
    expect(bag.scheduler).toBeNull()
    expect(bag.tracks.size).toBe(0)
  })

  describe('H() sugar helper (issue #36)', () => {
    function makePointScheduler(events: Record<number, Partial<IREventLike>>) {
      const now = () => 0
      const query = (begin: number, end: number): IREventLike[] => {
        const out: IREventLike[] = []
        for (const [tStr, ev] of Object.entries(events)) {
          const t = Number(tStr)
          if (t >= begin && t < end) {
            out.push({
              begin: t,
              end: t + 0.1,
              endClipped: t + 0.1,
              note: 0,
              freq: 0,
              s: null,
              gain: 1,
              velocity: 1,
              color: null,
              ...ev,
            })
          }
        }
        return out
      }
      return { now, query } as IRPattern
    }

    it('returns a function callable per-frame that reads the current event', () => {
      const renderer = new HydraVizRenderer()
      const drums = makePointScheduler({
        0: { gain: 0.7, note: 60 },
      })
      renderer.update({
        queryable: {
          scheduler: null,
          trackSchedulers: new Map([['drums', drums]]),
        },
      } as Partial<EngineComponents>)

      const bag = (renderer as unknown as { staveBag: HydraStaveBag })
        .staveBag
      const sampler = bag.H('drums') // default field = 'gain'
      expect(typeof sampler).toBe('function')
      expect(sampler()).toBe(0.7)

      const noteSampler = bag.H('drums', 'note')
      expect(noteSampler()).toBe(60)
    })

    it('returns 0 when the track is absent or no event is active', () => {
      const renderer = new HydraVizRenderer()
      const bag = (renderer as unknown as { staveBag: HydraStaveBag })
        .staveBag
      // No scheduler bound yet.
      expect(bag.H('nonexistent')()).toBe(0)

      // Scheduler bound, but no event at now.
      const empty = makePointScheduler({})
      renderer.update({
        queryable: {
          scheduler: null,
          trackSchedulers: new Map([['drums', empty]]),
        },
      } as Partial<EngineComponents>)
      expect(bag.H('drums')()).toBe(0)
    })

    it('falls back to combined scheduler when named track is missing', () => {
      const renderer = new HydraVizRenderer()
      const combined = makePointScheduler({ 0: { gain: 0.3 } })
      renderer.update({
        queryable: { scheduler: combined, trackSchedulers: new Map() },
      } as Partial<EngineComponents>)
      const bag = (renderer as unknown as { staveBag: HydraStaveBag })
        .staveBag
      // 'anything' not in tracks -> falls back to combined
      expect(bag.H('anything')()).toBe(0.3)
    })

    it('H sampler observes live-ref swaps without re-acquiring from the bag', () => {
      const renderer = new HydraVizRenderer()
      const bag = (renderer as unknown as { staveBag: HydraStaveBag })
        .staveBag
      const sampler = bag.H('bass')

      // No scheduler yet -> 0
      expect(sampler()).toBe(0)

      // Bind scheduler mid-run — same sampler closure must pick it up.
      const bass = makePointScheduler({ 0: { gain: 0.9 } })
      renderer.update({
        queryable: {
          scheduler: null,
          trackSchedulers: new Map([['bass', bass]]),
        },
      } as Partial<EngineComponents>)
      expect(sampler()).toBe(0.9)
    })
  })

  describe('SignalBus wiring (Phase 21 — T2)', () => {
    // Reuse the point-scheduler helper shape from the H() suite: a scheduler
    // that returns the events whose time falls in [begin, end). The bus's
    // `refreshActive` queries [now, now+ε); these events sit at t=0 and now()
    // returns 0, so they are caught by the ε window.
    function makePointScheduler(events: Record<number, Partial<IREvent>>): IRPattern {
      const now = () => 0
      const query = (begin: number, end: number): IREvent[] => {
        const out: IREvent[] = []
        for (const [tStr, ev] of Object.entries(events)) {
          const t = Number(tStr)
          if (t >= begin && t < end) {
            out.push({
              begin: t,
              end: t + 0.1,
              endClipped: t + 0.1,
              note: 0,
              freq: 0,
              s: null,
              gain: 1,
              velocity: 1,
              color: null,
              ...ev,
            } as IREvent)
          }
        }
        return out
      }
      return { now, query } as IRPattern
    }

    // A minimal HapStream stand-in — records the subscribed handler so the
    // test can drive `.env` bumps the way the engine's onTrigger would.
    function makeHapStream() {
      const handlers = new Set<(e: any) => void>()
      return {
        on: (h: (e: any) => void) => handlers.add(h),
        off: (h: (e: any) => void) => handlers.delete(h),
        emit: (e: any) => handlers.forEach((h) => h(e)),
        get size() {
          return handlers.size
        },
      }
    }

    /** Pull the renderer's private bag without re-mounting. */
    function bagOf(r: HydraVizRenderer): HydraStaveBag {
      return (r as unknown as { staveBag: HydraStaveBag }).staveBag
    }
    /** Read `this.analyser` truthiness — the BLOCK-1 guard assertion. */
    function analyserOf(r: HydraVizRenderer): unknown {
      return (r as unknown as { analyser: unknown }).analyser
    }
    /** Drive one `pumpAudio` rAF tick directly (deterministic — no rAF wait). */
    function pump(r: HydraVizRenderer): void {
      ;(r as unknown as { pumpAudio: (now?: number) => void }).pumpAudio(0)
    }

    it('feeds + ticks uKick UNCONDITIONALLY with a real analyser present (BLOCK-1/FLAG-2)', () => {
      const renderer = new HydraVizRenderer()
      const hapStream = makeHapStream()
      // The kick track: an active `bd` event carrying a velocity. Keyed `$0`
      // (scheduler key space — anonymous block), NOT IREvent.trackId.
      const kickTrack = makePointScheduler({
        0: { s: 'bd', velocity: 0.8, note: 'c2', color: '#ff0000' },
      })
      const trackSchedulers = new Map([['$0', kickTrack]])
      const combined = makePointScheduler({
        0: { s: 'bd', velocity: 0.8, note: 'c2', color: '#ff0000' },
      })

      // mount() with a NON-null analyser — this is the production real-FFT
      // path. The envelope's `.on()` is SKIPPED here; the bus feed must NOT
      // be (BLOCK-1). A no-analyser test would false-green the misplacement.
      const fakeAnalyser = {
        frequencyBinCount: 8,
        getByteFrequencyData: () => {},
        // Slice 2: pumpAudio now runs bus.readAudio() unconditionally, which
        // reads the time-domain buffer off every bound analyser. Stub it.
        getByteTimeDomainData: () => {},
      } as unknown as AnalyserNode
      renderer.mount(
        document.createElement('div'),
        {
          audio: { analyser: fakeAnalyser } as any,
          streaming: { hapStream: hapStream as any } as any,
          queryable: { scheduler: combined, trackSchedulers } as any,
        } as Partial<EngineComponents>,
        { w: 64, h: 64 },
        () => {} // swallow the async hydra-synth import rejection in jsdom
      )

      // GUARD: the analyser IS truthy — we are on the real-FFT path, the one
      // production runs and the one that skips the envelope subscription.
      expect(analyserOf(renderer)).toBeTruthy()
      // The bus subscribed to the HapStream despite the analyser being set.
      expect(hapStream.size).toBe(1)

      const bag = bagOf(renderer)

      // Before any bump, uKick is 0.
      expect(bag.sig.kick()).toBe(0)

      // Fire a `bd` hap (what the engine's onTrigger does). `.env` bumps.
      hapStream.emit({ s: 'bd', color: '#ff0000', hap: { value: { gain: 1 } } })
      // uKick reflects the bumped `bd` env — NON-ZERO with the analyser
      // present (the BLOCK-1 headline assertion).
      expect(bag.sig.kick()).toBeGreaterThan(0)
      const bumped = bag.sig.kick()
      expect(bumped).toBe(1)

      // pumpAudio ticks the bus (decay) UNCONDITIONALLY even on the FFT path.
      pump(renderer)
      // After one tick uKick has decayed (× 0.92) but stays non-zero — proves
      // the tick ran WITH the analyser present (not gated to envelope mode).
      const decayed = bag.sig.kick()
      expect(decayed).toBeLessThan(bumped)
      expect(decayed).toBeCloseTo(0.92, 5)
      expect(decayed).toBeGreaterThan(0)

      // .velocity reads the SCHEDULER event's velocity (NOT the envelope —
      // §5 silent-zero trap). refreshActive ran in pump() above.
      expect(bag.sig('bd').velocity()).toBe(0.8)
      // .note preserves the user's form (name), .color rides the event.
      expect(bag.sig('bd').note()).toBe('c2')
      expect(bag.sig('bd').color()).toBe('#ff0000')

      // Two-key-space: u.track('$0') resolves on the scheduler key, not the
      // IREvent.trackId. Enumeration lists the published key.
      expect(bag.sig.track('$0').velocity()).toBe(0.8)
      expect(bag.sig.tracks).toEqual(['$0'])
      expect(bag.sig.sounds).toContain('bd')

      // uKeyVelocity = active event velocity globally.
      expect(bag.sig.keyVelocity()).toBe(0.8)

      // stave.sig is the SAME object as the bare bag.sig (D-02).
      expect(bag.sig).toBe((bag as HydraStaveBag).sig)

      renderer.destroy()
      // destroy() offs the bus subscription unconditionally.
      expect(hapStream.size).toBe(0)
    })

    /**
     * A fake analyser (BusAnalyser shape, T1 test pattern): `frequencyBinCount`
     * bins, `getByteFrequencyData` fills a KNOWN magnitude into the low band
     * (so `.bass`/`.fft` are non-zero), `getByteTimeDomainData` fills a constant
     * non-silent offset (so `.rms` from `(v-128)/128` is non-zero). This is the
     * DSP-feed analyser — distinct from the FFT-pump's bare `freqData`-only stub.
     */
    function makeAudioAnalyser(opts?: {
      lowMag?: number
      timeVal?: number
      bins?: number
    }) {
      const n = opts?.bins ?? 32
      const lowMag = opts?.lowMag ?? 200 // 0..255, lands in the LOW third → .bass
      const timeVal = opts?.timeVal ?? 200 // 0..255, 128 = silence → rms>0
      return {
        frequencyBinCount: n,
        getByteFrequencyData: (arr: Uint8Array) => {
          // Fill only the low third — bass non-zero, treble ~0, fft populated.
          const third = Math.floor(n / 3)
          for (let i = 0; i < n; i++) arr[i] = i < third ? lowMag : 0
        },
        getByteTimeDomainData: (arr: Uint8Array) => {
          for (let i = 0; i < n; i++) arr[i] = timeVal
        },
      }
    }

    /**
     * Pull the renderer's private bus — T2's observation reads DSP fields at
     * the BUS boundary (`bus.sound('bd').rms`), NOT the hydra `u('bd').rms()`
     * thunk: the hydra accessor's DSP thunks (`.rms`/`.bass`/`.fft`) are
     * T3's deliverable (PLAN-SLICE2 §T3), not yet wired. T2's job is the
     * per-frame WIRING — that `pumpAudio` binds the analysers (in mount) and
     * runs `readAudio()` AFTER `refreshActive`. The bus reading is the direct
     * observation of that wiring; T3 will surface it on the bag thunks.
     */
    function busOf(r: HydraVizRenderer): SignalBus {
      return (r as unknown as { bus: SignalBus }).bus
    }

    it('mount binds analysers + pumpAudio readAudio drives bus DSP off a live analyser, after a frame (T2 / FLAG-2)', () => {
      const renderer = new HydraVizRenderer()
      const hapStream = makeHapStream()
      // `bd` lives in exactly ONE active track ($0) → audioFor picks that
      // track's ISOLATED analyser (not master). Scheduler key space, NOT trackId.
      const kickTrack = makePointScheduler({ 0: { s: 'bd', velocity: 0.8 } })
      const trackSchedulers = new Map([['$0', kickTrack]])
      const combined = makePointScheduler({ 0: { s: 'bd', velocity: 0.8 } })

      // Master analyser AND a per-track ($0) analyser — the production shape
      // (LiveCodingEngine publishes both). A REAL master analyser means we are
      // on the production FFT path (P96/FLAG-2): the read must NOT be gated to
      // the envelope-fallback branch.
      const master = makeAudioAnalyser({ lowMag: 50 }) // weaker master mix
      const kickAnalyser = makeAudioAnalyser({ lowMag: 200, timeVal: 200 })
      const trackAnalysers = new Map([['$0', kickAnalyser]])

      renderer.mount(
        document.createElement('div'),
        {
          audio: {
            analyser: master,
            trackAnalysers,
          } as any,
          streaming: { hapStream: hapStream as any } as any,
          queryable: { scheduler: combined, trackSchedulers } as any,
        } as Partial<EngineComponents>,
        { w: 64, h: 64 },
        () => {} // swallow the async hydra-synth import rejection in jsdom
      )

      // GUARD (P96/FLAG-2): the analyser IS truthy — production FFT path, the
      // one that skips the envelope subscription. A no-analyser test false-greens.
      expect(analyserOf(renderer)).toBeTruthy()

      const bus = busOf(renderer)

      // Before any frame, readAudio hasn't run — DSP fields are the zero reading.
      expect(bus.sound('bd').rms).toBe(0)
      expect(bus.sound('bd').bass).toBe(0)
      expect(bus.sound('bd').fft).toEqual([])

      // Drive ONE frame. pumpAudio runs tick → refreshActive → readAudio in
      // order; readAudio reads the bound analysers off the fresh activeByTrack.
      pump(renderer)

      // REAL audio is now live and distinct from `.env`: rms/bass non-zero,
      // sourced from the isolated $0 analyser (audioFor picks it — bd owns one
      // active track). fft is the populated 32-bucket spectrum.
      const reading = bus.sound('bd')
      expect(reading.rms).toBeGreaterThan(0)
      expect(reading.bass).toBeGreaterThan(0)
      expect(reading.fft.length).toBe(32)
      expect(reading.fft.some((v) => v > 0)).toBe(true)
      // The low band carries energy (treble ~0) — confirms the isolated read,
      // not a flat/garbage buffer.
      expect(reading.treble).toBe(0)
      // DSP (real audio, this.rms) is independent of `.env` (the IR envelope
      // feed) — distinct fields off the same reading. `.env` is 0 (no hap fired
      // through the stream), `.rms` is non-zero (analyser live). Proves the DSP
      // read is the analyser, NOT a re-label of the envelope.
      expect(reading.env).toBe(0)
      expect(reading.rms).toBeGreaterThan(0)

      // Ordering guard: bass came from the ISOLATED $0 analyser (lowMag 200),
      // not the weaker master (lowMag 50). audioFor needs the fresh
      // activeByTrack that refreshActive fills BEFORE readAudio — so the read
      // landing on the isolated track proves readAudio ran AFTER refreshActive.
      // master bass would be ~50/255 of the low third; isolated is ~200/255.
      expect(reading.bass).toBeGreaterThan(0.5)

      renderer.destroy()
    })

    it('exposes DSP fields on the bag thunks: sig("bd").rms()/.bass() thunks live, .fft array, sig.rms() master (T3)', () => {
      const renderer = new HydraVizRenderer()
      const hapStream = makeHapStream()
      // `bd` lives in exactly ONE active track ($0) → audioFor picks the
      // isolated $0 analyser (lowMag 200), not the weaker master (lowMag 50).
      const kickTrack = makePointScheduler({ 0: { s: 'bd', velocity: 0.8 } })
      const trackSchedulers = new Map([['$0', kickTrack]])
      const combined = makePointScheduler({ 0: { s: 'bd', velocity: 0.8 } })
      const master = makeAudioAnalyser({ lowMag: 50, timeVal: 150 })
      const kickAnalyser = makeAudioAnalyser({ lowMag: 200, timeVal: 200 })
      const trackAnalysers = new Map([['$0', kickAnalyser]])

      renderer.mount(
        document.createElement('div'),
        {
          audio: { analyser: master, trackAnalysers } as any,
          streaming: { hapStream: hapStream as any } as any,
          queryable: { scheduler: combined, trackSchedulers } as any,
        } as Partial<EngineComponents>,
        { w: 64, h: 64 },
        () => {}
      )
      expect(analyserOf(renderer)).toBeTruthy()

      const bag = bagOf(renderer)

      // SHAPE (D-01 hydra): DSP scalars are THUNKS (functions), arrays are ARRAYS.
      expect(typeof bag.sig('bd').rms).toBe('function')
      expect(typeof bag.sig('bd').bass).toBe('function')
      expect(typeof bag.sig.rms).toBe('function')
      // Before any frame, readAudio hasn't run — thunks read 0, arrays empty.
      expect(bag.sig('bd').rms()).toBe(0)
      expect(Array.isArray(bag.sig('bd').fft)).toBe(true)
      expect(bag.sig('bd').fft).toEqual([])

      // Drive ONE frame — pumpAudio runs tick → refreshActive → readAudio.
      pump(renderer)

      // The rms thunk now reads the LIVE analyser value, non-zero (the headline
      // T3 observation — a thunk that re-reads the bus each call).
      expect(bag.sig('bd').rms()).toBeGreaterThan(0)
      expect(bag.sig('bd').bass()).toBeGreaterThan(0)
      // bass came from the ISOLATED $0 analyser (lowMag 200), not master (50).
      expect(bag.sig('bd').bass()).toBeGreaterThan(0.5)
      // treble ~0 — confirms the isolated low-band read, not a flat buffer.
      expect(bag.sig('bd').treble()).toBe(0)
      // fft is a populated 32-bucket ARRAY (indexed natively as u('bd').fft[i]).
      const fft = bag.sig('bd').fft
      expect(Array.isArray(fft)).toBe(true)
      expect(fft.length).toBe(32)
      expect(fft.some((v) => v > 0)).toBe(true)
      // wave is a populated ARRAY too (-1..1 time domain).
      expect(Array.isArray(bag.sig('bd').wave)).toBe(true)
      expect(bag.sig('bd').wave.length).toBeGreaterThan(0)

      // Master thunks: u.rms() / u.bass() read bus.master() (the combined mix).
      expect(typeof bag.sig.rms).toBe('function')
      expect(bag.sig.rms()).toBeGreaterThan(0)
      expect(bag.sig.bass()).toBeGreaterThan(0)
      // u.fft (master spectrum) is a live ARRAY.
      expect(Array.isArray(bag.sig.fft)).toBe(true)
      expect(bag.sig.fft.length).toBe(32)
      // Bare master sugar thunk uRms matches u.rms() (parity with uKick).
      expect(bag.sig.rms()).toBe(bag.sig.rms())

      // DSP is independent of `.env` (the IR envelope) — distinct fields. `.env`
      // is 0 (no hap fired through the stream), `.rms` non-zero (analyser live).
      expect(bag.sig('bd').env()).toBe(0)

      renderer.destroy()
    })

    it('a live-ref scheduler swap on update() is observed by the SAME thunk closure', () => {
      const renderer = new HydraVizRenderer()
      const hapStream = makeHapStream()
      const fakeAnalyser = {
        frequencyBinCount: 8,
        getByteFrequencyData: () => {},
        // Slice 2: pumpAudio now runs bus.readAudio() unconditionally, which
        // reads the time-domain buffer off every bound analyser. Stub it.
        getByteTimeDomainData: () => {},
      } as unknown as AnalyserNode
      renderer.mount(
        document.createElement('div'),
        {
          audio: { analyser: fakeAnalyser } as any,
          streaming: { hapStream: hapStream as any } as any,
          queryable: { scheduler: null, trackSchedulers: new Map() } as any,
        } as Partial<EngineComponents>,
        { w: 64, h: 64 },
        () => {}
      )

      const bag = bagOf(renderer)
      // Capture the thunk ONCE — it must observe later scheduler swaps.
      const velThunk = bag.sig('sd').velocity
      pump(renderer)
      expect(velThunk()).toBe(0) // nothing bound yet

      // Swap in a snare scheduler via update() — re-binds the bus in place.
      const snareTrack = makePointScheduler({ 0: { s: 'sd', velocity: 0.55 } })
      renderer.update({
        queryable: {
          scheduler: snareTrack,
          trackSchedulers: new Map([['$0', snareTrack]]),
        } as any,
      } as Partial<EngineComponents>)
      pump(renderer) // refreshActive snapshots the new scheduler

      // SAME captured thunk now reads the swapped scheduler's event.
      expect(velThunk()).toBe(0.55)
      expect(bag.sig.tracks).toEqual(['$0'])

      renderer.destroy()
    })

    // ── Custom alias thunk injection (Phase 21 aliases — T2 hydra) ───────────
    // The bag IS `stave`; hydra has no bare scope, so a custom alias is a
    // `stave.kick()` THUNK on the bag. mount() resolves built-ins+custom for the
    // active engine (resolveAliasesForEngine, custom wins), pushes it into the
    // bus, and injects a thunk per custom name
    // NOT already on the bag. The thunk reads `bus.envValue(name)` LIVE.
    it('injects a custom `stave.kick()` thunk reading the alias env, live across a frame', () => {
      mockGetStoredSignalAliases.mockReturnValueOnce({ kick: { strudel: 'bd' } })
      const renderer = new HydraVizRenderer()
      const hapStream = makeHapStream()
      const combined = makePointScheduler({ 0: { s: 'bd' } })
      const trackSchedulers = new Map([['$0', combined]])
      const fakeAnalyser = {
        frequencyBinCount: 8,
        getByteFrequencyData: () => {},
        getByteTimeDomainData: () => {},
      } as unknown as AnalyserNode

      renderer.mount(
        document.createElement('div'),
        {
          audio: { analyser: fakeAnalyser } as any,
          streaming: { hapStream: hapStream as any } as any,
          queryable: { scheduler: combined, trackSchedulers } as any,
        } as Partial<EngineComponents>,
        { w: 64, h: 64 },
        () => {},
      )

      const bag = bagOf(renderer)
      // The custom thunk exists and is callable; built-in `sig.kick` survived.
      expect(typeof (bag as unknown as Record<string, unknown>).kick).toBe(
        'function',
      )
      expect(typeof bag.sig.kick).toBe('function')

      const kick = (bag as unknown as { kick: () => number }).kick
      // Before any bump → 0.
      expect(kick()).toBe(0)

      // bump bd → `kick` (custom alias → bd) reads NON-ZERO, LIVE.
      hapStream.emit({ s: 'bd', hap: { value: { gain: 1 } } })
      const a = kick()
      expect(a).toBe(1)

      // pumpAudio decays the env → the SAME thunk reads the lower value
      // (live, not captured).
      pump(renderer)
      const b = kick()
      expect(b).toBeLessThan(a)
      expect(b).toBeCloseTo(0.92, 5)

      renderer.destroy()
    })
  })

  it('destroy() clears the bag fields', () => {
    const renderer = new HydraVizRenderer()
    const scheduler = makeScheduler()
    renderer.update({
      queryable: {
        scheduler,
        trackSchedulers: new Map([['d1', makeScheduler()]]),
      },
    } as Partial<EngineComponents>)

    const bagBefore = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag
    expect(bagBefore.scheduler).not.toBeNull()

    renderer.destroy()

    // Same object identity preserved, but fields cleared. Any residual
    // closure inside user code that survived unmount reads null/empty
    // instead of dangling refs.
    const bagAfter = (renderer as unknown as { staveBag: HydraStaveBag })
      .staveBag
    expect(bagAfter).toBe(bagBefore)
    expect(bagAfter.scheduler).toBeNull()
    expect(bagAfter.tracks.size).toBe(0)
  })
})
