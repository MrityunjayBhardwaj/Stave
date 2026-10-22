/**
 * #1590 — the AUTHORITY arm for where a continuous curve is drawn.
 *
 * The unit file proves the reader agrees with the PARSER. This one proves it agrees
 * with what PLAYS: the same document is read statically and evaluated through the
 * real transpiler, and the gain on every `bd` onset must be the curve evaluated at
 * `signalTimeAt` — and no onset may fall in a bar the reader calls silent. Each input
 * is one where the song-time reading gives a DIFFERENT value, and the arm asserts
 * that too, so an input that stops telling the two apart fails instead of confirming.
 *
 * Setup mirrors `steppedAutomation.engine.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations, signalTimeAt, type SignalAutomation } from '../signalAutomation'
import { signalDimensionsOf } from '../songAnalysis'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CYCLES = 24

/** Onset time and gain of every `bd` event in [0, CYCLES), via the real engine. */
async function bdOnsets(code: string, cycles = CYCLES): Promise<{ t: number; gain: number }[]> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    return pat
      .queryArc(0, cycles)
      .filter((h: any) => (h.hasOnset?.() ?? true) && h.value?.s === 'bd')
      .map((h: any) => ({ t: h.whole.begin.valueOf(), gain: h.value.gain }))
  } finally {
    clearStringParser({ core })
  }
}

/** The two waveforms these arms use, from `@strudel/core@1.2.6` `signal.mjs`:
 *  `saw = t % 1` and `sine = (sin(2πt) + 1) / 2`, both sampled at a hap's begin. */
const UNIT: Record<string, (x: number) => number> = {
  saw: (x) => x - Math.floor(x),
  sine: (x) => (Math.sin(2 * Math.PI * x) + 1) / 2,
}
const valueAt = (a: SignalAutomation, own: number) => a.lo + (a.hi - a.lo) * UNIT[a.kind](own / a.periodCycles)
/** What the reader says plays at song time `t`, or null for a silent section. */
const drawn = (a: SignalAutomation, t: number) => {
  const own = signalTimeAt(a, t)
  return own === null ? null : valueAt(a, own)
}
/** The rival: the curve at the song's own time — what the lane drew before #1590. */
const songTime = (a: SignalAutomation, t: number) => valueAt(a, t)
const worst = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), 0)

describe('#1590 — a curve plays at the time the reader hands it, and the song-time reading does not', () => {
  it.each([
    ['a later section', 'arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])'],
    ['a section\'s second pass', 'arrange([3, s("bd*8").gain(sine.slow(4))], [1, s("hh*8")])'],
    ['cat', 'cat(s("hh*8"), s("bd*8").gain(saw.slow(3)))'],
    ['a nested arrangement', 'arrange([1, s("hh*8")], [2, arrange([1, s("bd*8").gain(saw.slow(3))], [1, s("cp*8")])])'],
  ])('%s', async (_label, code) => {
    const [a] = signalAutomations(parseStrudel(code) as never)
    expect(a, 'the reader found no curve').toBeDefined()
    const events = await bdOnsets(code)
    expect(events.length, 'the engine played no bd at all').toBeGreaterThan(0)

    // Every onset lies inside a playing section and carries the reader's value.
    for (const e of events) {
      const v = drawn(a, e.t)
      expect(v, `the reader calls t=${e.t} silent, and the engine plays bd there`).not.toBeNull()
      expect(Math.abs(e.gain - (v as number)), `t=${e.t}`).toBeLessThan(1e-9)
    }
    // Every bar the reader calls silent really is silent for this track.
    for (let c = 0; c < CYCLES; c++) {
      if (drawn(a, c + 0.5) !== null) continue
      expect(events.filter((e) => Math.floor(e.t) === c), `bar ${c} is called silent`).toEqual([])
    }
    // And the song-time reading is wrong on this input.
    expect(worst(events.map((e) => Math.abs(e.gain - songTime(a, e.t))))).toBeGreaterThan(0.1)
  }, 60_000)

  it('under no section the two readings are the same, and both are right — the control', async () => {
    const code = 's("bd*8").gain(saw.slow(3))'
    const [a] = signalAutomations(parseStrudel(code) as never)
    const events = await bdOnsets(code)
    expect(events.length).toBe(8 * CYCLES)
    expect(worst(events.map((e) => Math.abs(e.gain - (drawn(a, e.t) as number))))).toBeLessThan(1e-9)
  }, 60_000)
})

