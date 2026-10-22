import { describe, it, expect } from 'vitest'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
  bjorklund,
  parseGainMini,
  applyStepGain,
  applyRollGain,
} from '../parse'
import {
  serializeStepGrid,
  serializePianoRoll,
  serializeStepGain,
  serializeRollGain,
} from '../serialize'
import { pitchToMidi, midiToPitch, noteDisplayName, isBlackKey, cLabel } from '../pitch'
import { placeNote, resizeNote } from '../place'
import { resizeGrid, resizeRoll } from '../resize'
import { cellOn, isCellOn } from '../model'
import type { StepCell, StepGridModel, PianoRollModel } from '../model'
// the authority our bjorklund adapts — imported so the euclid test can A/B
// against it rather than a hand-written table of our own beliefs (#917).
import { bjorklund as strudelEuclid } from '@strudel/core/euclid.mjs'

/** the round-trip law: serialize(parse(s)) === s */
function gridRoundTrips(s: string) {
  const r = parseStepGrid(s)
  expect(r.ok, `expected ${s} to parse`).toBe(true)
  if (r.ok) expect(serializeStepGrid(r.model)).toBe(s)
}

/** an edit through the writer: toggle one column's `sound`, then serialize */
function gridEdit(src: string, col: number, sound: string): string | null {
  const r = parseStepGrid(src)
  if (!r.ok) return null
  const lanes = r.model.lanes.map((l) => ({ ...l, cells: [...l.cells] }))
  let lane = lanes.find((l) => l.sound === sound)
  if (!lane) {
    lane = { sound, cells: Array<StepCell>(r.model.steps).fill(false) }
    lanes.push(lane)
  }
  lane.cells[col] = isCellOn(lane.cells[col]) ? false : cellOn()
  return serializeStepGrid({ ...r.model, lanes })
}

/**
 * The GRID a model shows, without its provenance.
 *
 * Two spellings of one rhythm (`bd!2` / `bd bd`, `bd -` / `bd ~`) show the same
 * grid and keep their own bytes — that is the point of span surgery (#913), so
 * comparing whole models would now compare the bytes too and report a
 * difference that is the feature. What these tests mean is "the same grid".
 */
const view = (m: StepGridModel) => ({ steps: m.steps, bars: m.bars, lanes: m.lanes })
function rollRoundTrips(s: string) {
  const r = parsePianoRoll(s)
  expect(r.ok, `expected ${s} to parse`).toBe(true)
  if (r.ok) expect(serializePianoRoll(r.model)).toBe(s)
}

/** an edit through the writer: retune the note at index `i`, then serialize */
function rollEdit(src: string, i: number, pitch: string): string | null {
  const r = parsePianoRoll(src)
  if (!r.ok) return null
  const notes = r.model.notes.map((n, j) => (j === i ? { ...n, pitch } : n))
  return serializePianoRoll({ ...r.model, notes })
}

describe('step grid — parse', () => {
  it('reads a single-lane sequence with rests', () => {
    const r = parseStepGrid('bd ~ bd ~')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(4)
    expect(r.model.lanes).toEqual([
      { sound: 'bd', cells: [cellOn(), false, cellOn(), false] },
    ])
  })

  it('reads a multi-sound sequence as one lane per sound', () => {
    const r = parseStepGrid('bd hh sn hh')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['bd', 'hh', 'sn'])
    expect(r.model.lanes[1].cells).toEqual([false, cellOn(), false, cellOn()])
  })

  it('keeps :variant in the lane sound', () => {
    const r = parseStepGrid('bd:3 ~')
    expect(r.ok && r.model.lanes[0].sound).toBe('bd:3')
  })

  it('reads a `,`-stack as parts, preserving grouping', () => {
    const r = parseStepGrid('bd ~ bd ~, hh hh hh hh')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => [l.sound, l.part])).toEqual([
      ['bd', 0],
      ['hh', 1],
    ])
  })

  it('expands a sub-sequence onto a finer grid', () => {
    const r = parseStepGrid('bd [hh hh]')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // bd ~ hh hh on a 4-cell grid
    expect(r.model.steps).toBe(4)
    // bd's cell lasts TWO columns — it owns half the cycle, and the group in the
    // other half is what made the grid four wide (#1010 P4b)
    expect(r.model.lanes.find((l) => l.sound === 'bd')!.cells).toEqual([
      cellOn(2), false, false, false,
    ])
  })

  it('reads simultaneous hits as a [a,b] column', () => {
    const r = parseStepGrid('[bd,sn] ~')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['bd', 'sn'])
    expect(r.model.lanes[0].cells[0]).toEqual(cellOn())
    expect(r.model.lanes[1].cells[0]).toEqual(cellOn())
  })

  it('reads a whole-string <...> alternation as bars', () => {
    const r = parseStepGrid('<[bd ~] [bd bd]>')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.bars).toBe(2)
    expect(r.model.steps).toBe(4)
  })

  it('projects shapes the two-level model cannot represent (#922)', () => {
    // Polymeter and `@n` elongation have no place in the syntactic grid model,
    // but both PLAY a stable single-cycle grid — so the behaviour projection shows
    // what they play and copies the source back verbatim.
    gridRoundTrips('{bd hh}%4') // plays [bd hh bd hh]
    gridRoundTrips('bd@2 hh') // the held bd reads as a hit + rest: [bd ~ hh]
    // An edit re-emits locally and stays hap-faithful — the source's own bytes ride back
    // around the one touched region. `bd@2 hh` is the exception, and it is instructive:
    // `bd` sounds 2/3 of the cycle on a 3-column grid, so the re-emit has to spell a
    // two-column note in the region it owns. Toggling column 1 puts `cp` INSIDE the columns
    // `bd` is still sounding through, and there is no per-column token that means both. So
    // the writer declines (#1010 P4c) rather than emitting `bd cp hh`, which silently cut
    // `bd` from 2/3 to 1/3 — a length the panel cannot show the user it changed (#1026).
    expect(gridEdit('bd@2 hh', 1, 'cp')).toBeNull()
    // still refused: a pattern with no period at all. `?` degrades at random, so it
    // never repeats and there are no bars to show — an honest refusal, not a lie.
    expect(parseStepGrid('bd?').ok).toBe(false)
  })

  it('refuses a pattern whose period is longer than the probe window (#930)', () => {
    // `<4 8>/16` holds each alternative for SIXTEEN cycles, so a pattern that only
    // looked at the first eight would conclude "static" and show a grid that quietly
    // becomes a lie at cycle 16 — and would drop the `<4 8>/16` on the first edit.
    // Refusing is the honest answer: the period is real but beyond what we expand.
    expect(parseStepGrid('hh*[<4 8>/16]').ok).toBe(false)
  })

  it('bar-expands a pattern that varies per cycle (#930)', () => {
    // A patterned operator plays a DIFFERENT cycle each time: `bd*<1 2>` is one hit,
    // then two. #922 refused it for not being static; the projection now shows the
    // period as bars instead, which is what the pattern actually plays.
    const r = parseStepGrid('bd*<1 2>')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.bars).toBe(2)
    expect(r.model.steps).toBe(4) // 2 columns per bar × 2 bars
    // bar 0 fires once, bar 1 twice — exactly the two cycles it plays
    // bar 0's single hit lasts the WHOLE bar (2 columns); bar 1's two hits last one
    // column each — the alternation changes the lengths, not just the positions
    expect(r.model.lanes).toEqual([
      { sound: 'bd', cells: [cellOn(2), false, cellOn(), cellOn()] },
    ])
    // and an untouched open→write still returns the user's own bytes
    expect(serializeStepGrid(r.model)).toBe('bd*<1 2>')
  })

  it('expands `atom*n` into n columns of the atom', () => {
    const r = parseStepGrid('hh*8')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(8)
    expect(r.model.lanes).toEqual([{ sound: 'hh', cells: Array(8).fill(cellOn()) }])
  })

  it('packs `atom*n` into its own step alongside plain steps', () => {
    const r = parseStepGrid('bd hh*4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // bd holds the first half (4 cols), hh fires across the second half
    expect(r.model.steps).toBe(8)
    // "bd holds the first half" is now in the model rather than only in this
    // comment: its cell lasts 4 of the 8 columns, each `hh` exactly 1
    expect(r.model.lanes.find((l) => l.sound === 'bd')!.cells).toEqual([
      cellOn(4), false, false, false, false, false, false, false,
    ])
    expect(r.model.lanes.find((l) => l.sound === 'hh')!.cells).toEqual([
      false, false, false, false, cellOn(), cellOn(), cellOn(), cellOn(),
    ])
  })

  it('projects `*` combined with `@`, still refuses invalid multipliers (#922)', () => {
    // `*` with `@` has no representation in the two-level model, but plays a static
    // grid — the projection shows and round-trips it.
    gridRoundTrips('bd*2@2') // [bd bd]
    gridRoundTrips('[bd hh]*2@2') // [bd hh bd hh]
    // genuinely nothing to show:
    expect(parseStepGrid('bd*0').ok).toBe(false) // zero multiplier
    expect(parseStepGrid('bd*').ok).toBe(false) // missing count
  })

  it('rejects `atom*n` that expands past the step ceiling', () => {
    expect(parseStepGrid('hh*128').ok).toBe(false)
  })

  it('expands `atom(k,n)` euclid into an n-step lane with k hits', () => {
    const r = parseStepGrid('bd(3,8)')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(8)
    // Bjørklund(3,8) = x . . x . . x .
    expect(r.model.lanes).toEqual([
      {
        sound: 'bd',
        cells: [cellOn(), false, false, cellOn(), false, false, cellOn(), false],
      },
    ])
  })

  it('reads other euclid grooves (5,8) and (7,16)', () => {
    const five = parseStepGrid('bd(5,8)')
    expect(five.ok).toBe(true)
    if (five.ok) {
      expect(five.model.steps).toBe(8)
      expect(five.model.lanes[0].cells.filter(Boolean).length).toBe(5)
    }
    const seven = parseStepGrid('hh(7,16)')
    expect(seven.ok).toBe(true)
    if (seven.ok) {
      expect(seven.model.steps).toBe(16)
      expect(seven.model.lanes[0].cells.filter(Boolean).length).toBe(7)
    }
  })

  it('a NEGATIVE pulse count inverts the euclid — it is not empty (#917)', () => {
    // `(-10,16)` = the 6 steps a euclidean 10 leaves out. Before #917 a guard
    // (`k <= 0 → all-false`) stood in front of the authority and drew an empty
    // grid for a pattern Strudel plays 6 notes of.
    const r = parseStepGrid('bd(-10,16)')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(16)
    // exact cells, verified against Strudel's queryArc onset columns 1,4,6,9,12,14
    expect(
      r.model.lanes[0].cells.flatMap((cell, i) => (isCellOn(cell) ? [i] : [])),
    ).toEqual([1, 4, 6, 9, 12, 14])
  })

  it('our bjorklund agrees with @strudel/core across signs (#917, reference-independent)', () => {
    // The reference is Strudel's own bjorklund, not a table of our beliefs — only
    // an independent oracle can disagree with us. Where upstream throws (|k| >= n)
    // the view holds it (all / none), which is a VIEW decision, not a mismatch.
    for (const [k, n] of [
      [3, 8], [5, 8], [7, 16], [1, 4], [-1, 4], [-3, 8], [-10, 16], [-2, 5], [-7, 16],
    ] as const) {
      const oursCount = bjorklund(k, n).filter(Boolean).length
      const theirs = strudelEuclid(k, n).filter((x) => x === 1).length
      expect(oursCount, `bjorklund(${k},${n})`).toBe(theirs)
    }
  })

  it('rotates the euclid pattern with the 3rd argument `(3,8,2)` (matches Strudel euclidRot)', () => {
    const r = parseStepGrid('bd(3,8,2)')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Strudel applies rotate(b, -rot) — a right rotation: x..x..x. → x.x..x..
    expect(r.model.lanes[0].cells).toEqual([
      cellOn(), false, cellOn(), false, false, cellOn(), false, false,
    ])
  })

  it('packs euclid into its own step alongside plain steps', () => {
    const r = parseStepGrid('bd sn(3,8)')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // bd holds the first half (8 cols), sn euclid fills the second half
    expect(r.model.steps).toBe(16)
    expect(r.model.lanes.find((l) => l.sound === 'bd')!.cells[0]).toEqual(cellOn(8))
    expect(r.model.lanes.find((l) => l.sound === 'sn')!.cells.filter(Boolean).length).toBe(3)
  })

  it('projects euclid combined with `*`/`@`/groups, still refuses malformed euclid (#922)', () => {
    // euclid on top of `*`/`@`, or on a group, plays a static grid the projection
    // shows and round-trips (plain `atom(k,n)` already expanded in the core).
    gridRoundTrips('bd(3,8)*2') // the 8-step euclid, twice
    gridRoundTrips('bd(3,8)@2') // the 8-step euclid held over two units
    gridRoundTrips('[bd hh](3,8)') // group euclid: [bd ~ ~ bd ~ ~ hh ~]
    // malformed euclid still refuses — nothing plays:
    expect(parseStepGrid('bd(3)').ok).toBe(false) // missing step count
    expect(parseStepGrid('bd(3,8').ok).toBe(false) // unbalanced
    expect(parseStepGrid('bd()').ok).toBe(false) // empty args
  })

  it('rejects euclid that expands past the step ceiling', () => {
    expect(parseStepGrid('bd(3,128)').ok).toBe(false)
  })

  it('expands `atom!n` into n separate steps of the atom', () => {
    const r = parseStepGrid('bd!3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(3)
    expect(r.model.lanes).toEqual([
      { sound: 'bd', cells: [cellOn(), cellOn(), cellOn()] },
    ])
  })

  it('`!n` replicates as whole steps, unlike `*n` (subdivision)', () => {
    // bd!3 sn = bd bd bd sn → 4 equal steps; bd*3 sn would be 6 cells
    const r = parseStepGrid('bd!3 sn')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(4)
    expect(r.model.lanes.find((l) => l.sound === 'bd')!.cells).toEqual([
      cellOn(),
      cellOn(),
      cellOn(),
      false,
    ])
    expect(r.model.lanes.find((l) => l.sound === 'sn')!.cells).toEqual([
      false,
      false,
      false,
      cellOn(),
    ])
  })

  it('projects `!` combined with `*`/`@`/groups, still refuses a zero replicate (#922)', () => {
    gridRoundTrips('bd!3*2') // [bd bd bd bd bd bd]
    gridRoundTrips('bd!3@2') // [bd bd bd]
    gridRoundTrips('[bd hh]!2') // [bd hh bd hh]
    expect(parseStepGrid('bd!0').ok).toBe(false) // zero replicate — 0 haps, nothing to draw
  })

  /**
   * A bare `!` is `!2`, not a syntax error. The hand-rolled tokenizer required
   * digits after `!` and refused this, and that refusal was asserted here as if
   * it were the subset's edge — it was drift. OBSERVED through real Strudel:
   * `mini('bd!')`, `mini('bd bd')` and `mini('bd!2')` each query to the SAME two
   * haps (`bd`@0-0.5, `bd`@0.5-1). Refusing to show a pattern Strudel plays is
   * the bug this file's krill adapter exists to end (#903).
   */
  it('reads a bare `!` as `!2` — the form Strudel actually plays', () => {
    const bare = parseStepGrid('bd!')
    const explicit = parseStepGrid('bd!2')
    const spelled = parseStepGrid('bd bd')
    expect(bare.ok).toBe(true)
    if (!bare.ok || !explicit.ok || !spelled.ok) return
    expect(view(bare.model)).toEqual(view(explicit.model))
    expect(view(bare.model)).toEqual(view(spelled.model))
  })

  it('rejects `atom!n` that expands past the step ceiling', () => {
    expect(parseStepGrid('bd!128').ok).toBe(false)
  })
})

