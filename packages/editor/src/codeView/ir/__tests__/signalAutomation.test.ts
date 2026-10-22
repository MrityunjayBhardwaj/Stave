/**
 * Continuous automation read off the static IR (#1464 Stage 1).
 *
 * ⚠ EVERY case here goes through the REAL parser rather than a hand-built node.
 * The shapes this module reads (`Param.value` → `Range`/`Slow`/`Fast` → `Signal`)
 * were only just introduced by #1478/#1482, and a hand-written fixture would pin
 * this module against my belief about them instead of against what the parser
 * emits. Observed before these were written: `.gain(sine.add(saw))` does NOT
 * produce an `Add` node, it produces `Code{via:{method:'add', inner:Signal}}` —
 * which is exactly the case the abstention rule exists for, and a fixture would
 * have got it wrong.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel, CHAIN_ROOT_RECOGNISER } from '../parseStrudel'
import { signalAutomations, signalCarryingParamKeys, signalTimeAt, signalWriters, hasTruePeriod } from '../signalAutomation'

const read = (src: string) => signalAutomations(parseStrudel(src) as never)

describe('signalAutomations — the three legs #1464 names', () => {
  it('reads shape, rate and range off one nested node', () => {
    expect(read('$: s("bd*4").cutoff(saw.slow(4).range(200, 2000))')).toEqual([
      {
        trackId: 'd1', paramKey: 'cutoff', kind: 'saw', periodCycles: 4, lanePeriodCycles: 4,
        lo: 200, hi: 2000, ranged: true, boundsAsWritten: true, offset: expect.any(Number),
        spans: {
          shape: { start: expect.any(Number), end: expect.any(Number) },
          rate: { start: expect.any(Number), end: expect.any(Number) },
          range: { start: expect.any(Number), end: expect.any(Number) },
          chainEnd: expect.any(Number),
        },
        // Under no section: one route, through none (#1590).
        placements: [[]],
      },
    ])
  })

  it('reads a bare signal with no transform at all — rate 1, natural range', () => {
    const [a] = read('$: s("bd*4").gain(sine)')
    expect(a).toMatchObject({ paramKey: 'gain', kind: 'sine', periodCycles: 1, lo: 0, hi: 1, ranged: false })
  })

  it('.fast(n) SHORTENS the period; .slow(n) lengthens it', () => {
    expect(read('$: s("bd*4").gain(sine.fast(2).range(0, 1))')[0].periodCycles).toBe(0.5)
    expect(read('$: s("bd*4").gain(sine.slow(8).range(0, 1))')[0].periodCycles).toBe(8)
  })

  it('composes several rate transforms multiplicatively', () => {
    expect(read('$: s("bd*4").gain(sine.slow(4).fast(2).range(0, 1))')[0].periodCycles).toBe(2)
  })
})

describe('signalAutomations — only where the curve is handed a time a lane can draw (#1590)', () => {
  // Each shape has an arm in `signalAutomation.engine.test.ts`: the declined ones
  // play something other than the song-time curve, the read ones play exactly it.
  const CURVE = '$: s("bd*8").gain(saw.slow(3))'

  it.each([
    // `.slow` and `.fast` are applied now (#1595); `.early` is an opaque call.
    ['early', `${CURVE}.early(0.5)`],
    ['a slow by 0', `${CURVE}.slow(0)`],
    ['a fast by 0', `${CURVE}.fast(0)`],
    // Each route alone is one the lane could draw; together they play two values
    // at once, and only route disjointness declines them.
    ['jux, with a fast', `${CURVE}.jux(x => x.fast(2))`],
    // Hands the curve negative time before bar `o`, where the engine's `t % 1`
    // plays a saw below its floor (engine test) and a lane would draw it wrapped.
    ['a later shift', `${CURVE}.late(0.5)`],
    ['a patterned slow', `${CURVE}.slow("<2 4>")`],
    ['off, which plays the curve twice at once', `${CURVE}.off(0.25, x => x.speed(2))`],
    ['cpm', `${CURVE}.cpm(120)`],
    ['every, with a time transform', `${CURVE}.every(2, x => x.fast(2))`],
    ['jux, with a time transform', `${CURVE}.jux(x => x.late(.25))`],
    ['a same-key call above it', `${CURVE}.gain(0.5)`],
  ])('%s declines', (_label, src) => {
    expect(read(src)).toEqual([])
  })

  it.each([
    ['stack', '$: stack(s("bd*8").gain(saw.slow(3)), s("hh*8"))'],
    ['mask', `${CURVE}.mask("<1 [1 0]>")`],
    ['a visualiser', `${CURVE}._pianoroll()`],
    // BELOW the parameter: the curve is applied after the fast, at song time.
    ['a time transform on the receiver', '$: s("bd*8").fast(2).gain(saw.slow(3))'],
  ])('%s is read, under no section', (_label, src) => {
    const [a] = read(src)
    expect(a?.paramKey).toBe('gain')
    expect(a.placements).toEqual([[]])
  })

  it('a curve inside an arrangement section carries that section', () => {
    const [a] = read('$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])')
    expect(a.placements).toEqual([[{ startCycle: 1, cycles: 3, total: 4 }]])
  })

  it('cat gives each arm one cycle of a pass', () => {
    const [a] = read('$: cat(s("hh*8"), s("bd*8").gain(saw.slow(3)))')
    expect(a.placements).toEqual([[{ startCycle: 1, cycles: 1, total: 2 }]])
  })
})

describe('signalAutomations — a whole-track time change is applied, not declined (#1595)', () => {
  const CURVE = '$: s("bd*8").gain(saw.slow(3))'

  it.each([
    ['slow', `${CURVE}.slow(2)`, [{ times: 1, per: 2, shift: 0 }], [0, 0.5, 3], [0, 0.25, 1.5]],
    ['fast', `${CURVE}.fast(2)`, [{ times: 2, per: 1, shift: 0 }], [0, 0.5, 3], [0, 1, 6]],
    ['an earlier shift', `${CURVE}.late(-0.5)`, [{ times: 1, per: 1, shift: 0.5 }], [0, 0.5, 3], [0.5, 1, 3.5]],
    ['a slow under a visualiser', `${CURVE}.slow(2)._scope()`, [{ times: 1, per: 2, shift: 0 }], [1], [0.5]],
  ])('%s', (_label, src, steps, times, handed) => {
    const [a] = read(src)
    expect(a?.paramKey, 'the reader declined').toBe('gain')
    expect(a.periodCycles, 'the signal\'s own rate is unchanged').toBe(3)
    expect(a.placements).toEqual([steps])
    expect(times.map((t) => signalTimeAt(a, t))).toEqual(handed)
  })

  it('composes outermost first, around a section', () => {
    const [a] = read('$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))]).slow(2)')
    expect(a.placements).toEqual([[{ times: 1, per: 2, shift: 0 }, { startCycle: 1, cycles: 3, total: 4 }]])
    // Song time 3 is slowed time 1.5 → bar 1 of the pass → the section's cycle 0.
    // Song time 8.5 is slowed 4.25 → bar 0 of the second pass, the hh section.
    expect([0.5, 2.5, 3, 8.5, 10.5].map((t) => signalTimeAt(a, t))).toEqual([null, 0.25, 0.5, null, 3.25])
  })
})

describe('signalAutomations — the period the LANE shows (#1464 Stage 3)', () => {
  const CURVE = '$: s("bd*8").gain(saw.slow(3))'

  it.each([
    ['no time change', CURVE, 3],
    ['a whole-track slow multiplies it', `${CURVE}.slow(2)`, 6],
    ['a whole-track fast divides it', `${CURVE}.fast(2)`, 1.5],
    ['a shift moves where it starts, not how long it takes', `${CURVE}.late(-0.5)`, 3],
    ['a section plays its own cycles one bar to a bar', '$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])', 3],
    ['a slow around a section still multiplies it', '$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))]).slow(2)', 6],
  ])('%s', (_label, src, bars) => {
    const [a] = read(src)
    expect(a?.paramKey, 'the reader declined').toBe('gain')
    expect(a.periodCycles, 'the signal\'s own rate is unchanged').toBe(3)
    expect(a.lanePeriodCycles).toBe(bars)
  })

  it('agrees across routes that agree, and is null across routes that do not', () => {
    const same = read('const a = s("bd*8").gain(saw.slow(3))\n$: arrange([1, a], [1, s("hh*8")], [1, a])')
    expect(same[0]?.placements.length, 'the fixture must reach the curve twice').toBe(2)
    expect(same[0].lanePeriodCycles).toBe(3)
    const differ = read('const a = s("bd*8").gain(saw.slow(3))\n$: arrange([1, a.slow(2)], [1, s("hh*8")], [1, a])')
    expect(differ[0]?.placements.length, 'the fixture must reach the curve twice').toBe(2)
    expect(differ[0].lanePeriodCycles).toBeNull()
  })
})

describe('signalTimeAt — the time a curve is handed (#1590)', () => {
  it('is the song time itself under no section', () => {
    const [a] = read('$: s("bd*8").gain(saw.slow(3))')
    expect([0, 1.25, 5.5].map((t) => signalTimeAt(a, t))).toEqual([0, 1.25, 5.5])
  })

  it('counts the section\'s own cycles, keeps the fraction, and is null where the section is silent', () => {
    const [a] = read('$: arrange([1, s("hh*8")], [3, s("bd*8").gain(saw.slow(3))])')
    // Pass 0: bar 0 is the hh section; bars 1-3 are the section's cycles 0-2.
    // Pass 1: bar 4 is hh again; bar 5 is the section's cycle 3, not 5.
    expect([0.5, 1.5, 3.25, 4.9, 5, 5.75].map((t) => signalTimeAt(a, t))).toEqual([null, 0.5, 2.25, null, 3, 3.75])
  })
})

describe('signalAutomations — natural range comes from the signal, not a guess', () => {
  // Grounded in @strudel/core@1.2.6/signal.mjs: the `2`-suffixed kinds are
  // literally `x.toBipolar()`; the unsuffixed ones are unipolar.
  it('a unipolar signal spans 0..1', () => {
    expect(read('$: s("bd*4").pan(perlin)')[0]).toMatchObject({ lo: 0, hi: 1, ranged: false })
  })

  it('a bipolar `2`-suffixed signal spans -1..1', () => {
    expect(read('$: s("bd*4").pan(sine2)')[0]).toMatchObject({ kind: 'sine2', lo: -1, hi: 1, ranged: false })
  })

  it('an explicit .range() replaces the natural one, and says so', () => {
    expect(read('$: s("bd*4").pan(sine.range(0.2, 0.8))')[0]).toMatchObject({ lo: 0.2, hi: 0.8, ranged: true, boundsAsWritten: true })
  })

  // #1610 — `range` is `mul(hi − lo).add(lo)` over what enters it (`pattern.mjs:1771`),
  // so its arguments are its output only when that input runs 0..1. The engine arm in
  // `signalAutomation.engine.test.ts` is the authority for every number below.
  it('a bipolar signal under a range plays 2·lo − hi..hi, and a typed bound would not read back', () => {
    expect(read('$: s("bd*4").cutoff(sine2.range(200, 2000))')[0]).toMatchObject({ lo: -1600, hi: 2000, ranged: true, boundsAsWritten: false })
    expect(read('$: s("bd*4").pan(sine2.range(0, 1))')[0]).toMatchObject({ lo: -1, hi: 1, boundsAsWritten: false })
    // Control: the same range on the unipolar spelling is its own arguments.
    expect(read('$: s("bd*4").cutoff(sine.range(200, 2000))')[0]).toMatchObject({ lo: 200, hi: 2000, boundsAsWritten: true })
  })

  it('a bipolar signal with no range offers no bound either: an inserted range would meet −1..1', () => {
    expect(read('$: s("bd*4").pan(sine2)')[0]).toMatchObject({ lo: -1, hi: 1, ranged: false, boundsAsWritten: false })
    expect(read('$: s("bd*4").pan(sine)')[0]).toMatchObject({ lo: 0, hi: 1, ranged: false, boundsAsWritten: true })
  })

  it('ranges COMPOSE: the outer one maps what the inner one plays', () => {
    // An inner 0..1 leaves the outer pair as what plays — descent order is application order reversed.
    expect(read('$: s("bd*4").pan(sine.range(0, 1).range(2, 3))')[0]).toMatchObject({ lo: 2, hi: 3, boundsAsWritten: true })
    // An inner 0..2 stretches it to 2..4, and typing into the outer range would not read back.
    expect(read('$: s("bd*4").pan(sine.range(0, 2).range(2, 3))')[0]).toMatchObject({ lo: 2, hi: 4, boundsAsWritten: false })
  })

  it('where the arguments are the bounds, it reports EXACTLY the numbers written', () => {
    // `lo + t·(hi − lo)` gives 0.30000000000000004 for `.range(0.1, 0.3)`, and `captionEdit`
    // writes the untouched bound from this number. Swept, because float noise is not found by reading.
    const xs = [0, 0.1, 0.2, 0.3, 0.7, 1, 1.5, 3, 200, 2000, -0.3, -1]
    for (const lo of xs) {
      for (const hi of xs) {
        if (lo === hi) continue
        const [a] = read(`$: s("bd*4").pan(sine.range(${lo}, ${hi}))`)
        expect([a.lo, a.hi], `range(${lo}, ${hi})`).toEqual([lo, hi])
      }
    }
  })
})

describe('signalAutomations — it abstains rather than drawing something wrong', () => {
  it('declines an expression it cannot plot in closed form', () => {
    // Parses to Code{via:{method:'add'}} — observed, not assumed.
    expect(read('$: s("bd*4").gain(sine.add(saw))')).toEqual([])
  })

  it('declines an UNBOUNDED signal that has no range to draw between', () => {
    // `time` is signal(id) and grows without limit (signal.mjs:155). Drawing it
    // as 0..1 would be a confident lie about what the document does.
    expect(read('$: s("bd*4").cutoff(time)')).toEqual([])
  })

  it('and declines it UNDER a range too: a range scales an unbounded signal, it does not bound it (#1614)', () => {
    // `time.range(200, 800)` plays 200..9762.5 over 16 cycles (the engine arm), so its
    // arguments are no ceiling, and a lane drawing them would show a saw the engine never plays.
    for (const k of ['time', 'cyclesPer', 'per', 'perCycle', 'perx']) {
      const src = `$: s("bd*4").cutoff(${k}.range(200, 800))`
      expect(read(src), src).toEqual([])
    }
    expect(read('$: s("bd*4").cutoff(time.slow(4).range(0, 1).range(200, 800))')).toEqual([])
    // Control: the same chain on a bounded signal is read.
    expect(read('$: s("bd*4").cutoff(saw.range(200, 800))')[0]).toMatchObject({ kind: 'saw', lo: 200, hi: 800 })
  })

  it('but names it as a WRITER of its control, ranged or not (#1614)', () => {
    const writers = (src: string) =>
      signalWriters(parseStrudel(src) as never).map((w) => `${w.trackId}.${w.paramKey}:${w.kind}`).sort()
    expect(writers('$: s("bd*4").cutoff(time.range(200, 800)).gain(time).pan(sine)'))
      .toEqual(['d1.cutoff:time', 'd1.gain:time', 'd1.pan:sine'])
    // What the drawing reader declines for any OTHER reason is no writer here either.
    expect(writers('$: s("bd*4").gain(sine.add(saw))')).toEqual([])
  })

  it('leaves a plain scalar parameter alone', () => {
    expect(read('$: s("bd*4").gain(0.8)')).toEqual([])
  })

  it('is empty for a document with no automation at all', () => {
    expect(read('$: s("bd sd hh")')).toEqual([])
  })
})

describe('signalAutomations — attribution', () => {
  it('attributes each automation to the track that declares it', () => {
    const out = read('$: s("bd*4").cutoff(saw.range(1, 2))\n$: s("hh*8").pan(sine)')
    expect(out.map((a) => [a.trackId, a.paramKey])).toEqual([
      ['d1', 'cutoff'],
      ['d2', 'pan'],
    ])
  })

  it('finds several automated parameters on one track', () => {
    const out = read('$: s("bd*4").cutoff(saw.range(1, 2)).pan(sine).gain(perlin)')
    expect(out.map((a) => a.paramKey).sort()).toEqual(['cutoff', 'gain', 'pan'])
  })

  it('carries a source offset that lands inside the document', () => {
    const src = '$: s("bd*4").cutoff(saw.range(200, 2000))'
    const [a] = read(src)
    expect(a.offset).not.toBeNull()
    expect(a.offset as number).toBeGreaterThanOrEqual(0)
    expect(a.offset as number).toBeLessThan(src.length)
  })

  it('returns nothing for a null IR rather than throwing', () => {
    expect(signalAutomations(null)).toEqual([])
    expect(signalAutomations(undefined)).toEqual([])
  })
})

describe('signalAutomations — WHERE each leg is written (#1464 Stage 2)', () => {
  /** Slice the source with a span. This is the whole contract: what comes back
   *  is the text a control replaces, so an off-by-one is visible as a wrong
   *  string rather than as a number nobody can check by eye. */
  const slice = (src: string, span: { start: number; end: number } | null): string | null =>
    span ? src.slice(span.start, span.end) : null

  it('every leg of a fully spelled chain slices back to its own call', () => {
    const src = '$: s("bd*4").cutoff(saw.slow(4).range(200,2000))'
    const [a] = read(src)
    expect(slice(src, a.spans.shape)).toBe('saw')
    expect(slice(src, a.spans.rate)).toBe('.slow(4)')
    expect(slice(src, a.spans.range)).toBe('.range(200,2000)')
  })

  it('an unspelled leg is null, and `chainEnd` is where its call would go', () => {
    const src = '$: s("bd*4").gain(sine)'
    const [a] = read(src)
    expect(slice(src, a.spans.shape)).toBe('sine')
    expect(a.spans.rate).toBeNull()
    expect(a.spans.range).toBeNull()

    // The decisive check: splicing at `chainEnd` produces the document the
    // control means to write, and re-reading it yields the asked-for range.
    const edited = src.slice(0, a.spans.chainEnd as number) + '.range(0.2,0.8)' + src.slice(a.spans.chainEnd as number)
    expect(edited).toBe('$: s("bd*4").gain(sine.range(0.2,0.8))')
    expect(read(edited)[0]).toMatchObject({ lo: 0.2, hi: 0.8, ranged: true })
  })

  it('`chainEnd` sits past the OUTERMOST arm, not past the signal', () => {
    const src = '$: s("bd*4").gain(sine.range(0,1))'
    const [a] = read(src)
    const edited = src.slice(0, a.spans.chainEnd as number) + '.slow(4)' + src.slice(a.spans.chainEnd as number)
    expect(edited).toBe('$: s("bd*4").gain(sine.range(0,1).slow(4))')
    expect(read(edited)[0]).toMatchObject({ periodCycles: 4, lo: 0, hi: 1 })
  })

  it('the range span is the one whose bounds WON, not the one it supersedes', () => {
    // `readChain` adopts the outermost `.range()`; an inner one is already dead
    // in the document, and editing it would change nothing the lane draws.
    const src = '$: s("bd*4").gain(sine.range(0,1).range(0.2,0.4))'
    const [a] = read(src)
    expect(a).toMatchObject({ lo: 0.2, hi: 0.4 })
    expect(slice(src, a.spans.range)).toBe('.range(0.2,0.4)')
  })

  it('counts ARMS, not spans: two arms where only one is located is still null', () => {
    // ⚠ THE ONE HAND-BUILT NODE IN THIS FILE, and the exception is the point.
    // Every other case goes through the real parser because a fixture would pin
    // this module against a belief about the IR. This tree is different: the
    // parser attaches a source range to every rate arm it builds, so it CANNOT
    // produce the shape the guard exists for. Testing it needs the shape made by
    // hand or not at all, and "not at all" means the guard is unexercised.
    const ir = parseStrudel('$: s("bd*4").gain(sine.slow(4).fast(2).range(0,1))') as never
    const [reference] = signalAutomations(ir)
    expect(reference.spans.rate).toBeNull() // both arms located — already null

    // Now the same chain with the INNER arm's range stripped.
    const stripped = JSON.parse(JSON.stringify(ir), (k, v) => v) as never
    // ⚠ BY FACTOR, not by tag. `s("bd*4")` also parses to a `Fast`, on the
    // PATTERN rather than in the signal chain — stripping that one changes
    // nothing this reader looks at, and an earlier version of this test did
    // exactly that and passed against the unfixed code. The signal's arm is the
    // `.fast(2)`.
    const dropRateLocByFactor = (node: unknown, factor: number): boolean => {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some((c) => dropRateLocByFactor(c, factor))
      const n = node as Record<string, unknown>
      if ((n.tag === 'Fast' || n.tag === 'Slow') && n.factor === factor && n.loc) {
        delete n.loc
        return true
      }
      return Object.entries(n).some(([k, v]) => k !== 'loc' && dropRateLocByFactor(v, factor))
    }
    expect(dropRateLocByFactor(stripped, 2), 'the fixture did not strip the signal\'s rate arm').toBe(true)
    const [a] = signalAutomations(stripped)
    expect(a.periodCycles).toBe(2)      // still two arms composing
    expect(a.spans.rate).toBeNull()     // and still nowhere honest to write
  })

  it('TWO rate arms leave the rate span null — a defined rate with no place to write it', () => {
    const src = '$: s("bd*4").gain(sine.slow(4).fast(2).range(0,1))'
    const [a] = read(src)
    expect(a.periodCycles).toBe(2)            // the rate is perfectly well defined
    expect(a.spans.rate).toBeNull()           // and yet there is nowhere to set it
    // A control must not pick an arm: writing `.slow(2)` here would give the
    // right rate while silently deleting the user's `.fast(2)` intent.
  })

  it('replacing a span in place changes only that leg — a real round-trip', () => {
    const src = '$: s("bd*4").cutoff(saw.slow(4).range(200,2000))'
    const [a] = read(src)
    const span = a.spans.range as { start: number; end: number }
    const edited = src.slice(0, span.start) + '.range(300,3000)' + src.slice(span.end)
    expect(edited).toBe('$: s("bd*4").cutoff(saw.slow(4).range(300,3000))')

    const [b] = read(edited)
    // The edited leg moved; every other leg is byte-identically what it was.
    expect(b).toMatchObject({ lo: 300, hi: 3000, kind: 'saw', periodCycles: 4, paramKey: 'cutoff' })
  })
})

