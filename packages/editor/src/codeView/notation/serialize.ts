/**
 * Notation models → mini-notation. The round-trip law (golden-tested):
 *   serialize(parse(s).model) === s   for canonical strings
 *   parse(serialize(m)).model ≡ m
 *
 * Canonical form: single-space separated, lanes in first-appearance order,
 * multi-bar patterns as a whole-string `<...>` alternation (one slot per bar),
 * `,`-stack parts in ascending part order. Serializing a model the subset
 * can't express (overlapping roll notes, a note straddling a bar line) returns
 * null and the panel keeps the document untouched.
 */
import type {
  AltSource,
  GainWrite,
  GridCell,
  GridCells,
  LeafSource,
  LeafSpan,
  NotationSource,
  PianoRollModel,
  RollLeafAnchor,
  RollLeafSource,
  RollNote,
  SourcePart,
  StepGridModel,
  StepLane,
} from './model'
import { cellLengthKey, columnSplit, gridCellKey, isCellOn } from './model'
import { barStarts, lcmOf, toUniformGrid, toUniformRoll } from './perBar'

/**
 * An `altSource` still describes a model only while its single-cycle width times
 * its bar count equals the model's columns. A restructure (resolution scale,
 * quantize) that moved the width out from under it leaves it stale — splicing
 * against stale spans would emit wrong bytes, so the caller falls back to the
 * whole-cycle rebuild instead (the #916 covers-check, for the alt writers).
 */
function altSourceFits<C>(a: AltSource<C> | undefined, steps: number): a is AltSource<C> {
  return !!a && a.perBar * a.bars === steps
}

/**
 * Format a velocity for a `.gain("…")` token: 2 decimals, trailing zeros and
 * any orphaned point stripped, so a drag's `0.5000001` comes out `0.5`. Local
 * (not writeback's `formatNumber`) so the notation layer stays free of the
 * binding layer; gain needs only 2 decimals.
 */
function fmtGain(v: number): string {
  if (!Number.isFinite(v)) return '1'
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2).replace(/\.?0+$/, '')
}

/* ── op admissibility: ASK THE WRITER, never predict it ──────────── */

/**
 * An op's result, or the input UNCHANGED when the writer cannot spell it.
 *
 * WHY THIS EXISTS, and why it lives here rather than in each op (#1010 P4c). The ops
 * each carried a hand-written `can<Op>` predicate that reasoned about the MODEL — "every
 * odd column is empty", "the gains are neutral", "the bars stay integral" — and from
 * that PREDICTED whether the writer would accept the result. That is a second oracle for
 * the writer's admissibility ([[PV192]]), and it broke the moment the printer's rules
 * changed: P4c made the printer preserve a note's length, which the grid can only spell
 * as a whole number of columns ≥1, and every COARSENING op scales a length below that.
 * Measured over the corpus: ÷2 went from 0 declines to 24 of the 24 units where it is
 * offered — the button present and doing nothing — plus quantize-down and
 * resize-spread-down, with no gate anywhere seeing it, because each op's A/B compared
 * that op to ITSELF ([[PK64]]) and never reached the writer.
 *
 * The rule this replaces the predictions with is one the project already proved at the
 * READ boundary and simply had not applied to the OPS:
 *
 *   prove-before-offer — `parse.ts:1638` ("the writer must reproduce the user's bytes
 *   before we offer the view at all") and `leafViewUsable` ("Asked of the REAL writer …
 *   so the check cannot drift from what an actual click does").
 *
 * So an op is admissible exactly when its result is WRITABLE, asked of the real writer.
 * One rule for every op including ops not yet written; it cannot drift from the printer;
 * and it needs no per-op length reasoning, which leaves [[PV240]]'s table alone — ÷2
 * still SCALES, it is simply not offered where scaling produces something unspellable.
 *
 * WHY REFUSE RATHER THAN CLAMP TO ONE COLUMN. Clamping would keep ÷2 working and change
 * every note's length instead (1/8 → 1/4). `SequencerGrid.tsx` never reads `duration`, so
 * that change is INVISIBLE in the panel — and #1026 already ruled on exactly this: a view
 * that cannot show duration still must not change it, because "edits locally / no silent
 * data loss" is a property of the DOCUMENT, not of the panel. An op the user explicitly
 * asked for is no licence to alter an axis the view cannot show them.
 *
 * Returning the INPUT (by reference) rather than null is what makes this composable: the
 * `notation/` op family already signals "could not apply" that way, so `mutate` skips the
 * write and every `can<Op>` reduces to `op(model) !== model` with no extra plumbing.
 *
 * NOT the same thing as leaning on an incidental refusal. `resize.ts`'s `restructured()`
 * warns against treating a writer null as a substitute for invalidating stale regions,
 * and that still holds: this gate is a deliberate admissibility question asked of the
 * writer, not a length check that happens to catch a provenance bug.
 */
export function ifGridSpellable(input: StepGridModel, next: StepGridModel): StepGridModel {
  if (next === input) return input
  return serializeStepGrid(next) === null ? input : next
}

/** the roll's half of `ifGridSpellable` — same rule, the other writer */
export function ifRollSpellable(input: PianoRollModel, next: PianoRollModel): PianoRollModel {
  if (next === input) return input
  return serializePianoRoll(next) === null ? input : next
}

/* ── drum grid ─────────────────────────────────────────────────── */

/**
 * HOW MUCH OF THE DOCUMENT A GRID WRITE MOVED — reported by the writer, never
 * reconstructed from its output (#1058).
 *
 * "Only the touched element's bytes move" is the property #1052's whole case
 * rests on, and until now the only way to check it from outside was to walk
 * `prefix`/`before`/`raw`/`after`/`suffix` back into absolute offsets and read a
 * byte diff against them. That walk is a SECOND DESCRIPTION of the order
 * `spliceGrid` concatenates in, and it is wrong in a way its own output cannot
 * reveal: when a voided `,`-part holds a single element, rebuilding the part and
 * re-emitting that element produce a diff of the same shape. Measured over 15,200
 * asks, the walk called 208 part-rebuilds local — 0 errors the other way, so the
 * whole error runs toward the verdict nobody re-checks (#1137).
 *
 * The writer already decides both facts, one `if` each, and threw them away. This
 * hands them back.
 *
 * A UNION RATHER THAN SENTINEL COUNTS, deliberately. Only the splice path has
 * regions to count; leaf surgery anchors at each note's own span and the rebuilds
 * re-derive everything. Giving those a `0` would read as "moved nothing", which is
 * the opposite of true for a rebuild — so the shape makes the unmeasurable case
 * unrepresentable as a number instead of relying on a caller to remember.
 *
 * `rebuiltParts` carries HOW MANY REGIONS each rebuilt part held, not just how
 * many parts there were. A part holding a single element is rebuilt and re-emitted
 * to the same bytes, so that case may not be non-local at all — and a caller
 * cannot tell without this, because "which part did you rebuild" is a fact only
 * the writer has. Reporting a bare count pushes the caller into guessing it back
 * from the model, which is the same second-description mistake one level down.
 *
 * ⚠ `path` says WHICH WRITER answered, not whether anything was written. `mini` is
 * null on `'declined'` AND wherever the answering writer had no spelling — a leaf
 * splice or a rebuild can each return null on their own path. Read `mini` for "did
 * it write", `path` for "who decided". Testing one for the other is right today
 * only because no corpus placement reaches the second case.
 *
 * `regions` is reported alongside the re-emitted count because "one element moved"
 * is only a promise when there is more than one element to choose between. A unit
 * whose source is a SINGLE region covering the whole cycle — `hh(<3,7>,16)`,
 * `amen/4` — re-emits that one region and satisfies every locality rule
 * vacuously, while the write is in fact a whole-cycle re-derivation. That class
 * was found by #994's self-review and is what `vacuousLocality` routes around at
 * parse time; reporting `1 of 1` rather than `1` is what lets a caller see it.
 */
export type GridWriteExtent =
  | { path: 'splice'; regions: number; regionsReemitted: number; rebuiltParts: number[] }
  | { path: 'leaf' | 'alt' | 'rebuild' | 'declined' }

/**
 * `serializeStepGrid`, plus what the write touched.
 *
 * This is the implementation and `serializeStepGrid` is the projection of it, so
 * the extent cannot describe a write the caller did not get ([[PV200]]: one
 * authority, never two that agree the day they are written).
 */
export function serializeStepGridWithExtent(drawn: StepGridModel): {
  mini: string | null
  extent: GridWriteExtent
} {
  // A LOOK-ONLY model has no spelling, and this is where that is true for every op at
  // once (#1975): each op asks this writer whether its result can be written, so a
  // decline here is a decline everywhere, including ops not yet written. Without it the
  // model would fall to `rebuildGrid` below — it carries no source — and come back as
  // the whole-pattern respell these views exist to stop.
  if (drawn.lookOnly) return { mini: null, extent: { path: 'declined' } }
  // A grid drawn per bar (#1827) holds DRAWN columns; every writer below slices bars
  // as equal runs of the SHARED grid its regions were captured in, so it gets that.
  const model = toUniformGrid(drawn)
  const respell = drawn.barSteps
  // A leaf-anchored grid (#986) is written by byte surgery at each note's own
  // span and NEVER rebuilt: its notation is precisely what no re-emit of ours can
  // spell, so a rebuild would destroy the pattern the projection opened. An edit
  // it can't express as a byte replacement returns null — the binding layer then
  // leaves the document (and the model) untouched.
  // BYTE SURGERY FIRST, WHEREVER SPANS EXIST (#1010 P4d). Two fields reach it and
  // they differ in what a REFUSAL means, which is the whole of the safety argument:
  //
  //   `leafSource`  — the leaf projection OWNS this view. Terminal: an edit it cannot
  //                   express is refused and the document is left alone, because the
  //                   re-emit is precisely what would destroy the notation this view
  //                   was opened to preserve. Falling back here would hand the re-emit
  //                   the 275 shared-leaf deletes #1160 declines, and would answer
  //                   `amen/4`'s only cell with `<~ ~ ~ ~>` — the case `vacuousLocality`
  //                   exists to route around.
  //   `surgical`    — the ELEMENT writer owns this view and these spans are overlaid on
  //                   it. A refusal falls through to the element paths below, which is
  //                   exactly what this model did before P4d, so the fallback can only
  //                   restore today's behaviour and never introduce a write.
  //
  // ⚠ A STALE OVERLAY CANNOT MIS-WRITE. `anchorsDescribe` requires the anchored width
  // to still describe the model before either leaf writer may write, so an overlay that
  // no longer fits (a restructure moved the layout, or the element projection drew a
  // different column count) REFUSES and the element writer answers. The guard predates
  // this and is the same one both leaf writers already call (#916, #990).
  //
  // ⚠⚠ THIS RUNG IS HOISTED, AND THAT FORFEITS THE LADDER'S FREE SAFETY PROOF — stated
  // in full on `serializePianoRollWithExtent`, and it applies here first because P4d is
  // where the hoist was introduced. Every other widening of this writer (`stackedRegion`
  // #1120, absorption #1146) runs only where the previous rung returned null and is
  // therefore safe by construction; this one runs FIRST and can pre-empt alt / splice /
  // rebuild, so it is safe only by the corpus:
  //
  // ⚠ A DATED RECORD, NOT CURRENT READINGS. These are what the corpus said when this rung
  // landed (#1236, 2026-08-13), and the claim they support is "this hoist moved nothing".
  // Restating them against today's corpus would falsify that measurement rather than
  // refresh it, so they are deliberately left at their measured values. For today's
  // writer-reach read `writer-reach.test.ts`, which holds the live floors and is swept by
  // the cap sweeps; nothing here is a floor and nothing re-derives it.
  //
  //   surgical deletes  64 -> 103     placements  18,929 -> 18,929 (unchanged)
  //   writer-reach      153 / 85      view scale  890 -> 890 honoured
  //   shared-leaf refusals 275, unchanged — 27 documents preserved
  //
  // Placing a NEW rung last inherits the proof for free. Placing it here does not.
  // ⚠ `spans()` IS THE PROJECTION, PAID HERE AND NOT AT PARSE (#1233). It runs at most
  // once per model and only on a write, which is the whole point: a parse that never
  // writes never pays it. The source it hands back already carries the overlay's
  // attach-time width, so `anchorsAreFor` below stays the one place that rule is enforced.
  const spans = model.leafSource ?? model.surgical?.spans()
  if (spans) {
    const surgical = spliceByLeaf(model, spans)
    // ⚠ A STACK WHOSE PARTS ARE WRITTEN BAR BY BAR (#1849): the splice owns the bar
    // rule, and it overrides the in-place write only where the two DISAGREE — an edit
    // that makes a part's bars agree again writes it back as one bar, where the leaf
    // write would keep `<hh*8 [hh hh hh hh hh hh hh hh]>`. Where they agree the leaf
    // write answers, exactly as before.
    if (surgical !== null && !model.leafSource && perBarStack(model)) {
      const bars = spliceGrid(model, respell)
      if (typeof bars === 'object' && bars.out !== surgical) {
        return {
          mini: bars.out,
          extent: {
            path: 'splice',
            regions: bars.regions,
            regionsReemitted: bars.regionsReemitted,
            rebuiltParts: bars.rebuiltParts,
          },
        }
      }
    }
    if (surgical !== null) return { mini: surgical, extent: { path: 'leaf' } }
    if (model.leafSource) return { mini: null, extent: { path: 'leaf' } }
  }

  // A `<...>`-as-element pattern (`bd <sd hh>`, #920) uses its own span surgery
  // and NEVER the rebuilds below — a rebuild would reshape it into the
  // whole-cycle `<[bd sd] [bd hh]>`. Every grid edit is a cell toggle, always
  // expressible, so this path is total (unlike the roll's, which can decline).
  // The guard is the #916 covers-check: if a restructure moved the width out from
  // under the source, it no longer describes this grid — fall to the rebuild
  // (reshaped notation, correct haps) rather than splice against stale spans.
  if (altSourceFits(model.altSource, model.steps))
    return { mini: spliceAltGrid(model), extent: { path: 'alt' } }

  // Span surgery first: it puts back what the user wrote wherever they didn't
  // edit. Three answers, and the third is new in P4c:
  //   a record   — spliced, carrying how much of the source it had to re-emit;
  //   'rebuild'  — the regions no longer describe the grid, so `rebuildGrid`
  //                takes over, the way this always worked;
  //   'decline'  — a length this grid carries has no spelling at its resolution.
  // The last MUST NOT fall through to `rebuildGrid`: the rebuild is exactly the
  // re-derivation that drops the length, so falling through would turn a refusal
  // back into the silent corruption it exists to prevent.
  const spliced = spliceGrid(model, respell)
  if (spliced === 'decline') return { mini: null, extent: { path: 'declined' } }
  if (spliced !== 'rebuild')
    return {
      mini: spliced.out,
      extent: {
        path: 'splice',
        regions: spliced.regions,
        regionsReemitted: spliced.regionsReemitted,
        rebuiltParts: spliced.rebuiltParts,
      },
    }
  // a grid drawn per bar is rebuilt from its DRAWN columns, where each bar is whole cells
  return { mini: rebuildGrid(respell ? drawn : model), extent: { path: 'rebuild' } }
}

/**
 * The mini a grid model writes back, or null where it has no spelling.
 *
 * Every caller that only needs the bytes uses this; the extent above is for the
 * ones asking how much of the document moved. One implementation, so the two can
 * never disagree about what was written.
 */
export function serializeStepGrid(model: StepGridModel): string | null {
  return serializeStepGridWithExtent(model).mini
}

/**
 * Re-derive the whole mini from the model — lossy, and always was. Reached only
 * where the source regions no longer describe this grid.
 *
 * Named and split out so `serializeStepGridWithExtent` can report WHICH path
 * answered without duplicating the decision; the body is unchanged.
 *
 * ⚠ Reached only where the splice said `'rebuild'` — never where it DECLINED. The
 * rule and its reason live at the branch that enforces it, above (#1010 P4c).
 */
function rebuildGrid(model: StepGridModel): string | null {
  const bars = model.bars ?? 1
  if (bars > 1) return gridBars(model, barBounds(model))

  const parts = [...new Set(model.lanes.map((l) => l.part ?? 0))].sort((a, b) => a - b)
  if (parts.length <= 1) return gridColumns(model.lanes, model.steps)?.join(' ') ?? null
  const lines = parts.map((p) =>
    gridColumns(
      model.lanes.filter((l) => (l.part ?? 0) === p),
      model.steps,
    )?.join(' '),
  )
  return lines.some((l) => l === undefined) ? null : lines.join(', ')
}

/* ── WHAT STILL AUTHORS SYNTAX, AND WHY (#1010 P4e) ─────────────── */

