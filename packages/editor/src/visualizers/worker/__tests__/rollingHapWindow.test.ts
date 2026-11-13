/**
 * #2563 — RollingHapWindow must answer what a full query of the window answers,
 * frame after frame, while querying only the new sliver. Checked against real
 * Strudel patterns, including the cases where stitching slices could go wrong:
 * notes longer than a slice, notes crossing cycle boundaries (Strudel returns
 * them as fragments), uneven frame steps, a jump backwards, a jump past the
 * window, and a re-evaluate.
 */
import { describe, it, expect } from 'vitest'
import * as strudelCore from '@strudel/core'
import * as strudelMini from '@strudel/mini'
import type { IRPattern, IREvent } from '../../../codeView'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { RollingHapWindow } from '../rollingHapWindow'

// strudel.d.ts declares only what the app uses; the test needs stack + mini.
const { stack } = strudelCore as any
const { mini } = strudelMini as any

const BACK = 4
const FWD = 2

/** A scheduler over a real Strudel pattern, normalised exactly as the engine does. */
function schedulerOf(pat: any): IRPattern & { calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = []
  return {
    calls,
    now: () => 0,
    query: (a: number, b: number) => {
      calls.push([a, b])
      return pat.queryArc(a, b).map((h: unknown) => normalizeStrudelHap(h)) as IREvent[]
    },
  } as any
}

/** A note's identity, ignoring fragmentation (a full query may return one note
 *  as several fragments with the same whole). */
const key = (e: IREvent) => `${e.begin.toFixed(6)}|${e.end.toFixed(6)}|${String((e as any).note)}|${String((e as any).s)}`
const asSet = (es: IREvent[]) => [...new Set(es.map(key))].sort()

describe('RollingHapWindow.version (#2571)', () => {
  it('equal across two frames exactly when the answer is the same notes', () => {
    const pat = stack(mini('c3 [e3 g3] <b3 d4> ~'), mini('bd*3 [~ sd]'), mini('<c2 ~>@3 a1'))
    const sched = schedulerOf(pat)
    const w = new RollingHapWindow(BACK, FWD)
    let now = 2
    let prevSet = ''
    let prevVersion = -1
    let same = 0
    let moved = 0
    for (let f = 0; f < 600; f++) {
      const answer = w.at(sched, now, sched.query)
      const set = asSet(answer).join('\n')
      if (f > 0) {
        if (w.version === prevVersion) {
          expect(set).toBe(prevSet)
          same++
        } else moved++
      }
      prevSet = set
      prevVersion = w.version
      now += 1 / 60 + ((f % 7) - 3) / 2000
    }
    // the check bit both ways: most frames keep the version, some move it
    expect(same).toBeGreaterThan(300)
    expect(moved).toBeGreaterThan(5)
  })

  it('moves on a reset and never goes back', () => {
    const sched = schedulerOf(mini('c3 e3'))
    const w = new RollingHapWindow(BACK, FWD)
    w.at(sched, 1, sched.query)
    const v = w.version
    w.reset()
    w.at(sched, 1, sched.query)
    expect(w.version).toBeGreaterThan(v)
  })
})

function fullWindow(sched: IRPattern, now: number) {
  return sched.query(now - BACK, now + FWD)
}

const DENSE = stack(
  mini('c3 e3 g3 b3').note().fast(4),
  mini('<a1 f1 d1 e1>').note().slow(2),          // notes longer than a cycle
  mini('c4 ~ e4@3 g4').note(),                     // an elongated note
  mini('bd*16').s(),
  mini('[c5 e5]@5 g5').note().slow(3),             // crosses cycle boundaries
)

