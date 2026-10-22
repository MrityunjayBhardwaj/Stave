/**
 * The automation lane's BOUNDS CAPTION — its text, its geometry, and what a
 * pointer landing on it has hit (#1464 Stage 2).
 *
 * A caption reads `cutoff 200→2000`, drawn in its own curve's colour at the
 * top-left of an expanded lane's band. It exists because the range leg is
 * INVISIBLE in the curve: every curve is normalised to its own range, so
 * `.range(0.4,0.6)` and `.range(0,1)` draw an identical wave. A DAW labels the
 * lane's axis instead of rescaling the curve, and this is that label.
 *
 * Stage 2 makes those numbers editable, which is why the layout moved out of
 * `drawTimeline` and into here. ⚠ THE DRAW PATH AND THE HIT-TEST MUST SHARE ONE
 * GEOMETRY — the same rule `laneMarkBands` already holds the live overlay to
 * (PV120), and for the same reason: two copies of "where is the `lo` number"
 * drift apart under any change to the text, and the drift is silent. A click
 * lands one glyph off and edits the wrong bound.
 *
 * This module is pure. It measures nothing itself: callers pass a `measure`
 * function, so the draw path can use its own canvas context and a hit-test can
 * use another, while the field arithmetic stays in one place.
 *
 * WHAT A FIELD WRITES IS NOT HERE (#1886). Turning a typed bound, a typed rate or a
 * chosen shape into a source edit is the editor's `captionEdit` / `shapeEdit`
 * (`codeView/automation/captionEdit`): this file says where a field is and what it
 * reads, and never which bytes of the document change.
 */
import type { CaptionFieldKind, SignalAutomation, SignalKind } from '@stave/editor'

/** 9px monospace, matching the rest of the lane's small type. */
export const AUTOMATION_LABEL_FONT = '9px ui-monospace, SFMono-Regular, Menlo, monospace'

/** Below this band height a curve cannot read as a shape rather than as a thick
 *  line, so the lane draws none — and, since #1495, no caption either.
 *
 *  ⚠ ONE FLOOR, NOT TWO. The caption used to abstain at its own higher
 *  threshold (22px — two line advances, chosen for the stacked case). Between
 *  the two floors sat a band where the CURVE WAS DRAWN AND ITS BOUNDS WERE NOT,
 *  and the bounds are the whole of what says BETWEEN WHICH VALUES the sweep
 *  runs, because every curve is normalised to its own range. A single-voice
 *  PERCUSSIVE lane lands exactly there at the default density (a 25px row is a
 *  19px band), so the commonest automated document there is — one drum track
 *  with a swept filter — drew a curve nobody could read, and since #1464
 *  Stage 2 could not edit either. The rule is now: WHATEVER IS DRAWN IS
 *  LABELLED. Raising this floor again without raising the curve's would reopen
 *  the same gap, which is why there is only one constant to raise. */
export const AUTOMATION_MIN_BAND_H = 10

/** Line advance between stacked captions. */
export const AUTOMATION_LABEL_LINE_H = 11

/** Cap height of the 9px face — the clickable height of one caption line. */
export const AUTOMATION_LABEL_TEXT_H = 10

/** Which leg of the automation a caption field names — the editor's, since it is
 *  what `captionEdit` is asked to write (`param` is the shape menu's anchor, never typed). */
export type { CaptionFieldKind }

export interface CaptionField {
  readonly kind: CaptionFieldKind
  /** The text of this field alone — what an editor opens with. */
  readonly text: string
  /** Character offsets within the caption line. Positions come from measuring
   *  `line.slice(0, from)` and `line.slice(0, to)`, never from a per-glyph
   *  width, so a proportional fallback face still lands correctly. */
  readonly from: number
  readonly to: number
}

/** The editor's `rateEditable` — see {@link captionRows}. */
export type RateEditable = (a: SignalAutomation) => boolean

