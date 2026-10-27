/**
 * What a mini-notation string PLAYS, asked of Strudel (#1971, part of #1869, epic #1007).
 *
 * `miniPattern` evaluates the string with `@strudel/mini`'s own `mini()`; the pattern it
 * returns answers one question, `hits(cycle)`. The views never re-derive what sounds
 * when — they read it here. With `./tree.ts` this is the only product code that imports
 * `@strudel/mini`; the boundary test (`modellingRatchet/boundary.ts`) fails on any other.
 *
 * Kept apart from `./tree.ts` on purpose: this file loads `@strudel/core` (through
 * `mini.mjs`), and the parser half must stay importable from the engine's graph
 * without it. See the note there.
 *
 * Strudel's own hap never leaves this file (#1973). A caller gets a `MiniHit`: plain
 * data, with every location already in the coordinates of the string it passed in. The
 * two rules a caller no longer knows:
 *   1. which haps are hits — the ones with an onset and a whole span;
 *   2. `mini()` evaluates the string QUOTED, so every location Strudel reports counts
 *      the opening quote. It is taken back off here, once.
 * `./joined.ts` pairs these hits with the nodes of `./shape.ts`.
 */
import { mini as reifyMini, mini2ast, patternifyAST } from '@strudel/mini/mini.mjs'
import { markSteps, type KPattern, type StepMark } from './tree'
import type { MiniSpan } from './shape'

/** one of Strudel's exact time values (fraction.js) */
export type MiniTime = { valueOf(): number; sub?: (n: number) => MiniTime; toFraction?: () => string }

/** one onset Strudel plays in a cycle */
export interface MiniHit {
  /** when it starts and ends, exactly, in cycles from the start of the pattern */
  begin: MiniTime
  end: MiniTime
  /** what Strudel yields: a token, a number, an array for a `:`-variant */
  value: unknown
  /**
   * Where in the string the hit was written, IN STRUDEL'S ORDER — the written note is
   * not always first (`sd:2` reports the `2` before the `sd`), and Strudel takes spaces
   * but not newlines or tabs off a location. `./joined.ts` settles both; a caller that
   * wants "the note this hit came from" asks there.
   */
  locations: MiniSpan[]
}

/** a mini-notation string, evaluated: something that can be asked what it plays */
export interface MiniPattern {
  /** the string that was evaluated, exactly as given */
  readonly mini: string
  /**
   * Every hit in cycle `cyc` — the half-open window `[cyc, cyc + 1)`, the one window
   * every reader here uses. THROWS when Strudel cannot query the pattern; the caller
   * decides what that means.
   */
  hits(cyc: number): MiniHit[]
}

/** a hap as `queryArc` hands it back — the fields read below, nothing invented */
interface StrudelHap {
  hasOnset?: () => boolean
  whole?: { begin: MiniTime; end: MiniTime }
  part?: { begin: MiniTime; end: MiniTime }
  value: unknown
  context?: { locations?: Array<{ start?: unknown; end?: unknown }> }
}

function spansOf(hap: StrudelHap): MiniSpan[] {
  const out: MiniSpan[] = []
  for (const l of hap.context?.locations ?? []) {
    if (typeof l?.start === 'number' && typeof l.end === 'number') out.push({ start: l.start - 1, end: l.end - 1 })
  }
  return out
}

/**
 * The pattern `mini` evaluates to. THROWS what Strudel throws — each caller turns that
 * into its own answer (`not-a-pattern`, "the edit did not read back", null).
 */
export function miniPattern(mini: string): MiniPattern {
  return asked(mini, reifyMini(mini) as Queryable)
}

type Queryable = { queryArc(a: number, b: number): StrudelHap[] }

function asked(mini: string, pat: Queryable): MarkedPattern {
  return {
    mini,
    hits(cyc) {
      const out: MiniHit[] = []
      for (const h of pat.queryArc(cyc, cyc + 1)) {
        if (!(h.hasOnset?.() ?? false) || !h.whole) continue
        out.push({ begin: h.whole.begin, end: h.whole.end, value: h.value, locations: spansOf(h) })
      }
      return out
    },
    pieces(cyc) {
      const out: MiniPiece[] = []
      for (const h of pat.queryArc(cyc, cyc + 1)) {
        if (!h.whole || !h.part) continue
        out.push({ value: h.value, begin: h.part.begin, end: h.part.end, wholeBegin: h.whole.begin, wholeEnd: h.whole.end })
      }
      return out
    },
  }
}

/**
 * Every piece of what `mini` plays that falls in cycle `cyc`, a step that began in an
 * earlier cycle included (#2120: a chord strip names the chord sounding in each bar).
 * THROWS what Strudel throws.
 */
export function miniPieces(mini: string, cyc: number): MiniPiece[] {
  return asked(mini, reifyMini(mini) as Queryable).pieces(cyc)
}