describe('signalCarryingParamKeys — the broader question (#1465)', () => {
  const keys = (src: string) => [...signalCarryingParamKeys(parseStrudel(src) as never)].sort()

  it('names the key of a plainly automated control', () => {
    expect(keys('$: s("bd*4").cutoff(saw.slow(4).range(200, 2000))')).toEqual(['cutoff'])
  })

  it('⚠ names a control the DRAWING reader declines — the whole reason it exists', () => {
    // `.add()` has no closed form, so nothing can be plotted. But the control
    // still moves, so the cycle fingerprint must know about it.
    const src = '$: s("bd*4").gain(sine.add(saw))'
    expect(signalAutomations(parseStrudel(src) as never)).toEqual([])
    expect(keys(src)).toEqual(['gain'])
  })

  it('names an UNBOUNDED signal the drawing reader abstains on', () => {
    const src = '$: s("bd*4").cutoff(time)'
    expect(signalAutomations(parseStrudel(src) as never)).toEqual([])
    expect(keys(src)).toEqual(['cutoff'])
  })

  it('names every automated control across every track, deduplicated', () => {
    expect(keys('$: s("bd*4").cutoff(saw).pan(sine)\n$: s("hh*8").cutoff(perlin).gain(0.5)'))
      .toEqual(['cutoff', 'pan'])
  })

  it('says nothing about a constant parameter', () => {
    expect(keys('$: s("bd*4").cutoff(800).gain(0.5)')).toEqual([])
  })

  it('is empty for a document with no automation, and for no document', () => {
    expect(keys('$: s("bd sd")')).toEqual([])
    expect([...signalCarryingParamKeys(null)]).toEqual([])
    expect([...signalCarryingParamKeys(undefined)]).toEqual([])
  })

  it('reaches a signal nested behind an opaque wrapper', () => {
    // `.segment()` opaques the expression, but the signal is still in there and
    // the control still moves. A reader that stopped at the opaque node would
    // under-report exactly the documents this issue is about.
    expect(keys('$: s("bd*4").pan(perlin.range(0,1).segment(8))')).toEqual(['pan'])
  })
})

