/**
 * collectNoteMarks follows the WINDOW the view is showing (#1209).
 *
 * ── THE DEFECT THESE ARMS PIN ───────────────────────────────────────────────
 * Three producers feed the Song scene. Once the view could page, the analysis
 * followed the window and these two did not: the note marks and the arrange
 * clips were still derived over `[0, span)` at every origin. Because
 * `SceneNote.cycle` is song-ABSOLUTE, marks collected over `[0, 256)` map to
 * negative x at origin 256 and are culled — so a paged window drew its density
 * heatmap with NO note marks at all, and drew the FIRST window's clips.
 *
 * ⚠ EVERY ARM HERE USES A NON-ZERO ORIGIN. At origin 0 the window frame and the
 * absolute frame coincide, so an origin-blind implementation and a correct one
 * are indistinguishable — which is precisely why a well-covered function
 * carried this for a whole branch without one red arm.
 *
 * The IR is built by the REAL parser (`parseStrudel`, since #1558) and walked by the REAL
 * `structuralWalk`, so the clips asserted below are the ones production
 * derives. Only the haps are synthetic, and they carry the real source offsets
 * of the fixture.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  collectCycles: () => [],
}))

import { collectNoteMarks } from '../timelineMarks'
import { IR, type PatternIR } from '@stave/editor'
import { parseStrudel } from '@stave/editor'

// The tree the song is drawn from: `parseStrudel` (since #1558).
const pipeline = (code: string): PatternIR => parseStrudel(code)

/** arm0 → cycles 0-1, arm1 → 2-3, arm2 → 4-7, repeating with period 8. */
const ARRANGE = '$: arrange([2, s("bd")], [2, s("hh")], [4, s("cp")])'

/** A hap at `cycle`, located inside the fixture's single `$:` statement. */
const hap = (cycle: number) =>
  ({
    begin: cycle,
    end: cycle + 0.25,
    trackId: '$0',
    note: 'C3',
    gain: 1,
    loc: [{ start: 20, end: 24 }],
  }) as unknown as NonNullable<Parameters<typeof collectNoteMarks>[0]>[number]

const allMarks = (m: ReturnType<typeof collectNoteMarks>): number[] =>
  [...m.marksByLane.values()].flat().map((n) => n.cycle).sort((a, b) => a - b)

describe('collectNoteMarks — marks follow the window (#1209)', () => {
  it('keeps the haps INSIDE the window and drops the ones before it', () => {
    // The band the paged view shows is [4, 8). Cycles 0-3 are to its left: they
    // belong to a different page and, drawn, would land off-canvas and vanish.
    const haps = [hap(0), hap(1), hap(4), hap(5), hap(6)]
    const marks = collectNoteMarks(haps, pipeline(ARRANGE), { originCycle: 4, spanCycles: 4 })

    expect(allMarks(marks)).toEqual([4, 5, 6])
  })

  it('the SAME haps at origin 0 keep the OTHER half — the arms disagree, as they must', () => {
    const haps = [hap(0), hap(1), hap(4), hap(5), hap(6)]
    const marks = collectNoteMarks(haps, pipeline(ARRANGE), { originCycle: 0, spanCycles: 4 })

    expect(allMarks(marks)).toEqual([0, 1])
  })

  it('narrows a PREFIX read down to the window', () => {
    // Without the banded accessor the caller hands over `[0, end)` — a superset.
    // The window is what narrows it, so the fallback path stays correct (just
    // slower) rather than drawing the whole song's marks into one page.
    const prefix = [hap(0), hap(2), hap(4), hap(5), hap(7), hap(9)]
    const marks = collectNoteMarks(prefix, pipeline(ARRANGE), { originCycle: 4, spanCycles: 4 })

    expect(allMarks(marks)).toEqual([4, 5, 7])
  })
})

describe('collectNoteMarks — clips follow the window, in ABSOLUTE cycles (#1209)', () => {
  const clipsOf = (m: ReturnType<typeof collectNoteMarks>) => {
    const clips = [...m.clipsByLane.values()][0] ?? []
    return clips.map((c) => [c.armIndex, c.startCycle, c.endCycle])
  }

  it('draws the arms that play in the window, not the first window\'s', () => {
    const atStart = collectNoteMarks([], pipeline(ARRANGE), { originCycle: 0, spanCycles: 4 })
    const paged = collectNoteMarks([], pipeline(ARRANGE), { originCycle: 4, spanCycles: 4 })

    // Cycles 0-3: arm0 then arm1. Cycles 4-7: arm2 throughout.
    expect(clipsOf(atStart)).toEqual([
      [0, 0, 2],
      [1, 2, 4],
    ])
    expect(clipsOf(paged)).toEqual([[2, 4, 8]])
  })

  it('publishes SONG-ABSOLUTE cycles — the frame the edit path writes back in', () => {
    // `armByCycle` is window-relative (slot 0 is the origin); `SceneClip.startCycle`
    // is absolute and feeds clip write-back. A window-relative cycle escaping here
    // would edit a different bar than the one the user dragged.
    const deep = collectNoteMarks([], pipeline(ARRANGE), { originCycle: 512, spanCycles: 4 })

    for (const [, start, end] of clipsOf(deep)) {
      expect(start).toBeGreaterThanOrEqual(512)
      expect(end).toBeLessThanOrEqual(516)
    }
    // Period 8 → cycle 512 is arm0 again, and the clip says so in song cycles.
    expect(clipsOf(deep)).toEqual([
      [0, 512, 514],
      [1, 514, 516],
    ])
  })

  it('still annotates a lane the window never reaches', () => {
    // A paged window keeps a silent track as a (silenced) row, so its label and
    // clip-gesture anchors have to survive the page. Without the whole-song
    // anchor pass this lane would page in unnamed and unbindable.
    const code = ['$: arrange([2, s("bd")], [2, silence])', '$: s("hh")'].join('\n')
    const paged = collectNoteMarks([], pipeline(code), { originCycle: 2, spanCycles: 2 })

    // Both declared lanes keep their statement anchor even though only one of
    // them plays anything in [2, 4).
    expect(paged.labelOffsetByLane.size).toBeGreaterThanOrEqual(2)
  })
})
