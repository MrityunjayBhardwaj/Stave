/**
 * surfaceRoute — which grid a chunk's CONTENT belongs to (#1240).
 *
 * ── WHY THIS IS NOT IN `patternKind.ts` ──────────────────────────────────
 * It was, for about an hour, and the editor suite said no. `patternKind` is
 * imported by `mixer/stripModel.ts`, which the engine reaches through
 * `bareCapture.ts` — so putting the roll's content check there dragged
 * `notation/parse.ts`, and with it `@strudel/mini`'s krill parser, into
 * `StrudelEngine`'s module graph. That test file mocks `@strudel/mini` with a
 * factory closing over a top-level variable, and the earlier load turned it into
 * `Cannot access 'MockPattern' before initialization`: the whole 37-test suite
 * died AT LOAD, four modules from anything this change is about. Both package
 * typechecks stayed at their exact baselines throughout.
 *
 * The split is not a workaround for that failure, it is what the failure
 * revealed. There are two questions here and they were one question only while
 * the head was the sole signal:
 *
 *   1. WHAT KIND OF HEAD IS THIS?  Pure, cheap, no notation parsing.
 *      `patternKind` — and the mixer, the engine's graph, wants only this.
 *   2. WHICH SURFACE SHOULD THIS CONTENT OPEN?  Needs the content parsed,
 *      because a resolver-supplied span sits on a head that says nothing.
 *
 * Question 2 legitimately depends on the notation layer; question 1 must not.
 * The dependency line IS the boundary, so the modules are split along it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 * Head first; where the head is silent ask the ROLL, never the grid; and where
 * a melodic head's own roll declines the CONTENT, ask whether the content is a
 * chord chart before letting it fall to code (#1243).
 *
 * That last clause is narrow on purpose and its bounds are measured, not
 * guessed — `rollUnlessChordChart` below carries both halves of why. The short
 * version: of twelve melodic units the roll declines and the grid would take,
 * seven are declined on CAPACITY rather than content, and of the five declined
 * on content only one is actually a chord chart. A rule any wider than this one
 * draws melodies as drum grids.
 *
 * The grid has no WORD vocabulary: every word-like token is a sound name, which
 * is correct for a drum grid where sample names are arbitrary. So it opens for
 * `"bd sd hh cp"`, `"<Gsus G7 Em7 D7>"` and `"lorem ipsum dolor sit"` alike, and
 * cannot tell a drum kit from a chord chart from prose. Asking it "is this
 * yours?" about any word pattern returns yes, so "ask both and take whichever
 * opens" is not a routing rule but the absence of one (#1238).
 *
 * ⚠ IT IS NOT A UNIVERSAL ACCEPTOR, and the earlier claim that it "never returns
 * `wrong-surface`" was measured only on word-like tokens. It DOES decline
 * NUMERICS — `"0 1 2"` and `"1*1, 2*2, 3*3"` come back `wrong-surface`, "the
 * pattern plays numbers, which the piano roll shows". Two consequences, both
 * load-bearing: the grid's silence is uninformative only ACROSS WORD PATTERNS,
 * which is still exactly the chord-vs-drums case this rule turns on; and the
 * grid arm below can REFUSE, so reaching it is not a promise that a view opens.
 * `"bd 3 hh"` is declined by both surfaces and correctly gets no editor.
 *
 * A chord progression drawn as a lane-per-chord-name grid IS a real editable
 * surface and counts as one — it parses, serialises, and a delete on a chord
 * lane really does remove that chord. It now also says what it is: the grid
 * asks `chordLanes` and drops its drum chrome when every lane is a chord
 * symbol (#1241). That was a labelling gap, and the same predicate turned out
 * to be what the routing clause above needed too, which is why one exists
 * rather than two.
 */
import type { ChunkInfo } from '../chunkDetect'
import { parsePianoRoll, parseStepGrid } from '../notation/parse'
import { chordLanes } from './chordLanes'
import { isRollChunk, patternKind, type PatternKind } from '../patternKind'

/** A decided surface. `routeSurface` always reaches one, so it never returns null. */
export type Surface = Exclude<PatternKind, null>

/**
 * Which surface a mini string belongs to, given the head that carries it.
 *
 * Exported so the coverage harness scores exactly what the panel mounts — a
 * second copy of a routing rule answers confidently and diverges silently.
 */
