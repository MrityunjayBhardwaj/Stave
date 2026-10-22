/**
 * PLACEMENT — putting a note into a view and taking one out, resolving what
 * that costs the notes already there. One module per concern, both surfaces
 * inside it, as `resize.ts` and `resolution.ts` already are.
 *
 * The roll places a pitched note at a column; the grid flips a cell in a lane.
 * Both must leave a model the writer can spell, and both do it the same way —
 * a new onset takes the room an earlier note was sounding through, so that
 * earlier note ends where the new one starts.
 *
 * HOW WIDE IS "AN EARLIER NOTE"? The answer is the WRITER'S CONSTRAINT, and it is not
 * the same on the two surfaces — which is the part that took three issues to get right.
 *
 * The grid resolves over the `,`-part's whole column, every lane in it, whatever sound
 * the lane carries. That is forced: a part's columns are serialized together, so a `_`
 * sustaining in one lane really does occupy the column an onset in another lane needs.
 * Reading it per lane was narrower than the notation it has to produce, and that was
 * #1064.
 *
 * The roll resolves over the PITCH placed, and nothing else (#1310). Its trim looked
 * like the grid's and was assumed to be forced by the same constraint, so #1064's ruling
 * was written as uniform across both surfaces. It was not forced. A roll chord lives
 * inside ONE part, and since #1310's region writer learned parallel lanes, the notation
 * can say `[c c ~ ~, [g,a,e4]@4]` — two lengths at once, in the region's own bracket. The
 * moment that became spellable, trimming the siblings stopped being the price of writing
 * the edit down and became a silent musical change with no notational need.
 *
 * So the surfaces differ on the PITCH axis on purpose, and agree on the principle: each
 * resolves over exactly the scope its writer forces, and neither trims for taste.
 *
 * This is the ONE definition of each gesture. The panels are callers, and so
 * are the corpus sweeps: a test that models the edit itself is a second oracle
 * for what an edit *is*, and it cannot catch a change in the edit — it quietly
 * keeps testing the old one (#1048).
 */
import {
  cellOn,
  clampLane,
  clampPartAtOnset,
  columnOverlap,
  isCellOn,
  rollContentRange,
} from './model'
import type { PianoRollModel, RollNote, StepCell, StepGridModel } from './model'
import { midiToPitch, pitchToMidi } from './pitch'
import {
  ifGridSpellable,
  ifRollSpellable,
  serializeStepGrid,
  serializePianoRoll,
  serializePianoRollWithExtent,
} from './serialize'
import type { RollWriteExtent } from './serialize'
import { parsePianoRoll } from './parse'

/**
 * Does this view accept a NEW note ANYWHERE?
 *
 * The panel asks so it can state the refusal ONCE — "this view edits the notes
 * already here" — instead of rendering a surface of individually-greyed cells
 * with no reason on any of them (#1070). So the question it must answer is
 * exactly "is every placement on this surface refused?", and the answer is
 * `true` whenever at least one is taken, or when there is nothing to ask about.
 *
 * ⚠ A VIEW WITH NO EMPTY CELL ANSWERS `true`, deliberately. There is nothing to
 * grey and nothing to explain on a full grid, and answering `false` there would
 * put the banner on hundreds of corpus units that refuse nothing.
 *
 * ⚠ IT ASKS THE OP, and that is the whole of #1154's second consequence. This
 * used to return `model.leafSource == null` — a PATH inference, resting on
 * "byte surgery has no span to create, so a leaf view accepts nothing, by
 * construction". Indexing rests (#1154) gave those columns a span after all, so
 * the construction argument is simply false now: 248 of 3,584 leaf grid cells
 * across 17 of 82 leaf units are placements the writer WILL take, and inferring
 * from the path would withhold an affordance from every one of them. Derived
 * from `toggleCell`/`placeNote` for the same reason `can<Op>` is — a view-level
 * predicate that PREDICTS the op is a second oracle, and it drifts the moment
 * the op's reach moves, which is exactly what happened here ([[PV241]]).
 *
 * The roll's answer has not moved: the roll's leaf writer indexes no rests, so
 * it still refuses every one of them, and this now MEASURES that rather than
 * asserting it. Whatever the reach is, the panel reads it instead of assuming it.
 *
 * ⚠ THE ROLL ASKS ABOUT ONE ROW IT DOES NOT HOLD, and that is not a flourish —
 * without it the answer is wrong on real units. The roll's display is PADDED
 * around the content (`rollContentRange`), so a roll whose every content cell is
 * full still shows empty rows and still takes a click on them. Asking only
 * about content pitches made "the content is full" read as "nothing to ask",
 * which said "this view places notes" on 4 leaf rolls where every row the user
 * can actually click is refused.
 *
 * It is consulted only once every held cell has refused, so it decides nothing
 * on a view that places anything. And it is representative rather than lucky,
 * measured rather than argued: swept over each such view's WHOLE padded range,
 * the answer is uniform — every element roll takes every padded row, every leaf
 * roll takes none. `every view answering no refuses its whole padded range` is
 * pinned in `placement-admissibility.test.ts` so a row that disagrees is a
 * failure rather than a surprise.
 *
 * ⚠ ASKING THE OP ALSO CORRECTS THREE ROLLS IN THE OTHER DIRECTION, and they
 * are the path rule's error, not the unheld row's — measured by removing the
 * row and watching them stay caught. `<~ [~@3.5 d2@2 c#2@2.5]>` and two like it
 * are element-path rolls, so the path rule called them placeable; they refuse
 * all 267 / 84 / 96 placements over their full padded range, and every one of
 * those was being offered.
 *
 * ⚠ Distinct from writer REACH, which asks "can this view write back?" — a
 * question every leaf view answers yes to, and the axis #986 raised (grid
 * 80→131, roll 56→85). Those figures are true and unaffected; acceptance of new
 * content is a different axis.
 *
 * COST, measured over the corpus per view: grid p50 0.002ms / p99 0.55ms /
 * worst 6.7ms, roll p50 0.004ms / p99 1.0ms / worst 5.7ms — against the grid's
 * own per-cell `placeable` map at p99 2.25ms / worst 13.1ms, which the panel
 * already pays. It stops at the first placement taken, so every view that
 * places anything answers in a cell or two and only a surface refusing
 * everything is scanned in full — which is the surface whose answer needs the
 * whole scan. Both panels memoize it on the model, because `mutate` fires on
 * every pointermove of a drag.
 *
 * And the memo is not the only thing standing between the full scan and a
 * per-frame cost, which is worth saying because the memo alone would not be
 * enough — a drag makes a new model every frame. The view that pays the whole
 * scan is one that refuses everything, and on the roll that is a leaf view,
 * which no drag can change: 0 of 54 leaf rolls accept a velocity edit at all,
 * against 395 of 491 elsewhere. The expensive answer and the draggable surface
 * are disjoint populations, measured rather than hoped.
 */
