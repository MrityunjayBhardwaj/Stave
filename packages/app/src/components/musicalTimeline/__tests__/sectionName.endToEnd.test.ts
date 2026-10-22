/**
 * A section's name survives the WHOLE path — walk → marks → scene (#1391).
 *
 * ── WHY THIS EXISTS ALONGSIDE `sectionLabel.test.ts` ─────────────────────────
 * That file proves the resolver reads a name out of a range. It cannot prove
 * that a range ever ARRIVES: the arm's `loc` has to be picked up by
 * `structuralWalk`, carried on the lane skeleton, run-length-encoded onto a clip
 * by `timelineMarks`, and resolved against the user's code by
 * `buildTimelineScene`. Any one of those four links can be missing while every
 * resolver arm stays green, and the symptom is the original complaint unchanged
 * — clips captioned `bd`.
 *
 * So this drives the REAL parser over REAL source, the same route
 * `collectNoteMarks.stackArms.test.ts` takes, and asserts on the far end.
 *
 * Only the haps are synthetic. Their offsets are real ones from the document.
 */
import { describe, it, expect, vi } from 'vitest'

// Same barrel mock as the stack-arms harness next door: no IR events, so lane
// structure comes from the REAL `structuralWalk` over the REAL IR rather than
// from collect's events. That is the path that has to carry `armRanges`.
vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  collectCycles: () => [],
}))

import { collectNoteMarks } from '../timelineMarks'
import { buildTimelineScene } from '../timelineScene'
import { wholeSongWindow } from '../songAxis'
import { IR, type PatternIR } from '@stave/editor'
import { parseStrudel } from '@stave/editor'

// The tree the song is drawn from: `parseStrudel` (since #1558).
const pipeline = (code: string): PatternIR => parseStrudel(code)

// This document has no `$:` prefix, and until #1392 that was FORCED rather than
// chosen: with `$:` in front, both parsers left every arm an opaque `Code`, so
// the arrangement produced no leaves, no `armIndex`, and no clips at all —
// there was nothing to name, and naming could not be tested through a path that
// yielded none. That gap is fixed, and `DOLLAR_SONG` below is the same song in
// the form a musician actually writes; both must name identically.
const SONG = `const intro = s("bd")
const verse = s("hh")
arrange([4, intro], [8, verse])`

/** The SAME song behind a `$:` track prefix — the ordinary way to declare one. */
const DOLLAR_SONG = `const intro = s("bd")
const verse = s("hh")
$: arrange([4, intro], [8, verse])`

/**
 * A minimal activity carrying just the lane the clips hang off.
 *
 * The scene builds its rows from the ANALYSIS, not from the marks, so without a
 * lane here there is nothing for a clip to attach to and the scene comes back
 * empty. Onsets are all zero: this arm is about NAMES, and a clip is drawn (and
 * captioned) whether or not anything sounds in it.
 */
const activityFor = (laneKey: string, cycles: number) =>
  ({
    lanes: [{ laneKey, onsetsByCycle: new Array(cycles).fill(0) }],
    sections: [],
  }) as unknown as Parameters<typeof buildTimelineScene>[0]

/** Every section name the scene ends up drawing, in clip order. */
function sectionNames(code: string, cycles: number): string[] {
  const marks = collectNoteMarks(
    [] as unknown as Parameters<typeof collectNoteMarks>[0],
    pipeline(code),
    wholeSongWindow(cycles),
  )
  // (activity, songWindow, period, carriedPeakDensity, marks, code)
  const scene = buildTimelineScene(
    activityFor('d1', cycles),
    wholeSongWindow(cycles),
    null,
    null,
    marks,
    code,
  )
  return scene.lanes.flatMap((l) => l.clips.map((c) => c.sectionName))
}

describe('#1391 — the section name reaches the scene', () => {
  it('names the arms of an arranged document from the source', () => {
    // The whole point: `intro` and `verse` are the identifiers the musician
    // wrote, recovered without any new syntax.
    expect(sectionNames(SONG, 12)).toEqual(['intro', 'verse'])
  })

  it('names them identically behind a `$:` prefix (#1392)', () => {
    // The form a musician writes. It named NOTHING before #1392 — the whole
    // arrangement collapsed to one unnamed implicit clip — so this arm is the
    // one that says the feature reaches the ordinary document, not just the
    // bare one the other arms use.
    expect(sectionNames(DOLLAR_SONG, 12)).toEqual(['intro', 'verse'])
    expect(sectionNames(DOLLAR_SONG, 12)).toEqual(sectionNames(SONG, 12))
  })

  it('the arm RANGES arrive on the clips — the link that had to be built', () => {
    // Asserted separately from the names so a failure says WHICH link broke: a
    // missing range is `structuralWalk`/`timelineMarks`, a wrong name with a
    // present range is the resolver.
    const marks = collectNoteMarks(
      [] as unknown as Parameters<typeof collectNoteMarks>[0],
      pipeline(SONG),
      wholeSongWindow(12),
    )
    const clips = [...marks.clipsByLane.values()].flat()
    expect(clips.length).toBeGreaterThan(0)
    for (const c of clips) {
      expect(c.nameRange, `arm ${c.armIndex} carried no source range`).not.toBeNull()
      expect(SONG.slice(...c.nameRange!)).toMatch(/^\[\s*\d+\s*,/)
    }
  })

  it('a name is any identifier, as it is for a track label (#1921)', () => {
    // These read `§1`/`§2` and `§1`/`verse` while the section reader tested names
    // with an ASCII-only regex of its own.
    expect(sectionNames(`const 前奏 = s("bd")\nconst 主歌 = s("hh")\narrange([4, 前奏], [8, 主歌])`, 12)).toEqual(['前奏', '主歌'])
    expect(sectionNames(`const café = s("bd")\nconst verse = s("hh")\narrange([4, café], [8, verse])`, 12)).toEqual(['café', 'verse'])
  })

  it('falls back to an ordinal for inline arms, in the same document', () => {
    const mixed = `const verse = s("hh")
arrange([4, s("bd")], [8, verse])`
    expect(sectionNames(mixed, 12)).toEqual(['§1', 'verse'])
  })

  it('a bare track gets no section name — it is not an arrangement', () => {
    // The implicit whole-song clip. A caption here would invent a section the
    // document does not have.
    expect(sectionNames('s("bd*4")', 4)).toEqual([''])
  })

  it('without the code, every arm keeps its ordinal rather than guessing', () => {
    const marks = collectNoteMarks(
      [] as unknown as Parameters<typeof collectNoteMarks>[0],
      pipeline(SONG),
      wholeSongWindow(12),
    )
    const scene = buildTimelineScene(activityFor('d1', 12), wholeSongWindow(12), null, null, marks, null)
    expect(scene.lanes.flatMap((l) => l.clips.map((c) => c.sectionName))).toEqual([
      '§1',
      '§2',
    ])
  })
})
