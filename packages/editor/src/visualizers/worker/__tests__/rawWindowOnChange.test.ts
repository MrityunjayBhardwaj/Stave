/**
 * #2582 — the `stave.scheduler` window travels to the worker only when it changes.
 *
 * Before, every frame carried the whole window (now−4 … now+2 cycles, a few
 * hundred notes on a dense song) though it changes about twice a cycle. Now a
 * frame carries the notes only when the window's version moved, and the worker's
 * shim keeps the last notes it was sent.
 *
 * What must hold:
 *   - what a sketch's `stave.scheduler.query(a, b)` returns in the worker is
 *     exactly what the old every-frame copy returned, frame after frame, through
 *     seeks, a re-evaluate and a stopped scheduler (checked against real Strudel);
 *   - frames between two version changes carry no notes;
 *   - every door that leaves a consumer without the current notes — first frame,
 *     a remount, a re-evaluate, a demo feed in between, a frame that never
 *     arrived — gets the whole window, and a consumer never shows notes that are
 *     not the current window's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as strudelCore from '@strudel/core'
import * as strudelMini from '@strudel/mini'
import type { IRPattern, IREvent } from '../../../codeView'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { MainSignalSampler, summariseRawHap } from '../signalSampler'
import { RollingHapWindow } from '../rollingHapWindow'
import { RawSchedulerShim } from '../rawShims'
import type { RawSchedulerFrame, SignalFrame } from '../signalFrame'
import { WorkerVizRenderer } from '../../renderers/WorkerVizRenderer'
import { setVizWorkerFactory } from '../../vizWorkerFactory'
import type { EngineComponents } from '../../../engine/LiveCodingEngine'

const { stack } = strudelCore as any
const { mini } = strudelMini as any

const DENSE = stack(
  mini('c3 e3 g3 b3').note().fast(4),
  mini('<a1 f1 d1 e1>').note().slow(2), // notes longer than a cycle
  mini('c4 ~ e4@3 g4').note(),
  mini('bd*16').s(),
  mini('[c5 e5]@5 g5').note().slow(3), // crosses cycle boundaries
)
const OTHER = mini('d2 a2 f3').note()

/** A live scheduler over a real Strudel pattern, normalised as the engine does. */
function liveScheduler(pat: any, clock: { now: number }): IRPattern {
  return {
    now: () => clock.now,
    cps: () => 0.5,
    query: (a: number, b: number) =>
      pat.queryArc(a, b).map((h: unknown) => normalizeStrudelHap(h)) as IREvent[],
  } as unknown as IRPattern
}

/** The worker receives a structured clone, never the main thread's objects. */
const post = (raw: RawSchedulerFrame | undefined) => structuredClone(raw)

/** The sub-windows real sketches ask for (scope, piano roll, active-at-now, all). */
function reads(shim: RawSchedulerShim, now: number) {
  return {
    now: shim.now(),
    cps: shim.cps(),
    all: shim.all(),
    scope: shim.query(now - 4, now),
    roll: shim.query(now, now + 2),
    around: shim.query(now - 0.5, now + 0.5),
    active: shim.query(now, now + 0.001),
  }
}