describe('step grid — round-trip identity', () => {
  const canonical = [
    'bd ~ bd ~',
    'bd hh sn hh',
    'bd:3 ~ sn ~',
    'bd ~ bd ~, hh hh hh hh',
    '[bd,sn] ~ sn ~',
    '~ ~ ~ ~',
    '<[bd ~] [bd bd]>',
    '<bd sn>',
  ]
  for (const s of canonical) it(`"${s}"`, () => gridRoundTrips(s))
})

describe('step grid — velocity no longer defeats span surgery (#913 gap CLOSED by #1123)', () => {
  /**
   * ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, AND THE REASON IT GAVE WAS WRONG.
   *
   * It pinned "a per-column `.gain` forces the flat rebuild" as a known gap, on the
   * grounds that the gain mini "runs 1:1 against the FLAT column sequence, so a grid
   * carrying one must keep emitting that flat sequence or the velocities land on the
   * wrong notes" — and it named the remedy: give the gain mini the same STRUCTURE as
   * the notes (`0.5 [1 1] 0.8 1` rather than `0.5 ~ 1 1 0.8 ~ 1 ~`), "its own piece of
   * work".
   *
   * The engine says that work is not needed (#1123). The 1:1 relationship is with the
   * COLUMNS, which a splice preserves exactly; it changes only how they are spelled. In
   * `bd hh*2 sd cp` the columns are eight uniform eighths either way, so the flat gain
   * mini lands on exactly the right notes: `bd` at token 0, the two `hh` at 2 and 3,
   * `sd` at 4, `cp` at 6 — the `~` tokens sit where no note starts. Verified against
   * Strudel over the whole corpus rather than argued: 220 units where the two spellings
   * differ, 217 played identically, and zero notes anywhere received a different gain.
   *
   * The lesson worth keeping is that the gap was real and its stated CAUSE was not — so
   * the fix cost a guard removal rather than the gain-mini rewrite it was scoped for.
   */
  it('a per-column .gain keeps the notation, `*2` and all', () => {
    const r = parseStepGrid('bd hh*2 sd cp')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // no gain → the notation survives
    expect(serializeStepGrid(r.model)).toBe('bd hh*2 sd cp')
    // …and per-column velocity no longer costs it
    const withGain = applyStepGain(r.model, {
      mini: '0.5 ~ 1 1 0.8 ~ 1 ~',
      numeric: null,
      foreign: false,
    })
    expect(serializeStepGrid(withGain)).toBe('bd hh*2 sd cp')
    // The gain really is carried — this does not pass by dropping it. Asserted on the
    // COLUMNS the values land on rather than on the whole string, because the rest of
    // the string is `serializeStepGain`'s own rendering (a sustained column reads
    // neutral `1`, not `~`) and has nothing to do with which notation was written.
    const g = serializeStepGain(withGain)
    expect(g.kind).toBe('write')
    if (g.kind !== 'write') return
    const tokens = g.value.split(' ')
    expect(tokens).toHaveLength(8)
    expect(tokens[0], '`bd` keeps its velocity').toBe('0.5')
    expect(tokens[4], '`sd` keeps its velocity').toBe('0.8')
  })

  it('a SCALAR .gain does not — it needs no column alignment', () => {
    const r = parseStepGrid('bd hh*2 sd cp')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const withGain = applyStepGain(r.model, { mini: null, numeric: 0.4, foreign: false })
    expect(serializeStepGrid(withGain)).toBe('bd hh*2 sd cp')
  })
})

describe('step grid — `*` survives an unedited write (#913)', () => {
  // `*` expands onto the grid to be SHOWN, and used to expand on the way out
  // too — opening `hh*8` and writing it back rewrote the user's line as eight
  // `hh`s. The expansion is now a fact about the view, not about their file.
  it('writes `hh*8` back as `hh*8`', () => {
    gridRoundTrips('hh*8')
  })

  it('shows the same grid as the spelled-out form (and keeps its own bytes)', () => {
    const sugar = parseStepGrid('hh*4')
    const expanded = parseStepGrid('hh hh hh hh')
    expect(sugar.ok && expanded.ok).toBe(true)
    if (!sugar.ok || !expanded.ok) return
    expect(view(sugar.model)).toEqual(view(expanded.model))
    expect(serializeStepGrid(sugar.model)).toBe('hh*4')
    expect(serializeStepGrid(expanded.model)).toBe('hh hh hh hh')
  })
})

