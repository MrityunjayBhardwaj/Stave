/**
 * #1463 — the AUTHORITY arm for `steppedAutomation.ts`.
 *
 * The unit file proves the reader agrees with the PARSER. This one proves both
 * agree with what PLAYS: the same document is read statically and evaluated
 * through the real transpiler with the engine's own string-parser rule, and the
 * value the reader says step `stepIndexAtCycle(c)` holds must be the value every
 * event in cycle `c` carries. Then an edit is applied and the check is repeated —
 * so "the edit changes exactly the cycles that step owns" is observed in the
 * engine rather than inferred from offsets.
 *
 * Setup mirrors `engine/__tests__/stringParser.test.ts`, the file that grounds the
 * string rule: evalScope + `installMiniStringParser` + the transpiler.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { steppedAutomations, stepIndexAtCycle, stepValueEdit, type SteppedAutomation } from '../steppedAutomation'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The value of `key` on every onset event in each cycle [0, cycles), via the real engine. */
async function valuesPerCycle(code: string, key: string, cycles: number): Promise<unknown[][]> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    const rows: unknown[][] = []
    for (let c = 0; c < cycles; c++) {
      const haps = pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true)
      rows.push(haps.map((h: any) => h.value?.[key]))
    }
    return rows
  } finally {
    clearStringParser({ core })
  }
}

/** What the READER says each cycle plays, in the same row shape. For a parameter
 *  under no section, which every caller of this passes: every cycle plays a step. */
function predicted(a: SteppedAutomation, eventsPerCycle: number, cycles: number): unknown[][] {
  return Array.from({ length: cycles }, (_, c) =>
    Array.from({ length: eventsPerCycle }, () => a.steps[stepIndexAtCycle(a, c)!].value),
  )
}

const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('#1463 — the reader agrees with what the engine plays', () => {
  it.each([
    ['double quotes', 's("bd*2").gain("<0.2 0.8>")'],
    ['single quotes', "s(\"bd*2\").gain('<0.2 0.8>')"],
    ['backticks', 's("bd*2").gain(`<0.2 0.8>`)'],
    ['a weighted step', 's("bd*2").gain("<0.2@2 0.8 0.5>")'],
    ['an aliased control', 's("bd*2").lpf("<200 2000 800>")'],
  ])('%s', async (_label, code) => {
    const [a] = steppedAutomations(parseStrudel(code) as never)
    expect(a, 'the reader found no stepped parameter').toBeDefined()
    // `lpf` arrives on the event as the canonical `cutoff` — the reader's paramKey.
    const cycles = a.periodCycles * 2
    expect(await valuesPerCycle(code, a.paramKey, cycles)).toEqual(predicted(a, 2, cycles))
  }, 60_000)

  it('a declined shape really does NOT hold one value per cycle — the control', async () => {
    // The reader declines `<0.2 [0.4 0.8]>`; the engine confirms cycle 1 carries
    // two different values, so there was no single step to draw.
    const code = 's("bd*2").gain("<0.2 [0.4 0.8]>")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    expect(await valuesPerCycle(code, 'gain', 2)).toEqual([[0.2, 0.2], [0.4, 0.8]])
  }, 60_000)

  it('a concatenated literal the parser reads as steps does NOT play them — why the reader checks the whole argument', async () => {
    const code = 's("bd*2").gain("<0.2 0.8>" + "")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    // The transpiler turns each double-quoted string into a pattern BEFORE the
    // `+` runs, so the argument is no longer the alternation. Whatever it does
    // play, it is not 0.2 then 0.8 — which is the only claim this arm makes.
    const rows = await valuesPerCycle(code, 'gain', 2).catch(() => null)
    expect(rows).not.toEqual([[0.2, 0.2], [0.8, 0.8]])
  }, 60_000)

  it('an override the reader declines really does silence the steps', async () => {
    const code = 's("bd*2").gain("<0.2 0.8>").gain(0.5)'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    expect(await valuesPerCycle(code, 'gain', 2)).toEqual([[0.5, 0.5], [0.5, 0.5]])
  }, 60_000)
})

