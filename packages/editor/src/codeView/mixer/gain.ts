/**
 * gain.ts — the single source for reading and rescaling a chunk's `.gain`.
 *
 * Two representations share one home so the param panel (the master-gain knob,
 * #478) and the channel-strip fader (`StripModel`, the Mixer milestone) can't
 * drift on what a `.gain` value means (PV129 — one gain path):
 *
 *  - a SCALAR `.gain(0.85)` — a single level, the common case;
 *  - a MANAGED per-column velocity string `.gain("0.5 1 0.8")` the grid authored,
 *    where the fader is a master over the columns (drag rescales them all,
 *    shape kept, anchored at the loudest — the ceiling).
 *
 * Anything else (`.gain(sine)`, a single-token broadcast, a token shape we
 * didn't author) is FOREIGN — every gain affordance hands off and shows the
 * value read-only rather than corrupting an expression it doesn't understand.
 */
import type { ChunkInfo } from '../chunkDetect'
import { formatNumber } from '../writeback'
import { playingCall, stringLiteralBody } from '../chainMethod'

/**
 * A per-column `.gain("…")` velocity string the grid authored — flat numeric
 * tokens (with optional `~` rests and `@n` holds). Dragging a fader over it
 * rescales every column proportionally (a master fader over the per-step
 * velocities) instead of leaving the chunk with no gain control.
 */
export interface ManagedGain {
  tokens: string[]
  /** loudest column (the fader's value); rests/`~` excluded */
  ceiling: number
  /** the original quote character, preserved on write-back */
  quote: string
}

const GAIN_TOKEN = /^(\d+(?:\.\d+)?)(@\d+)?$/

/**
 * Read a `.gain` arg's raw text as a managed per-column velocity string, or
 * null when it isn't one we authored (a scalar, a single-token broadcast, a
 * signal/identifier, or a token shape we don't manage → hands off).
 */
export function parseManagedGain(raw: string): ManagedGain | null {
  const body = stringLiteralBody(raw)
  if (body === null) return null
  const quote = raw[0]
  const tokens = body
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '')
  if (tokens.length < 2) return null // single token = broadcast, not per-column
  let ceiling = 0
  for (const t of tokens) {
    if (t === '~') continue
    const m = GAIN_TOKEN.exec(t)
    if (!m) return null // a token we didn't author → foreign, hands off
    ceiling = Math.max(ceiling, parseFloat(m[1]))
  }
  return { tokens, ceiling, quote }
}

/** Rescale every column so the loudest hits the new value (shape kept). */
export function scaleManagedGain(mg: ManagedGain, value: number): string {
  const factor = mg.ceiling > 0 ? value / mg.ceiling : null
  const out = mg.tokens.map((t) => {
    if (t === '~') return '~'
    const m = GAIN_TOKEN.exec(t) as RegExpExecArray
    const nv = factor === null ? value : parseFloat(m[1]) * factor
    return formatNumber(Math.max(0, nv)) + (m[2] ?? '')
  })
  return mg.quote + out.join(' ') + mg.quote
}

/**
 * How a strip's fader reads (and, later, writes) a chunk's gain.
 *  - `scalar`   — a plain `.gain(n)`; the fader sits at `value`.
 *  - `managed`  — a `.gain("…")` velocity string; the fader sits at `ceiling`
 *                 and a drag rescales all columns (`scaleManagedGain`).
 *  - `foreign`  — a `.gain(sine)` / token shape we don't author / a bare
 *                 `.gain()`; fader disabled.
 *  - `absent`   — no `.gain`; fader at unity, the first drag inserts one (S1).
 */
export type GainState =
  | { kind: 'scalar'; value: number; range: [number, number] }
  | { kind: 'managed'; ceiling: number; mg: ManagedGain; range: [number, number] }
  | { kind: 'foreign' }
  | { kind: 'absent' }

/**
 * Combinator heads whose CHILDREN carry the real per-voice gains — a `pick*`
 * object's section values, or a `stack`/`cat`/`layer`/`arrange` voice. The outer
 * chain of such a track has no single level: the gains live one level down, out
 * of this strip's reach (S6 sub-strips would surface them). #668.
 */
const CHILD_GAIN_HEADS: ReadonlySet<string> = new Set([
  'pick', 'pickRestart', 'pickReset', 'stack', 'cat', 'layer', 'arrange',
])

/**
 * Does a combinator/pick group carry `.gain` on its CHILDREN rather than its
 * outer chain? The matching call's argument source (a `pick*` object literal, or
 * the `stack(...)` voice list) is already captured verbatim on the chain, so a
 * `.gain(` in that text means a section/voice owns a level this outer strip can't
 * see. A textual scan is enough — the only consequence is `absent` (a false unity
 * fader) vs `foreign` (an honest read-only handoff). #668.
 */
function hasChildGain(chunk: ChunkInfo): boolean {
  const call = chunk.chain.find((c) => CHILD_GAIN_HEADS.has(c.name))
  return call ? call.args.some((a) => /\.gain\s*\(/.test(a.raw)) : false
}

/**
 * Classify a chunk's `.gain` into a `GainState` — the read half of the strip
 * fader. Pure: a `ChunkInfo` in, a tagged union out, no React, no audio.
 */
export function readGainState(chunk: ChunkInfo): GainState {
  // the call that plays — a doubled `.gain(.5).gain(.8)` reads 0.8 (#1918)
  const call = playingCall(chunk, ['gain'])
  if (!call) {
    // No `.gain` on the outer chain. If this is a `pick*`/combinator group whose
    // SECTIONS carry their own `.gain`, the track is not at unity — reporting
    // `absent` (a fader parked at 1 / 0.0 dB) would lie about a track running at
    // 1.36 / 0.5. Surface it `foreign` (read-only "sig") so the strip stops
    // claiming a level it doesn't own (#668). A group with NO child gain stays
    // `absent`: an outer `.gain()` is still a legitimate first-drag insert (S1).
    return hasChildGain(chunk) ? { kind: 'foreign' } : { kind: 'absent' }
  }
  const arg = call.args[0]
  if (!arg) return { kind: 'foreign' } // a bare `.gain()` — not a level
  if (arg.numeric !== null) return { kind: 'scalar', value: arg.numeric, range: arg.range }
  const mg = parseManagedGain(arg.raw)
  if (mg) return { kind: 'managed', ceiling: mg.ceiling, mg, range: arg.range }
  return { kind: 'foreign' }
}
