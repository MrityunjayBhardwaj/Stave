/**
 * miniSource — resolve "which document span carries this unit's note content".
 *
 * The types are shared by the two proposers (evaluation, and the non-evaluating
 * parse walk) and by the single disposal rule both feed.
 */

/** A document-space half-open span `[start, end)`. */
export type Span = [number, number]

/**
 * What a span is, structurally, in the expression it sits in.
 *
 * `source`   — the pattern SOURCE: the content the unit plays.
 * `argument` — a control's ARGUMENT: a timbre, a bank, a scale, a room size.
 * `unknown`  — no enclosing string literal, or a position the rule does not
 *              claim to judge. Never treated as content.
 *
 * The distinction is POSITION, never a vocabulary of head names: `s("bd sd")`
 * as a head call is content and `.s("piano")` after a pattern source is timbre,
 * and no name can tell those apart.
 */
export type SpanRole = 'source' | 'argument' | 'unknown'

/** A candidate span, plus where it came from. */
export interface SpanProposal {
  span: Span
  /** `eval` — a hap location the transpiler declared; `parse` — a literal the AST enumerated. */
  via: 'eval' | 'parse'
}

export type MiniSourceRefusal =
  /** the document does not parse — no AST, so nothing can be disposed */
  | 'doc-unparsed'
  /** no proposed span lies inside this unit (or a binding it references) */
  | 'no-candidate'
  /** every span attributed to the unit is a control's argument, not content */
  | 'no-source-span'

export interface MiniSourceHit {
  ok: true
  via: 'eval' | 'parse'
  /** the mini string's INTERIOR span, quotes excluded — the edit anchor */
  range: Span
  /** `doc.slice(...range)` at resolution time */
  text: string
  /** the admitted source spans inside `range`, in first-seen order */
  spans: Span[]
  /**
   * Other string literals in this unit that also disposed as `source`, best
   * first. Non-empty means the unit has more than one content span and the
   * caller is choosing — P2 must make that visible rather than silently pick.
   */
  alternatives: Span[]
  /**
   * true when `range` lies OUTSIDE the unit's own expression — a bound
   * reference whose write target is a different top-level statement.
   */
  crossesBinding: boolean
}

export interface MiniSourceMiss {
  ok: false
  reason: MiniSourceRefusal
}

export type MiniSourceResult = MiniSourceHit | MiniSourceMiss