describe('#1463 — an override through structure', () => {
  it('a call on the whole stack overrides the steps inside it', async () => {
    const code = 'stack(s("bd*2").gain("<0.2 0.8>"), s("hh*2")).gain(0.5)'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    // Every event — bd and hh alike — carries the outer 0.5 in both cycles.
    const rows = await valuesPerCycle(code, 'gain', 2)
    expect(rows.flat().every((v) => v === 0.5)).toBe(true)
    expect(rows.flat().length).toBe(8)
  }, 60_000)
})

/** The plain reading of `<0.2 0.8>`: cycle c plays step `c mod 2`. */
const PLAIN = (c: number) => [0.2, 0.8][c % 2]

describe('#1584 — what the reader declines really does play something else', () => {
  // `undefined` is an event from another section or track that carries no gain —
  // not a disagreement. A disagreement is a value the plain reading would not give.
  it.each([
    // A whole-number slow is applied now — its arm is in the #1595 block below.
    ['fast', 's("bd*4").gain("<0.2 0.8>").fast(2)'],
    ['early', 's("bd*4").gain("<0.2 0.8>").early(1)'],
    ['off', 's("bd*4").gain("<0.2 0.8>").off(0.25, x => x.speed(2))'],
    ['every, with a time transform', 's("bd*4").gain("<0.2 0.8>").every(2, x => x.fast(2))'],
    ['sometimesBy, with a time transform', 's("bd*4").gain("<0.2 0.8>").sometimesBy(0.5, x => x.late(0.25))'],
    ['jux, with a time transform', 's("bd*4").gain("<0.2 0.8>").jux(x => x.fast(2))'],
    // Each route alone keeps bars whole (#1595); only disjointness declines the pair.
    ['jux, with a slow', 's("bd*4").gain("<0.2 0.8>").jux(x => x.slow(2))'],
    ['an operator the parser drops: /[2]', 's("bd*4").gain("<0.2 0.8>/[2]")'],
    ['an operator the parser drops: /<2 1>', 's("bd*4").gain("<0.2 0.8>/<2 1>")'],
    ['an operator the parser drops: *<8 16>', 's("bd*4").gain("<0.2 0.8>*<8 16>")'],
  ])('%s', async (_label, code) => {
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await valuesPerCycle(code, 'gain', 8)
    const disagrees = rows.some((row, c) => row.some((v) => v !== undefined && v !== PLAIN(c)))
    expect(disagrees, `the engine played the plain reading after all: ${JSON.stringify(rows)}`).toBe(true)
  }, 60_000)
})

describe('#1595 — a whole-track time change that keeps each bar on one step is applied, and the engine agrees', () => {
  // Two rivals, each a formula over the same steps: the song cycle (no time steps
  // at all), and the reader's steps composed in the OTHER order. Every input is
  // one where the engine disagrees with the rival, so an arm that stopped telling
  // them apart would fail rather than confirm.
  const songCycle = (a: SteppedAutomation): SteppedAutomation => ({ ...a, placements: [[]] })
  const reversed = (a: SteppedAutomation): SteppedAutomation => ({ ...a, placements: a.placements.map((p) => [...p].reverse()) })

  it.each([
    // [label, code, bd onsets per playing bar]
    ['a slow by 2', 's("bd*4").gain("<0.2 0.8>").slow(2)', 2],
    ['a fast by a half', 's("bd*4").gain("<0.2 0.8>").fast(0.5)', 2],
    ['a shift by a whole cycle', 's("bd*4").gain("<0.2 0.8>").late(1)', 4],
    ['a slow over a shift', 's("bd*4").gain("<0.2 0.8>").late(1).slow(2)', 2],
    ['a slow inside a section', 'arrange([3, s("bd*4").gain("<0.2 0.8>").slow(2)], [1, s("hh*4")])', 2],
    // A later whole-cycle shift around an arrangement hands the section formula a
    // NEGATIVE cycle before bar 1 — the engine's arrangement wraps it the same way.
    ['a whole-cycle later shift around a section', 'arrange([2, s("bd*4").gain("<0.2 0.8 0.5>")], [1, s("hh*4")]).late(1)', 4],
  ])('%s', async (_label, code, perBar) => {
    const [a] = steppedAutomations(parseStrudel(code) as never)
    expect(a, 'the reader found no stepped parameter').toBeDefined()
    const cycles = 16
    // `hh` carries no gain, so a silent bar of this parameter is an empty row.
    const rows = (await valuesPerCycle(code, 'gain', cycles)).map((row) => row.filter((v) => v !== undefined))
    const predict = (x: SteppedAutomation) =>
      rows.map((_row, c) => {
        const k = stepIndexAtCycle(x, c)
        return k === null ? [] : Array.from({ length: perBar }, () => x.steps[k].value)
      })
    expect(rows).toEqual(predict(a))
    expect(rows, 'the song-cycle reading agrees — this input tells nothing apart').not.toEqual(predict(songCycle(a)))
    if (a.placements[0].length > 1) {
      expect(rows, 'the reversed composition agrees — this input tells nothing apart').not.toEqual(predict(reversed(a)))
    }
  }, 60_000)

  it.each([
    ['a slow by a fraction', 's("bd*4").gain("<0.2 0.8>").slow(1.5)'],
    ['a shift by part of a cycle', 's("bd*4").gain("<0.2 0.8>").late(0.5)'],
  ])('%s declines, and the engine changes the step inside a bar', async (_label, code) => {
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await valuesPerCycle(code, 'gain', 8)
    expect(rows.some((row) => new Set(row.filter((v) => v !== undefined)).size > 1), JSON.stringify(rows)).toBe(true)
  }, 60_000)
})