describe('step grid — `[group]*n` (#467 nested-group multiplier)', () => {
  // `[sd hh]*2` ≡ the group played n× within its slot → the group's slots
  // repeated n times on the grid, and the user's `[sd hh]*2` back on write.
  it('binds `[sd hh]*2` (previously rejected) and expands it onto the grid', () => {
    const r = parseStepGrid('[sd hh]*2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(4)
    expect(serializeStepGrid(r.model)).toBe('[sd hh]*2')
  })

  it('handles a rest in the group and a higher count', () => {
    const r = parseStepGrid('[~ sd]*2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes).toEqual([
      { sound: 'sd', cells: [false, cellOn(), false, cellOn()] },
    ])
    expect(serializeStepGrid(r.model)).toBe('[~ sd]*2')
    expect(parseStepGrid('[sd hh]*3').ok).toBe(true)
  })

  it('composes with sibling steps (`bd [sd hh]*2`)', () => {
    const r = parseStepGrid('bd [sd hh]*2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(8)
    expect(serializeStepGrid(r.model)).toBe('bd [sd hh]*2')
  })

  it('shows the same grid as the spelled-out form', () => {
    const sugar = parseStepGrid('[sd hh]*2')
    const expanded = parseStepGrid('sd hh sd hh')
    expect(sugar.ok && expanded.ok).toBe(true)
    if (!sugar.ok || !expanded.ok) return
    expect(view(sugar.model)).toEqual(view(expanded.model))
  })

  it('applies to the piano roll too (`[60 62]*2`)', () => {
    expect(parsePianoRoll('[60 62]*2').ok).toBe(true)
    expect(parsePianoRoll('[c3 e3]*2').ok).toBe(true)
  })
})

describe('step grid — euclid survives an unedited write (#913)', () => {
  // `(k,n[,rot])` expands onto the grid the same way `*` does, and used to be
  // written back expanded — a euclid is a rhythm the user reasons about as a
  // euclid, and opening the panel destroyed it.
  it('writes `bd(3,8)` back as `bd(3,8)`', () => {
    gridRoundTrips('bd(3,8)')
  })

  it('shows the same grid as the spelled-out form', () => {
    const sugar = parseStepGrid('bd(3,8)')
    const expanded = parseStepGrid('bd ~ ~ bd ~ ~ bd ~')
    expect(sugar.ok && expanded.ok).toBe(true)
    if (!sugar.ok || !expanded.ok) return
    expect(view(sugar.model)).toEqual(view(expanded.model))
    expect(serializeStepGrid(sugar.model)).toBe('bd(3,8)')
  })
})

describe('step grid — `!` survives an unedited write (#913)', () => {
  it('writes `bd!3` back as `bd!3`', () => {
    gridRoundTrips('bd!3')
  })

  it('shows the same grid as the spelled-out form', () => {
    const sugar = parseStepGrid('bd!3')
    const expanded = parseStepGrid('bd bd bd')
    expect(sugar.ok && expanded.ok).toBe(true)
    if (!sugar.ok || !expanded.ok) return
    expect(view(sugar.model)).toEqual(view(expanded.model))
  })
})

describe('bjorklund (euclid distribution)', () => {
  it('distributes (3,8) evenly: x . . x . . x .', () => {
    expect(bjorklund(3, 8)).toEqual([
      true, false, false, true, false, false, true, false,
    ])
  })

  it('distributes (5,8): x . x x . x x .', () => {
    expect(bjorklund(5, 8)).toEqual([true, false, true, true, false, true, true, false])
  })

  it('handles degenerate counts (all rests / all pulses)', () => {
    expect(bjorklund(0, 4)).toEqual([false, false, false, false])
    expect(bjorklund(4, 4)).toEqual([true, true, true, true])
    expect(bjorklund(5, 4)).toEqual([true, true, true, true]) // k >= n
  })

  it('always places exactly k pulses across n steps', () => {
    for (const [k, n] of [
      [3, 8],
      [5, 8],
      [7, 16],
      [4, 9],
      [2, 5],
    ]) {
      expect(bjorklund(k, n).filter(Boolean).length).toBe(k)
      expect(bjorklund(k, n)).toHaveLength(n)
    }
  })
})

describe('piano roll — parse', () => {
  it('reads notes and rests at the right columns', () => {
    const r = parsePianoRoll('c3 ~ e3 g3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(4)
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'e3', start: 2, duration: 1 },
      { pitch: 'g3', start: 3, duration: 1 },
    ])
  })

  it('reads @n elongation as duration', () => {
    const r = parsePianoRoll('c3@2 e3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 2 },
      { pitch: 'e3', start: 2, duration: 1 },
    ])
  })

  /**
   * `rd:<1 3 2>` picks the sample by an ALTERNATION; `sd:[1|0]` by a random
   * choice. Both are real bakery shapes. The flat lane token cannot hold a
   * pattern, so the unit is REFUSED — never shown as a truncated `rd`, which
   * would look editable and then write `rd` back over the user's `rd:<1 3 2>`.
   * A refusal is recoverable; silent data loss is not.
   */
  it('refuses a patterned `:` variant rather than truncating the token', () => {
    // A RANDOM tail argument still refuses: `[1|0]` picks per cycle, so no finite
    // bar expansion is faithful to it.
    expect(parseStepGrid('sd hh:[1|0]').ok).toBe(false)

    // `rd:<1 3 2>` USED to refuse here, for the same reason `*<1!3 2>` did below: a
    // single-cycle projection could only have shown one of the three variants. Bar
    // expansion (#938) plus naming the `:`-variant (#1019) now show all three
    // truthfully — 3 bars, one lane per variant — and the anti-truncation property
    // this test exists for is asserted directly rather than via a refusal.
    const alt = parseStepGrid('rd:<1 3 2>')
    expect(alt.ok).toBe(true)
    if (alt.ok) {
      expect(alt.model.bars).toBe(3)
      expect(alt.model.lanes.map((l) => l.sound)).toEqual(['rd:1', 'rd:3', 'rd:2'])
      // NEVER truncated to a bare `rd` — that is the failure this guards.
      expect(alt.model.lanes.map((l) => l.sound)).not.toContain('rd')
      // and the alternation survives an edit: clearing the first arm keeps the other
      // two variants and the `<…>` shape, rather than flattening to one index
      const cleared = {
        ...alt.model,
        lanes: alt.model.lanes.map((l, i) => (i === 0 ? { ...l, cells: l.cells.map((): StepCell => false) } : l)),
      }
      expect(serializeStepGrid(cleared)).toBe('<~ rd:3 rd:2>')
    }
    gridRoundTrips('rd:<1 3 2>')

    // A tail argument patterned WITHIN the cycle is a different case, and the engine
    // settles it: `tail` is `fmap(...).appLeft(friend)`, and `appLeft` samples the
    // argument at the LEFT hap's onset — so `pulse:[0.3 0.5]` plays `["pulse", 0.3]`
    // in every cycle and the `0.5` never sounds at all. Verified against the engine,
    // not reasoned from the grammar. A one-cell `pulse:0.3` view is therefore a
    // FAITHFUL model of what plays rather than a truncation of it, and the unedited
    // round-trip below copies the original bytes verbatim, so the dead `0.5` is not
    // silently rewritten by merely opening the view.
    const inner = parseStepGrid('pulse:[0.3 0.5]')
    expect(inner.ok).toBe(true)
    if (inner.ok) {
      expect(inner.model.lanes.map((l) => l.sound)).toEqual(['pulse:0.3'])
      expect(inner.model.lanes.map((l) => l.sound)).not.toContain('pulse')
    }
    gridRoundTrips('pulse:[0.3 0.5]')
    // The `*<1!3 2>` case USED to refuse here for a display reason: the single-cycle
    // projection would have shown a bare `[0,1]` chord, silently dropping the notes
    // the operator adds in the second cycle. Bar expansion (#938) shows both cycles
    // truthfully, so that reason is gone and it now opens — see the #938 test below
    // for what its write-back does and does not preserve.
    // and on silence: `~:3` parses (rest atom + tail). The syntactic CORE still
    // refuses a bare `bd ~:3` (a `:3` on a rest is outside its subset)…
    expect(parseStepGridCore('bd ~:3').ok).toBe(false)
    // …but the leaf-anchored projection (#986) opens it: it PLAYS one bd onset,
    // and its write-back copies the `~:3` bytes verbatim rather than modelling
    // them — clearing bd yields `~ ~:3`, the variant preserved, never dropped.
    // (The old refusal reasoned "the projection can't reproduce a `:3` on a
    // rest"; leaf surgery can, by copying, so that reason is gone.)
    const restVar = parseStepGrid('bd ~:3')
    expect(restVar.ok).toBe(true)
    if (restVar.ok) expect(restVar.model.lanes.map((l) => l.sound)).toEqual(['bd'])
    gridRoundTrips('[bd ~:3] sd')
    // the plain `:variant` it must NOT over-refuse
    const ok = parseStepGrid('bd:3 sn')
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.model.lanes.map((l) => l.sound)).toContain('bd:3')
  })

  /**
   * `[c4,e4,g4,c5]*2` — a chord struck twice inside its step. Real-world shape
   * (bakery `4C5TNvel0-qB`), and the ONE regression the krill swap introduced:
   * the adapter first refused every operator on a chord, which silently took an
   * editable roll away. Caught by diffing per-tune editability over the pinned
   * corpus — the swept aggregate NETTED it away (+33 gained, −1 lost = "+32",
   * which reads as a clean win). Pinned here so it costs a unit test, not a
   * corpus run, to catch again.
   */
  it('strikes a `[chord]*n` n times inside its step', () => {
    const r = parsePianoRoll('[c3,e3]*2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'e3', start: 0, duration: 1 },
      { pitch: 'c3', start: 1, duration: 1 },
      { pitch: 'e3', start: 1, duration: 1 },
    ])
  })

  it('reads a chord as same-start notes', () => {
    const r = parsePianoRoll('[c3,e3,g3] ~')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.notes.map((n) => n.pitch)).toEqual(['c3', 'e3', 'g3'])
    expect(r.model.notes.every((n) => n.start === 0)).toBe(true)
  })

  it('expands `note*n` into n notes (shared tokenizer)', () => {
    const r = parsePianoRoll('c3*4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(4)
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'c3', start: 1, duration: 1 },
      { pitch: 'c3', start: 2, duration: 1 },
      { pitch: 'c3', start: 3, duration: 1 },
    ])
  })

  it('expands `note(k,n)` euclid via the shared tokenizer', () => {
    const r = parsePianoRoll('c3(3,8)')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(8)
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'c3', start: 3, duration: 1 },
      { pitch: 'c3', start: 6, duration: 1 },
    ])
  })

  it('expands `note!n` replicate via the shared tokenizer', () => {
    const r = parsePianoRoll('c3!3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(3)
    expect(r.model.notes).toEqual([
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'c3', start: 1, duration: 1 },
      { pitch: 'c3', start: 2, duration: 1 },
    ])
  })

  it('rejects a non-note token', () => {
    expect(parsePianoRoll('bd c3').ok).toBe(false)
  })

  it('projects melodies the two-level model cannot represent (#924)', () => {
    // A group nested inside a group (depth 3) has no place in the roll's Step→Slot
    // model, but plays an ordinary pitch×time grid — the behaviour projection shows
    // what it plays and copies the source back verbatim.
    rollRoundTrips('c3 [e3 [g3 g3]] c4')
    rollRoundTrips('0 [2 [4 4]] 7') // numeric, nested
    rollRoundTrips('[c3 e3]*2@2') // a group carrying `*` and `@`
    // an edit re-emits only the touched element; the nested group rides back
    // byte-for-byte (span surgery), and durations inside it are preserved
    expect(rollEdit('c3 [e3 [g3 g3]] c4', 0, 'a5')).toBe('a5 [e3 [g3 g3]] c4')
    expect(rollEdit('0 [2 [4 4]] 7', 0, '5')).toBe('5 [2 [4 4]] 7')
    // the numeric convention is carried through (new pitches emit numbers, #469)
    const num = parsePianoRoll('0 [2 [4 4]] 7')
    expect(num.ok && num.model.numeric).toBe(true)
    // still refused: a melody that does not play a static rational grid
    expect(parsePianoRoll('c3? e3 g3').ok).toBe(false) // `?` degrade varies per cycle
  })

  it('bar-expands a melody that varies per cycle (#938)', () => {
    // `e3*<1 2>` plays one note, then two. #924 refused it for not being static;
    // the roll now shows the period as bars, durations and all.
    const r = parsePianoRoll('c3 e3*<1 2>')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.bars).toBe(2)
    expect(serializePianoRoll(r.model)).toBe('c3 e3*<1 2>') // untouched = identity
    // an edit rewrites only the element it touched — the `e3*<1 2>` operator the
    // model cannot represent rides back byte-for-byte
    const perBar = r.model.steps / 2
    const idx = r.model.notes.findIndex((n) => n.start === perBar)
    const edited: PianoRollModel = {
      ...r.model,
      notes: r.model.notes.map((n, i) => (i === idx ? { ...n, pitch: 'a5' } : n)),
    }
    expect(serializePianoRoll(edited)).toBe('<c3 a5> e3*<1 2>')

    // HONEST LIMIT: when the whole pattern is ONE top-level element there is no
    // untouched neighbour to preserve, so an edit re-spells all of it and writes the
    // operator away. That is the projection's standing contract (`[c3 e3]*2@2`
    // behaves the same in #924), not something bar expansion introduced — but it is
    // why "opens" is not the same claim as "edits losslessly".
    const one = parsePianoRoll('[[0, 1]*<1!3 2> [2, 3]]*2')
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(serializePianoRoll(one.model)).toBe('[[0, 1]*<1!3 2> [2, 3]]*2') // identity holds
  })
})