export function viewPlacesNotes(model: StepGridModel | PianoRollModel): boolean {
  // look-only takes no note anywhere (#1975). COST ONLY: every ask below would be told
  // so by the writer, one cell at a time — the answer is the same without this line.
  if (model.lookOnly) return false
  let asked = 0
  if ('lanes' in model) {
    for (let lane = 0; lane < model.lanes.length; lane++)
      for (let col = 0; col < model.steps; col++) {
        if (isCellOn(model.lanes[lane].cells[col])) continue
        asked++
        if (canToggleCell(model, lane, col, true)) return true
      }
    return asked === 0
  }
  // The rows the panel shows: the model's own content, plus one it does not hold,
  // because the display is padded around the content and an empty padded row takes a
  // click like any other. Spelled the way the panel spells a row — bare number on a
  // numeric pattern (#469), note name otherwise — so an unspellable token cannot be
  // mistaken for an unwritable placement.
  //
  // ⚠ THE PADDED ROW IS READ FROM THE RULE THAT DRAWS IT, NEVER GUESSED AT (#1163).
  // This used to probe `min − 1` — a row that happens to be padding because
  // `contentRange` pads by two, a constant that lived in `PianoRollGrid.tsx` with
  // nothing between them. Either could have moved alone: drop the padding and this
  // asks about a row nobody can click, widen it and this under-asks, and no arm could
  // fail either way. `rollContentRange` now owns the rule and both read it.
  //
  // ONE row, not the whole padded range, and that is measured rather than conceded:
  // sweeping every drawn row changes the answer on 0 of 544 corpus rolls and costs
  // 7× (p99 0.5 → 5.4ms, worst 2.5 → 18.0ms per view — the neighbourhood of the
  // per-cell map #1070 declined at 21.7ms). Taking the row FROM the range costs
  // nothing at all: identical ask count, identical answers. That the one row is
  // representative of the whole padded range is not assumed either — it is pinned in
  // `placement-admissibility.test.ts`, alongside the arm that fails if this cheap
  // probe and the panel's full surface ever disagree.
  //
  // The guard is not "are there notes?" but "is the range derived from CONTENT?".
  // `rollContentRange` falls back to a default octave when nothing in the model spells a
  // pitch, and a default row is not a padded one — there is no content for it to sit
  // beside, and asking about it would be asking about an arbitrary row.
  const pitches = new Set(model.notes.map((n) => n.pitch))
  if (model.notes.some((n) => pitchToMidi(n.pitch) !== null)) {
    const below = rollContentRange(model).lo
    pitches.add(model.numeric ? String(below) : midiToPitch(below))
  }
  for (const pitch of pitches)
    for (let step = 0; step < model.steps; step++) {
      if (model.notes.some((n) => n.pitch === pitch && n.start === step)) continue
      asked++
      if (canPlaceNote(model, pitch, step, 1)) return true
    }
  return asked === 0
}

/**
 * What a painted cell holds. A hit the user places lasts exactly the column they
 * clicked — that is the box they see, and one column is what the notation spells
 * without any grouping.
 *
 * It is NOT matched to whatever length the lane's other notes happen to have: on a
 * grid projected from `[hh ~]!16` every existing note lasts half a column, and
 * quietly giving a new note that length would be the view deciding the music. If
 * painting on such a grid should offer the prevailing length, that is a product
 * question, and it belongs with the per-note length control (#1053).
 */
const paint = (value: boolean, length = 1): StepCell => (value ? cellOn(length) : false)

/**
 * Flip one cell of the step grid, returning a new model (stable lane set preserved).
 * This is what a click on a cell does — the panel and every corpus sweep call it.
 *
 * `length` is how many columns a placed hit lasts: one by default (the box the LCM view
 * draws), or one of the PART's own steps (`SourcePart.factor` columns) when the Exact view
 * draws the row at its own steps (#1855). A part stretched by 2 cannot spell a one-column
 * hit on its own step — that is half its step — so the writer declines it and those cells
 * were locked (#1853); one own step long is exactly what the part's own reading spells.
 */
export function toggleCell(
  model: StepGridModel,
  laneIndex: number,
  stepIndex: number,
  value: boolean,
  length = 1,
): StepGridModel {
  // ADMISSIBLE EXACTLY WHEN THE RESULT IS WRITABLE, asked of the real writer
  // ([[PV241]]) — the same rule `resize.ts` and `resolution.ts` already apply to
  // every op they offer. It had reached every op and every control-state
  // function and never reached the CELL, which is the gesture the panel exists
  // for: `SequencerGrid` toggled unconditionally and `useGridModel` returned on
  // the null serialize before updating the model, so a declined click wrote
  // nothing, toggled nothing and said nothing — 1,748 of 11,633 placements
  // (15.0%) on the element path, and 31.3% of the grid's overall (#1064).
  //
  // Returning the INPUT by reference is what the `notation/` op family already
  // means by "could not apply": `mutate` skips the write and every `can<Op>`
  // reduces to `op(model) !== model`, with no second predicate to drift.
  // Putting it HERE rather than in the panel is deliberate — an admissibility
  // rule enumerated caller-by-caller is exactly how the cell was missed.
  const painted = model.lanes.map((lane, i) =>
    i === laneIndex
      ? {
          ...lane,
          // CLAMPED, because a promise about lengths is a promise about ROOM
          // (#1010 P4b/P4c). Painting a hit into a column an earlier note was
          // still sounding through shortens that note — the room it had is gone.
          // Without this the model keeps a length that reaches past the new hit,
          // which is notation nothing can spell, and the writer rightly declines
          // an edit the user plainly made. The resize and quantize ops already
          // clamp for exactly this reason; paint is the third op that moves
          // onsets closer together, and it was the one still missing it.
          cells: clampLane(
            lane.cells.map((c, j) => (j === stepIndex ? paint(value, length) : c)),
            model.steps,
          ),
        }
      : lane,
  )
  // ...AND OVER THE SCOPE THE WRITER CONSTRAINS, which is the `,`-part, not the
  // lane the click landed in ([[PV243]]). One token per column per part, a held
  // note's covered columns spelled `_`, and `[_,bd]` unspellable — so a note
  // sustaining in a SIBLING lane blocks the column just as surely as one in this
  // lane, and clamping only here left the writer a model it had to refuse. That
  // was 1,717 of the element path's 1,748 declines, and it stops being a corner
  // under #1052's refinement, where every new column sits under a sustain.
  //
  // Only on placement: erasing a cell removes an onset, which can only give the
  // notes around it more room, never less.
  const lanes = value
    ? clampPartAtOnset(painted, model.lanes[laneIndex]?.part ?? 0, stepIndex)
    : painted
  return ifGridSpellable(model, { ...model, lanes })
}

/**
 * Insert a note into a roll, resolving overlaps so the result stays a flat,
 * tileable sequence (what the serializer requires). DAW-style resolution:
 *  - a group already at `start` → the note joins the chord, adopting its duration.
 *    ⚠ THAT IS A PRODUCT RULING, NOT A WRITER CONSTRAINT, and the distinction is the
 *    one #1310 was about. "Chord members share one duration" was true of what this
 *    file could SPELL, and since the region writer learned parallel lanes it is not:
 *    `[g3@2 ~ ~, [c3,e3]@4]` says a chord whose members differ, and round-trips. So
 *    honouring a different requested length is available and we decline it — adding a
 *    voice to a chord is a gesture that shares the chord's length, and the compact
 *    spelling is the one the user wrote. Chosen, not forced;
 *    ⚠ where the notes at `start` DISAGREE about their length there is no single
 *    duration to adopt, and today the answer is whichever note the array holds first.
 *    That is live and pre-existing — 856 asks over the corpus reach such a start — and
 *    it is #1314, to be fixed with #1315 since both change what the writer is asked to
 *    spell and need one reach measurement between them;
 *  - an earlier note OF THE SAME PITCH sustaining across `start` → it trims to end at
 *    `start`. Other pitches sustaining through the column are left alone (#1310): they
 *    are voices the gesture did not touch, and the region writer can now spell a chord
 *    whose members have different lengths, so nothing forces them shorter;
 *  - the next group (or the grid end) caps the new note's duration.
 */