describe('RollingHapWindow (#2563)', () => {
  it('matches a full query every frame across uneven steps', () => {
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    let now = 0.37
    const steps = [1 / 120, 1 / 60, 0.013, 0.2, 1 / 60, 0.7, 1 / 30, 0.004]
    for (let i = 0; i < 600; i++) {
      now += steps[i % steps.length]
      const got = win.at(sched, now, (a, b) => sched.query(a, b))
      const full = fullWindow(sched, now)
      expect(asSet(got)).toEqual(asSet(full))
      // and never more entries than the full query (no note kept twice)
      expect(got.length).toBeLessThanOrEqual(full.length)
    }
  })

  it('queries half a cycle ahead, then nothing until the window reaches the end of it', () => {
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    const q = (a: number, b: number) => sched.query(a, b)
    win.at(sched, 10, q)
    expect(sched.calls).toEqual([[6, 12.5]])
    for (let i = 1; i <= 59; i++) win.at(sched, 10 + i / 120, q) // 59 frames, front edge < 12.5
    expect(sched.calls).toHaveLength(1)
    win.at(sched, 10.51, q) // front edge 12.51 passes 12.5 → one more half cycle
    expect(sched.calls).toHaveLength(2)
    expect(sched.calls[1][0]).toBe(12.5)
    expect(sched.calls[1][1]).toBeCloseTo(13.01, 9)
  })

  it('re-queries whole after now goes backwards, jumps past the window, or the scheduler changes', () => {
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    const q = (s: IRPattern) => (a: number, b: number) => s.query(a, b)
    win.at(sched, 20, q(sched))
    win.at(sched, 3, q(sched)) // backwards (stop / restart)
    expect(sched.calls.at(-1)).toEqual([-1, 5.5])
    expect(asSet(win.at(sched, 3, q(sched)))).toEqual(asSet(fullWindow(sched, 3)))
    win.at(sched, 40, q(sched)) // past the whole window in one step
    expect(sched.calls.at(-1)).toEqual([36, 42.5])
    const other = schedulerOf(mini('c d').note()) // a re-evaluate swaps the scheduler
    const got = win.at(other, 40.01, q(other))
    expect(other.calls).toEqual([[36.01, 42.51]])
    expect(asSet(got)).toEqual(asSet(fullWindow(other, 40.01)))
  })

  it('keeps a note whose onset sits exactly on a slice edge (float vs Strudel Fraction)', () => {
    // bd*16 has an onset at 11.25. Make a slice end a hair past it: Strudel snaps
    // that float bound to 45/4, so the onset falls in the NEXT slice, whose start
    // (the same float) is a hair past the onset.
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    const q = (a: number, b: number) => sched.query(a, b)
    win.at(sched, 8.75 + 1e-12, q) // queries up to 11.25 + 1e-12
    expect(sched.calls[0][1]).toBeGreaterThan(11.25)
    const got = win.at(sched, 9.26, q) // next slice starts at that same float
    expect(sched.calls).toHaveLength(2)
    expect(got.some((e) => Math.abs(e.begin - 11.25) < 1e-9 && (e as any).s === 'bd')).toBe(true)
    expect(asSet(got)).toEqual(asSet(fullWindow(sched, 9.26)))
  })

  it('holds back a prefetched note whose onset is exactly on the front edge', () => {
    // front edge 11.25 + 1e-12: Strudel's full query snaps it to 45/4 and excludes
    // the onset AT 11.25 (half-open); the window must too.
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    const q = (a: number, b: number) => sched.query(a, b)
    const now = 9.25 + 1e-12
    win.at(sched, 9.2, q)
    const got = win.at(sched, now, q)
    expect(got.some((e) => Math.abs(e.begin - 11.25) < 1e-9)).toBe(false)
    expect(asSet(got)).toEqual(asSet(fullWindow(sched, now)))
  })

  it('starts over after reset()', () => {
    const sched = schedulerOf(DENSE)
    const win = new RollingHapWindow(BACK, FWD)
    win.at(sched, 10, (a, b) => sched.query(a, b))
    win.reset()
    win.at(sched, 10.01, (a, b) => sched.query(a, b))
    expect(sched.calls.at(-1)).toEqual([6.01, 12.51])
  })
})