describe('#1595 — a whole-track time change is applied: the curve plays at the composed time, and neither rival does', () => {
  // The second rival is the reader's own time steps composed in the OTHER order;
  // it is only asked of an input with more than one step, where it can differ.
  const reversed = (a: SignalAutomation): SignalAutomation => ({ ...a, placements: a.placements.map((p) => [...p].reverse()) })

  it.each([
    ['slow', 's("bd*8").gain(saw.slow(3)).slow(2)'],
    ['fast', 's("bd*8").gain(saw.slow(3)).fast(2)'],
    ['an earlier shift', 's("bd*8").gain(saw.slow(3)).late(-0.5)'],
    // No visualiser arm here: bare `@strudel/core` has no `._scope` (Stave's engine
    // installs it), so it throws. The unit file reads a slow under one, and the
    // #1592 browser arm shows a visualiser leaves what plays unchanged.
    // A shift under a slow — two pure scales commute, so they could not tell the
    // orders apart. Handed `t/2 + 1`; the reversed order gives `(t + 1)/2`.
    ['a slow over an earlier shift', 's("bd*8").gain(saw.slow(3)).late(-1).slow(2)'],
    ['a slow around a section', 'arrange([1, s("hh*8")], [2, s("bd*8").gain(saw.slow(3))]).slow(2)'],
    ['a slow inside a section', 'arrange([1, s("hh*8")], [2, s("bd*8").gain(saw.slow(3)).slow(2)])'],
  ])('%s', async (_label, code) => {
    const [a] = signalAutomations(parseStrudel(code) as never)
    expect(a, 'the reader found no curve').toBeDefined()
    const events = await bdOnsets(code)
    expect(events.length, 'the engine played no bd at all').toBeGreaterThan(0)
    for (const e of events) {
      const v = drawn(a, e.t)
      expect(v, `the reader calls t=${e.t} silent, and the engine plays bd there`).not.toBeNull()
      expect(Math.abs(e.gain - (v as number)), `t=${e.t}`).toBeLessThan(1e-9)
    }
    for (let c = 0; c < CYCLES; c++) {
      if (drawn(a, c + 0.5) !== null) continue
      expect(events.filter((e) => Math.floor(e.t) === c), `bar ${c} is called silent`).toEqual([])
    }
    expect(worst(events.map((e) => Math.abs(e.gain - songTime(a, e.t)))), 'song time agrees').toBeGreaterThan(0.1)
    if (a.placements[0].length > 1) {
      const r = reversed(a)
      const off = events.some((e) => {
        const v = drawn(r, e.t)
        return v === null || Math.abs(e.gain - v) > 0.1
      })
      expect(off, 'the reversed composition agrees — this input tells nothing apart').toBe(true)
    }
  }, 60_000)

  it('the period the lane shows is the one the engine repeats at, and the signal\'s own is not (#1464 Stage 3)', async () => {
    const code = 's("bd*8").gain(saw.slow(3)).slow(2)'
    const [a] = signalAutomations(parseStrudel(code) as never)
    expect(a.lanePeriodCycles).toBe(6)
    const events = await bdOnsets(code)
    const gainAt = new Map(events.map((e) => [e.t, e.gain]))
    const pairs = (d: number) => events.filter((e) => gainAt.has(e.t + d)).map((e) => [e.gain, gainAt.get(e.t + d) as number])
    expect(pairs(6).length, 'no onset has a partner one lane period later').toBeGreaterThan(0)
    expect(worst(pairs(6).map(([x, y]) => Math.abs(x - y))), 'it does not repeat at the lane period').toBeLessThan(1e-9)
    expect(worst(pairs(3).map(([x, y]) => Math.abs(x - y))), 'the rival: it repeats at the signal\'s own period').toBeGreaterThan(0.1)
  }, 60_000)
})