export interface CaptionRow {
  readonly automation: SignalAutomation
  /** The whole line as drawn. */
  readonly text: string
  /** Top of this line in canvas Y. */
  readonly y: number
  readonly fields: readonly CaptionField[]
}

export interface CaptionHit {
  readonly row: CaptionRow
  readonly field: CaptionField
  /** The field's screen box, so a caller can place an input exactly over it. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** Inset from the lane's left edge to the caption's first glyph — the same
 *  inset a clip caption uses, so the two read as one column. */
export const CAPTION_PAD_X = 4

/** The automation band's inset from the lane's top and bottom edge — and so
 *  also the first caption line's top inset. ONE constant rather than two that
 *  must agree: `drawTimeline` imports this for the band it paints, because a
 *  band and a caption that disagreed about the padding would put the text
 *  outside the thing it labels. */
export const AUTOMATION_PAD_Y = 3

/** Where a lane's automation is painted: the band's own top, and its height. */
export interface AutomationBand {
  readonly top: number
  readonly height: number
}

/**
 * The band `rowHeight` leaves for automation, or null when it is under the floor
 * and nothing may be painted.
 *
 * ⚠ ONE DERIVATION, NOT SIX (#1498). The inset model — `padY` off BOTH edges —
 * used to be spelled out at every site that needed it: the caption rows, the
 * curve, the staircase, and the three stepped-lane helpers. They agreed only
 * because the expression happened to be copied correctly. The moment the model
 * stops being symmetric (a header line, a different top inset, a per-lane pad),
 * a site that kept the old arithmetic paints a curve where the hit-test believes
 * there is no band — a click that quietly does nothing, or a caption over empty
 * space. `AUTOMATION_PAD_Y` was already single-sourced; this is the arithmetic
 * around it, so the model now has exactly one home.
 *
 * `padY` and `minBandH` are arguments rather than constants read here because a
 * stepped lane's `StepBand` carries its own pair, but every caller in the app
 * passes the constants above. {@link automationBandHeight} is the same model
 * WITHOUT the floor, for the two step helpers that never gated on it — sharing
 * the arithmetic must not hand either of them a floor it did not have.
 */
export function automationBandHeight(rowHeight: number, padY: number = AUTOMATION_PAD_Y): number {
  return rowHeight - padY * 2
}

/** The inverse: the row height that leaves `bandHeight` after the inset. Used
 *  where a minimum BAND height has to be stated as a minimum ROW height — the
 *  same model read backwards, so it cannot drift from it (#1498). */
export function rowHeightForBandHeight(bandHeight: number, padY: number = AUTOMATION_PAD_Y): number {
  return bandHeight + padY * 2
}

export function automationBand(
  top: number,
  rowHeight: number,
  padY: number = AUTOMATION_PAD_Y,
  minBandH: number = AUTOMATION_MIN_BAND_H,
): AutomationBand | null {
  const height = automationBandHeight(rowHeight, padY)
  if (height < minBandH) return null
  return { top: top + padY, height }
}

/**
 * Format a bound for display.
 *
 * ⚠ LOSSY, DELIBERATELY: `0.30001` shows as `0.3`. Committing a displayed
 * string back to the document would therefore silently rewrite the user's
 * number — which is why no caller is asked not to. `captionEdit` is the only
 * way to turn a caption into an edit, it composes from the automation's own
 * NUMBERS rather than from any displayed text, and it returns null when nothing
 * changed. The rounding cannot reach the document through it.
 */
export function formatBound(v: number): string {
  if (!Number.isFinite(v)) return '?'
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1000) / 1000)
}

/** The `~` that marks bounds this code SUPPLIED rather than ones the user wrote: the
 *  signal's natural polarity when no `.range()` is written, and the floor and ceiling
 *  a range PLAYS where they are not its arguments (#1610, `sine2.range(200, 2000)` reads
 *  `~-1600→2000`). The mark is the only warning the reader gets that the numbers beside
 *  it are not the ones in the document. */
export function suppliedMark(a: SignalAutomation): string {
  return a.ranged && a.boundsAsWritten ? '' : '~'
}