describe('piano roll — round-trip identity', () => {
  const canonical = [
    'c3 ~ e3 g3',
    'c3@2 e3',
    '[c3,e3,g3] ~',
    'c3 e3 g3 ~',
    '~ c3 ~ e3',
    '<c3 e3>',
    '<c3@2 [e3 g3]>',
  ]
  for (const s of canonical) it(`"${s}"`, () => rollRoundTrips(s))
})

describe('pitch', () => {
  it('round-trips note ↔ midi (c3 = 48)', () => {
    expect(pitchToMidi('c3')).toBe(48)
    expect(pitchToMidi('eb4')).toBe(63)
    expect(pitchToMidi('f#2')).toBe(42)
    expect(pitchToMidi('cs3')).toBe(49)
    expect(midiToPitch(48)).toBe('c3')
    expect(midiToPitch(49)).toBe('c#3')
  })
  it('noteDisplayName uppercases the letter for the note bars (#605)', () => {
    expect(noteDisplayName(48)).toBe('C3') // c3 → C3
    expect(noteDisplayName(49)).toBe('C#3') // c#3 → C#3
    expect(noteDisplayName(64)).toBe('E4') // e4 → E4
    // it's display-only — the code token stays lowercase for round-trip fidelity
    expect(midiToPitch(48)).toBe('c3')
  })
  it('returns null for non-notes', () => {
    expect(pitchToMidi('bd')).toBeNull()
  })
  it('a bare note name (no octave) defaults to octave 3 — grounded vs Strudel (#467)', () => {
    // noteToMidi('c') === noteToMidi('c3') === 48 in @strudel/core.
    expect(pitchToMidi('c')).toBe(48)
    expect(pitchToMidi('c3')).toBe(48)
    expect(pitchToMidi('C')).toBe(48) // case-insensitive
    expect(pitchToMidi('e')).toBe(52)
    expect(pitchToMidi('g')).toBe(55)
    expect(pitchToMidi('eb')).toBe(51) // c→48, eb = 51
    expect(pitchToMidi('f#')).toBe(54)
    expect(pitchToMidi('bd')).toBeNull() // still not a note (b + stray d)
  })
  it('flags black keys', () => {
    expect(isBlackKey(49)).toBe(true) // c#3
    expect(isBlackKey(48)).toBe(false) // c3
  })
  it('labels C rows for the keyboard gutter (#430), null elsewhere', () => {
    expect(cLabel(48)).toBe('C3') // c3
    expect(cLabel(60)).toBe('C4') // c4
    expect(cLabel(49)).toBeNull() // c#3
    expect(cLabel(50)).toBeNull() // d3
    expect(cLabel(48)).toBe(midiToPitch(48).toUpperCase()) // agrees with the note token
  })
})

describe('piano roll — bare note names (#467)', () => {
  it('binds `note("c d f e")` (previously rejected for missing octaves)', () => {
    const r = parsePianoRoll('c d f e')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.notes.map((n) => n.pitch)).toEqual(['c', 'd', 'f', 'e'])
  })
  it('preserves the verbatim token on round-trip (lower-cased)', () => {
    const r = parsePianoRoll('g c g c')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(serializePianoRoll(r.model)).toBe('g c g c')
  })
  it('still rejects mixed numeric+named and true non-notes', () => {
    expect(parsePianoRoll('c 60').ok).toBe(false) // #469 XOR gate intact
    expect(parsePianoRoll('bd sd').ok).toBe(false) // sample names, not notes
  })
})

describe('placeNote', () => {
  it('trims an earlier sustaining note OF THE SAME PITCH', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 4 }] }
    const next = placeNote(model, 'c3', 2, 2)
    const [held, placed] = [...next.notes].sort((a, b) => a.start - b.start)
    expect(held).toEqual({ pitch: 'c3', start: 0, duration: 2 })
    expect(placed).toEqual({ pitch: 'c3', start: 2, duration: 2 })
  })
  // ⚠ THIS ASSERTED THE OPPOSITE UNTIL #1310, and it was the only trim case in the file —
  // it placed `e3` over a sustaining `c3` and required the `c3` to be cut. A pitch the
  // gesture never touched is a voice the user never touched; cutting it changes what the
  // document plays away from where the click landed. Measured on the corpus before the
  // rule changed: 61 of 541 placements did this, trimming 128 collateral notes.
  it('leaves a DIFFERENT pitch sustaining through the column alone', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 4 }] }
    const next = placeNote(model, 'e3', 2, 2)
    expect(next.notes.find((n) => n.pitch === 'c3')!.duration).toBe(4)
    expect(next.notes.find((n) => n.pitch === 'e3')).toEqual({ pitch: 'e3', start: 2, duration: 2 })
  })
  it('joins a chord at the same start, adopting its duration', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 2 }] }
    const next = placeNote(model, 'e3', 0, 1)
    expect(next.notes.find((n) => n.pitch === 'e3')!.duration).toBe(2)
  })
})

