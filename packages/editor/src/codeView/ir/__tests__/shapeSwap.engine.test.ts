/**
 * #1611 — the AUTHORITY arms for the shape menu's cross-class preview: the song a swap
 * is previewed to give, against the analysis of the swapped SOURCE evaluated by the
 * real transpiler. Setup mirrors `stepCount.engine.test.ts`: a document parsed whole (so
 * its track ids are `d1`, `d2`) and evaluated track by track under those ids — the
 * shape production collects.
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import { analyzeSong, previewShapeSwap, signalDimensionsOf, type SongAnalysis } from '../songAnalysis'
import { signalAutomations, crossClassShapes, type SignalKind } from '../signalAutomation'
import { normalizeStrudelHap } from '../../../engine/NormalizedHap'
import { clearStringParser, installMiniStringParser } from '../../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function evaluate(tracks: Record<string, string>): Promise<Record<string, any>> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out: Record<string, any> = {}
    for (const [id, code] of Object.entries(tracks)) {
      const r = await core.evaluate(code, transpiler)
      out[id] = r.pattern ?? r
    }
    return out
  } finally {
    clearStringParser({ core })
  }
}

function collectorFor(patterns: Record<string, any>) {
  return (start: number, end: number): IREvent[] => {
    const out: IREvent[] = []
    for (const [trackId, pat] of Object.entries(patterns)) {
      for (const hap of pat.queryArc(start, end)) {
        if (!(hap.hasOnset?.() ?? true)) continue
        const ev = normalizeStrudelHap(hap, trackId)
        if (Math.floor(ev.begin) >= start && Math.floor(ev.begin) < end) out.push(ev)
      }
    }
    return out
  }
}

const NO_YIELD = async () => {}
/** `$: a\n$: b` from track bodies, so the parsed ids are `d1`, `d2`, … in order. */
const docOf = (tracks: readonly string[]) => tracks.map((t) => `$: ${t}`).join('\n')
const idsOf = (tracks: readonly string[]) => Object.fromEntries(tracks.map((t, i) => [`d${i + 1}`, t]))

/** The analysis production runs on a document: its own parse, signals, and events. */
async function analyseSource(tracks: readonly string[]): Promise<SongAnalysis> {
  const ir = parseStrudel(docOf(tracks)) as never
  const patterns = await evaluate(idsOf(tracks))
  return analyzeSong(ir, { collectFn: collectorFor(patterns), yieldFn: NO_YIELD, signals: signalDimensionsOf(ir) })
}

/** The length a song reports — `songLength.ts`' `songLoopCycles`, which the app owns. */
const lengthOf = (a: SongAnalysis | null) => {
  if (a === null) return 'no preview'
  // #1721 — an arranged song's span is its declared end; its repeat is still the
  // measured period, which is where the loop kind used to carry it.
  const period = a.displaySpan.kind === 'loop' ? a.displaySpan.cycles : a.displaySpan.kind === 'arranged' ? a.periodCycles : null
  return period !== null && period > 0 ? (a.repeatCycles ?? period) : 'unknown'
}

/** Swap the first curve on `d1` to `next`: the preview from the current song, and the
 *  analysis of the swapped source. */
async function swap(tracks: readonly string[], next: SignalKind) {
  const code = docOf(tracks)
  const ir = parseStrudel(code) as never
  const a = signalAutomations(ir).find((x) => x.trackId === 'd1' && x.spans.shape !== null)!
  expect(a, `no spelled curve on d1 in ${code}`).toBeDefined()
  const patterns = await evaluate(idsOf(tracks))
  const collectFn = collectorFor(patterns)
  const preview = await previewShapeSwap(ir, a, next, { collectFn, yieldFn: NO_YIELD })

  const span = a.spans.shape!
  const swappedCode = code.slice(0, span.start) + next + code.slice(span.end)
  const swappedTracks = swappedCode.split('\n').map((l) => l.slice(3))
  const truth = await analyseSource(swappedTracks)
  const current = await analyseSource(tracks)
  return { a, ir, collectFn, preview, truth, current, swappedCode }
}

const LOOP4 = 's("<hh cp sd rim>")'
const LOOP2 = 's("<hh cp>")'
const SWEEP = (shape: string, rate = '.slow(16)') => `s("bd*8").cutoff(${shape}${rate}.range(200, 2000))`

