/**
 * What an automation lane's caption WRITES — a typed bound, a typed rate, a chosen
 * shape — as source edits, or as nothing (#1464, moved here by #1886).
 *
 * The caption itself (`cutoff 200→2000 ~4 bars`) is the timeline's: its text, its
 * geometry and its hit-test live in the app's `automationCaption`. This file is the
 * other half — which bytes of the document change, and to what — and it is here
 * because deciding that is code↔view conversion, which belongs to this area and to
 * nowhere else.
 *
 * It takes the automation and the NAME of the field, never a hit: a hit carries a row
 * and a screen box, and nothing in here may depend on where something was drawn.
 *
 * This module is pure.
 */
import {
  shapeAlternatives,
  crossClassShapes,
  type SignalAutomation,
  type SignalKind,
} from '../ir/signalAutomation'
import { parseTypedNumber, type OffsetEdit } from '../writeback'

/** Which leg of the automation a caption field names.
 *
 *  ⚠ `param` IS NOT A TYPED FIELD. It is where the shape menu hangs (#1464),
 *  since the kind has no glyph of its own in the caption, and it is reported so a
 *  caller can tell "on the name" from "on a number". Nothing can be typed into it,
 *  so no text editor may open over it: a field that accepts text and then discards
 *  it is worse than an inert label. `captionEdit` returns null for it; a shape is
 *  written by `shapeEdit`, and only where `shapeOptions` offers one. */
export type CaptionFieldKind = 'param' | 'lo' | 'hi' | 'rate'

/**
 * Whether a typed rate has somewhere honest to go: one spelled rate to replace, or no
 * rate at all and a place to insert one. Two composing rates have neither — the
 * number is shown, and no field is offered over it.
 */
export function rateEditable(a: SignalAutomation): boolean {
  if (a.lanePeriodCycles === null) return false
  if (a.spans.rate !== null) return true
  return a.periodCycles === 1 && a.spans.chainEnd !== null
}

/**
 * Turn "the user typed `nextText` into this caption field" into a source edit,
 * or into NOTHING.
 *
 * ⚠ THIS FUNCTION IS THE ENFORCEMENT, not a comment asking callers to be
 * careful. Three things can only go right because they happen here:
 *
 *  1. THE ROUNDING CANNOT ESCAPE. The untouched bound is written from the
 *     automation's own `lo`/`hi` number, never from the string beside it on
 *     screen — so editing `hi` on a caption reading `0.3→1` cannot quietly
 *     rewrite a `lo` of `0.30001`.
 *  2. AN UNCHANGED FIELD WRITES NOTHING. Re-committing the same value would
 *     otherwise reformat the user's `.range(0.30001,1)` into `.range(0.3,1)`
 *     for free, which is a document edit nobody asked for.
 *  3. A LEG THE DOCUMENT DOES NOT SPELL INSERTS rather than replaces, at the
 *     coordinate the reader supplies. `~pan 0→1` has no `.range()` to overwrite;
 *     the edit appends one. Getting this wrong is not a wrong number, it is a
 *     corrupted expression.
 *
 * Returns null for anything it cannot do honestly: a non-numeric entry, an
 * unchanged value, an inverted or degenerate range, or an automation whose
 * spans give it nowhere to write.
 */
export function captionEdit(a: SignalAutomation, field: CaptionFieldKind, nextText: string): OffsetEdit | null {
  // The parameter name is the shape menu's anchor, not a typed field.
  if (field === 'param') return null
  if (field === 'rate') return rateEdit(a, nextText)
  // #1610 — enforced here, not left to the caption offering no field: on a bipolar
  // signal, or under an inner range that is not 0..1, the typed pair would play another.
  if (!a.boundsAsWritten) return null

  // An empty field is not zero — see `parseTypedNumber`. Caught by its own test.
  const next = parseTypedNumber(nextText)
  if (next === null) return null

  const lo = field === 'lo' ? next : a.lo
  const hi = field === 'hi' ? next : a.hi
  // Unchanged — see (2). Compared as NUMBERS, so `0.30` typed over `0.3` is
  // correctly no edit at all rather than a rewrite.
  if (lo === a.lo && hi === a.hi) return null
  // A range must span something. And it keeps the direction it was written in
  // (#1613): `range(0.7, 0.3)` plays downward (measured) and is drawn so, and a typed
  // bound that crossed the other would silently turn the curve over — most likely a
  // typo. A flat range has no direction yet, so either way widens it.
  if (hi === lo) return null
  if (a.hi !== a.lo && hi > lo !== a.hi > a.lo) return null

  // ⚠ `String`, and DELIBERATELY NOT the house `formatNumber` helper, which
  // exists for drag handlers whose arithmetic produces float noise. There is no
  // arithmetic here: one bound is the number the user just typed and the other
  // is the one already in the document. `formatNumber(0.30001)` is `'0.3'` —
  // running the untouched bound through it would reintroduce exactly the
  // rounding (1) exists to keep out.
  const call = `.range(${String(lo)},${String(hi)})`
  const span = a.spans.range
  if (span) return { range: [span.start, span.end], text: call }

  // See (3): nothing to replace, so append the call to the whole expression.
  const at = a.spans.chainEnd
  if (at === null) return null
  return { range: [at, at], text: call }
}

