/**
 * Notation models — the structured shapes the Sequencer and Piano Roll panels
 * own, parsed from and serialized back to mini-notation.
 *
 * These are deliberately a STRICT SUBSET of Strudel mini-notation: `*n` speed,
 * `!n` replicate, and euclid `(k,n[,rot])` EXPAND onto the grid, because a grid
 * of cells is what these panels can draw. Anything richer (`{}` polymeter, `/`
 * slow, `?` degrade, deep nesting) parses to `{ ok: false }` and the panel falls
 * back to code-only editing rather than guess and corrupt the source. This is
 * the conservatism the whole text-writeback substrate depends on (design doc
 * §4, §5.3).
 *
 * THE EXPANSION IS A FACT ABOUT THE VIEW, NOT ABOUT THE USER'S FILE. It used to
 * be both: `*n` was documented as sugar that "serializes back as the expanded
 * sequence", so opening `bd hh*2 sd cp` and nudging any cell rewrote the line as
 * `bd bd hh hh sd ~ cp ~`. That cost a third of everything the grid could open
 * (#913), and a third of what the roll could open for the same reason (#916).
 * Both models now carry the spans they were read from and both writers put
 * unedited ones back verbatim, so the subset bounds what a panel can SHOW and
 * edit — never what survives being looked at.
 */
import { pitchToMidi } from './pitch'

/**
 * One top-level element of the source, and the columns it produced.
 *
 * krill's element spans TILE the mini: concatenating them reconstructs the
 * input byte-for-byte, whitespace and all. Verified over the 1352 flat minis in
 * the real corpus (and all 380 the roll opens), and re-checked per parse — that
 * tiling is the whole basis for putting back exactly what we read.
 *
 * Where the whitespace LANDS inside a span is not something to have beliefs
 * about: `bd sd` spans as `"bd "` + `"sd"` (trailing) while `bd!3 sd` spans as
 * `"bd!3"` + `" sd"` (leading). So an untouched region is written back as its
 * whole `raw` span and no rule is needed; only a region we re-emit has to know
 * which side its padding sits on.
 *
 * `C` is what the element produced IN THE VIEW'S OWN TERMS — cells for the grid,
 * notes for the roll. The spans are the same fact about the source either way;
 * only the answer to "did the user change this?" is the view's.
 */
export interface SourceRegion<C> {
  /** the element's bytes exactly as written, whitespace included */
  raw: string
  /** `raw`'s padding, split out so a re-emit keeps the spacing around it */
  leading: string
  trailing: string
  /** `[from, to)` — the columns this element expanded to */
  from: number
  to: number
  /**
   * The element's weight as the parser read it (`ElementSpan.weight`: `bd` 1, `bd@3` 3,
   * `bd!3` 3, `[a b]` 1, `hh*8` 1) — the number that sized `[from, to)`. Strudel counts
   * the element as this many steps, so the Pattern tab's ruler does too (#1845). Absent
   * on a region built without one: it then counts as a single step.
   */
  weight?: number
  /**
   * What the VIEW showed for these columns at parse time — the basis for "did
   * the user change this region?". Deliberately the model's own view rather
   * than the raw atoms: `[sd,sd]` is one lane to a grid that has one lane per
   * distinct sound, so comparing against the raw pair would report a change
   * nobody made and rewrite the region for nothing.
   */
  content: C
}

/**
 * Source for a `<...>` alternation used as a sequence ELEMENT (`bd <sd hh>`),
 * not around the whole cycle (#920). The model bar-expands — one alternative per
 * bar, so `bd <sd hh>` is a 2-bar grid — but the SOURCE stays a single cycle:
 * the elements the user actually wrote (`bd`, `<sd hh>`). Each region owns a
 * within-bar column span and remembers what it showed IN EACH BAR, so the writer
 * copies an unchanged element's bytes through verbatim and re-emits only the one
 * edited — as `<...>` when its bars now differ, plain when they agree, promoting
 * a static cell to an alternation when an edit makes it vary.
 *
 * Distinct from `source`: there a region's `[from,to)` are the model's own
 * columns; here they are SINGLE-CYCLE columns, gathered strided across `bars`.
 * A model carries `altSource` XOR `source`, never both.
 */
export interface AltRegion<C> {
  raw: string
  leading: string
  trailing: string
  /** `[from, to)` columns WITHIN one bar (single-cycle space) */
  from: number
  to: number
  /** what the view showed for this element in each of `bars` cycles, at parse */
  perBar: C[]
}
export interface AltSource<C> {
  /** columns per bar (one cycle) */
  perBar: number
  bars: number
  /** finest subdivision, so a re-emitted region splits on whole columns */
  div: number
  /** the single-cycle top-level elements, tiling the source in order */
  regions: AltRegion<C>[]
}

/**
 * What a step grid shows for one column: each sound STARTING there, with how long
 * it sounds, in columns.
 *
 * Carried the length as of #1010 P4c (#1045). Sounds alone were enough while the
 * printer re-derived every length, because a length could not differ from what the
 * bytes already said. Once the printer PRESERVES lengths, "did the user change this
 * region?" has to include them, or the honouring is undetectable for exactly the
 * edits it exists for — a region whose only change is a length compares equal and is
 * copied back verbatim.
 */
export interface GridCell {
  token: string
  /** length in COLUMNS (see `StepNote.duration`) */
  duration: number
}

/** what a step grid shows for a span of columns: the sounds in each, with their lengths */
export type GridCells = GridCell[][]

/**
 * The identity of a shown note, for "did this region change?".
 *
 * Both axes, because both are the document's: a sound swapped and a length changed
 * are equally real edits. Deduped on this key rather than on the token, so `[sd,sd]`
 * still reads as one note (the reason `SourceRegion.content` is a view and not the
 * raw atoms) while the one corpus unit that plays two DIFFERENT lengths for one
 * sound at one column keeps both — those are genuinely two things.
 */
/**
 * ROUNDED, and that is not cosmetic. Lengths arrive from `whole.end - whole.begin`
 * scaled cycles->columns, so one musical length reaches this comparison as `2` down
 * one path and `2.000000000000001` down another. Comparing raw numbers makes a
 * region the user never touched read as CHANGED — and a changed region is
 * re-emitted, which rewrites notation nobody edited. Six decimals is far finer than
 * any length the grid can spell and far coarser than the error.
 */
export const gridCellKey = (c: GridCell): string => `${c.token} ${cellLengthKey(c.duration)}`

/**
 * One musical length, quantised so two paths that computed it differently agree.
 *
 * Split out of `gridCellKey` (#1235) rather than copied: `spliceByLeaf` compares a
 * model's cell lengths against its anchors' and needs exactly this rounding, for exactly
 * the reason above — `clampLane` turns `1.0000000000000018` into `1` on a delete that
 * changed no length at all, and a raw comparison reads that as a resize and refuses. Two
 * quantisers agreeing the day they are written is how they stop agreeing later.
 */
export const cellLengthKey = (duration: number): string => duration.toFixed(6)

/**
 * A leaf atom's OWN source span — `[start, end)` into the inner mini string.
 *
 * Read from a hap's `context.locations` (Strudel's `mini()` calls `.withLoc` per
 * atom), never computed here: a nested atom carries its own token span, not its
 * container's, so `s("a [b c]")` gives the `c` hap the span of `c` and never of
 * `[b c]` (#987).
 */
export interface LeafSpan {
  start: number
  end: number
}

/**
 * one atom sounding in a column, paired with the source leaf it was read from
 *
 * ⚠ `duration` IS HERE SO THE WRITER CAN REFUSE, NOT SO IT CAN WRITE (#1235). This
 * anchor's whole point is a byte replacement at `span`, and a note's LENGTH has no
 * bytes of its own to replace — it is spelled by what surrounds the token (`_`, `@n`,
 * a bracket group), which is notation this writer must never author. Carrying the
 * length anyway is what lets `spliceByLeaf` NOTICE that a length changed and decline,
 * instead of comparing tokens, finding no difference, and returning the source bytes
 * as a successful write. A writer's contract has to state what it can notice, not only
 * what it can spell.
 *
 * Read from the same expression that fills the lane cells (`projectStepGridByLeaf`),
 * never derived a second time: the comparison is only meaningful if both sides come
 * from one rule. `RollLeafAnchor` has carried its own for the same reason since #989,
 * which is why the roll never had this defect.
 */
export interface LeafAnchor {
  atom: string
  span: LeafSpan
  /** length in COLUMNS, the units of `StepNote.duration` */
  duration: number
}

