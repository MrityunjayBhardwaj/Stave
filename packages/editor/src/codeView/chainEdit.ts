/**
 * chainEdit.ts — the WRITE half of a chunk's method chain (#1888), beside the
 * reader `chainMethod.ts`.
 *
 * A control that edits `.name(arg)` on a pattern does one of three things, and
 * the area used to spell each of them once per control:
 *
 *  - set a NUMBER call — replace the literal of the call that plays (the last
 *    one, `chainMethod.playingCall`), append `.name(n)` when the call is absent, and refuse (null) when the argument is not a plain number: a
 *    signal or an expression is somebody's code, not a dial position;
 *  - set a STRING call — replace the string argument in place, else append;
 *  - REMOVE a call — by its range, members only: the head pattern is never
 *    deleted.
 *
 * Those three are the first half of this file. The second half is what the mixer
 * panel's gestures (knob, dial range, effect toggle, remove, sound pick) write,
 * each standing on them. Every function takes the freshly-detected chunk and
 * returns the one edit to make, or null when nothing may be written; the caller
 * keeps the gesture and the writer and decides nothing about text.
 *
 * This module is pure.
 */
import type { ChainArg, ChainCall, ChunkInfo } from './chunkDetect'
import { formatNumber, type OffsetEdit } from './writeback'
import { playingCall, readChainMethod } from './chainMethod'

// ── the three primitives ─────────────────────────────────────────────────────

/** `.name(arg)` appended at the end of the chunk's expression. Being last, it is
 *  the call that plays. */
export function appendCall(fresh: ChunkInfo, name: string, argText: string): OffsetEdit {
  const end = fresh.exprRange[1]
  return { range: [end, end], text: `.${name}(${argText})` }
}

/** Replace a number literal with `value`; null when the argument is not one. */
function numberArgEdit(arg: ChainArg | undefined, value: number): OffsetEdit | null {
  if (!arg || arg.numeric === null) return null // a signal / expression / bare call — hands off
  return { range: arg.range, text: formatNumber(value) }
}

/**
 * Set a number-valued call. The call edited is the one that plays
 * (`playingCall`: the last named in `names`):
 *  - its first argument is a number literal → replace that literal;
 *  - it is anything else → null (hands off);
 *  - no such call → append `.canonical(value)`.
 * A non-finite value writes nothing — `formatNumber` would render it `0`, a
 * plausible value and so a silent rewrite.
 */
export function setNumberCall(
  fresh: ChunkInfo,
  names: readonly string[],
  canonical: string,
  value: number,
): OffsetEdit | null {
  if (!Number.isFinite(value)) return null
  const call = playingCall(fresh, names)
  if (!call) return appendCall(fresh, canonical, formatNumber(value))
  return numberArgEdit(call.args[0], value)
}

/**
 * Set a string-valued call to `literal` — source text, quotes included, so the
 * caller owns the quoting rule. A call named in `names` whose first argument is a
 * plain string literal has that argument replaced; otherwise `.canonical(literal)`
 * is appended.
 */
export function setLiteralCall(
  fresh: ChunkInfo,
  names: readonly string[],
  canonical: string,
  literal: string,
): OffsetEdit {
  const cur = readChainMethod(fresh, names)
  if (cur) return { range: cur.range, text: literal }
  return appendCall(fresh, canonical, literal)
}

/**
 * `setLiteralCall` for a sound / bank id: single-quoted, because the transpiler
 * turns a double-quoted string into a mini-notation pattern (PV44) and an id must
 * stay a string.
 */
export function setStringCall(
  fresh: ChunkInfo,
  names: readonly string[],
  canonical: string,
  value: string,
): OffsetEdit {
  return setLiteralCall(fresh, names, canonical, `'${value}'`)
}

/**
 * Remove the call at `index`. A member call's range runs from its dot to its
 * closing paren, so deleting it drops the whole call. Null for the head (index 0)
 * or a missing index: the pattern itself is never deleted.
 */
export function removeCall(fresh: ChunkInfo, index: number): OffsetEdit | null {
  if (index <= 0) return null
  const call = fresh.chain[index]
  return call ? { range: call.range, text: '' } : null
}