describe('resize', () => {
  it('spread preserves musical time when doubling steps', () => {
    const model: StepGridModel = {
      steps: 2,
      lanes: [{ sound: 'bd', cells: [cellOn(), false] }],
    }
    const next = resizeGrid(model, 4, 'spread')
    expect(next.steps).toBe(4)
    // "preserves musical time" now covers the LENGTH too: one column of a 2-column
    // grid is two columns of a 4-column one, the same half-cycle either way
    expect(next.lanes[0].cells).toEqual([cellOn(2), false, false, false])
  })
  it('pad appends empty steps', () => {
    const model: StepGridModel = {
      steps: 2,
      lanes: [{ sound: 'bd', cells: [cellOn(), cellOn()] }],
    }
    const next = resizeGrid(model, 4, 'pad')
    // pad holds step INDICES fixed, so the lengths are kept as they were and the
    // groove stretches — the opposite trade from spread, deliberately
    expect(next.lanes[0].cells).toEqual([cellOn(), cellOn(), false, false])
  })
  it('does not resize multi-bar patterns', () => {
    const model: StepGridModel = { steps: 4, bars: 2, lanes: [] }
    expect(resizeGrid(model, 8, 'spread')).toBe(model)
  })
  it('drops the source provenance — a resize re-lays every column (#913)', () => {
    // The regions describe the grid they were read from. Resizing replaces that
    // grid, so carrying them forward would let the writer paste bytes written
    // for a layout that no longer exists.
    const r = parseStepGrid('bd hh*2 sd cp')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.source).toBeDefined()
    // WHEN the resize applies it must drop the regions. `pad` still applies here (it keeps
    // every length, so nothing becomes unspellable); `spread` DOWN to 4 does not, because it
    // scales each 8-column length by 1/2 and half a column has no spelling — so it returns
    // the input by reference, regions and all, which is correct for a no-op (#1010 P4c).
    const padded = resizeGrid(r.model, 4, 'pad')
    expect(padded).not.toBe(r.model)
    expect(padded.source, 'pad must not carry stale regions').toBeUndefined()
    expect(resizeGrid(r.model, 4, 'spread'), 'spread DOWN is refused, not silently wrong').toBe(
      r.model,
    )
    // and where a resize DOES apply, the writer REBUILDS from the resized grid — the `*2` is
    // gone because the user asked for a different grid, which is the one case where losing it
    // is the answer rather than the bug. Widening spreads and keeps every length spellable.
    const wide = resizeGrid(r.model, 16, 'spread')
    expect(wide.source).toBeUndefined()
    expect(serializeStepGrid(wide)).not.toBeNull()
  })
  it('resizeRoll spread scales note starts', () => {
    const model: PianoRollModel = { steps: 2, notes: [{ pitch: 'c3', start: 1, duration: 1 }] }
    const next = resizeRoll(model, 4, 'spread')
    expect(next.notes[0].start).toBe(2)
  })
})

describe('resizeNote (single-note `@n` duration)', () => {
  it('grows a note up to the grid end', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 1 }] }
    const next = resizeNote(model, 0, 'c3', 3)
    expect(next.notes[0].duration).toBe(3)
    // serializes as `@n`
    expect(serializePianoRoll(next)).toBe('c3@3 ~')
  })

  it('lets a note sustain UNDER a later onset (overlap → parallel lanes, #628)', () => {
    const model: PianoRollModel = {
      steps: 4,
      notes: [
        { pitch: 'c3', start: 0, duration: 1 },
        { pitch: 'e3', start: 2, duration: 1 },
      ],
    }
    const next = resizeNote(model, 0, 'c3', 4) // overlaps e3@2 → now allowed (caps at grid end)
    expect(next.notes.find((n) => n.start === 0)!.duration).toBe(4)
    expect(serializePianoRoll(next)).toBe('c3@4, ~ ~ e3 ~')
  })

  it('floors the duration at 1 when shrinking', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 3 }] }
    expect(resizeNote(model, 0, 'c3', 0).notes[0].duration).toBe(1)
  })

  it('resizes ONLY the grabbed chord member, not the whole chord (#628)', () => {
    const model: PianoRollModel = {
      steps: 4,
      notes: [
        { pitch: 'c3', start: 0, duration: 1 },
        { pitch: 'e3', start: 0, duration: 1 },
      ],
    }
    const next = resizeNote(model, 0, 'c3', 3) // stretch c3 only
    expect(next.notes.find((n) => n.pitch === 'c3')!.duration).toBe(3)
    expect(next.notes.find((n) => n.pitch === 'e3')!.duration).toBe(1) // e3 untouched
    // independent durations → two parallel lanes
    expect(serializePianoRoll(next)).toContain(',')
  })

  it('multi-bar keeps the legacy no-overlap cap (lanes are single-bar only)', () => {
    // `<c3 e3>` = 2 bars, c3 onset 0 dur1, e3 onset 1 dur1; stretching c3 can hold
    // up to e3's onset (a held bar `<c3@2 ...>`) but never overlap it.
    const model: PianoRollModel = {
      steps: 2,
      bars: 2,
      notes: [
        { pitch: 'c3', start: 0, duration: 1 },
        { pitch: 'e3', start: 1, duration: 1 },
      ],
    }
    const next = resizeNote(model, 0, 'c3', 5) // would overlap → capped at e3's onset (1)
    expect(next.notes.find((n) => n.pitch === 'c3')!.duration).toBe(1)
    expect(serializePianoRoll(next)).not.toBeNull() // still expressible (no dropped write)
  })

  it('the resized model re-parses to the same model (stable)', () => {
    const model: PianoRollModel = { steps: 4, notes: [{ pitch: 'c3', start: 0, duration: 1 }] }
    const resized = resizeNote(model, 0, 'c3', 2)
    const text = serializePianoRoll(resized)!
    const reparsed = parsePianoRoll(text)
    expect(reparsed.ok).toBe(true)
    // compare the VIEW, not the bytes: a re-parse carries the `source` it read
    // (#916 span surgery), which a from-scratch model has no reason to hold —
    // "same notes, different provenance" is the same view.
    //
    // ⚠ `surgical` JOINED `source` IN THAT CATEGORY AT #1233. A re-parse of a core-opened
    // pattern now also carries the leaf-span overlay, which is provenance for the same
    // reason: it says where this model's bytes came from, and a hand-built model has none.
    // Asserted present rather than merely dropped, so this arm cannot go green by the
    // attachment disappearing.
    if (reparsed.ok) {
      expect(reparsed.model.surgical, 'the overlay should reach a re-parsed roll').toBeTruthy()
      const { source: _s, surgical: _o, ...view } = reparsed.model
      expect(view).toEqual(resized)
    }
  })
})

/** ChunkGain constructors for the apply* tests */
const strGain = (mini: string) => ({ mini, numeric: null, foreign: false })
const numGain = (n: number) => ({ mini: null, numeric: n, foreign: false })
const noGain = { mini: null, numeric: null, foreign: false }
const foreignGain = { mini: null, numeric: null, foreign: true }