/**
 * The source of a LEAF-ANCHORED projection (#986) — the third write-back shape,
 * and the only one that never re-emits notation.
 *
 * `source`/`altSource` pair the view with the source's TOP-LEVEL elements, so an
 * edited element is re-spelled from the cell model (`reemitRegion`). That re-emit
 * is a mini-notation printer of our own, and it can only spell flat or one-level
 * output — which is why anything with internal structure (`[a [b c]]`, `<a b>*4`)
 * round-trips wrong and is refused.
 *
 * A leaf anchor pairs the view with the ATOM instead: an edit replaces that one
 * note's bytes and every other byte — brackets, spaces, operators, unedited notes
 * — is copied verbatim. Nothing about the grammar is authored, so the writer
 * cannot invent syntax; what it cannot express (a note where no leaf exists) it
 * REFUSES. See `spliceByLeaf`.
 */
export interface LeafSource {
  /** the inner mini string the spans index into, byte-for-byte */
  src: string
  /**
   * Per model column, the atoms sounding there and each one's own leaf span.
   *
   * Its LENGTH is also the layout these anchors were read against — the width
   * `anchorsDescribe` (`serialize.ts`) requires the model to still have before
   * either leaf writer may write. See `RollLeafSource.steps` for why.
   */
  cols: LeafAnchor[][]
  /**
   * Per column, the span of the REST (`~` / `-`) occupying it, where there is one.
   *
   * Deliberately not an entry in `cols`: an anchor is an atom the grid SHOWS and the
   * lanes are built from that set, so a rest joining it would draw a `~` lane. This
   * is the same information for a different purpose — the one span a column can offer
   * when it has no sounding leaf.
   *
   * WHAT IT IS FOR (#1154). Deleting a note on a leaf grid writes `~` over that note's
   * own bytes, which is right. But a rest produces no hap, so nothing indexed it, and
   * putting the note back was refused for want of a span — the user could not undo
   * their own delete anywhere on this path (0 of 402 asks over the corpus).
   *
   * ⚠ IT DOES NOT — AND CANNOT — MARK WHICH RESTS ARE OURS. The model is re-read from
   * the document after every write, so a `~` this writer produced and one the user
   * typed are the same bytes with the same span and no way to tell them apart. So this
   * field enables the undo AND placement on any rest a leaf grid shows: 248 of 3,584
   * empty cells across 17 of 82 leaf units. What is still refused is a column that
   * holds no leaf at all, where a note would have to AUTHOR a slot.
   *
   * Absent, or null at a column, simply means the older refusal still stands there.
   */
  rests?: (LeafSpan | null)[]
  /**
   * The width of the model these spans were ATTACHED to — `RollLeafSource.attachedSteps`
   * is the same field on the roll, and both exist for one reason (#1235, [[PV319]]).
   *
   * ⚠ IT IS NOT `cols.length`, AND THAT DIFFERENCE IS THE WHOLE POINT. `anchorsDescribe`
   * compares `cols.length` against the model's `steps`, and where these spans are
   * OVERLAID (`StepGridModel.surgical`) those two numbers are computed by different code
   * from different premises: the leaf path anchors per ATOM, the element path counts
   * EXPANDED columns. So their equality is evidence of nothing, and coincidence is
   * reachable by an ordinary gesture — a `÷2` moves the element model's width onto the
   * overlay's, the guard passes against spans describing a different layout, surgery
   * writes the pre-halved bytes back, and the user's divide-by-two silently does nothing.
   * Measured before #1233: unreachable on the overlay as it ships (0 of 52 grid and 0 of 43
   * roll restructures), and 13 grid + 2 roll under its core attachment.
   *
   * ⚠ THAT 13 + 2 WAS CONFIRMED WHEN #1233 SHIPPED, BY BREAKING THE REAL THING — and the
   * confirmation is worth recording because a cheaper reading disagreed with it. Dropping
   * the re-stamp in `lazyGridLeaf`/`lazyRollLeaf` on the built change swallows exactly 13
   * grid and 2 roll restructures; re-stamping makes it 0 and 0.
   *
   * ⚠⚠ THE CHEAPER READING SAID 2 + 2, AND IT WAS THE INSTRUMENT THAT WAS WRONG. Before
   * the attachment existed, `_1235-width-coincidence.spec.ts` SIMULATED it by spreading
   * spans fetched from `projectStepGridDerived` — which carry the DERIVED path's own
   * `attachedSteps`. That stamp usually disagrees with the core model they were being
   * pasted onto, so the simulated overlay was refused for a reason the real change never
   * has, and the figure came out five times too low. A simulation that does not reproduce
   * the field the guard reads is not measuring the guard. Break the built thing.
   *
   * Recording the width at ATTACH time makes "valid" mean "this is the model those spans
   * were read from", which is the property actually needed. `anchorsDescribe` stays: it
   * is still NECESSARY, it was only never sufficient.
   */
  attachedSteps: number
}

/**
 * A leaf-span OVERLAY: the width the spans were attached to, plus the spans themselves
 * behind a thunk that projects them on first use (#1233).
 *
 * WHY THE SPANS ARE DEFERRED, and it is a cost fact rather than a style one. Building
 * them is a second full projection of the mini. They are read only when the writer
 * answers an EDIT — one write per many parses, and most parses never write at all — so
 * built eagerly the cost lands on every parse instead of on the writes that use it.
 * Measured on the path this field exists to reach: attaching eagerly where the syntactic
 * core answers takes a parse from 57.2us to 1459.8us, x25.5, on the parse that serves 791
 * of 958 corpus units and re-runs on every keystroke. Deferred, a parse pays one closure
 * and the projection is paid once by the write that needs it.
 *
 * ⚠ THE MEMO IS PART OF THE CONTRACT, NOT AN OPTIMISATION. A writer may ask more than
 * once, and a fresh projection per ask would put back the cost this shape exists to move.
 * A FAILED projection memoises too — `undefined` is an answer ("this mini has no leaf
 * spans"), not an absence — so the flag is separate from the value rather than a null
 * check, which would re-run the whole projection on every write to rediscover it.
 *
 * ⚠ AND IT IS GATED, by counting projections rather than by timing them (#1237). Losing
 * either the laziness or the memo changes no output, no count and no verdict — only
 * work — so no gate that reads models can see it, and a wall-clock assertion would be
 * flaky. `parse.ts` keeps a projection counter for exactly this and nothing else;
 * `surgicalMemo.test.ts` reads it as a delta around a parse and around repeated asks,
 * including the failing-projection case that the separate flag exists to serve.
 *
 * ⚠ IT IS MEMOISED PER MODEL, NOT PER MINI. A cache keyed on the mini string would help
 * only repeated parses of unchanged text, and the hot case is TYPING, where the mini
 * differs every keystroke and every lookup would miss.
 *
 * ⚠ `spans()` RETURNS A SOURCE ALREADY STAMPED WITH `attachedSteps` BELOW, so the width
 * rule stays in the one place that enforces it (`anchorsAreFor`, `serialize.ts`) and no
 * caller has to remember to re-check it. A source arrives from the leaf projection
 * describing the LEAF model's layout; overlaid it must describe the model it is landing
 * on, or the writer compares two independently-derived numbers and their agreement means
 * nothing ([[PV319]]).
 *
 * ⚠⚠ `spans` IS A FUNCTION, AND `JSON.stringify` DROPS FUNCTION-VALUED PROPERTIES. Any
 * gate that compares models structurally sees this field shrink to `attachedSteps` alone
 * rather than seeing it disappear — which is why that number stays a plain field. A gate
 * comparing an overlaid model against a bare one still sees a difference; one comparing
 * two overlaid models no longer sees their spans differ. `writer-census.test.ts` is the
 * gate that does this, and it strips the overlay from both sides explicitly rather than
 * letting `JSON.stringify` decide what it can see — a gate that passes because it went
 * blind reads exactly like one that passes because nothing changed.
 */
export interface SurgicalOverlay<S> {
  /**
   * The width of the model this overlay was attached to. The writer refuses unless the
   * model still has it — see `LeafSource.attachedSteps` for the restructure that makes a
   * bare width comparison unsound.
   */
  attachedSteps: number
  /** the spans, projected on first call and remembered — including a failure */
  spans: () => S | undefined
}

/** The grid's overlay — see `SurgicalOverlay` for the contract and both hazards. */
export type LazyLeafSource = SurgicalOverlay<LeafSource>

/** The roll's overlay, with the same contract and the same hazards. */
export type LazyRollLeafSource = SurgicalOverlay<RollLeafSource>

/**
 * One played note, paired with the source leaf its PITCH was read from.
 *
 * The roll's analogue of `LeafAnchor`, and deliberately not the same shape: a grid
 * column holds a set of atoms, while a roll note is positioned AND held, so an
 * anchor has to carry where it starts and how long it lasts as well as what it
 * plays. Both are still the same fact — "these bytes are this note's own".
 */