export function routeSurface(headFn: string | null, mini: string): Surface {
  if (headFn === 's' || headFn === 'sound') return 'step'
  if (headFn === 'note' || headFn === 'n') return memoised(headFn, mini, rollUnlessChordChart)
  // The head is silent — ask the surface that can discriminate word patterns.
  // `step` here means "the grid is the right place to ASK", not "the grid will
  // open": it declines numerics itself, and a pattern both refuse (`"bd 3 hh"`)
  // correctly ends up with no editor and a named gate.
  const roll = parsePianoRoll(mini)
  if (roll.ok) return 'roll'
  // A roll that can only SHOW the pattern (#1975) takes it when the grid cannot edit
  // it either — the roll read these values as pitches, which is the discrimination
  // this arm exists for. An editable grid still wins, exactly as before: look-only
  // never takes a pattern away from a surface that can edit it.
  if (roll.lookOnly && !parseStepGrid(mini).ok) return 'roll'
  return 'step'
}

/**
 * The answers already computed, keyed on the two arguments that decide one.
 *
 * ⚠ THIS IS A COST FIX AND IT IS NOT OPTIONAL. Before #1243 a melodic head
 * answered by comparing a string — measured at 0.1us — and it now has to PARSE,
 * because "did the roll decline, and on what" is not answerable any other way.
 * Measured per call on this machine: 104us for `c3 e3 g3`, 255us for a four
 * chord chart, and **2542us for `<c4 e4 g4 b4> <d4 f4 a4> e4 [g4 a4]`**. Three
 * components ask per render — the panel that routes, and each grid deciding
 * whether it is eligible — so an unmemoised melodic route spends more than half
 * a frame budget on a question whose answer cannot have changed.
 *
 * Sound because `routeSurface` is pure in its two arguments: the parsers it
 * calls read nothing but the mini string. Capped rather than unbounded, and
 * cleared wholesale at the cap — an LRU here would be more machinery than the
 * hit rate justifies, since in practice every entry is the chunk under the
 * cursor and its neighbours.
 *
 * ⚠ NOTHING GATES THIS. A memo's only symptom is WORK, and work leaves models,
 * bytes and verdicts identical — every arm in this file passes with the cache
 * removed, and a timing assertion here would be flaky. Stated rather than
 * guarded, which is the same call #1237 reached at the same seam; the honest
 * instrument if it ever needs one is an invocation COUNT, not a clock.
 */
const CACHE_CAP = 32
const routed = new Map<string, Surface>()

function memoised(headFn: string, mini: string, compute: (mini: string) => Surface): Surface {
  const key = `${headFn}\u0000${mini}`
  const hit = routed.get(key)
  if (hit !== undefined) return hit
  const answer = compute(mini)
  if (routed.size >= CACHE_CAP) routed.clear()
  routed.set(key, answer)
  return answer
}

/**
 * A melodic head keeps its roll — unless the roll declines on VOCABULARY and
 * what it declined is a chord chart (#1243).
 *
 * ── WHY THE GATE IS CHECKED AND NOT JUST THE REFUSAL ─────────────────────
 * "The head's own surface declined, so ask the other one" is the tempting rule
 * and it is wrong. Measured over 207 documents, twelve `note`/`n` units are
 * declined by the roll while the grid would accept, and only five of those are
 * declined on CONTENT. The other seven are capacity refusals — `unstable-period`,
 * `note-crosses-bar` — where the grid accepting means it asks LESS, not that it
 * is the right editor. Falling through on those draws melodies as drum grids.
 * So only `wrong-surface` is eligible: the roll saying "these values are not
 * mine" is a routing fact, and every other gate is the roll saying "these are
 * mine and I cannot draw them", which is code's answer, not the grid's.
 *
 * ── AND WHY THE CONTENT IS ASKED AFTER THAT ──────────────────────────────
 * Of those five, only one is a chord chart. The rest are melodies the roll
 * refuses over a stray token (`p1`, `p7`, `a3:0.7`), and the grid would draw
 * them as one lane per note — a clean diagonal, the right SHAPE and the wrong
 * KIND, which no fidelity gate downstream can tell from a real drum grid
 * (#1244). `chordLanes` is what separates the case the musician meant from the
 * case that merely parses.
 */
