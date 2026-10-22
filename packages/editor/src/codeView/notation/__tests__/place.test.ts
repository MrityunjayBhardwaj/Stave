/**
 * `toggleCell` — the grid's placement gesture, stated at the layer that owns it.
 *
 * The corpus sweeps already exercise this over every real-world mini, and they
 * are what proves it holds at scale. This file is the other half: the contract in
 * a form you can read, at the module the gesture lives in, so the next change to
 * what a toggle does has somewhere obvious to state itself (#1048).
 */
import { describe, it, expect } from 'vitest'
import { parsePianoRoll, parseStepGrid } from '../parse'
import { serializePianoRoll, serializeStepGrid } from '../serialize'
import { canToggleCell, pasteNote, toggleCell, viewPlacesNotes } from '../place'
import { cellOn, isCellOn } from '../model'
import type { PianoRollModel, StepGridModel } from '../model'

function parse(s: string): StepGridModel {
  const r = parseStepGrid(s)
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`)
  return r.model
}

describe('toggleCell — the one definition of what a cell click does (#1048)', () => {
  it('places a hit lasting exactly the column clicked', () => {
    const m = toggleCell(parse('bd ~ sd ~'), 0, 1, true)
    expect(m.lanes[0].cells[1]).toEqual(cellOn())
    expect(serializeStepGrid(m)).toBe('bd bd sd ~')
  })

  it('clears a hit, leaving the rest of the lane alone', () => {
    const m = toggleCell(parse('bd bd sd ~'), 0, 1, false)
    expect(isCellOn(m.lanes[0].cells[1])).toBe(false)
    expect(serializeStepGrid(m)).toBe('bd ~ sd ~')
  })

  it('does not touch the lanes it was not asked about', () => {
    const before = parse('[bd,hh] ~ sd ~')
    const after = toggleCell(before, 0, 1, true)
    expect(after.lanes[1]).toBe(before.lanes[1])
  })

  /**
   * THE CLAMP, which is the reason this function has one definition rather than
   * three. A hit painted into a column an earlier note was still sounding through
   * takes that note's room, so the earlier note has to end where the new one
   * starts. Without it the model carries a length reaching past the new hit —
   * notation nothing can spell — and the writer declines an edit the user plainly
   * made.
   */
  it('shortens a note the new hit lands inside', () => {
    // `bd _ ~ ~` — one note sounding through columns 0 and 1. Painting at column 1
    // takes the room it was using, so it has to end at column 1 instead.
    const after = toggleCell(parse('bd _ ~ ~'), 0, 1, true)
    expect(after.lanes[0].cells[0]).toEqual(cellOn(1))
    expect(after.lanes[0].cells[1]).toEqual(cellOn(1))
    expect(serializeStepGrid(after)).toBe('bd bd ~ ~')
  })

  it('leaves a note alone when the new hit lands after it ends', () => {
    // the same note, but the hit goes at column 2 — where it was already finished
    const after = toggleCell(parse('bd _ ~ ~'), 0, 2, true)
    expect(after.lanes[0].cells[0]).toEqual(cellOn(2))
    expect(serializeStepGrid(after)).toBe('bd _ bd ~')
  })

  /**
   * PHASE 2 (#1064): the clamp spans the `,`-PART, not the lane that was clicked.
   *
   * The writer emits one token per column per part and spells a held note's
   * covered columns `_`, so `[_,sd]` — a sustain and an onset in the same column —
   * has no spelling at all. A note sustaining in a SIBLING lane therefore blocks
   * the column exactly as one in the clicked lane does, and clamping only the
   * clicked lane handed the writer a model it had to refuse. That was 1,717 of
   * the element path's 1,748 declined placements (98.2%).
   *
   * This SHORTENS A DIFFERENT SOUND'S NOTE. That is the product ruling, taken
   * deliberately and applied uniformly rather than conditioned on whether the
   * shortening is one the listener can hear — plain samples discard length, so a
   * conditional rule would make the same click work or not work depending on the
   * sound under it.
   */
  it('shortens a SIBLING lane’s note the new hit lands inside', () => {
    // `bd _ sd ~` — bd sounds through columns 0 and 1; sd is a second lane of the
    // same part. Painting sd at column 1 takes the room bd was using.
    const before = parse('bd _ sd ~')
    expect(before.lanes[0].cells[0], 'fixture: bd spans two columns').toEqual(cellOn(2))
    const after = toggleCell(before, 1, 1, true)
    expect(after.lanes[0].cells[0], 'bd ends where sd starts').toEqual(cellOn(1))
    expect(after.lanes[1].cells[1]).toEqual(cellOn(1))
    expect(serializeStepGrid(after)).toBe('bd sd sd ~')
  })

  /**
   * ...AND STOPS AT THE PART BOUNDARY, because that is where the writer's
   * constraint stops. Parts are serialized independently — each gets its own
   * sequence — so a sustain in one part and an onset in another at the same column
   * is legal notation needing no resolution. Trimming across it would shorten a
   * note the writer was always going to accept: a silent musical change with no
   * notational need, which is the one thing this op must not do ([[PV238]]).
   */
  it('does NOT shorten a note in a different `,`-part', () => {
    // four parts. `E2` and `E1` each span the whole cycle; placing inside part 2
    // subdivides E2's own part and must leave part 3's E1 at full length.
    const before = parse('A2 A2, A1 A1, E2, E1')
    expect(before.lanes.map((l) => l.part ?? 0), 'fixture: four parts').toEqual([0, 1, 2, 3])
    const after = toggleCell(before, 2, 1, true)
    expect(after.lanes[3].cells[0], 'E1 keeps the whole cycle').toEqual(
      before.lanes[3].cells[0],
    )
    expect(after.lanes[3], 'an untouched part is the same object').toBe(before.lanes[3])
    // ⚠ THE SPELLING CHANGED WITH #1137, THE PROPERTY DID NOT. This read `E2 E2`: the
    // part could not hold a hit at this column at its own width, so the writer voided
    // it and re-derived the whole part flat. It now subdivides the one element instead
    // — which is what the comment above already described — and every other part is
    // still copied through untouched, which is what this test is about.
    expect(serializeStepGrid(after)).toBe('A2 A2, A1 A1, [E2 E2], E1')
  })

  /**
   * ERASING IS NOT CLAMPED. Removing an onset can only give the notes around it
   * more room, never less, so there is nothing to resolve — and running the clamp
   * on a clear would shorten notes for a gesture that never asked to.
   */
  it('clears a cell without touching any other lane', () => {
    const before = parse('bd _ sd ~')
    const after = toggleCell(before, 1, 2, false)
    expect(after.lanes[0], 'the sustaining lane is untouched by a clear').toBe(before.lanes[0])
    expect(serializeStepGrid(after)).toBe('bd _ ~ ~')
  })

  /**
   * The panel guards this before calling (`paintCell` returns early past the end),
   * and the model keeps `cells.length === steps` — measured across the whole
   * corpus, 0 of 966 parsing models have a lane shorter than its grid. Pinned here
   * because the sweeps used to write past the end directly, which simulated a
   * model no gesture can produce.
   */
  it('cannot grow a lane past its own length', () => {
    const m = parse('bd ~ sd ~')
    const after = toggleCell(m, 0, 99, true)
    expect(after.lanes[0].cells).toHaveLength(m.lanes[0].cells.length)
  })
})

/**
 * PROVE BEFORE OFFER, AT THE CELL (#1064) — an op is admissible exactly when its
 * result is WRITABLE, asked of the real writer. `resize.ts` and `resolution.ts`
 * have applied this since #1010 P4c; the cell, which is the gesture the panel
 * exists for, was the one that never got it. The visible consequence was silence:
 * a click the writer could not spell wrote nothing, toggled nothing, said nothing.
 */
describe('placement admissibility — the op refuses rather than going inert (#1064)', () => {
  it('refuses by returning the INPUT, so `mutate` skips and `can*` is derivable', () => {
    // `<bd - - -> *2` is leaf-anchored: its notes are written by byte surgery at
    // their own spans, so a note at a column no leaf sits under has no spelling.
    const m = parse('<bd - - -> *2')
    expect(m.leafSource, 'fixture must reach the leaf path').toBeTruthy()
    const after = toggleCell(m, 0, 1, true)
    expect(after, 'refusal is the input by reference').toBe(m)
    expect(canToggleCell(m, 0, 1, true)).toBe(false)
  })

  it('leaves the document exactly as written when it refuses', () => {
    const src = '<bd - - -> *2'
    const m = parse(src)
    expect(serializeStepGrid(toggleCell(m, 0, 1, true))).toBe(src)
  })

  it('still offers the placements the writer will take', () => {
    const m = parse('bd ~ sd ~')
    expect(canToggleCell(m, 0, 1, true)).toBe(true)
    expect(toggleCell(m, 0, 1, true)).not.toBe(m)
  })

  /**
   * DELETES ARE NOT GATED BY THIS DECISION. A leaf view exists to edit what is
   * already there, and byte surgery at an existing note's own span is precisely
   * what it can do — so clearing a hit goes through on the same model that
   * refuses a placement. This is the split that showed placement was unsupported
   * rather than broken (#1070): 63 deletes written vs 0 places.
   *
   * ⚠ "0 places" WAS A MEASUREMENT AND IS NO LONGER THE FIGURE. #1070 read it as
   * a property of byte surgery — no span to create — but the missing span was the
   * REST's, which produced no hap and so was never indexed. #1154 indexes it, and
   * 248 of 3,584 leaf placements now go through. The split above still holds: a
   * column with no leaf and no rest is refused, and every delete is written.
   */
  it('a leaf view still clears the notes it holds', () => {
    const m = parse('<bd - - -> *2')
    const laneCell = m.lanes[0].cells.findIndex((c) => isCellOn(c))
    expect(laneCell, 'fixture must have a hit to clear').toBeGreaterThanOrEqual(0)
    expect(canToggleCell(m, 0, laneCell, false)).toBe(true)
  })
})

/**
 * UNDOING YOUR OWN DELETE (#1154) — the one add a leaf grid can spell.
 *
 * The clear above writes `~` over the note's own bytes. A rest sounds nothing, so
 * nothing indexed it, and clicking the cell back on was refused for want of a span:
 * measured over the corpus, NOT ONE leaf ask round-tripped — 0 of 402. The rest's
 * span is now carried beside the anchors, so the byte replacement exists.
 *
 * ⚠ IT IS NOT SCOPED TO THE REST WE JUST WROTE, because it cannot be. The model is
 * re-read from the document after every write, so nothing marks a `~` as one this
 * writer produced — "ours" has no implementation. Allowing the undo allows placing
 * on any indexed rest, and does: 248 of 3,584 empty cells across 17 of 82 leaf
 * units, on documents nobody deleted from. The arms below say which boundary DID
 * hold — a column with no leaf and no indexed rest, and a rest no delete can be
 * attributed to — rather than claiming a narrowness the code does not have.
 */
describe('a leaf grid takes back the note it just erased (#1154)', () => {
  const SRC = 'bd mt  bd [lt lt] lt lt lt@2'

  it('round-trips a clear and re-place to the original bytes', () => {
    const m = parse(SRC)
    expect(m.leafSource, 'fixture must reach the leaf path').toBeTruthy()
    // a lane with more than one hit, so clearing one cannot empty the lane out of
    // the document — that is #1161's question, not this one
    const li = m.lanes.findIndex((l) => l.cells.filter(isCellOn).length > 1)
    expect(li, 'fixture must have a lane with two hits').toBeGreaterThanOrEqual(0)
    const col = m.lanes[li].cells.findIndex(isCellOn)

    const cleared = serializeStepGrid(toggleCell(m, li, col, false))
    expect(cleared, 'the clear must be written').not.toBeNull()
    expect(cleared).not.toBe(SRC)

    // re-open on what was written — the panel is re-read from the document after
    // every write, so a test that reuses the model measures a state nobody has
    const back = parse(cleared!)
    const lane = back.lanes.findIndex((l) => l.sound === m.lanes[li].sound)
    expect(lane, 'the lane must survive the clear').toBeGreaterThanOrEqual(0)
    expect(canToggleCell(back, lane, col, true)).toBe(true)
    expect(serializeStepGrid(toggleCell(back, lane, col, true))).toBe(SRC)
  })

  /**
   * WHERE THE BOUNDARY ACTUALLY IS, now that "a note of ours" turned out not to be
   * a distinction the code can make: a column with NO INDEXED REST. `<bd - - -> *2`
   * writes `-` in the clicked column and the index still cannot attribute it to
   * that column, so the placement is refused — restated here so a future widening
   * of the rest path has to break it deliberately.
   */
  it('still refuses a placement on a column with no indexed rest', () => {
    const m = parse('<bd - - -> *2')
    expect(canToggleCell(m, 0, 1, true)).toBe(false)
    expect(serializeStepGrid(toggleCell(m, 0, 1, true))).toBe('<bd - - -> *2')
  })

  /**
   * AND IT REFUSES WHEN IT CANNOT SAY WHICH REST A DELETE BLANKED.
   *
   * A `,`-stack gives several parts a rest at the same column, so a column can be
   * reached by two different rests and nothing distinguishes them. Writing to either
   * would put the user's note into a different voice of their own stack.
   *
   * WHAT THIS ARM ACTUALLY PROVES, stated precisely because the first version of this
   * comment claimed more. Relaxing the unambiguity rule to first-of-set makes this
   * fixture accept one re-place — the counter below goes to 1 and this test reddens.
   * That is the contract it holds. It does NOT prove the write would have been wrong:
   * measured over the whole corpus, first-of-set restores 76 asks instead of 72, all
   * byte-exact, with no music lost. The rule is kept because "right four times out of
   * four" is not a reason, not because a defect was observed here.
   */
  it('refuses rather than guess which rest a delete blanked', () => {
    const SRC2 =
      '<hh ~ hh ~ hh ~ hh ~  hh ~  hh ~  hh ~ <hh oh> ~>*16,\n' +
      '<~  ~ ~  ~ sd ~ ~  ~  ~  ~  ~  ~  sd ~ ~       ~>*16,\n' +
      '<bd ~ bd ~ ~  ~ ~  bd bd ~  <bd ~> ~ ~ ~ ~     ~>*16'
    const m = parse(SRC2)
    expect(m.leafSource, 'fixture must reach the leaf path').toBeTruthy()

    // THE INVARIANT, stated over every cell rather than the one that happened to
    // break: on this path a re-place either gives back the exact bytes or refuses.
    // A third outcome — accepted, different document — is the silent corruption,
    // and it is what this fixture produced before the completeness guard.
    let accepted = 0
    for (let li = 0; li < m.lanes.length; li++) {
      for (let c = 0; c < m.steps; c++) {
        if (!isCellOn(m.lanes[li].cells[c])) continue
        const cleared = serializeStepGrid(toggleCell(m, li, c, false))
        if (cleared === null || cleared === SRC2) continue
        const back = parse(cleared)
        if (back.steps !== m.steps) continue // a different width is a different cell
        const lane = back.lanes.findIndex((l) => l.sound === m.lanes[li].sound)
        if (lane < 0) continue
        // The refusal signal at THIS layer is `canToggleCell`, not a null write: a
        // refused `toggleCell` returns its input by reference (#1064), so serializing
        // it yields the CLEARED document rather than null — which reads as a corrupt
        // write if you check for null. Caught by this arm going red for that reason.
        if (!canToggleCell(back, lane, c, true)) continue
        const out = serializeStepGrid(toggleCell(back, lane, c, true))
        accepted++
        expect(out, `re-placing ${m.lanes[li].sound}@${c} must restore the document`).toBe(
          SRC2,
        )
      }
    }
    // the loop above passes vacuously if nothing is ever accepted, so say so rather
    // than let a fixture that stopped exercising the path read as a green arm
    expect(accepted, 'this fixture accepts no re-place; it proves only the refusals').toBe(0)
  })
})

/**
 * PASTE IS ONE OP, and this is why. Replace-at-target clears the target note and
 * then places — so if the place is refused and the clear is not taken back, the
 * gesture writes a DELETION the user never asked for. It writes it happily,
 * because the cleared model serializes perfectly well; only the placement was
 * unspellable. Found in self-review of #1064: gating `placeNote` turned a paste
 * that used to do nothing into a paste that deleted its own target.
 */
describe('pasteNote — a refused paste takes its own clear back (#528/#1064)', () => {
  // A REAL hazard case, found by sweeping the corpus rather than reasoned up:
  // pasting a 3-step note over the `4` refuses, and the cleared model — missing
  // that `4` — serializes perfectly well. 573 such (note, duration) cases exist
  // across the corpus, on the alt path as well as the leaf one, so this is not
  // a leaf-only corner.
  const SRC = '0 1 2 <4 6 3 [6 7]> <- - - 6> - <- 8> <- - - [2 1]> '
  const PITCH = '4'
  const START = 6
  const DUR = 3

  function roll(s: string): PianoRollModel {
    const r = parsePianoRoll(s)
    if (!r.ok) throw new Error(`parse failed: ${r.reason}`)
    return r.model
  }

  it('returns the ORIGINAL model when the placement is refused', () => {
    const m = roll(SRC)
    expect(pasteNote(m, PITCH, START, DUR)).toBe(m)
  })

  /**
   * The load-bearing assertion — the exact shape the bug had. Clearing first and
   * placing second yields a model that serializes FINE and is missing the target
   * note, so the write goes through and takes the note with it. Asserted on the
   * bytes, because "the model is unchanged" is not the claim; "the user's
   * document is unchanged" is.
   */
  it('the naive clear-then-place would have written a deletion', () => {
    const m = roll(SRC)
    const cleared = {
      ...m,
      notes: m.notes.filter((n) => !(n.start === START && n.pitch === PITCH)),
    }
    const naive = serializePianoRoll(cleared)
    expect(naive, 'the half-applied model is writable — that is the hazard').not.toBeNull()
    expect(naive).toContain('<~ 6 3 [6 7]>') // the `4` is gone
    // and the op does not produce it: the document comes back untouched
    expect(serializePianoRoll(pasteNote(m, PITCH, START, DUR))).toBe(serializePianoRoll(m))
  })

  it('still pastes where the writer takes it', () => {
    const m = roll('c4 e4 ~ g4')
    const out = pasteNote(m, 'e4', 2, 1)
    expect(out).not.toBe(m)
    expect(out.notes.some((n) => n.pitch === 'e4' && n.start === 2)).toBe(true)
  })
})

describe('viewPlacesNotes — asked once per view, and it ASKS (#1070, #1154)', () => {
  it('is false for a view that refuses everything and true otherwise', () => {
    expect(viewPlacesNotes(parse('<bd - - -> *2'))).toBe(false)
    expect(viewPlacesNotes(parse('bd ~ sd ~'))).toBe(true)
  })

  /**
   * ⚠ AND IT IS NOT THE WRITE PATH, which is what this used to assert. Both minis
   * here are leaf-anchored; the first refuses every cell and the second takes one,
   * because #1154 indexed the rest's span and `spliceByLeaf` can write through it.
   * A rule reading `!model.leafSource` answers `false` for both, and on the second
   * that withholds a placement the writer would have taken.
   */
  it('is true for a leaf view whose rest columns take a note (#1154)', () => {
    const m = parse('<cr@4 ~@5>')
    expect(m.leafSource, 'the fixture must be on the leaf path or this proves nothing').toBeTruthy()
    expect(viewPlacesNotes(m)).toBe(true)
    let offered = 0
    for (let lane = 0; lane < m.lanes.length; lane++)
      for (let col = 0; col < m.steps; col++)
        if (!isCellOn(m.lanes[lane].cells[col]) && canToggleCell(m, lane, col, true)) offered++
    expect(offered, 'and the view is true BECAUSE a cell is').toBeGreaterThan(0)
  })

  /**
   * The whole point of asking it at the view: it must agree with what every
   * cell would say, so the panel can state it once instead of greying each cell
   * with no reason on it.
   */
  it('agrees with every cell on the view it describes', () => {
    const m = parse('<bd - - -> *2')
    expect(viewPlacesNotes(m)).toBe(false)
    for (let col = 0; col < m.steps; col++)
      if (!isCellOn(m.lanes[0].cells[col])) expect(canToggleCell(m, 0, col, true)).toBe(false)
  })

  /**
   * THE BRANCH THAT IS NOT ABOUT REFUSAL AT ALL. A view with no empty cell is
   * asked nothing, and answering "this view places nothing" there would put the
   * panel's banner on 418 corpus grids that refuse none. The honest answer is
   * that there is nothing to say.
   */
  it('is true for a view with no empty cell to ask about', () => {
    // ONE sound, so there is one lane and no empty cell — `bd sd bd sd` looks
    // full and is not: it opens two lanes, each empty where the other sounds.
    const m = parse('bd bd bd bd')
    expect(m.lanes.every((l) => l.cells.every((c) => isCellOn(c)))).toBe(true)
    expect(viewPlacesNotes(m)).toBe(true)
  })
})