describe('hasTruePeriod — which signals a period can be folded with (#1465)', () => {
  it('says yes to the waveform family, in both polarities', () => {
    for (const k of ['sine', 'cosine', 'saw', 'isaw', 'tri', 'itri', 'square'] as const) {
      expect(hasTruePeriod(k), k).toBe(true)
      expect(hasTruePeriod(`${k}2` as never), `${k}2`).toBe(true)
    }
  })

  it('says no to everything that never comes back', () => {
    // Noise and unbounded input. Folding a song's period with one of these would
    // hand it a definite length its audio does not have — the failure mode the
    // allowlist spelling exists to make impossible.
    for (const k of ['rand', 'rand2', 'brand', 'perlin', 'berlin', 'time',
                     'mousex', 'mousey', 'mouseX', 'mouseY',
                     'cyclesPer', 'per', 'perCycle', 'perx'] as const) {
      expect(hasTruePeriod(k), k).toBe(false)
    }
  })

  it('defaults an UNKNOWN kind to not-periodic, which is the safe direction', () => {
    // A kind added to `PatternIR` later and forgotten in the allowlist costs a
    // fold — the period stays the structural one, which is what production
    // already answers. The denylist spelling would instead fold it as though it
    // repeated. One under-promises; the other lies.
    expect(hasTruePeriod('somethingAddedLater' as never)).toBe(false)
  })
})

describe('every kind the parser recognises has its polarity written out (#1494)', () => {
  // The rule the table replaced, restated so the two spellings check each other: no
  // natural range → unbounded; the `2`-suffixed spelling → bipolar; otherwise unipolar.
  const UNBOUNDED = new Set(['time', 'cyclesPer', 'per', 'perCycle', 'perx'])
  const kinds = [...CHAIN_ROOT_RECOGNISER.values()].flatMap((d) => (d.tag === 'Signal' ? [d.kind] : []))

  it('checks all 28 of them', () => {
    expect(new Set(kinds).size).toBe(28)
  })

  it('reads each natural range as that rule says, and declines the unbounded ones', () => {
    for (const kind of kinds) {
      const got = read(`$: s("bd*4").pan(${kind})`)
      if (UNBOUNDED.has(kind)) {
        expect(got, kind).toEqual([])
      } else {
        expect(got, kind).toHaveLength(1)
        expect(got[0], kind).toMatchObject({ kind, lo: kind.endsWith('2') ? -1 : 0, hi: 1, ranged: false })
      }
    }
  })
})
