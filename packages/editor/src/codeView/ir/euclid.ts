/**
 * euclid — the euclidean-rhythm distribution + rotation, sourced from
 * `@strudel/core` (the same functions `.euclid()` runs), so what the timeline
 * draws cannot disagree with what the audio plays. It is not ours to compute.
 *
 * This was a hand-rolled transcription in `parseMini` until #907, and it was
 * WRONG: it disagreed with the original on 44 of 152 (k,n) pairs to n=16, so
 * the timeline drew a rhythm the audio never played. It survived three months
 * because `bd(3,8)` — the canonical example — is one of the cases it got right.
 *
 * The two euclid helpers (this one and `codeView/notation/parse.ts`) were
 * duplicated until #943 unified them here — the IR grammar and the notation
 * grid/roll now share ONE distribution authority. The notation copy's guard
 * that shadowed inversion (#917) is the reason a single home matters: a copy —
 * or a guard over a copy — is correct the day it is written and free to drift.
 */
import { bjorklund as strudelBjorklund } from '@strudel/core/euclid.mjs'

/**
 * Distribute `k` pulses over `n` steps. Returns a boolean mask of length `n`
 * (true = onset). The distribution itself is Strudel's; we only hold the
 * degenerate ends it CANNOT compute (`|k| >= n`, where upstream's `n - |k|`
 * goes negative and it throws).
 *
 * A NEGATIVE `k` with `|k| < n` IS NOT EMPTY — it is Strudel's INVERSION
 * (`euclid.mjs`): `(-1,3)` plays the 2 steps a euclid 1 leaves out (#917). It
 * must reach the authority, not a guard standing in front of it. Only `k === 0`
 * is truly empty.
 */
export const bjorklund = (k: number, n: number): boolean[] => {
  if (n <= 0) return []
  if (k === 0) return Array(n).fill(false) as boolean[]
  // |k| >= n: the only ends upstream throws on. k >= n → every step on;
  // -k with |k| >= n → every step off (invert "every step").
  if (Math.abs(k) >= n) return Array(n).fill(k > 0) as boolean[]
  return strudelBjorklund(k, n).map((x) => x === 1)
}

/**
 * Rotate a euclid mask to match Strudel's `_euclidRot`, so an unedited
 * `atom(k,n,rot)` draws exactly the cells the audio plays. Strudel applies
 * `rotate(b, -rot)` where `rotate` left-rotates — i.e. a *right* rotation by
 * `rot`. (Source: `@strudel/core` euclid.mjs `_euclidRot` → util.mjs `rotate`.)
 */
export const rotateEuclid = (pattern: boolean[], rot: number): boolean[] => {
  const n = pattern.length
  if (n === 0) return pattern
  const k = (((-rot) % n) + n) % n
  return pattern.slice(k).concat(pattern.slice(0, k))
}