/**
 * THE MAP FOR EVERY SURVIVING `reemit*` DECISION POINT. Eight invocations, five of
 * which decide anything: `spliceRegions`' own re-emit and its sustain-ABSORB
 * fallback (both inside `spliceGrid`), plus one each in `spliceAltGrid`,
 * `spliceRoll` and `spliceAltRoll`. Each carries a one-line pointer back here.
 * (`reemitAltRegion` → `reemitRegion`, `reemitRegion` → `reemitStep` and
 * `reemitAltRoll` → `reemitRollRegion` are internal to those five and decide
 * nothing; they are annotated as such.) Named rather than numbered on purpose —
 * a line citation in this file is stale by the next edit.
 *
 * #1010's claim is that once every edit WITH A SPAN routes through byte surgery,
 * what still authors notation reduces to three irreducible cases:
 *
 *   1. adding structure where the source has no leaf
 *   2. the signal tail, which has no source span at all
 *   3. `@n` duration, which is never a location
 *
 * ⚠ A DATED OBSERVATION, not a live gate, and there is nothing left to re-run it
 * with. Measured 2026-08-17 on `0c785cf4` with a THROWAWAY probe: a counter at each
 * of the five sites, driven over `mini-corpus.json` (1,633 minis → 1,021 opening a
 * step grid, 597 a piano roll). Gestures per unit, and they differ by surface: on
 * the grid ≤2 deletes, ≤2 placements, 1 resize and one "double the resolution, then
 * place in the new slot"; on the roll ≤2 deletes, 1 resize, 1 placement. Recipe,
 * not a receipt — the probe is deleted because it can only run against an
 * instrumented copy of this file, and a committed instrument that cannot run is
 * worse than none ([[P592]]). Re-take it before quoting these digits as current.
 *
 * WHO ANSWERED EACH GESTURE (asks posed → the writer that answered):
 *
 *     grid delete      1663    leaf 1087 · splice 480 · alt  96             → 576 re-emit
 *     grid place       1030    leaf  136 · splice 782 · alt 112             → 894 re-emit
 *     grid resize       156    leaf    0 · splice 134 · alt  22             → 156 re-emit
 *     grid subdivide     934   leaf    0 · splice 873 · rebuild 61          →   0 re-emit
 *     roll delete      1097    leaf  802 · splice 206 · alt 81 · rebuild  8 → 287 re-emit
 *     roll place        537    leaf    0 · splice 467 · alt 56 · rebuild 14 → 523 re-emit
 *     roll resize       596    leaf  239 · splice 146 · alt 29 · rebuild 182→ 301 re-emit
 *
 * ⚠ THE LAST COLUMN IS ASKS REACHING A SITE, NOT ASKS IT ANSWERED. A re-emit can run
 * and the write still end in a rebuild, so the two coincide on six rows and diverge
 * on the seventh: roll resize reaches a site 301 times against a splice+alt total of
 * 175. Do not read the column as a sum of the two before it.
 *
 * THE MAPPING, and two of the three cases do not land where the issue supposes:
 *
 *   CASE 3 — `@n` duration. Every resize that reaches a writer at all reaches one of
 *     these five; on the grid byte surgery answers ZERO of 156, because a length is
 *     not a location and there are no bytes to replace at one. One site is EXCLUSIVELY
 *     this case (64 of 64 asks were resizes) — the sustain-ABSORB fallback maps to
 *     one case and one only, the only site of the five that does.
 *
 *   CASE 1 — structure with no leaf. The PLACEMENT population: 894 grid and 523 roll
 *     asks, a new note in a slot the source never indexed (#1154 — a leaf-anchored
 *     view takes one only where a rest was indexed, which is the 136 surgery does
 *     answer). ⚠ But case 1's own parenthetical — "a resolution change, subdividing"
 *     — reaches NO re-emit site at all: 934 asks, 0 hits, answered by the part
 *     rebuild inside the splice path (873) and by `rebuildGrid` (61). The mapping
 *     rests entirely on the OTHER half of that sentence.
 *
 *   CASE 2 — the signal tail. Reaches no site here. `serializeStepGain` and
 *     `serializeRollGain` call nothing in this family; the tail was never one of
 *     these writers' populations.
 *
 *   ⚠⚠ NONE OF THE THREE — the DELETE population, 576 grid + 287 roll asks. A delete
 *     HAS a span (the note's own bytes) and surgery answers most of them (1087 and
 *     802). The remainder fall through where the leaf is SHARED between columns
 *     (#1160) or where the unit carries no leaf index at all, and notation is
 *     authored for an edit that had bytes to replace. That is a fourth case, it is
 *     not irreducible, and it is filed rather than left as a silent survivor: #1295.
 *
 * ⚠ ONE INVARIANT OBSERVED RATHER THAN ASSUMED: across all 2,801 hits, NOT ONE had
 * `leafSource` set. The terminal field never falls through to a re-emit, which is
 * the safety property both ladders above assert in prose and nothing else measures.
 *
 * ⚠⚠ THIS FAMILY IS A SUBSET OF THE AUTHORING SURFACE, AND EVERY FIGURE ABOVE IS
 * SCOPED TO THE FAMILY (#1298). #1007 defines the concern as a PROPERTY — emitting
 * Strudel text from a model — and then locates it at these functions. The two are not
 * the same set. Three emitters satisfy the property and are named by neither #1007's
 * list nor #1010's: `gridColumns` reached from `rebuildGrid` and from the part rebuild
 * in `spliceGrid` (`out += rebuilt.join(' ')`), and `serializeRollLanes` on the roll's
 * rebuild path.
 *
 * SO DO NOT READ "REACHES NO RE-EMIT SITE" AS "DOES NOT AUTHOR" — the subdivide row
 * above is exactly that trap. Its 934 asks reach none of these five sites and author
 * anyway: a subdivide+place spells one element as a GROUP in place, which is authoring
 * at a smaller scale than this family covers.
 *
 * ⚠⚠ AND THE COST OF THAT AUTHORING IS A PROPERTY OF THE ROUTE, NOT OF THE GESTURE
 * (#1300) — the same confusion as the paragraph above, one level down, and it very
 * nearly shipped here as a figure about the product. Measured paired over the same 934
 * units, bytes moved p50 on documents ≥40 chars (n=84):
 *
 *   SHIPPED road   `parseStepGrid(mini, k)` — a refined VIEW whose model still
 *                  carries the source regions, so the splice subdivides ONE element
 *                  and copies the rest .......................................  0.298
 *   model rescale  `scaleStepGrid`, which no production code outside `resolution.ts`
 *                  calls; the source description does not survive it, so the line is
 *                  re-derived whole ..........................................  0.988
 *   leaf surgery   a delete written at the note's own span (the local anchor)...  0.036
 *
 * The neighbouring parts a user never touched come back BYTE-IDENTICAL on the shipped
 * road. So the shipped subdivide sits at roughly 8x the most local write available
 * rather than 27x, and whichever figure is quoted has to name the road it was taken
 * on. The ÷k guard is not what buys this: it answered at document resolution 0 times
 * of 934, because a placement into a column only the finer view has is precisely the
 * case `collapseStepGridToDocument` should decline.
 *
 * ⚠⚠ AND EVERY FIGURE ABOVE IS SCOPED TO THE STEP GRID (#1309) — the same confusion a
 * third time, and the one that survived longest, because the ROAD is named here and the
 * SURFACE is not. All of it was posed of `parseStepGrid`, which refuses 282 corpus minis
 * the piano roll opens; 244 movable units, 14.9% of the corpus, are outside every figure
 * above BY CONSTRUCTION rather than by sampling, and a further 296 were seen by a grid
 * probe asking a grid question of them.
 *
 * Asked of the roll in the same instrument shape, it answers the same — which is what
 * licenses reading these as facts about the GESTURE rather than about the grid:
 *
 *                                          grid        roll
 *   shipped road, docs >= 40 ...........   0.298       0.255
 *   model rescale ......................   0.988       0.978
 *   delete at the note's own span ......   0.036       0.036
 *   left the element it had to touch ...   0 of 873    0 of 470
 *   ÷k guard answered at document ......   0 of 934    0 of 538
 *
 * TWO DIFFERENCES THE AGREEMENT DOES NOT COVER, and neither is a defect claim. The model
 * rescale REBUILDS all 539 roll units where on the grid it still splices 873 of 934, so
 * that road destroys roll notation universally and grid notation only sometimes. And the
 * spelling residue one level down is about twice as common: the write spreads beyond the
 * atom it subdivides on 104 of 375 roll asks (27.7%) against 84 of 585 on the grid
 * (14.4%). Measured by `_1309-roll-subdivide-route.spec.ts` and
 * `_1309-roll-floor-and-witness.spec.ts`, with the denominator in
 * `_roll-subdivide-denominator.spec.ts`.
 *
 * ⚠ AND CHECK WHAT A CALL DOES BEFORE COUNTING IT. `serializeStepGain` also calls
 * `gridColumns` and is NOT authoring — it uses the result as a predicate (which
 * columns carry an audible gain) and never emits it. An edge to an emitter is not an
 * authoring site; that distinction is the whole reason the family and the property
 * diverge. CASE 2 above stands unchanged for this reason.
 */

/* ── span surgery (#913) ───────────────────────────────────────── */

/**
 * Write back by editing the user's own bytes: every source region whose content
 * the user did not change is copied through VERBATIM, and only the regions they
 * did change are re-emitted from the grid.
 *
 * This is what stops an edit from being collateral. The model is a flat boolean
 * grid — it never knew the `*2` in `bd hh*2 sd cp` existed — so rebuilding the
 * whole string from it destroys every notation the grid can't express, whether
 * or not the edit went anywhere near it. Rebuilding only the touched region
 * bounds the damage to what was actually touched, and the unedited round-trip
 * (`serialize(parse(m)) === m`) falls out as a consequence rather than being a
 * case anyone has to special-case.
 *
 * Returns `'rebuild'` when the regions no longer describe this grid — then the
 * caller rebuilds from the model, which is lossy and always was — and `'decline'`
 * when a length here cannot be spelled, which the caller must NOT rebuild past.
 *
 * On success it reports HOW MUCH it had to re-emit alongside the bytes. Both
 * numbers are already decided by the two branches below; returning them is what
 * lets a caller check "only the touched element moved" without re-deriving where
 * the bytes went from the output (#1058, #1137).
 */
