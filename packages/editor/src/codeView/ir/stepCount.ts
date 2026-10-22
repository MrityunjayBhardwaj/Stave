/**
 * Change how many steps a stepped parameter has (#1602).
 *
 * `<a b>` grown to 4 is `<a b a b>`: the steps repeat, so it plays the same and
 * keeps the period. Any other count continues the pattern from its start (`<a b>`
 * to 3 is `<a b a>`) or cuts it from the end, and those change what plays. A cut
 * whose removed steps do not repeat the kept ones deletes values the user wrote,
 * which a caller must confirm first — this module reports it and never asks.
 *
 * ⚠ EACH STEP KEEPS ITS OWN SPELLING. A step's text runs from its number to the
 * next step's number, so `@2`, `!3` and a trailing `_` travel with the step they
 * belong to, and the `<`, `>`, a `/n` after it and the quotes are never touched.
 * Rebuilding steps from their parsed values would normalise `!3` into `@3` — the
 * same sound, a document the user did not write.
 */
import type { SteppedAutomation } from './steppedAutomation'

/** The edit for a new step count, and what it does to the song. */
export interface StepCountEdit {
  /** One edit: from the first step's number to the literal's closing `>`. */
  readonly edit: { readonly range: [number, number]; readonly text: string }
  readonly steps: number
  /** Cycles one pass of the new steps holds — weights and `/n` included — in the
   *  parameter's own time, as `SteppedAutomation.periodCycles` counts it. */
  readonly periodCycles: number
  /** The new steps play exactly what the old ones did, in every cycle. */
  readonly keepsSound: boolean
  /** A step the user wrote is removed, and no kept step repeats it. */
  readonly dropsWritten: boolean
}

/** Two steps hold the same thing: the same number for the same cycles. */
const sameStep = (a: SteppedAutomation['steps'][number], b: SteppedAutomation['steps'][number]): boolean =>
  a.value === b.value && a.weight === b.weight

/**
 * The edit that gives `a` `n` steps, or null for a count that is not a new
 * positive whole number, or a source that no longer spells what was read.
 */
export function stepCountEdit(a: SteppedAutomation, n: number, source: string): StepCountEdit | null {
  const steps = a.steps
  const len = steps.length
  if (!Number.isInteger(n) || n < 1 || n === len || len === 0) return null
  // The source moved under the reading: every number must still be where it was.
  for (const step of steps) {
    const text = source.slice(step.valueSpan.start, step.valueSpan.end)
    if (text === '' || Number(text) !== step.value) return null
  }
  const last = steps[len - 1]
  // Nothing a step can carry after its number (`@2`, `!3`, `_`) contains a `>`, so
  // the first one past the last number closes the alternation.
  const close = source.indexOf('>', last.valueSpan.end)
  if (close < 0) return null
  const texts = steps.map((step, i) =>
    source.slice(step.valueSpan.start, i + 1 < len ? steps[i + 1].valueSpan.start : close).trimEnd(),
  )
  const next = Array.from({ length: n }, (_, i) => i % len)
  const dropsWritten = n < len && steps.slice(n).some((step, k) => !sameStep(step, steps[(n + k) % n]))
  const keepsSound = n > len ? n % len === 0 : len % n === 0 && !dropsWritten
  return {
    edit: { range: [steps[0].valueSpan.start, close], text: next.map((i) => texts[i]).join(' ') },
    steps: n,
    periodCycles: next.reduce((sum, i) => sum + steps[i].weight, 0),
    keepsSound,
    dropsWritten,
  }
}