describe('the note window is shipped only when it changes (#2582)', () => {
  it('a worker sketch reads exactly what the old every-frame copy gave it, through seeks, a re-evaluate and a stop', () => {
    const clock = { now: 0.37 }
    const dense = liveScheduler(DENSE, clock)
    const other = liveScheduler(OTHER, clock)

    const sampler = new MainSignalSampler(true)
    const shim = new RawSchedulerShim()

    // The old path, rebuilt independently: its own window, summarised and
    // shipped whole every frame, reset on every bind, empty with no scheduler.
    const oldWindow = new RollingHapWindow(4, 2)
    const oldShim = new RawSchedulerShim()
    let oldSched: IRPattern | null = null
    const bind = (s: IRPattern | null) => {
      sampler.bind({ scheduler: s })
      oldWindow.reset()
      oldSched = s
    }
    bind(dense)

    const steps = [1 / 120, 1 / 60, 0.013, 1 / 60, 0.2, 1 / 60, 1 / 30, 0.004]
    let carried = 0
    let bare = 0
    let prevVersion: number | undefined
    let prevShimVersion: number | undefined
    let prevAll: readonly unknown[] = []
    let shimMoves = 0
    for (let f = 0; f < 1500; f++) {
      if (f === 500) clock.now = 2.1 // a seek backwards (stop / restart)
      else if (f === 700) clock.now += 30 // a jump past the whole window
      else clock.now += steps[f % steps.length]
      if (f === 900) bind(other) // a re-evaluate swaps the scheduler
      if (f === 1100) bind(null) // stopped: no scheduler
      if (f === 1150) bind(dense)

      const frame = sampler.sample().rawScheduler!
      const resync = shim.set(post(frame))
      expect(resync).toBe(false) // nothing was lost on the way

      const s = oldSched as IRPattern | null
      oldShim.set(post({
        now: s ? clock.now : 0,
        cps: s ? 0.5 : undefined,
        events: s ? oldWindow.at(s, clock.now, (a, b) => s.query(a, b)).map(summariseRawHap) : [],
      }))

      expect(reads(shim, clock.now)).toEqual(reads(oldShim, clock.now))
      // The GLSL texture's contract: an equal version means the same notes.
      if (shim.version() === prevShimVersion) expect(shim.all()).toEqual(prevAll)
      else shimMoves++
      prevShimVersion = shim.version()
      prevAll = shim.all()

      // Notes travel exactly on the frames whose version moved.
      if (frame.version !== prevVersion) {
        expect(frame.events, `frame ${f}: version moved, notes must come`).toBeDefined()
        carried++
      } else {
        expect(frame.events, `frame ${f}: version unchanged, no notes`).toBeUndefined()
        bare++
      }
      prevVersion = frame.version
    }
    // The check bit both ways, and most frames went without the notes.
    expect(carried).toBeGreaterThan(20)
    expect(bare).toBeGreaterThan(1200)
    // The window itself changes far more often than the notes travel.
    expect(shimMoves).toBeGreaterThan(carried * 3)
  }, 60_000) // 1500 frames of real Strudel queries: ~1 s alone, several under a full parallel run

  it('summarises the window only on the frames where it changed', () => {
    // `endClipped` is read only by the summary (the window reads begin/end, the
    // active-at-now feed reads s/velocity/note/color), so its reads count summaries.
    const clock = { now: 3 }
    let summaries = 0
    const ev = { begin: 3, end: 3.5, endClipped: 3.5, note: 60, s: null, velocity: 1, color: null }
    const counted = new Proxy(ev, {
      get(t, k) {
        if (k === 'endClipped') summaries++
        return Reflect.get(t, k)
      },
    }) as unknown as IREvent
    const sched = {
      now: () => clock.now,
      query: (a: number, b: number) => (3 < b && 3.5 > a ? [counted] : []),
    } as unknown as IRPattern
    const sampler = new MainSignalSampler(true)
    sampler.bind({ scheduler: sched })
    sampler.sample()
    expect(summaries).toBe(1)
    for (let i = 0; i < 20; i++) {
      clock.now += 1 / 600 // well inside the prefetched span: the window is unchanged
      expect(sampler.sample().rawScheduler!.events).toBeUndefined()
    }
    expect(summaries).toBe(1)
    // A resend re-ships the summary it already has; it does not summarise again.
    sampler.resendRawWindow()
    expect(sampler.sample().rawScheduler!.events).toHaveLength(1)
    expect(summaries).toBe(1)
  })

  it('a re-evaluate ships the new pattern\'s notes on the very next frame, never the old ones', () => {
    const clock = { now: 5 }
    const sampler = new MainSignalSampler(true)
    const shim = new RawSchedulerShim()
    sampler.bind({ scheduler: liveScheduler(DENSE, clock) })
    shim.set(post(sampler.sample().rawScheduler))
    clock.now += 1 / 60
    shim.set(post(sampler.sample().rawScheduler))
    expect(shim.all().some((e) => e.s === 'bd')).toBe(true)

    const other = liveScheduler(OTHER, clock)
    sampler.bind({ scheduler: other })
    clock.now += 1 / 60
    const frame = sampler.sample().rawScheduler!
    expect(frame.events).toBeDefined()
    shim.set(post(frame))
    const expected = other.query(clock.now - 4, clock.now + 2).map(summariseRawHap)
    expect(new Set(shim.all().map((e) => `${e.begin}|${e.note}`))).toEqual(
      new Set(expected.map((e) => `${e.begin}|${e.note}`)),
    )
    expect(shim.all().some((e) => e.s === 'bd')).toBe(false)
  })

  it('a re-evaluate that keeps the same scheduler object still ships the new notes', () => {
    // The scheduler object can outlive an evaluate while the pattern under it
    // changes; the rebind itself must count as a change.
    const clock = { now: 5 }
    let pat: any = DENSE
    const sched = {
      now: () => clock.now,
      query: (a: number, b: number) => pat.queryArc(a, b).map((h: unknown) => normalizeStrudelHap(h)) as IREvent[],
    } as unknown as IRPattern
    const sampler = new MainSignalSampler(true)
    const shim = new RawSchedulerShim()
    sampler.bind({ scheduler: sched })
    shim.set(post(sampler.sample().rawScheduler))
    pat = OTHER
    sampler.bind({ scheduler: sched })
    clock.now += 1 / 60
    shim.set(post(sampler.sample().rawScheduler))
    expect(shim.all().length).toBeGreaterThan(0)
    expect(shim.all().some((e) => e.s === 'bd')).toBe(false)
  })

  it('a stopped scheduler empties the worker\'s window on the next frame', () => {
    const clock = { now: 5 }
    const sampler = new MainSignalSampler(true)
    const shim = new RawSchedulerShim()
    sampler.bind({ scheduler: liveScheduler(DENSE, clock) })
    shim.set(post(sampler.sample().rawScheduler))
    expect(shim.all().length).toBeGreaterThan(0)
    sampler.bind({ scheduler: null })
    const frame = sampler.sample().rawScheduler!
    expect(frame.events).toEqual([])
    shim.set(post(frame))
    expect(shim.all()).toEqual([])
    // and stays empty without re-sending
    const next = sampler.sample().rawScheduler!
    expect(next.events).toBeUndefined()
    shim.set(post(next))
    expect(shim.all()).toEqual([])
  })
})