describe('#1584 — what the reader still reads plays exactly what it predicts', () => {
  it.each([
    ['an effect chain', 's("bd*4").gain("<0.2 0.8>").room(0.5).lpf(800)'],
    ['stack', 'stack(s("bd*4").gain("<0.2 0.8>"), s("hh*4").gain(1))'],
    ['layer', 's("bd*4").gain("<0.2 0.8>").layer(x => x.speed(2))'],
    ['mask', 's("bd*4").gain("<0.2 0.8>").mask("<1 [1 0]>")'],
    ['degradeBy', 's("bd*4").gain("<0.2 0.8>").degradeBy(0.3)'],
    ['struct', 's("bd*4").gain("<0.2 0.8>").struct("x ~ x x")'],
    ['chop', 's("bd*4").gain("<0.2 0.8>").chop(2)'],
    ['ply', 's("bd*4").gain("<0.2 0.8>").ply(2)'],
    ['every, with a transform that leaves time alone', 's("bd*4").gain("<0.2 0.8>").every(2, x => x.speed(2))'],
    ['sometimesBy, with a transform that leaves time alone', 's("bd*4").gain("<0.2 0.8>").sometimesBy(0.5, x => x.speed(2))'],
    ['a time transform on the receiver', 's("bd*4").fast(2).gain("<0.2 0.8>")'],
    ['whitespace inside the quotes', 's("bd*4").gain(" <0.2 0.8> ")'],
  ])('%s', async (_label, code) => {
    const found = steppedAutomations(parseStrudel(code) as never)
    expect(found.map((a) => a.paramKey), 'the reader declined a shape that plays its steps').toEqual(['gain'])
    const [a] = found
    const rows = await valuesPerCycle(code, 'gain', 8)
    // `stack`'s second member carries its own gain of 1 — a different parameter,
    // so it is left out of this row; every other event must carry the step.
    const ours = rows.map((row) => row.filter((v) => v !== 1))
    expect(ours.flat().length).toBeGreaterThan(0)
    expect(ours).toEqual(ours.map((row, c) => row.map(() => a.steps[stepIndexAtCycle(a, c)!].value)))
  }, 60_000)
})

