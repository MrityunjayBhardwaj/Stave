/**
 * bareCapture — the ONE decision about what a bare document's captured track is.
 *
 * Strudel picks what to play two ways: with at least one `.p()` it stacks the
 * registered patterns, and with none it plays the document's LAST EXPRESSION.
 * Every per-track map the engine publishes is written inside the `.p()` wrapper,
 * so the second branch produced no captured pattern at all — #1094 hit that on
 * the song frame, #1095 fixed that one map, and #1097 named the rest
 * (`capturedPatterns` → `trackSchedulers`, the analyser side-taps, and the inline
 * `.viz()` request/options).
 *
 * The reason this is a module rather than four guards is that the four maps must
 * agree about WHICH track the bare pattern is. Four hooks each with their own
 * idea of that is how the song frame ended up keyed independently of the strip
 * the mixer draws. One decision, four readers.
 *
 * ── WHY THE ID IS NOT SIMPLY `$0` ────────────────────────────────────────────
 *
 * The mixer builds its strips from the PARSED DOCUMENT (`buildStripModels`) and
 * joins them to the engine by `captureId`, numbering unmuted anonymous tracks
 * `$0…$n` in SOURCE ORDER. A document with two bare statements therefore has
 * strips `$0` and `$1` — but strudel plays only the LAST expression, so the one
 * pattern that exists belongs to `$1`, and writing it at `$0` would light the
 * wrong strip's meter. Measured on the real surface: bare and labelled documents
 * produce the same strips with the same captureIds, and only the labelled one
 * ever moves a meter (`_1097-bare-track-maps.spec.ts`).
 *
 * The answer is the LAST track, because that is the expression strudel plays.
 * A single-track document resolving to `$0` is that same rule at n = 1.
 *
 * ⚠ THIS USED TO REFUSE EVERYTHING BUT THE SINGLE-TRACK CASE (#1097), and the
 * refusal was correct at the time rather than merely cautious. The strips number
 * from the FIRST statement while strudel plays the LAST, so an id was a guess —
 * and the IR then declared exactly one track no matter how many statements the
 * document had, so there was no second lane for a truthful id to name. Writing
 * one would have lit the wrong strip, which is worse than the dark meter it
 * replaced.
 *
 * What changed is the second half of that, not the first. #1096 made the parser
 * declare a Track per top-level statement, so `d<n>` is a lane that exists, and
 * naming the last strip now points at something. The rule did not become braver;
 * the document became describable.
 *
 * The id is POSITIONAL, so it is only meaningful while both sides count the same
 * statements — which is why the head list they classify with is now shared
 * (#1178) rather than duplicated per package.
 *
 * ⚠ LAYERING, and it moved once for a reason worth recording. Both the rule
 * (`bareCaptureIdFor`) and the predicate (`isTrackChunk`) live in `stripModel`,
 * and this module IMPORTS them rather than restating them. They are
 * document-level facts rather than mixer concerns, so the mixer is an odd home
 * — but it is the right one, because the mixer is what ASSIGNS these ids when it
 * numbers its strips. A join key belongs with its assignment; the reader asks.
 *
 * The first version of this module spelled the rule out here instead, alongside
 * an identical copy in `buildStripModels`. They agreed on every document anyone
 * tried. #1174 is what that shape costs when it stops agreeing: a strip joins on
 * a key the engine never wrote, nothing throws, and a meter shows the neighbour's
 * level.
 */
import { detectAllChunks } from '../codeView/chunkDetect'
import { bareCaptureIdFor, isTrackChunk } from '../codeView/mixer/stripModel'

/**
 * The captureId a bare document's played pattern belongs to, or `null` when the
 * document is not an unambiguous single bare track.
 *
 * ⚠ THE DECISION ITSELF LIVES IN `stripModel`, NOT HERE, and the direction is
 * deliberate: the mixer ASSIGNS these ids when it numbers its strips, so the
 * engine has to ask what was assigned rather than re-derive it. This function is
 * the code→chunks adapter and nothing more.
 *
 * It was written the other way first — the same two clauses spelled out on both
 * sides of the join — and they agreed, which is exactly why that shape is worth
 * naming: independently-derived keys agree until one side moves, and the failure
 * then surfaces as a widget that quietly shows nothing (#1174).
 */
export function resolveBareCaptureId(code: string): string | null {
  return bareCaptureIdFor(detectAllChunks(code).filter(isTrackChunk))
}