/**
 * #1464 — the shapes a curve can be switched to: the same-class alternatives, then
 * (#1611) the cross-class ones, or none when the document spells no shape to replace.
 * An empty list means no menu opens, and a press on the name reaches what it always
 * reached.
 */
export function shapeOptions(a: SignalAutomation): readonly SignalKind[] {
  return a.spans.shape === null ? [] : [...shapeAlternatives(a.kind), ...crossClassShapes(a.kind)]
}

/**
 * #1464 — "switch this curve to `next`" as an edit, or nothing. It replaces the
 * signal's identifier and no other byte, so the range and the rate stay as written.
 *
 * ⚠ THE CLASS RULE IS ENFORCED HERE, not left to the menu that calls this. A shape
 * `shapeOptions` does not offer for `a.kind` writes nothing: across polarity it moves
 * the bounds the caption shows (`shapeAlternatives`). Across periodicity it moves the
 * song's length, which is offered (#1611) — but only through the menu, which will not
 * let it be chosen before the length is said.
 *
 * ⚠ AND A DOCUMENT THAT MOVED WRITES NOTHING. The menu captures its automation when it
 * opens; if the bytes at the span no longer spell that shape, the offsets belong to
 * another document and replacing them would corrupt it.
 */
export function shapeEdit(a: SignalAutomation, next: string, source: string): OffsetEdit | null {
  const span = a.spans.shape
  if (span === null) return null
  if (!shapeOptions(a).some((k) => k === next)) return null
  if (source.slice(span.start, span.end) !== a.kind) return null
  return { range: [span.start, span.end], text: next }
}

/** The most significant digits a written rate may carry — `0.25` and `1.5` pass,
 *  `0.6666666666666666` (2 bars under a whole-track `.slow(3)`) does not. */
const RATE_DIGITS = 6

/**
 * #1464 Stage 3 — "the user typed `nextText` bars into the rate field" as an edit, or
 * nothing. The same three rules as the bounds, for the same reasons: nothing typed
 * is not zero, an unchanged number writes nothing, and an unspelled rate inserts.
 *
 * The typed number is the period ON THE LANE; what is written is the signal's own,
 * with the route's whole-track time changes divided back out. A speed-up by a whole
 * number is written `.fast(n)` and anything else `.slow(P)` — the engine plays
 * `.fast(2)` and `.slow(0.5)` identically (probe), and each is what a person writes.
 *
 * ⚠ IT WRITES ONLY WHAT READS BACK AS TYPED. A number that needs more than
 * `RATE_DIGITS` significant digits, or whose period times the route's scale is not
 * exactly the typed bars, writes nothing: a rate the document cannot spell exactly is
 * a rate the lane would show differently the moment it re-reads.
 */
function rateEdit(a: SignalAutomation, nextText: string): OffsetEdit | null {
  const shown = a.lanePeriodCycles
  if (shown === null || !rateEditable(a)) return null
  const bars = parseTypedNumber(nextText)
  if (bars === null || bars <= 0 || bars === shown) return null

  // What the route's time changes multiply the signal's own period by.
  const scale = shown / a.periodCycles
  const own = bars / scale
  const speedUp = own < 1 && Number.isInteger(1 / own)
  const n = speedUp ? 1 / own : own
  if (Number(n.toPrecision(RATE_DIGITS)) !== n) return null
  if ((speedUp ? 1 / n : n) * scale !== bars) return null
  const call = speedUp ? `.fast(${String(n)})` : `.slow(${String(n)})`

  const span = a.spans.rate
  if (span) return { range: [span.start, span.end], text: call }
  const at = a.spans.chainEnd
  if (at === null) return null
  return { range: [at, at], text: call }
}
