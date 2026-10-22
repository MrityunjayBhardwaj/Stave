/**
 * Stepped automation a track declares, read off the static IR (#1463 Stage 1).
 *
 * `.gain("<0.2 0.8>")` is a parameter that holds one value per cycle and moves
 * between them — the stepped class, next to #1464's continuous one. It already
 * parses completely: `Param{value: Cycle{items: [Play "0.2", Play "0.8"]}}`, with
 * an exact source span on every step. This module turns that into what a lane
 * needs to DRAW it, and into the one edit a lane may make to it.
 *
 * WHAT THE ENGINE DOES WITH IT, measured through the real evaluator before any of
 * this was written (#1463, the grounding comment on the issue):
 *
 *   `<a b>`        cycle n plays step (n mod 2)          → period 2
 *   `<a@2 b>`      a weighted step spans 2 cycles         → period 3
 *   `<a b>/2`      every step spans 2 cycles              → period 4   (#1579)
 *   `<a b>/1.5`    a step changes INSIDE a cycle          → not stepped
 *   `<a [b c]>`    the second step SUBDIVIDES its cycle   → not stepped
 *   `<a ~ b>`      the `~` step SILENCES THE TRACK        → not "no value"
 *
 * ⚠ A STEP IS ADDRESSED BY ITS INDEX, NOT BY A BAR. Step k plays in every cycle
 * where `cycle mod period` selects it, so an edit to step k changes every bar that
 * plays it — which is what the document says. A lane that pretended to change one
 * bar would be describing a document nobody wrote.
 *
 * ⚠ `cycle mod period` HOLDS ONLY WHERE NOTHING ABOVE THE PARAMETER MOVES TIME
 * (#1584). `.slow(2)`, `.early(1)` and `jux(x => x.fast(2))` hand the parameter a
 * cycle no lane can draw, so the walk admits a parameter only under nodes measured
 * to leave the cycle alone.
 *
 * ⚠ AN ARRANGEMENT SECTION IS THE ONE TIME CHANGE A LANE CAN DRAW (#1585). An arm
 * of `arrange`, `cat` or `slowcat` hands the parameter how many cycles THAT SECTION
 * has played, so the walk records the section instead of declining, and
 * `stepIndexAtCycle` does the section's arithmetic. This was once recorded as "an
 * arrange arm follows the absolute cycle", from `arrange([1, a], [2, b])`: a
 * section two cycles behind per pass, which a two-step pattern cannot tell apart.
 * `[3, a], [1, b]` can. And a section that appears twice does NOT continue its
 * count — each appearance is its own arm, and both play the same steps in a pass
 * (engine test, on a three-step pattern where the two readings disagree).
 *
 * Mirrors `signalAutomation.ts`: pure, no eval, the same per-track attribution,
 * and the same direction of error — ABSTAIN rather than approximate. A missing
 * lane shows less than it could; a wrong one is the editor lying about what
 * plays. The walk over the track is structural, over the IR; a literal's STEPS are
 * read off krill's parse of that literal, the parse the engine itself runs, because
 * the IR's lowering flattens what decides them (#1587, `stepsOfLiteral`).
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'
import { parseTypedNumber, type OffsetEdit } from '../writeback'
import { miniShape, type MiniElement, type MiniGroup } from '../strudelMini/shape'
import { isSectionWindow, placementsTimeAt, playableParameters, type SectionWindow, type TimeStep, type TimeWarp } from './parameterRoutes'

/** One step of a stepped parameter. */
export interface SteppedStep {
  /** The value this step holds, as a number. */
  readonly value: number
  /**
   * How many CYCLES the step holds for — krill's weight for it (`@n`, `_` and `!n`
   * folded together; else 1) times the literal's `/n` (else 1). A positive
   * integer. Not the written `@n`: `<0.2@2 0.8>/2` holds its first step for 4
   * cycles (#1579), and `<0.3!3 0.8>` is two steps, the first held 3 (#1587).
   */
  readonly weight: number
  /** The cycle, within one period, at which this step begins. */
  readonly startCycle: number
  /** Where the number is spelled — the whole of what a value edit replaces. */
  readonly valueSpan: SourceLocation
}