/**
 * What `mini` holds at each instant in `times` (cycles), every value sounding then: one
 * for a sequence, several under a `,` stack, none in a rest (#2226).
 *
 * This is how a note learns its sound. `.sound(x)` is a control, and a control is
 * `pat.set.in(x)` (`@strudel/core` `controls.mjs`): the note keeps its own span and
 * takes, through `appLeft`, a fragment for every piece of `x` its span overlaps. Only
 * the fragment that holds the note's onset plays, and that is the piece of `x` sounding
 * at the onset — this, asked of Strudel.
 *
 * THROWS what Strudel throws.
 */
export function miniValuesAt(mini: string, times: readonly number[]): unknown[][] {
  const pat = asked(mini, reifyMini(mini) as Queryable)
  const byCycle = new Map<number, MiniPiece[]>()
  // a column's time is a float (`1/3` of a bar); Strudel's is exact, so allow for the rounding
  const EPS = 1e-9
  return times.map((t) => {
    const cyc = Math.floor(t + EPS)
    let pieces = byCycle.get(cyc)
    if (!pieces) byCycle.set(cyc, (pieces = pat.pieces(cyc)))
    return pieces.filter((p) => p.begin.valueOf() <= t + EPS && t + EPS < p.end.valueOf()).map((p) => p.value)
  })
}

/** one onset of `values.struct(rhythm)`: when, and which value it plays */
export interface StructHit {
  begin: MiniTime
  end: MiniTime
  value: unknown
  /** a `.mask` after the `.struct` silences it: it is a step of the rhythm that does not sound */
  silenced: boolean
}

/**
 * What `values` plays to the rhythm `rhythm` (#2120): Strudel's own
 * `mini(values).struct(mini(rhythm))`, every onset in cycle `cyc`. Which rhythm steps
 * are hits is Strudel's rule, not ours: `"1 0"` has one hit and `"t f"` has two,
 * because `.struct` keeps a step whose value is truthy.
 *
 * No locations: each hit's would mix the two strings' coordinates.
 *
 * `masks` are the `.mask(…)` strings after the `.struct`, applied in order. A hit is
 * `silenced` when Strudel plays no onset of the same value at the same time once they
 * are applied (#2120): `.mask` keeps a step where its own value is truthy, by
 * Strudel's rule, not ours.
 *
 * THROWS what Strudel throws.
 */
export function structHits(values: string, rhythm: string, cyc: number, masks: readonly string[] = []): StructHit[] {
  type Structable = Queryable & { struct(r: unknown): Structable; mask(m: unknown): Structable }
  const pat = (reifyMini(values) as Structable).struct(reifyMini(rhythm))
  const masked = masks.reduce((p, m) => p.mask(reifyMini(m)), pat)
  const sounding = new Set<string>()
  for (const h of masked.queryArc(cyc, cyc + 1)) {
    if ((h.hasOnset?.() ?? false) && h.whole) sounding.add(onsetKey(h.whole.begin, h.value))
  }
  const out: StructHit[] = []
  for (const h of pat.queryArc(cyc, cyc + 1)) {
    if (!(h.hasOnset?.() ?? false) || !h.whole) continue
    const silenced = masks.length > 0 && !sounding.has(onsetKey(h.whole.begin, h.value))
    out.push({ begin: h.whole.begin, end: h.whole.end, value: h.value, silenced })
  }
  return out
}

/** an onset's identity across two queries: its exact time and its value */
const onsetKey = (t: MiniTime, value: unknown): string =>
  `${t.toFraction?.() ?? t.valueOf()}\u0000${JSON.stringify(value)}`

/**
 * One piece of a hap inside the cycle asked for: the part of it that falls in the cycle,
 * and the whole it is a piece of. Unlike a hit it need not START here — a step longer
 * than a bar shows up in every bar it covers.
 */
export interface MiniPiece {
  value: unknown
  begin: MiniTime
  end: MiniTime
  wholeBegin: MiniTime
  wholeEnd: MiniTime
}

/** a marked copy of a pattern: its hits, and every piece that falls in a cycle */
export interface MarkedPattern extends MiniPattern {
  pieces(cyc: number): MiniPiece[]
}

/**
 * What `mini` plays with some steps of one row replaced by markers (#1833) — the way a
 * written step is asked where it sits. The string is parsed as `mini()` parses it
 * (`mini.mjs` `mini`: quote, `mini2ast`, `patternifyAST`), the TREE is marked
 * (`./tree.ts` `markSteps`), and Strudel evaluates that tree; the text is never
 * rewritten. `mini` on the result is the ORIGINAL string: a marker's locations mean
 * nothing and are not for joining.
 *
 * THROWS what krill and Strudel throw, and what `markSteps` throws for a bad path.
 */
export function markedPattern(mini: string, path: readonly number[], marks: readonly StepMark[]): MarkedPattern {
  const code = '"' + mini + '"'
  const ast = mini2ast(code) as KPattern
  markSteps(ast, path, marks)
  return asked(mini, patternifyAST(ast, code) as Queryable)
}
