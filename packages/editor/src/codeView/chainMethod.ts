/**
 * chainMethod.ts — the READ half of a chunk's method chain, beside the writer
 * `chainEdit.ts`.
 *
 * ── WHICH CALL IS THE CONTROL ───────────────────────────────────────────────
 * A chain may name a control more than once: `s("bd").gain(.5).gain(.8)`, or
 * under two spellings, `s("bd").sound("hh")`. Strudel plays the LAST one — each
 * control call is `pat.set(...)`, which overwrites what came before
 * (`@strudel/core/controls.mjs`, `createParam`). Measured against the runtime:
 * those two play `gain: 0.8` and `s: "hh"` (#1918, `playingCall.test.ts`).
 *
 * So `playingCall` is the one answer to "which call is this control", and every
 * reader and setter stands on it. A control that read the first call would show
 * one value and play another, and a drag would rewrite a call nobody hears.
 */
import type { ChainCall, ChunkInfo } from './chunkDetect'

export interface ChainMethodValue {
  /** the method name that matched (e.g. `sound` or `s`) */
  name: string
  /** the unquoted argument value (e.g. `sawtooth`, `RolandTR909`) */
  value: string
  /** source range of the argument literal, for in-place replacement */
  range: [number, number]
}

/**
 * The call the runtime plays for a control: the LAST call named in `names`, or
 * null when the chain does not write the control at all.
 *
 * A call with no argument still counts. `.gain(.5).gain()` does not leave 0.5
 * playing — the bare call wraps the whole event into `gain` (measured), so the
 * control plays nothing sensible, and reporting the earlier 0.5 would be a value
 * nobody hears. Readers see it as written-but-not-a-number and refuse it.
 */
export function playingCall(chunk: ChunkInfo, names: readonly string[]): ChainCall | null {
  for (let i = chunk.chain.length - 1; i >= 0; i--) {
    if (names.includes(chunk.chain[i].name)) return chunk.chain[i]
  }
  return null
}

/**
 * What a number control reads as.
 *
 * `null` means "written, but not as a number" — patterned, computed or bound —
 * which is NOT the same as absent and must not be confused with it: absent is
 * writable (append the call), non-numeric is not (refuse). Returning a default
 * for both would make a `.begin("<0 .5>")` look like a plain 0 and let a drag
 * overwrite a pattern the user wrote on purpose.
 */
export function readNumberCall(chunk: ChunkInfo, names: readonly string[]): number | null | 'absent' {
  const call = playingCall(chunk, names)
  if (!call) return 'absent'
  return call.args[0]?.numeric ?? null
}

/** The text inside a plain string literal's quotes, or null when `raw` is not
 *  one (a bare identifier, a signal, an expression). */
export function stringLiteralBody(raw: string): string | null {
  const q = raw[0]
  if ((q === '"' || q === "'" || q === '`') && raw.length >= 2 && raw[raw.length - 1] === q) return raw.slice(1, -1)
  return null
}

/**
 * The playing call named in `names` when its first argument is a plain string
 * literal: its unquoted value and arg range. Null when the method is absent (the
 * insert path) or the playing call's argument isn't a plain string (a signal or
 * expression — hands off).
 */
export function readChainMethod(chunk: ChunkInfo, names: readonly string[]): ChainMethodValue | null {
  const call = playingCall(chunk, names)
  const arg = call?.args[0]
  if (!call || !arg) return null
  const value = stringLiteralBody(arg.raw)
  return value === null ? null : { name: call.name, value, range: arg.range }
}