export function placeNote(
  model: PianoRollModel,
  pitch: string,
  start: number,
  duration: number,
  opts: RollWriteOptions = {},
): PianoRollModel {
  // ⚠ THE SAME RULE RESIZE TAKES, AND CHEAPER HERE (#1333). `ifRollSpellable` asks only
  // whether the writer can produce bytes; asked the harder question the document actually
  // poses, 4,362 of 35,601 placements the panel would offer write a document that does not
  // reopen as what was meant — and the note LOST is usually the one the click just created.
  // 1,071 of those do not parse at all.
  //
  // Resize had to defer this to gesture commit because it runs per pointermove (#1324).
  // A placement is ONE CLICK, so there is no cadence question: the check runs on the write
  // itself, and the caller pays a single parse.
  const accept = (next: PianoRollModel): PianoRollModel =>
    opts.readback
      ? rollReadsBack(next)
        ? next
        : model
      : ifRollSpellable(model, next)
  // Gated by the real writer, exactly as `toggleCell` is — same rule, the other
  // surface. The roll's own paths are near-clean (element 0.9%, alt 0.0%), so
  // this is cheap here; what it buys is that the roll cannot drift back into
  // offering a gesture the writer refuses, and that `canPlaceNote` is derivable
  // rather than a second predicate. Leaf rolls refuse all 18,386 (#1070).
  // ⚠ ADOPTION NEEDS A CHORD THAT AGREES (#1314). A `find` here was safe while every note
  // at a start shared a duration, and the models where that fails arrive straight from the
  // source — two `,`-parts of different lengths put different durations at step 0. So the
  // adopted length was whichever note the array happened to hold first: same document,
  // same gesture, two answers. Measured over the corpus as parsed: 76 such starts, 856
  // asks reaching one.
  //
  // Where the chord AGREES this is byte-for-byte what it always did — that is the product
  // ruling above, kept. Where it does not, there is no single duration to adopt, so the
  // general path runs and the requested length stands, capped as any other placement is.
  // Measured: 84 asks change bytes, no voice the gesture did not address moves, nothing
  // is newly refused, and no projection shifts.
  const at = model.notes.filter((n) => n.start === start)
  const shared =
    at.length > 0 && at.every((n) => n.duration === at[0].duration) ? at[0].duration : null
  if (shared !== null) {
    return accept({
      ...model,
      notes: [...model.notes, { pitch, start, duration: shared }],
    })
  }
  const capAt = (samePitchOnly: boolean): number =>
    Math.min(
      ...model.notes
        .filter((n) => (!samePitchOnly || n.pitch === pitch) && n.start > start)
        .map((n) => n.start),
      model.steps,
    )
  const nextStart = capAt(false)
  // ⚠ SAME PITCH ONLY (#1310). A note sustaining across this column that is NOT the pitch
  // being placed is a voice the user did not touch — a sibling member of the chord being
  // subdivided, or a different `,`-part entirely — and shortening it changes what the
  // document plays somewhere the gesture never reached. Measured before this line existed:
  // 61 of 541 placements on the shipped subdivide road did exactly that, trimming 128
  // collateral notes. With the conjunct: 541 posed, 541 written, 0 refused, 0 damaged.
  const notes = model.notes.map((n) =>
    // "does this note reach into this column?" is `columnOverlap`'s question, and this file
    // had been answering it with an inline twin. `model.ts` records what happened the last
    // time that predicate lived in two places: two thresholds a hundred lines apart. The
    // `n.start < start` conjunct stays because it asks something DIFFERENT — a note
    // starting exactly here is the chord-join case handled above, not something to trim.
    // What the shared rule adds is the sliver threshold, so a length that merely ENDS at
    // the onset is no longer counted as sounding through it. Measured across every ask in
    // the corpus: this moves NOTHING, which is the only kind of consolidation worth making
    // quietly — and it is the same result the grid's own consolidation measured.
    n.pitch === pitch &&
    n.start < start &&
    columnOverlap(n.start, n.start + n.duration, start) !== null
      ? { ...n, duration: start - n.start }
      : n,
  )
  const withCap = (cap: number): PianoRollModel => ({
    ...model,
    notes: [...notes, { pitch, start, duration: Math.max(1, Math.min(duration, cap - start)) }],
  })

  // ⚠ THE CAP IS SCOPED THE WAY THE TRIM IS, BUT ONLY WHERE THE DOCUMENT CAN SAY SO
  // (#1315). The trim above stopped shortening voices the gesture never addressed; this
  // cap — which bounds the new note's own length — went on reading EVERY onset, so a
  // voice you never touched still shortened the note you DID ask for. Place `c3` for four
  // steps over `[~ ~ e3 ~]` and it came back two, though `[c3@4, ~ ~ e3 ~]` round-trips
  // byte-identically, so nothing about the notation forced it.
  //
  // ⚠⚠ AND SCOPING IT ALONE IS A REGRESSION, WHICH IS WHY THIS IS A LADDER AND NOT A
  // CONJUNCT. Measured per ask over the corpus, the scoped cap on its own turns 3,089
  // writes into REFUSALS and moves 3,231 edits from `splice` to `rebuild` — the same loss
  // of locality #1310 was filed to remove. The untrimmed model genuinely overlaps, and
  // where the writer cannot spell that overlap the honest answer is the OLD cap, not a
  // refusal and not a whole-document rewrite.
  //
  // So: take the wide answer when the document can carry it WITHOUT changing how the edit
  // is written, and fall back otherwise. Measured that way: 3,541 asks gain the length the
  // caller asked for, every one of them on the SAME write path it already used — 0 newly
  // refused, 0 pushed to a rebuild, 0 voices the gesture did not address moved, and no
  // note ever longer than requested.
  //
  // ⚠ `degrades` compares PATHS, not bytes. A wide answer that can only be written by
  // rebuilding the document is worse than a short note, because a rebuild re-spells
  // everything the user did not touch — the edit stops being local, which is the property
  // the whole arc exists to protect.
  const wideCap = capAt(true)
  // The common case: no foreign onset between this column and the next same-pitch one, so
  // both caps are the same number and there is nothing to choose between. Answered with a
  // single write exactly as before — the two-candidate path below costs a second
  // serialize, and it should only be paid where it can actually change the answer.
  if (wideCap === nextStart) return accept(withCap(nextStart))
  const wide = withCap(wideCap)
  const narrow = withCap(nextStart)
  const wideOut = serializePianoRollWithExtent(wide)
  if (wideOut.mini !== null) {
    const local = !degradesLocality(
      wideOut.extent,
      serializePianoRollWithExtent(narrow).extent,
    )
    // ⚠ The wide answer is preferred on LOCALITY, which says nothing about fidelity — so
    // under readback it has to clear the same bar as the narrow one, or the ladder would
    // hand back a more local write that loses a note (#1333).
    if (local && (!opts.readback || rollReadsBack(wide))) return wide
  }
  return accept(narrow)
}

/**
 * Is `next`'s write path LESS LOCAL than `floor`'s — i.e. does taking the wider answer
 * cost us re-spelling music the gesture never addressed?
 *
 * ⚠ THIS IS THE LADDER RULE, AND IT IS SHARED ON PURPOSE. Both the placement cap (#1315)
 * and the resize cap (#1318) choose between a wide answer and a narrow one by comparing
 * WRITE PATHS rather than bytes, and this file already records what happened the last
 * time one predicate lived in two copies here: `columnOverlap` drifted into an inline
 * twin, and `model.ts:1067` carries the note about the two thresholds that resulted.
 *
 * ⚠ THE ORDER IS leaf < splice = alt < rebuild. `leaf` is a surgical edit inside the
 * element the user touched; `splice` and `alt` replace the pattern's own slice — they are
 * alternatives to each other, not steps apart, since a model either has an `altSource` or
 * it does not; `rebuild` re-authors the whole document.
 *
 * ⚠ #1315 SHIPPED WITH THE NARROWER RULE — "rebuild only" — and this generalisation was
 * measured NOT to change it: every one of that fix's 3,541 movers stayed on the path it
 * already used, so no comparison it makes reaches the widened clauses. It was proven by
 * re-running the roll's surface-wide arm, whose aggregate is unchanged. On RESIZE the two
 * rules differ: the narrow rule admits 137 more asks and degrades those same 137 out of
 * `leaf` into `splice`/`alt`, which is the trade this arc has consistently declined.
 */