function rollUnlessChordChart(mini: string): Surface {
  const roll = parsePianoRoll(mini)
  if (roll.ok || roll.gate !== 'wrong-surface') return 'roll'
  const grid = parseStepGrid(mini)
  return grid.ok && chordLanes(grid.model.lanes.map((l) => l.sound)) ? 'step' : 'roll'
}

/**
 * The surface for a chunk, or null when it has no editable content.
 *
 * Head-routed chunks answer exactly as they always did. A chunk whose span the
 * RESOLVER named is the new case: pre-#1240 a mini string on a non-content head
 * could not exist, so `patternKind` returned null and the user got code.
 *
 * Scoped to `miniVia === 'resolver'` deliberately. A head-call literal on a
 * non-content head (`lpf("0 1 2")`) has always landed in standby, and moving it
 * is a separate decision with its own measurement — this is the wiring of
 * admission, not a re-route of everything that owns a string.
 */
export function chunkSurface(chunk: ChunkInfo | null): PatternKind {
  if (!chunk || chunk.miniString === null) return patternKind(chunk)
  // A `.struct` rhythm line is hits and rests whatever the track plays (#2120). It is
  // decided here and not in `patternKind`, which the mixer reads as the track's kind.
  if (chunk.structRhythm) return 'step'
  // WHETHER to ask is still the head's question plus the resolver scoping; WHICH
  // surface is `routeSurface`'s, for every chunk we ask about. It used to short
  // out here and return `patternKind`'s answer directly for a content head,
  // which was harmless while the two agreed by construction and stopped being so
  // the moment a melodic head could route to the grid (#1243). One decision, one
  // expression of it — the same property #1250 had to restore one layer down.
  if (!patternKind(chunk) && chunk.miniVia !== 'resolver') return null
  return routeSurface(chunk.headFn, chunk.miniString)
}

/**
 * Does this chunk belong to the step grid / to the piano roll?
 *
 * ⚠ THESE EXIST BECAUSE ONE DECISION WAS DERIVED TWICE, AND THE SECOND
 * DERIVATION QUIETLY WON (#1250). `PatternPanel` routed with `chunkSurface`
 * above — content-aware since #1240 — and then each grid re-decided with the
 * HEAD-ONLY `isStepChunk`/`isRollChunk`. For every silent head the panel mounted
 * the right grid and `useGridModel` immediately nulled the model, so the surface
 * half of #1240 reached no user: the page rendered "Click a drum pattern to edit
 * it as a step grid" to someone already sitting on one.
 *
 * Both sides were tested and the SEAM was not — `chunkSurface`'s only production
 * caller is `PatternPanel`, which no vitest arm mounts, and the coverage harness
 * calls `routeSurface` directly. It is also why #1240's break B5 reddened
 * nothing: the resolver scoping cannot matter while the grid refuses these
 * patterns regardless.
 *
 * So the grids ask the SAME function the panel routed with. Two derivations of
 * one decision is the defect; a second predicate that merely agrees today would
 * reintroduce it. `isStepChunk`/`isRollChunk` stay for the callers that really do
 * want the head alone (the mixer strip, sound assignment).
 *
 * No behaviour change for a literal chunk: `s("bd sd")` answers `step` either
 * way, and a literal on a silent head (`lpf("0 1 2")`) is excluded by
 * `chunkSurface`'s `miniVia` scoping exactly as `isStepChunk` excluded it. The
 * delta is precisely the resolver-named silent-head population.
 */
export function opensStepGrid(chunk: ChunkInfo): boolean {
  return chunkSurface(chunk) === 'step'
}

/** Sibling of `opensStepGrid` — see its header for why these exist. */
export function opensPianoRoll(chunk: ChunkInfo): boolean {
  return chunkSurface(chunk) === 'roll'
}

/**
 * The column shape of the roll under the cursor, read straight off its mini (no model
 * state, a pure parse), or null when it isn't a grid-editable melody (#432, #1942). The
 * Pattern inspector's Snap picker turns it into steps per bar to grey out divisions the
 * roll can't snap to.
 */
export function rollShape(
  chunk: ChunkInfo | null,
): { steps: number; bars?: number; barSteps?: readonly number[] } | null {
  if (!chunk || chunk.miniString === null || !isRollChunk(chunk)) return null
  const parsed = parsePianoRoll(chunk.miniString)
  if (!parsed.ok) return null
  const { steps, bars, barSteps } = parsed.model
  return { steps, bars, barSteps }
}
