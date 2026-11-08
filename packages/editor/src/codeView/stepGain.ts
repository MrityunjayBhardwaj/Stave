/**
 * stepGain.ts — velocity per step: a drag on a hit writes its own step of `.gain("…")` (#2468,
 * stage 5 of epic #1832, #2295).
 *
 * The column grid keeps one gain per COLUMN and rewrites the whole `.gain` from them
 * (`serializeStepGain`). The tree grid has no columns, so velocity is addressed the way a click
 * is: by the step that is written. A `.gain("…")` string is a pattern of its own, so the same
 * tree (`chunkDivisions`) and the same writer (`renameStep`) find and change the level that
 * plays on the hit. What plays is asked of Strudel (`soundGainHits`): which level a hit takes,
 * which hits a gain `~` silences, and, after the edit, that the hit now plays at the new level.
 *
 * THE RULES (the user's rulings, 2026-11-08)
 *  1. An existing `.gain` string: the level whose own hit is EXACTLY the dragged hit (same
 *     begin, same end) is rewritten, one replacement inside the string. A level written once and
 *     played several times by its own op (`1*4`) is written out first, so only that hit changes;
 *     a level inside a repeated group changes in every copy, as a click on a step does.
 *  2. No `.gain`, or a number: a new string that mirrors the steps, every step a level and no `~`
 *     (`gainMirror`), the number as every step's starting level.
 *  3. A hit under a gain `~` plays nothing: a click that would add one is refused (`gainLevelsAt`
 *     says where), and there is no level there to drag.
 *
 * Pure: nothing here reads or writes the editor; `gainEdit.ts` turns a result into edits.
 */
import { chunkDivisions, type DivisionRow, type DivisionStep, type Frac } from './gridDivisions'
import type { ChunkGain } from './notation/model'
import { miniPattern, miniValuesAt, soundGainHits, type MiniTime } from './strudelMini/pattern'
import { gainMirror } from './strudelMini/spell'
import { applyStepEdit, renameStep, type StepEdit, type StepEditRefusal } from './stepEdit'

export type StepGainRefusal =
  | StepEditRefusal
  /** the `.gain` is a signal or an expression: velocity leaves it as written */
  | 'gain-not-ours'
  /** no hit of the pattern begins there */
  | 'no-hit-there'
  /** the hit begins under a rest of the `.gain`, so it plays nothing */
  | 'hit-is-silent'
  /** the level that plays on the hit also covers more (or less) than the hit */
  | 'gain-step-not-the-hit'
  /** a new `.gain` cannot mirror this pattern's steps (`,` parts, `|`, `{…}`) */
  | 'no-gain-for-this-pattern'
  /** Strudel could not play the pattern with its `.gain` */
  | 'gain-does-not-evaluate'
  /** the edit was written, but Strudel does not play the hit at the new level */
  | 'gain-not-heard'

export type StepGainResult =
  | {
      ok: true
      /** the whole `.gain` string after the edit */
      gain: string
      /** there was no string before: the caller writes a new `.gain(…)` (or replaces a number) */
      created: boolean
      /** the replacement inside the existing string; null when `created` */
      edit: StepEdit | null
    }
  | { ok: false; why: StepGainRefusal }

const EPS = 1e-9
const no = (why: StepGainRefusal): StepGainResult => ({ ok: false, why })

/** a level as the `.gain` writes it: `0.5`, `1`, two decimals at most */
export function fmtLevel(v: number): string {
  if (!Number.isFinite(v)) return '1'
  const c = Math.min(1, Math.max(0, v))
  if (Number.isInteger(c)) return String(c)
  return c.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * The level playing at each instant (cycles from the pattern's start): a number, or null where
 * the `.gain` is a rest and a hit there plays nothing. No `.gain` reads 1 everywhere, a number
 * reads that number; a `.gain` velocity does not manage reads null for none (`foreign`: nothing
 * is known, so nothing is refused or drawn because of it).
 */
export function gainLevelsAt(gain: ChunkGain, times: readonly number[]): Array<number | null> | null {
  if (gain.foreign) return null
  if (gain.mini === null) return times.map(() => gain.numeric ?? 1)
  let values: unknown[][]
  try {
    values = miniValuesAt(gain.mini, times)
  } catch {
    return null
  }
  return values.map((v) => {
    const n = v.find((x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))))
    return n === undefined ? null : Number(n)
  })
}

const near = (a: MiniTime | number, b: number): boolean => Math.abs(a.valueOf() - b) < EPS

/** a time in bar `bar` as an exact share of it */
function inBar(t: MiniTime, bar: number): Frac | null {
  const rel = t.sub ? t.sub(bar) : null
  const m = /^(\d+)(?:\/(\d+))?$/.exec(rel?.toFraction?.() ?? '')
  return m ? { n: Number(m[1]), d: m[2] === undefined ? 1 : Number(m[2]) } : null
}

