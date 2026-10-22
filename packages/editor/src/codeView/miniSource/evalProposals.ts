/**
 * evalProposals — the PROPOSE half of "eval proposes, AST disposes".
 *
 * Evaluation already answers "which span carries this value": every mini atom is
 * born as `strudel.pure(value).withLoc(from, to)`, so the span rides the hap. We
 * never ask which value a location produced — that pairing is bound once at the
 * atom and destroyed by three `concat`s inside core, so recovering it means
 * forking `@strudel/core` and deriving the ORDER means re-implementing Strudel.
 * We only want the CANDIDATES; the AST disposes of them.
 *
 * Two rules make the candidates trustworthy, and neither is optional.
 *
 * ── 1. ADMISSION: only spans the TRANSPILER declared ──────────────────────
 * A hap location is in DOCUMENT space only if the transpiler rewrote that
 * string. `miniAllStrings()` points `reify`'s string parser at `mini`, so EVERY
 * string reaching `reify` is mini-parsed and gets a location in its OWN quoted
 * space. Two families never pass the transpiler and therefore return small,
 * plausible, entirely wrong offsets into the same flat array:
 *
 *   - runtime-SYNTHESISED strings — `voicing` renders note names and reifies
 *     each one, so `chord("<Am C>").voicing()` returns `Am`, `C` and a stray
 *     `[1,3)` whose width is the width of the synthesised note name;
 *   - SINGLE-quoted literals — the transpiler rewrites only double-quoted and
 *     template literals, so `note('c4 e4')` returns two bogus spans and NO
 *     correct one, while sounding perfectly.
 *
 * These are not garbage: they are correct offsets in a space nobody declared,
 * and they pass every "is this a plausible span" check. A structural filter
 * cannot remove them — the word `const` is not syntactically an argument — so
 * we do not filter, we ASK. `evaluate()` returns `meta.miniLocations`: the
 * document-space spans the transpiler itself created. Admitting only those
 * removes the class by construction.
 *
 * ── 2. THE QUERY WINDOW IS PART OF THE CONTRACT ───────────────────────────
 * A unit with no haps is indistinguishable from a unit with no location, so
 * "does this unit carry a content span" is only answerable relative to a window
 * that reaches the unit's first SOUNDING cycle. The window scales with the
 * pattern's PERIOD, not with a constant: `<-!32 -!32 …>` rests for 64 cycles
 * before its first note. Measured presence by window over 150 real tunes:
 *
 *     cycles          1      4     16     32     64    128
 *     template-lit  26/47  26/47  35/47  42/47  45/47  47/47
 *     double-quoted 172/272 185   216    228    236    248/272
 *
 * A four-cycle window loses 45% of one class. `QUERY_CYCLES` is where both
 * classes stop improving, and it is stated here rather than chosen inside a
 * probe, because a window bug reads as a syntax bug: long patterns correlate
 * with backtick quoting, so under-windowing looks like "backticks carry no
 * locations".
 */
import type { Span, SpanProposal } from './types'

/**
 * The query window, in cycles, for a location sweep. See the header: presence
 * saturates here for both quoting classes over the real corpus.
 */
export const QUERY_CYCLES = 128

/** What `@strudel/core`'s `evaluate()` hands back, narrowed to what we read. */
export interface EvaluatedDoc {
  /** `meta.miniLocations` — the transpiler's own document-space declarations */
  miniLocations?: Array<[number, number]> | null
  /** every `hap.context.locations` entry seen in the query window */
  locations: Array<{ start: number; end: number }>
}

const key = (s: number, e: number) => `${s}:${e}`

/**
 * Admit the located spans the transpiler declared, drop the rest.
 *
 * Returns them deduped in first-seen order. The dropped count is returned
 * beside them so a caller can report the coordinate-space leak rather than
 * discover it: measured over 150 real tunes it is 39 of 5775 spans (0.7%),
 * concentrated in 22 of 89 evaluating documents.
 */
export function admitProposals(ev: EvaluatedDoc): { proposals: SpanProposal[]; undeclared: Span[] } {
  const declared = new Set<string>()
  for (const [s, e] of ev.miniLocations ?? []) declared.add(key(s, e))

  const proposals: SpanProposal[] = []
  const undeclared: Span[] = []
  const seen = new Set<string>()
  for (const loc of ev.locations) {
    const k = key(loc.start, loc.end)
    if (seen.has(k)) continue
    seen.add(k)
    if (declared.has(k)) proposals.push({ span: [loc.start, loc.end], via: 'eval' })
    else undeclared.push([loc.start, loc.end])
  }
  return { proposals, undeclared }
}