// ── what the mixer panel's gestures write ────────────────────────────────────

/**
 * Where a drawn dial points: one argument of one call, and the method it was
 * drawn for. The index comes from the render, so the name travels with it — if
 * the chain changed underneath, the call now at that index is some other method
 * and the write is refused rather than landed on it.
 */
export interface ChainArgRef {
  chainIndex: number
  argIndex: number
  method: string
}

/** The call a ref points at, or null when that index now holds another method. */
function callAt(fresh: ChunkInfo, ref: ChainArgRef): ChainCall | null {
  const call = fresh.chain[ref.chainIndex]
  return call && call.name === ref.method ? call : null
}

/** A knob drag: the dial's number literal becomes `value`. */
export function knobEdit(fresh: ChunkInfo, ref: ChainArgRef, value: number): OffsetEdit | null {
  const arg = callAt(fresh, ref)?.args[ref.argIndex]
  return arg ? numberArgEdit(arg, value) : null
}

/**
 * The text edit that writes `min, max` into a control's range slots (#844):
 * replace the existing extra-arg span in place, or insert `, min, max` right
 * after the value arg when there is none. Pure — a `(range, text)` OffsetEdit,
 * so it unit-tests against `applyEdits` with no Monaco.
 */
export function rangeArgsEdit(call: ChainCall, min: number, max: number): OffsetEdit {
  const value = call.args[0]
  const body = `${formatNumber(min)}, ${formatNumber(max)}`
  const extra = call.args.slice(1)
  if (extra.length > 0) {
    // Replace whatever extra args exist with exactly two — normalises a lone or
    // junk extra arg to a clean `min, max`. The leading `, ` before the first
    // extra arg is outside the value arg's range, so it is preserved.
    return { range: [extra[0].range[0], extra[extra.length - 1].range[1]], text: body }
  }
  return { range: [value.range[1], value.range[1]], text: `, ${body}` }
}

/**
 * The text edit that clears a control's range back to `.control(value)` (#844):
 * delete from the end of the value arg through the last extra arg (dropping the
 * `, min, max`). Returns null when there is no range to remove. Pure.
 */
export function rangeResetEdit(call: ChainCall): OffsetEdit | null {
  const value = call.args[0]
  const extra = call.args.slice(1)
  if (!value || extra.length === 0) return null
  return { range: [value.range[1], extra[extra.length - 1].range[1]], text: '' }
}

/** The dial-range popup: write `min, max` into the dial's call. Null when that
 *  call has no value argument left to put a range after (#1897). */
export function knobRangeEdit(fresh: ChunkInfo, ref: ChainArgRef, min: number, max: number): OffsetEdit | null {
  const call = callAt(fresh, ref)
  return call && call.args.length > 0 ? rangeArgsEdit(call, min, max) : null
}

/** Reset the dial to its default range: drop the `, min, max` from its call. */
export function knobRangeResetEdit(fresh: ChunkInfo, ref: ChainArgRef): OffsetEdit | null {
  const call = callAt(fresh, ref)
  return call ? rangeResetEdit(call) : null
}

/** The first MEMBER call (never the head) named in `names`, or -1. */
function memberIndex(fresh: ChunkInfo, names: readonly string[]): number {
  return fresh.chain.findIndex((c, i) => i > 0 && names.includes(c.name))
}

/**
 * Switch an effect on or off (#575). Alias-aware: when the chain already has the
 * effect under any spelling in `names` (`.cutoff` for Low-pass, …) THAT call is
 * removed; otherwise `.method(def)` is appended.
 */
export function toggleCallEdit(
  fresh: ChunkInfo,
  names: readonly string[],
  method: string,
  def: number,
): OffsetEdit | null {
  const idx = memberIndex(fresh, names)
  return idx >= 0 ? removeCall(fresh, idx) : appendCall(fresh, method, formatNumber(def))
}

/** Remove one method by its exact name — a knob's `×` (#575). Null when absent. */
export function removeNamedCall(fresh: ChunkInfo, method: string): OffsetEdit | null {
  return removeCall(fresh, memberIndex(fresh, [method]))
}
