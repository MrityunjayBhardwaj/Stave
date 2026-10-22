/**
 * Stepped automation read off the static IR (#1463 Stage 1).
 *
 * ⚠ Every case goes through the REAL parser, never a hand-built node — the same
 * discipline `signalAutomation.test.ts` states, for the same reason: a fixture
 * pins this module against a belief about the parser's output. The shapes these
 * arms rely on were printed from `parseStrudel` before any of this was written.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { steppedAutomations, stepIndexAtCycle, stepValueEdit, stepTextEdit, type SteppedAutomation } from '../steppedAutomation'

const read = (src: string) => steppedAutomations(parseStrudel(src) as never)
const apply = (src: string, e: { range: [number, number]; text: string }) =>
  src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('steppedAutomations — the simple shape', () => {
  it('reads each step, its weight, where it starts and where its number is written', () => {
    const src = '$: s("bd*2").gain("<0.2 0.8>")'
    const [a] = read(src)
    expect(a).toMatchObject({ trackId: 'd1', paramKey: 'gain', method: 'gain', periodCycles: 2 })
    expect(a.steps.map((s) => [s.value, s.weight, s.startCycle])).toEqual([
      [0.2, 1, 0],
      [0.8, 1, 1],
    ])
    // The span is the NUMBER, not the atom's surroundings — read back as text.
    expect(a.steps.map((s) => src.slice(s.valueSpan.start, s.valueSpan.end))).toEqual(['0.2', '0.8'])
  })

  it('a weighted step spans its weight, and the period is the sum', () => {
    const src = '$: s("bd*2").gain("<0.2@2 0.8>")'
    const [a] = read(src)
    expect(a.periodCycles).toBe(3)
    expect(a.steps.map((s) => [s.value, s.weight, s.startCycle])).toEqual([
      [0.2, 2, 0],
      [0.8, 1, 2],
    ])
    // ⚠ The value span must exclude the `@2`, or a value edit eats the weight.
    expect(src.slice(a.steps[0].valueSpan.start, a.steps[0].valueSpan.end)).toBe('0.2')
  })

  it('reads the numbers as the user spelled them — negative, leading dot, spaced', () => {
    expect(read('$: s("bd*2").pan("<-1 .5 1>")')[0].steps.map((s) => s.value)).toEqual([-1, 0.5, 1])
    expect(read('$: s("bd*2").gain("< 0.2  0.8 >")')[0].steps.map((s) => s.value)).toEqual([0.2, 0.8])
  })

  it('reads all three quote styles — the engine pattern-parses each (see the engine test)', () => {
    for (const q of ['"', "'", '`']) {
      const [a] = read(`$: s("bd*2").gain(${q}<0.2 0.8>${q})`)
      expect(a?.steps.map((s) => s.value), `quote ${q}`).toEqual([0.2, 0.8])
    }
  })

  it('keys by the CANONICAL control and keeps the typed method', () => {
    expect(read('$: s("bd*2").lpf("<200 2000>")')[0]).toMatchObject({ paramKey: 'cutoff', method: 'lpf' })
  })

  it('reads several parameters on one chain', () => {
    const keys = read('$: s("bd*2").velocity("<.2 .8>").room("<0 0.5>")').map((a) => a.paramKey)
    expect(keys.sort()).toEqual(['room', 'velocity'])
  })

  it('attributes to the track that declares it, inside a stack too', () => {
    expect(read('lead: stack(s("bd*2").gain("<0.2 0.8>"), s("hh*2"))')[0].trackId).toBe('lead')
    expect(read('$: stack(s("bd*2").gain("<0.2 0.8>"), s("hh*4"))')[0].trackId).toBe('d1')
  })

  it('is empty for a document with no stepped parameter — the ordinary case', () => {
    expect(read('$: s("bd*2").gain(0.8)')).toEqual([])
    expect(read('$: s("bd*2")')).toEqual([])
    expect(steppedAutomations(null)).toEqual([])
  })
})

describe('steppedAutomations — abstains rather than drawing what does not play', () => {
  // Each of these was measured in the real evaluator (#1463's grounding).
  it('a rest step silences the track — not a value, so the parameter declines', () => {
    expect(read('$: s("bd*2").gain("<0.2 ~ 0.8>")')).toEqual([])
  })

  it('a subdivided step is not held for a cycle', () => {
    expect(read('$: s("bd*2").gain("<0.2 [0.4 0.8]>")')).toEqual([])
  })

  it('`<…>*n` puts n steps inside every cycle — no held value to draw (#1579)', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>*4")')).toEqual([])
  })

  it('not a per-cycle alternation at all', () => {
    expect(read('$: s("bd*2").gain("0.2 0.8")')).toEqual([])
  })

  // The parser models all three of these as the same `Cycle`. The engine does not
  // play the first one as steps at all (see the engine test), so the reader must
  // see the whole argument, not only the node it parsed to.
  it('an argument that is more than one string literal declines', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>" + "")')).toEqual([])
    // Plays the steps (controls are unary), but is not an argument a lane can own.
    expect(read('$: s("bd*2").gain("<0.2 0.8>", 1)')).toEqual([])
  })

  it('the whole-literal CONTROL — trailing whitespace is still one literal', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>" )').map((a) => a.paramKey)).toEqual(['gain'])
  })

  it('non-numeric steps', () => {
    expect(read('$: s("bd*2").color("<red blue>")')).toEqual([])
  })

  it('a fractional weight has no whole-cycle start', () => {
    expect(read('$: s("bd*2").gain("<0.2@1.5 0.8>")')).toEqual([])
  })

  // P168 measured again for this module: the LATER call wins on every event.
  it('a stepped parameter a later same-key call overrides is dead — it declines', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>").gain(0.5)')).toEqual([])
    // Canonical keys: `.cutoff` overrides an earlier `.lpf`.
    expect(read('$: s("bd*2").lpf("<200 2000>").cutoff(800)')).toEqual([])
  })

  it('the override reaches through structure — a call on the whole stack hides the inner steps', () => {
    expect(read('$: stack(s("bd*2").gain("<0.2 0.8>"), s("hh*4")).gain(0.5)')).toEqual([])
  })

  it('the override CONTROL — a later call on a DIFFERENT key does not hide it', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>").room(0.5)').map((a) => a.paramKey)).toEqual(['gain'])
  })

  it('an EARLIER same-key call does not hide a later stepped one', () => {
    expect(read('$: s("bd*2").gain(0.5).gain("<0.2 0.8>")').map((a) => a.paramKey)).toEqual(['gain'])
  })
})

describe('steppedAutomations — only where nothing above the parameter moves time (#1584)', () => {
  // Each shape here has an arm in the engine test: the declined ones play
  // something other than `cycle mod period`, the read ones play exactly that.
  it.each([
    // A whole-number slow is applied now (#1595); a fast by 2 changes the step
    // inside a bar, which no one-step-per-bar lane can draw.
    ['fast', '$: s("bd*2").gain("<0.2 0.8>").fast(2)'],
    ['early', '$: s("bd*2").gain("<0.2 0.8>").early(1)'],
    ['off', '$: s("bd*2").gain("<0.2 0.8>").off(0.25, x => x.speed(2))'],
    ['every, with a time transform', '$: s("bd*2").gain("<0.2 0.8>").every(2, x => x.fast(2))'],
    ['sometimesBy, with a time transform', '$: s("bd*2").gain("<0.2 0.8>").sometimesBy(0.5, x => x.late(0.25))'],
    // The plain channel reaches the parameter cleanly; the other reaches the SAME
    // node through a Fast. One dirty route is enough.
    ['jux, with a time transform', '$: s("bd*2").gain("<0.2 0.8>").jux(x => x.fast(2))'],
    // A whole-number slow keeps bars whole, so each route alone is drawable (#1595);
    // only route disjointness declines the pair, which plays two values at once.
    ['jux, with a slow', '$: s("bd*2").gain("<0.2 0.8>").jux(x => x.slow(2))'],
  ])('%s declines', (_label, src) => {
    expect(read(src)).toEqual([])
  })

  it.each([
    ['an effect chain', '$: s("bd*2").gain("<0.2 0.8>").room(0.5).lpf(800)'],
    ['stack', '$: stack(s("bd*2").gain("<0.2 0.8>"), s("hh*2"))'],
    ['layer', '$: s("bd*2").gain("<0.2 0.8>").layer(x => x.speed(2))'],
    ['mask', '$: s("bd*2").gain("<0.2 0.8>").mask("<1 [1 0]>")'],
    ['degradeBy', '$: s("bd*2").gain("<0.2 0.8>").degradeBy(0.3)'],
    ['struct', '$: s("bd*2").gain("<0.2 0.8>").struct("x ~ x x")'],
    ['chop', '$: s("bd*2").gain("<0.2 0.8>").chop(2)'],
    ['ply', '$: s("bd*2").gain("<0.2 0.8>").ply(2)'],
    ['every, with a transform that leaves time alone', '$: s("bd*2").gain("<0.2 0.8>").every(2, x => x.speed(2))'],
    ['sometimesBy, with a transform that leaves time alone', '$: s("bd*2").gain("<0.2 0.8>").sometimesBy(0.5, x => x.speed(2))'],
    // BELOW the parameter: the steps are applied after the fast, at song time.
    ['a time transform on the receiver', '$: s("bd*2").fast(2).gain("<0.2 0.8>")'],
  ])('%s is read', (_label, src) => {
    expect(read(src).map((a) => a.paramKey)).toEqual(['gain'])
  })

  it('an opaque call declines even where it would have been harmless — a missing lane, never a wrong one', () => {
    // `superimpose` parses to an opaque Code. The engine happens to keep the steps
    // (measured), but nothing in the tree says so.
    expect(read('$: s("bd*2").gain("<0.2 0.8>").superimpose(x => x.speed(2))')).toEqual([])
  })
})

describe('steppedAutomations — a visualiser call leaves the steps alone (#1592)', () => {
  // Stave's engine returns the pattern itself for every Strudel visualiser, in both
  // spellings; the browser arm checks the engine plays the same gains with one.
  const PLAIN = '$: s("bd*2").gain("<0.2 0.8>")'

  it.each([
    ['_pianoroll', `${PLAIN}._pianoroll()`],
    ['pianoroll', `${PLAIN}.pianoroll()`],
    ['_scope', `${PLAIN}._scope()`],
    ['scope', `${PLAIN}.scope()`],
    ['_punchcard, with options', `${PLAIN}._punchcard({labels: 1})`],
    ['_spiral', `${PLAIN}._spiral()`],
    ['a visualiser followed by an effect', `${PLAIN}._pianoroll().lpf(400)`],
  ])('%s is read, with the same steps as without it', (_label, src) => {
    const [a] = read(src)
    expect(a?.paramKey).toBe('gain')
    expect(a.steps).toEqual(read(PLAIN)[0].steps)
  })

  it.each([
    // `.viz` chains to Strudel's own `.viz` when one is loaded.
    ['viz(name)', `${PLAIN}.viz("pianoroll")`],
    // The visualiser is above the time change, not instead of it.
    ['a time change under a visualiser', `${PLAIN}.fast(2)._pianoroll()`],
    // One underscore is the inline spelling; a second names nothing the engine installs.
    ['a name that only looks like one', `${PLAIN}.__pianoroll()`],
  ])('%s declines', (_label, src) => {
    expect(read(src)).toEqual([])
  })
})

describe('steppedAutomations — the parsed node must be the whole literal (#1584)', () => {
  // The parser reads each of these as the bare `<0.2 0.8>` and drops the operator;
  // the engine does not (engine test).
  it.each(['<0.2 0.8>/[2]', '<0.2 0.8>/<2 1>', '<0.2 0.8>*<8 16>'])('"%s" declines', (literal) => {
    expect(read(`$: s("bd*2").gain("${literal}")`)).toEqual([])
  })

  it('the CONTROL — whitespace inside the quotes or around the argument is still the whole literal', () => {
    expect(read('$: s("bd*2").gain(" <0.2 0.8> ")').map((a) => a.paramKey)).toEqual(['gain'])
    expect(read('$: s("bd*2").gain( "<0.2 0.8>" )').map((a) => a.paramKey)).toEqual(['gain'])
  })
})

describe('steppedAutomations — a whole-number `/n` stretches every step (#1579)', () => {
  // krill carries `/n` as one `stretch` op of type `slow` on the alternation. The
  // engine test holds each of these against what plays.
  const stepsOf = (src: string) => read(src)[0]?.steps.map((s) => [s.value, s.weight, s.startCycle])

  it('each step holds n times its weight, and the period is the sum', () => {
    const [a] = read('$: s("bd*2").gain("<0.2 0.8>/2")')
    expect(a.periodCycles).toBe(4)
    expect(a.steps.map((s) => [s.value, s.weight, s.startCycle])).toEqual([
      [0.2, 2, 0],
      [0.8, 2, 2],
    ])
    expect(read('$: s("bd*2").gain("<0.2 0.8>/3")')[0].periodCycles).toBe(6)
    expect(stepsOf('$: s("bd*2").gain("<0.2 0.8 0.5>/2")')).toEqual([
      [0.2, 2, 0],
      [0.8, 2, 2],
      [0.5, 2, 4],
    ])
  })

  it('a weighted step holds its weight times n — the weight is cycles held, not the written `@n`', () => {
    const [a] = read('$: s("bd*2").gain("<0.2@2 0.8>/2")')
    expect(a.periodCycles).toBe(6)
    expect(a.steps.map((s) => [s.value, s.weight, s.startCycle])).toEqual([
      [0.2, 4, 0],
      [0.8, 2, 4],
    ])
  })

  it('the value spans are still the numbers, never the operator', () => {
    const src = '$: s("bd*2").gain("<0.2@2 0.8>/2")'
    const [a] = read(src)
    expect(a.steps.map((s) => src.slice(s.valueSpan.start, s.valueSpan.end))).toEqual(['0.2', '0.8'])
  })

  it.each([
    ['spaced', '<0.2 0.8> / 2'],
    ['whitespace inside the quotes', ' <0.2 0.8>/2 '],
    ['a whole number spelled with a decimal', '<0.2 0.8>/2.0'],
    ['a leading zero', '<0.2 0.8>/02'],
  ])('reads %s as `/2`', (_label, literal) => {
    expect(stepsOf(`$: s("bd*2").gain("${literal}")`)).toEqual([
      [0.2, 2, 0],
      [0.8, 2, 2],
    ])
  })

  it('`/1` is the plain alternation', () => {
    expect(stepsOf('$: s("bd*2").gain("<0.2 0.8>/1")')).toEqual([
      [0.2, 1, 0],
      [0.8, 1, 1],
    ])
  })

  it.each([
    // The step changes inside a cycle (engine test).
    ['a fractional n', '<0.2 0.8>/1.5'],
    ['an n below one', '<0.2 0.8>/0.5'],
    // Two ops (the engine plays /4), and a weight on the whole alternation.
    ['two divisions', '<0.2 0.8>/2/2'],
    ['a weight after the division', '<0.2 0.8>/2@3'],
    // A nested group, not the alternation itself — a missing lane, not a wrong one.
    ['a bracketed alternation', '[<0.2 0.8>]/2'],
    // The engine plays nothing for either.
    ['zero', '<0.2 0.8>/0'],
    ['a negative n', '<0.2 0.8>/-2'],
    // Stretched, but still not held values.
    ['a rest step', '<0.2 ~>/2'],
    ['a subdivided step', '<0.2 [0.4 0.8]>/2'],
  ])('%s declines', (_label, literal) => {
    expect(read(`$: s("bd*2").gain("${literal}")`)).toEqual([])
  })

  it('the one-literal and nothing-above rules still hold over a `/n`', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>/2" + "")')).toEqual([])
    expect(read('$: s("bd*2").gain("<0.2 0.8>/2").fast(2)')).toEqual([])
    expect(read('$: s("bd*2").gain("<0.2 0.8>/2").gain(0.5)')).toEqual([])
  })

  it('the step playing in each cycle — two cycles each', () => {
    const [a] = read('$: s("bd*2").gain("<0.2 0.8>/2")')
    expect([0, 1, 2, 3, 4, 5].map((c) => stepIndexAtCycle(a, c))).toEqual([0, 0, 1, 1, 0, 0])
  })

  it('an edit replaces the step\'s number and keeps the `/n`, and reads back with the same period', () => {
    const src = '$: s("bd*2").gain("<0.2 0.8> / 2")'
    const [a] = read(src)
    const next = apply(src, stepValueEdit(a, 1, 0.5)!)
    expect(next).toBe('$: s("bd*2").gain("<0.2 0.5> / 2")')
    const [b] = read(next)
    expect(b.steps.map((s) => [s.value, s.weight, s.startCycle])).toEqual([
      [0.2, 2, 0],
      [0.5, 2, 2],
    ])
  })
})

describe('steppedAutomations — only what the engine plays one value per cycle (#1587)', () => {
  const stepsOf = (literal: string) =>
    read(`$: s("bd*2").gain("${literal}")`)[0]?.steps.map((s) => [s.value, s.weight, s.startCycle])

  // The IR gave each of these a `Cycle` of numeric Plays; krill does not, and the
  // engine test shows what each really plays.
  it.each([
    ['a random choice', '[1|1.5]'],
    ['a random choice, slowed', '[0|0.05|0.1|0.15]/2'],
    ['a bare random choice', '.4:3 | .7:2 | .4:-2'],
    ['two layers', '<1 2 3 4 5 6, 5 4 3 4 2>'],
    ['a colon atom', '<0.2 0.8:1>'],
    ['a chain of colon atoms', '<.1:.5:.5 1 2>'],
    ['a colon atom, slowed', '<0 1:5>/2'],
    ['a bracketed copy', '<[0]!16 [700]!16>'],
    ['a degraded step', '<0.2 0.8?>'],
    // Each of these reaches exactly one guard; the engine test shows what plays.
    ['an alternation followed by another step', '<0.2 0.8> 0.5'],
    ['a polymeter', '{0.2 0.8}'],
    ['a zero weight', '<0.2@0 0.8>'],
  ])('%s declines', (_label, literal) => {
    expect(read(`$: s("bd*2").gain("${literal}")`)).toEqual([])
  })

  it('`a!n` is ONE step held n cycles — the one number the user wrote', () => {
    expect(stepsOf('<0.3!3 0.8>')).toEqual([
      [0.3, 3, 0],
      [0.8, 1, 3],
    ])
    expect(read('$: s("bd*2").gain("<0.3!3 0.8>")')[0].periodCycles).toBe(4)
    expect(stepsOf('<0.3! 0.8>')).toEqual([
      [0.3, 2, 0],
      [0.8, 1, 2],
    ])
  })

  it('a step holds the weight krill gives it, `@` and `!` together', () => {
    // krill folds both into one field, and the engine follows it (engine test).
    expect(stepsOf('<0.2!3@2 0.8>')).toEqual([
      [0.2, 4, 0],
      [0.8, 1, 4],
    ])
    expect(stepsOf('<0.2@2!3 0.8>')).toEqual([
      [0.2, 3, 0],
      [0.8, 1, 3],
    ])
  })

  it('copies compose with `/n`', () => {
    expect(stepsOf('<0!4 4!4>/4')).toEqual([
      [0, 16, 0],
      [4, 16, 16],
    ])
    expect(stepsOf('<.3!3 .4 >/2')).toEqual([
      [0.3, 6, 0],
      [0.4, 2, 6],
    ])
  })

  it('the CONTROL — equal values written separately stay separate steps', () => {
    expect(stepsOf('<0.5 0.5 0.8>')).toEqual([
      [0.5, 1, 0],
      [0.5, 1, 1],
      [0.8, 1, 2],
    ])
  })

  it('an edit to a copied step writes its one number, and the next step is the next index', () => {
    const src = '$: s("bd*2").gain("<0.3!3 0.8>")'
    const [a] = read(src)
    expect(apply(src, stepValueEdit(a, 0, 0.5)!)).toBe('$: s("bd*2").gain("<0.5!3 0.8>")')
    expect(apply(src, stepValueEdit(a, 1, 0.5)!)).toBe('$: s("bd*2").gain("<0.3!3 0.5>")')
  })

  it('a template literal with an interpolation declines', () => {
    expect(read('$: s("bd*2").gain(`<${x} 0.8>`)')).toEqual([])
  })
})

describe('steppedAutomations — an arrangement section counts its own cycles (#1585)', () => {
  // Each read shape has an arm in the engine test checking this prediction against
  // what plays, on an input where the song's own cycle gives a different answer.
  const idx = (a: ReturnType<typeof read>[number], cycles: number) =>
    Array.from({ length: cycles }, (_, c) => stepIndexAtCycle(a, c))

  it('an arrange section plays its steps only in its own bars, by its own count', () => {
    const [a] = read('lead: arrange([3, s("bd*2").gain("<0.2 0.8>")], [1, s("hh*2")])')
    expect(a.placements).toEqual([[{ startCycle: 0, cycles: 3, total: 4 }]])
    // Cycle 4 is the section's fourth cycle — step 1, where the song's cycle says step 0.
    expect(idx(a, 8)).toEqual([0, 1, 0, null, 1, 0, 1, null])
  })

  it('a later section starts its count at its own first bar', () => {
    const [a] = read('lead: arrange([1, s("hh*2")], [2, s("bd*2").gain("<0.2 0.8 0.5>")])')
    expect(a.placements).toEqual([[{ startCycle: 1, cycles: 2, total: 3 }]])
    expect(idx(a, 9)).toEqual([null, 0, 1, null, 2, 0, null, 1, 2])
  })

  it('a negative cycle wraps like a positive one', () => {
    const [a] = read('lead: arrange([3, s("bd*2").gain("<0.2 0.8>")], [1, s("hh*2")])')
    expect([-1, -2].map((c) => stepIndexAtCycle(a, c))).toEqual([stepIndexAtCycle(a, 7), stepIndexAtCycle(a, 6)])
  })

  it('a binding arranged twice is ONE parameter with a placement per appearance, and each restarts', () => {
    const found = read('const a = s("bd*2").gain("<0.2 0.8 0.5>")\nlead: arrange([2, a], [1, s("hh*2")], [2, a])')
    expect(found).toHaveLength(1)
    const [a] = found
    expect(a.placements).toEqual([
      [{ startCycle: 0, cycles: 2, total: 5 }],
      [{ startCycle: 3, cycles: 2, total: 5 }],
    ])
    expect(idx(a, 10)).toEqual([0, 1, null, 0, 1, 2, 0, null, 2, 0])
    // One written number per step: an edit reaches both appearances by construction.
    expect(stepValueEdit(a, 2, 0.9)).toEqual({ range: [a.steps[2].valueSpan.start, a.steps[2].valueSpan.end], text: '0.9' })
  })

  it('the same section written out twice is two parameters, each in its own bars', () => {
    const found = read('lead: arrange([2, s("bd*2").gain("<0.2 0.8 0.5>")], [1, s("hh*2")], [2, s("bd*2").gain("<0.2 0.8 0.5>")])')
    expect(found.map((a) => a.placements)).toEqual([
      [[{ startCycle: 0, cycles: 2, total: 5 }]],
      [[{ startCycle: 3, cycles: 2, total: 5 }]],
    ])
  })

  it('cat and slowcat are sections of one cycle each', () => {
    const [c] = read('$: cat(s("bd*2").gain("<0.2 0.8 0.5>"), s("hh*2"), s("sd*2"))')
    expect(idx(c, 7)).toEqual([0, null, null, 1, null, null, 2])
    const [s] = read('$: slowcat(s("bd*2").gain("<0.2 0.8 0.5>"), s("hh*2"))')
    expect(idx(s, 6)).toEqual([0, null, 1, null, 2, null])
  })

  it('a nested arrangement applies each section in turn, outermost first', () => {
    const [a] = read('$: arrange([2, arrange([1, s("bd*2").gain("<0.2 0.8 0.5>")], [1, s("sd*2")])], [1, s("hh*2")])')
    expect(a.placements).toEqual([[{ startCycle: 0, cycles: 2, total: 3 }, { startCycle: 0, cycles: 1, total: 2 }]])
    expect(idx(a, 9)).toEqual([0, null, null, 1, null, null, 2, null, null])
  })

  it('a section of weight 0 never plays, and moves nothing else', () => {
    const [a] = read('$: arrange([0, s("sd*2")], [3, s("bd*2").gain("<0.2 0.8 0.5>")], [1, s("hh*2")])')
    expect(idx(a, 8)).toEqual([0, 1, 2, null, 0, 1, 2, null])
  })

  it('a parameter outside the arrangement still sees the song cycle', () => {
    const [a] = read('$: arrange([3, s("bd*2")], [1, s("hh*2")]).gain("<0.2 0.8>")')
    expect(a.placements).toEqual([[]])
    expect(idx(a, 4)).toEqual([0, 1, 0, 1])
  })

  it.each([
    ['a fractional weight', '$: arrange([1.5, s("bd*2").gain("<0.2 0.8>")], [0.5, s("hh*2")])'],
    ['weights that sum to 0', '$: arrange([0, s("bd*2").gain("<0.2 0.8>")])'],
    ['a negative weight', '$: arrange([-1, s("sd*2")], [3, s("bd*2").gain("<0.2 0.8 0.5>")], [1, s("hh*2")])'],
    ['a time transform inside the section', '$: arrange([3, s("bd*2").gain("<0.2 0.8>").fast(2)], [1, s("hh*2")])'],
    // Two routes that do not part at the arms of one arrangement can overlap.
    ['a route inside a section and one outside it', 'const a = s("bd*2").gain("<0.2 0.8 0.5>")\n$: stack(a, arrange([1, a], [1, s("hh*2")]))'],
    ['one binding in two arrangements side by side', 'const a = s("bd*2").gain("<0.2 0.8 0.5>")\n$: stack(arrange([1, a], [1, s("hh*2")]), arrange([1, s("sd*2")], [2, a]))'],
  ])('%s declines', (_label, src) => {
    expect(read(src)).toEqual([])
  })
})

describe('steppedAutomations — a whole-track time change that keeps each bar on one step is applied (#1595)', () => {
  const idx = (a: SteppedAutomation, n: number) => Array.from({ length: n }, (_, c) => stepIndexAtCycle(a, c))
  // The same automation with its time steps composed in the OTHER order — the
  // rival an arm must tell apart from the reader, or it confirms nothing.
  const reversed = (a: SteppedAutomation): SteppedAutomation => ({ ...a, placements: a.placements.map((p) => [...p].reverse()) })

  it.each([
    ['a slow by a whole number', '$: s("bd*2").gain("<0.2 0.8>").slow(2)', [0, 0, 1, 1, 0, 0, 1, 1]],
    ['a fast by the inverse of a whole number', '$: s("bd*2").gain("<0.2 0.8>").fast(0.5)', [0, 0, 1, 1, 0, 0, 1, 1]],
    ['a shift by a whole cycle', '$: s("bd*2").gain("<0.2 0.8>").late(1)', [1, 0, 1, 0, 1, 0, 1, 0]],
    ['a slow over a `/n`', '$: s("bd*2").gain("<0.2 0.8>/2").slow(2)', [0, 0, 0, 0, 1, 1, 1, 1]],
    ['a slow under a visualiser', '$: s("bd*2").gain("<0.2 0.8>").slow(2)._pianoroll()', [0, 0, 1, 1, 0, 0, 1, 1]],
    ['a slow over a shift, applied outermost first', '$: s("bd*2").gain("<0.2 0.8>").late(1).slow(2)', [1, 1, 0, 0, 1, 1, 0, 0]],
  ])('%s', (_label, src, expected) => {
    const [a] = read(src)
    expect(a?.paramKey, 'the reader declined').toBe('gain')
    expect(idx(a, 8)).toEqual(expected)
  })

  it('records the time step on the route, outermost first', () => {
    expect(read('$: s("bd*2").gain("<0.2 0.8>").late(1).slow(2)')[0].placements).toEqual([
      [{ times: 1, per: 2, shift: 0 }, { times: 1, per: 1, shift: -1 }],
    ])
  })

  it('the order matters — the reversed composition gives other steps on these inputs', () => {
    const [a] = read('$: s("bd*2").gain("<0.2 0.8>").late(1).slow(2)')
    expect(idx(reversed(a), 8)).not.toEqual(idx(a, 8))
  })

  it('a slow inside a section counts the section\'s cycles first, then slows them', () => {
    const [a] = read('$: arrange([3, s("bd*2").gain("<0.2 0.8>").slow(2)], [1, s("hh*2")])')
    expect(a.placements).toEqual([[{ startCycle: 0, cycles: 3, total: 4 }, { times: 1, per: 2, shift: 0 }]])
    expect(idx(a, 8)).toEqual([0, 0, 1, null, 1, 0, 0, null])
    expect(idx(reversed(a), 8)).not.toEqual(idx(a, 8))
  })

  it.each([
    // Each of these changes the step partway through a bar (engine test).
    ['a slow by a fraction', '$: s("bd*2").gain("<0.2 0.8>").slow(1.5)'],
    ['a shift by part of a cycle', '$: s("bd*2").gain("<0.2 0.8>").late(0.5)'],
    // The engine plays nothing for either.
    ['a slow by 0', '$: s("bd*2").gain("<0.2 0.8>").slow(0)'],
    ['a fast by 0', '$: s("bd*2").gain("<0.2 0.8>").fast(0)'],
  ])('%s declines', (_label, src) => {
    expect(read(src)).toEqual([])
  })
})

describe('stepIndexAtCycle — the engine\'s own selection', () => {
  const [plain] = read('$: s("bd*2").gain("<0.2 0.8>")')
  const [weighted] = read('$: s("bd*2").gain("<0.2@2 0.8>")')

  it('rotates by absolute cycle', () => {
    expect([0, 1, 2, 3].map((c) => stepIndexAtCycle(plain, c))).toEqual([0, 1, 0, 1])
  })

  it('holds a weighted step for its weight — the probe\'s 0.2 0.2 0.8 pattern', () => {
    expect([0, 1, 2, 3, 4, 5].map((c) => stepIndexAtCycle(weighted, c))).toEqual([0, 0, 1, 0, 0, 1])
  })

  it('reads a fractional cycle as the cycle it is inside, and wraps negatives', () => {
    expect(stepIndexAtCycle(plain, 1.75)).toBe(1)
    expect(stepIndexAtCycle(plain, -1)).toBe(1)
  })
})

describe('stepValueEdit — replaces one number and no other byte', () => {
  it('rewrites only the chosen step', () => {
    const src = '$: s("bd*2").gain("<0.2 0.8>")'
    const [a] = read(src)
    const e = stepValueEdit(a, 1, 0.5)
    expect(e).not.toBeNull()
    expect(apply(src, e!)).toBe('$: s("bd*2").gain("<0.2 0.5>")')
  })

  it('keeps the weight, and the user\'s spelling of every other step', () => {
    const src = '$: s("bd*2").gain("<.20@2  0.8>")'
    const [a] = read(src)
    expect(apply(src, stepValueEdit(a, 0, 0.3)!)).toBe('$: s("bd*2").gain("<0.3@2  0.8>")')
  })

  it('the edited document reads back with the new value and the same shape', () => {
    const src = '$: s("bd*2").velocity("<.2 .8 .5>").room(0.3)'
    const [a] = read(src)
    const next = apply(src, stepValueEdit(a, 2, 0.9)!)
    const [b] = read(next)
    expect(b.steps.map((s) => [s.value, s.weight])).toEqual([[0.2, 1], [0.8, 1], [0.9, 1]])
    expect(b.periodCycles).toBe(a.periodCycles)
  })

  it('writes nothing for an unchanged value (compared as numbers), a bad index or a non-finite value', () => {
    const [a] = read('$: s("bd*2").gain("<0.30 0.8>")')
    expect(stepValueEdit(a, 0, 0.3)).toBeNull()
    expect(stepValueEdit(a, 5, 0.3)).toBeNull()
    expect(stepValueEdit(a, 0, Number.NaN)).toBeNull()
    expect(stepValueEdit(a, 0, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('writes nothing it could not read back — an exponent spelling would drop the lane', () => {
    const src = '$: s("bd*2").gain("<0.2 0.8>")'
    const [a] = read(src)
    // The CONTROL first: the reader does read an ordinary edit back, so the refusal
    // below is about the spelling, not about any edit at all.
    expect(read(apply(src, stepValueEdit(a, 0, 0.5)!))).toHaveLength(1)
    // `String` spells these in exponent form, and the reader declines them.
    expect(String(1e21)).toBe('1e+21')
    expect(String(1e-7)).toBe('1e-7')
    expect(stepValueEdit(a, 0, 1e21)).toBeNull()
    expect(stepValueEdit(a, 0, 1e-7)).toBeNull()
    // Negative and whole numbers stay plain decimals and are written.
    expect(stepValueEdit(a, 0, -2)?.text).toBe('-2')
    expect(stepValueEdit(a, 0, 3)?.text).toBe('3')
  })
})

describe('stepTextEdit — what typed text may become (#1463 Stage 3, moved by #1918)', () => {
  const src = '$: s("bd*2").gain("<0.2 0.8>")'
  const [a] = read(src)

  it('a typed number, spaces and all, writes that step', () => {
    expect(apply(src, stepTextEdit(a, 1, ' 0.4 ')!)).toBe('$: s("bd*2").gain("<0.2 0.4>")')
  })

  it('an empty or blank entry writes nothing — `Number(\'\')` is 0, not NaN', () => {
    expect(Number('')).toBe(0)
    expect(stepTextEdit(a, 0, '')).toBeNull()
    expect(stepTextEdit(a, 0, '   ')).toBeNull()
  })

  it('a non-numeric entry writes nothing', () => {
    expect(stepTextEdit(a, 0, 'loud')).toBeNull()
    expect(stepTextEdit(a, 0, 'Infinity')).toBeNull()
  })

  it('then the value rules apply: the number the step already holds writes nothing', () => {
    expect(stepTextEdit(a, 1, '0.80')).toBeNull()
  })
})