/** One drawable, editable stepped automation. */
export interface SteppedAutomation {
  /** The lane this belongs to — the same `trackId` `signalAutomations` keys on. */
  readonly trackId: string
  /** The CANONICAL control: `.lpf(...)` reads as `cutoff`, as the engine names it. */
  readonly paramKey: string
  /** The method as the user TYPED it (`lpf`), for anything that shows a name. */
  readonly method: string
  readonly steps: readonly SteppedStep[]
  /** The sum of the weights — the cycles one full pass of the steps spans. */
  readonly periodCycles: number
  /** Source offset of the `Param` call site, or null. */
  readonly offset: number | null
  /**
   * Where the parameter plays, one entry per route to it: the arrangement sections
   * (#1585) and whole-track time changes (#1595) that route passes through,
   * OUTERMOST FIRST. A parameter under neither has one route through none — `[[]]`
   * — and sees every song cycle as itself. A binding arranged twice has two routes,
   * one per appearance.
   */
  readonly placements: readonly (readonly TimeStep[])[]
}

/** The steps of a route — owned by the shared walk (`parameterRoutes.ts`),
 *  re-exported so the barrel's names for them hold. */
export type { SectionWindow, TimeStep, TimeWarp }

/**
 * Whether every song bar stays inside ONE cycle of the time a route hands the
 * parameter — the condition a lane drawing one step per bar needs (#1595).
 *
 * A section maps a whole cycle to a whole cycle. A warp `t · times / per + shift`
 * keeps a bar inside one cycle when it slows by a whole number (`per / times` an
 * integer) and shifts by whole cycles: the bar `[c, c + 1)` lands inside
 * `[⌊c / k⌋, ⌊c / k⌋ + 1)`, and composing such steps keeps that true. Anything else
 * — `.fast(2)`, `.slow(1.5)`, `.late(0.5)` — changes the step partway through a bar
 * (engine test), which a one-step-per-bar lane cannot draw, so it declines.
 */