export interface RollLeafAnchor {
  /** the note as the model carries it — names case-folded, numerics stringified */
  pitch: string
  /** the model column the note starts at, absolute across bars */
  start: number
  /** length in columns */
  duration: number
  /** the PITCH token's own `[start, end)` in `src` — never the `@n` hold (see below) */
  span: LeafSpan
}

/**
 * The source of a leaf-anchored ROLL projection (#986 P1b) — `LeafSource` for the
 * pitched surface.
 *
 * Anchored per NOTE rather than per column, because a note is what the roll edits.
 * A chord contributes one anchor per member, each with its own disjoint leaf, so a
 * member can be cleared without touching the others.
 *
 * DURATION IS NOT WRITABLE HERE, and that is a fact about Strudel, not a shortcut:
 * a held note's hap carries ONLY its pitch leaf in `context.locations` — the `@n`
 * never appears as a location of its own (observed by driving `reifyMini` on
 * `c3@2`, `[c3 e3]@2`, `c3 e3@2 g3`, `0@2 2`: every one reports a single location,
 * the pitch). So there is no span through which a duration could be spliced, and
 * writing one would mean AUTHORING `@n` syntax — exactly the modelling this whole
 * mechanism exists to delete. A resized or moved note is therefore REFUSED by the
 * writer, never approximated. See `spliceRollByLeaf`.
 */
export interface RollLeafSource {
  /** the inner mini string the spans index into, byte-for-byte */
  src: string
  /** one per played note, in play order */
  anchors: RollLeafAnchor[]
  /**
   * The column count these anchors were read against — the roll's equivalent of
   * the grid's `cols.length`, and a REQUIRED guard rather than bookkeeping.
   *
   * Anchors are PROVENANCE: they describe where each note's bytes live in a
   * source laid out one particular way. A restructure (`resizeRoll`) re-lays the
   * grid while carrying the model's other fields through, so the anchors survive
   * describing a layout that no longer exists. Widening leaves every note's start
   * and length intact, which passes the writer's per-note check and would write
   * the ORIGINAL source back, silently discarding the resize. Narrowing is worse:
   * the notes that fell outside the new width look to the writer exactly like
   * notes the user DELETED, and it would splice `~` over them — data loss from a
   * gesture that edited nothing.
   *
   * So the check belongs at the WIDTH, the thing a restructure changes, not at
   * the item — and in ONE place: `anchorsDescribe` (`serialize.ts`), which both
   * leaf writers call ([[P329]], #990).
   */
  steps: number
  /** the width of the model these anchors were ATTACHED to — see `LeafSource` (#1235) */
  attachedSteps: number
}

/**
 * One `,`-separated part of the source, and the columns it produced.
 *
 * A flat sequence and a `<…>` alternation are the one-part case; a `,`-stack
 * has several, each with its OWN resolution. `bd sd, hh*4` lays two columns
 * against four, and the grid shows both on the finer of the two — so a part's
 * regions are indexed in its own column space and `factor` maps them onto the
 * shared grid.
 */
export interface SourcePart<C> {
  /** the lane `part` index these regions describe */
  part: number
  /** columns per top-level step INSIDE this part */
  div: number
  /**
   * Shared-grid columns spanned by each of this part's own columns.
   *
   * Always 1 for the roll: `parseRollLanes` requires every part to report the
   * same step count and refuses the pattern otherwise, so a roll's parts share
   * one column space by construction. The grid is the view that stretches
   * (`bd sd, hh*4` lays two columns against four).
   *
   * With `bars` present, the stretch is per BAR: one of this part's bars spans one bar
   * of the shared grid.
   */
  factor: number
  /**
   * The bars this part is WRITTEN over, when the stack is longer than some part (#1849).
   *
   * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd` plays for two bars, but the snare is written
   * once: Strudel's `stack` asks every part for the same cycle and the snare answers the
   * same bar again (`mini.mjs` `case 'stack'`). So the model draws this part's `bars`
   * written bars, then REPEATS them until the stack's own `bars` — never stretches them.
   * Its regions tile the written bars only (columns `[0, bars × columns-per-bar)` of its
   * own space). An edit in any bar changes that bar only: the writer spells the part bar
   * by bar as `<t0 … t(Q-1)>` (`spliceBars`, #1854), and back to the plain part when the
   * bars agree again.
   *
   * Absent on every stack that plays for one bar, which is every stack read before
   * #1849's `<…>` half — so those models are unchanged. Present → `factor` maps one bar
   * of this part onto one bar of the shared grid.
   */
  bars?: number
  /** the bytes before this part's content — its `,` and padding — verbatim */
  before: string
  /** the bytes after it */
  after: string
  /** one entry per top-level element, in source order, tiling the part */
  regions: SourceRegion<C>[]
}

/**
 * The bytes a model was read from, in the pieces the writer puts back.
 *
 * Present only on a model parsed from source and not restructured since —
 * `resize` drops it, because a re-laid grid makes every region a lie. Absent on
 * models built from scratch, and then the writer rebuilds from the grid, which
 * is lossy and always was.
 */
export interface NotationSource<C> {
  /**
   * The wrapper the parts sit inside, written back around them verbatim: `<`
   * and `>` (with the user's padding) for a multi-bar alternation, empty for a
   * flat sequence. Kept as bytes rather than a flag so `< a b >` keeps its
   * spaces.
   */
  prefix: string
  suffix: string
  parts: SourcePart<C>[]
}

/** Drum/step grid: lanes (sounds) × steps (columns). */
export interface StepGridModel {
  /** total columns across all bars */
  steps: number
  /**
   * The source this model was read from, for span surgery on write (#913).
   * The writer re-emits ONLY the regions whose content the user actually
   * changed and copies every other region's bytes through untouched, so an
   * edit cannot destroy notation it never touched (`bd hh*2 sd cp`, nudge a
   * cell in the `bd`, and the `*2` survives). Absent → the writer rebuilds the
   * whole string from the grid, which is lossy and always was.
   */
  source?: NotationSource<GridCells>
  /**
   * Set when the alternation sits INSIDE the sequence (`bd <sd hh>`, #920) rather
   * than around the whole cycle. The writer uses this instead of `source`; the
   * two are mutually exclusive.
   */
  altSource?: AltSource<GridCells>
  /**
   * Set by the LEAF-anchored projection (#986) for patterns whose notation no
   * element re-emit can reproduce. Takes precedence over both of the above and
   * is TERMINAL: a leaf grid is never rebuilt from its cells, because rebuilding
   * is exactly what would destroy the notation it was opened to preserve — an
   * edit it cannot express as a byte replacement is refused instead.
   */
  leafSource?: LeafSource
  /**
   * The same leaf spans, overlaid on a view the ELEMENT writer owns (#1010 P4d) —
   * a write channel, never a projection.
   *
   * `leafSource` above answers two questions at once: which writer owns the view,
   * and where that writer's spans are. Those are different questions, and binding
   * them is what made P4d a routing problem. Routing is decided once per model;
   * both writers answer per EDIT. So a per-model choice between them is silently
   * wrong for half the gestures either way — measured, the leaf-first form buys 17
   * more faithful documents and costs 1,763 placements and the finer view on the
   * same views, because a leaf-anchored view takes a new note only where a rest was
   * indexed (#1154) and has no span to subdivide for a refine (#1058).
   *
   * This field asks only the second question. The view stays the element
   * projection — its columns, its placements, its view scale are untouched — and
   * the writer tries byte surgery at the note's own span FIRST, falling back to the
   * element re-emit for any edit surgery cannot express. Nothing restates the leaf
   * writer's refusal rule anywhere; it is simply asked.
   *
   * ⚠ NOT INTERCHANGEABLE WITH `leafSource`, and the asymmetry is the safety
   * property. A leaf-PROJECTED view is terminal: an edit it cannot express is
   * REFUSED, because the re-emit is exactly what would destroy the notation that
   * view was opened to preserve (`amen/4` clearing its only cell comes back as
   * `<~ ~ ~ ~>`, and the 275 shared-leaf deletes #1160 declines would start being
   * written by the other writer). Falling back is permitted only here, where the
   * element writer was already the incumbent and the fallback restores exactly
   * today's behaviour.
   *
   * ⚠ ASKED THROUGH `spans()`, WHICH PROJECTS ON FIRST USE — see `SurgicalOverlay`. The
   * field became a thunk when #1233 attached it on the CORE path too, where a second
   * eager projection is x25.5 rather than the derived path's +59%, because the core parse
   * is cheap enough that the extra projection IS the cost.
   */
  surgical?: LazyLeafSource
  /** cycles the pattern spans via `<...>` alternation; absent = a single cycle */
  bars?: number
  /**
   * Each bar's OWN column count, when the bars' counts do not nest (#1827): `[3, 4]`
   * for `<[a b c] [a b c d]>`. Present → `steps` is their sum and every column this
   * model holds is a DRAWN column, bar b's cells each one `1/barSteps[b]` of a cycle.
   * Absent → the uniform layout, `steps / bars` columns per bar. Writers see the
   * shared grid only, through `toUniform*` in `perBar.ts`.
   */
  barSteps?: number[]
  /**
   * How much finer than the DOCUMENT this model is drawn (#1055, #1116). Absent =
   * `UNREFINED` — the document's own resolution, which is what every path that does
   * not apply a scale reports. That default is what makes `documentSteps(model)`
   * total: a projection which ignores the scale carries 1, so its document width and
   * its drawn width are the same number, which is the truth for it.
   */
  viewScale?: number
  /**
   * Lanes in presentation order. `sound` is the whole token incl. any
   * `:variant` (e.g. `bd:3`). `part` is the top-level `,`-stack the lane was
   * written in (absent = 0) — purely syntactic, kept so a hand-written stack
   * round-trips as the user wrote it instead of being flattened.
   */
  lanes: StepLane[]
  /**
   * Per-COLUMN velocity, length `steps`, indexed by serialized column (NOT by
   * lane — a stacked `[bd,sn]` column shares one gain). `1` is neutral; a model
   * with every gain at `1` (or `gains` absent) emits no `.gain`. Read from /
   * written to a parallel `.gain("v1 v2 …")` mini aligned to the columns the
   * grid serializes (rest columns serialize as `~`). Only single-part,
   * single-bar grids carry gain in the first cut; richer shapes leave any
   * existing `.gain` untouched (see `serializeStepGain`).
   */
  gains?: number[]
  /**
   * Set when a `.gain("…")` string was present on read-back but did NOT align
   * to the grid columns (wrong length, a broadcast `.gain("0.8")`, an `@`/`*`
   * we didn't write). The grid then leaves that `.gain` byte-identical and the
   * velocity drag is disabled — we never delete a gain we didn't author.
   */
  gainForeign?: boolean
  /**
   * Set when this model is a LOOK-ONLY view (#1975): drawn from what Strudel plays,
   * with no way to write any one note back. Every writer declines on it — the
   * serializer, the gain writer, the Slots states, the lengthen offers — so no op
   * built on them can write, whatever the panel does. Never set on a model a parse
   * returned as `ok: true`; it arrives only on a refusal's `lookOnly`.
   */
  lookOnly?: LookOnly
}