/**
 * #1464 Stage 3 — the rate as the caption spells it: the bars one period of the
 * curve spans ON THE LANE, which under a whole-track time change is not the number in
 * the signal's own `.slow()`. `~`-marked when the signal writes no rate of its own,
 * for the bounds' reason. Null when the curve's routes disagree about that number.
 *
 * ⚠ The `~` reads `periodCycles === 1` as "no rate written", the proxy the span
 * census documents: `sine.slow(2).fast(2)` states two rates that compose to 1 and is
 * marked as if it stated none. An inserted `.slow(P)` still gives it the typed period,
 * because a rate appended to a chain multiplies what is already there.
 */
function rateText(a: SignalAutomation): { mark: string; bars: string; unit: string } | null {
  const p = a.lanePeriodCycles
  if (p === null) return null
  return {
    mark: a.spans.rate === null && a.periodCycles === 1 ? '~' : '',
    bars: formatBound(p),
    unit: p === 1 ? 'bar' : 'bars',
  }
}

/** The caption line for one automation, exactly as drawn. */
export function captionText(a: SignalAutomation): string {
  const bounds = `${a.paramKey} ${suppliedMark(a)}${formatBound(a.lo)}→${formatBound(a.hi)}`
  const rate = rateText(a)
  return rate ? `${bounds} ${rate.mark}${rate.bars} ${rate.unit}` : bounds
}

/**
 * Lay out one lane's captions: which lines are drawn, where, and which spans of
 * each line name which leg.
 *
 * Returns empty for a collapsed lane, a band too short to DRAW, or a lane with
 * no automation — the same three abstentions the draw path already made, kept
 * here so the hit-test cannot believe in a caption that was never painted.
 *
 * `rateEditable` is the editor's rule for whether a typed rate has somewhere to go
 * (#1886 — the same function its `captionEdit` enforces, handed in rather than
 * imported so this module stays type-only on `@stave/editor`). The FIELDS exist for
 * the hit-test: the draw path reads each row's text and position only, passes
 * nothing, and gets no rate field — the line it paints is the same either way.
 */
export function captionRows(
  automations: readonly SignalAutomation[],
  top: number,
  rowHeight: number,
  expanded: boolean,
  rateEditable?: RateEditable,
): readonly CaptionRow[] {
  if (!expanded || automations.length === 0) return []
  const band = automationBand(top, rowHeight)
  if (!band) return []

  const rows: CaptionRow[] = []
  let y = band.top
  for (const a of automations) {
    // The draw loop stops when the next line would overflow the row; stopping on
    // the same condition is what keeps the two in step.
    if (y + AUTOMATION_LABEL_TEXT_H > top + rowHeight) break

    const name = a.paramKey
    const mark = suppliedMark(a)
    const lo = formatBound(a.lo)
    const hi = formatBound(a.hi)
    const bounds = `${name} ${mark}${lo}→${hi}`

    const loFrom = name.length + 1 + mark.length
    const loTo = loFrom + lo.length
    const hiFrom = loTo + 1 // the arrow is one character
    const hiTo = hiFrom + hi.length
    const fields: CaptionField[] = [{ kind: 'param', text: name, from: 0, to: name.length }]
    // #1610 — only where a typed bound reads back as typed. Elsewhere the numbers are
    // shown and no field is offered over them, as with two composing rates.
    if (a.boundsAsWritten) {
      fields.push({ kind: 'lo', text: lo, from: loFrom, to: loTo }, { kind: 'hi', text: hi, from: hiFrom, to: hiTo })
    }

    // #1464 Stage 3 — ` ~4 bars`. The number alone is the field, as a bound's is, and
    // only where a typed number can be written (the editor's `rateEditable`).
    let text = bounds
    const rate = rateText(a)
    if (rate) {
      text = `${bounds} ${rate.mark}${rate.bars} ${rate.unit}`
      const rateFrom = bounds.length + 1 + rate.mark.length
      if (rateEditable?.(a)) fields.push({ kind: 'rate', text: rate.bars, from: rateFrom, to: rateFrom + rate.bars.length })
    }

    rows.push({ automation: a, text, y, fields })
    y += AUTOMATION_LABEL_LINE_H
  }
  return rows
}

