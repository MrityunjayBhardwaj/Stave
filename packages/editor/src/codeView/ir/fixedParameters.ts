/**
 * Fixed parameter values read off the static IR, and the one edit that turns one
 * into steps (#1600).
 *
 * `.gain(0.8)` gets no lane: `steppedAutomations` needs an alternation and
 * `signalAutomations` a signal. Across the 558-document archive that is the common
 * case — 2537 fixed values against 167 stepped ones. This module lists them and
 * writes `"<v v … v>"` in their place, which plays the same value in every cycle
 * and adds no length (identical steps fingerprint identically — engine test).
 *
 * WHICH parameters play the song's time is the shared walk (`parameterRoutes.ts`),
 * exactly as for the stepped reader; this decides only whether a value is ONE
 * number, and how many steps a pass of its lane holds.
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'
import { isSectionWindow, playableParameters, type SectionWindow, type TimeStep } from './parameterRoutes'

/** One fixed numeric parameter a lane could start automating. */
export interface FixedParameter {
  readonly trackId: string
  /** The CANONICAL control (`cutoff` for `.lpf`), as `SteppedAutomation` keys it. */
  readonly paramKey: string
  /** The method as TYPED (`lpf`) — what a knob range and a menu are keyed by. */
  readonly method: string
  readonly value: number
  /** The number as SPELLED (`.8`, `0.80`) — what the steps are written with. */
  readonly valueText: string
  /** The whole argument between the parentheses, quotes included, trimmed. */
  readonly argSpan: SourceLocation
  /**
   * Cycles one pass of the parameter's section holds, or null for a parameter
   * under no section, whose pass is the view's to decide (the lane's span).
   */
  readonly sectionCycles: number | null
  readonly offset: number | null
  readonly placements: readonly (readonly TimeStep[])[]
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/** The number an argument spells, with its quote (`''` for none), or null. */
function numberOf(raw: string): { text: string; quote: string } | null {
  const t = raw.trim()
  if (NUMBER.test(t)) return { text: t, quote: '' }
  const q = t[0]
  if ((q === '"' || q === "'" || q === '`') && t.length >= 2 && t.indexOf(q, 1) === t.length - 1) {
    const inner = t.slice(1, -1).trim()
    if (NUMBER.test(inner)) return { text: inner, quote: q }
  }
  return null
}

const DECLINE = Symbol('decline')

/**
 * The section length every route agrees on: null under no section, the innermost
 * section's cycles when all routes pass through sections of one length, and
 * `DECLINE` when a route warps time or two routes disagree.
 *
 * ⚠ A SENTINEL OF ITS OWN, NOT `undefined`. With `undefined` as the decline, a
 * warp that slipped past the first clause read `.cycles` off a `TimeWarp`, got
 * `undefined`, and declined by accident — so breaking the warp clause turned
 * nothing red. Each refusal here has to be the only thing refusing its case.
 */
function sectionCyclesOf(placements: readonly (readonly TimeStep[])[]): number | null | typeof DECLINE {
  let agreed: number | null | typeof DECLINE = DECLINE
  for (const placement of placements) {
    if (!placement.every(isSectionWindow)) return DECLINE
    const sections = placement as readonly SectionWindow[]
    const inner = sections.length > 0 ? sections[sections.length - 1].cycles : null
    if (agreed !== DECLINE && agreed !== inner) return DECLINE
    agreed = inner
  }
  return agreed
}

export function fixedParameters(ir: PatternIR | null | undefined): readonly FixedParameter[] {
  const out: FixedParameter[] = []
  for (const { trackId, param, placements } of playableParameters(ir)) {
    const num = numberOf(param.rawArgs)
    if (!num) continue
    const sectionCycles = sectionCyclesOf(placements)
    if (sectionCycles === DECLINE) continue
    const call = param.loc?.[0]
    if (!call) continue
    // `rawArgs` is everything between the parentheses, untrimmed, and the call ends
    // past the `)` — the same arithmetic as the stepped reader's `literalOf`.
    const raw = param.rawArgs
    const argStart = call.end - 1 - raw.length + (raw.length - raw.trimStart().length)
    out.push({
      trackId,
      paramKey: param.key,
      method: param.userMethod ?? param.key,
      value: Number(num.text),
      valueText: num.text,
      argSpan: { start: argStart, end: argStart + raw.trim().length },
      sectionCycles,
      offset: Number.isFinite(call.start) ? call.start : null,
      placements,
    })
  }
  return out
}

/**
 * The edit that writes `f` as `steps` identical steps — `"<v v … v>"`, `v` copied
 * as spelled, the user's quote kept (double for a bare number) — or null for a
 * step count that is not a positive whole number.
 */
export function fixedToStepsEdit(
  f: FixedParameter,
  steps: number,
  source: string,
): { range: [number, number]; text: string } | null {
  if (!Number.isInteger(steps) || steps < 1) return null
  const num = numberOf(source.slice(f.argSpan.start, f.argSpan.end))
  // The source moved under the reading: write nothing rather than a stale span.
  if (!num || num.text !== f.valueText) return null
  const q = num.quote || '"'
  return { range: [f.argSpan.start, f.argSpan.end], text: `${q}<${Array(steps).fill(num.text).join(' ')}>${q}` }
}
