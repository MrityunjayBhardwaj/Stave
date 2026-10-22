import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { parseStrudel } from '../parseStrudel'
import { songExtent } from '../songExtent'
import { analyzeSong } from '../songAnalysis'

/**
 * #1721 — an arrangement DECLARES its end, and the timeline's span reads it.
 *
 * Before this, the span was a period DETECTED from what played, which is bounded
 * by `cap / 2` (no period over 128 bars is ever confirmable, so a 187-bar song drew
 * 256 bars — itself plus 69 of its next pass) and takes the FIRST period that fits
 * (so a 150-bar song whose first section is one repeated bar drew ONE bar). The
 * bounce already renders the declared length (`arrangedRepeatCycles`); these tests
 * hold the timeline to the same number.
 *
 * Only the VIEW moves. The measurements (`periodCycles`, `repeatCycles`,
 * `lanePeriods`) answer "when does the song come back round", which the shape and
 * step-count menus read, and are pinned here equal to the same run without a
 * declared end.
 *
 * The collector is synthetic and plays what the source says, so each case controls
 * exactly what a detector would see — and records every range it was asked for.
 */

function ev(begin: number, lane: string, s: string): IREvent {
  return {
    begin,
    end: begin + 0.125,
    endClipped: begin + 0.125,
    note: null,
    freq: null,
    s,
    gain: 1,
    velocity: 1,
    color: null,
    trackId: lane,
  } as unknown as IREvent
}

/** Plays `sections` back to back on lane `d1`: `[cycles, sound, hitsPerCycle]`, then
 *  silence. Records every `[start, end)` it is asked for. */
function sectionsCollector(sections: ReadonlyArray<readonly [number, string, number]>) {
  const asked: Array<[number, number]> = []
  const collectFn = (start: number, end: number): IREvent[] => {
    asked.push([start, end])
    const out: IREvent[] = []
    for (let c = start; c < end; c++) {
      let at = 0
      for (const [len, s, hits] of sections) {
        if (c < at + len) {
          for (let k = 0; k < hits; k++) out.push(ev(c + k / hits, 'd1', s))
          break
        }
        at += len
      }
    }
    return out
  }
  const furthest = () => asked.reduce((m, [, e]) => Math.max(m, e), 0)
  return { collectFn, asked, furthest }
}

/** Every cycle different from every other — no period at any horizon. */
const uniqueCollect = (start: number, end: number): IREvent[] => {
  const out: IREvent[] = []
  for (let c = start; c < end; c++) out.push(ev(c, 'd1', `s${c}`))
  return out
}

const run = (code: string, collectFn: (s: number, e: number) => IREvent[], extra: object = {}) =>
  analyzeSong(parseStrudel(code), { collectFn, yieldFn: async () => {}, ...extra })