describe('RawSchedulerShim — a frame that says "unchanged" (#2582)', () => {
  const note = { begin: 1, end: 2, endClipped: 2, note: 60, freq: null, midi: 60, s: null, gain: 1, velocity: 1, color: null, trackKey: null }

  it('keeps the notes when the version is the one it holds', () => {
    const shim = new RawSchedulerShim()
    expect(shim.set({ now: 1, version: 3, events: [note] })).toBe(false)
    const v = shim.version()
    expect(shim.set({ now: 1.1, version: 3 })).toBe(false)
    expect(shim.all()).toEqual([note])
    expect(shim.now()).toBe(1.1)
    expect(shim.version()).toBe(v) // the GLSL texture is not repacked
  })

  it('narrows the held notes to the frame\'s window, and its version moves only when that changes', () => {
    const at = (begin: number, end: number) => ({ ...note, begin, end, endClipped: end })
    const behind = at(0, 1) // ends exactly on lo at now = 5 → out
    const sounding = at(4, 6)
    const ahead = at(7, 8) // begins exactly on hi at now = 5 → not yet in
    const shim = new RawSchedulerShim()
    shim.set({ now: 5, lo: 1, hi: 7, version: 1, events: [behind, sounding, ahead] })
    expect(shim.all()).toEqual([sounding])
    const v = shim.version()
    shim.set({ now: 5.5, lo: 1.5, hi: 7.5, version: 1 })
    expect(shim.all()).toEqual([sounding, ahead])
    expect(shim.version()).not.toBe(v)
    const v2 = shim.version()
    shim.set({ now: 5.6, lo: 1.6, hi: 7.6, version: 1 })
    expect(shim.version()).toBe(v2)
  })

  it('a fresh mount given only a version shows no notes and asks once for the window', () => {
    const shim = new RawSchedulerShim()
    expect(shim.set({ now: 1, version: 7 })).toBe(true)
    expect(shim.all()).toEqual([])
    const gap = shim.version()
    expect(shim.set({ now: 1.1, version: 7 })).toBe(false) // asked already
    expect(shim.set({ now: 1.2, version: 7, events: [note] })).toBe(false)
    expect(shim.all()).toEqual([note])
    expect(shim.version()).not.toBe(gap) // the GLSL texture repacks when they land
  })

  it('a missed change drops the old notes instead of drawing them as current', () => {
    const shim = new RawSchedulerShim()
    shim.set({ now: 1, version: 3, events: [note] })
    const v = shim.version()
    expect(shim.set({ now: 1.5, version: 4 })).toBe(true) // version 4's notes never came
    expect(shim.all()).toEqual([])
    expect(shim.query(0, 10)).toEqual([])
    expect(shim.version()).not.toBe(v) // and the GLSL texture is emptied too
  })

  it('a frame with no version and no events means no events (demo feed, legacy frames)', () => {
    const shim = new RawSchedulerShim()
    shim.set({ now: 1, version: 3, events: [note] })
    expect(shim.set({ now: 2 } as RawSchedulerFrame)).toBe(false)
    expect(shim.all()).toEqual([])
    expect(shim.version()).toBeUndefined() // unknown: the GLSL texture repacks every frame
  })
})