function spliceGrid(
  model: StepGridModel,
  /** the bars' own counts when the grid is drawn per bar (#1827) */
  respell?: readonly number[],
):
  | { out: string; regions: number; regionsReemitted: number; rebuiltParts: number[] }
  | 'rebuild'
  | 'decline' {
  const src = model.source
  if (!src || src.parts.length === 0) return 'rebuild'
  let regionsReemitted = 0
  const rebuiltParts: number[] = []
  // ⚠ THERE WAS A GUARD HERE, AND THE ENGINE REFUTED IT (#1123). It rebuilt the whole
  // grid flat whenever a per-column `.gain("…")` had to be written, reasoning that the
  // gain mini "runs 1:1 against the FLAT column sequence, so a grid carrying one has to
  // keep emitting that sequence or the velocities land on the wrong notes."
  //
  // The 1:1 relationship is with the COLUMNS, and a splice preserves those exactly — it
  // changes only how they are SPELLED. A grid model's columns are the uniform expansion
  // by construction, so a flat per-column gain mini aligns with any notation the model
  // can represent: in `bd [hh hh] sn cp` the `bd` owns gain tokens 0-1 and each `hh`
  // owns one, and Strudel samples every note's gain at its own onset either way.
  //
  // Settled by asking Strudel rather than by reading either writer ([[P301]]). Over the
  // 220 corpus units where the two spellings differ: the engine plays 217 identically,
  // and in the 3 that differ NO note receives a different gain — the difference is the
  // REBUILD losing content (a deduped chord member, an alternation inside a euclid
  // argument). Measured against the user's own document, the splice matches on all 220
  // and the rebuild on 217, so the guard was never protecting a case that existed and on
  // 3 units it silently changed what plays.
  /**
   * One part's bytes (without its `before`/`after`) from `lanes`, `steps` columns wide:
   * its untouched regions verbatim, the touched ones re-emitted, and the whole part
   * rebuilt only where no region splice can describe it (`rebuilt` = its region count).
   */
  const splicePart = (p: SourcePart<GridCells>, lanes: StepLane[], steps: number): PartSplice | 'decline' => {
    // READ THE PART AT THE FINEST WIDTH ITS OWN ELEMENTS STILL DESCRIBE (#1137).
    //
    // `partColumns` refuses when a hit lands BETWEEN this part's columns — the user
    // painted finer than the part's notation holds — and that used to void the whole
    // `,`-part and re-derive it from the model. It is a rebuild wearing a splice's
    // name: one cell toggle rewrote every byte of the part, including elements the
    // user never went near (`cr hh bd` came back as `cr _ hh cr bd _`).
    //
    // Nothing about the refusal required that. A part stretched onto the shared grid
    // by `factor` can be re-read at any DIVISOR of it, and the shared grid itself
    // (`g === 1`) holds every atom by construction — so a width that describes the
    // hit always exists. Re-reading there costs one thing: each element now spans
    // `growth` columns instead of one, which is exactly what `reemitRegion`'s `div`
    // already spells as a group. The element under the hit subdivides — `[cr cr] hh
    // bd` — and its neighbours are copied through verbatim like any other splice.
    //
    // THE ELEMENT COUNT IS UNCHANGED, and that is what makes this local rather than a
    // finer rebuild. We are not widening the part; we are spelling ONE of its elements
    // at a finer subdivision. Measured over the corpus: every part-void was this
    // branch, the tiling check below fired zero times, and the usable width was always
    // the shared grid.
    // ⚠ ADMITTING THE HIT'S POSITION IS NOT THE SAME AS SPELLING ITS LENGTH (#1151).
    //
    // This used to take the FIRST — coarsest — divisor `partColumns` accepted and
    // commit to it. But `partColumns` only answers "does every atom fall on this
    // grid"; it says nothing about the DURATIONS, which it divides by the same
    // factor. So a part read at width `g` gives a note covering one shared column a
    // length of `1/g`, and every writer below refuses a fraction of a column as
    // unspellable. Measured over the corpus, that one fractional length was the cause
    // of EVERY remaining part-void: 34 asks across 4 units, at both view scales,
    // all reaching `sustainTokens`' fractional refusal with `p.factor / growth === 3`.
    // None of them was the "no notation at this width" or "sustain in unowned bytes"
    // the residual was assumed to be.
    //
    // So the widths are kept as a LIST, coarsest first, and tried in turn — a finer
    // read makes the same length integral. The coarse read is NOT one of that list
    // when it succeeds: at the part's own width nothing is read differently than
    // before, so a refusal there is the refusal the writer has always given and it
    // must propagate rather than retry (P4c, argued at the decline below).
    const widths: { cols: GridCells; growth: number }[] = []
    const own = partColumns(lanes, steps, p.factor)
    if (own !== null) widths.push({ cols: own, growth: 1 })
    else
      for (let g = p.factor - 1; g >= 1; g--) {
        if (p.factor % g !== 0) continue
        const finer = partColumns(lanes, steps, g)
        if (finer !== null) widths.push({ cols: finer, growth: p.factor / g })
      }
    // The regions index the grid they were parsed from. If they no longer describe
    // it even at the finest usable width, ITS regions are void, and ONLY its own: the
    // parts beside it were not touched and keep what the user wrote. Strudel
    // normalizes every `,`-part to its own weight, so re-emitting one of them at the
    // shared resolution leaves the others sounding exactly as written.
    const last = p.regions[p.regions.length - 1]
    // A lone element owning the whole line has nothing to stay aligned WITH, so
    // a re-emit can spread across the line as plain steps instead of holding
    // its one step's worth of brackets: rewriting `hh*8` reads `hh ~ hh …`, not
    // `[hh ~ hh …]`. Identical to Strudel either way — a bracket around the
    // whole cycle IS the cycle — so this is only about not handing back noise.
    const sole = src.parts.length === 1 && src.prefix === '' && p.regions.length === 1
    // EMITTED INTO A LOCAL, so a refusal can be answered rather than propagated.
    // Reading the part finer opens spellings the coarse read never attempted, and some
    // of them fail. Those must not refuse the whole write, because at the coarse width
    // this part already had a working answer — the rebuild. Building the body aside and
    // committing it only on success is what lets the caller below choose between them.
    const spliceRegions = (
      cols: GridCells,
      growth: number,
    ): { body: string; reemitted: number } | 'decline' => {
      /** a region's span, in the column space this part is being read at */
      const at = (n: number): number => n * growth
      let body = ''
      let reemitted = 0
      for (let ri = 0; ri < p.regions.length; ri++) {
        const r = p.regions[ri]
        const now = cols.slice(at(r.from), at(r.to))
        // untouched → the span's own bytes, verbatim; touched → re-emit, keeping
        // whatever padding the span carried around it
        //
        // ⚠ COMPARED AT THE WIDTH THE PART IS BEING READ AT. `content` was captured in
        // the part's own column space; where `growth > 1` we read `growth` times finer,
        // so the STORED side is stretched to match rather than the live slice squashed —
        // squashing would have to decide what an atom sitting between the coarse columns
        // means, and the answer is "it changed", which is the very fact being tested.
        // Stretching cannot lose one: the columns opened between are empty in the
        // stretched copy, so a hit landing in one compares UNEQUAL, which is exactly how
        // the element under the user's finger is identified.
        if (sameCells(now, growth === 1 ? r.content : stretchCells(r.content, growth))) {
          body += r.raw
          continue
        }
        reemitted++
        const div = sole ? 1 : p.div * growth
        // #1010 P4e — MAPPED. This is the widest of the five decision points and it
        // carries every population at once (the map is the block above `spliceGrid`).
        // Asks REACHING here, 2026-08-17: 782 placements = case 1 · 134 resizes =
        // case 3 · 480 deletes = NONE OF THE THREE → #1295. Reaching is not
        // answering: a re-emit here can still return null and hand the part to the
        // rebuild below.
        const re =
          (respell && growth === 1 ? respellBar(now, r, div, respell) : null) ??
          reemitRegion(now, div, model.viewScale !== undefined)
        if (re !== null) {
          body += r.leading + re + r.trailing
          continue
        }
        // ABSORB THE RESTS A HELD NOTE REACHES INTO (#1146). A note longer than its own
        // element needs its `_` written into the NEXT element's bytes, and regions are
        // emitted independently — so the flat `bd ~ sd ~` refused a lengthening that the
        // grouped `[bd ~ sd ~]` accepted, for no reason a user could see. That gap was most
        // of #1053's ceiling: only 46 of 732 flat corpus units offered a length handle.
        //
        // The fix is to widen who owns the bytes, not to abandon them. This call takes over
        // the following regions the note actually reaches into and re-emits that whole span
        // as one, so the `_` lands in bytes this call owns. Everything past the note's reach
        // is still copied verbatim, which is what keeps `[f3 ab3 g3] [eb3 g3 c3] …` from
        // collapsing into one flat row the way a part-rebuild does.
        //
        // ⚠ FALLBACK ONLY, and the ordering is load-bearing exactly as it is for
        // `stackedRegion` above: this runs where `reemitRegion` already returned null, i.e.
        // where the write DECLINED. So no output that exists today can change shape — the
        // golden round-trips keep passing because this path is unreachable for anything they
        // cover, and the only documents it can affect are ones that previously refused.
        //
        // ⚠ ABSORBS ONLY UNCHANGED REGIONS, and only as far as the note reaches. Those are
        // regions the loop above would have copied verbatim, so the bytes at risk are ones
        // that say "nothing starts here" and will still say it — plus the sustain. A region
        // the user edited is never swallowed by its neighbour's re-emit.
        const reach = noteReach(cols, at(r.from), at(r.to))
        let end = ri
        while (end + 1 < p.regions.length && at(p.regions[end].to) < reach) {
          const nxt = p.regions[end + 1]
          const nxtNow = cols.slice(at(nxt.from), at(nxt.to))
          // WHAT MAY BE SWALLOWED: bytes that are about to be rewritten anyway (the region
          // CHANGED, so it has a re-emit of its own coming), or bytes that say nothing
          // happens here (no onset in the span) and will still say it, plus the sustain.
          //
          // What may NOT: an UNCHANGED region carrying notes. Merging that one would
          // re-spell notation the user wrote and did not touch — `hh*2` coming back as
          // `hh hh` — which is precisely the collateral a splice exists to avoid.
          //
          // ⚠ DEFENCE IN DEPTH, AND SAID SO RATHER THAN OVERCLAIMED. Removing this term
          // alone changes no output on any fixture I could construct: where a sustain
          // actually reaches into a region, that region has to change anyway, and where it
          // does not, the `reach` bound above has already stopped the walk. `sustainTokens`
          // then refuses whatever slips past both. So the arm in `cellResize.test.ts` pins
          // the direction that IS reachable — an over-strict version, refusing a region the
          // caller had already changed, which measurably breaks a correct write — and this
          // half stands unarmed on purpose. It guards the one shape neither bound covers:
          // the TAIL of a partially-reached region, whose bytes are otherwise re-spelled
          // for no reason.
          const wasNxt = growth === 1 ? nxt.content : stretchCells(nxt.content, growth)
          if (sameCells(nxtNow, wasNxt) && nxtNow.some((col) => col.length > 0)) break
          end++
        }
        if (end === ri || at(p.regions[end].to) < reach) return 'decline'
        const last = p.regions[end]
        // #1010 P4e — MAPPED, and this is the one site that maps to a SINGLE case.
        // All 64 asks reaching here (2026-08-17) were resizes: case 3, `@n` duration,
        // which has no location for surgery to anchor at. That is what the absorb
        // exists for — a note outlasting its own element needs its `_` written into
        // the NEXT element's bytes, which is a length with no span rather than a
        // note with one. ⚠ Reached only where the call above already declined, so
        // those 64 asks are counted at BOTH sites in the map's per-site figures.
        const merged = reemitRegion(cols.slice(at(r.from), at(last.to)), div, model.viewScale !== undefined)
        if (merged === null) return 'decline'
        reemitted += end - ri
        body += r.leading + merged + last.trailing
        ri = end
      }
      return { body, reemitted }
    }
    let spliced: { body: string; reemitted: number } | null = null
    for (const w of widths) {
      // the regions must still tile the part at THIS width; where they do not, the
      // width cannot describe what the user wrote and the next one is tried
      if (last === undefined || last.to * w.growth !== w.cols.length) continue
      const attempt = spliceRegions(w.cols, w.growth)
      if (attempt !== 'decline') {
        spliced = attempt
        break
      }
      // WHERE THE FINER READ IS WHAT FAILED, THE COARSE ANSWER IS STILL THERE (#1137).
      //
      // ⚠ ONLY WHERE `growth > 1`, and that bound is the whole safety argument. At
      // `growth === 1` nothing about this part was read differently than before, so a
      // refusal here is the SAME refusal the writer has always given and it must
      // propagate: P4c's rule is that a decline must never fall through to a rebuild,
      // because the rebuild is exactly the re-derivation that drops the length the
      // refusal exists to protect.
      //
      // Where `growth > 1` the situation is inverted: this part had NO splice before
      // this change — it was voided and rebuilt unconditionally. So the rebuild is not
      // a downgrade from a working write, it is precisely the behaviour that shipped,
      // and reaching it costs nothing that was not already being paid. The finer read
      // is an attempt to do better, and one that fails should hand back what it found
      // rather than refuse a placement the user could make yesterday.
      if (w.growth === 1) return 'decline'
      // A PART HOLDING ONE REGION HAS NO NEIGHBOUR TO PROTECT, so reading it finer
      // buys nothing (#1151). Locality is a promise about the bytes AROUND the edit;
      // where the part IS one element, the whole-part rebuild already rewrites exactly
      // the element the user touched and nothing else. Measured: for `c2, eb3 g3 [bb3
      // c4]` and its two siblings the finer splice emits the same columns as the
      // rebuild, differing only by the `[…]` it wraps them in — so retrying would add
      // brackets and no locality. Stop here and take the rebuild, which is already the
      // local answer. `sole` above is the same observation for a part that is the
      // whole line; this is its `,`-stack form.
      if (p.regions.length < 2) break
    }
    if (spliced === null) {
      // A PART WRITTEN OVER SEVERAL BARS REBUILDS BAR BY BAR (#1849). Its `<`/`>` sit in
      // `before`/`after`, and inside them every element is one bar — so the rebuild is
      // one `[…]` group per bar. A flat column list there would play one column a bar.
      const partBars = p.bars ?? 1
      if (partBars > 1) {
        const per = steps / partBars
        const groups: string[] = []
        for (let b = 0; b < partBars; b++) {
          const bar = gridColumns(
            lanes.map((l) => ({ ...l, cells: l.cells.slice(b * per, (b + 1) * per) })),
            per,
          )
          if (bar === null) return 'decline'
          groups.push(`[${bar.join(' ')}]`)
        }
        return { body: groups.join(' '), reemitted: 0, rebuilt: p.regions.length }
      }
      const rebuilt = gridColumns(lanes, steps)
      if (rebuilt === null) return 'decline'
      return { body: rebuilt.join(' '), reemitted: 0, rebuilt: p.regions.length }
    }
    return { body: spliced.body, reemitted: spliced.reemitted, rebuilt: null }
  }

  let out = src.prefix
  const stackBars = model.bars ?? 1
  for (const p of src.parts) {
    const lanes = model.lanes.filter((l) => (l.part ?? 0) === p.part)
    // A PART OF A STACK THAT PLAYS FOR SEVERAL BARS IS WRITTEN BAR BY BAR (#1849): an
    // edit in bar b changes bar b only, even where the part is written once and repeats.
    const one =
      p.bars !== undefined && stackBars > 1
        ? spliceBars(p, lanes, model.steps, stackBars, splicePart)
        : splicePart(p, lanes, model.steps)
    if (one === 'decline') return 'decline'
    regionsReemitted += one.reemitted
    if (one.rebuilt !== null) rebuiltParts.push(one.rebuilt)
    out += 'text' in one ? one.text : p.before + one.body + p.after
  }
  const regions = src.parts.reduce((n, p) => n + p.regions.length, 0)
  return { out: out + src.suffix, regions, regionsReemitted, rebuiltParts }
}

/* ── leaf surgery (#986) ───────────────────────────────────────── */

/**
 * Replace bytes at leaf spans, and copy everything else.
 *
 * The whole write-back, and deliberately the whole of it: descending order so an
 * earlier splice can't shift a later offset, no knowledge of the grammar it is
 * editing. Every structural byte in the output was already in `src` — this
 * function cannot emit a bracket, an operator or a separator that the user did
 * not write, which is what makes leaf-anchored write-back an adapter rather than
 * a mini-notation printer. Shared with the roll in P1b.
 */
/**
 * Do these anchors still describe THIS model? — the one guard both leaf writers
 * share (#990, [[P329]]).
 *
 * Anchors are provenance read against one particular layout. A restructure
 * (`resizeGrid`/`resizeRoll`) re-lays the model and carries them through, so they
 * survive describing a layout that no longer exists: widening leaves every note's
 * start and length intact and would write the ORIGINAL source back, silently
 * discarding the resize; narrowing drops the notes outside the new width, which a
 * writer that diffs anchors against current notes reads as DELETIONS and splices
 * `~` over — data loss from a gesture that edited nothing.
 *
 * The check therefore belongs at the WIDTH, the thing a restructure changes, and
 * in ONE place: it was found on the roll (#989) while the grid happened to be
 * covered by a `cols.length` comparison that was this same invariant under
 * another name. Two writers enforcing one rule independently is how the next
 * surface ships without it. Each source passes ITS OWN width — the grid's is its
 * column array, the roll's is the `steps` it recorded — and the rule lives here.
 */
function anchorsDescribe(model: { steps: number }, anchoredWidth: number | undefined): boolean {
  return anchoredWidth === model.steps
}

/**
 * …and are these anchors even FOR this model? — the second half of the same guard, and
 * the one that cannot be got from the spans themselves (#1235, [[PV319]]).
 *
 * `anchorsDescribe` compares two quantities computed by different code from different
 * premises wherever the spans are OVERLAID: the leaf path anchors per ATOM, the element
 * path counts EXPANDED columns. Equality between two such numbers is evidence of nothing,
 * and coincidence is reachable by an ordinary gesture — halving `c3@2 e3@2` moves the
 * element model's four columns onto the overlay's two, the width check passes against
 * spans describing a different layout, and the write puts the pre-halved bytes back so
 * the user's ÷2 silently does nothing.
 *
 * The width recorded at ATTACH time is not derived from the spans at all, so comparing it
 * says "this is the model those spans were read from" — the property actually wanted.
 * Both checks stay: this one bounds WHICH MODEL an overlay may answer for, `anchorsDescribe`
 * bounds whether that model still has the layout the spans index, and neither implies the
 * other.
 *
 * Measured before it was built: unreachable on the overlay as it ships (0 of 52 grid and
 * 0 of 43 roll restructures), 13 grid and 2 roll under #1233's core attachment. So this
 * costs nothing today and is here because #1235 exists to gate that change.
 *
 * ⚠ RE-MEASURED WHEN #1233 WAS ACTUALLY BUILT, ON THE BUILT THING, and the 13 + 2 holds:
 * dropping the re-stamp in `lazyGridLeaf`/`lazyRollLeaf` swallows exactly 13 grid and 2
 * roll restructures, and re-stamping makes it 0 and 0. One unit test sees it — the
 * restructure arm in `leafLengthRefusal.test.ts` — and nothing else in either package does.
 *
 * ⚠⚠ A CHEAPER READING SAID 2 + 2 AND THE INSTRUMENT WAS AT FAULT, which is the part worth
 * carrying. Before the attachment existed it could only be SIMULATED, by spreading spans
 * fetched from the derived projection onto a core model — and those spans carry the derived
 * path's own `attachedSteps`, which usually disagrees with the model they are pasted onto.
 * The simulated overlay was therefore refused for a reason the real change never has, and
 * the cost came out five times too low. A simulation that does not reproduce the field the
 * guard reads is not measuring the guard.
 */
const anchorsAreFor = (model: { steps: number }, ls: { attachedSteps: number }): boolean =>
  ls.attachedSteps === model.steps

export function serializeByLeaf(
  src: string,
  edits: Array<{ span: LeafSpan; text: string }>,
): string {
  let out = src
  for (const e of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    out = out.slice(0, e.span.start) + e.text + out.slice(e.span.end)
  }
  return out
}

/**
 * Write a leaf-anchored grid back by editing each changed note's own bytes.
 *
 * Every column is compared with the atoms it was read with: an atom the user
 * cleared becomes `~` at its own span (silence is a leaf VALUE — `~` and `-`
 * both reduce to `silence` in `mini.mjs` — not a structural rule we invented), a
 * single-atom column whose sound was swapped becomes the new token, and an
 * untouched atom asserts its own token so a leaf shared by several columns can be
 * checked for agreement.
 *
 * WHICH AXES IT READS, and what it does about the others (#1235). The model carries a
 * cell's SOUND and its LENGTH. Only the sound has bytes of its own — the length is
 * spelled by what surrounds the token (`_`, `@n`, a bracket group), which is notation
 * this writer must never author. So it can write one axis and not the other, and the
 * axis it cannot write it must still be able to NOTICE: a comparison that reads only
 * tokens finds no difference on a resize, writes the source bytes back, and reports
 * them as a successful write. That is worse than throwing, because every gate
 * downstream reads the output and the output is the user's own valid document.
 *
 * Anything the model grows that the anchors do not carry has to be added here at the
 * same time, or it becomes the next silent-success path.
 *
 * Returns null — the document is left alone — for the four edits that have no
 * span to write through, three of which are the one bijection stated over again:
 *  - a hit added where no leaf exists (or a second sound stacked onto a column):
 *    writing it would mean AUTHORING notation, which is the line between adapter
 *    and printer;
 *  - two columns sharing one leaf (`bd*4`) that disagree about the result: one
 *    token cannot be two things, and letting the last writer win would silently
 *    rewrite cells the user did not touch;
 *  - anchors that no longer describe the grid, which is what a restructure
 *    (resize/quantize) leaves behind;
 *  - a note whose LENGTH moved, per the paragraph above.
 *
 * HOW BIG THE SHARED-LEAF REFUSAL IS — measured, because a refusal without a number
 * reads as an edge case and this one is half the surface (#1160). Over all 1527 corpus
 * minis, clearing every sounding cell of every leaf grid one at a time: 275 of 557
 * deletes across 82 units are refused — 49.4%. The roll's half is 288 of 577 (49.9%),
 * two rates derived independently, which is the evidence that this belongs to the leaf
 * projection rather than to either surface. `delete-admissibility.test.ts` pins both.
 *
 * On this surface the predicate is EXACT: a delete is refused iff the cleared cell's
 * own leaf backs more than one column. Not "its column" — a column holds every lane's
 * atom, and a leaf shared with a lane the user did not touch decides nothing.
 *
 * ⚠ AND THE SHARING IS USUALLY NOT SPELT ON THE TOKEN, which is why `bd*4` above is a
 * misleading example to reason from. Reading the operator adjacent to each anchor's
 * span: only 77 of 377 shared-leaf instances (20%) carry the multiplier on the token
 * (`*n`/`!n`/`@n`); the other 300 are multiplied by something ENCLOSING the token — a
 * group, an alternation, a `slow`. `bd*4` itself is 36 of 377, under a tenth. So the
 * recurring proposal to split the shared token instead of refusing would buy back at
 * most a fifth of these asks, and only by re-spelling notation the user wrote; the
 * other four fifths would mean re-authoring a construct the token merely sits inside.
 * The refusal is the cheaper honesty. See #1160 for the full measurement.
 */