function degradesLocality(next: RollWriteExtent, floor: RollWriteExtent): boolean {
  const rank = (p: RollWriteExtent['path']): number =>
    p === 'leaf' ? 0 : p === 'rebuild' ? 2 : 1
  return rank(next.path) > rank(floor.path)
}

/**
 * Replace whatever sits at (`pitch`, `start`) with a note of `duration` — the
 * paste gesture (#528), as ONE op rather than a clear composed with a place.
 *
 * The composition is the whole reason this exists. `placeNote` signals "could
 * not apply" by returning its input, and a paste's input is the model with the
 * target note ALREADY removed — so a caller that clears first and places second
 * turns a refusal into a deletion the user never asked for, and writes it,
 * because the cleared model serializes perfectly well. Composing a
 * decline-capable op with one that cannot decline puts the atomicity of the
 * whole gesture on the caller, and it is not the caller's to carry.
 *
 * Refusing returns the ORIGINAL model, so the clear goes back with it.
 */
export function pasteNote(
  model: PianoRollModel,
  pitch: string,
  start: number,
  duration: number,
  opts: RollWriteOptions = {},
): PianoRollModel {
  const cleared = {
    ...model,
    notes: model.notes.filter((n) => !(n.start === start && n.pitch === pitch)),
  }
  // The option rides through to the placement this composes, which is where the write is
  // actually decided — so a paste that could not reopen intact refuses as one gesture and
  // takes its own clear back with it, exactly as an unspellable one already did (#1333).
  const placed = placeNote(cleared, pitch, start, duration, opts)
  return placed === cleared ? model : placed
}

/**
 * Is this exact gesture admissible? Derived from the op rather than predicted
 * alongside it, so the two cannot disagree ([[PV241]], [[P369]]).
 *
 * The panel asks these per cell to decide whether to OFFER the gesture. Ask
 * `viewPlacesNotes` first: on a creation-incapable path the honest answer is
 * "this view does not place notes", not a cell-by-cell decline (#1070).
 */
export const canToggleCell = (
  model: StepGridModel,
  laneIndex: number,
  stepIndex: number,
  value: boolean,
  length = 1,
): boolean => toggleCell(model, laneIndex, stepIndex, value, length) !== model

export const canPlaceNote = (
  model: PianoRollModel,
  pitch: string,
  start: number,
  duration: number,
): boolean => placeNote(model, pitch, start, duration) !== model

/**
 * How many columns a note at (`laneIndex`, `stepIndex`) may occupy, OVER THE SCOPE THE
 * WRITER CONSTRAINS — the `,`-part's column, not the lane the note sits in.
 *
 * This is #1064's rule read in the other direction. Placement resolves a colliding onset
 * by shortening whatever was sounding through it (`clampPartAtOnset`); a length edit asks
 * the same question from the other side — how far can this note reach before it meets
 * one? Both have to use the PART, because the grid writes one token per column per part
 * and a note sustaining in a SIBLING lane blocks the column just as surely as one in this
 * lane: `[_,sn]` is a chord containing a token that means nothing there.
 *
 * FOUND BY THE GATE, not by reading. Capping with `clampLane` alone — the lane's own
 * rule, which is what `laneCoverage` reads to DRAW — let a drag ask for a length that
 * reached under a sibling's onset, and `sustainTokens` then declined the write outright.
 * The user's drag did not cap at the neighbour; it stopped working when it passed one.
 *
 * ⚠ SO THIS DELIBERATELY DIFFERS FROM THE DRAWING'S ROOM RULE, and the asymmetry is
 * sound: `laneCoverage` is per lane because it renders whatever model it is handed, and
 * a model that reaches under a sibling onset is unwritable and therefore never reaches it.
 * The cap is the stricter of the two, so every length this returns is one the panel can
 * also draw.
 */
function partRoom(model: StepGridModel, laneIndex: number, stepIndex: number): number {
  const part = model.lanes[laneIndex]?.part ?? 0
  let next = model.steps
  for (const lane of model.lanes) {
    if ((lane.part ?? 0) !== part) continue
    for (let j = stepIndex + 1; j < lane.cells.length && j < next; j++) {
      if (isCellOn(lane.cells[j])) {
        next = j
        break
      }
    }
  }
  return next - stepIndex
}

/**
 * Set the length of the note at (`laneIndex`, `stepIndex`) to `duration` COLUMNS —
 * `resizeNote`'s half of the pair on the grid, and the gesture #1053 asks for.
 *
 * WHY THE GRID GETS ONE AT ALL. The model has carried a cell's length since #1010 P4b,
 * the printer has preserved it since P4c, and #1056 put it on screen. Length was the one
 * axis the panel could show and could not set, so the only way to shorten a note was to
 * leave the view and edit the code — which is the gap the whole code↔view line exists to
 * close.
 *
 * THE CAP IS `partRoom`, not the lane's own room; see its note for why the two differ and
 * why the drawing legitimately uses the looser one.
 *
 * FLOORS AT ONE COLUMN, exactly as `resizeNote` does, and for a sharper reason here: the
 * grid writes one token per column and a sustain as `_`, so a length below one column has
 * no spelling at this resolution at all (`sustainTokens` declines it). Flooring is not a
 * policy choice about small notes; it is the shortest thing the writer can say.
 *
 * DECLINES BY RETURNING ITS INPUT, so `canResizeCell` is the op rather than a second
 * predicate beside it ([[PV241]]). Three populations decline, and all three are correct:
 *  - a sustain with NO REST IN REACH to write itself into. The writer will absorb the
 *    rests a lengthened note runs over, taking bytes that said "nothing starts here"
 *    (#1146) — but where every column in reach carries a note there is nothing to take,
 *    and `bd*4` cannot grow at all.
 *  - a length that would sustain under ANOTHER sound in the same `,`-part. `partRoom`
 *    caps rather than declines here, so this only bites where the cap cannot help.
 *  - an edit the DOCUMENT would not record — see the byte comparison below.
 *
 * MEASURED OVER THE 966-UNIT GRID CORPUS: 1016 of 4729 notes are offered a handle (552
 * can grow, 464 can only shorten), spread over 240 units. Every one produces writable
 * notation and a document that actually changes — asserted in `op-admissibility.test.ts`,
 * which is also where the 571 dead offers this op used to make are recorded.
 *
 * ⚠ Those figures were 854 / 390 / 178 before #1146, and the gap was entirely the
 * neighbouring-bytes decline: on FLAT grids the handle reached 46 of 732 units and now
 * reaches 105.
 *
 * ⚠⚠ NOW 1273 OF 5251, AND THE RISE IS A DEFECT BEING REMOVED RATHER THAN REACH BEING
 * ADDED (#1235). The identity below is what made that defect invisible: the leaf writer
 * compared TOKENS only, so it answered a resize with the source bytes unchanged, and this
 * function dutifully reported "the document did not move" and withdrew the handle. 270
 * handles were dark that way — every one on a model carrying leaf spans — and nothing
 * anywhere reported a problem, because from here a swallowed write and an inexpressible
 * length are the same observation. The writer refuses the length now and the element
 * writer answers it. (The denominator moved 4729 → 5251 with the corpus, not with this.)
 */
