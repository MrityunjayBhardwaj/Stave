/**
 * resolveMiniSource — "which document span carries this unit's note content?"
 *
 * INERT: nothing routes through this yet. It is built and gated first, then
 * consumed — the same shape `structuralWalk` shipped in.
 *
 * ONE disposal rule, TWO proposers:
 *
 *   eval  — the located haps the transpiler declared (`admitProposals`). Crosses
 *           bindings, chained transforms, `pick`, `voicing` and every other
 *           combinator without our modelling any of them, because the engine
 *           already did. This is the whole point: four "features" (bound
 *           references, chained arguments, root position, head routing) are one
 *           question the engine answers for free.
 *   parse — every mini literal the AST can see (`SpanIndex.literals`). The
 *           non-evaluating fallback: a document mid-keystroke, one that does not
 *           evaluate in this environment, or a single-quoted mini (which has no
 *           document-space hap location at all, so eval can never offer one).
 *
 * Both feed the SAME structural disposal (`spanRole.ts`), so there is no second
 * rule to diverge. The proposer only changes which spans get asked about.
 */
import type { ChunkInfo } from '../chunkDetect'
import { SpanIndex, literalInterior } from './spanRole'
import type { MiniSourceResult, Span, SpanProposal } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const within = (inner: Span, outer: Span) => inner[0] >= outer[0] && inner[1] <= outer[1]

export interface ResolveOptions {
  /**
   * Candidate spans from evaluation, already admitted through
   * `meta.miniLocations`. Omit (or pass an empty array) to take the
   * non-evaluating parse walk.
   */
  proposals?: SpanProposal[]
  /** Reuse a prebuilt index when resolving many units of one document. */
  index?: SpanIndex | null
}

/**
 * Resolve the note-content span of `unit` inside `doc`.
 *
 * The result's `range` is the mini string's INTERIOR (quotes excluded) — the
 * anchor a byte-surgery edit writes to. It may lie in a DIFFERENT top-level
 * statement than the unit (a bound reference names its content elsewhere);
 * `crossesBinding` says so rather than leaving the caller to discover it.
 */
export function resolveMiniSource(
  doc: string,
  unit: ChunkInfo,
  opts: ResolveOptions = {},
): MiniSourceResult {
  const index = opts.index !== undefined ? opts.index : SpanIndex.build(doc)
  if (!index) return { ok: false, reason: 'doc-unparsed' }

  // ATTRIBUTION — a span belongs to this unit when it lies inside the unit's own
  // expression, or inside the initialiser of a binding the unit references
  // (transitively). Containment, never overlap: an overlap test credits a
  // neighbouring statement's span to whichever unit happens to touch it.
  const reachable = index.reachableRanges(unit.exprRange)

  // EVAL FIRST, then the parse walk. Eval's silence about a unit is real
  // information — a bare pattern statement that is not the document's last one
  // never sounds (the transpiler returns only the last statement), so it has no
  // located hap — but it is not a reason to withhold an edit anchor from code
  // that plainly has one. The fallback is per UNIT rather than per document, and
  // the result says which proposer answered so a caller can tell the two apart.
  const evalFirst = opts.proposals?.length ? attempt(doc, index, reachable, unit, opts.proposals) : null
  if (evalFirst?.ok) return evalFirst
  const walk = attempt(
    doc,
    index,
    reachable,
    unit,
    index.literals.map((lit): SpanProposal => ({ span: literalInterior(lit), via: 'parse' })),
  )
  return walk.ok ? walk : (evalFirst ?? walk)
}

function attempt(
  doc: string,
  index: SpanIndex,
  reachable: Span[],
  unit: ChunkInfo,
  proposals: SpanProposal[],
): MiniSourceResult {
  const via = proposals[0]?.via ?? 'parse'
  const mine = proposals.filter((p) => reachable.some((r) => within(p.span, r)))
  if (mine.length === 0) return { ok: false, reason: 'no-candidate' }

  // DISPOSAL — group the surviving spans by the literal that encloses them, so
  // the answer is the mini STRING (the edit anchor), not one atom inside it.
  const groups = new Map<any, { lit: any; spans: Span[] }>()
  for (const p of mine) {
    if (index.roleOfSpan(p.span, reachable) !== 'source') continue
    const lit = index.literalFor(p.span)
    if (!lit) continue
    const g = groups.get(lit)
    if (g) g.spans.push(p.span)
    else groups.set(lit, { lit, spans: [p.span] })
  }
  if (groups.size === 0) return { ok: false, reason: 'no-source-span' }

  // Most-evidence first: the literal the most admitted spans landed in is the
  // one the unit actually plays. Ties break on source order so the result is
  // stable for a given document.
  const ranked = [...groups.values()].sort(
    (a, b) => b.spans.length - a.spans.length || a.lit.start - b.lit.start,
  )
  const best = ranked[0]
  const range = literalInterior(best.lit)
  return {
    ok: true,
    via,
    range,
    text: doc.slice(range[0], range[1]),
    spans: best.spans,
    alternatives: ranked.slice(1).map((g) => literalInterior(g.lit)),
    crossesBinding: !within(range, unit.exprRange),
  }
}