describe('#1579 — a whole-number `/n` plays what the reader predicts, and the plain reading does not', () => {
  // Two readings, written down before choosing inputs: the reader's (each step
  // holds weight·n cycles) and the plain one that ignores the `/n` (the second
  // column's document). Each input is one where they DISAGREE — so an arm passing
  // is evidence for the reader, not a coincidence both readings share.
  it.each([
    ['/2', 's("bd*4").gain("<0.2 0.8>/2")', 's("bd*4").gain("<0.2 0.8>")'],
    ['/3', 's("bd*4").gain("<0.2 0.8>/3")', 's("bd*4").gain("<0.2 0.8>")'],
    ['a weighted step /2', 's("bd*4").gain("<0.2@2 0.8>/2")', 's("bd*4").gain("<0.2@2 0.8>")'],
    ['three steps /2', 's("bd*4").gain("<0.2 0.8 0.5>/2")', 's("bd*4").gain("<0.2 0.8 0.5>")'],
    ['spaced', 's("bd*4").gain("<0.2 0.8> / 2")', 's("bd*4").gain("<0.2 0.8>")'],
    ['a decimal spelling', 's("bd*4").gain("<0.2 0.8>/2.0")', 's("bd*4").gain("<0.2 0.8>")'],
  ])('%s', async (_label, code, plainCode) => {
    const [a] = steppedAutomations(parseStrudel(code) as never)
    const [plain] = steppedAutomations(parseStrudel(plainCode) as never)
    expect(a, 'the reader found no stepped parameter').toBeDefined()
    const cycles = a.periodCycles * 2
    const rows = await valuesPerCycle(code, 'gain', cycles)
    expect(rows).toEqual(predicted(a, 4, cycles))
    expect(rows, 'the plain reading predicts this input too — it is not evidence').not.toEqual(predicted(plain, 4, cycles))
  }, 60_000)

  it.each([
    ['a fractional n', 's("bd*4").gain("<0.2 0.8>/1.5")'],
    ['an n below one', 's("bd*4").gain("<0.2 0.8>/0.5")'],
    ['*n', 's("bd*4").gain("<0.2 0.8>*2")'],
  ])('%s declines, and really changes the value inside a cycle', async (_label, code) => {
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await valuesPerCycle(code, 'gain', 4)
    expect(rows.some((row) => new Set(row).size > 1), JSON.stringify(rows)).toBe(true)
  }, 60_000)

  it('two divisions decline — the parser keeps one `/2`, and the engine plays `/4`', async () => {
    const code = 's("bd*4").gain("<0.2 0.8>/2/2")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const [asParsed] = steppedAutomations(parseStrudel('s("bd*4").gain("<0.2 0.8>/2")') as never)
    const rows = await valuesPerCycle(code, 'gain', 8)
    expect(rows).not.toEqual(predicted(asParsed, 4, 8))
    expect(rows.map((row) => row[0])).toEqual([0.2, 0.2, 0.2, 0.2, 0.8, 0.8, 0.8, 0.8])
  }, 60_000)

  it('editing step 0 of `<0.2 0.8>/2` moves cycles 0, 1, 4 and 5, and no other', async () => {
    const code = 's("bd*2").gain("<0.2 0.8>/2")'
    const [a] = steppedAutomations(parseStrudel(code) as never)
    const next = apply(code, stepValueEdit(a, 0, 0.6)!)
    expect(next).toBe('s("bd*2").gain("<0.6 0.8>/2")')

    const before = await valuesPerCycle(code, 'gain', 8)
    const after = await valuesPerCycle(next, 'gain', 8)
    expect(before.map((row) => row[0])).toEqual([0.2, 0.2, 0.8, 0.8, 0.2, 0.2, 0.8, 0.8])
    expect(after.map((row) => row[0])).toEqual([0.6, 0.6, 0.8, 0.8, 0.6, 0.6, 0.8, 0.8])

    const [b] = steppedAutomations(parseStrudel(next) as never)
    expect(after).toEqual(predicted(b, 2, 8))
  }, 60_000)
})