export function resizeCell(
  model: StepGridModel,
  laneIndex: number,
  stepIndex: number,
  duration: number,
): StepGridModel {
  const cell = model.lanes[laneIndex]?.cells[stepIndex]
  if (!isCellOn(cell)) return model
  const capped = Math.max(1, Math.min(duration, partRoom(model, laneIndex, stepIndex)))
  const lanes = model.lanes.map((lane, i) =>
    i === laneIndex
      ? {
          ...lane,
          cells: clampLane(
            lane.cells.map((c, j) => (j === stepIndex ? cellOn(capped) : c)),
            model.steps,
          ),
        }
      : lane,
  )
  // Identity when the clamp lands back on the length that was already there — a drag
  // held past the next hit reaches the same maximum on every pointermove, and without
  // this each frame would be a fresh model and a fresh write of identical bytes.
  //
  // Compared EXACTLY rather than within an epsilon, because the two sides are the
  // integers this gesture deals in: the drag asks for a whole number of columns and
  // `clampLane` caps at a whole number of columns.
  const next = lanes[laneIndex].cells[stepIndex]
  if (isCellOn(next) && next.duration === cell.duration) return model

  const written = serializeStepGrid({ ...model, lanes })
  if (written === null) return model
  // ...AND IDENTITY WHEN THE DOCUMENT DOES NOT MOVE, which is a second and sharper
  // question than whether the length changed ([[PV241]] applied to the write, not the op).
  //
  // Found by fixture rather than reasoned: on `[bd ~ ~ ~, hh ~ hh ~]` a cell's length is
  // HALF a column, so setting it to one column changes the model — and serializes to the
  // very same bytes, because the writer spells this part at its own two-column width and
  // a half-column note has no shorter spelling to lose. `useGridModel` keeps a model whose
  // serialization is unchanged (that is what lets an all-rest lane stage before its first
  // hit), so without this the panel would redraw the note LONGER while the document said
  // nothing had happened — the view and the code disagreeing about the music, which is the
  // one outcome the whole code↔view line exists to prevent.
  //
  // Cheaper than it looks, and it replaces work rather than adding it: `ifGridSpellable`
  // would serialize this model anyway, so the null check above IS that gate, inlined.
  if (written === serializeStepGrid(model)) return model
  return { ...model, lanes }
}

export const canResizeCell = (
  model: StepGridModel,
  laneIndex: number,
  stepIndex: number,
  duration: number,
): boolean => resizeCell(model, laneIndex, stepIndex, duration) !== model

/**
 * The roll's half of `canResizeCell`, and it did not exist until now (#1318) — 0 hits
 * across 1,058 files, against 13 for `canPlaceNote` as the positive control. Nothing
 * derived resize admissibility from the writer on this surface, which is how 1,069 asks
 * could produce a model that serializes to null: the view showed a length the document
 * never received.
 *
 * ⚠ IT IS THE OP, not a predicate beside it — the same rule `canResizeCell` follows and
 * for the same reason. A view-level twin that PREDICTS the writer is a second oracle and
 * drifts the moment the writer's reach moves.
 *
 * ⚠ NOT WIRED INTO THE PANEL BY THIS CHANGE. The roll draws its length handle
 * unconditionally, so now that resize can decline it offers one on 93 of 5,480 corpus
 * notes that cannot be resized at any length, and on 433 more that refuse some lengths.
 * The grid gates its handle on `canResizeCell`; matching that on the roll is an
 * affordance decision with its own measurement, filed separately rather than folded in.
 */
export const canResizeNote = (
  model: PianoRollModel,
  start: number,
  pitch: string,
  duration: number,
): boolean => resizeNote(model, start, pitch, duration) !== model

/**
 * WHICH NOTES A RESIZE HANDLE WOULD DO SOMETHING TO (#1322).
 *
 * The panel draws a length handle on every note's tail. Since #1318 gave resize the
 * ability to decline, some of those handles take the cursor, accept the drag, and write
 * nothing — a control that promises an edit that cannot happen. This is the set the panel
 * gates on, and it belongs here rather than beside the render for the same reason
 * `canResizeCell` does: the admissibility of a gesture is the writer's answer, and a
 * predicate written next to the view is a second oracle that drifts the moment the
 * writer's reach moves.
 *
 * ⚠ IT CANNOT BE BUILT FROM `canResizeNote`, which is the obvious thing to reach for and
 * is wrong here. That predicate is `resizeNote(...) !== model` — IDENTITY — so it answers
 * "did the writer accept the ask", not "did the document change". Asked for the length a
 * note already has, `resizeNote` rebuilds an equal model in 5,440 of 5,480 corpus notes
 * and the bytes differ in NONE of them, so an offer-set built on it counts no-ops as
 * affordances. Measured: `canResizeNote` over `{1,2,4}` keeps a dead handle on 1,768
 * notes, and over `d±1` on 1,726. Scored on BYTES the same `d±1` shape is exact.
 *
 * ⚠ THE GRID DOES NOT MEET THIS because its rule only ever asks `d+1` and `d-1`, which
 * are never no-ops. What does not port is the KEY: `SequencerGrid` collects a
 * `Set<number>` of start columns, sound because a lane cannot hold two notes at one step.
 * A roll comma-stack can — `[d4,f4,d4]` — so `(pitch, start)` is not an identity here and
 * keying on it silently merged 5 of 3,619 offerable notes. The set is keyed by NOTE
 * OBJECT, which is what `overlapAt` hands the render back.
 *
 * WHY `d±1` IS EXACT rather than a lucky proxy: `resizeNote` floors the new duration at 1
 * and caps it at a maximum, so the writable lengths form one contiguous run around the
 * note's own. If any longer length writes, `d+1` writes; if any shorter one does, `d-1`
 * does. Checked against an exhaustive sweep of every column the drag can reach — 1,861
 * inert of 5,480, with 0 notes classified differently by the two.
 *
 * ⚠ `Math.max(1, d - 1)`, not `d - 1` behind a `< 1` guard. Where `1 < d < 2` the shrink
 * ask is a fraction below 1, and guarding it away loses a real shrink the writer would
 * take — `d2@29.5+1.5` shrinking to 1. It changes exactly ONE note of 5,480.
 *
 * ⚠ AN EARLIER VERSION OF THIS COMMENT SAID SIX, AND SAID "sub-1 note (`@0.5`)". Both
 * wrong, from the same mistake: the six came from subtracting two counts that differed
 * for TWO reasons — this ask (1) and a `(pitch, start)` key collision (5) — and the
 * mechanism was guessed rather than measured. There are ZERO sub-1 duration notes in the
 * population, so the case the comment described does not occur at all. Split a difference
 * by cause before attributing it.
 *
 * COST, because this hangs off the model and `mutate` fires per `pointermove`, so it is
 * paid per accepted FRAME of a drag, not once per gesture — the axis #1324 was reverted
 * on. Over the 595 corpus units: p50 0.05ms, p90 0.45ms, p99 3.61ms, worst 15.88ms on a
 * 144-note × 64-column model. That sits in the envelope of the grid's own `placeable`
 * memo (p99 2.54ms, worst 14.4ms), which shipped, and well inside the roll's per-CELL map
 * (p99 21.67ms, worst 50ms), which #1072 declined. It asks once per NOTE, which is why —
 * the declined map asked once per empty cell.
 */
export const resizableNotes = (model: PianoRollModel): Set<RollNote> => {
  const out = new Set<RollNote>()
  const now = serializePianoRoll(model)
  if (now === null) return out
  for (const n of model.notes) {
    const writes = (duration: number): boolean => {
      const next = resizeNote(model, n.start, n.pitch, duration)
      if (next === model) return false
      const s = serializePianoRoll(next)
      return s !== null && s !== now
    }
    if (writes(n.duration + 1) || writes(Math.max(1, n.duration - 1))) out.add(n)
  }
  return out
}