describe('#1721 — an arranged song spans the end it declares', () => {
  it('a 150-bar arrangement opening on one repeated bar spans 150 bars, not 1', async () => {
    const code = 'arrange([100, s("bd*4")], [50, s("hh*8")])'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'arranged', cycles: 150 })
    const c = sectionsCollector([[100, 'bd', 4], [50, 'hh', 8]])
    const a = await run(code, c.collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 150 })
    expect(a.horizonCycles).toBe(150)
    expect(a.lanes[0]?.onsetsByCycle.length).toBe(150)
    // Both sections are in the view: the hi-hats that start at bar 100 are drawn.
    expect(a.sections.map((s) => [s.startCycle, s.endCycle])).toEqual([[0, 150]])
    expect(a.lanes[0]?.onsetsByCycle[120]).toBe(8)
  })

  it('a 187-bar arrangement spans 187 bars, not the 256-bar cap', async () => {
    const code = 'arrange([100, s("bd*4")], [87, s("hh*8")])'
    const c = sectionsCollector([[100, 'bd', 4], [87, 'hh', 8]])
    const a = await run(code, c.collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 187 })
    expect(a.horizonCycles).toBe(187)
  })

  it('a period confirmed early does not stop collection short of the end', async () => {
    // The detector confirms period 1 at bar 8 of this song; the view still needs 150.
    const code = 'arrange([100, s("bd*4")], [50, s("hh*8")])'
    const c = sectionsCollector([[100, 'bd', 4], [50, 'hh', 8]])
    await run(code, c.collectFn)
    expect(c.furthest()).toBe(150)
  })

  it('the measurements are kept exactly as measured — only the view is re-spanned', async () => {
    for (const [code, sections] of [
      ['arrange([100, s("bd*4")], [50, s("hh*8")])', [[100, 'bd', 4], [50, 'hh', 8]]],
      ['arrange([100, s("bd*4")], [87, s("hh*8")])', [[100, 'bd', 4], [87, 'hh', 8]]],
      ['arrange([2, s("bd")], [4, s("hh*2")])', [[2, 'bd', 1], [4, 'hh', 2]]],
    ] as const) {
      const a = await run(code, sectionsCollector(sections).collectFn)
      const m = await analyzeSong(null, { collectFn: sectionsCollector(sections).collectFn, yieldFn: async () => {} })
      expect({ p: a.periodCycles, r: a.repeatCycles, l: a.lanePeriods }, code).toEqual({
        p: m.periodCycles,
        r: m.repeatCycles,
        l: m.lanePeriods,
      })
    }
  })

  it('a short arrangement spans its own length', async () => {
    const code = 'arrange([2, s("bd")], [4, s("hh*2")])'
    const c = sectionsCollector([[2, 'bd', 1], [4, 'hh', 2]])
    const a = await run(code, c.collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 6 })
    expect(a.horizonCycles).toBe(6)
  })

  it('a silent arrangement still has its length', async () => {
    const code = 'arrange([12, silence])'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'arranged', cycles: 12 })
    const a = await run(code, () => [])
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 12 })
  })

  it('a fractional end spans the first WHOLE-bar repeat — the bounce\'s length', async () => {
    // 4.5 bars of structure line up with a bar line again after two passes. The
    // fold is seeded at one cycle (`repeatOf`), which is why the bounce renders 9;
    // the view spans the same 9, so the playhead wraps where the audio does.
    const code = 'arrange([3, s("bd")]).slow(1.5)'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'arranged', cycles: 4.5 })
    const a = await run(code, sectionsCollector([[9, 'bd', 1]]).collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 9 })
    expect(a.lanes[0]?.onsetsByCycle.length).toBe(9)
  })

  it('a parameter that outlasts the arrangement extends the span to where the song repeats', async () => {
    // #1585's shape: `a` steps `<.2 .9>` by its own count per appearance, so the
    // second pass differs from the first and bar 7 plays .9. The structure is 4
    // bars; the song — and the bounce — is 8.
    const code = 'const a = s("bd*2").gain("<.2 .9>")\n$: arrange([2, a], [1, s("hh*2")], [1, a])'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'arranged', cycles: 4 })
    const a = await run(code, sectionsCollector([[8, 'bd', 2]]).collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 8 })
  })

  it('a fold past the cap is not vouched for: the span is the arrangement\'s own end', async () => {
    // The demo song's shape: a 187-bar arrangement under a 20-bar fade. lcm(187, 20)
    // is far past the cap, so the song is shown as long as it says it is.
    const code = 'arrange([100, s("bd*4")], [87, s("hh*8").gain(isaw.slow(20))])'
    const a = await run(code, sectionsCollector([[100, 'bd', 4], [87, 'hh', 8]]).collectFn)
    expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 187 })
  })

  it('an arrangement longer than the cap keeps the measured path (capped + paging)', async () => {
    const code = 'arrange([300, s("bd*4")])'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'arranged', cycles: 300 })
    const a = await run(code, uniqueCollect)
    expect(a.displaySpan).toEqual({ kind: 'capped', cycles: 256 })
  })

  it('a looping document is unchanged', async () => {
    const code = 's("bd*4")'
    const a = await run(code, sectionsCollector([[1000, 'bd', 4]]).collectFn)
    const b = await analyzeSong(null, { collectFn: sectionsCollector([[1000, 'bd', 4]]).collectFn, yieldFn: async () => {} })
    expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 1 })
    expect(a).toEqual(b)
  })

  it('an arrangement under something unparsed (opaque) is unchanged', async () => {
    const code = 'arrange([100, s("bd*4")], [50, s("hh*8")]).someUnknownTransform(3)'
    expect(songExtent(parseStrudel(code))).toEqual({ kind: 'opaque' })
    const col = () => sectionsCollector([[100, 'bd', 4], [50, 'hh', 8]]).collectFn
    const a = await run(code, col())
    const b = await analyzeSong(null, { collectFn: col(), yieldFn: async () => {} })
    expect(a.displaySpan.kind).not.toBe('arranged')
    expect(a).toEqual(b)
  })

  it('an aborted collection is not reported as the declared end', async () => {
    const code = 'arrange([100, s("bd*4")], [87, s("hh*8")])'
    const signal = { aborted: false }
    const c = sectionsCollector([[100, 'bd', 4], [87, 'hh', 8]])
    const collectFn = (s: number, e: number) => {
      if (s >= 40) signal.aborted = true
      return c.collectFn(s, e)
    }
    const a = await run(code, collectFn, { signal })
    // Whatever the measured path makes of the part it saw — never the declared end,
    // which nothing collected vouches for.
    expect(a.displaySpan.kind).not.toBe('arranged')
    expect(a.horizonCycles).toBeLessThan(187)
  })
})