describe('step grid — velocity (.gain)', () => {
  const base = (steps: number, gains?: number[]): StepGridModel => ({
    steps,
    lanes: [{ sound: 'bd', cells: Array<StepCell>(steps).fill(cellOn()) }],
    ...(gains ? { gains } : {}),
  })

  describe('parseGainMini', () => {
    it('reads a flat numeric gain into per-position values', () => {
      expect(parseGainMini('1 0.5 1 0.25', 4)).toEqual([1, 0.5, 1, 0.25])
    })
    it('reads a `~` (rest column) as neutral 1', () => {
      expect(parseGainMini('1 ~ 0.5 ~', 4)).toEqual([1, 1, 0.5, 1])
    })
    it('rejects a wrong token count (a broadcast `.gain("0.8")`)', () => {
      expect(parseGainMini('0.8', 4)).toBeNull()
      expect(parseGainMini('1 0.5', 4)).toBeNull()
    })
    it('rejects a non-numeric / sub-divided gain we did not write', () => {
      expect(parseGainMini('1 0.5@2 1', 3)).toBeNull()
      expect(parseGainMini('1 [0.5 0.5] 1', 3)).toBeNull()
      expect(parseGainMini('loud soft', 2)).toBeNull()
    })
  })

  describe('serializeStepGain', () => {
    it('clears (removes .gain) when every column is neutral', () => {
      expect(serializeStepGain(base(4))).toEqual({ kind: 'clear' })
      expect(serializeStepGain(base(4, [1, 1, 1, 1]))).toEqual({ kind: 'clear' })
    })
    it('collapses a uniform non-1 level to a scalar .gain(v)', () => {
      expect(serializeStepGain(base(4, [0.4, 0.4, 0.4, 0.4]))).toEqual({
        kind: 'write',
        value: '0.4',
        quoted: false,
      })
    })
    it('writes a quoted per-column string for mixed levels, rests as `~`', () => {
      const m: StepGridModel = {
        steps: 4,
        lanes: [{ sound: 'bd', cells: [cellOn(), false, cellOn(), cellOn()] }],
        gains: [1, 1, 0.5, 0.25],
      }
      // column 1 is a rest (bd off) → `~`, regardless of its stored gain
      expect(serializeStepGain(m)).toEqual({ kind: 'write', value: '1 ~ 0.5 0.25', quoted: true })
    })
    it('ignores rest columns when deciding uniform-collapse', () => {
      // active columns 0 & 2 both 0.4 (col 1 is a rest) → collapses to a scalar
      const m: StepGridModel = {
        steps: 3,
        lanes: [{ sound: 'bd', cells: [cellOn(), false, cellOn()] }],
        gains: [0.4, 1, 0.4],
      }
      expect(serializeStepGain(m)).toEqual({ kind: 'write', value: '0.4', quoted: false })
    })
    it('skips (leaves .gain untouched) for multi-bar, `,`-stack, or foreign', () => {
      expect(serializeStepGain({ ...base(4, [1, 0.5, 1, 1]), bars: 2 })).toEqual({ kind: 'skip' })
      expect(
        serializeStepGain({
          steps: 2,
          lanes: [
            { sound: 'bd', part: 0, cells: [cellOn(), false] },
            { sound: 'hh', part: 1, cells: [cellOn(), cellOn()] },
          ],
          gains: [0.5, 0.5],
        }),
      ).toEqual({ kind: 'skip' })
      expect(serializeStepGain({ ...base(4, [1, 0.5, 1, 1]), gainForeign: true })).toEqual({
        kind: 'skip',
      })
    })
  })

  describe('applyStepGain', () => {
    it('leaves the model neutral when there is no .gain', () => {
      const m = base(4)
      expect(applyStepGain(m, noGain)).toBe(m)
    })
    it('reads a scalar .gain(0.4) as a uniform base on every column', () => {
      expect(applyStepGain(base(4), numGain(0.4)).gains).toEqual([0.4, 0.4, 0.4, 0.4])
    })
    it('reads an aligned string .gain onto the columns', () => {
      const r = applyStepGain(base(4), strGain('1 0.5 1 0.25'))
      expect(r.gains).toEqual([1, 0.5, 1, 0.25])
      expect(r.gainForeign).toBeUndefined()
    })
    it('flags foreign (hands off) when the string .gain does not align', () => {
      expect(applyStepGain(base(4), strGain('0.8')).gainForeign).toBe(true) // broadcast (1 ≠ 4)
      expect(applyStepGain(base(3), strGain('1 0.5@2 1')).gainForeign).toBe(true) // sub-divided
    })
    it('flags foreign for a .gain arg we do not manage (a signal)', () => {
      expect(applyStepGain(base(4), foreignGain).gainForeign).toBe(true)
    })
  })

  it('round-trips: column gains → .gain mini → parse back ≡ gains', () => {
    const stepMini = 'bd ~ sn hh'
    const gains = [1, 1, 0.8, 0.5] // col 1 is a rest → serialized as `~`
    const seed = parseStepGrid(stepMini)
    expect(seed.ok).toBe(true)
    if (!seed.ok) return
    const withGain: StepGridModel = { ...seed.model, gains }
    // the head mini is unchanged by velocity
    expect(serializeStepGrid(withGain)).toBe(stepMini)
    const g = serializeStepGain(withGain)
    expect(g).toEqual({ kind: 'write', value: '1 ~ 0.8 0.5', quoted: true })
    // re-reading the serialized gain reproduces the per-column values
    if (g.kind !== 'write') return
    const fresh = parseStepGrid(stepMini)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(applyStepGain(fresh.model, strGain(g.value)).gains).toEqual([1, 1, 0.8, 0.5])
  })

  /**
   * ⚠ THE ASSERTION ABOVE IS THE RIGHT ONE AND ITS FIXTURE COULD NOT FAIL IT (#1123).
   * "the head mini is unchanged by velocity" is exactly the property — asserted on
   * `bd ~ sn hh`, which is already flat, so re-spelling it flat is the identity. The
   * writer rebuilt every structured pattern in the corpus for years underneath it.
   *
   * These fixtures have grouping, an operator, a stack and a held note, so their
   * representation can differ from their value. Same property, on input that can say so.
   */
  it.each([
    ['a group', 'bd [hh hh] sn cp'],
    ['an operator', 'bd hh*2 sn cp'],
    ['a held note', 'bd@2 hh sn'],
    // NOT a `,`-stack: `serializeStepGain` returns `skip` for those by design, so the
    // gain never reaches the writer and the fixture would assert nothing.
  ])('velocity leaves a structured pattern spelled as written — %s', (_shape, mini) => {
    const seed = parseStepGrid(mini)
    expect(seed.ok).toBe(true)
    if (!seed.ok) return
    const before = serializeStepGrid(seed.model)
    expect(before).toBe(mini) // the fixture really does round-trip to itself

    const gains = Array<number>(seed.model.steps).fill(1)
    gains[0] = 0.42
    const withGain: StepGridModel = { ...seed.model, gains }

    expect(serializeStepGrid(withGain), 'a velocity change is not a notation change').toBe(mini)
    // …and the velocity really was written, so this is not passing by doing nothing
    const g = serializeStepGain(withGain)
    expect(g.kind).toBe('write')
    if (g.kind === 'write') expect(g.value.startsWith('0.42')).toBe(true)
  })

  it('round-trips a scalar base: .gain(0.4) → uniform gains → .gain(0.4)', () => {
    const seed = parseStepGrid('bd hh sn hh')
    if (!seed.ok) return
    const m = applyStepGain(seed.model, numGain(0.4))
    expect(serializeStepGain(m)).toEqual({ kind: 'write', value: '0.4', quoted: false })
  })
})

describe('piano roll — velocity (.gain)', () => {
  const withGains = (mini: string, gains: Record<number, number>): PianoRollModel => {
    const r = parsePianoRoll(mini)
    if (!r.ok) throw new Error(`expected ${mini} to parse`)
    return {
      ...r.model,
      notes: r.model.notes.map((n) => (gains[n.start] != null ? { ...n, gain: gains[n.start] } : n)),
    }
  }

  describe('serializeRollGain', () => {
    it('clears when every note is neutral', () => {
      expect(serializeRollGain(withGains('c3 e3 g3', {}))).toEqual({ kind: 'clear' })
    })
    it('collapses a uniform non-1 level to a scalar .gain(v)', () => {
      const m = withGains('c3 e3 g3', { 0: 0.4, 1: 0.4, 2: 0.4 })
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '0.4', quoted: false })
    })
    it('writes a quoted token per note group, rests as `~`', () => {
      // c3@0, e3@2 (col1 is a rest)
      const m = withGains('c3 ~ e3', { 0: 1, 2: 0.5 })
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '1 ~ 0.5', quoted: true })
    })
    it('mirrors `@n` holds in the gain token', () => {
      const m = withGains('c3@2 e3', { 0: 0.5, 2: 1 })
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '0.5@2 1', quoted: true })
    })
    it('emits one shared token for a chord (per-chord velocity)', () => {
      // [c3,e3] is one group at col 0 → one gain token for both
      const m = withGains('[c3,e3] g3', { 0: 0.66 })
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '0.66 1', quoted: true })
    })
    it('skips a chord whose members carry different gains (inexpressible)', () => {
      const r = parsePianoRoll('[c3,e3]')
      if (!r.ok) throw new Error('parse')
      const m: PianoRollModel = {
        ...r.model,
        notes: [
          { ...r.model.notes[0], gain: 0.5 },
          { ...r.model.notes[1], gain: 0.8 },
        ],
      }
      expect(serializeRollGain(m)).toEqual({ kind: 'skip' })
    })
    it('collapses a uniform multi-bar (perBar===1) level to a scalar (#632)', () => {
      const alt = withGains('<c3 e3>', {}) // steps 2, bars 2 → perBar 1
      const m = { ...alt, bars: 2, notes: alt.notes.map((n) => ({ ...n, gain: 0.5 })) }
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '0.5', quoted: false })
    })
    it('writes a mixed multi-bar (perBar===1) gain wrapped in <...> (#632)', () => {
      const alt = withGains('<c3 e3>', { 0: 0.5, 1: 1 }) // bar0 0.5, bar1 neutral
      const m = { ...alt, bars: 2 }
      expect(serializeRollGain(m)).toEqual({ kind: 'write', value: '<0.5 1>', quoted: true })
    })
    it('skips a subdivided multi-bar (perBar>1, steps!==bars) (#632)', () => {
      const m = withGains('<[c3 e3] g3>', { 0: 0.5 }) // steps 4, bars 2 → perBar 2
      expect(serializeRollGain(m)).toEqual({ kind: 'skip' })
    })
    it('skips foreign', () => {
      expect(serializeRollGain({ ...withGains('c3 e3', { 0: 0.5 }), gainForeign: true })).toEqual({ kind: 'skip' })
    })
  })

  describe('applyRollGain', () => {
    it('reads a scalar .gain(0.4) as a uniform base on every note', () => {
      const r = parsePianoRoll('c3 e3 g3')
      if (!r.ok) throw new Error('parse')
      const m = applyRollGain(r.model, numGain(0.4))
      expect(m.notes.every((n) => n.gain === 0.4)).toBe(true)
    })
    it('reads an aligned string .gain onto the notes by start column', () => {
      const r = parsePianoRoll('c3 ~ e3')
      if (!r.ok) throw new Error('parse')
      const m = applyRollGain(r.model, strGain('1 ~ 0.5'))
      expect(m.notes.find((n) => n.start === 2)!.gain).toBe(0.5)
      expect(m.notes.find((n) => n.start === 0)!.gain).toBeUndefined() // neutral stays bare
      expect(m.gainForeign).toBeUndefined()
    })
    it('applies one chord gain to all its members', () => {
      const r = parsePianoRoll('[c3,e3] g3')
      if (!r.ok) throw new Error('parse')
      const m = applyRollGain(r.model, strGain('0.66 1'))
      const chord = m.notes.filter((n) => n.start === 0)
      expect(chord.length).toBe(2)
      expect(chord.every((n) => n.gain === 0.66)).toBe(true)
    })
    it('flags foreign for a grid-mismatched or non-numeric gain', () => {
      const r = parsePianoRoll('c3 e3')
      if (!r.ok) throw new Error('parse')
      expect(applyRollGain(r.model, strGain('1 0.5 1')).gainForeign).toBe(true) // 3 tokens vs 2 cols
      expect(applyRollGain(r.model, strGain('loud soft')).gainForeign).toBe(true)
    })
    it('reads a multi-bar (perBar===1) <...> gain onto the notes by bar (#632)', () => {
      const r = parsePianoRoll('<c3 e3>') // bars 2, steps 2 → perBar 1
      if (!r.ok) throw new Error('parse')
      expect(r.model.bars).toBe(2)
      const m = applyRollGain(r.model, strGain('<0.5 1>'))
      expect(m.gainForeign).toBeUndefined()
      expect(m.notes.find((n) => n.start === 0)!.gain).toBe(0.5)
      expect(m.notes.find((n) => n.start === 1)!.gain).toBeUndefined() // neutral stays bare
    })
    it('flags foreign for a subdivided multi-bar (perBar>1) gain (#632)', () => {
      const r = parsePianoRoll('<[c3 e3] g3>') // bars 2, steps 4 → perBar 2
      if (!r.ok) throw new Error('parse')
      expect(applyRollGain(r.model, strGain('<0.5 1 1 1>')).gainForeign).toBe(true)
    })
  })

  it('round-trips: note gains → .gain mini → parse back ≡ gains', () => {
    const rollMini = 'c3 ~ [c4,e4]@2'
    const m = withGains(rollMini, { 0: 0.8, 2: 0.4 })
    expect(serializePianoRoll(m)).toBe(rollMini) // head mini unchanged by velocity
    const g = serializeRollGain(m)
    expect(g).toEqual({ kind: 'write', value: '0.8 ~ 0.4@2', quoted: true })
    if (g.kind !== 'write') return
    const fresh = parsePianoRoll(rollMini)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    const reread = applyRollGain(fresh.model, strGain(g.value))
    expect(reread.notes.find((n) => n.start === 0)!.gain).toBe(0.8)
    expect(reread.notes.filter((n) => n.start === 2).every((n) => n.gain === 0.4)).toBe(true)
  })

  it('round-trips multi-bar (perBar===1) chord gains via <...> (#632)', () => {
    // the reported shape: one chord per bar, each bar a single column
    const rollMini = '<[f2,ab2,c3] [db2,f2,ab2] [ab1,c2,eb2] [eb2,g2,bb2]>'
    const fresh = parsePianoRoll(rollMini)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.model.bars).toBe(4)
    expect(fresh.model.steps).toBe(4)
    // give bars 0 and 2 a non-neutral velocity (chord members share it)
    const m: PianoRollModel = {
      ...fresh.model,
      notes: fresh.model.notes.map((n) =>
        n.start === 0 ? { ...n, gain: 0.5 } : n.start === 2 ? { ...n, gain: 0.3 } : n,
      ),
    }
    expect(serializePianoRoll(m)).toBe(rollMini) // head mini unchanged by velocity
    const g = serializeRollGain(m)
    expect(g).toEqual({ kind: 'write', value: '<0.5 1 0.3 1>', quoted: true })
    if (g.kind !== 'write') return
    const reread = applyRollGain(fresh.model, strGain(g.value))
    expect(reread.gainForeign).toBeUndefined()
    expect(reread.notes.filter((n) => n.start === 0).every((n) => n.gain === 0.5)).toBe(true)
    expect(reread.notes.filter((n) => n.start === 2).every((n) => n.gain === 0.3)).toBe(true)
    expect(reread.notes.filter((n) => n.start === 1).every((n) => n.gain === undefined)).toBe(true)
  })
})