function keepsBarsWhole(placement: readonly TimeStep[]): boolean {
  return placement.every((step) => isSectionWindow(step) || (Number.isInteger(step.per / step.times) && Number.isInteger(step.shift)))
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/**
 * Read one `Param`'s value as steps, or decline.
 *
 * ⚠ ALL THREE QUOTES ARE STEPPED, and that was checked rather than assumed. The
 * transpiler turns double-quoted and backtick strings into mini calls; a
 * SINGLE-quoted one reaches `reify` as a plain string, and the engine's
 * `installMiniStringParser` then pattern-parses it when it is valid notation
 * (`engine/stringParser.ts`). So `.gain('<0.2 0.8>')` plays steps too — pinned by
 * `steppedAutomation.engine.test.ts` against the real transpiler, not by this
 * comment.
 *
 * ⚠ WHAT IS REQUIRED IS THAT THE ARGUMENT IS ONE STRING LITERAL AND NOTHING ELSE —
 * `rawArgs` opens and closes on the same quote. The parser reads the first
 * literal of `.gain("<0.2 0.8>" + "")` as the same `Cycle` it reads for the plain
 * spelling, but the transpiler turns each quoted string into a pattern before the
 * `+` runs, so the engine never plays those steps (engine test). A second
 * argument (`"<…>", 1`) is declined too: it plays, but it is not an argument a
 * lane can own.
 */
function readSteps(param: PatternIR & { tag: 'Param' }): SteppedStep[] | null {
  const raw = param.rawArgs.trim()
  const quote = raw[0]
  // ONE literal: the next quote after the opening one is the LAST character.
  // Opening and closing on the same quote is not enough — `"<0.2 0.8>" + ""` does
  // both, and the first spelling of this check (first char === last char) passed
  // it. This single clause also refuses a second argument and an unterminated
  // literal, so there is no separate "ends with a quote" branch left for no arm to
  // defend (a break of that branch alone turned nothing red).
  if ((quote !== '"' && quote !== '`' && quote !== "'") || raw.indexOf(quote, 1) !== raw.length - 1) {
    return null
  }
  const lit = literalOf(param)
  return lit ? stepsOfLiteral(lit.inner, lit.start) : null
}

/**
 * The text inside the argument's quotes, UNTRIMMED, and the source offset of its
 * first character — or null.
 *
 * Positions come from the parser: the call site runs from the `.` to past the
 * `)`, and `rawArgs` is everything between the parentheses, untrimmed — so the
 * argument begins `rawArgs.length + 1` before the call's end. The inner text keeps
 * its whitespace because krill's offsets count it (`" <0.2 0.8> "` is steps).
 */
function literalOf(param: PatternIR & { tag: 'Param' }): { inner: string; start: number } | null {
  const call = param.loc?.[0]
  if (!call) return null
  const raw = param.rawArgs
  const start = call.end - 1 - raw.length + (raw.length - raw.trimStart().length) + 1
  return { inner: raw.trim().slice(1, -1), start }
}

/**
 * The steps of one literal, read off KRILL's tree — the parse the engine runs on
 * the same string — or null.
 *
 * ⚠ NOT OFF THE IR (#1587). `parseStrudel` lowers krill's tree into PatternIR, and
 * the lowering flattens exactly what decides whether a literal holds one value per
 * cycle. Each of these came out as a `Cycle` of numeric Plays, and each plays
 * something else (engine test): `[1|1.5]` is a RANDOM pick, `<1 2, 3 4>` is two
 * layers, `<0.2 0.8:1>` plays the array `[0.8, 1]`. `<0.3!3 0.8>` became three
 * Plays on ONE span, so an edit to one of them moved all three copies' bars. The IR
 * also kept one `/2` of `/2/2` (which plays `/4`) and dropped `/0` entirely.
 * krill names every one of these. A check of the text between the IR's spans was
 * drafted first and set aside: it would have been a second copy of the grammar.
 *
 * The accepted shape, dumped from `@strudel/mini@1.2.6` rather than read off the
 * grammar:
 *
 *   fastcat ── ONE element: weight 1, reps 1, and no op but one `/n` (`slowFactor`)
 *    └ polymeter_slowcat ── ONE child (a second one is a `,` layer)
 *       └ fastcat ── one element per STEP: an atom whose token is a number
 *
 * A step holds `weight` cycles — krill folds `@n`, `_` and `!n` into that one
 * field, and the engine follows it: `<0.2!3@2 0.8>` has weight 4 and plays 0.2 for
 * four cycles (measured). Its only op may be `replicate`; anything else rides on the
 * step (`:` tail, `?` degrade, `(3,8)`, a per-step `*`) and changes what it plays.
 * `!n` is therefore ONE step — the one number the user wrote — and an edit to it
 * moves every cycle it holds.
 */
function stepsOfLiteral(inner: string, innerStart: number): SteppedStep[] | null {
  let root: MiniGroup
  try {
    root = miniShape(inner)
  } catch {
    return null
  }
  // ⚠ ONE ELEMENT, NOT "A FASTCAT": `<0.2 0.8> 0.5` is a fastcat of two and plays two
  // values a cycle. A root that is not a fastcat (`a | b`, `a, b`) holds PATTERNS,
  // not elements, and fails the alternation checks below on its own — an alignment
  // clause here was broken alone and turned nothing red.
  if (root.children.length !== 1) return null
  const whole = root.children[0]
  // a root that holds layers (`a | b`, `a, b`) has no single element to be the literal
  if (whole.kind !== 'element') return null
  const stretch = slowFactor(whole)
  if (stretch === null || whole.weight !== 1 || whole.reps !== 1) return null

  const alt = whole.content
  if (alt.kind !== 'group' || alt.alignment !== 'polymeter_slowcat' || alt.children.length !== 1) return null
  // A slowcat's child is a LAYER (a group), not an element (the krill AST reference), and
  // always a fastcat: `<0.2|0.8>` and `<0.2 . 0.8>` do not parse at all, in krill or
  // in the engine. A check of the child's alignment turned nothing red when broken.
  const arms = alt.children[0]
  if (arms.kind !== 'group') return null

  const steps: SteppedStep[] = []
  let at = 0
  for (const el of arms.children) {
    if (el.kind !== 'element') return null
    const atom = el.content
    // `~` silences the track and `[a b]` subdivides the cycle: neither is a value
    // held for a cycle, so the whole parameter declines.
    //
    // ⚠ The number test is what DECLINES a group; the atom test only NARROWS. A
    // group has no text for the number test to match. It was measured on krill's own
    // nodes by breaking the atom test, which turned nothing red; on the adapter's
    // nodes (#1972) the atom test is what gives `atom.text` its type.
    if (atom.kind !== 'atom' || !NUMBER.test(atom.text)) return null
    const weight = el.weight
    // A fractional weight has no whole-cycle start, and the per-cycle reading this
    // lane exists to draw would have to invent one.
    if (!Number.isInteger(weight) || weight < 1) return null
    if (!el.ops.every((op) => op.kind === 'replicate')) return null
    const span = atom.span
    const held = weight * stretch
    steps.push({
      value: Number(atom.text),
      weight: held,
      startCycle: at,
      valueSpan: { start: innerStart + span.start, end: innerStart + span.end },
    })
    at += held
  }
  return steps.length > 0 ? steps : null
}

/**
 * The whole-number `n` of a `<…>/n` on the literal, 1 for no op, or null (#1579).
 *
 * A whole-number n stretches every step to `n` times its weight and nothing more —
 * measured through the engine for /2, /3, a weighted step and three steps. A
 * fractional n (`/1.5`, `/0.5`) and every `*n` change the value INSIDE a cycle, a
 * patterned amount (`/[2]`, `/<2 1>`) changes it per cycle, and two divisions
 * (`/2/2`) are two ops — each declines. `/0` and `/-2` play nothing at all, which
 * is what `n >= 1` refuses.
 */
function slowFactor(el: MiniElement): number | null {
  const ops = el.ops
  if (ops.length === 0) return 1
  if (ops.length !== 1) return null
  // `slow` is only ever a `stretch`'s type (dump), and a patterned amount (`/[2]`)
  // is a group, not an atom, so it is no number — so neither needs a clause of its
  // own. Both were written, broken alone, and turned nothing red.
  const { type, amount } = ops[0].args
  if (type !== 'slow') return null
  // the amount is a number only when it IS an atom: a patterned one is a group
  const n = amount && typeof amount === 'object' && amount.kind === 'atom' ? Number(amount.text) : NaN
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * Every stepped automation the document declares, by track, in the order the
 * walk meets them. Empty for a document with none, which is most of them.
 *
 * WHICH parameters play the song's time, and in which sections, is the shared walk
 * (`parameterRoutes.ts`); this reader decides only whether a value is steps.
 */
export function steppedAutomations(ir: PatternIR | null | undefined): readonly SteppedAutomation[] {
  const out: SteppedAutomation[] = []
  for (const { trackId, param, placements } of playableParameters(ir)) {
    if (!placements.every(keepsBarsWhole)) continue
    const steps = readSteps(param)
    if (!steps) continue
    const start = param.loc?.[0]?.start
    out.push({
      trackId,
      paramKey: param.key,
      method: param.userMethod ?? param.key,
      steps,
      periodCycles: steps.reduce((sum, s) => sum + s.weight, 0),
      offset: typeof start === 'number' && Number.isFinite(start) ? start : null,
      placements,
    })
  }
  return out
}

/**
 * Which step plays in song cycle `cycle`, or null when the parameter's section is
 * silent then (#1585) — the same selection the engine makes: the cycle the
 * parameter's own section hands it, its position within the period, matched
 * against each step's weighted start. A parameter under no section sees the song
 * cycle itself. Negative cycles wrap like positive ones — `<0.2 0.8>.late(1)` plays
 * 0.8 at song cycle 0 (measured, #1595).
 *
 * The handed time is floored: under a whole-number slow the start of a bar lands
 * partway into a cycle (`.slow(2)` hands bar 1 the time 0.5), and `keepsBarsWhole`
 * is what guarantees the whole bar stays in that cycle.
 */
export function stepIndexAtCycle(a: SteppedAutomation, cycle: number): number | null {
  const handed = placementsTimeAt(a.placements, Math.floor(cycle))
  if (handed === null) return null
  const own = Math.floor(handed)
  const period = a.periodCycles
  const pos = ((own % period) + period) % period
  for (let k = a.steps.length - 1; k >= 0; k--) {
    if (pos >= a.steps[k].startCycle) return k
  }
  return 0
}

/**
 * Turn "step `index` should hold `value`" into a source edit, or into NOTHING.
 *
 * Replaces that step's number and no other byte — its `@n`, its neighbours and
 * the user's spelling of every untouched step all survive. Returns null for an
 * index out of range, a non-finite value, or a value the step already holds
 * (compared as numbers, so `0.30` over `0.3` is no edit rather than a rewrite).
 *
 * ⚠ `String(value)`, not a formatter — the same reason `captionEdit` gives: there
 * is no arithmetic here to produce float noise, and a rounding formatter would
 * write a different number than the one asked for.
 */
export function stepValueEdit(
  a: SteppedAutomation,
  index: number,
  value: number,
): OffsetEdit | null {
  const step = a.steps[index]
  if (!step || !Number.isFinite(value) || value === step.value) return null
  const text = String(value)
  // ⚠ THE EDIT MUST WRITE A NUMBER THIS MODULE CAN READ BACK. `String` spells a
  // very large or very small number in exponent form (`1e+21`, `1e-7`), which
  // `NUMBER` declines — so the write would land, the engine would play it, and
  // the whole parameter would drop off its lane on the next read. One grammar,
  // checked on the way out as well as on the way in.
  if (!NUMBER.test(text)) return null
  return { range: [step.valueSpan.start, step.valueSpan.end], text }
}

/**
 * "The user typed `text` over step `index`" as a source edit, or nothing: the
 * text must be a number (`parseTypedNumber` — an empty field is not zero), and
 * then `stepValueEdit`'s rules apply.
 */
export function stepTextEdit(a: SteppedAutomation, index: number, text: string): OffsetEdit | null {
  const value = parseTypedNumber(text)
  return value === null ? null : stepValueEdit(a, index, value)
}