/**
 * Resize the single note identified by (`start`, `pitch`) to `duration` steps. The new
 * duration floors at 1, and each note resizes independently: stretching one chord member
 * does not drag the others, on either branch.
 *
 * ⚠ THAT SENTENCE WAS ALREADY HERE AND WAS ONLY HALF TRUE (#1318). It described the
 * single-bar branch, which checks pitch; the multi-bar branch twelve lines into the body
 * matched on `start` alone and resized the whole chord. A docblock stating the rule for
 * the surface is exactly where a reader stops looking, so the branch that broke it went
 * unread — measured at 642 of 1,806 multi-bar chord asks, against 0 of 2,772 single-bar.
 *
 * WHERE IT CAPS differs by branch, and that difference is forced by the notation:
 *   single-bar  the grid end. Overlap is expressible as parallel comma-lanes (#628), so a
 *               note may sustain under a later onset and nothing needs to cap it early.
 *   multi-bar   the next onset AT THE SAME PITCH where the document can carry it, the
 *               next onset at ANY pitch otherwise. `<...>` gives each slot one bar, and a
 *               mixed-duration chord inside one has no spelling, so the wide answer is
 *               only taken where it costs no locality — the ladder `placeNote` uses.
 *
 * DECLINES BY RETURNING ITS INPUT, which is new here and is what `canResizeNote` reads.
 * It declines in two cases: where the only writable answer would change a voice the
 * gesture did not address, and where the answer cannot be spelled at all. Before this,
 * both were written anyway — the second as a model serializing to null, which the view
 * then rendered as a length the document never received.
 */
/**
 * Does this model survive the round trip the panel will actually make (#1331)?
 *
 * `ifRollSpellable` asks whether the writer can produce BYTES. This asks the strictly
 * harder question the document actually poses: do those bytes, reopened, hold the same
 * notes? They are not the same question, and the gap between them is where a voice goes
 * missing — stretching one member of a comma-stack re-spells the group as `[g3@4 ~ ~]`
 * and the sibling `f#3` is simply gone. The bytes serialize, they parse, and they come
 * back one note short.
 *
 * Measured over the corpus at the lengths an ordinary drag asks for (`d±1`, 10,960 asks
 * over 595 units): 58 results do not parse at all, and 1,037 parse and lose a note. Every
 * one of the 1,037 is a note COUNT change — none is a duration or position being nudged.
 * That is 1 ask in 10, touching 1,095 of 5,480 notes.
 *
 * ⚠ IT ASKS THE PARSER RATHER THAN MODELLING IT. A predicate that reasoned about which
 * shapes round-trip would be a second description of the grammar and would drift from it;
 * the only trustworthy answer to "will this reopen" is to reopen it.
 *
 * ⚠ COMPARED AS A MULTISET, not a set. A comma-stack can hold the same pitch twice at one
 * start, so keying notes by value would merge twins and hide exactly the loss this is
 * built to catch (#1321). Sorting and comparing pairwise counts duplicates.
 *
 * ⚠ AND IT IS FAR TOO EXPENSIVE FOR THE HOT PATH — this runs the real grammar, and resize
 * fires on every pointermove. Gating the writer on it per frame took p99 from 0.100ms to
 * 549ms and was reverted (#1324). It is affordable once per GESTURE, which is the cadence
 * the caller chooses via `resizeNote`'s `readback` option, never a default.
 */
const rollReadsBack = (next: PianoRollModel): boolean => {
  const out = serializePianoRoll(next)
  if (out === null) return false
  let back = parsePianoRoll(out)
  if (!back.ok) return false
  // ⚠ READ IT BACK IN THE UNITS IT WAS MEANT IN (#1822). A refined view (Slots ×2)
  // counts steps at its own resolution, and a write whose notes no longer need that
  // resolution is spelled at the document's coarser one — so the unrefined re-parse
  // came back with fewer steps and EVERY delete on a refined view was refused. Read
  // the document at the factor it came back coarser by, which is exact: notes that
  // match there match in document units too. Only for a refined model; an unrefined
  // one has no finer unit to be read in, and is judged exactly as before.
  const k = next.steps / back.model.steps
  if (next.viewScale !== undefined && k > 1 && Number.isInteger(k)) {
    back = parsePianoRoll(out, k)
    if (!back.ok) return false
  }
  if (back.model.steps !== next.steps) return false
  if (back.model.notes.length !== next.notes.length) return false
  const key = (n: RollNote): string => `${n.pitch}@${n.start}+${n.duration}`
  const meant = next.notes.map(key).sort()
  const got = back.model.notes.map(key).sort()
  return meant.every((s, i) => s === got[i])
}

/** Options a caller may tighten a roll write with. */
export interface RollWriteOptions {
  /**
   * Require the result to READ BACK, not merely to spell (#1331). Off by default because
   * it parses, and the roll's writers run per drag frame; the panel turns it on once at
   * gesture commit, where one parse is affordable.
   */
  readback?: boolean
}