describe('#1611 — a cross-class swap is previewed as the song it gives', () => {
  it.each([
    // [label, tracks, next, length before, length after (the engine)]
    // #2109 — noise never comes back, so a song it moves has no length to offer
    // ('unknown': it reads "N+ cycles" and pages). Until #2109 it was offered the
    // loop of what the noise moves over: 4 beside a 4-bar line, 1 alone.
    ['sine beside a 4-bar line → perlin', [SWEEP('sine'), LOOP4], 'perlin', 16, 'unknown'],
    ['perlin beside a 4-bar line → sine', [SWEEP('perlin'), LOOP4], 'sine', 'unknown', 16],
    ['sine alone → perlin', [SWEEP('sine')], 'perlin', 16, 'unknown'],
    ['perlin alone → sine', [SWEEP('perlin')], 'sine', 'unknown', 16],
    ['sine beside a 2-bar line → rand', [SWEEP('sine'), LOOP2], 'rand', 16, 'unknown'],
    ['rand.slow(6) on gain beside a 4-bar line → tri', ['s("bd*8").gain(rand.slow(6))', LOOP4], 'tri', 'unknown', 12],
    ['under a whole-track slow → perlin', [`${SWEEP('sine', '.slow(4)')}.slow(2)`, LOOP4], 'perlin', 8, 'unknown'],
    ['inside an arrangement section → perlin', [`arrange([3, ${SWEEP('sine', '.slow(4)')}], [1, s("hh*8")])`], 'perlin', 16, 'unknown'],
    ['inside an arrangement section, perlin → saw', [`arrange([3, ${SWEEP('perlin', '.slow(4)')}], [1, s("hh*8")])`], 'saw', 'unknown', 16],
    ['a lane that loops by itself, its sweep turned to noise', ['s("<bd sd cp hh>*4").cutoff(sine.range(200, 2000))'], 'perlin', 1, 'unknown'],
  ] as const)('%s', async (_label, tracks, next, before, after) => {
    const r = await swap(tracks, next)
    expect(lengthOf(r.current), 'the song before').toBe(before)
    expect(lengthOf(r.truth), `the engine on ${r.swappedCode}`).toBe(after)
    expect(lengthOf(r.preview), `the preview for ${r.swappedCode}`).toBe(after)
    // Not only the length: the preview IS the analysis the swapped song gets.
    expect({ span: r.preview!.displaySpan, repeat: r.preview!.repeatCycles })
      .toEqual({ span: r.truth.displaySpan, repeat: r.truth.repeatCycles })
  }, 180_000)

  it('the control: the preview needs BOTH the stand-in and the swapped signals', async () => {
    // Beside a 4-bar line, sine → perlin gives no length (#2109). Each half alone keeps
    // the old 16.
    const r = await swap([SWEEP('sine'), LOOP4], 'perlin')
    expect(lengthOf(r.preview)).toBe('unknown')

    // Signals swapped, events untouched: the sweep's lane still repeats at 16.
    const eventsUntouched = await analyzeSong(r.ir, {
      collectFn: r.collectFn,
      yieldFn: NO_YIELD,
      signals: signalDimensionsOf(r.ir, { at: r.a.spans.shape!.start, kind: 'perlin' }),
    })
    expect(lengthOf(eventsUntouched)).toBe(16)

    // Alone, the stand-in with the signals read as written folds the old 16 back in.
    const alone = await swap([SWEEP('sine')], 'perlin')
    expect(lengthOf(alone.preview)).toBe('unknown')
    const keyOf = alone.a.paramKey
    const signalsUnswapped = await analyzeSong(alone.ir, {
      collectFn: (s, e) =>
        alone.collectFn(s, e).map((ev) => ({ ...ev, params: { ...ev.params, [keyOf]: `noise@${ev.begin}` } })),
      yieldFn: NO_YIELD,
      signals: signalDimensionsOf(alone.ir),
    })
    expect(lengthOf(signalsUnswapped)).toBe(16)
  }, 180_000)
})

describe('#1611 — where the stand-in cannot tell whose value it replaces', () => {
  // An event carries a control's value, not which writer gave it, so the stand-in
  // replaces every value of the key on the lane — the other writer's included. Found on an
  // archive document whose drop stacks four noise gains in one track: switching one to a
  // waveform leaves the song as it was, and a stand-in over all four named a longer one.
  it.each([
    // [the other writer, d1, the engine's length after — 'unchanged' when it is the current one]
    // The noise left behind still never comes back, so the song keeps its length.
    ['another noise curve', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(perlin.slow(4)))', 'unchanged'],
    // The steps come round every 3 and the new waveform every 8, so the song is 24 —
    // a stand-in over both writers would have overwritten the steps' own 3.
    ['steps', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain("<.2 .8 .5>"))', 24],
    // #1614 — `time` is never drawn, and it writes the control all the same. Counting only
    // the drawn curves let the bare one through, where the preview matched the engine only
    // by luck of this document.
    ['time', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(time))', 8],
    ['time under a range', 'stack(s("bd*8").gain(perlin.slow(8)), s("hh*8").gain(time.range(0.2, 0.8)))', 'unchanged'],
  ] as const)('toward a waveform, with %s on the same control: no preview, rather than a wrong one', async (_label, d1, after) => {
    const r = await swap([d1, LOOP4], 'sine')
    // The engine's own answer first, so the refusal is seen to be for a song that has one.
    expect(lengthOf(r.truth), 'the engine').toBe(after === 'unchanged' ? lengthOf(r.current) : after)
    expect(r.preview, `a preview was offered for ${r.swappedCode}`).toBeNull()
  }, 180_000)

  it('toward noise it still says: one writer that never comes back is enough', async () => {
    const r = await swap(['stack(s("bd*8").gain(sine.slow(8)), s("hh*8").gain(perlin.slow(4)))', LOOP4], 'perlin')
    expect(r.preview).not.toBeNull()
    expect(lengthOf(r.preview), `the preview for ${r.swappedCode}`).toBe(lengthOf(r.truth))
  }, 180_000)

  it('a fixed value on the same control does not stop it: a constant changes no period', async () => {
    const r = await swap([`cat(${SWEEP('perlin', '.slow(4)')}, s("hh*8").cutoff(800))`, LOOP4], 'sine')
    expect(r.preview).not.toBeNull()
    expect(lengthOf(r.preview), `the preview for ${r.swappedCode}`).toBe(lengthOf(r.truth))
  }, 180_000)
})