describe('#1587 — the IR read these as steps, and the engine does not play them as steps', () => {
  // Each is a `Cycle` of numeric Plays in the IR. What plays is a random pick, two
  // layers, or an array value — never the rotation those Plays describe.
  it.each([
    ['a random choice', 's("bd*4").gain("[1|1.5]")'],
    ['a random choice, slowed', 's("bd*4").gain("[0|0.05|0.1|0.15]/2")'],
    ['a bare random choice of colon atoms', 's("bd*4").gain(".4:3 | .7:2 | .4:-2")'],
    ['two layers', 's("bd*4").gain("<1 2 3 4 5 6, 5 4 3 4 2>")'],
    ['a colon atom', 's("bd*4").gain("<0.2 0.8:1>")'],
    ['a chain of colon atoms', 's("bd*4").gain("<.1:.5:.5 1 2>")'],
  ])('%s declines, and the engine plays something other than the rotation', async (_label, code) => {
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await valuesPerCycle(code, 'gain', 12)
    const find = (n: any): any =>
      n?.tag === 'Cycle' ? n : n && typeof n === 'object' ? Object.values(n).map(find).find(Boolean) : null
    const notes = find(parseStrudel(code)).items.map((it: any) => Number(it.note))
    const rotation = rows.map((_, c) => notes[c % notes.length])
    const plays = rows.map((row) => (new Set(row.map((v) => JSON.stringify(v))).size === 1 ? row[0] : row))
    expect(plays, JSON.stringify(rows)).not.toEqual(rotation)
  }, 60_000)

  it.each([
    ['copies', 's("bd*4").gain("<0.3!3 0.8>")'],
    ['a bare copy', 's("bd*4").gain("<0.3! 0.8>")'],
    ['copies then a weight', 's("bd*4").gain("<0.2!3@2 0.8>")'],
    ['a weight then copies', 's("bd*4").gain("<0.2@2!3 0.8>")'],
    ['copies of both steps, slowed', 's("bd*4").gain("<0!4 4!4>/4")'],
    ['copies with trailing whitespace, slowed', 's("bd*4").gain("<.3!3 .4 >/2")'],
  ])('%s reads as one step per written number, and predicts the engine', async (_label, code) => {
    const [a] = steppedAutomations(parseStrudel(code) as never)
    expect(a, 'the reader declined').toBeDefined()
    const cycles = a.periodCycles * 2
    expect(await valuesPerCycle(code, 'gain', cycles)).toEqual(predicted(a, 4, cycles))
  }, 60_000)

  it('an alternation with another step after it, and a polymeter, play two values in a cycle', async () => {
    for (const code of ['s("bd*4").gain("<0.2 0.8> 0.5")', 's("bd*4").gain("{0.2 0.8}")']) {
      expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
      const rows = await valuesPerCycle(code, 'gain', 4)
      expect(rows.every((row) => new Set(row).size === 2), `${code}: ${JSON.stringify(rows)}`).toBe(true)
    }
  }, 60_000)

  it('a zero weight declines — the engine plays the step as if it had weight 1', async () => {
    const code = 's("bd*4").gain("<0.2@0 0.8>")'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    // A reading that took the weight at its word would hold 0.2 for no cycles.
    expect((await valuesPerCycle(code, 'gain', 4)).map((row) => row[0])).toEqual([0.2, 0.8, 0.2, 0.8])
  }, 60_000)

  it('`/0` and `/-2` decline — the engine plays nothing for either', async () => {
    for (const code of ['s("bd*4").gain("<0.2 0.8>/0")', 's("bd*4").gain("<0.2 0.8>/-2")']) {
      expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
      expect((await valuesPerCycle(code, 'gain', 4)).flat()).toEqual([])
    }
  }, 60_000)

  it('editing a step written with `!3` moves all three of its cycles and not the other step\'s', async () => {
    const code = 's("bd*2").gain("<0.3!3 0.8>")'
    const [a] = steppedAutomations(parseStrudel(code) as never)
    expect(a.steps).toHaveLength(2)
    const next = apply(code, stepValueEdit(a, 0, 0.6)!)
    expect(next).toBe('s("bd*2").gain("<0.6!3 0.8>")')
    const after = await valuesPerCycle(next, 'gain', 8)
    expect(after.map((row) => row[0])).toEqual([0.6, 0.6, 0.6, 0.8, 0.6, 0.6, 0.6, 0.8])
    const [b] = steppedAutomations(parseStrudel(next) as never)
    expect(after).toEqual(predicted(b, 2, 8))
  }, 60_000)
})

/** Every distinct gain each cycle carries, sorted. An event with no gain belongs to
 *  another section or track, so it contributes nothing. */
async function gainSets(code: string, cycles: number): Promise<number[][]> {
  const rows = await valuesPerCycle(code, 'gain', cycles)
  return rows.map((row) => [...new Set(row.filter((v): v is number => typeof v === 'number'))].sort((x, y) => x - y))
}