/**
 * One column of one lane: `false` for no trigger, or the note that starts there.
 *
 * WHY THIS IS NOT A BOOLEAN (#1010 P4b). A cell used to be one bit, so how long
 * its note sounds was not part of the model — and a writer cannot preserve an axis
 * its model never carried ([[PV239]]). Every duration loss on this surface starts
 * there: the element re-emit has nothing to write with except the view's own
 * resolution, so `[hh ~]!16` — sixteen notes each sounding for HALF a column —
 * comes back as sixteen notes of a full column, twice their length, and the pattern
 * is quietly a different pattern. The piano roll's note has carried `duration`
 * since the beginning and has never produced one of these.
 *
 * `false` rather than `null`/`undefined` for the off cell, so that the many places
 * which only ask "is anything here?" keep reading exactly as they did —
 * truthiness, `.some(Boolean)`, `filter(Boolean)`.
 */
export type StepCell = false | StepNote

/** A note occupying one grid cell. */
export interface StepNote {
  /**
   * How long the note SOUNDS, in COLUMNS: `1` is exactly this column, `2` spans
   * the next one too, `0.5` sounds for the first half of it and is silent after.
   *
   * COLUMNS, not cycles, and both units are deliberately in play at this boundary.
   * `Onset.durs` is cycle-relative so that no reader needs to know the grid's
   * resolution; a CELL is already positioned in the grid, and every consumer of
   * this field reasons in columns — the ×2/÷2 resolution ops, resize, and (P4c) the
   * printer deciding whether a note even needs a `[x ~]` to be spelled.
   * `RollNote.duration` is the same unit, which is what makes the two surfaces
   * comparable and is the direction #1032 goes.
   *
   * FRACTIONAL IS NORMAL — this is where it differs from the roll's integral `@n`.
   * Measured over the 1535-unit corpus: ~206 units carry a length that is not 1,
   * and 5 are sub-column (`[hh ~]!16` → 0.5, `[bd@0.5 - - -]` → 0.1429). A
   * consumer that assumes integers is wrong about real corpus material.
   */
  duration: number
}

/** an ON cell; `duration` in columns, defaulting to exactly this column */
export const cellOn = (duration = 1): StepNote => ({ duration })

/**
 * Is this cell a trigger? (`undefined` — past the end of the lane — is not.)
 *
 * Tests the SHAPE rather than `!== false`, so that a value from before the cell
 * carried a length — a stale `true` — reads as off instead of passing this guard and
 * handing `undefined` to arithmetic. That produced a `duration: NaN` exactly once, in
 * a test still building models by hand, and NaN is the kind of wrong answer that
 * propagates quietly. Nothing persists a `StepGridModel` (it is re-read from the
 * document every time), so this guards the JS boundary, not a migration.
 */
export const isCellOn = (cell: StepCell | undefined): cell is StepNote =>
  typeof cell === 'object' && cell !== null

/**
 * Scale a cell's LENGTH by the same factor the grid's resolution changed by, so the
 * note keeps the time it actually occupies (#1010 P4b).
 *
 * This is what makes ×2 / ÷2 mean what this module's header already promised —
 * "every hit keeps its position", extended from the onset to the whole note. A cell
 * lasting one column of a 16-column grid lasts TWO columns of the 32-column one: the
 * same eighth of a cycle, spelled at a finer resolution. Leaving the length alone
 * would silently halve every note on a ×2, which is the corruption this axis exists
 * to prevent, arriving from the op instead of from the printer.
 *
 * Halving needs a guard on BOTH surfaces, and the two are derived from different things.
 * The roll's is a STRUCTURAL choice, not a property of its numbers — a distinction this
 * comment used to get wrong by saying `RollNote.duration` "counts whole `@n` steps". It
 * does not: `@n` is a relative weight, `duration` is that weight converted to columns, and
 * real models carry `[0.5, 0.5, 3]` routinely. The writer can even spell a fractional one
 * (`c3@1.5 ~ ~ ~`), declining only below a whole column. What `structurallyCanHalveRoll`
 * actually requires is that every start AND duration be even, so the halved grid still
 * lands on whole columns — and `canHalvePianoRoll` then asks the real op rather than
 * predicting it (`scalePianoRoll(m,'halve') !== m`), with `ifRollSpellable` on top.
 * A cell's length is
 * fractional by design, so ÷2 always REPRESENTS exactly — and representing it was never the
 * question. SPELLING it is: the grid writes one token per column and a sustain as `_`, so it
 * can express a whole number of columns and nothing else, and half a column has no notation
 * at all. This comment used to conclude from the fractional model that `canHalveStepGrid`
 * needed nothing further; that held only while the printer threw the length away (#1010 P4c).
 * Halving is now offered when the RESULT IS WRITABLE, asked of the real writer — see
 * `ifGridSpellable` in `serialize.ts`.
 */
export const scaleCell = (cell: StepCell, factor: number): StepCell =>
  isCellOn(cell) ? cellOn(cell.duration * factor) : false

/**
 * Keep every note inside the room it has: no note reaches past the next hit in its
 * own lane, and none runs past the end of the grid.
 *
 * Only the quantize path needs this. ×2/÷2 scale onsets and lengths by one factor, so
 * a grid with no overlap keeps having none; quantize ROUNDS each onset onto a coarser
 * bucket, which can pull two hits closer together than their lengths allow. Same
 * promise `quantizePianoRollTo` already makes for the roll ("durations are clamped so
 * nothing overlaps or runs past the grid"), per lane here because a lane is one sound
 * and two notes of one sound cannot overlap in any notation we could write back.
 */
export function clampLane(cells: StepCell[], steps: number): StepCell[] {
  const out = [...cells]
  for (let c = 0; c < out.length; c++) {
    const cell = out[c]
    if (!isCellOn(cell)) continue
    let next = c + 1
    while (next < out.length && !isCellOn(out[next])) next++
    const room = Math.min(next, steps) - c
    if (cell.duration > room) out[c] = cellOn(room)
  }
  return out
}

/**
 * Below this much of a column, a note is not occupying it (#1056).
 *
 * Lengths reach the cell through float arithmetic on the engine's Fractions, so
 * "exactly one column" routinely arrives as `1.0000000000000004`. The same constant
 * `cell-duration.test.ts` compares lengths with, for the same reason.
 */
const COLUMN_EPS = 1e-9

/** How much of one column a note occupies, and where in the column it starts. */
export interface ColumnOverlap {
  /** where the note starts within this column, in `[0, 1)`; `0` unless it begins mid-column */
  offset: number
  /** how much of this column the note fills, in `(0, 1]` */
  extent: number
}