export function resizeNote(
  model: PianoRollModel,
  start: number,
  pitch: string,
  duration: number,
  opts: RollWriteOptions = {},
): PianoRollModel {
  // The acceptance test, in one place so both branches and every rung use the same rule:
  // spellable always, and readable too when the caller asked for it.
  const accept = (next: PianoRollModel): PianoRollModel =>
    opts.readback
      ? rollReadsBack(next)
        ? next
        : model
      : ifRollSpellable(model, next)
  // ⚠ THE MULTI-BAR BRANCH IGNORED ITS OWN `pitch` ARGUMENT (#1318). It matched on
  // `n.start === start` alone, so resizing one member of a chord resized every note
  // sharing that start — the same rule #1310 and #1315 established for PLACEMENT, never
  // enforced on the gesture next door. Measured over the corpus before this changed:
  // 642 of 1,806 multi-bar chord asks moved a sibling, against 0 of 2,772 on the
  // single-bar branch, which had the pitch check all along and served as the control.
  //
  // The branch justified itself with "parallel lanes are single-bar only" — falsified by
  // #1312 — but the CONCERN behind it was real, and the obvious one-word fix is not the
  // fix: adding `&& n.pitch === pitch` on its own makes 32 writes serialize to null and
  // drop. Scoping the cap on its own is worse again: 1,289 null writes and 343 voices
  // NEWLY moved. So this is a ladder, exactly as the placement cap is.
  if ((model.bars ?? 1) > 1) {
    const capTo = (samePitchOnly: boolean): number =>
      Math.min(
        ...model.notes
          .filter((n) => (!samePitchOnly || n.pitch === pitch) && n.start > start)
          .map((n) => n.start),
        model.steps,
      )
    const build = (cap: number, scoped: boolean): PianoRollModel => {
      const capped = Math.max(1, Math.min(duration, cap - start))
      return {
        ...model,
        notes: model.notes.map((n) =>
          n.start === start && (!scoped || n.pitch === pitch) ? { ...n, duration: capped } : n,
        ),
      }
    }
    const anyCap = capTo(false)
    const sameCap = capTo(true)
    // What shipped: cap at ANY onset, resize the whole chord. It is the floor the rungs
    // are judged against, and the answer where nothing better can be written.
    const legacy = build(anyCap, false)
    // The common case, kept at one write: nothing to choose between when the caps agree
    // and no chord sits at this start. Still gated, because an unspellable answer here
    // used to be written as null and dropped — 110 asks reach only this line.
    if (sameCap === anyCap && model.notes.filter((n) => n.start === start).length < 2)
      return accept(legacy)
    // COST, and it is worth stating because resize runs on every pointermove of a drag.
    // The slow path below serializes up to three times, and the fast path above only
    // covers 21% of multi-bar asks — measured per ask over the corpus:
    //
    //   multi, fast path   p50 0.005ms  p99 0.029ms  worst 1.6ms   (1,440 asks)
    //   multi, ladder      p50 0.014ms  p99 0.100ms  worst 4.3ms   (5,508 asks)
    //   single, gated      p50 0.006ms  p99 0.119ms  worst 7.4ms   (9,492 asks)
    //
    // Against what the panel already pays per frame — `viewPlacesNotes` at roll p99 1.0ms
    // and the grid's per-cell map at p99 2.25ms — the ladder is an order of magnitude
    // under the existing budget, and the single-bar branch's one serialize is the more
    // expensive of the two at the tail.
    const floor = serializePianoRollWithExtent(legacy)
    for (const rung of [build(sameCap, true), build(anyCap, true)]) {
      const out = serializePianoRollWithExtent(rung)
      if (out.mini === null) continue
      if (degradesLocality(out.extent, floor.extent)) continue
      // ⚠ A RUNG THAT SPELLS MAY STILL LOSE A VOICE (#1331). Where the caller asked for
      // readback, skip a rung that does not reopen intact rather than taking the first
      // spellable answer. Measured over the corpus this is a pure GATE and not a rescue:
      // it stops the ladder handing back a lossy spelling for the 436 multi-bar losses,
      // and all 436 then refuse below. Faithful rungs DO exist for 54 of them, and every
      // one is discarded by the `degradesLocality` check above before readback is ever
      // consulted — so walking on rescues NOTHING. Pinned at 0 as `READBACK_SAVES` in
      // `roll-readback.test.ts`, which is what makes it visible if that guard ever moves.
      //
      // Recovering those 54 means preferring a write that re-authors the whole pattern
      // over one that edits the note's own bytes, to save 0.5% of asks from refusing.
      // That trade belongs to the locality arc (#1327), and is deliberately not taken.
      if (opts.readback && !rollReadsBack(rung)) continue
      return rung
    }
    // ⚠ REFUSE RATHER THAN MOVE A VOICE THE GESTURE DID NOT ADDRESS. Falling back to the
    // legacy answer here would keep 222 asks writing a length onto notes the user never
    // grabbed, which is the invariant this change exists to restore — so where the
    // fallback would do that, the gesture declines and the document is left alone.
    // Measured cost: 32 asks that used to produce real bytes now refuse. The other 190
    // were writing null and dropping silently, so the refusal is strictly more honest.
    //
    // ⚠ AND WIDENING INSTEAD OF REFUSING BUYS NOTHING. Re-running the same rungs with the
    // locality guard dropped — accept a rebuild rather than decline — is answer-identical
    // across all 16,440 asks: where the fallback violates, no pitch-scoped rung is
    // writable on ANY path. A mixed-duration chord inside `<...>` has no spelling, so
    // these 32 are the grammar's limit rather than this rule's.
    const movesOthers = legacy.notes.some(
      (n, i) =>
        n.duration !== model.notes[i].duration && !(n.start === start && n.pitch === pitch),
    )
    return movesOthers ? model : accept(legacy)
  }
  // ⚠ THE SINGLE-BAR BRANCH HAS NEITHER DEFECT AND STILL NEEDED THE GATE. It checks pitch
  // and caps at the grid end, so it moves nothing and reads no foreign onset — it is this
  // change's control arm, at 0 on both counts over a LARGER population. But it wrote 395
  // models that serialize to null, which the view then shows as an edit that did not
  // happen. `canResizeNote` did not exist (0 hits across 678 files, against 3 for
  // `canPlaceNote`), so nothing derived admissibility from the writer on either branch.
  const capped = Math.max(1, Math.min(duration, model.steps - start))
  // ⚠ THE SINGLE-BAR BRANCH HAS ONE CANDIDATE AND THEREFORE NO LADDER (#1331). Under
  // readback it can only accept or decline, and it is the larger half of the loss — 663
  // of the 1,099 lossy landings, none of them rescuable, because there is no second
  // spelling to reach for. Whether one could be BUILT is unmeasured; until it is, the
  // honest answer here is to refuse rather than write a document short of a voice.
  return accept({
    ...model,
    notes: model.notes.map((n) =>
      n.start === start && n.pitch === pitch ? { ...n, duration: capped } : n,
    ),
  })
}

/**
 * Is there anything at this cell that DELETE would actually remove and write?
 *
 * Derived from the op, never predicted alongside it — the rule the surface's own
 * catalogue makes the standing one, because a predicate that computes the promise
 * some other way drifts the moment the writer's reach changes.
 */
export const canRemoveNote = (model: PianoRollModel, start: number, pitch: string): boolean =>
  removeNote(model, start, pitch) !== model

/**
 * Remove the note(s) the gesture addressed at (`start`, `pitch`).
 *
 * PLURAL BY CONTRACT (#1321), and that is a decision rather than an accident. A comma-stack
 * can hold the same pitch twice at one start, and `overlapAt` returns the FIRST note
 * covering a cell — so under a singular reading the second twin is unreachable by click,
 * drag or keyboard, and would sit in the document, audible, with nothing able to touch it.
 * Addressing the CELL leaves no such state. `(start, pitch)` is therefore the cell's
 * address here, not a note's identity, and taking every note at it is the promise.
 *
 * ⚠ WHY THIS FUNCTION EXISTS AT ALL — delete was the one roll gesture with no writer.
 * Both call sites were inline `filter`s in `PianoRollGrid.tsx`, so this op never passed
 * through the spellability gate every other op on the surface already had, and it could not
 * have inherited one: an op that never became a function cannot inherit a fix made to the
 * functions. Measured over the corpus before this existed, 595 units / 5,480 asks:
 *
 *     serialized to null   382  (7.0%)   -> the document was left alone and nothing said so
 *     a SURVIVING note changed  0        -> removal never re-spells what it keeps
 *
 * That first number is the same defect, on the same surface, that the step grid's cell
 * gesture had before it was gated — 1,748 of 11,633 there, where a declined click "wrote
 * nothing, toggled nothing and said nothing". The roll's Delete key did exactly that 382
 * times, and the second number is why the fix is a gate rather than a ladder: there is no
 * better spelling to reach for, so the honest answer is to decline and let the panel say so.
 *
 * DECLINES BY RETURNING ITS INPUT, which is what this op family means by "could not apply"
 * and what `canRemoveNote` reads. Three cases decline: nothing at the cell, a result the
 * document cannot spell, and — when the caller asks for it — a result the document would
 * not reopen holding.
 *
 * ⚠ "a SURVIVING note changed 0" ABOVE IS A SPELLING FIGURE, AND DELETE WAS CERTIFIED
 * CLEAN ON THE WRONG QUESTION (#1340). Removal does not re-spell what it keeps, which is
 * what that zero measured; it can still write bytes that REOPEN holding fewer notes. The
 * rest lands inside a nested `<...>` or a `,`-stack and takes the structure with it:
 * deleting `g` from `<[<[b,g] b> a] e>` writes `<[<[b,~] b> a] e>`, which the model means
 * as six notes and the document reopens as three. Measured at 5 of the same 5,480 asks.
 *
 * That the number is small is not why it was missed. The readback sweep concluded delete
 * was clean at 0 and recorded that in a COMMENT rather than an assertion, so the claim
 * could never fail and the instrument behind it was not kept. Every positive figure this
 * surface produced is pinned; the one negative carrying a closure argument was not.
 */
export function removeNote(
  model: PianoRollModel,
  start: number,
  pitch: string,
  opts: RollWriteOptions = {},
): PianoRollModel {
  const notes = model.notes.filter((n) => !(n.pitch === pitch && n.start === start))
  if (notes.length === model.notes.length) return model
  const next = { ...model, notes }
  // Spellable always, and readable too when the caller asked for it — the same acceptance
  // test `resizeNote` uses, so the five writers cannot drift apart on what "admissible"
  // means.
  return opts.readback ? (rollReadsBack(next) ? next : model) : ifRollSpellable(model, next)
}

