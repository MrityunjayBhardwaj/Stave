/**
 * #2561 — the wide `stave.scheduler` query runs only for sketch kinds that are
 * handed `stave.scheduler` (p5, hydra). For three.js and GLSL it was pure
 * main-thread cost: a whole-song query over 6 cycles every frame.
 */
import { describe, it, expect } from 'vitest'
import type { IRPattern } from '../../../codeView/ir/IRPattern'
import type { IREvent } from '../../../codeView/ir/IREvent'
import { MainSignalSampler } from '../signalSampler'
import { RawSchedulerShim } from '../rawShims'
import { kindReadsRawScheduler } from '../../renderers/WorkerVizRenderer'

/** A scheduler that records every query window it is asked for. */
function recordingScheduler(now: number) {
  const windows: Array<[number, number]> = []
  const event = { begin: now, end: now + 0.5, s: 'tok', note: 3, velocity: 1, color: null } as unknown as IREvent
  const sched = {
    now: () => now,
    query: (a: number, b: number) => {
      windows.push([a, b])
      return [event]
    },
  } as unknown as IRPattern
  return { sched, windows }
}

const wide = (w: Array<[number, number]>) => w.filter(([a, b]) => b - a > 1)

describe('MainSignalSampler raw-scheduler query (#2561)', () => {
  it('runs the wide query and ships the haps when the sketch can read stave.scheduler', () => {
    const { sched, windows } = recordingScheduler(10)
    const s = new MainSignalSampler(true)
    s.bind({ scheduler: sched })
    const f = s.sample()
    expect(wide(windows)).toEqual([[6, 12.5]]) // the window plus half a cycle prefetched (#2563)
    expect(f.rawScheduler?.events).toHaveLength(1)
  })

  it('skips the wide query when the sketch cannot read stave.scheduler', () => {
    const { sched, windows } = recordingScheduler(10)
    const s = new MainSignalSampler(false)
    s.bind({ scheduler: sched })
    const f = s.sample()
    expect(wide(windows)).toEqual([])
    expect(f.rawScheduler?.events).toEqual([])
    // the narrow active-at-now query (what `sig` reads) still runs and still reports
    expect(windows).toContainEqual([10, 10.001])
    expect(f.activeEvents).toHaveLength(1)
    expect(f.rawScheduler?.now).toBe(10)
  })

  it('defaults to running the wide query (existing callers unchanged)', () => {
    const { sched, windows } = recordingScheduler(10)
    const s = new MainSignalSampler()
    s.bind({ scheduler: sched })
    s.sample()
    expect(wide(windows)).toHaveLength(1)
  })

  it('every kind reads the window: p5, hydra, three.js (#2570) as stave.scheduler, GLSL as uNotes (#2571)', () => {
    expect(kindReadsRawScheduler('p5')).toBe(true)
    expect(kindReadsRawScheduler('hydra')).toBe(true)
    expect(kindReadsRawScheduler('three')).toBe(true)
    expect(kindReadsRawScheduler('glsl')).toBe(true)
  })

  it('ships the window version, cps and each hap\'s track key (#2571)', () => {
    let now = 10
    const ev = { begin: 10, end: 10.5, s: 'tok', note: 3, velocity: 1, color: null, trackKey: '$1' } as unknown as IREvent
    const sched = {
      now: () => now,
      cps: () => 0.75,
      query: (a: number, b: number) => (ev.begin < b && ev.end > a ? [ev] : []),
    } as unknown as IRPattern
    const s = new MainSignalSampler(true)
    // What the worker sketch / GLSL texture reads: the frames through the shim.
    const shim = new RawSchedulerShim()
    s.bind({ scheduler: sched })
    const f1 = s.sample()
    shim.set(f1.rawScheduler)
    expect(f1.rawScheduler?.cps).toBe(0.75)
    expect(shim.cps()).toBe(0.75)
    expect(shim.all()[0]?.trackKey).toBe('$1')
    const v1 = shim.version()
    expect(typeof v1).toBe('number')
    // a frame later, same notes in the window → same version
    now = 10.01
    shim.set(s.sample().rawScheduler)
    expect(shim.version()).toBe(v1)
    // the note ends behind the window → the answer changes → the version moves
    // (the frame need not carry notes for that, #2582: the shim narrows them)
    now = 15
    shim.set(s.sample().rawScheduler)
    expect(shim.all()).toEqual([])
    expect(shim.version()).not.toBe(v1)
  })
})