function spliceByLeaf(model: StepGridModel, ls: LeafSource | undefined): string | null {
  if (!ls || !anchorsAreFor(model, ls) || !anchorsDescribe(model, ls.cols.length)) return null
  const now = columnAtoms(model.lanes, model.steps)
  // THE LENGTH AXIS, WHICH THIS WRITER READS ONLY IN ORDER TO DECLINE (#1235).
  //
  // Every note still drawn must sound for a length some anchor in its column already
  // played. A note the user LENGTHENED or SHORTENED has none, so this refuses and the
  // caller falls back — which for an overlaid model is the element writer answering, and
  // for a model the leaf projection OWNS is the document left alone. Both are honest;
  // the alternative is not, because with no length in the token comparison a resize
  // reads as no change at all and the source bytes go back out as a write.
  //
  // Matched as a MULTISET rather than "some anchor here has this length", so resizing a
  // note to a SIBLING's length is caught too — otherwise it slips through as a silent
  // no-op instead of a refusal. This is `spliceRollByLeaf`'s check, which is why the
  // roll never had this defect; the grid was the surface out of step.
  //
  // ⚠ SCOPED TO COLUMNS THAT HOLD AN ANCHOR, and that residue is real rather than
  // overlooked: a note ARRIVING on an indexed rest (#1154) has no anchor to be measured
  // against, because a rest sounds nothing and nothing indexed its length. The branch
  // below writes those by replacing the rest's own bytes, and the length it comes back
  // at is the rest's, not the one the panel asked for. Placement writes immediately and
  // the model is re-read from the document, so the next gesture on that note DOES meet
  // an anchor; a place-and-resize inside one model update would not, and no gesture in
  // the panel produces one.
  // ⚠ COMPARED THROUGH `cellLengthKey`, NOT AS RAW NUMBERS, and that is not tidiness.
  // One musical length reaches the two sides down different paths: `clampLane` re-clamps
  // the whole lane on every edit and turns `1.0000000000000018` into exactly `1`, so a
  // DELETE that touched no length at all reads as a resize and the write is refused. It
  // cost one corpus unit before the rounding went in. `gridCellKey` has quantised this
  // way since P4b for the same reason and this shares its quantiser rather than a second
  // one that agrees today.
  //
  // ⚠ LENGTHS ONLY, deliberately: a rename must pass here so the swap branch below can
  // answer it, so the sounds are compared there and not in this loop. That leaves one
  // theoretical hole — two notes in a column resized so the MULTISET is unchanged — which
  // is not a gesture the panel can produce (each drag resizes one cell and writes) and
  // which `spliceRollByLeaf` has had since #989 for the same reason. Named, not built for.
  for (let c = 0; c < model.steps; c++) {
    const avail = ls.cols[c].map((a) => cellLengthKey(a.duration))
    if (avail.length === 0) continue
    for (const n of now[c]) {
      const i = avail.indexOf(cellLengthKey(n.duration))
      if (i < 0) return null
      avail.splice(i, 1)
    }
  }
  const want = new Map<string, { span: LeafSpan; text: string }>()
  for (let c = 0; c < model.steps; c++) {
    const anchors = ls.cols[c]
    const before = anchors.map((a) => a.atom)
    const after = [...new Set(now[c].map((n) => n.token))]
    const gone = before.filter((a) => !after.includes(a))
    const added = after.filter((a) => !before.includes(a))
    // The one add that IS a byte replacement: a lone atom swapped for another in
    // a lone-atom column. Anything else added has no leaf of its own.
    const swap = added.length === 1 && anchors.length === 1 && after.length === 1 && gone.length === 1
    if (added.length > 0 && !swap) {
      // A REST'S BYTES SWAPPED FOR A NOTE (#1154).
      //
      // What motivated it: a delete writes `~` over the note's own bytes, and putting
      // the note back was then refused for want of a span, because a rest sounds
      // nothing and the anchors are built from ENGINE ONSETS. Measured over the
      // corpus, NOT ONE leaf ask round-tripped (0 of 402) — the user could not undo
      // their own delete anywhere on this path. Rests are now indexed beside the
      // anchors, so the byte replacement exists after all.
      //
      // ⚠ IT IS NOT SCOPED TO THE REST WE JUST WROTE, AND IT CANNOT BE. That was the
      // argument this branch was first written under — "those bytes are ours, so
      // restoring them authors nothing" — and it is unimplementable rather than
      // wrong: the model is re-read from the document after every write, so nothing
      // marks a `~` as one this writer produced, and `isOurs(rest)` has no data to
      // read. Allowing the undo therefore allows placing on ANY indexed rest, and
      // does: 248 of 3,584 empty cells across 17 of 82 leaf units, on pristine
      // documents nobody deleted from.
      //
      // That is defensible on its own terms rather than by inheritance. Swapping a
      // rest's bytes for a note is the most basic grid edit there is, every other
      // write path already does it, and the structure the user wrote is untouched:
      // one token becomes another in a slot that already existed. What is still
      // refused is AUTHORING a slot — every structural byte is copied, never
      // generated.
      //
      // Still the narrowest form of the swap: the column must hold NO sounding leaf
      // (so nothing is displaced), exactly one sound must be arriving (never a
      // chord), and a rest span must have been indexed for that column. Adding a
      // second sound beside an existing one is authoring a chord and still refuses.
      const rest = ls.rests?.[c]
      if (rest && anchors.length === 0 && added.length === 1 && after.length === 1) {
        const key = `${rest.start}:${rest.end}`
        const prev = want.get(key)
        if (prev && prev.text !== added[0]) return null
        want.set(key, { span: rest, text: added[0] })
        continue
      }
      return null
    }
    for (const a of anchors) {
      const text = swap ? added[0] : gone.includes(a.atom) ? '~' : a.atom
      const key = `${a.span.start}:${a.span.end}`
      const prev = want.get(key)
      if (prev && prev.text !== text) return null
      want.set(key, { span: a.span, text })
    }
  }
  const edits = [...want.values()].filter(
    (e) => ls.src.slice(e.span.start, e.span.end) !== e.text,
  )
  return serializeByLeaf(ls.src, edits)
}

/**
 * Write a leaf-anchored ROLL back by editing each changed note's own pitch bytes —
 * the roll's half of `spliceByLeaf`, sharing its serializer and its bijection.
 *
 * Notes are compared at the column they START on, the roll's positional key (the
 * grid compares at the column a cell sits in). A note the user dropped becomes `~`
 * at its own span, a lone note whose pitch was dragged becomes the new token, and an
 * untouched note asserts ITS OWN SOURCE BYTES — which does two jobs: a leaf shared by
 * several notes (one token sounding in every bar) can be checked for agreement, and
 * the model's case fold never rides back out into the document, so `C3` stays `C3`
 * rather than coming back lowercased for the crime of being looked at.
 *
 * Returns null — the document is left alone — for every edit with no span to write
 * through, each of them the one bijection restated:
 *  - a note MOVED or RESIZED: a note's `@n` hold is not in its hap's locations at
 *    all (only the pitch is), so no span exists to splice a duration or a position
 *    through. Writing one would mean authoring `@n` syntax, which is the line
 *    between adapter and printer;
 *  - a note ADDED where no leaf exists (including a chord member renamed — with two
 *    members the new pitch has no unambiguous leaf to claim);
 *  - two notes sharing one leaf that disagree about the result, where letting the
 *    last writer win would silently rewrite a note the user never touched.
 *
 * THE SHARED-LEAF REFUSAL HERE IS THE SAME SIZE AS THE GRID'S, and that is the finding
 * rather than a coincidence: 288 of 577 cell deletes across 54 leaf rolls are refused
 * (49.9%) against the grid's 275 of 557 (49.4%), measured independently over the same
 * corpus. Two surfaces with different edit vocabularies refusing at the same rate is
 * what says the property belongs to the leaf projection itself. #1160 was filed with
 * this half unmeasured, so the population is 563 asks and not the 275 it records.
 *
 * ⚠ THOSE ROLL FIGURES MOVED WHEN THE ASK WAS CORRECTED, NOT WHEN THE WRITER WAS (#1168).
 * They were 276 of 591 (46.7%), posed by dropping one NOTE at a time — which `PianoRollGrid`
 * never does. It deletes by CELL, taking every note at a (pitch, start), and the two differ
 * on exactly the unisons. Posed as a click, 14 note-asks become 12 cell-asks and 12 of them
 * refuse, so the rate rose to within half a point of the grid's. The agreement this
 * paragraph rests on got STRONGER by asking the question the user can actually pose.
 * Pinned in `delete-admissibility.test.ts`; see `spliceByLeaf` for why splitting the
 * shared token is not the answer (only a fifth of the sharing is spelt on the token).
 *
 * ⚠ ONE RESIDUE, TRACKED AS #1164. Unlike the grid, sharing here is necessary but not
 * sufficient: 24 deletes on a shared leaf are ACCEPTED. All 24 are unisons — two
 * `,`-stacked parts at the same pitch and column — where `after` is built as a SET, so
 * dropping one leaves the pitch present, nothing enters `gone`, every anchor asserts
 * its own bytes and the document returns byte-unchanged while reporting success. The
 * set is right for telling chord members apart and cannot represent two of one pitch.
 */
function spliceRollByLeaf(model: PianoRollModel, ls: RollLeafSource | undefined): string | null {
  if (!ls || !anchorsAreFor(model, ls) || !anchorsDescribe(model, ls.steps)) return null
  // group the anchors by the column they start on — a chord contributes several here,
  // each with its own disjoint leaf
  const byStart = new Map<number, RollLeafAnchor[]>()
  for (const a of ls.anchors) {
    const here = byStart.get(a.start)
    if (here) here.push(a)
    else byStart.set(a.start, [a])
  }
  // Every note still on the roll must sit where a leaf already put one, at a length
  // that leaf already played. A note that MOVED lands on a column no anchor holds; a
  // note that was RESIZED leaves the durations at its column no longer a sub-multiset
  // of the ones the anchors played. Matched as a multiset rather than "some anchor
  // here has this length", so resizing a note to a SIBLING's length is caught too —
  // otherwise it would slip through as a silent no-op instead of an honest refusal.
  for (const [start, anchors] of byStart) {
    const avail = anchors.map((a) => a.duration)
    for (const n of model.notes) {
      if (n.start !== start) continue
      const i = avail.indexOf(n.duration)
      if (i < 0) return null
      avail.splice(i, 1)
    }
  }
  for (const n of model.notes) if (!byStart.has(n.start)) return null
  const want = new Map<string, { span: LeafSpan; text: string }>()
  for (const [start, anchors] of byStart) {
    const before = anchors.map((a) => a.pitch)
    const after = [...new Set(model.notes.filter((n) => n.start === start).map((n) => n.pitch))]
    const gone = before.filter((p) => !after.includes(p))
    const added = after.filter((p) => !before.includes(p))
    // the one add that IS a byte replacement: a lone note swapped for another at a
    // start that held exactly one
    const swap =
      added.length === 1 && anchors.length === 1 && after.length === 1 && gone.length === 1
    if (added.length > 0 && !swap) return null
    for (const a of anchors) {
      const text = swap
        ? added[0]
        : gone.includes(a.pitch)
          ? '~'
          : ls.src.slice(a.span.start, a.span.end)
      const key = `${a.span.start}:${a.span.end}`
      const prev = want.get(key)
      if (prev && prev.text !== text) return null
      want.set(key, { span: a.span, text })
    }
  }
  const edits = [...want.values()].filter(
    (e) => ls.src.slice(e.span.start, e.span.end) !== e.text,
  )
  return serializeByLeaf(ls.src, edits)
}

/* ── span surgery for `<...>`-as-element (#920) ────────────────── */

/**
 * Write back a `bd <sd hh>` pattern by editing the user's own bytes. Each
 * single-cycle element whose per-bar content is unchanged is copied through
 * verbatim; an edited one re-emits as `<b0 b1 …>` when its bars now differ,
 * plain when they agree — so editing a static cell in one bar PROMOTES it to an
 * alternation, and editing an alternation slot rewrites only that slot.
 *
 * Never rebuilds: an alt model that reached the whole-cycle `gridBars` path
 * would come back as `<[bd sd] [bd hh]>`, destroying the notation the user wrote.
 *
 * Null when a length in an edited element has no spelling — same refusal as the
 * other two writers, and here it is the only answer available, since this path
 * has no rebuild to fall to by construction.
 */
function spliceAltGrid(model: StepGridModel): string | null {
  const a = model.altSource
  if (!a) return '' // unreachable: caller gates on altSource
  const cols = columnAtoms(model.lanes, model.steps)
  let out = ''
  for (const r of a.regions) {
    const now: GridCells[] = []
    for (let b = 0; b < a.bars; b++) {
      now.push(
        cols
          .slice(r.from + b * a.perBar, r.to + b * a.perBar)
          .map((c) => [...new Map(c.map((n) => [gridCellKey(n), n])).values()]),
      )
    }
    if (now.every((bar, b) => sameCells(bar, r.perBar[b]))) {
      out += r.raw
      continue
    }
    // #1010 P4e — MAPPED. The grid's alternation half of `spliceRegions`' re-emit,
    // same three populations (map: the block above `spliceGrid`).
    // Asks reaching here, 2026-08-17: 112 placements = case 1 · 22 resizes = case 3 ·
    // 96 deletes = NONE OF THE THREE → #1295. ⚠ This path has no rebuild to fall to,
    // so a re-emit that declines here refuses the write outright.
    const re = reemitAltRegion(now, a.div, model.viewScale !== undefined)
    if (re === null) return null
    out += r.leading + re + r.trailing
  }
  return out
}

/** re-emit an edited alt element: `<b0 b1 …>` when its bars differ, plain when equal */
function reemitAltRegion(perBar: GridCells[], div: number, refined = false): string | null {
  // #1010 P4e — INTERNAL, decides nothing: reached only from the alt site above, and
  // inherits its mapping. (Map: the block above `spliceGrid`.)
  const barTokens = perBar.map((bar) => reemitRegion(bar, div, refined))
  if (barTokens.some((t) => t === null)) return null
  return barTokens.every((t) => t === barTokens[0]) ? barTokens[0]! : `<${barTokens.join(' ')}>`
}

/** a stack with a part written over fewer bars than it plays, or as `<…>` bars (#1849) */
const perBarStack = (model: StepGridModel): boolean =>
  (model.bars ?? 1) > 1 && !!model.source?.parts.some((p) => p.bars !== undefined)

type PartSplice = { body: string; reemitted: number; rebuilt: number | null }

/**
 * A `,`-part of a stack that plays for several bars, written BAR BY BAR (#1849).
 *
 * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8` plays for two bars and the snare is written
 * once, so Strudel plays it again in bar 2 (`stack` asks every part for the same cycle).
 * An edit in bar 2 changes bar 2 only — the way every row of a default Logic pattern runs
 * the whole length with every step its own — so the part stops being one written bar:
 * `<[~ sd ~ sd] [~ sd ~ ~]>`. The rule inside a part is the same one (`reemitAltRegion`):
 * `<…>` where the bars differ, plain where they agree.
 *
 * 1. `Q`, the shortest run the part's `L` bars repeat in, from what they HOLD (cells, not
 *    text — a bar edited back to what it was is the same bar however it would be spelled).
 *    `Q` divides `L`, so the stack's length never changes under the part.
 * 2. `Q` divides the written bars `P`: the written bars still hold every bar, so the part
 *    is spliced from its first `P` bars as one — byte for byte where nothing changed. A
 *    part written as `<A A>` stays as written unless it was edited.
 * 3. Otherwise each of the `Q` bars is spliced against the written bar it plays (`q mod P`)
 *    — untouched bars come back as their own bytes — and the part is written
 *    `<t0 … t(Q-1)>`, or as its one bar, unwrapped, when `Q` is 1.
 *
 * Declines rather than guesses where a bar has no bytes of its own to splice against (a
 * written element spanning a bar line, `x!3`).
 */
function spliceBars(
  p: SourcePart<GridCells>,
  lanes: StepLane[],
  steps: number,
  stackBars: number,
  splicePart: (p: SourcePart<GridCells>, lanes: StepLane[], steps: number) => PartSplice | 'decline',
): { text: string; reemitted: number; rebuilt: number | null } | 'decline' {
  const P = p.bars ?? 1
  const L = stackBars
  if (!Number.isInteger(L / P) || steps % L !== 0) return 'decline'
  const per = steps / L
  const window = (from: number, n: number): StepLane[] =>
    lanes.map((l) => ({ ...l, cells: l.cells.slice(from * per, (from + n) * per) }))
  const held = Array.from({ length: L }, (_, b) => columnAtoms(window(b, 1), per))
  const Q = repeatingRun(held, L)
  if (P % Q === 0) {
    const whole = splicePart(p, window(0, P), P * per)
    if (whole === 'decline') return 'decline'
    const unchanged = whole.reemitted === 0 && whole.rebuilt === null
    if (Q === P || unchanged) return { text: p.before + whole.body + p.after, ...whole }
  }
  // the part's own `<`/`>` (a part written over several bars carries them in
  // `before`/`after`) come off, and the `,` and padding stay where they are
  const before = P > 1 ? p.before.replace(/<\s*$/, '') : p.before
  const after = P > 1 ? p.after.replace(/^\s*>/, '') : p.after
  if (P > 1 && (before === p.before || after === p.after)) return 'decline'
  const last = p.regions[p.regions.length - 1]
  if (!last || last.to % P !== 0) return 'decline'
  const ownPer = last.to / P
  const texts: string[] = []
  let reemitted = 0
  let rebuilt: number | null = null
  for (let q = 0; q < Q; q++) {
    const w = q % P
    const regions = p.regions
      .filter((r) => r.from >= w * ownPer && r.to <= (w + 1) * ownPer)
      .map((r) => ({ ...r, from: r.from - w * ownPer, to: r.to - w * ownPer }))
    // the written bar must be its own run of regions, edge to edge
    if (regions.length === 0 || regions[0].from !== 0 || regions[regions.length - 1].to !== ownPer) return 'decline'
    if (regions.some((r, i) => i > 0 && r.from !== regions[i - 1].to)) return 'decline'
    const bar = splicePart({ ...p, regions, bars: undefined }, window(q, 1), per)
    if (bar === 'decline') return 'decline'
    reemitted += bar.reemitted
    if (bar.rebuilt !== null) rebuilt = (rebuilt ?? 0) + bar.rebuilt
    // A BAR EMPTIED BY AN EDIT IS ONE REST. Spliced, its elements each re-emit as `~`
    // and the bar comes back `[~ ~ ~ ~]` — four written steps that still draw their
    // step lines over nothing. A bar written empty by hand keeps its own bytes.
    const emptied = (bar.reemitted > 0 || bar.rebuilt !== null) && held[q].every((c) => c.length === 0)
    texts.push(emptied ? '~' : bar.body.trim())
  }
  const body = Q === 1 ? unbracketed(texts[0]) : `<${texts.map(asEntry).join(' ')}>`
  return { text: before + body + after, reemitted, rebuilt }
}

/** the shortest run, dividing `n`, that the bars' cells repeat in */
function repeatingRun(held: GridCells[], n: number): number {
  for (let q = 1; q < n; q++) {
    if (n % q === 0 && held.every((cells, b) => sameCells(cells, held[b % q]))) return q
  }
  return n
}