/**
 * The one rule both surfaces ask: what does the interval `[begin, end)` occupy of the
 * column `[col, col + 1)`? (#1056, #1074)
 *
 * It is an interval intersection and nothing more, which is the point — the step grid and
 * the piano roll had two different answers to this question and both were wrong in their
 * own way. The grid drew one full box per trigger and could not show a length at all; the
 * roll walked INTEGER steps against `start <= step < start + duration`, so a note starting
 * at 0.5 for 0.5 spans `[0.5, 1.0)`, contains no integer, and was drawn in no column
 * whatsoever while sounding perfectly.
 *
 * `offset` is what the grid never needs and the roll cannot do without: a grid note is
 * indexed BY its column so it always begins at one, while a roll note carries a fractional
 * `start` in the same field it is positioned by.
 */
export function columnOverlap(begin: number, end: number, col: number): ColumnOverlap | null {
  const lo = Math.max(begin, col)
  const hi = Math.min(end, col + 1)
  const extent = hi - lo
  // A SLIVER IS NOT A COLUMN — see COLUMN_EPS. This was once claimed to be the single
  // place that decides it and was not (#1085); it is now, together with `headColumn` and
  // `tailColumn` below, which read the same constant. The threshold stays PRIVATE to this
  // module for that reason — the rules are exported, the number is not, so a caller
  // cannot re-derive the question with a literal of its own the way the roll did.
  if (extent <= COLUMN_EPS) return null
  return { offset: lo - col, extent }
}

/**
 * The FIRST column a note reaches into — `columnOverlap`'s answer in closed form (#1085).
 *
 * WHY THESE LIVE HERE. `columnOverlap`'s comment claims to be "the single place that
 * decides" where a note stops, and it was not: the piano roll hand-rolled the same
 * threshold twice, as bare `1e-9` literals, for the same question. Three literals, one
 * rule, two files — and the comment asserting there was one is what made it easy to
 * miss, because a reader who checks does find a single named constant.
 *
 * The stake rose when the resize GRAB ZONE started asking `tailColumn` too (#1078),
 * having previously walked integers of its own. The drawn handle and the grabbable zone
 * now derive from one rule, so a divergence between the thresholds would put them on
 * different columns for a note near a boundary — which is the class #1078 was fixing.
 *
 * These are closed forms rather than a search because they are asked per cell in the
 * render loop; that they really are `columnOverlap`'s first and last non-null column is
 * asserted over the whole roll corpus rather than argued (`cell-coverage.test.ts`).
 */
export function headColumn(n: { start: number }): number {
  return Math.floor(n.start + COLUMN_EPS)
}

/** The LAST column a note reaches into — see {@link headColumn}. */
export function tailColumn(n: { start: number; duration: number }): number {
  return Math.ceil(n.start + n.duration - COLUMN_EPS) - 1
}

/**
 * How many columns a lane must DRAW to show everything the model carries (#1087).
 *
 * WHY THIS IS NOT `model.steps`. `steps` is the pattern's LENGTH, and `@n` is a relative
 * weight, so a length is under no obligation to be a whole number of columns:
 * `note("c4@1.5 e4@1.2")` is 2.7 columns long. The panel drew `Array.from({length:
 * model.steps})`, and `Array.from` floors its length — so the pattern rendered two
 * columns and the note sounding through the third was drawn nowhere. At
 * `c4@0.2 e4@0.2 g4@0.2 b4@0.2 c5@0.2` the weights sum to `0.9999999999999998` and the
 * panel drew ZERO columns while five notes sounded, with no message.
 *
 * The two questions had to be separated rather than reconciled, and that is measured, not
 * argued: rounding `steps` up in the READER (the shape #1087 proposed) re-emits
 * `c4@1.5 e4@1.2` as `"c4@1.5 e4@1.2000000000000002 ~"` — an invented trailing rest that
 * lengthens the pattern. `steps` is what the writer spells the music from; this is what
 * the panel counts cells with. Only the second may be rounded.
 *
 * ASKED AS THE CONSEQUENCE, NOT THE REPRESENTATION. The guard is not "is `steps` a whole
 * number?" — `0.9999999999999998` passes any tolerance a reasonable person writes and
 * still floors to 0. It is "does the count I hand the renderer cover every note?", so the
 * note term is asked directly rather than inferred from `steps ≥ every note's end`. That
 * is not defensive duplication: the note term is the ONLY thing that draws the partial
 * tail column, and the length term is the only thing that draws a trailing rest. Break
 * either and a real pattern loses a column, which is what the two arms in
 * `columnCount.test.ts` pin.
 */
export function columnCount(model: {
  steps: number
  notes?: readonly { start: number; duration: number }[]
}): number {
  // The pattern's WHOLE columns — floored, not rounded up. A fractional length ends in a
  // PARTIAL column, and a partial column is not a cell: nothing can be placed in it (the
  // writer refuses a note running past `steps`), so drawing it would add an empty cell
  // that only declines. `+ COLUMN_EPS` for the sliver, exactly as `headColumn` does, so a
  // length arriving as `3.0000000000000004` is three columns and `2.9999999999999996`
  // is not two.
  let cols = Math.floor(model.steps + COLUMN_EPS)
  // …and then every column a NOTE reaches into, which is what pulls the partial tail
  // column back in when something actually sounds there — `c4@1.5 e4@1.2` is 2.7 long and
  // its second note sounds through column 2, so three columns are drawn; `c4 ~@0.5` is
  // also fractional but its tail holds a rest, so it stays at one.
  for (const n of model.notes ?? []) cols = Math.max(cols, tailColumn(n) + 1)
  return Math.max(0, cols)
}

/** the roll's rows when it has nothing to show: c3–c5, and never fewer than an octave */
const DEFAULT_LO = 48 // c3
const DEFAULT_HI = 72 // c5
const MIN_SPAN = 12

/**
 * Which pitch rows the roll DRAWS — the row axis's answer to `columnCount`, and here for
 * the same reason: it is not a fact about the notation, it is a fact about the surface,
 * and everything that has to agree about the surface must read it from one place (#1163).
 *
 * The rows are the content PADDED by two semitones on each side (floored at an octave),
 * because a roll you cannot place a note above or below is a roll you cannot write a
 * melody in. A model with no spellable pitch draws c3–c5 rather than nothing.
 *
 * ⚠ THIS IS THE PANEL'S MINIMUM, NOT ITS EXACT EXTENT, and the difference is deliberate.
 * The panel holds a STICKY range (#391): this seeds it on a statement change and it only
 * ever grows from there within the binding, so the rows on screen are a superset of these
 * and no pure function of the model can know which. Every row it does return is drawn.
 *
 * WHY IT LIVES HERE rather than in the panel that renders it. `viewPlacesNotes` has to ask
 * about the rows a user can click, and while this rule lived in `PianoRollGrid.tsx` it
 * could not: it probed one row below the content on the ASSUMPTION that the display pads
 * below, an assumption two modules apart from the `− 2` that made it true, with no arm
 * that could fail if either moved (#1163). A promise about a surface computed alongside
 * the surface instead of from it is the shape that has already shipped four times.
 */
export function rollContentRange(model: {
  notes: readonly { pitch: string }[]
}): { lo: number; hi: number } {
  const midis = model.notes
    .map((n) => pitchToMidi(n.pitch))
    .filter((m): m is number => m !== null)
  if (midis.length === 0) return { lo: DEFAULT_LO, hi: DEFAULT_HI }
  const lo = Math.min(...midis) - 2
  return { lo, hi: Math.max(Math.max(...midis) + 2, lo + MIN_SPAN) }
}