describe('#1595 — a later shift declines: before bar `o` the engine plays the curve at negative time', () => {
  it('a saw under `.late(0.5)` plays below its own floor in the first half bar — no wrapped curve is that', async () => {
    const code = 's("bd*8").gain(saw.slow(3)).late(0.5)'
    expect(signalAutomations(parseStrudel(code) as never)).toEqual([])
    // `saw = signal(t => t % 1)` (`signal.mjs:35`), and `%` keeps the sign.
    const early = (await bdOnsets(code, 1)).filter((e) => e.t < 0.5)
    expect(early.length).toBeGreaterThan(0)
    expect(early.every((e) => e.gain < 0), JSON.stringify(early)).toBe(true)
  }, 60_000)
})

/** The smallest P at which every cycle's bd onsets (position in the cycle, gain)
 *  equal those P cycles later, over `cycles` cycles — or null. */
function enginePeriod(events: { t: number; gain: number }[], cycles: number): number | null {
  const rows = Array.from({ length: cycles }, () => [] as string[])
  for (const e of events) {
    const c = Math.floor(e.t)
    rows[c].push(`${(e.t - c).toFixed(4)}:${e.gain.toFixed(6)}`)
  }
  const keys = rows.map((r) => r.sort().join(';'))
  for (let p = 1; p <= cycles / 2; p++) {
    if (keys.every((k, c) => c + p >= cycles || k === keys[c + p])) return p
  }
  return null
}

describe('#1610 — the bounds the reader reports are the ones the engine plays', () => {
  // 16 onsets a bar under `.slow(4)` sample each waveform at 64 points a period, which
  // lands exactly on its low and high points, so the extremes can be compared outright.
  it.each([
    ['sine.slow(4).range(0.2, 0.8)', true],
    ['sine2.slow(4).range(0.2, 0.8)', false],
    ['tri2.slow(4).range(0.2, 0.8)', false],
    ['square2.slow(4).range(0.2, 0.8)', false],
    ['sine.slow(4).range(0, 1).range(0.2, 0.8)', true],
    ['sine.slow(4).range(0, 2).range(0.2, 0.8)', false],
  ] as const)('%s', async (expr, asWritten) => {
    const code = `s("bd*16").gain(${expr})`
    const gains = (await bdOnsets(code, 16)).map((o) => o.gain)
    const [a] = signalAutomations(parseStrudel(`$: ${code}`) as never)
    expect(gains.length).toBe(256)
    const round = (x: number) => Math.round(x * 1e9) / 1e9
    const played = [round(Math.min(...gains)), round(Math.max(...gains))]
    expect(played, 'the reader\'s bounds').toEqual([round(a.lo), round(a.hi)])
    expect(a.boundsAsWritten).toBe(asWritten)
    // The rival: the call's own arguments. They play exactly where the reader says they are the bounds.
    expect(played[0] === 0.2 && played[1] === 0.8, 'the arguments are what plays').toBe(asWritten)
  })
})

describe('#1613 — a range written high-to-low plays downward, and the reader says so', () => {
  it('tri under range(0.7, 0.3) is 0.7 at its natural low and 0.3 at its natural high; the reader reports lo > hi', async () => {
    const code = 's("bd*16").gain(tri.slow(4).range(0.7, 0.3))'
    const at = new Map((await bdOnsets(code, 4)).map((o) => [o.t, Math.round(o.gain * 1e9) / 1e9]))
    expect(at.size).toBe(64)
    expect([at.get(0), at.get(2)], 'natural low (t=0), natural high (t=2)').toEqual([0.7, 0.3])
    const [a] = signalAutomations(parseStrudel(`$: ${code}`) as never)
    expect({ lo: a.lo, hi: a.hi }).toEqual({ lo: 0.7, hi: 0.3 })
    // Control: written low-to-high, the same curve plays upward.
    const up = new Map((await bdOnsets('s("bd*16").gain(tri.slow(4).range(0.3, 0.7))', 4)).map((o) => [o.t, Math.round(o.gain * 1e9) / 1e9]))
    expect([up.get(0), up.get(2)]).toEqual([0.3, 0.7])
  })
})