/** the step of `rows` whose name is written at `start`, with its part's place in the bar */
function stepNamedAt(parts: readonly DivisionRow[], start: number): { step: DivisionStep; part: number } | null {
  let out: { step: DivisionStep; part: number } | null = null
  parts.forEach((row, part) => {
    const visit = (r: DivisionRow): void => {
      for (const s of r.steps) {
        if (!out && s.head && s.head.start === start) out = { step: s, part }
        for (const k of s.rows ?? []) visit(k)
      }
    }
    visit(row)
  })
  return out
}

/**
 * Set the level of the hit that begins at `hit.begin` (cycles; it ends at `hit.end`) to
 * `level`. `mini` is the sound's string, `gain` the chunk's `.gain`, `bars` the view's loop.
 */
export function stepGainEdit(mini: string, gain: ChunkGain, bars: number, hit: { begin: number; end: number }, level: number): StepGainResult {
  if (gain.foreign) return no('gain-not-ours')
  const created = gain.mini === null
  const text = gain.mini ?? gainMirror(mini, fmtLevel(gain.numeric ?? 1))
  if (text === null) return no('no-gain-for-this-pattern')
  const cyc = Math.floor(hit.begin + EPS)
  const bar = ((cyc % bars) + bars) % bars

  let heard: ReturnType<typeof soundGainHits>
  let plain: ReturnType<ReturnType<typeof miniPattern>['hits']>
  try {
    heard = soundGainHits(mini, text, cyc)
    plain = miniPattern(mini).hits(cyc)
    // a new string must land a level on every hit of the loop, or it would silence some
    if (created) {
      for (let c = 0; c < bars; c++) {
        if (soundGainHits(mini, text, c).length !== miniPattern(mini).hits(c).length) return no('no-gain-for-this-pattern')
      }
    }
  } catch {
    return no('gain-does-not-evaluate')
  }
  const target = heard.find((h) => near(h.begin, hit.begin))
  if (!target) return no(plain.some((h) => near(h.begin, hit.begin)) ? 'hit-is-silent' : 'no-hit-there')

  // the level that plays on it: its own hit must be exactly the dragged hit
  let levels: ReturnType<ReturnType<typeof miniPattern>['hits']>
  try {
    levels = miniPattern(text).hits(cyc)
  } catch {
    return no('gain-does-not-evaluate')
  }
  const starts = new Set(target.gainAt.map((l) => l.start))
  const own = levels.find((l) => l.begin.valueOf() <= hit.begin + EPS && hit.begin + EPS < l.end.valueOf() && l.locations.some((x) => starts.has(x.start)))
  if (!own || !near(own.begin, hit.begin) || !near(own.end, hit.end)) return no('gain-step-not-the-hit')
  // ...and no other hit starts under it: a chord whose members play at different times
  // (`[c2, ~ [d6 c6]]`) has one level over all of them (hits starting WITH it share it, as the
  // column grid's one gain per column is shared by every row there)
  try {
    // every bar the level spans: a level held over a bar line (`1@2`) covers the next bar's hits too
    for (let c = Math.floor(own.begin.valueOf() + EPS); c < own.end.valueOf() - EPS; c++) {
      const hits = c === cyc ? heard : soundGainHits(mini, text, c)
      if (hits.some((h) => h.begin.valueOf() > own.begin.valueOf() + EPS && h.begin.valueOf() < own.end.valueOf() - EPS)) return no('gain-step-not-the-hit')
    }
  } catch {
    return no('gain-does-not-evaluate')
  }

  // ...and the gain's own tree finds the step it is written as
  const trees = chunkDivisions(text, bars)
  const tree = trees[bar]
  if (!tree || !tree.ok) return no(tree ? tree.why : 'no-such-bar')
  let found: { step: DivisionStep; part: number } | null = null
  for (const s of starts) found = found ?? stepNamedAt(tree.parts, s)
  const at = inBar(own.begin, cyc)
  if (!found || !found.step.span || found.step.name === null || !at) return no('step-has-no-text')
  const r = renameStep(text, trees, { bar, span: found.step.span, at }, { sound: found.step.name, part: found.part }, fmtLevel(level))
  if (!r.ok) return no(r.why)
  const after = applyStepEdit(text, r.edit)

  // Strudel is the judge: the hit plays, at the new level
  try {
    const now = soundGainHits(mini, after, cyc).find((h) => near(h.begin, hit.begin))
    if (!now || Math.abs(Number(now.gain) - Number(fmtLevel(level))) > EPS) return no('gain-not-heard')
  } catch {
    return no('gain-does-not-evaluate')
  }
  return { ok: true, gain: after, created, edit: created ? null : r.edit }
}