/** the top-level elements of a bar's text, or null when it is not a plain list of them */
function topLevel(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if ('[<{('.includes(ch)) depth++
    else if (']>})'.includes(ch)) depth--
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * A bar's text as one `<…>` entry: a lone element as written (`hh*8`), anything else in
 * `[…]`. A lone `bd@3` or `bd!2` is bracketed too — inside `<…>` those would claim
 * three bars, or two.
 */
function asEntry(text: string): string {
  const els = topLevel(text)
  return els.length === 1 && !/[@!]/.test(outsideBrackets(els[0])) ? text : `[${text}]`
}

/** a part collapsing back to one bar needs no `[…]` of its own: `[~ sd ~ sd]` → `~ sd ~ sd` */
function unbracketed(text: string): string {
  const els = topLevel(text)
  if (els.length !== 1 || !text.startsWith('[') || !text.endsWith(']')) return text
  return outsideBrackets(text) === '[]' ? text.slice(1, -1).trim() : text
}

/** the characters of `el` at bracket depth 0 (the brackets themselves kept) */
function outsideBrackets(el: string): string {
  let depth = 0
  let out = ''
  for (const ch of el) {
    if ('[<{('.includes(ch)) {
      if (depth === 0) out += ch
      depth++
    } else if (']>})'.includes(ch)) {
      depth--
      if (depth === 0) out += ch
    } else if (depth === 0) out += ch
  }
  return out
}

/**
 * A part's own columns, read back off the shared grid it was stretched onto.
 *
 * `bd sd, hh*4` shows two columns against four, so part 0 lives on every second
 * shared column. Returns null when the part can no longer be written at its own
 * width — a hit landing BETWEEN its columns means the user asked for a finer
 * rhythm than the part's notation can hold, and the caller falls back to
 * rebuilding the whole line (lossy, and the only honest answer here).
 */
function partColumns(lanes: StepLane[], steps: number, factor: number): GridCells | null {
  if (factor < 1 || steps % factor !== 0) return null
  const all = columnAtoms(lanes, steps)
  const cols: GridCells = []
  for (let c = 0; c < steps; c++) {
    // THE LENGTHS ARE IN THE UNITS BEING CHANGED. Taking every `factor`-th column
    // re-expresses this part on its OWN grid, and a cell's duration is counted in
    // SHARED columns — `sd` beside `bd bd` lasts two of them and one of its own. So
    // the duration divides by the same factor the index does. Scaling the index and
    // copying the payload is the same mistake the READER made at this boundary one
    // phase ago: a rescale is a change of units, and it applies to every field
    // expressed in those units, never to the index alone.
    if (c % factor === 0)
      cols.push(all[c].map((n) => ({ token: n.token, duration: n.duration / factor })))
    else if (all[c].length > 0) return null
  }
  return cols
}

/**
 * the notes STARTING in each column, with their lengths — lane order is
 * presentational, so these compare as sets (`gridCellKey`)
 */
function columnAtoms(lanes: StepLane[], steps: number): GridCells {
  const cols: GridCells = []
  for (let i = 0; i < steps; i++) {
    const here: GridCells[number] = []
    for (const l of lanes) {
      const cell = l.cells[i]
      if (isCellOn(cell)) here.push({ token: l.sound, duration: cell.duration })
    }
    cols.push(here)
  }
  return cols
}

/** just the sounds, for the write paths that address notes rather than spell them */
const soundsOf = (cols: GridCells): string[][] => cols.map((c) => c.map((n) => n.token))

/**
 * SOUNDS **AND LENGTHS** — `gridCellKey` is `token duration`, so a region whose only
 * change is how long one note sounds compares UNEQUAL and is re-emitted.
 *
 * ⚠ THIS COMMENT USED TO SAY THE OPPOSITE, and the gesture it was waiting for has now
 * arrived. It warned that a length-only difference would compare EQUAL, the region would
 * be copied back verbatim, and the edit would silently do nothing — "decide it there,
 * before the first 'my edit did nothing'". That state was never reachable while no
 * gesture changed a length on its own; #1053's length handle is exactly such a gesture,
 * and the decision turns out to have been made already, by whoever put `duration` into
 * `gridCellKey`. Measured rather than re-reasoned: 1016 of the corpus's 4729 grid notes
 * accept a length change through this path — a number only reachable if this comparison
 * sees the length.
 *
 * Rewritten in place rather than deleted, because "we already know this can't work" is
 * the first thing a reader remembers, and they should meet the reason it stopped applying
 * in the same place. What DOES still refuse a lengthening is `sustainTokens` below, on
 * its own stated grounds.
 */
const sameCell = (a: GridCells[number], b: GridCells[number]): boolean => {
  const keys = b.map(gridCellKey)
  return a.length === b.length && a.every((x) => keys.includes(gridCellKey(x)))
}

const sameCells = (a: GridCells, b: GridCells): boolean =>
  a.length === b.length && a.every((c, i) => sameCell(c, b[i]))

/**
 * The same cells, re-expressed `growth` columns finer (#1137).
 *
 * A region's `content` is captured in the part's own column space. When the part has
 * to be READ finer — a hit landed between its columns — the stored content and the
 * live slice are in different units, and "did the user change this?" cannot be asked
 * until they agree. This moves the stored side, which is the safe direction: every
 * atom keeps its column (`i` → `i * growth`) and the columns opened between them are
 * empty, so a hit that landed in one compares UNEQUAL and that element re-emits.
 *
 * ⚠ THE DURATION IS IN THE UNITS BEING CHANGED, the same trap `partColumns` documents
 * one level up. A length is counted in the columns of whatever grid it is read on, so
 * a rescale multiplies it by exactly the factor the index does. Scaling the index and
 * copying the payload would make every held note compare unequal and re-emit for no
 * reason the user could see.
 */
const stretchCells = (cells: GridCells, growth: number): GridCells =>
  cells.flatMap((c) => [
    c.map((n) => ({ token: n.token, duration: n.duration * growth })),
    ...Array.from({ length: growth - 1 }, (): GridCells[number] => []),
  ])

/**
 * The furthest column any note STARTING in `[from, to)` sounds through (#1146).
 *
 * This is what bounds region absorption: a note that overflows its own element needs
 * exactly the bytes up to here and not one more, so the re-emit swallows the smallest
 * span that can hold it. Everything past it is still copied through verbatim.
 *
 * Rounded because a length is spelled in whole columns or not at all — `sustainTokens`
 * declines a fractional one anyway, so asking for its ceiling would absorb bytes to
 * serve a write that is about to be refused.
 */
function noteReach(cols: GridCells, from: number, to: number): number {
  let reach = to
  for (let c = from; c < to; c++) {
    for (const n of cols[c]) reach = Math.max(reach, c + Math.round(n.duration))
  }
  return reach
}

/**
 * Re-emit one changed region as the SAME number of steps it owned, so its
 * neighbours keep their timing. Each step owns `div` columns: at `div === 1`
 * that is a bare token, and above it a `[…]` group — never `div` separate
 * top-level steps, which is exactly the flattening that pushed `hh*2`'s
 * neighbours out of position.
 */
/**
 * AN EDITED BAR OF A PER-BAR GRID, SPELLED AT ITS OWN COUNT (#1827).
 *
 * The shared grid is the least common multiple of the bars' counts, so without this a
 * hi-hat added to the 3-step bar of `<[bd sd hh] [bd sd hh oh]>` came back as
 * `[[bd,hh] _ _ _ sd _ _ _ hh _ _ _]` — twelve slots, the same haps, and a bar the user
 * would not recognise. When the region is exactly one bar and everything in it sits on
 * that bar's own columns, it is re-emitted at that count instead. Anything that does not
 * fit (a length off the bar's grid) returns null and the shared-grid spelling answers,
 * exactly as it did before, so this can only make a spelling shorter.
 */
function respellBar(
  cols: GridCells,
  r: { from: number; to: number },
  div: number,
  barSteps: readonly number[],
): string | null {
  const P = lcmOf(barSteps)
  if (r.to - r.from !== P || r.from % P !== 0 || div !== P) return null
  const own = barSteps[r.from / P]
  const k = P / own
  if (k <= 1) return null
  const packed: GridCells = []
  for (let i = 0; i < cols.length; i++) {
    if (i % k !== 0) {
      if (cols[i].length) return null
      continue
    }
    const col: GridCell[] = []
    for (const c of cols[i]) {
      const d = c.duration / k
      if (Math.abs(d - Math.round(d)) > 1e-9) return null
      col.push({ ...c, duration: Math.round(d) })
    }
    packed.push(col)
  }
  return reemitRegion(packed, own)
}

function reemitRegion(cols: GridCells, div: number, refined = false): string | null {
  const spelled = sustainTokens(cols, div)
  if (spelled === null) return refined ? stackedRegion(cols, div) : null
  const steps: string[] = []
  // #1010 P4e — INTERNAL, decides nothing: how one region's columns are grouped,
  // reached only from the two grid sites. (Map: the block above `spliceGrid`.)
  for (let i = 0; i < cols.length; i += div) steps.push(reemitStep(spelled.slice(i, i + div)))
  return steps.join(' ')
}

/**
 * THE FALLBACK WHEN A LENGTH WON'T FIT THE ONE-TOKEN-PER-COLUMN SHAPE (#1120).
 *
 * `sustainTokens` spells a length as `_` sustain in the step sequence, and above
 * `div === 1` that sequence is chopped into `[…]` groups — so a note reaching across
 * a group boundary needs a `_` in first position, which means nothing there. That is
 * precisely what REFINING produces: a finer view raises `div`, every source element
 * becomes a group, and every note longer than one column crosses a boundary. Held
 * notes were the one class that could not be looked at more closely.
 *
 * The way out is to stop asking one sequence to carry every lane. Written as a
 * `,`-stack — one flat part per sound, at COLUMN granularity — each part is its own
 * sequence with no internal group boundary, so a `_` always has something before it.
 * The stack is then weighted to the slot count the region owned, which is what keeps
 * its neighbours where they were:
 *
 *   region = 4 columns / 2 slots, bd held across all four, a hit at column 0
 *     one sequence   →  `[bd _] [_ _]`              ← `_` leads a group: no meaning
 *     stacked        →  `[bd _ _ _, zz ~ ~ ~]@2`    ← every part flat, group weighted
 *
 * ⚠ THE OBVIOUS SPELLING IS WRONG, and Strudel says so rather than our reading of it.
 * `[bd _, zz ~] _` looks like the same idea one level up, and it is not: a trailing
 * `_` elongates the whole GROUP, so the one-column `zz` comes back at 0.25 of a cycle
 * instead of 0.125. Every candidate here was checked against `queryArc` onsets before
 * a line of this was written.
 *
 * ⚠ FALLBACK ONLY, and that ordering is load-bearing. It runs where the flat sheet
 * already returned null, so no output that exists today can change shape — the golden
 * round-trips keep passing because this path is unreachable for anything they cover.
 * It also DECLINES rather than widening: two notes of the same sound overlapping, or
 * a length that is not a whole number of columns, have no spelling here either.
 *
 * ⚠ REFINED VIEWS ONLY, and that gate was added because the corpus caught its absence.
 * Some patterns already carry `div > 1` at their own resolution, so an ungated fallback
 * also fired there — and making the writer succeed makes the edit-safety probe pass,
 * which hands the pattern to the ELEMENT re-emitter instead of the leaf-anchored one.
 * Measured: leaf grids went 82 → 76 with no gate. That is a writer swap at the
 * document's own resolution, which #1120 never asked for and which the leaf path's
 * position as the LAST fallback exists to prevent — it copies every structural byte
 * rather than re-emitting. Scoped to `model.viewScale !== undefined`, the reach change
 * is confined to the refined views the issue is about.
 */
function stackedRegion(cols: GridCells, div: number): string | null {
  // a flat region has no group boundary to cross, so nothing here can help it
  if (div < 2) return null
  const slots = cols.length / div
  if (!Number.isInteger(slots) || slots < 1) return null

  // first-appearance order, matching the canonical form the rest of this file writes
  const sounds: string[] = []
  for (const col of cols) for (const n of col) if (!sounds.includes(n.token)) sounds.push(n.token)
  if (sounds.length === 0) return null

  const parts: string[] = []
  for (const sound of sounds) {
    const seq: string[] = new Array(cols.length).fill('~')
    const covered = new Array<boolean>(cols.length).fill(false)
    for (let c = 0; c < cols.length; c++) {
      for (const n of cols[c]) {
        if (n.token !== sound) continue
        const d = Math.round(n.duration)
        if (Math.abs(n.duration - d) > 1e-6 || d < 1) return null
        if (c + d > cols.length) return null // runs past the bytes this call owns
        if (seq[c] !== '~' || covered[c]) return null // this sound already sounds here
        seq[c] = sound
        for (let k = 1; k < d; k++) {
          if (seq[c + k] !== '~' || covered[c + k]) return null // same sound under the sustain
          covered[c + k] = true
        }
      }
    }
    for (let c = 0; c < cols.length; c++) if (covered[c]) seq[c] = '_'
    parts.push(seq.join(' '))
  }
  // a group already fills exactly one slot, so a weight is only written above one
  return `[${parts.join(', ')}]` + (slots > 1 ? `@${slots}` : '')
}

/**
 * One token per column, with a held note's covered columns spelled `_` — the
 * printer PRESERVING a length instead of re-deriving it (#1010 P4c).
 *
 * `_` is SUSTAIN, not silence: `bd _ sd` is bd sounding two thirds of the cycle,
 * and `bd _ _` is one note of weight 3 (`~` and `-` are the rests, the same branch
 * in `mini.mjs`). So a note covering N columns is its token followed by N-1 `_`,
 * which keeps the one-token-per-column shape every other writer here depends on —
 * unlike `@n`, which would change the element COUNT and shift its neighbours.
 *
 * DECLINES (null) rather than spelling a length wrongly. Four ways a length has no
 * spelling at this resolution, each a real shape in the corpus:
 *  - a length that is not a whole number of columns — a note shorter than a column
 *    cannot be a token at the grid's own resolution without subdividing, which
 *    would mean authoring notation the user never wrote;
 *  - a covered column that ANOTHER note starts in: `[_,b]` is a chord containing a
 *    token that means nothing there, not a sustain under a note;
 *  - a sustain running past the region: regions are emitted independently and an
 *    untouched one is copied VERBATIM, so the `_` would have to land in bytes this
 *    call does not own. ⚠ This one is no longer the end of the story — `spliceGrid`
 *    answers a null here by ABSORBING the rests the note reaches into and calling
 *    again over the wider span, so the bytes become ones the call does own (#1146).
 *    The refusal below is still correct and still load-bearing; it is now a request
 *    for more room rather than a verdict on the edit;
 *  - a `_` with nothing before it in its own sequence — the first column of a
 *    `[…]` step group, or of the region itself.
 *
 * Declining is not a shrug. A derived view that mis-writes is worse than one that
 * declines: the caller returns null, the binding layer leaves the document alone,
 * and the edit visibly does nothing instead of silently shortening a note.
 */
function sustainTokens(cols: GridCells, div: number): string[] | null {
  const out: string[] = new Array(cols.length).fill('')
  const covered = new Array<boolean>(cols.length).fill(false)

  for (let c = 0; c < cols.length; c++) {
    for (const n of cols[c]) {
      const d = Math.round(n.duration)
      if (Math.abs(n.duration - d) > 1e-6 || d < 1) return null
      if (c + d > cols.length) return null // runs past the bytes this region owns
      for (let k = 1; k < d; k++) {
        if (cols[c + k].length > 0) return null // another note starts under the sustain
        covered[c + k] = true
      }
    }
  }

  for (let c = 0; c < cols.length; c++) {
    if (cols[c].length > 0) {
      out[c] = cellToken(cols[c].map((n) => n.token))
      continue
    }
    if (!covered[c]) {
      out[c] = '~'
      continue
    }
    // nothing precedes a `_` at the start of its own sequence — the region's first
    // column, or the first column of the `[…]` group a step expands to
    if (c === 0 || (div > 1 && c % div === 0)) return null
    out[c] = '_'
  }
  return out
}

function reemitStep(tokens: string[]): string {
  if (tokens.length === 1) return tokens[0]
  // a step nobody plays is `~`, not `[~ ~]`
  if (tokens.every((t) => t === '~')) return '~'
  return `[${tokens.join(' ')}]`
}

const cellToken = (atoms: string[]): string =>
  atoms.length === 0 ? '~' : atoms.length === 1 ? atoms[0] : `[${atoms.join(',')}]`

/**
 * one token per column: `~`, a sound, `[a,b]` when several sound together, or `_`
 * where a held note covers the column
 *
 * Null when a length here has no spelling — the rebuild is the path that used to
 * DROP those lengths, so it needs the same refusal as the splice or the decline
 * above is only half a rule.
 */
function gridColumns(lanes: StepLane[], steps: number): string[] | null {
  return sustainTokens(columnAtoms(lanes, steps), 1)
}

/**
 * The `.gain("…")` mini for a step grid's per-column velocity, aligned 1:1 to
 * the columns `serializeStepGrid` emits. Returns a `GainWrite` so the binding
 * layer knows whether to upsert, remove, or leave the `.gain` alone:
 *   - `skip`  — multi-bar or `,`-stack (we don't align gain across those yet),
 *      or a `.gain` we couldn't parse onto the grid (`gainForeign`): hands off;
 *   - `clear` — every column neutral (gain 1): remove our `.gain`;
 *   - `write` — one token per column: a rest column → `~` (no gain event), else
 *      the column's gain.
 */
export function serializeStepGain(model: StepGridModel): GainWrite {
  if (model.gainForeign) return { kind: 'skip' }
  // look-only (#1975): nothing is written, the `.gain` included
  if (model.lookOnly) return { kind: 'skip' }
  // A leaf-anchored grid emits the user's own columns, not ours — there is no
  // serialized column sequence for a `.gain("…")` to run against. Hands off.
  if (model.leafSource) return { kind: 'skip' }
  const bars = model.bars ?? 1
  const parts = new Set(model.lanes.map((l) => l.part ?? 0))
  if (bars > 1 || parts.size > 1) return { kind: 'skip' }
  const gains = model.gains
  if (!gains || gains.length !== model.steps) return { kind: 'clear' }
  const cols = gridColumns(model.lanes, model.steps)
  if (cols === null) return { kind: 'skip' }
  // only the active (non-rest) columns carry an audible gain
  const active = gains.filter((_, i) => cols[i] !== '~')
  if (active.length === 0 || active.every((g) => g === 1)) return { kind: 'clear' }
  // uniform non-1 level → collapse to a scalar `.gain(v)` (the track-level form)
  if (active.every((g) => g === active[0])) {
    return { kind: 'write', value: fmtGain(active[0]), quoted: false }
  }
  // mixed → per-column string, rest columns as `~`
  const mini = cols.map((tok, i) => (tok === '~' ? '~' : fmtGain(gains[i]))).join(' ')
  return { kind: 'write', value: mini, quoted: true }
}

/** `<...>` with one slot per bar; an all-rest bar collapses to `~` */
function gridBars(model: StepGridModel, bounds: readonly number[]): string | null {
  const cols = gridColumns(model.lanes, model.steps)
  if (cols === null) return null
  const slots: string[] = []
  for (let b = 0; b + 1 < bounds.length; b++) {
    const bar = cols.slice(bounds[b], bounds[b + 1])
    if (bar.every((c) => c === '~')) slots.push('~')
    else if (bar.length === 1) slots.push(bar[0])
    else slots.push(`[${bar.join(' ')}]`)
  }
  return `<${slots.join(' ')}>`
}

/**
 * Where each bar starts, in the model's own columns, with the total as a final entry —
 * the one question every multi-bar rebuild asks (#1827). Uniform models answer
 * `b × steps / bars` exactly as the rebuilds always strode; a model drawn per bar answers
 * from its own counts, so a bar of 3 is rebuilt as 3 steps and a bar of 4 as 4.
 */
function barBounds(model: { steps: number; bars?: number; barSteps?: readonly number[] }): number[] {
  if (model.barSteps) return barStarts(model.barSteps)
  const bars = model.bars ?? 1
  const perBar = model.steps / bars
  return Array.from({ length: bars + 1 }, (_, b) => b * perBar)
}

/** the bar a hold starting at `bounds[b]` reaches the end of after exactly `duration`, as a count of bars */
function heldBars(bounds: readonly number[], b: number, duration: number): number {
  for (let k = 1; b + k < bounds.length; k++) {
    const span = bounds[b + k] - bounds[b]
    if (Math.abs(span - duration) < 1e-9) return k
    if (span > duration) break
  }
  return 0
}

/* ── piano roll ────────────────────────────────────────────────── */

interface Group {
  pitches: string[]
  duration: number
}

const groupBody = (g: Group): string =>
  g.pitches.length === 1 ? g.pitches[0] : `[${g.pitches.join(',')}]`

/**
 * Spell a weight for the document (#1092).
 *
 * A roll's durations come out of the reader as float divisions of the enclosing
 * sequence, so a note the user wrote `@1.2` arrives as `1.2000000000000002` and a
 * bare `@1` as `0.9999999999999998`. Emitting that verbatim writes arithmetic noise
 * into the user's source — text they did not type and would not type — even though
 * it re-parses and plays the same. Twelve significant digits is far past any weight a
 * person writes and far short of where the noise lives, so the rounding cannot reach
 * a value anyone authored.
 *
 * The rounding lives HERE, at the point of emission, and not on the model field the
 * reader fills: the panel positions notes from that field and needs it exact.
 */
const weightToken = (n: number): string => String(Number(n.toPrecision(12)))

const groupToken = (g: Group): string =>
  g.duration === 1 ? groupBody(g) : `${groupBody(g)}@${weightToken(g.duration)}`

/**
 * The tokens for a silence exactly `width` columns wide, or null if there is no
 * such silence to spell (#1092).
 *
 * A bare `~` is one column, so a run of them can only express a whole number of
 * them; the fraction that is left over needs a weight of its own. Whole columns
 * stay bare, so a pattern that never had a fractional gap serializes byte-for-byte
 * as it always did.
 *
 * A NEGATIVE width is not a gap — it means the thing being placed starts before the
 * one before it ended, which is an overlap the caller has to resolve rather than
 * spell. Returning null rather than clamping keeps that from being written as silence.
 */
function restTokens(width: number): string[] | null {
  const { whole, remainder } = columnSplit(width)
  if (whole < 0) return null
  const out = new Array<string>(whole).fill('~')
  if (remainder > 0) out.push(`~@${weightToken(remainder)}`)
  return out
}

/**
 * Bucket notes by start column. Chord notes sharing a start must share a
 * duration; anything out of range returns null (inexpressible in the subset).
 */
function buildGroups(model: PianoRollModel): Map<number, Group> | null {
  const groups = new Map<number, Group>()
  for (const note of [...model.notes].sort((a, b) => a.start - b.start)) {
    if (note.start < 0 || note.duration < 1 || note.start + note.duration > model.steps) {
      return null
    }
    const g = groups.get(note.start)
    if (!g) groups.set(note.start, { pitches: [note.pitch], duration: note.duration })
    else if (g.duration !== note.duration) return null
    else g.pitches.push(note.pitch)
  }
  return groups
}

/** `declined`: no writer was asked — a look-only model has no spelling (#1975) */
export type RollWriteExtent = { path: 'leaf' | 'alt' | 'splice' | 'rebuild' | 'declined' }

/**
 * `serializePianoRoll`, plus WHICH WRITER answered — the roll's half of
 * `serializeStepGridWithExtent` (#1231).
 *
 * WHY IT HAD TO EXIST BEFORE THE ROLL'S HALF OF #1010 COULD BE JUDGED. `writer-reach`
 * asks the ENGINE on both sides: expected is what the pattern plays minus the deleted
 * note, got is what the edited document plays. A roll document that comes back
 * hap-equivalent and notation-DESTROYED therefore scores exactly like one that comes
 * back untouched — `[f3 ab3 g3]` re-emitted as `[~ ~ ~ ~ ab3@4 g3@4]` is a clean
 * round-trip by that measure. So every gate the roll has was structurally blind to the
 * whole of what a write-path change buys, and a change nothing can score is a change
 * whose revert nothing can detect.
 *
 * ⚠ THE ALTERNATIVE IS A SECOND ORACLE, which is why this is a report and not a rule
 * written in a test. The dispatch order below is the only place that decides who
 * writes; a test that re-derived it would agree with the writer exactly until the day
 * one of them moved, and would then be wrong in the reassuring direction.
 *
 * ⚠ `path` says WHO DECIDED, never whether anything was written — the grid's caveat,
 * and it is load-bearing on the roll too because two of these paths are TERMINAL and
 * answer a refusal with `null` on their own path. Read `mini` for "did it write".
 *
 * SIMPLER THAN THE GRID'S UNION, and deliberately: only the grid's splice counts
 * regions it had to re-emit, because only the grid reports them. Giving the roll a
 * `regions: 0` would state a measurement nobody took.
 */
export function serializePianoRollWithExtent(drawn: PianoRollModel): {
  mini: string | null
  extent: RollWriteExtent
} {
  // look-only has no spelling — see `serializeStepGridWithExtent` (#1975)
  if (drawn.lookOnly) return { mini: null, extent: { path: 'declined' } }
  // A roll drawn per bar (#1827) holds DRAWN columns; the writers below get the shared
  // grid their regions were captured in.
  const model = toUniformRoll(drawn)
  const respell = drawn.barSteps
  // BYTE SURGERY FIRST, WHEREVER SPANS EXIST (#1010 P4e) — the roll's half of the
  // grid's overlay, and the same two fields reach it, differing in what a REFUSAL
  // means. That difference is the whole of the safety argument:
  //
  //   `leafSource`  — the leaf projection OWNS this view. TERMINAL: an edit it cannot
  //                   express is refused and the document is left alone, because the
  //                   rebuild is precisely what would respell the notation this view
  //                   was opened to preserve. Falling back here would hand the re-emit
  //                   the shared-leaf deletes #1160 declines — 288 of 577 on this
  //                   surface, half of it, not an edge case.
  //   `surgical`    — the ELEMENT writer owns this view and these spans are overlaid on
  //                   it. A refusal falls through to the element paths below, which is
  //                   exactly what this model did before P4e, so the fallback can only
  //                   restore today's behaviour and never introduce a write.
  //
  // ⚠ A STALE OVERLAY CANNOT MIS-WRITE. `anchorsDescribe` requires the anchored width
  // to still describe the model before either leaf writer may write, so an overlay that
  // no longer fits (a restructure moved the layout, or the element projection drew a
  // different column count) REFUSES and the element writer answers. The guard predates
  // this and is the one both leaf writers already called (#989, #990).
  //
  // ⚠⚠ THIS RUNG IS HOISTED, AND THAT FORFEITS THE LADDER'S FREE SAFETY PROOF. Every
  // other widening of these writers — `stackedRegion` (#1120), absorption (#1146) — was
  // safe by one structural argument: it runs only where the previous rung returned null,
  // so no document that produces output today can change shape, and the proof costs
  // nothing to check. This rung runs FIRST and can pre-empt alt / splice / rebuild, so
  // it inherits none of that. Its safety is bought by MEASUREMENT instead, and the
  // measurement is the price of the placement rather than a formality:
  //
  // ⚠ A DATED RECORD, NOT CURRENT READINGS — same terms as the grid writer's block above.
  // Measured when this rung landed (#1236, 2026-08-13); the claim is that nothing moved,
  // so these digits must not be refreshed against today's corpus. `writer-reach.test.ts`
  // holds the live floors.
  //
  //   corpus deletes switching to surgery   26  =  22 whose bytes change  +  4 identical
  //   writer-reach (engine oracle)          153 / 85, unchanged
  //   WRITER-CENSUS.json                    regenerates byte-identical — no verdict moves
  //   parity-corpus                         442 arms green, incl. placement, locality,
  //                                         round-trip and view-scale
  //
  // A note that MOVED or was RESIZED lands where no anchor holds and `spliceRollByLeaf`
  // returns null, so those gestures still fall through — that is what keeps the
  // pre-emption confined to edits surgery can express exactly.
  //
  // ⚠ SO: anyone adding a rung to this ladder must place it LAST to inherit the proof,
  // or re-run the corpus above. Do not read this rung's position as licence.
  // ⚠ `spans()` IS THE PROJECTION, PAID HERE AND NOT AT PARSE (#1233). It runs at most
  // once per model and only on a write, which is the whole point: a parse that never
  // writes never pays it. The source it hands back already carries the overlay's
  // attach-time width, so `anchorsAreFor` below stays the one place that rule is enforced.
  const spans = model.leafSource ?? model.surgical?.spans()
  if (spans) {
    const surgical = spliceRollByLeaf(model, spans)
    if (surgical !== null) return { mini: surgical, extent: { path: 'leaf' } }
    if (model.leafSource) return { mini: null, extent: { path: 'leaf' } }
  }

  // A `<...>`-as-element pattern (`0 <2 3> 5`, #920) uses its own span surgery and
  // NEVER the rebuilds below — a rebuild would reshape it into the whole-cycle
  // `<[0 2 5] [0 3 5]>`. It returns null (keep the document) for an edit it can't
  // express, never wrong bytes.
  if (altSourceFits(model.altSource, model.steps))
    return { mini: spliceAltRoll(model), extent: { path: 'alt' } }

  // Span surgery first — same rule as the grid: put back what the user wrote
  // wherever they didn't edit. It declines (null) whenever the regions no longer
  // describe the notes, and the rebuilds below take over, the way this always
  // worked.
  //
  // ⚠ AND THAT NULL IS NOT A REFUSAL, unlike the two paths above. It is a
  // fall-through, so it is reported as the path that ACTUALLY answered — the
  // rebuild — rather than as a splice that wrote nothing.
  const spliced = spliceRoll(model, respell)
  if (spliced !== null) return { mini: spliced, extent: { path: 'splice' } }

  const bars = model.bars ?? 1
  if (bars > 1) {
    // Multi-bar `<...>` takes the shared-duration chord path FIRST, so every document
    // that writes today keeps its exact bytes. Where that has no answer — overlap inside
    // a bar, or a chord whose members differ in length — the bar slots carry parallel
    // lanes instead (#1312). `rollBarLanes` declines the cross-bar case, which needs
    // lanes at the document level and is not attempted.
    // a roll drawn per bar is rebuilt from its DRAWN columns, where each bar is whole cells
    const src = respell ? drawn : model
    const bounds = barBounds(src)
    const groups = buildGroups(src)
    const flat = groups === null ? null : rollBars(groups, bounds)
    if (flat !== null) return { mini: flat, extent: { path: 'rebuild' } }
    return { mini: rollBarLanes(src, bounds), extent: { path: 'rebuild' } }
  }
  return { mini: serializeRollLanes(model), extent: { path: 'rebuild' } }
}

/**
 * The mini a roll model writes back, or null where it has no spelling.
 *
 * A projection of the function above, never a second implementation, so the bytes a
 * caller gets and the path the census reads can never describe different writes.
 */
export function serializePianoRoll(model: PianoRollModel): string | null {
  return serializePianoRollWithExtent(model).mini
}

/* ── span surgery, the roll (#916) ─────────────────────────────── */

const noteKey = (n: RollNote): string => `${n.pitch}:${n.start}:${n.duration}`

/**
 * Which `,`-part does each note belong to now?
 *
 * The roll's notes carry no part tag and a drag builds a FRESH note
 * (`[...baseNotes, { pitch, start, duration }]`), so a note cannot be followed
 * by identity through an edit — only matched by value. Notes that still match
 * one the part produced stay in it; a note that matches nothing is new or moved,
 * and the only part it can honestly be given to is the one that LOST a note.
 *
 * That is a rule about the common gesture, not about every gesture, so it is
 * held narrowly: if no part lost a note (a plain insert) or several did, there
 * is no non-arbitrary answer and we hand back null — the whole line rebuilds
 * from the model, which is what it did before this existed. Guessing here would
 * put the user's note in a voice they didn't touch.
 *
 * The single-part case has nothing to decide: every note is that part's.
 */
function assignNotes(
  model: PianoRollModel,
  src: NotationSource<RollNote[]>,
): Map<number, RollNote[]> | null {
  if (src.parts.length === 1) return new Map([[src.parts[0].part, model.notes]])

  const taken = new Set<RollNote>()
  const mine = new Map<number, RollNote[]>()
  const lost: number[] = []
  for (const p of src.parts) {
    const kept: RollNote[] = []
    let missing = false
    for (const was of p.regions.flatMap((r) => r.content)) {
      // by value, and each current note claimed once — two parts can hold the
      // same pitch at the same column (`0,0`), and both must stay theirs
      const hit = model.notes.find((n) => !taken.has(n) && noteKey(n) === noteKey(was))
      if (hit) {
        taken.add(hit)
        kept.push(hit)
      } else missing = true
    }
    if (missing) lost.push(p.part)
    mine.set(p.part, kept)
  }
  const strays = model.notes.filter((n) => !taken.has(n))
  if (strays.length === 0) return mine
  if (lost.length !== 1) return null
  mine.set(lost[0], [...(mine.get(lost[0]) ?? []), ...strays])
  return mine
}

/**
 * Write back by editing the user's own bytes — the roll's half of #913.
 *
 * A region owns columns `[from, to)` and the notes starting in it are its own.
 * Where those notes are what it produced, its bytes go back verbatim; only the
 * regions whose notes changed are re-emitted. So `C D` stays `C D` (the model
 * lowercases pitches for the row math, and that convention has no business
 * riding back out into the document), `c4*2 e4` keeps its `*2` when the drag
 * lands on the `e4`, and the unedited round-trip falls out rather than being a
 * case anyone maintains.
 *
 * Returns null when the regions no longer describe these notes — then the caller
 * rebuilds from the model, which is lossy and always was.
 */
function spliceRoll(
  model: PianoRollModel,
  /** the bars' own counts when the roll is drawn per bar (#1827) */
  respell?: readonly number[],
): string | null {
  const src = model.source
  if (!src || src.parts.length === 0) return null
  // ⚠ THE ROLL'S HALF OF THE SAME REFUTED GUARD (#1123), and it was NOT assumed to be
  // the grid's case — it was asked separately, because the roll's gain mini emits one
  // token per note GROUP with `@duration`, mirroring the sequence this writer emits,
  // which is a real coupling the grid's flat per-column run does not have.
  //
  // The engine answered the same way. Over the 156 corpus units where the two spellings
  // differ: 127 play identically, 29 differ, and in NONE of the 29 does a note receive a
  // different gain. Against the user's own document the splice matches all 156 and the
  // rebuild 127 — so on 29 roll units a velocity drag was silently changing what plays,
  // not merely how it was spelled.
  // The regions were built to tile a grid of some width. If the model's width
  // has moved since — a resolution ×2, a quantize to a new slot count — the
  // source is describing a layout that no longer exists, and splicing against it
  // would silently drop every note past the old end. Decline and let the model
  // rebuild, exactly as the grid's `last.to !== cols.length` check does. (The
  // restructuring ops could also drop `source`; this is the backstop that means
  // the writer's failure mode is a clean rebuild, never wrong bytes.)
  const covers = src.parts.every((p) => {
    const last = p.regions[p.regions.length - 1]
    return last !== undefined && last.to === model.steps
  })
  if (!covers) return null
  const assigned = assignNotes(model, src)
  if (assigned === null) return null

  // Fractional columns (from `@2.5` / `@3.5` weights, #628) don't sit on the
  // integer grid this writer re-emits onto — the column walk would step past a
  // note at 11.5 and drop it. An UNEDITED such pattern still round-trips (its
  // regions match and copy their own bytes below); an EDITED one must NOT be
  // spliced. Declining here returns null, and the caller keeps the document
  // untouched — the safe no-op #628 always had — instead of writing a rebuild
  // that silently loses the note.
  const integral = model.notes.every(
    (n) => Number.isInteger(n.start) && Number.isInteger(n.duration),
  )

  let out = src.prefix
  for (const p of src.parts) {
    const notes = assigned.get(p.part) ?? []
    if (notes.some((n) => n.start < 0 || n.duration < 1 || n.start + n.duration > model.steps)) {
      return null
    }
    out += p.before
    const last = p.regions[p.regions.length - 1]
    // The regions index the notes they were parsed from. A part whose notes no
    // longer fit its own columns can't be spliced — and that is not the other
    // parts' business, so only ITS regions go. Every roll part shares one column
    // space (see `SourcePart.factor`), so re-emitting one leaves the others
    // sounding exactly as written.
    let body: string | null = last === undefined ? null : ''
    for (const r of p.regions) {
      if (body === null) break
      const now = notes.filter((n) => n.start >= r.from && n.start < r.to)
      if (sameNotes(now, r.content)) {
        body += r.raw
        continue
      }
      // an edited region on a fractional grid can't be re-emitted safely — decline
      // the whole splice so the caller no-ops rather than dropping the note
      if (!integral) return null
      // #1010 P4e — MAPPED. The roll's counterpart to `spliceRegions`' re-emit, and
      // the one site where case 3 is a large share rather than a tail (map: the
      // block above `spliceGrid`). Asks
      // reaching here, 2026-08-17: 467 placements = case 1 · 287 resizes = case 3 ·
      // 206 deletes = NONE OF THE THREE → #1295. ⚠ The roll differs from the grid on
      // case 3: byte surgery answers 239 of 596 resizes here (the grid's own figure
      // is 0 of 156), because the roll's atom carries its `@n` in the bytes the
      // anchor covers. So case 3 is irreducible on this surface only where the
      // length cannot be said at the note's own span.
      const re =
        (respell ? respellRollBar(now, r, p.div, respell) : null) ??
        reemitRollRegion(now, r.from, r.to, p.div)
      body = re === null ? null : body + r.leading + re + r.trailing
    }
    if (body === null) {
      // A region couldn't be re-emitted in its own span (an edit made it
      // inexpressible). This part rebuilds from the model as one flat lane —
      // and if its notes now overlap, that isn't a lane, so we decline the whole
      // splice and the caller's `serializeRollLanes` lays it across comma-lanes.
      const placed = toPlaced(notes)
      const rebuilt = placed && laneString(placed, model.steps)
      if (!rebuilt) return null
      out += rebuilt + p.after
      continue
    }
    out += body + p.after
  }
  return out + src.suffix
}

/* ── span surgery for `<...>`-as-element, the roll (#920) ──────── */

/**
 * The roll's half of `spliceAltGrid`. Each single-cycle element whose per-bar
 * notes are unchanged is copied through verbatim; an edited one re-emits per bar
 * (weight-preserving, chords and `@n` intact, crossing notes group-wrapped — all
 * via `reemitRollRegion`) and combines the bars as `<b0 b1 …>`, or plain when they
 * agree. Declines (null → keep the document) on a fractional grid or a note that
 * can't be said in its span — never a whole-cycle rebuild.
 */
function spliceAltRoll(model: PianoRollModel): string | null {
  const a = model.altSource
  if (!a) return null
  // A per-note `.gain("…")` reaching an alternation is handed off rather than
  // spliced (#915 class). KEPT DELIBERATELY, and the reason is not the one this
  // comment used to give — measured 2026-08-01 (#1128):
  //
  // THIS LINE IS CURRENTLY UNREACHABLE FOR THE CASE IT NAMES. An `altSource`
  // exists only for an alternation used as an ELEMENT (`c3 <e3 g3>`), which
  // forces `perBar >= 2` and therefore `steps !== bars` — exactly the condition
  // `serializeRollGain` already skips on (#632: "subdivided bars need a nested
  // gain mini and stay deferred"). A whole-cycle `<…>` has no `altSource` at all
  // and takes the `bars` path, which is why a `<c3 e3 g3 c4>` velocity drag
  // writes `<1 0.5 1 1>` today. Over the corpus: 52 rolls with a fitting
  // `altSource`, 51 skipped ABOVE here, 1 arrives — and that one has `bars = 1`,
  // so it is not an alternation either. With this guard removed that unit
  // splices correctly: 0 re-spelled, 0 play-changed, asked of the engine.
  //
  // So it is kept as a BACKSTOP, not as a live refusal: if #632's nested gain
  // mini lands, `serializeRollGain` stops skipping, real alternations reach this
  // line, and the alignment concern becomes live again. Anyone landing #632 owes
  // this guard a re-measurement — and note it DECLINES (returns null, so the
  // panel leaves the document alone) rather than falling through to a rebuild.
  const gain = serializeRollGain(model)
  if (gain.kind === 'write' && gain.quoted) return null
  // fractional columns don't sit on the integer grid the re-emit walks — an
  // unedited pattern still round-trips (raw copy), an edited one declines.
  const integral = model.notes.every(
    (n) => Number.isInteger(n.start) && Number.isInteger(n.duration),
  )
  let out = ''
  for (const r of a.regions) {
    const perBarNow: RollNote[][] = []
    for (let b = 0; b < a.bars; b++) {
      const lo = r.from + b * a.perBar
      const hi = r.to + b * a.perBar
      perBarNow.push(
        model.notes
          .filter((n) => n.start >= lo && n.start < hi)
          .map((n) => ({ pitch: n.pitch, start: n.start - b * a.perBar, duration: n.duration })),
      )
    }
    if (perBarNow.every((bar, b) => sameNotes(bar, r.perBar[b]))) {
      out += r.raw
      continue
    }
    if (!integral) return null
    // #1010 P4e — MAPPED. The roll's alternation half (map: the block above
    // `spliceGrid`). Asks reaching here, 2026-08-17: 56
    // placements = case 1 · 14 resizes = case 3 · 81 deletes = NONE OF THE THREE →
    // #1295. ⚠ Deletes LEAD here where placements lead at its grid twin (112 place
    // against 96 delete) — the per-surface asymmetry #1010 warns to expect.
    const re = reemitAltRoll(perBarNow, r.from, r.to, a.div)
    if (re === null) return null
    out += r.leading + re + r.trailing
  }
  return out
}

/** re-emit an edited roll alt element per bar, then `<b0 b1 …>` (plain when equal) */
function reemitAltRoll(
  perBar: RollNote[][],
  from: number,
  to: number,
  div: number,
): string | null {
  const barTokens: string[] = []
  for (const notes of perBar) {
    // #1010 P4e — INTERNAL, decides nothing: reached only from the roll alt site
    // above, and inherits its mapping. (Map: the block above `spliceGrid`.)
    const re = reemitRollRegion(notes, from, to, div)
    if (re === null) return null
    barTokens.push(re)
  }
  return barTokens.every((t) => t === barTokens[0]) ? barTokens[0] : `<${barTokens.join(' ')}>`
}

/** same notes, in any order — a multiset compare on (pitch, start, duration) */
function sameNotes(a: RollNote[], b: RollNote[]): boolean {
  if (a.length !== b.length) return false
  const left = a.map(noteKey).sort()
  const right = b.map(noteKey).sort()
  return left.every((k, i) => k === right[i])
}

/** notes → chord groups keyed by start; same start with different lengths can't share a lane */
function toPlaced(notes: RollNote[]): PlacedGroup[] | null {
  const byStart = new Map<number, PlacedGroup>()
  for (const n of [...notes].sort((x, y) => x.start - y.start)) {
    const g = byStart.get(n.start)
    if (!g) byStart.set(n.start, { pitches: [n.pitch], start: n.start, duration: n.duration })
    else if (g.duration !== n.duration) return null
    else g.pitches.push(n.pitch)
  }
  return [...byStart.values()]
}

/**
 * Re-emit one changed region over its own columns — and, above all, at its own
 * WEIGHT.
 *
 * This is where the roll differs from the grid. The grid refuses elongation, so
 * every step is one `div`-wide column and re-emitting `n` columns as `n` steps
 * is automatically the same length. Here `c4@2` is ONE step spanning two
 * columns: emit it as two steps and the region's weight goes 1 → 2, Strudel
 * re-divides the cycle, and every neighbour the edit never touched changes
 * timing. So a region owning `w` columns must come back as exactly `w / div`
 * steps' worth of weight, or not at all.
 *
 * Returns null only when these notes truly can't be said in that space — notes that
 * overlap in time, or a width the step walk cannot tile.
 *
 * ⚠ A CHORD WHOSE MEMBERS HAVE DIFFERENT LENGTHS USED TO BE ON THAT LIST, described as
 * needing "parallel lanes, a restructure of the whole line". The first half was right and
 * the second half was too pessimistic: the lanes fit inside the region's OWN bracket, so
 * `laneWrapRegion` below answers it without touching a byte outside the region (#1310).
 */
/**
 * The region as ONE lane — the shape the user most likely wrote, and the rung that must
 * answer first so every document that writes today keeps its exact bytes.
 *
 * Every `null` here means "this region has two things sounding at once, or a width this
 * walk cannot tile". The caller turns that into a parallel-lane attempt (#1312).
 */
function reemitRollRegionFlat(
  notes: RollNote[],
  from: number,
  to: number,
  div: number,
): string | null {
  const groups = toPlaced(notes)
  // Same start, different lengths — one voice of a chord subdivided while its siblings
  // hold. Not sayable as a single lane (#1310).
  if (groups === null) return null
  // "or not at all", said of the region's own span (#1092). Everything below walks
  // `c` forward one whole step at a time, so a region that is not a whole number of
  // steps wide — `c4@1.5` next to `~@0.5` — cannot be tiled by it: the walk emits a
  // step too many and hands the region back heavier than it was, moving every note
  // after it. The caller's fallback rebuilds the part as one flat lane, which CAN
  // spell a fractional width, so declining here costs the edit nothing.
  if (columnSplit((to - from) / div).remainder > 0) return null
  const at = new Map(groups.map((g) => [g.start, g]))
  const starts = groups.map((g) => g.start).sort((a, b) => a - b)
  const tokens: string[] = []
  let c = from
  let crossed = false
  while (c < to) {
    const g = at.get(c)
    // a group filling whole steps from a step boundary is one `@k` token — the
    // shape the user most likely wrote, and the one that keeps the weight
    if (g && g.duration % div === 0) {
      const end = c + g.duration
      if (end > to) return null
      if (starts.some((s) => s > c && s < end)) return null // overlap
      tokens.push(groupToken({ pitches: g.pitches, duration: g.duration / div }))
      c = end
      continue
    }
    // otherwise this step has structure inside it: `div` columns' worth of slots
    // whose weights sum to `div`, i.e. one step
    const end = c + div
    const slots: string[] = []
    let k = c
    while (k < end) {
      const gg = at.get(k)
      if (!gg) {
        slots.push('~')
        k++
        continue
      }
      // a note sustaining PAST this step's boundary can't be a per-step token —
      // splitting it would make two onsets. The whole region re-emits as one
      // weighted group instead, which holds a crossing note faithfully.
      if (k + gg.duration > end) {
        crossed = true
        break
      }
      slots.push(groupToken({ pitches: gg.pitches, duration: gg.duration }))
      k += gg.duration
    }
    if (crossed) break
    // a step nobody plays is `~`, not `[~ ~]`
    tokens.push(
      slots.every((s) => s === '~') ? '~' : slots.length === 1 ? slots[0] : `[${slots.join(' ')}]`,
    )
    c = end
  }
  if (crossed) return groupWrapRegion(at, starts, from, to, div)
  return tokens.join(' ')
}

/**
 * Re-emit one changed region: the single-lane form if it can be said that way, parallel
 * lanes otherwise.
 *
 * ⚠ THE ORDER IS THE SAFETY ARGUMENT for the bytes. The flat walk runs first and is
 * untouched, so a region that writes today writes exactly what it wrote before; lanes are
 * an answer to regions that previously had none.
 *
 * ⚠ IT WAS NOT ENOUGH TO CATCH ONLY `toPlaced`'s null, which is what #1310 first did.
 * That covers one overlap shape — same start, different lengths — and misses the other:
 * notes at DIFFERENT starts whose spans cross, which sails past `toPlaced` and dies later
 * in the walk at `starts.some(s => s > c && s < end)`. Measured, the miss was 87% of the
 * remaining refusals: the `<...>`-as-element writer reaches this function for every bar
 * it re-emits, and a held note with another starting inside it is its commonest shape.
 * Routing EVERY null here, rather than one named one, is what makes the rung complete.
 */
/**
 * The roll's half of `respellBar` (#1827): an edited bar of a per-bar roll written at
 * its own count, so deleting e3 from `[c3 e3 g3]` gives `[c3 ~ g3]` rather than the
 * shared grid's `[c3@4 ~ ~ ~ ~ g3@4]` — which plays the same but reopens as a bar of
 * twelve, and so as a different layout. Null when the region is not exactly one bar or
 * a note leaves that bar's columns; the shared-grid spelling then answers as before.
 */
function respellRollBar(
  notes: RollNote[],
  r: { from: number; to: number },
  div: number,
  barSteps: readonly number[],
): string | null {
  const P = lcmOf(barSteps)
  if (r.to - r.from !== P || r.from % P !== 0 || div !== P) return null
  const own = barSteps[r.from / P]
  const k = P / own
  if (k <= 1) return null
  const whole = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-9
  const packed: RollNote[] = []
  for (const n of notes) {
    const start = (n.start - r.from) / k
    const duration = n.duration / k
    if (!whole(start) || !whole(duration)) return null
    packed.push({ ...n, start: Math.round(start), duration: Math.round(duration) })
  }
  return reemitRollRegion(packed, 0, own, own)
}

function reemitRollRegion(
  notes: RollNote[],
  from: number,
  to: number,
  div: number,
): string | null {
  const flat = reemitRollRegionFlat(notes, from, to, div)
  if (flat !== null) return flat
  return laneWrapRegion(notes, from, to, div)
}

/**
 * Re-emit a region as PARALLEL LANES inside its own bracket: `[c c ~ ~, [g,a,e4]@4]@2`.
 *
 * WHY THIS EXISTS (#1310). Place a note in a slot a refined view just opened, inside a
 * chord, and one member of that chord is subdivided while its siblings hold. That model
 * has two notes sharing a start with different lengths, which `toPlaced` cannot lane —
 * and until this rung, the whole splice declined and the document was rebuilt end to end.
 * The rebuild is what made the edit visible everywhere instead of where it happened.
 *
 * THE LANES FIT INSIDE THE REGION. Nothing outside `[from, to)` is consulted or emitted,
 * so a splice that reaches here still puts back every byte the user did not edit. This is
 * the same trio the whole-document writer uses — bucket by (start, duration), pack into
 * non-overlapping lanes, emit each lane full width — run in region-local coordinates.
 *
 * ⚠ THE REGION'S WEIGHT IS THE INVARIANT, exactly as for `groupWrapRegion`: a region
 * owning `w` columns comes back as `w / div` steps' worth or not at all, because a region
 * handed back heavier re-divides the cycle and retimes neighbours the edit never touched.
 * That is what the trailing `@steps` buys, and why a non-integer step count declines.
 *
 * ⚠ A SINGLE LANE IS NOT THIS FUNCTION'S BUSINESS. It declines below two lanes so the
 * per-step and group-wrap forms above keep every case they already answer.
 *
 * ⚠⚠ AND THAT IS NOT A SAFETY PROOF, THOUGH IT LOOKS EXACTLY LIKE ONE. "It runs only
 * where the previous rung returned null, so nothing that writes today can change shape"
 * is the ladder argument every other widening here relies on, and it is TRUE of the bytes
 * written FOR A GIVEN MODEL and FALSE of which models exist. The writer is also an
 * ADMISSIBILITY ORACLE: `parse.ts:3507` refuses a view outright when the writer cannot
 * reproduce the source, `parse.ts:3703` asks it per note, and `ifRollSpellable` gates
 * every op. So widening the writer widens which EDITS are offered and which PROJECTION a
 * document gets — reach, not spelling — and the ladder says nothing about that. It was
 * asserted here from the ladder and the corpus refuted it.
 *
 * ⚠ A DATED MEASUREMENT, NOT A LIVE READING — same terms as the other write-path blocks.
 * Taken when this landed (#1310, 2026-08-21), per-ask rather than as a tally, because a
 * count cannot tell an admitted ask from a no-longer-posed one:
 *
 *   roll DELETE asks, refused -> written        7      of 5405
 *   ...written -> refused                       0
 *   ...admitted on both, bytes changed          3
 *   units whose PROJECTION changed              2      leaf -> alt, leaf -> source
 *   units the parser newly opens at all         1      `[-7 2,<4 5 6>]*8`
 *   subdivide placements newly reached          3
 *
 * EVERY ONE OF THOSE WAS JUDGED, against the standard `delete-admissibility.test.ts`
 * sets — a delete may remove haps of the pitch deleted and nothing else, and may never
 * invent one: 7 of 7 new writes clean, 3 of 3 changed writes clean, and all 3 reprojected
 * units still round-trip byte-identically, so leaving the leaf projection costs them no
 * notation. The refusals that vanished were not needed: parallel lanes CAN say two things
 * at once, which is the one thing the shared-leaf refusal exists because the old writer
 * could not do.
 */
function laneWrapRegion(
  notes: RollNote[],
  from: number,
  to: number,
  div: number,
): string | null {
  const width = to - from
  const steps = width / div
  if (!Number.isInteger(steps) || steps < 1) return null
  const byKey = new Map<string, PlacedGroup>()
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const start = n.start - from
    if (start < 0 || n.duration < 1 || start + n.duration > width) return null
    const key = `${start}:${n.duration}`
    const g = byKey.get(key)
    if (g) g.pitches.push(n.pitch)
    else byKey.set(key, { pitches: [n.pitch], start, duration: n.duration })
  }
  const lanes = packLanes([...byKey.values()])
  if (lanes.length < 2) return null
  const strings: string[] = []
  for (const lane of lanes) {
    const s = laneString(lane, width)
    if (s === null) return null
    strings.push(s)
  }
  const body = `[${strings.join(', ')}]`
  return steps === 1 ? body : `${body}@${steps}`
}

