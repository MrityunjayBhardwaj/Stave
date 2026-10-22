/**
 * THE map between a control's value and its position on a dial (#1581).
 *
 * A control's value sits somewhere on its range: `gain` 0…1 is linear, `cutoff`
 * 20…20000 is logarithmic (an octave is a fixed distance, not a fixed number of
 * hertz), and a value a gesture writes is spelled on the control's own quantum
 * (`0.01`, `1 Hz`) rather than with whatever float the arithmetic left.
 *
 * Three rules, and this file is the ONLY place any of them is written. Two
 * surfaces turn pointer travel into a value with them — the mixer knob (`Knob`)
 * and the timeline's stepped automation lane (`steppedLane`, in the app package)
 * — and before this file they each spelled all three themselves. Four spellings
 * that agreed today is exactly the state that drifts apart silently: they already
 * differed on when a log map is safe, and the first change to either would have
 * made a step dragged on the lane land on a different number than the same
 * control turned on the knob.
 *
 * Pure — no React, no Monaco, no engine.
 */

/** How a range spreads its values across the dial. */
export type KnobScaleKind = 'linear' | 'log'

/** `pos` held to the dial: 0 is the floor, 1 the ceiling. */
function clamp01(pos: number): number {
  return Math.min(1, Math.max(0, pos))
}

/**
 * Where `value` sits on `min`…`max`, as 0 (floor) … 1 (ceiling).
 *
 * ⚠ CLAMPED, because a value outside the range has no place on the dial. The
 * indicator was always drawn clamped; anchoring a drag anywhere else would let a
 * gesture start from a position the user cannot see.
 *
 * A log map needs a positive floor AND a positive value — `log(0)` is −∞, and a
 * frequency control a document sets to `0` widens its range down to `0`. Either
 * falls back to the linear map rather than drawing an infinity.
 */
export function positionOfValue(
  value: number,
  min: number,
  max: number,
  scale: KnobScaleKind,
): number {
  if (!Number.isFinite(value) || !(max > min)) return 0
  if (scale === 'log' && min > 0 && value > 0) {
    return clamp01(Math.log(value / min) / Math.log(max / min))
  }
  return clamp01((value - min) / (max - min))
}

/**
 * The value at `pos` — `positionOfValue` run backwards.
 *
 * ⚠ THE SAME MAP INVERTED, NOT A SECOND MAP. A drag reads the level under the
 * pointer through this one and every surface draws the result through the
 * forward one; if the two disagreed about the log scale the dial would slide
 * away from the pointer while it moved.
 */
export function valueAtPosition(
  pos: number,
  min: number,
  max: number,
  scale: KnobScaleKind,
): number {
  const t = clamp01(Number.isFinite(pos) ? pos : 0)
  if (scale === 'log' && min > 0 && max > min) return min * Math.pow(max / min, t)
  return min + t * (max - min)
}

/**
 * `value` on the grid of `step`, spelled without float noise.
 *
 * Round to a whole number of quanta, then cut to the quantum's own decimal
 * places: `3 * 0.1` is `0.30000000000000004`, and on these surfaces the number is
 * not just displayed — it is written into the document as text.
 *
 * A step of zero or less has no grid, so the value passes through untouched.
 */
export function snapToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number((Math.round(value / step) * step).toFixed(decimals))
}