/**
 * Is there more than one thing in this view? — the rule invariant 3's third term is
 * built on (#1256), and the reason it has a home at all (#1259).
 *
 * A one-cell grid or a one-note roll round-trips perfectly and is useless: `s("piano")`
 * draws a single grey box, `note("C3")` a single dot. Both are correct models and
 * neither is a surface anyone can edit music in, so a coverage number that counts them
 * as served is an upper bound rather than a measurement ([[P338]] clause 2).
 *
 * THE TWO SURFACES GET DIFFERENT CLAUSES ON PURPOSE, and the asymmetry is worth stating
 * because it is easy to read as an oversight. The grid is a CELL instrument, so "useful"
 * means more than one column with at least one hit in it; the roll is a NOTE instrument
 * with no columns of its own to be empty, so "useful" means more than one note. Applying
 * the grid's clause to the roll would count a single-note roll spanning 16 steps as
 * structured — one dot in a wide empty field, which is the exact case this exists to
 * exclude.
 *
 * ⚠ NOT THE SAME QUESTION AS `leafViewUsable` (`parse.ts`, gate `view-unusable`), and
 * they must not be merged. That guard asks whether any single edit is EXPRESSIBLE — a
 * grid whose every column shares one leaf refuses every click, so it is refused up front.
 * This asks whether there is more than one thing to edit. A one-cell grid whose cell
 * clears cleanly passes that guard and fails this one; the two are independent and both
 * are real.
 *
 * ⚠ THE SURFACE KEY SELECTS THE CLAUSE — pass the model that surface parsed. The
 * parameter is a structural subset (the convention `columnCount` and `rollContentRange`
 * already follow here) so that a `StepGridModel`, a `PianoRollModel` and the sweeps'
 * intersection type all satisfy it without a cast; it cannot also enforce the pairing.
 *
 * WHY IT LIVES HERE. It was module-private inside `writer-census.test.ts` and had been
 * copied twice by the time anyone counted — into `roll-cap-sweep.test.ts` (whose own
 * docblock recorded that it had to restate the rule because this one was unexported, and
 * that the two must move together) and into the #1256 kind census. Three copies that
 * agree today and diverge silently tomorrow is the shape this seam has already shipped:
 * a decision derived twice, where the second derivation quietly won.
 */
export function hasStructure(
  model: {
    steps: number
    lanes?: readonly { cells: readonly StepCell[] }[]
    notes?: readonly unknown[]
  },
  surface: 'step' | 'roll',
): boolean {
  if (surface === 'roll') return (model.notes?.length ?? 0) > 1
  const hits = (model.lanes ?? []).reduce((n, l) => n + l.cells.filter(isCellOn).length, 0)
  return model.steps > 1 && hits >= 1
}

/** A span of columns, split into the whole ones it contains and the fraction left over. */
export interface ColumnSplit {
  /** how many whole columns fit in the span; NEGATIVE when the span itself is */
  whole: number
  /** what is left after them, in `[0, 1)`; `0` when the span is a whole number of columns */
  remainder: number
}

/**
 * How does a span of `width` columns divide into whole columns and a remainder? (#1092)
 *
 * The WRITER's half of `columnOverlap`'s question. The reader asks what a note occupies;
 * the writer asks what it has to spell to put the next one in the right place, and a
 * mini-notation rest is one column unless it is given a weight. While every span was a
 * whole number of columns the two answers coincided and `while (col < start) push('~')`
 * was exact; a span of 1.5 columns spelled that way is two, and everything after it moves.
 *
 * Shares `COLUMN_EPS` with `columnOverlap` deliberately: "a sliver is not a column" has to
 * mean the same thing to the panel that draws a note and the writer that spells the silence
 * before it, or one of them emits a rest the other cannot see.
 */
export function columnSplit(width: number): ColumnSplit {
  const whole = Math.floor(width + COLUMN_EPS)
  const remainder = width - whole
  return { whole, remainder: remainder <= COLUMN_EPS ? 0 : remainder }}
/** One column of a lane, as covered by the note sounding through it. */
export interface ColumnCoverage {
  /** column the covering note BEGINS at; `=== c` exactly when this column is the head */
  start: number
  /**
   * Fraction of THIS column the note sounds through, in `[0, 1]`. A whole column
   * is `1`; `[hh ~]!16` covers half of its own column and nothing after it, so its
   * head reads `0.5`. The last column of a length-2.5 note reads `0.5` as well —
   * the unit is the column, not the note.
   */
  extent: number
}

/**
 * Which columns each note in a lane occupies, and by how much of each (#1056).
 *
 * WHY THIS EXISTS AS A DERIVATION rather than in the panel. `StepNote.duration` has
 * been read by the parser (P4b) and preserved by the printer (P4c) since #1010, and
 * was still invisible: every visual property of a cell derived from `isCellOn`, and a
 * sustained column is `false`, so `bd _ sd ~` and `bd ~ sd ~` drew an IDENTICAL lit-cell
 * pattern. An axis the model carries and the writer preserves is not an axis the user
 * can see — only the panel's geometry decides that ([[PV245]]) — and this is the
 * derivation that geometry needs. It is a READ: it never mutates a cell, and it is not
 * an op, which is why it sits beside `clampLane` rather than in `place.ts`.
 *
 * THE ROOM RULE IS `clampLane`'S, ASKED NON-DESTRUCTIVELY. A note stops at the next hit
 * in its own lane and at the end of the grid, because those are the only lengths the
 * writer can spell (two notes of one sound cannot overlap in any notation we could write
 * back). Reading the same rule the clamp enforces is what keeps the drawing and the
 * document from disagreeing — a model that has been through `clampLane` is a fixpoint
 * here, and one that has not still draws only what is spellable.
 *
 * THE HEAD IS ALWAYS EMITTED, even at `extent === 0`, so a note can never be dropped from
 * the drawing by arithmetic. Whether a zero-extent head is still worth a pixel is the
 * renderer's question, not this function's.
 */
export function laneCoverage(cells: StepCell[], steps: number): (ColumnCoverage | undefined)[] {
  const out: (ColumnCoverage | undefined)[] = new Array(cells.length).fill(undefined)
  // The two bounds are `clampLane`'s and are deliberately different: cells are read to
  // the END OF THE LANE so no trigger can be dropped from the drawing, while a note is
  // carried only to the END OF THE GRID, because that is as far as the writer can spell.
  const gridEnd = Math.min(cells.length, steps)
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c]
    if (!isCellOn(cell)) continue
    out[c] = { start: c, extent: Math.min(1, Math.max(0, cell.duration)) }
    for (let k = 1; c + k < gridEnd; k++) {
      if (isCellOn(cells[c + k])) break // the next hit owns its own column
      // The carry asks the shared interval rule, so the grid and the roll cannot disagree
      // about where a note stops. A grid note begins AT its column, so `offset` is always
      // 0 here and only `extent` is used — that asymmetry is the whole of the difference
      // between the two surfaces.
      const ov = columnOverlap(c, c + cell.duration, c + k)
      if (!ov) break
      out[c + k] = { start: c, extent: ov.extent }
    }
  }
  return out
}

/** One note group's geometry within a column: where it starts and how much it fills. */
export interface ColumnGroup extends ColumnOverlap {
  /** the group's exact `start`, which is what the gain write path is keyed by */
  start: number
}

/**
 * The note GROUPS sounding through `col`, in time order, with their column geometry
 * (#1086). The roll's answer to the question `laneCoverage` answers for the grid.
 *
 * A group is the set of notes sharing an exact `start` — that is already the unit the
 * gain path uses (`setGroupGain` writes every note at one `start`, so a chord is one
 * velocity), so keying on `start` is not a new grouping, it is the existing one made
 * legible to the panel. The group's span runs to the LATEST end among its members: a
 * chord whose members hold for different lengths sounds until its last one stops.
 *
 * WHY THE PANEL CANNOT DO THIS ITSELF, which is the whole of #1086. The velocity lane
 * asked `n.start === col` — an equality on a number that is fractional whenever a note
 * begins mid-column, so such a group matched no column and got no bar. That is the same
 * whole-number question `noteAt` asked before #1074 and the resize grab zone asked before
 * #1078; this is the third site, and the fix is the same one: ask the shared interval
 * rule instead of testing integers.
 */