/**
 * Re-emit a whole region as ONE weighted group: `[a@2 b@4]@2`. A bracket
 * normalizes its contents across its own slots, so a note sustaining across an
 * internal step boundary — which no per-step form can hold without splitting it
 * into two onsets — comes back faithfully. The column durations go straight in
 * (they sum to the region's width), and `@steps` gives the bracket the region's
 * weight so its neighbours keep their timing. Hap-equivalent to the per-step
 * form where both apply; used only where the per-step form can't.
 */
function groupWrapRegion(
  at: Map<number, PlacedGroup>,
  starts: number[],
  from: number,
  to: number,
  div: number,
): string | null {
  const inner: string[] = []
  let c = from
  while (c < to) {
    const g = at.get(c)
    if (!g) {
      inner.push('~')
      c++
      continue
    }
    if (c + g.duration > to) return null // sustains past the region itself
    if (starts.some((s) => s > c && s < c + g.duration)) return null // overlap
    inner.push(groupToken({ pitches: g.pitches, duration: g.duration }))
    c += g.duration
  }
  const steps = (to - from) / div
  const body = `[${inner.join(' ')}]`
  return steps === 1 ? body : `${body}@${steps}`
}

/** A chord group: notes sharing BOTH a start and a duration → one `[..]@d` token. */
interface PlacedGroup {
  pitches: string[]
  start: number
  duration: number
}