/**
 * What the reader says each cycle carries, over every automation found, in
 * `gainSets`' shape. `own` is the reader. `song` is the rival #1584 corrected: the
 * same bars, but each step chosen by the SONG's cycle rather than the section's.
 */
function predictedSets(found: readonly SteppedAutomation[], cycles: number, reading: 'own' | 'song'): number[][] {
  return Array.from({ length: cycles }, (_, c) => {
    const values = found.flatMap((a) => {
      const k = stepIndexAtCycle(a, c)
      if (k === null) return []
      return [a.steps[reading === 'own' ? k : stepIndexAtCycle({ ...a, placements: [[]] }, c)!].value]
    })
    return [...new Set(values)].sort((x, y) => x - y)
  })
}

describe('#1585 — a section counts its own cycles, and the engine agrees', () => {
  // Every input is one where the song-cycle reading gives a different answer
  // somewhere in 24 cycles, so a pass is evidence for the reader and not a
  // coincidence both share. ⚠ `arrange([2, a], [1, b], [2, a])` with a three-step
  // `a` is NOT such an input: a pass of 5 moves the song 3 cycles ahead of the
  // section, which a period of 3 cannot see. Its restart has its own arm below.
  it.each([
    ['an arrange section', 'arrange([3, s("bd*4").gain("<0.2 0.8>")], [1, s("hh*4")])'],
    ['a later section', 'arrange([1, s("hh*4")], [2, s("bd*4").gain("<0.2 0.8 0.5>")])'],
    ['a slowed alternation inside a section', 'arrange([3, s("bd*4").gain("<0.2 0.8>/2")], [1, s("hh*4")])'],
    ['a weighted step inside a section', 'arrange([3, s("bd*4").gain("<0.2@2 0.8>")], [1, s("hh*4")])'],
    ['cat', 'cat(s("bd*4").gain("<0.2 0.8 0.5>"), s("hh*4"), s("sd*4"))'],
    ['slowcat', 'slowcat(s("bd*4").gain("<0.2 0.8 0.5>"), s("hh*4"))'],
    ['a nested arrangement', 'arrange([2, arrange([1, s("bd*4").gain("<0.2 0.8 0.5>")], [1, s("sd*4")])], [1, s("hh*4")])'],
    ['an arrangement under stack', 'stack(arrange([3, s("bd*4").gain("<0.2 0.8>")], [1, s("hh*4")]), s("cp*4"))'],
    ['a section of weight 0 beside it', 'arrange([0, s("sd*4")], [3, s("bd*4").gain("<0.2 0.8 0.5>")], [1, s("hh*4")])'],
    ['a binding arranged twice', 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\narrange([2, a], [2, s("hh*4")], [2, a])'],
    ['the same section written out twice', 'arrange([2, s("bd*4").gain("<0.2 0.8 0.5>")], [2, s("hh*4")], [2, s("bd*4").gain("<0.2 0.8 0.5>")])'],
    ['one binding in two adjacent sections', 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\narrange([1, a], [1, a], [1, s("hh*4")])'],
  ])('%s', async (_label, code) => {
    const found = steppedAutomations(parseStrudel(code) as never)
    expect(found.length, 'the reader declined').toBeGreaterThan(0)
    const rows = await gainSets(code, 24)
    expect(rows.flat().length, 'the engine played no gain at all').toBeGreaterThan(0)
    expect(rows).toEqual(predictedSets(found, 24, 'own'))
    expect(rows, 'the song-cycle reading predicts this input too — it is not evidence').not.toEqual(predictedSets(found, 24, 'song'))
  }, 60_000)

  it('a section that appears twice RESTARTS its count in each appearance — it does not carry on', async () => {
    const code = 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\narrange([2, a], [1, s("hh*4")], [2, a])'
    // Carrying on would play 0.5 then 0.2 in bars 3 and 4. The engine starts again.
    const rows = await gainSets(code, 10)
    expect(rows).toEqual([[0.2], [0.8], [], [0.2], [0.8], [0.5], [0.2], [], [0.5], [0.2]])
    expect(rows).toEqual(predictedSets(steppedAutomations(parseStrudel(code) as never), 10, 'own'))
  }, 60_000)

  it('editing a step of a binding arranged twice moves exactly the bars, in both appearances, that play it', async () => {
    const code = 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\narrange([2, a], [2, s("hh*4")], [2, a])'
    const [a] = steppedAutomations(parseStrudel(code) as never)
    const next = apply(code, stepValueEdit(a, 1, 0.4)!)
    expect(next).toBe('const a = s("bd*4").gain("<0.2 0.4 0.5>")\narrange([2, a], [2, s("hh*4")], [2, a])')

    const before = await gainSets(code, 18)
    const after = await gainSets(next, 18)
    const changed = before.flatMap((row, c) => (JSON.stringify(row) === JSON.stringify(after[c]) ? [] : [c]))
    const playsStep1 = Array.from({ length: 18 }, (_, c) => c).filter((c) => stepIndexAtCycle(a, c) === 1)
    expect(changed).toEqual(playsStep1)
    // In both appearances: the first sits at bars 0–1 of each pass of 6, the second at 4–5.
    expect(changed.some((c) => c % 6 < 2) && changed.some((c) => c % 6 >= 4), JSON.stringify(changed)).toBe(true)
    expect(after).toEqual(predictedSets(steppedAutomations(parseStrudel(next) as never), 18, 'own'))
  }, 60_000)

  it('a fractional weight declines, and the engine changes the value inside a cycle', async () => {
    const code = 'arrange([1.5, s("bd*4").gain("<0.2 0.8>")], [0.5, s("hh*4")])'
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await gainSets(code, 8)
    expect(rows.some((row) => row.length > 1), JSON.stringify(rows)).toBe(true)
  }, 60_000)

  it('weights summing to 0, and a negative weight, decline — the engine never plays that section', async () => {
    for (const code of [
      'arrange([0, s("bd*4").gain("<0.2 0.8>")])',
      'arrange([-1, s("sd*4")], [3, s("bd*4").gain("<0.2 0.8 0.5>")], [1, s("hh*4")])',
    ]) {
      expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
      expect((await gainSets(code, 8)).flat(), code).toEqual([])
    }
  }, 60_000)

  it.each([
    ['a route inside a section and one outside it', 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\nstack(a, arrange([1, a], [1, s("hh*4")]))'],
    ['one binding in two arrangements side by side', 'const a = s("bd*4").gain("<0.2 0.8 0.5>")\nstack(arrange([1, a], [1, s("hh*4")]), arrange([1, s("sd*4")], [2, a]))'],
  ])('%s declines, and the engine plays two values in one cycle', async (_label, code) => {
    expect(steppedAutomations(parseStrudel(code) as never)).toEqual([])
    const rows = await gainSets(code, 12)
    expect(rows.some((row) => row.length > 1), JSON.stringify(rows)).toBe(true)
  }, 60_000)
})

describe('#1463 — an edit changes exactly the cycles its step owns', () => {
  it('editing the weighted step moves every cycle it plays, and no other', async () => {
    const code = 's("bd*2").gain("<0.2@2 0.8>")'
    const [a] = steppedAutomations(parseStrudel(code) as never)
    const next = apply(code, stepValueEdit(a, 0, 0.6)!)
    expect(next).toBe('s("bd*2").gain("<0.6@2 0.8>")')

    const before = await valuesPerCycle(code, 'gain', 6)
    const after = await valuesPerCycle(next, 'gain', 6)
    expect(before).toEqual([[0.2, 0.2], [0.2, 0.2], [0.8, 0.8], [0.2, 0.2], [0.2, 0.2], [0.8, 0.8]])
    // Cycles 0,1,3,4 belong to step 0 and moved; cycles 2,5 belong to step 1 and did not.
    expect(after).toEqual([[0.6, 0.6], [0.6, 0.6], [0.8, 0.8], [0.6, 0.6], [0.6, 0.6], [0.8, 0.8]])

    // And the reader, re-run on the edited document, predicts the engine again.
    const [b] = steppedAutomations(parseStrudel(next) as never)
    expect(after).toEqual(predicted(b, 2, 6))
  }, 60_000)
})
