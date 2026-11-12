/**
 * #2567 — ActiveNowCache must hand back, on every frame, exactly what a real
 * `query(now, now + ε)` returns at that moment, while running that query only
 * when a note starts or ends. Checked against real Strudel patterns, including
 * duplicate layers, long notes, notes crossing cycle boundaries, a long rest,
 * frames landing exactly on onsets, uneven steps, a jump backwards and a
 * re-evaluate.
 */
import { describe, it, expect } from 'vitest'
import * as strudelCore from '@strudel/core'
import * as strudelMini from '@strudel/mini'
import type { IRPattern, IREvent } from '../../../codeView'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { ActiveNowCache } from '../activeNowCache'

// strudel.d.ts declares only what the app uses; the test needs stack + mini.
const { stack } = strudelCore as any
const { mini } = strudelMini as any

const EPS = 0.001

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

const MIX = stack(
  mini('c3 e3 g3 b3').note().fast(4),
  mini('c3 e3 g3 b3').note().fast(4), // the same layer twice: duplicates must stay duplicates
  mini('<a1 f1 d1 e1>').note().slow(2), // notes longer than a cycle
  mini('c4 ~ e4@3 g4').note(),
  mini('[c5 e5]@5 g5').note().slow(3), // crosses cycle boundaries
  mini('bd*16').s(),
)
const SPARSE = mini('c2 ~ ~ ~ ~ ~ ~ ~').note().slow(4) // one short note, then a long rest

function run(pat: any, start: number, steps: number[], frames: number) {
  const sched = schedulerOf(pat)
  const ref = schedulerOf(pat)
  const cache = new ActiveNowCache(EPS)
  let now = start
  for (let i = 0; i < frames; i++) {
    now += steps[i % steps.length]
    const got = cache.at(sched, now, (a, b) => sched.query(a, b))
    expect(got, `frame ${i} at ${now}`).toEqual(ref.query(now, now + EPS))
  }
  const real = sched.calls.filter(([a, b]) => Math.abs(b - a - EPS) < 1e-9).length
  return { real, frames }
}

describe('ActiveNowCache (#2567)', () => {
  it('equals a real now-query every frame, with far fewer real queries', () => {
    const { real, frames } = run(MIX, 0.37, [1 / 120, 1 / 60, 0.013, 1 / 60, 0.2, 0.004, 1 / 30], 1500)
    expect(real).toBeLessThan(frames) // it reuses answers…
    expect(real).toBeGreaterThan(50) // …but still follows every note start/end
  })

  it('lands frames exactly on onsets and on onset − ε', () => {
    // 1/64-cycle steps from 0 hit every 16th onset exactly, and an ε offset grid
    // puts now + ε exactly on an onset.
    run(MIX, 0, [1 / 64], 640)
    run(MIX, -EPS, [1 / 64], 640)
  })

  it('follows a sparse pattern across a long rest', () => {
    const { real } = run(SPARSE, 0.1, [1 / 60], 1200) // 20 s at 1 cycle/s
    expect(real).toBeLessThan(200)
  })

  it('re-queries after time goes backwards and after a re-evaluate', () => {
    const sched = schedulerOf(MIX)
    const cache = new ActiveNowCache(EPS)
    const q = (s: IRPattern) => (a: number, b: number) => s.query(a, b)
    cache.at(sched, 10.3, q(sched))
    expect(cache.at(sched, 2.1, q(sched))).toEqual(schedulerOf(MIX).query(2.1, 2.1 + EPS))
    const other = schedulerOf(mini('e5 g5').note())
    expect(cache.at(other, 2.11, q(other))).toEqual(schedulerOf(mini('e5 g5').note()).query(2.11, 2.11 + EPS))
  })
})