/**
 * Bucket notes into chord groups keyed by (start, duration). Unlike `buildGroups`,
 * same-start notes with DIFFERENT durations become SEPARATE groups (they'll land
 * in different parallel lanes), so independent note lengths are expressible (#628).
 * Returns null if any note is out of range (inexpressible).
 */
function placedGroups(model: PianoRollModel): PlacedGroup[] | null {
  const byKey = new Map<string, PlacedGroup>()
  for (const note of [...model.notes].sort((a, b) => a.start - b.start)) {
    if (note.start < 0 || note.duration < 1 || note.start + note.duration > model.steps) {
      return null
    }
    const key = `${note.start}:${note.duration}`
    const g = byKey.get(key)
    if (g) g.pitches.push(note.pitch)
    else byKey.set(key, { pitches: [note.pitch], start: note.start, duration: note.duration })
  }
  return [...byKey.values()]
}

/**
 * Greedy interval-partition the chord groups into the minimal set of lanes such
 * that no two groups in a lane overlap in time (#628). Groups are sorted by start
 * then duration; each joins the first lane whose last group ends at or before its
 * start, else a new lane. Deterministic → the round-trip is stable.
 */
function packLanes(groups: PlacedGroup[]): PlacedGroup[][] {
  const sorted = [...groups].sort((a, b) => a.start - b.start || a.duration - b.duration)
  const lanes: Array<{ end: number; groups: PlacedGroup[] }> = []
  for (const g of sorted) {
    const lane = lanes.find((l) => l.end <= g.start)
    if (lane) {
      lane.groups.push(g)
      lane.end = g.start + g.duration
    } else {
      lanes.push({ end: g.start + g.duration, groups: [g] })
    }
  }
  return lanes.map((l) => l.groups)
}