/**
 * Is this drag's drop admissible? Derived from the op, never predicted beside it —
 * the standing rule on this surface, so the promise and the write cannot disagree.
 */
export const canMoveNote = (
  base: PianoRollModel,
  fromPitch: string,
  fromStart: number,
  toPitch: string,
  toStart: number,
): boolean => moveNote(base, fromPitch, fromStart, toPitch, toStart) !== base

/**
 * Move the note(s) the drag grabbed at (`fromPitch`, `fromStart`) to (`toPitch`, `toStart`).
 *
 * ⚠ WHY THIS TAKES THE GESTURE'S FIXED BASE AND NOT `prev`. A move drag fires on every
 * pointermove, and `mutate` re-parses the document from bytes each time — so a writer fed
 * the PREVIOUS frame's result would re-derive its own clamp against a note it had already
 * moved, and the length would ratchet: a frame near the grid end shortens the note, and
 * dragging back does not restore it. The panel already knew this and rebuilt from a fixed
 * base each frame; that base is this function's input, so the property survives the
 * consolidation instead of being re-discovered.
 *
 * ⚠ SINGULAR, AND DELIBERATELY NOT `removeNote`'S PLURAL CELL. `(start, pitch)` is not an
 * identity — a comma-stack can hold the same pitch twice at one start. Delete addresses
 * the whole cell (#1321), and it is worth saying why move does not follow it: delete's
 * inline filter matched on `(pitch, start)` BY VALUE, so that gesture was already plural
 * and the ruling only wrote down what shipped. Move's inline build excluded the grabbed
 * note BY REFERENCE — it is shipped SINGULAR, and the precedent was never move's.
 *
 * Measured, the difference is not academic — 6,529 of 982,157 pointer-reachable asks land
 * on a cell with a twin, and taking both changes the answer on every one of them.
 * ⚠ An earlier reading put that cost far higher (10,290 answers, 1,176 refusals) because
 * the sweep grabbed each note BY INDEX, including second twins no pointer can grab. Asks
 * the panel cannot make are not evidence about the panel.
 *
 * And move is the one gesture that can UN-STACK a twin: relocate the note the view shows
 * and the two become individually addressable, where taking both keeps them stacked and
 * unreachable for good. So the singular reading serves the identity problem better here
 * than the plural one does — the opposite of how it falls out for delete.
 *
 * The note is addressed by INDEX into the base, which is sound precisely because `base` is
 * captured ONCE per gesture: the index cannot drift under a re-parse the way it would if
 * this took `prev`. First-at-cell is the note `overlapAt` returns, i.e. the one drawn.
 *
 * ⚠ IT CARRIES `gain`, WHICH THE INLINE BUILD COULD NOT. The panel constructed
 * `{ pitch, start, duration }` literally, and a literal cannot carry a field it does not
 * name — so a drag would reset the note's velocity and write that as a second edit riding
 * on the first. Spreading the grabbed note keeps whatever the model holds.
 * ⚠ NO CORPUS UNIT WITNESSES THIS: 0 of 988,686 asks grab a note with a non-neutral gain,
 * so it is fixed by construction and NOT on evidence. Said plainly because the rest of
 * this comment is measured and this part is not.
 *
 * DECLINES BY RETURNING ITS INPUT, which is what this op family means by "could not
 * apply". Two cases decline: nothing at the grabbed cell, and a result the document
 * cannot spell.
 *
 * ⚠ A DROP WHERE THE NOTE ALREADY IS IS NOT A DECLINE, and the distinction is the whole
 * reason to say so here. Mid-drag the document sits at the last accepted position, not at
 * the base — so "declined" has to mean LEAVE IT ALONE, while dropping the note back on its
 * own cell has to mean GO HOME. Both would return the base model, and the caller cannot
 * tell them apart from the return value. Rebuilding the base's own content for a self-drop
 * keeps the two answers distinguishable by identity: a refusal is the input, a restore is
 * an equal-but-new model the caller writes.
 */
export function moveNote(
  base: PianoRollModel,
  fromPitch: string,
  fromStart: number,
  toPitch: string,
  toStart: number,
  opts: RollWriteOptions = {},
): PianoRollModel {
  // ⚠ A LOOK-ONLY MODEL IS REFUSED BY NAME HERE, AND ONLY HERE (#1975). Every other op
  // spreads its input, so the mark rides along and the writer declines the result. This
  // one builds `rebuilt` field by field below — the mark would be dropped, and a model
  // with no mark and no source is exactly what the rebuild spells: the whole-pattern
  // respell a look-only view exists to stop. Found by the op enumeration in
  // `lookOnly.test.ts`, which is what a new from-scratch op has to pass too.
  if (base.lookOnly) return base
  const idx = base.notes.findIndex((n) => n.pitch === fromPitch && n.start === fromStart)
  if (idx < 0) return base
  const grabbed = base.notes[idx]
  const start = Math.max(0, Math.min(toStart, base.steps - 1))
  const rest = base.notes.filter((_, i) => i !== idx)
  // The note keeps the length it had, clamped to what is left of the grid — the panel's
  // own rule, moved in here so the writer owns every part of what a move means.
  const landed = {
    ...grabbed,
    pitch: toPitch,
    start,
    duration: Math.max(1, Math.min(grabbed.duration, base.steps - start)),
  }
  const notes = [...rest, landed]
  // ⚠ THIS RE-AUTHORS, AND THE LOCAL WRITE IT DOES NOT DO IS A MEASURED, DELIBERATE GAP.
  //
  // Keeping the document's own `source`/`altSource`/`leafSource` would make this span
  // surgery instead, and the prize is large and real: on `roll-isolation`'s population,
  // 168,533 of 172,185 moves re-author the whole pattern, and anchoring takes that to
  // 23,834. Dragging one note currently reformats the document.
  //
  // ⚠ AND IT IS NOT SAFE YET, which only a control arm showed. The anchored write SPELLS
  // — `serializePianoRoll` returns bytes — but those bytes do not read back as what the
  // writer meant: 5,867 of 59,030 writes (9.94%) reopened holding different notes, against
  // 10 of 58,802 (0.02%) for the re-authoring path, and where the re-authoring path's ten
  // are all grid RESCALES, only 31 of the anchored path's are. Spelling is not fidelity.
  //
  // The check that would make anchoring safe is a READBACK, and move fires on every
  // pointermove — the same cadence that made #1324's readback unshippable at p99 549ms.
  // So the locality fix belongs at the boundary where ONE parse per GESTURE is affordable,
  // not here. Until then this writes the way the panel always did, and what it adds is the
  // refusal the panel could never make.
  //
  // ⚠ AND THE RE-AUTHORING PATH IS NOT ITSELF CLEAN — "10 of 58,802 (0.02%)" above is
  // not zero, and move was still carried as clean at 0 and left ungated (#1340). Measured
  // over the gestures the panel's own `tokenForRow` vocabulary and overlap resolver can
  // actually produce, 14 of 20,587 asks write a document that reopens holding different
  // notes. `readback` is what the commit-time re-run turns on.
  const rebuilt: PianoRollModel = {
    steps: base.steps,
    ...(base.bars != null ? { bars: base.bars } : {}),
    // Not a source: the RULER the notes are measured in. A roll drawn per bar (#1827)
    // holds drawn columns, and without its counts the writer reads them as shared ones.
    ...(base.barSteps ? { barSteps: base.barSteps } : {}),
    ...(base.numeric ? { numeric: true } : {}),
    notes,
  }
  // Same acceptance test as every other writer here. Off by default because a move fires
  // per pointermove; the panel turns it on once, at gesture commit.
  return opts.readback ? (rollReadsBack(rebuilt) ? rebuilt : base) : ifRollSpellable(base, rebuilt)
}