// ── #628 parallel-lane piano roll (independent note durations / overlap) ──────
describe('#628 parallel note lanes', () => {
  const m = (steps: number, notes: PianoRollModel['notes']): PianoRollModel => ({ steps, notes })
  const reparse = (mini: string): PianoRollModel => {
    const r = parsePianoRoll(mini)
    if (!r.ok) throw new Error(`expected ${mini} to parse: ${r.reason}`)
    return r.model
  }

  it('an empty (all-rest) roll serializes the grid, not an empty string', () => {
    expect(serializePianoRoll(m(4, []))).toBe('~ ~ ~ ~')
  })

  it('a non-overlapping roll stays single-lane (no comma, unchanged)', () => {
    expect(serializePianoRoll(m(4, [
      { pitch: 'c3', start: 0, duration: 1 },
      { pitch: 'e3', start: 2, duration: 1 },
    ]))).toBe('c3 ~ e3 ~')
  })

  it('independent chord-note durations → parallel lanes', () => {
    // c3 held 2 steps + e3 held 1 step, both onset at 0 → two lanes
    const s = serializePianoRoll(m(4, [
      { pitch: 'c3', start: 0, duration: 2 },
      { pitch: 'e3', start: 0, duration: 1 },
    ]))
    expect(s).toContain(',') // two lanes
    expect(s).toContain('c3@2')
    // round-trips back to the same note set
    const back = reparse(s!).notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`).sort()
    expect(back).toEqual(['c3@0:2', 'e3@0:1'])
  })

  it('a note sustaining UNDER a later onset (stretch-over) serializes', () => {
    const s = serializePianoRoll(m(4, [
      { pitch: 'c3', start: 0, duration: 2 }, // sustains over e3's onset at step 1
      { pitch: 'e3', start: 1, duration: 1 },
      { pitch: 'g3', start: 2, duration: 1 },
      { pitch: 'a3', start: 3, duration: 1 },
    ]))
    expect(s).toBe('c3@2 g3 a3, ~ e3 ~ ~')
    const back = reparse(s!).notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`).sort()
    expect(back).toEqual(['a3@3:1', 'c3@0:2', 'e3@1:1', 'g3@2:1'])
  })

  it('round-trips: parse(serialize(m)) ≡ m for an overlapping model', () => {
    const model = m(8, [
      { pitch: 'c3', start: 0, duration: 4 },
      { pitch: 'e3', start: 1, duration: 1 },
      { pitch: 'g3', start: 4, duration: 4 },
    ])
    const s = serializePianoRoll(model)
    expect(s).not.toBeNull()
    const back = reparse(s!)
    expect(back.steps).toBe(8)
    expect(back.notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`).sort())
      .toEqual(['c3@0:4', 'e3@1:1', 'g3@4:4'])
    // stable: serialize(parse(serialize(m))) === serialize(m)
    expect(serializePianoRoll(back)).toBe(s)
  })

  it('parses a hand-written aligned comma-stack', () => {
    const back = reparse('c3@2 ~ ~, e3 ~ ~ ~')
    expect(back.steps).toBe(4)
    expect(back.notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`).sort())
      .toEqual(['c3@0:2', 'e3@0:1'])
  })

  it('parts of different widths share the finest grid (#1849)', () => {
    // 3 columns against 4 used to be refused here — the lane writer indexes every part
    // in ONE column space, and nothing put the parts in it — and the pattern opened only
    // through the leaf reading, with no written steps. Strudel fits every `,`-part to the
    // cycle, so the parts share lcm(3, 4) = 12 columns, as the grid's stack does, and
    // each part's notes and regions are scaled into them.
    const r = parsePianoRollCore('c3 ~ ~, e3 ~ ~ ~')
    if (!r.ok || !r.model.source) throw new Error('expected the stack to open with its written steps')
    const m = r.model
    expect(m.steps).toBe(12)
    expect(m.notes.map((n) => `${n.pitch}@${n.start}:${n.duration}`)).toEqual(['c3@0:4', 'e3@0:3'])
    expect(m.source!.parts.map((p) => p.regions.map((g) => `${g.raw.trim()}[${g.from},${g.to})`))).toEqual([
      ['c3[0,4)', '~[4,8)', '~[8,12)'],
      ['e3[0,3)', '~[3,6)', '~[6,9)', '~[9,12)'],
    ])
    // the write-back: every byte of the other part is untouched
    expect(serializePianoRoll(m)).toBe('c3 ~ ~, e3 ~ ~ ~')
    const c3 = m.notes.find((n) => n.pitch === 'c3')!
    expect(serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== c3) })).toBe('~ ~ ~, e3 ~ ~ ~')
    const e3 = m.notes.find((n) => n.pitch === 'e3')!
    expect(serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== e3) })).toBe('c3 ~ ~, ~ ~ ~ ~')
  })

  it('a part the flat reading refuses is read as it would be alone (#1849)', () => {
    // `d6*2@2 f#6 e6` is refused by the core (`*` with `@`), and opened alone by the
    // lone-part chain — so the stack now asks that chain, and keeps the answer: one flat
    // part, its first written step weighted 2 as Strudel counts it.
    const r = parsePianoRoll('[b4,d4,f#4],d6*2@2 f#6 e6')
    if (!r.ok || !r.model.source) throw new Error('expected the stack to open with its written steps')
    expect(r.model.source.parts).toHaveLength(2)
    expect(r.model.source.parts[1].regions.map((g) => `${g.raw.trim()}×${g.weight ?? 1}`)).toEqual([
      'd6*2@2×2',
      'f#6×1',
      'e6×1',
    ])
    expect(serializePianoRoll(r.model)).toBe('[b4,d4,f#4],d6*2@2 f#6 e6')
  })

  it('lanes of the same fractional width still read back — a moved note is written that way (#1849)', () => {
    // the writer spells a moved note on `c4@1.5 e4@1.2` (2.7 columns) as two comma-lanes
    // of that width, and the gesture reads it back; a common multiple of 2.7 does not exist
    const r = parsePianoRollCore('~ c4@1.5 ~@0.2, ~ ~@0.5 e4@1.2')
    if (!r.ok) throw new Error(r.reason)
    expect(r.model.steps).toBeCloseTo(2.7)
    // unequal fractional widths are refused, as they were
    expect(parsePianoRollCore('c4@1.5, e4@1.2').ok).toBe(false)
  })

  it('a part whose own reading is bar-wise still refuses the stack (#1849 control)', () => {
    // `<G4 A4 Bb4 A4>` alone opens bar by bar, with a `<`…`>` wrapper — a shape a stack
    // part cannot hold — so the stack stays with the leaf reading
    const r = parsePianoRoll('<G4 A4 Bb4 A4>,Bb3,D3')
    if (!r.ok) throw new Error('expected the roll to open')
    expect(r.model.source).toBeUndefined()
  })
})

/**
 * #904 — an underscore inside a sound name is a NAME character, not syntax.
 *
 * `_` means elongation only as a STANDALONE token (`bd _` = `bd@2`). Attached
 * to a word it belongs to the name — which is how Strudel itself reads it
 * (verified against `@strudel/mini/krill-parser.js`):
 *
 *   "gm_agogo" -> atom "gm_agogo"   "bd _"   -> "bd" weight=2
 *   "bd_"      -> atom "bd_"        "bd _ _" -> "bd" weight=3
 *
 * A blanket char-class in `tokenize` treated every `_` as a mini-notation
 * feature, so EVERY General MIDI sound (`gm_*`) and every underscore-named
 * bank (`LinnDrum_bd`) was refused from the grid — reported as "uses
 * mini-notation features beyond the editable subset", though no such feature
 * was present. Same class of bug as the decimal point in `@0.5` (#903).
 */