describe('#1611 — fast noise comes back round', () => {
  // Strudel's default noise seeds from frac(t / 300), so it repeats every 300 of its own
  // cycles: `perlin.slow(0.05)` every 15. Found on an archive document sweeping at
  // `sine.slow(0.015)`: switched to perlin it repeats at 36, and a stand-in that never
  // came back said 12.
  it.each([
    ['a fast sine alone → perlin', [SWEEP('sine', '.slow(0.05)')], 'perlin'],
    ['a fast sine beside a 4-bar line → rand', [SWEEP('sine', '.slow(0.05)'), LOOP4], 'rand'],
    ['fast rand alone → sine', [SWEEP('rand', '.slow(0.1)')], 'sine'],
    // A period of a third of a cycle, on its own lane.
    ['noise three times a cycle → sine: a period of a third', ['s("bd*6").cutoff(perlin.fast(3).range(200, 2000))'], 'sine'],
    // The same period where the swept lane's own length decides the song. A float `%` phase
    // lands a hair below the wrap on some onsets (13/3 against a third reads 0.333333, not 0),
    // the lane stops repeating, and the fold hands back only its structure. Integer ticks
    // keep the lane's 8 bars, so the song stays lcm(8, 3).
    ['noise three times a cycle → sine, on an 8-bar line beside a 3-bar one', ['s("<bd sd cp hh rim oh lt ht>*6").cutoff(perlin.fast(3).range(200, 2000))', 's("<hh cp sd>")'], 'sine'],
  ] as const)('%s', async (_label, tracks, next) => {
    const r = await swap(tracks, next)
    // Not vacuous: the fast noise on one side really does repeat within the cap.
    const lengths = [lengthOf(r.current), lengthOf(r.truth)]
    expect(lengths.every((l) => typeof l === 'number'), `lengths ${JSON.stringify(lengths)}`).toBe(true)
    expect(lengthOf(r.preview), `the preview for ${r.swappedCode}`).toBe(lengthOf(r.truth))
  }, 180_000)

  it('toward fast noise, another curve on the same control counts again: no preview', async () => {
    const r = await swap(['stack(s("bd*8").gain(sine.slow(0.05)), s("hh*8").gain(saw.slow(4)))', LOOP4], 'perlin')
    expect(typeof lengthOf(r.truth), 'the engine gives this song a length').toBe('number')
    expect(r.preview, `a preview was offered for ${r.swappedCode}`).toBeNull()
  }, 180_000)
})

describe('#1611 — what the menu may offer across classes', () => {
  it('pairs unipolar waveforms with noise, and offers nothing to a bipolar or unbounded curve', () => {
    expect(crossClassShapes('sine')).toEqual(['perlin', 'rand'])
    expect(crossClassShapes('perlin')).toEqual(['sine', 'tri', 'saw', 'cosine', 'square', 'isaw', 'itri'])
    expect(crossClassShapes('brand')).toEqual(['sine', 'tri', 'saw', 'cosine', 'square', 'isaw', 'itri'])
    for (const k of ['sine2', 'saw2', 'rand2', 'time'] as SignalKind[]) expect(crossClassShapes(k), k).toEqual([])
  })

  it('previews nothing it cannot stand in for', async () => {
    const tracks = [SWEEP('sine')]
    const ir = parseStrudel(docOf(tracks)) as never
    const a = signalAutomations(ir)[0]
    const collectFn = collectorFor(await evaluate(idsOf(tracks)))
    expect(await previewShapeSwap(ir, a, 'time' as SignalKind, { collectFn, yieldFn: NO_YIELD })).toBeNull()
    expect(await previewShapeSwap(ir, { ...a, spans: { ...a.spans, shape: null } }, 'perlin', { collectFn, yieldFn: NO_YIELD })).toBeNull()
    expect(await previewShapeSwap(ir, a, 'perlin', { yieldFn: NO_YIELD })).toBeNull()
  }, 120_000)
})