export function columnGroups(notes: RollNote[], col: number): ColumnGroup[] {
  const endByStart = new Map<number, number>()
  for (const n of notes) {
    const end = n.start + n.duration
    const prev = endByStart.get(n.start)
    if (prev === undefined || end > prev) endByStart.set(n.start, end)
  }
  const out: ColumnGroup[] = []
  for (const [start, end] of endByStart) {
    const ov = columnOverlap(start, end, col)
    if (ov) out.push({ start, ...ov })
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Do these column spans lay end-to-end without overlapping (#1086)?
 *
 * The gate that decides whether a column's groups can be drawn side by side. Groups that
 * overlap IN TIME — a stack's simultaneous voices — cannot be laid out along the column's
 * time axis at all, because they are not sequential in it; drawing them that way puts one
 * bar on top of another. Corpus-wide, 129 of the 137 multi-group columns are that case,
 * and they are deferred to #1088 as a layout question rather than answered here.
 *
 * Asked through `COLUMN_EPS` rather than an exact comparison for the same reason every
 * other question here is: a span that ends exactly where the next begins arrives from
 * float arithmetic as a hair's overlap, and that must read as sequential.
 */
export function spansAreSequential(spans: readonly ColumnOverlap[]): boolean {
  const byOffset = [...spans].sort((a, b) => a.offset - b.offset)
  for (let i = 1; i < byOffset.length; i++) {
    const prevEnd = byOffset[i - 1].offset + byOffset[i - 1].extent
    if (byOffset[i].offset < prevEnd - COLUMN_EPS) return false
  }
  return true
}

/**
 * The groups a velocity column is DRAWN AS, when it is drawn as more than one (#1086) —
 * `null` when the column keeps its single bar.
 *
 * The decision lives here, in one exported function, rather than as an expression in the
 * panel, so that the gate asserting how many columns split asks the SAME rule the panel
 * renders from. Re-stating `length > 1 && sequential` in a test would be a second oracle,
 * and one that agrees by construction — the shape that has gone green over a real defect
 * more than once at this boundary.
 */
export function sequentialColumnGroups(notes: RollNote[], col: number): ColumnGroup[] | null {
  const groups = columnGroups(notes, col)
  return groups.length > 1 && spansAreSequential(groups) ? groups : null
}

/**
 * A NEW ONSET ENDS EVERY NOTE STILL SOUNDING THROUGH ITS COLUMN — across the
 * whole `,`-part, not just the lane that was clicked (#1064 phase 2).
 *
 * `clampLane` above resolves the conflict over a LANE because a click lands in
 * one. The writer's constraint is not per lane: `sustainTokens` emits one token
 * per column per PART and declines when "another note starts under the sustain",
 * because `[_,bd]` is a chord containing a token that means nothing there. So a
 * note sustaining in ANY lane of the part blocks the column, and clamping only
 * the clicked lane hands the writer a model that says two things at once — which
 * it correctly refuses, leaving the user's click inert (1,717 of 1,748 declines
 * on the element path, 98.2%).
 *
 * WHY THE PART AND NOT THE WHOLE COLUMN: the scope is dictated by the writer's
 * constraint and nothing else. Parts are serialized independently — `partColumns`
 * filters by part before `sustainTokens` ever runs — so `bd _ _ _, ~ ~ hh ~` is
 * legal notation and the `hh` onset under the `bd` sustain needs no resolution at
 * all. Trimming across the part boundary would shorten a note the writer was
 * always going to accept: a silent musical change with no notational need, which
 * is the one thing this op must not do.
 *
 * This SHORTENS A DIFFERENT SOUND'S NOTE, and that is a deliberate product ruling
 * rather than a side effect — but the reason is the WRITER, not symmetry. Within a
 * part the columns are serialized together, so a `_` sustaining in one lane really
 * does occupy the column another lane's onset needs. The shortening is the price of
 * writing the edit down at all.
 *
 * ⚠ THE RULING WAS ONCE STATED AS UNIFORM ACROSS BOTH SURFACES, on the grounds that
 * the roll's `placeNote` "has always resolved across pitches this way" — and #1310
 * withdrew that half. The roll's trim was never forced by a writer constraint the way
 * this one is; it merely looked identical. A roll chord lives inside ONE part, and
 * once the region writer learned parallel lanes it could spell members of different
 * lengths, so trimming the siblings bought nothing and changed voices the user never
 * touched — 61 of 541 placements, measured. The roll now trims same-pitch only.
 *
 * What survives, and is the real principle: each surface resolves over exactly the
 * scope ITS writer forces, and neither trims for taste. The scopes differ because the
 * constraints differ, not because one surface is behind the other.
 *
 * Still only a WIDENING, never a promise. Anything it cannot make spellable —
 * a trim that lands on a fraction of the part's own coarser grid, a `_` with
 * nothing before it — the writer still refuses, and `ifGridSpellable` still
 * gates the op ([[PV241]]: ask the writer, never predict it).
 */
export function clampPartAtOnset(lanes: StepLane[], part: number, column: number): StepLane[] {
  return lanes.map((lane) => {
    if ((lane.part ?? 0) !== part) return lane
    let touched = false
    const cells = lane.cells.map((cell, c) => {
      if (c >= column || !isCellOn(cell)) return cell
      // A length that merely ENDS at the column is not sounding through it — and that
      // question is `columnOverlap`'s, not this function's. It was written here with its
      // own `1e-6` before the shared rule existed, which left the file deciding "does
      // this note reach into this column?" at two different thresholds a hundred lines
      // apart. Asking the shared rule was measured to move nothing (parity-corpus 371,
      // editor 3082, every pinned per-path figure identical), so this is a consolidation
      // with no behavioural component — which is the only kind worth making silently.
      if (!columnOverlap(c, c + cell.duration, column)) return cell
      touched = true
      return cellOn(column - c)
    })
    return touched ? { ...lane, cells } : lane
  })}

export interface StepLane {
  sound: string
  part?: number
  cells: StepCell[]
}

/** A single note in the piano roll. */
export interface RollNote {
  /** note token, e.g. `c3`, `eb4` */
  pitch: string
  /** column index where the note begins */
  start: number
  /**
   * Length in COLUMNS — frequently fractional, and not a count of `@n`s. `@n` is a
   * relative weight (`n / Σweights` of the enclosing sequence), so a whole `@n` lands on
   * whatever share of a column that works out to. The writer spells this back as `@n`
   * where it can, including fractionally, and declines below one column.
   */
  duration: number
  /**
   * Per-note velocity. `1` (or absent) is neutral and emits no `.gain`. Chord
   * members sharing a `start` share one gain (like duration); on read-back the
   * group's gain is applied to all its members. Written to a parallel
   * `.gain("…")` mini that mirrors the note sequence's group/`@n`/rest
   * structure. Only single-bar rolls carry gain in the first cut.
   */
  gain?: number
}

/** Pitched (melodic) grid: notes placed on a pitch × time grid. */
export interface PianoRollModel {
  /** total columns across all bars */
  steps: number
  /**
   * The source this model was read from, for span surgery on write (#916) —
   * the roll's half of what `StepGridModel.source` does for the grid. A region
   * owns columns `[from, to)` and the notes STARTING in that range are its own;
   * unchanged ones write their bytes back, so `C D` stays `C D` rather than
   * coming back lowercased for the crime of being looked at. Absent → the
   * writer rebuilds from the model, which is lossy and always was.
   */
  source?: NotationSource<RollNote[]>
  /**
   * Set when the alternation sits INSIDE the sequence (`0 <2 3> 5`, #920) rather
   * than around the whole cycle. The writer uses this instead of `source`; the
   * two are mutually exclusive.
   */
  altSource?: AltSource<RollNote[]>
  /**
   * Set by the LEAF-anchored projection (#986 P1b) for patterns whose notation no
   * element re-emit can reproduce — the roll's half of `StepGridModel.leafSource`,
   * and TERMINAL for the same reason: a leaf roll is never rebuilt from its notes,
   * because rebuilding is what would destroy the notation it was opened to
   * preserve. An edit it cannot express as a byte replacement is refused instead.
   */
  leafSource?: RollLeafSource
  /**
   * The same leaf spans overlaid on a view the ELEMENT writer owns (#1010 P4e) — the
   * roll's half of `StepGridModel.surgical`, with the same meaning and the same
   * asymmetry against `leafSource` above.
   *
   * `leafSource` answers two questions at once: which writer owns the view, and where
   * that writer's spans are. This field asks only the second. The view stays the
   * element projection — its columns, its notes, its view scale untouched — and
   * `serializePianoRollWithExtent` tries byte surgery at each note's own span FIRST,
   * falling back to the element paths for anything surgery cannot express.
   *
   * ⚠ NOT INTERCHANGEABLE WITH `leafSource`, and the asymmetry is the safety property.
   * A leaf-PROJECTED roll is terminal: an edit it cannot express is REFUSED, because
   * the rebuild is what would destroy the notation the view was opened to preserve, and
   * falling back would hand the re-emit the shared-leaf deletes #1160 declines. Falling
   * back is permitted only here, where the element writer was already the incumbent, so
   * it can only restore today's behaviour and never introduce a write.
   *
   * ⚠ DECIDED ON THE ROLL, NEVER BY ANALOGY WITH THE GRID. `projectPianoRollDerived`
   * records the two surfaces answering the same routing flip with opposite signs — the
   * roll loses ten units of reach where the grid gains five — which is exactly why P4d's
   * result could not simply be assumed here and why every figure behind this field was
   * taken on the roll.
   *
   * ⚠ ASKED THROUGH `spans()`, exactly as the grid's is — see `SurgicalOverlay` for why
   * the projection is deferred and what the memo guarantees.
   */
  surgical?: LazyRollLeafSource
  /** cycles the pattern spans via `<...>` alternation; absent = a single cycle */
  bars?: number
  /**
   * Each bar's OWN column count, when the bars' counts do not nest (#1827): `[3, 4]`
   * for `<[a b c] [a b c d]>`. Present → `steps` is their sum and every column this
   * model holds is a DRAWN column, bar b's cells each one `1/barSteps[b]` of a cycle.
   * Absent → the uniform layout, `steps / bars` columns per bar. Writers see the
   * shared grid only, through `toUniform*` in `perBar.ts`.
   */
  barSteps?: number[]
  /**
   * How much finer than the DOCUMENT this model is drawn — the roll's half of
   * `StepGridModel.viewScale`, with the same meaning and the same default (#1055,
   * #1116). Absent = `UNREFINED`, which is the truth for every projection that does
   * not apply a scale and is what keeps `documentSteps(model)` total.
   *
   * ⚠ A ROLL COLUMN IS NOT A GRID COLUMN: `steps` here is a column COUNT that
   * `start`/`duration` are measured in, so a refine multiplies all three together.
   */
  viewScale?: number
  notes: RollNote[]
  /** see `StepGridModel.gainForeign` — a `.gain` we read but don't manage. */
  gainForeign?: boolean
  /**
   * The pitch tokens are bare integers (`note("60 62")` MIDI, `n("0 1 2")`
   * degrees) rather than note names (#469). Row math is the same (the number
   * IS the row), but new/dragged notes must emit numbers, not `c4`, so the
   * pattern round-trips. A pattern mixes one convention or the other, never
   * both (mixed is rejected at parse).
   */
  numeric?: boolean
  /** see `StepGridModel.lookOnly` — the roll's half, same rule */
  lookOnly?: LookOnly
}

/**
 * Why a model is look-only (#1975): the gate that refused the editable view, and why
 * in the words of someone looking at the view (`lookOnlyWhy`, `parse.ts` — not the
 * refusal's own `reason`, which speaks the parser's vocabulary). Carried on the model so
 * a panel reads it rather than deciding for itself what cannot be edited.
 */
export interface LookOnly {
  gate: Gate
  reason: string
}

/** the one line a panel shows over a look-only view — said once, for both grids */
export const lookOnlyLine = (l: Pick<LookOnly, 'reason'>): string => `Look only — ${l.reason}. Edit it in the code.`

/**
 * WHY a view declined a pattern — the gate that actually stopped it (#990).
 *
 * Three writers stack behind one parse call (syntactic core → element projection
 * → leaf projection), and before this the `reason` string was whichever one
 * declined FIRST — almost always the core, describing a subsystem that often had
 * nothing to do with why the unit was unavailable. Measured over 1500 real units,
 * every pattern reporting "nested groups are beyond the editable subset" was in
 * fact stopped by a wrong-surface value or an unstable period; not one was stopped
 * by anything to do with nesting. A gate names the real cause.
 *
 * These are not a new list of features. Each is one face of the single editability
 * invariant — a played onset is editable iff it maps to a unique disjoint source
 * span, in a view that stays true:
 *   - `wrong-surface`      the values belong to the OTHER view (a drum pattern
 *                          asked of the piano roll, a number asked of the grid).
 *                          Not an editability failure — a routing fact.
 *   - `no-note-content`    nothing placeable sounds at all: a params/signal value,
 *                          a zero-length hap, silence, or a query that threw.
 *   - `unstable-period`    what it plays does not repeat inside the projection's
 *                          bar window, so any view of it stops being true.
 *   - `mixed-pitch-domain` numeric and named pitches in one pattern (roll only).
 *   - `irrational-onset`   an onset/duration/boundary that lands on no column.
 *   - `resolution`         the columns needed exceed the step ceiling.
 *   - `element-tiling`     the source's top-level elements do not tile the played
 *                          columns — the element writer's half of the bijection.
 *   - `no-leaf-anchor`     a played note has no source token of its own, or two
 *                          notes claim overlapping bytes — the leaf writer's half.
 *   - `note-crosses-bar`   a played note does not fit inside the bar it starts
 *                          in, so no column layout can hold it. Deliberately NOT
 *                          folded into `no-leaf-anchor`: such a note has a
 *                          perfectly good source token, and folding it in would
 *                          overstate the write-back guard — the exact kind of
 *                          misattribution this vocabulary exists to end.
 *   - `edit-unsafe`        the write-back probe and the engine disagreed.
 *   - `view-unusable`      the view opens but no single edit is expressible.
 *   - `no-finer-view`      a REFINED request came back unrefined: the path that
 *                          owns the pattern answered, and its answer does not
 *                          carry the requested scale. Distinct from
 *                          `view-resolution`, which is the ceiling saying no —
 *                          here nothing was too large, the owner simply has no
 *                          finer view to give. Reachable only through a refined
 *                          ask, which is why it went unnamed until #1132.
 *   - `not-a-pattern`      it does not reify at all; the core's own syntax
 *                          message is the better answer and is kept.
 */
export type Gate =
  | 'wrong-surface'
  | 'no-note-content'
  | 'unstable-period'
  | 'mixed-pitch-domain'
  | 'irrational-onset'
  | 'resolution'
  /**
   * The VIEW asked for more columns than it may draw (#1055). Distinct from
   * `resolution`, which is the DOCUMENT's own blow-up guard: this one says the
   * document is fine and the requested magnification is not. Cannot fire while the
   * view scale is `UNREFINED`, since the document ceiling (64) is below the view
   * ceiling (256) — see `viewResolution.ts`.
   */
  | 'view-resolution'
  | 'element-tiling'
  | 'no-leaf-anchor'
  | 'note-crosses-bar'
  | 'edit-unsafe'
  | 'view-unusable'
  | 'no-finer-view'
  /**
   * The source spells this content with a backslash escape (#1254). Narrower than
   * `not-a-pattern`, and separated from it deliberately: that gate means "nothing
   * reified, and the core's own message names the syntax", which is the better
   * answer and is why an unreified refusal is allowed to stay unnamed. This one is
   * the case where the core's message CANNOT be the better answer, because the
   * backslash is not something the author wrote into the pattern.
   *
   * A double-quoted literal is reified by the transpiler from `node.value`, the
   * JS-COOKED string, while the editor models the DOCUMENT SLICE between the quotes
   * — so every JS escape leaves a backslash on our side that the engine never sees.
   * A backtick literal cannot diverge (the raw text is what runs), and there the
   * backslash really is in the pattern and krill really does refuse it. The sentence
   * below is therefore written to be true of both, naming what is observable in the
   * string rather than a cause only the reader could know.
   */
  | 'escaped-source'
  | 'not-a-pattern'

/**
 * Parse outcome. `ok: false` is a first-class result, not an exception — every
 * panel checks it on open and disables itself (code-only) when the pattern is
 * outside the editable subset.
 *
 * `gate` is present whenever a projection ran and declined — the machine-readable
 * half of `reason`, so a measurement buckets by cause instead of by string match.
 * Absent when the refusal is the syntactic core's own (nothing reified).
 *
 * `lookOnly` is present when the ONLY thing that stopped the view is that its notes
 * cannot be edited one by one (#1975): what the pattern plays, laid out as the view
 * would have drawn it, marked `lookOnly` so nothing can write through it. The result
 * stays `ok: false` on purpose — everything that asks "can this be edited?" (routing,
 * every read-back proof, the corpus gates) keeps its answer, and only a caller that
 * wants to SHOW the pattern reads this field.
 */
export type ParseResult<M> =
  | { ok: true; model: M }
  | { ok: false; reason: string; gate?: Gate; lookOnly?: M }

/**
 * What a model's velocity wants done to the pattern's `.gain` method. A single
 * `.gain` carries the level at two granularities — a SCALAR `.gain(0.4)` (a
 * uniform track level, the Mixer-knob form) or a per-column STRING
 * `.gain("0.4 0.2 …")`. They can't coexist (Strudel's `.gain` overrides, last
 * wins), so velocity expands the scalar to a string on edit and collapses back
 * when the columns are uniform again. Discriminated so the binding layer can
 * coordinate the second write-back range unambiguously:
 *   - `write` — upsert `.gain(value)`; `quoted` picks the form: `false` →
 *      `.gain(0.4)` (collapsed/scalar), `true` → `.gain("0.4 0.2 …")` (per
 *      column). Replaces an existing managed arg in place, else inserts after
 *      the expression;
 *   - `clear` — every level neutral (1) → remove our `.gain` (no `.gain(1)` /
 *      `.gain("1 1 …")`);
 *   - `skip` — gain is out of scope (multi-bar, `,`-stack, or a `.gain` we
 *      don't manage, e.g. a signal arg) → leave it byte-identical.
 */
export type GainWrite =
  | { kind: 'write'; value: string; quoted: boolean }
  | { kind: 'clear' }
  | { kind: 'skip' }

/**
 * The `.gain` argument read off a chunk's chain, normalized for the velocity
 * layer: `numeric` for a scalar `.gain(0.4)` (a uniform base), `mini` for a
 * string `.gain("…")`, `foreign` when a `.gain` is present in a form we don't
 * manage (a signal/identifier arg) and must leave untouched. All null/false =
 * no `.gain`.
 */
export interface ChunkGain {
  mini: string | null
  numeric: number | null
  foreign: boolean
}