describe('#904 — underscores in sound names vs `_` elongation', () => {
  it('opens a General MIDI sound (gm_*) — the whole family was refused', () => {
    const r = parseStepGrid('gm_agogo bd')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['gm_agogo', 'bd'])
  })

  it('opens an underscore-named bank sample, with its :variant intact', () => {
    const r = parseStepGrid('LinnDrum_bd passerine_snare:1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['LinnDrum_bd', 'passerine_snare:1'])
  })

  it('round-trips an underscore name unchanged', () => {
    const r = parseStepGrid('gm_agogo ~ gm_agogo ~')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(serializeStepGrid(r.model)).toBe('gm_agogo ~ gm_agogo ~')
  })

  it('a trailing underscore is still a name (Strudel reads `bd_` as one atom)', () => {
    const r = parseStepGrid('bd_ sd')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['bd_', 'sd'])
  })

  // The boundary #904 actually guards: a standalone `_` is elongation sugar and
  // must never be read as a sound NAME. The syntactic core still declines it
  // (elongation is not the grid's subset), and — the real invariant — `_` never
  // appears as a lane. The leaf projection (#986) now OPENS `bd _`, showing the
  // single bd onset it plays and copying the `_` back verbatim on edit; that is
  // an onset view, not the char-class bug this test was written against.
  it('never reads a standalone `_` as a sound name (#904)', () => {
    for (const src of ['bd _', 'bd _ _']) {
      expect(parseStepGridCore(src).ok, `core should refuse ${src}`).toBe(false)
      const full = parseStepGrid(src)
      // whether or not the projection opens it, `_` is never a lane
      if (full.ok) expect(full.model.lanes.every((l) => l.sound !== '_')).toBe(true)
    }
    // `_ bd` (leading elongation) has no onset to anchor and stays refused
    expect(parseStepGrid('_ bd').ok).toBe(false)
  })

  // `bd _sd` is the sharpest case: Strudel reads it as `bd@2 sd`, so a char-class
  // that took `_sd` for a NAME would invent a sound nobody wrote. This used to be
  // asserted as a flat refusal — the safe answer while no writer could show the
  // pattern truthfully. The leaf projection can: it draws the two onsets Strudel
  // actually plays and splices each note's own bytes. So the invariant is held
  // where it belongs — on what the view SAYS, not on whether it opens.
  it('never invents a sound from a leading `_` (#904), even now that it opens', () => {
    const r = parseStepGrid('bd _sd')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Strudel's reading, not a guess at one: bd elongated over two of three slots,
    // then sd — never a lane called `_sd` or `_`
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['bd', 'sd'])
    expect(r.model.steps).toBe(3)
    // "elongated over two of three slots" is in the model now, not just the comment
    expect(r.model.lanes[0].cells).toEqual([cellOn(2), false, false])
    expect(r.model.lanes[1].cells).toEqual([false, false, cellOn()])
    // and an edit touches only that note's bytes — the `_` rides back verbatim
    const sd = r.model.lanes[1]
    const lanes = r.model.lanes.map((l) =>
      l === sd ? { ...l, cells: l.cells.map((): StepCell => false) } : l,
    )
    expect(serializeStepGrid({ ...r.model, lanes })).toBe('bd _~')
  })
})

/**
 * #991 — the leaf projection's period cap is its OWN, and it is per-surface.
 *
 * `MAX_PROJECT_BARS = 4` is the ELEMENT writer's bound, and its stated reason is
 * re-emit readability: `spliceAltGrid` respells an edited element as `<b0 b1 …>`,
 * one slot per bar, so a long period turns one cell toggle into a wall of
 * alternation. The leaf writer never gets there — `serializeStepGrid` branches on
 * `leafSource` first and that branch is terminal — so the bound does not apply to
 * it, and the grid looks out to twelve bars.
 *
 * The roll stays at four ON PURPOSE. Measured at 6/8/12/16 bars its writer-reach
 * does not move (73 at every one of them) while the views it would add are 13–58%
 * live, because long-period roll patterns are built from `!n`/`@n` repetition and
 * their notes share leaves. These tests hold both halves: the grid's gain, and the
 * roll's deliberate refusal — so raising the roll later has to be a decision, not
 * an accident.
 */
describe('#991 — the leaf period cap, per surface', () => {
  it('opens a grid whose period is 8 bars — beyond the element writer\'s cap', () => {
    // one sample stretched over eight cycles: period 8, one column per bar
    const r = parseStepGrid('hacking/8')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.leafSource, 'must be the LEAF projection, not the element one').toBeTruthy()
    expect(r.model.bars).toBe(8)
    expect(r.model.steps).toBe(8)
    // and it is live: clearing the sounding cell writes back by byte surgery
    const on = r.model.lanes.find((l) => l.cells.some(Boolean))!
    const col = on.cells.findIndex(Boolean)
    const lanes = r.model.lanes.map((l) =>
      l === on ? { ...l, cells: l.cells.map((c, j) => (j === col ? false : c)) } : l,
    )
    expect(serializeStepGrid({ ...r.model, lanes })).toBe('~/8')
  })

  it('still refuses a grid that does not repeat within twelve bars', () => {
    // period 13 — past the cap, and past what PERIOD_PROBE = 24 can VERIFY anyway
    const r = parseStepGrid('bd/13')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe('unstable-period')
    expect(r.reason).toContain('12 bars')
  })

  it('holds the roll at four bars, and says four when it refuses', () => {
    const r = parsePianoRoll('<G1 D1 <D1 D1 D1 A1>>')
    expect(r.ok, 'the roll deliberately does not look past 4 bars (#991)').toBe(false)
    if (r.ok) return
    expect(r.gate).toBe('unstable-period')
    // the sentence must name the cap that ACTUALLY stopped it, not the grid's
    expect(r.reason).toContain('4 bars')
  })
})

/**
 * #994 — the edit-safety probe used to fail on its own marker.
 *
 * `PROBE_SOUND` was `__stave_probe__`, and `_` is mini's elongation token, so
 * splicing it anywhere but column 0 elongated the element before it and handed the
 * probe a pattern one slot too long. The projections read that as "the writer would
 * not reproduce this" and declined `edit-unsafe` — for 45 corpus patterns whose
 * write-back was fine all along. The grammar property is held in `krillContract`;
 * these are the patterns, so a regression shows up as lost VIEWS and not only as a
 * lost invariant.
 */
describe('#994 — patterns the probe marker used to refuse', () => {
  it('opens `<bd hh sd hh>*2` and clears a cell by byte surgery', () => {
    const r = parseStepGrid('<bd hh sd hh>*2')
    expect(r.ok, 'refused before #994 as edit-unsafe').toBe(true)
    if (!r.ok) return
    expect(r.model.bars).toBe(2)
    expect(r.model.steps).toBe(4)
    // the alternation's four sounds sit one per column across the two bars
    expect(r.model.lanes.map((l) => l.sound)).toEqual(['bd', 'hh', 'sd'])
    const bd = r.model.lanes[0]
    const lanes = r.model.lanes.map((l) =>
      l === bd ? { ...l, cells: l.cells.map((): StepCell => false) } : l,
    )
    // only `bd`'s own bytes move; the `*2` and the brackets ride back verbatim
    expect(serializeStepGrid({ ...r.model, lanes })).toBe('<~ hh sd hh>*2')
  })

  it('opens a slowed alternation of sample names', () => {
    const r = parseStepGrid('<kalimba piano folkharp square>/3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.steps).toBe(12)
    const first = r.model.lanes[0]
    const lanes = r.model.lanes.map((l) =>
      l === first ? { ...l, cells: l.cells.map((): StepCell => false) } : l,
    )
    expect(serializeStepGrid({ ...r.model, lanes })).toBe('<~ piano folkharp square>/3')
  })
})

/**
 * #1849 — a `,`-part the flat reading refuses is read as it would be alone.
 *
 * `gridFromStack` used to read each part with the flat tokenizer only, so one `@` or `!`
 * group in any part sent the WHOLE pattern to the leaf reading: no written steps, and
 * edit-only — though each part, written alone, opened with both. The stack now asks the
 * lone-part chain for such a part and keeps its answer when it is one flat part.
 */
describe('#1849 grid stack parts read as they would be alone', () => {
  it('`bd@3 sd, hh!6` opens with both parts and their weights', () => {
    const r = parseStepGrid('bd@3 sd, hh!6')
    if (!r.ok || !r.model.source) throw new Error('expected the stack to open with its written steps')
    const parts = r.model.source.parts
    expect(r.model.steps).toBe(12)
    expect(parts.map((p) => p.factor)).toEqual([3, 2])
    expect(parts.map((p) => p.regions.map((g) => `${g.raw.trim()}×${g.weight ?? 1}`))).toEqual([
      ['bd@3×3', 'sd×1'],
      ['hh!6×6'],
    ])
    expect(serializeStepGrid(r.model)).toBe('bd@3 sd, hh!6')
    // an edit in one part leaves the other's bytes alone
    const lanes = r.model.lanes.map((l) =>
      l.sound === 'sd' ? { ...l, cells: l.cells.map(() => false as StepCell) } : l,
    )
    expect(serializeStepGrid({ ...r.model, lanes })).toBe('bd@3 ~, hh!6')
  })

  it('a flat-read stack is unchanged (control)', () => {
    const r = parseStepGrid('bd sd, hh*4')
    if (!r.ok || !r.model.source) throw new Error('expected the stack to open with its written steps')
    expect(r.model.source.parts.map((p) => p.factor)).toEqual([2, 1])
    expect(serializeStepGrid(r.model)).toBe('bd sd, hh*4')
  })

  it('a part read bar by bar from a `<…>` ELEMENT still refuses the stack (control)', () => {
    // A whole-`<…>` part now reads with repeats (`stackRepeats.test.ts`); a part whose
    // `<…>` is one element among others comes back as `altSource`, which a stack part
    // cannot hold, so the pattern keeps the leaf reading.
    const r = parseStepGrid('bd sd <bd sd> sd, hh*8')
    if (!r.ok) throw new Error('expected the grid to open')
    expect(r.model.source).toBeUndefined()
  })
})