/**
 * Serialize one lane's (non-overlapping) groups as a FULL-WIDTH column sequence,
 * padding trailing rests to `steps`. Every lane spans all `steps` columns so the
 * parallel lanes share one step grid — Strudel normalizes each comma-part to its
 * own total weight, so unequal widths would misalign the grids (#628 grounding).
 *
 * THE PADDING IS WEIGHTED, because `steps` and the gaps inside it are not always
 * whole numbers (#1092). `@n` is a relative weight, so `note("c4@1.5 e4@1.2")` is
 * 2.7 columns long with a note starting at 1.5 — and a run of bare `~` can only
 * reach 1 or 2. Spelling a 1.5-column gap as two rests puts the note after it a
 * half-column late and gives the lane a different total from its neighbours, which
 * is a retime of music the gesture never touched. Every gap is measured from the
 * group's own `start` rather than accumulated, so the widths cannot drift.
 */
function laneString(groups: PlacedGroup[], steps: number): string | null {
  const cols: string[] = []
  let col = 0
  for (const g of [...groups].sort((a, b) => a.start - b.start)) {
    const gap = restTokens(g.start - col)
    if (gap === null) return null // overlap within a lane (shouldn't happen post-pack)
    cols.push(...gap, groupToken({ pitches: g.pitches, duration: g.duration }))
    col = g.start + g.duration
  }
  const tail = restTokens(steps - col)
  if (tail === null) return null // the lane's own notes reach past the pattern
  cols.push(...tail)
  return cols.join(' ')
}

/**
 * Single-bar piano roll → mini-notation, with parallel comma-lanes when notes
 * overlap in time (#628). A non-overlapping pattern packs into ONE lane and
 * serializes exactly as before (no churn); overlapping notes split across lanes
 * joined by `, ` (e.g. `c3@2 ~ ~, e3 ~ ~ ~`).
 */
function serializeRollLanes(model: PianoRollModel): string | null {
  const groups = placedGroups(model)
  if (groups === null) return null
  const lanes = packLanes(groups)
  // No notes (or all rests) → a single all-rest lane `~ ~ … ~`, never an empty
  // string (a deleted note must still serialize the grid).
  if (lanes.length === 0) return laneString([], model.steps)
  const strings: string[] = []
  for (const lane of lanes) {
    const s = laneString(lane, model.steps)
    if (s === null) return null
    strings.push(s)
  }
  return strings.join(', ')
}

/**
 * `<...>` one slot per bar: a group filling whole bars from a bar boundary is a
 * bare slot (`@k` holds k bars); a subdivided bar is a `[...]` group of in-bar
 * `@`-durations; an all-rest bar is `~`. A note crossing a bar line partway is
 * inexpressible → null.
 */
function rollBars(groups: Map<number, Group>, bounds: readonly number[]): string | null {
  if (!bounds.every((x) => Number.isInteger(x))) return null
  const bars = bounds.length - 1
  const starts = [...groups.keys()].sort((a, b) => a - b)
  const slots: string[] = []
  let b = 0
  while (b < bars) {
    const barStart = bounds[b]
    const barEnd = bounds[b + 1]
    const perBar = barEnd - barStart
    const atStart = groups.get(barStart)
    const k = atStart ? heldBars(bounds, b, atStart.duration) : 0
    if (atStart && k >= 1) {
      const heldEnd = barStart + atStart.duration
      if (starts.some((s) => s > barStart && s < heldEnd)) return null
      slots.push(k === 1 ? groupBody(atStart) : `${groupBody(atStart)}@${k}`)
      b += k
      continue
    }
    if (perBar === 1) {
      slots.push('~')
      b++
      continue
    }
    const tokens: string[] = []
    let c = barStart
    let consumed = 0
    while (c < barEnd) {
      const g = groups.get(c)
      if (!g) {
        tokens.push('~')
        c++
        continue
      }
      if (c + g.duration > barEnd) return null // crosses the bar line
      tokens.push(groupToken(g))
      c += g.duration
      consumed++
    }
    // a group skipped over (covered by another's span) is an overlap
    if (consumed !== starts.filter((s) => s >= barStart && s < barEnd).length) return null
    slots.push(tokens.every((t) => t === '~') ? '~' : `[${tokens.join(' ')}]`)
    b++
  }
  return `<${slots.join(' ')}>`
}

/**
 * Re-emit a MULTI-BAR roll with PARALLEL LANES INSIDE EACH BAR: `<[c3 ~, e3@2] d3>`.
 *
 * WHY THIS EXISTS (#1312). `rollBars` above walks each bar as ONE flat lane, so any two
 * notes sounding together inside a bar make it return null — and because the multi-bar
 * path buckets by START ALONE (`buildGroups`), a chord whose members differ in length
 * dies one step earlier still. Neither is a limit of the notation: `<[c3 ~, e3@2] d3>`
 * parses, opens on the roll, and round-trips byte-identically today. It is a limit of
 * this file, and it cost 4,464 placements once `placeNote` stopped trimming notes at
 * pitches the user never touched (#1310).
 *
 * ⚠ EVERY NOTE MUST FIT INSIDE ONE BAR. A note held across a bar line with another
 * starting inside it cannot be said this way — it needs lanes at the DOCUMENT level,
 * `<a b c>, <~ d ~>`, which is a different shape and is NOT attempted here. Measured on
 * the corpus, that residue is 340 asks against the 4,464 this answers. A note that
 * crosses a bar line PARTWAY has no spelling at all, and the corpus holds none.
 *
 * ⚠ THIS IS A RUNG, and the rung below it is the whole of `rollBars`. It is reached only
 * where the flat walk already returned null, so every multi-bar document that writes
 * today writes exactly the bytes it wrote before — the lanes are an answer to questions
 * that previously had none.
 *
 * ⚠⚠ AND THAT IS NOT A SAFETY PROOF ON ITS OWN, for the reason this file now records in
 * `laneWrapRegion`: the writer is also an ADMISSIBILITY ORACLE (`parse.ts:3507`, `:3703`,
 * `ifRollSpellable`), so spelling more means ADMITTING more — different documents open,
 * different projections, different edits offered. The ladder argument covers the bytes
 * for a given model and says nothing about which models exist. Reach has to be measured
 * per ask across both builds, and every newly admitted ask judged against the standard
 * the refusal itself states.
 */
function rollBarLanes(model: PianoRollModel, bounds: readonly number[]): string | null {
  if (!bounds.every((x) => Number.isInteger(x))) return null
  const bars = bounds.length - 1
  const E = 1e-9
  const notes = [...model.notes].sort((a, b) => a.start - b.start || a.duration - b.duration)
  for (const n of notes)
    if (n.start < 0 || n.duration < 1 || n.start + n.duration > model.steps + E) return null

  const slots: string[] = []
  let b = 0
  while (b < bars) {
    const barStart = bounds[b]
    const barEnd = bounds[b + 1]
    const perBar = barEnd - barStart
    const over = notes.filter((n) => n.start < barEnd - E && n.start + n.duration > barStart + E)
    if (over.length === 0) {
      slots.push('~')
      b++
      continue
    }

    // Everything here fits inside this bar → pack it into lanes. A bar holding one
    // voice packs to ONE lane and reads exactly like the flat form.
    if (over.every((n) => n.start > barStart - E && n.start + n.duration < barEnd + E)) {
      const byKey = new Map<string, PlacedGroup>()
      for (const n of over) {
        const key = `${n.start - barStart}:${n.duration}`
        const g = byKey.get(key)
        if (g) g.pitches.push(n.pitch)
        else byKey.set(key, { pitches: [n.pitch], start: n.start - barStart, duration: n.duration })
      }
      const strings: string[] = []
      for (const lane of packLanes([...byKey.values()])) {
        const str = laneString(lane, perBar)
        if (str === null) return null
        strings.push(str)
      }
      slots.push(`[${strings.join(', ')}]`)
      b++
      continue
    }

    // Otherwise the bar is covered by a group HELD across whole bars from this boundary.
    // That is `rollBars`'s bare `@k` slot and it survives here unchanged — but only when
    // the held voices are alone in their span. A note starting inside the hold needs
    // lanes at the DOCUMENT level (`<a b c>, <~ d ~>`), which this rung does not attempt.
    const held = over.filter((n) => Math.abs(n.start - barStart) < E)
    if (held.length === 0 || held.length !== over.length) return null
    const dur = held[0].duration
    if (held.some((n) => Math.abs(n.duration - dur) > E)) return null
    const k = heldBars(bounds, b, dur)
    if (k < 1) return null
    if (notes.some((n) => n.start > barStart + E && n.start < barStart + dur - E)) return null
    const body = groupBody({ pitches: held.map((n) => n.pitch), duration: dur })
    slots.push(k === 1 ? body : `${body}@${k}`)
    b += k
  }
  return `<${slots.join(' ')}>`
}

/**
 * The `.gain("…")` mini for a roll's per-note velocity, mirroring the structure
 * `serializePianoRoll` emits for a single-bar roll: one token per note GROUP at
 * its start column (with `@duration` when held), `~` at rest columns. Chord
 * members (shared start) must share a gain — like duration — else the gain is
 * inexpressible (`skip`). Returns:
 *   - `skip`  — multi-bar, a `.gain` we don't manage (`gainForeign`), an
 *      out-of-range / chord-gain-mismatch shape; leave any `.gain` untouched;
 *   - `clear` — every note neutral (gain 1): remove our `.gain`;
 *   - `write` — the column-aligned gain mini.
 */
export function serializeRollGain(model: PianoRollModel): GainWrite {
  if (model.gainForeign) return { kind: 'skip' }
  // look-only (#1975): nothing is written, the `.gain` included
  if (model.lookOnly) return { kind: 'skip' }
  // A leaf-anchored roll emits the user's own notation, not a note sequence of ours
  // — there is nothing for a per-note `.gain("…")` mini to run 1:1 against. Hands off
  // (the grid's `serializeStepGain` declines for the same reason).
  if (model.leafSource) return { kind: 'skip' }
  const bars = model.bars ?? 1
  // Multi-bar velocity is managed only when each bar is a single column
  // (`perBar === 1`, i.e. steps === bars) — one note/chord per bar (#632). There
  // bars ≡ columns, so the gain is the flat column sequence wrapped in `<...>`,
  // aligned bar-for-bar to the notes. Subdivided bars (perBar > 1) need a nested
  // gain mini and stay deferred → hand off.
  if (bars > 1 && model.steps !== bars) return { kind: 'skip' }
  // Overlapping notes serialize across parallel comma-lanes (#628); the gain mini
  // is a single column sequence and can't align per-lane, so hand off (v1).
  const placed = placedGroups(model)
  if (placed !== null && packLanes(placed).length > 1) return { kind: 'skip' }
  const groups = new Map<number, { duration: number; gain: number }>()
  for (const note of [...model.notes].sort((a, b) => a.start - b.start)) {
    if (note.start < 0 || note.duration < 1 || note.start + note.duration > model.steps) {
      return { kind: 'skip' } // inexpressible (serializePianoRoll returns null here too)
    }
    const gain = note.gain ?? 1
    const g = groups.get(note.start)
    if (!g) groups.set(note.start, { duration: note.duration, gain })
    else if (g.duration !== note.duration || g.gain !== gain) return { kind: 'skip' }
  }
  const vals = [...groups.values()].map((g) => g.gain)
  if (vals.length === 0 || vals.every((g) => g === 1)) return { kind: 'clear' }
  // uniform non-1 level → collapse to a scalar `.gain(v)`
  if (vals.every((g) => g === vals[0])) {
    return { kind: 'write', value: fmtGain(vals[0]), quoted: false }
  }

  // The gain mini has to land on the SAME grid as the note mini `serializeRollLanes`
  // writes, so it pads with the same weighted rests (#1092). Padding these two the
  // same way is not a nicety: whole-column rests here against weighted rests there
  // would put a note's volume on a different column from the note.
  const cols: string[] = []
  let col = 0
  for (const start of [...groups.keys()].sort((a, b) => a - b)) {
    const gap = restTokens(start - col)
    if (gap === null) return { kind: 'skip' } // overlap
    const g = groups.get(start)!
    cols.push(
      ...gap,
      g.duration === 1 ? fmtGain(g.gain) : `${fmtGain(g.gain)}@${weightToken(g.duration)}`,
    )
    col = start + g.duration
  }
  const tail = restTokens(model.steps - col)
  if (tail === null) return { kind: 'skip' }
  cols.push(...tail)
  // perBar === 1 multi-bar: one column per bar, so the flat sequence is wrapped
  // in `<...>` to align bar-for-bar with the note `<...>` (#632).
  const seq = cols.join(' ')
  return { kind: 'write', value: bars > 1 ? `<${seq}>` : seq, quoted: true }
}

export type { RollNote }