describe('#1614 — a range does not bound time: the engine passes the range\'s arguments, and the reader declines', () => {
  it('time.range(0.2, 0.8) keeps rising past 0.8 after the first cycle; nothing is drawn for it', async () => {
    const code = 's("bd*16").gain(time.range(0.2, 0.8))'
    const onsets = await bdOnsets(code, 16)
    expect(onsets.length).toBe(256)
    // The engine plays the affine map of the cycle position, over the whole song.
    expect(worst(onsets.map((o) => Math.abs(o.gain - (0.2 + 0.6 * o.t)))), 'the closed form').toBeLessThan(1e-9)
    expect(Math.max(...onsets.map((o) => o.gain)), 'the loudest onset').toBeCloseTo(9.7625, 9)
    // The rival — what the lane drew before: the arguments as bounds, the phase wrapped each
    // cycle. It agrees in the first cycle and nowhere after, so the input tells the two apart.
    const wrapped = (t: number) => 0.2 + 0.6 * (t - Math.floor(t))
    expect(worst(onsets.filter((o) => o.t < 1).map((o) => Math.abs(o.gain - wrapped(o.t))))).toBeLessThan(1e-9)
    expect(worst(onsets.filter((o) => o.t >= 1).map((o) => Math.abs(o.gain - wrapped(o.t))))).toBeGreaterThan(0.5)
    expect(signalAutomations(parseStrudel(`$: ${code}`) as never)).toEqual([])
  })
})

describe('#1590 — the period fold is told the period the engine repeats at', () => {
  it.each([
    ['no section (control)', 's("bd*8").gain(saw.slow(3))', 3],
    ['a later section', 'arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])', 4],
    ['a section\'s second pass', 'arrange([3, s("bd*8").gain(sine.slow(4))], [1, s("hh*8")])', 16],
    ['cat', 'cat(s("hh*8"), s("bd*8").gain(saw.slow(3)))', 6],
  ])('%s', async (label, code, expected) => {
    const ir = parseStrudel(code) as never
    expect(signalDimensionsOf(ir).periods).toEqual([expected])
    expect(enginePeriod(await bdOnsets(code, 48), 48)).toBe(expected)
    // Where the input tells them apart, the unsectioned rate is not the answer.
    if (!label.includes('control')) expect(signalAutomations(ir)[0].periodCycles).not.toBe(expected)
  }, 60_000)
})

describe('#1590 — what the reader declines really does play something other than the song-time curve', () => {
  const PLAIN = 's("bd*8").gain(saw.slow(3))'

  it.each([
    // `.slow` and `.fast` are applied since #1595 — their arms are in that block.
    ['early', `${PLAIN}.early(0.5)`],
    // Both routes are drawable alone; only route disjointness declines the pair.
    ['jux, with a fast', `${PLAIN}.jux(x => x.fast(2))`],
    // `cpm` is `fast(cpm / 60 / cps)`; in the bare core used here cps is 1.
    ['cpm', `${PLAIN}.cpm(120)`],
    ['every, with a time transform', `${PLAIN}.every(2, x => x.fast(2))`],
    ['jux, with a time transform', `${PLAIN}.jux(x => x.late(.25))`],
    ['a same-key call above it', `${PLAIN}.gain(0.5)`],
  ])('%s', async (_label, code) => {
    expect(signalAutomations(parseStrudel(code) as never)).toEqual([])
    const [plain] = signalAutomations(parseStrudel(PLAIN) as never)
    const events = await bdOnsets(code)
    expect(events.length).toBeGreaterThan(0)
    expect(worst(events.map((e) => Math.abs(e.gain - songTime(plain, e.t))))).toBeGreaterThan(0.1)
  }, 60_000)
})