// ── the renderer's doors: mount, resync, demo feed, re-evaluate ─────────────

class FakeWorker {
  frames: SignalFrame[] = []
  private listeners: Array<(ev: MessageEvent) => void> = []
  postMessage(msg: any): void {
    if (msg && msg.__staveSignalFrame) this.frames.push(structuredClone(msg.frame))
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    if (type === 'message') this.listeners.push(fn)
  }
  removeEventListener(): void {}
  terminate(): void {}
  say(data: unknown): void {
    for (const fn of this.listeners) fn({ data } as MessageEvent)
  }
}

describe('WorkerVizRenderer — every door that leaves the worker without the notes sends them (#2582)', () => {
  let worker: FakeWorker
  let ts = 0
  const clock = { now: 4 }
  const components = (s: IRPattern | null) =>
    ({ queryable: { scheduler: s } } as unknown as Partial<EngineComponents>)

  beforeEach(() => {
    clock.now = 4
    worker = new FakeWorker()
    setVizWorkerFactory(() => worker as unknown as Worker)
    ;(HTMLCanvasElement.prototype as unknown as Record<string, unknown>).transferControlToOffscreen =
      function transferControlToOffscreen() {
        return {} as OffscreenCanvas
      }
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    setVizWorkerFactory(null)
    vi.unstubAllGlobals()
  })

  /** One pump tick that produces a frame (and the worker's ack, so the
   *  backpressure cap never holds a frame back). */
  function tick(r: WorkerVizRenderer): RawSchedulerFrame {
    clock.now += 1 / 600
    const before = worker.frames.length
    r.pumpTick((ts += 100), undefined)
    expect(worker.frames.length).toBe(before + 1)
    worker.say({ type: 'frameAck' })
    return worker.frames[worker.frames.length - 1].rawScheduler!
  }

  function mounted(kind: 'p5' | 'glsl' | 'three' | 'hydra' = 'three'): WorkerVizRenderer {
    const r = new WorkerVizRenderer(kind, '', 'sketch')
    r.mount(document.createElement('div'), components(liveScheduler(DENSE, clock)), { w: 100, h: 100 }, () => {})
    return r
  }

  it('the first frame after mount carries the window; the frames after it do not', () => {
    for (const kind of ['p5', 'hydra', 'three', 'glsl'] as const) {
      const r = mounted(kind)
      const first = tick(r)
      expect(first.events?.length, kind).toBeGreaterThan(0)
      expect(tick(r).events, kind).toBeUndefined()
      expect(tick(r).events, kind).toBeUndefined()
      r.destroy()
    }
  })

  it('a worker that missed the notes asks, and the next frame carries them again', () => {
    const r = mounted()
    const first = tick(r)
    tick(r)
    worker.say({ type: 'rawWindowResync' })
    const resent = tick(r)
    expect(resent.version).toBe(first.version)
    expect(resent.events).toEqual(first.events)
    expect(tick(r).events).toBeUndefined()
    r.destroy()
  })

  it('a re-evaluate (update) sends the new notes on the next frame', () => {
    const r = mounted()
    tick(r)
    tick(r)
    r.update(components(liveScheduler(OTHER, clock)))
    const after = tick(r)
    expect(after.events?.length).toBeGreaterThan(0)
    expect(after.events!.some((e) => e.s === 'bd')).toBe(false)
    r.destroy()
  })

  it('after a demo feed drove the worker, the live feed sends its whole window again', () => {
    const r = mounted()
    tick(r)
    tick(r)
    const demo = { next: () => ({ seq: 0, now: 0, analysers: [], activeEvents: [], activeByTrack: [], bumps: [], rawScheduler: { now: 0, events: [] } }) }
    r.setDemoSource(demo as any)
    tick(r)
    r.setDemoSource(null)
    expect(tick(r).events?.length).toBeGreaterThan(0)
    r.destroy()
  })

  it('a remount of the same renderer starts the new worker mount with the whole window', () => {
    const r = mounted()
    tick(r)
    tick(r)
    r.destroy()
    r.mount(document.createElement('div'), components(liveScheduler(DENSE, clock)), { w: 100, h: 100 }, () => {})
    expect(tick(r).events?.length).toBeGreaterThan(0)
    r.destroy()
  })
})