/**
 * Which caption field, if any, is under a point.
 *
 * `measure` is the caller's text measurer for `AUTOMATION_LABEL_FONT`. Passing
 * it in rather than measuring here is what lets the draw path and the hit-test
 * share this arithmetic without this module owning a canvas.
 */
export function captionHit(
  rows: readonly CaptionRow[],
  x: number,
  y: number,
  measure: (text: string) => number,
): CaptionHit | null {
  for (const row of rows) {
    if (y < row.y || y >= row.y + AUTOMATION_LABEL_TEXT_H) continue
    for (const field of row.fields) {
      const left = CAPTION_PAD_X + measure(row.text.slice(0, field.from))
      const right = CAPTION_PAD_X + measure(row.text.slice(0, field.to))
      if (x >= left && x < right) {
        return {
          row,
          field,
          box: { x: left, y: row.y, w: right - left, h: AUTOMATION_LABEL_TEXT_H },
        }
      }
    }
  }
  return null
}

/** The editor's `shapeAlternatives`, injected so this module stays type-only on
 *  `@stave/editor` (the app's tests hand it in from source). */
export type ShapeAlternatives = (kind: SignalKind) => readonly SignalKind[]

/** The two editor readers a shape menu offers from, injected for the same reason: the
 *  same-class shapes (#1464) and the cross-class ones (#1611, `crossClassShapes`). */
export interface ShapeDeps {
  readonly alternatives: ShapeAlternatives
  readonly crossClass: ShapeAlternatives
}

/**
 * #1611 — what the menu knows about the song after a swap across classes: still being
 * measured, or measured — the bars one pass lasts, or null for no loop.
 *
 * ONE preview serves every cross-class shape on the menu. Every noise shape comes back at
 * the same span (300 of its own cycles — the editor's `NOISE_SEED_CYCLES`), and every
 * waveform at its rate, which a swap leaves untouched — so each side gives one song, and
 * the menu asks once, for the first.
 */
export type SwapPreview =
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly cycles: number | null }

/** One shape the menu offers. */
export interface ShapeOption {
  readonly kind: SignalKind
  /** `perlin · song repeats every 4 bars (was 16)` — the shape, then what it does. */
  readonly label: string
  /** A cross-class shape whose song length is still being measured. */
  readonly disabled: boolean
}

const barsText = (n: number): string => `${n} ${n === 1 ? 'bar' : 'bars'}`

/**
 * #1611 — the menu's options, each labelled with what choosing it does to the song.
 *
 * Same-class shapes change nothing about the length and are named bare. Cross-class
 * shapes are offered only with a preview (`null` → none offered: an owner that cannot
 * measure the song cannot say what the swap does to it), and cannot be chosen while it
 * is measuring — the step-count chip's rule, that the length is said BEFORE the write.
 * `was` is the song's length now, read the same way (`songLoopCycles`).
 */
export function shapeMenuOptions(
  a: SignalAutomation,
  deps: ShapeDeps,
  preview: SwapPreview | null,
  was: number | null,
): readonly ShapeOption[] {
  if (a.spans.shape === null) return []
  const same = deps.alternatives(a.kind).map((kind) => ({ kind, label: kind, disabled: false }))
  if (preview === null) return same
  const note =
    preview.state === 'pending'
      ? 'measuring song length…'
      : preview.cycles === null
        ? 'song length unknown'
        : preview.cycles === was
          ? 'same song length'
          : `song repeats every ${barsText(preview.cycles)}${was === null ? '' : ` (was ${was})`}`
  const across = deps.crossClass(a.kind).map((kind) => ({
    kind,
    label: `${kind} · ${note}`,
    disabled: preview.state === 'pending',
  }))
  return [...same, ...across]
}
