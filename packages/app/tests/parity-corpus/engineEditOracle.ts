/**
 * engineEditOracle.ts — THE ONE definition of "a modelled edit survived".
 *
 * Extracted from `writer-reach.test.ts` (#1009) because a second consumer now
 * needs it: the writer census asks the SAME question of a different writer, and
 * two copies of an edit oracle are two oracles that can only agree with
 * themselves ([[PV192]]). The extraction is verdict-neutral by construction —
 * `writer-reach` calls this and read exactly 131 / 73 with no losses on the day of the
 * extraction. Both numbers have moved since, and never because a writer changed: 155 / 75
 * when the probe learned to advance past a silent bar (#1022), then 126 / 75 with 29 named
 * losses when the grid arm's duration axis was restored (#1026). What the sentence meant —
 * that moving this code must not move a verdict — still holds; what it must not be read as
 * is a claim that these two digits are the current ones.
 *
 * WHAT IT MEASURES, and it is deliberately narrow: delete ONE cleanly-singleton
 * note through the REAL writer, then re-query the emitted document through the
 * REAL engine, and require every bar to play the original minus that note.
 *
 * THE ORACLE IS THE ENGINE ON BOTH SIDES. `want` is what the original mini plays;
 * `got` is what the edited document plays. Never a re-parsed column grid —
 * `[~ 1@2]` and `[~ ~ 1@4]` are the same music at two resolutions and a column
 * compare would false-flag a faithful re-spelling ([[P301]]).
 *
 * "NO CLEAN PROBE" IS ITS OWN VERDICT, NOT A FAILURE. A fully-chorded pattern, a
 * non-integer per-bar width, or a writer that declines the delete are all
 * UNVERIFIED — neither reach nor a loss ([[PK59]] step 5). The census reports that
 * bucket separately and names which of the four reasons applied, because folding
 * it into either side is how an unproven unit becomes a proven one.
 */
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import { tailToken } from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { PianoRollModel, StepGridModel } from '../../../editor/src/codeView/notation/model'

export const HRES = 720720

export type Note = { pos: number; dur: number; atom: string }

/**
 * The equivalence key: (onset, duration, atom), on EVERY surface.
 *
 * DURATION IS NOT A PER-SURFACE CHOICE (#1026). This key used to take a
 * `durAware` flag that the grid set to `false`, commented "an onset instrument —
 * the grid has no duration axis". That sentence is true about what the grid PANEL
 * draws and it is not a licence for what the grid WRITER may alter: a view that
 * cannot show duration still must not change it, because "edits locally / no
 * silent data loss" is a property of the DOCUMENT, not of the panel. Under the
 * old key, 11 grid asks emitted writes whose surviving note had a different
 * length and every one of them scored as a clean transfer — including
 * `[bd ~]*2`, where the derived writer emits `~ bd` and the surviving `bd` grows
 * from 0.25 to 0.5. The comparison must span every axis the document carries,
 * not every axis the view draws.
 *
 * `collapses` is what genuinely IS per-surface, and it is about the view's
 * representational capacity rather than about which axes count:
 *
 *  - GRID (`collapses`): a cell holds a hit or it does not, so it cannot hold two
 *    IDENTICAL events at one instant. `hh(<3,7>,16)` superimposes euclid(3) and
 *    euclid(7) and plays 10 haps at 7 distinct instants; the grid shows 7 and a
 *    faithful re-emit plays 7. Comparing as a multiset would false-flag that.
 *  - ROLL: a duration-carrying MULTISET. Its projection is overlap-free by
 *    construction, so nothing is there to collapse and a multiset is exact.
 *
 * Measured over the corpus (#1026): the two spellings of the collapse — dedupe on
 * the onset key versus on the full key — pick out the same 11 asks, and dropping
 * the collapse entirely picks out the same 11 again. So `collapses` fires (4 grid
 * asks have a row to collapse, and the `hh(<3,7>,16)` control collapses 10 rows
 * to 7) but currently changes no verdict. It is kept as DEFENSIVE rather than
 * deleted: the hazard is real, silent, and a grid re-emit is entitled to collapse.
 */
export const sig = (rows: Note[], collapses: boolean): string => {
  const keys = rows.map(
    (r) => `${Math.round(r.pos * HRES)}|${Math.round(r.dur * HRES)}|${r.atom}`,
  )
  return JSON.stringify((collapses ? [...new Set(keys)] : keys).sort())
}

/** the played atom, however the value carries it — a sound, a MIDI note, a degree */
export function atomOf(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.toLowerCase()
  // A `:`-variant is krill's ARRAY value (`["bd", 3]`), and it used to land in the
  // `object` branch below with no `.s`/`.note`/`.n` — so it returned null, which
  // `enginePlayedCycle` reads as "this whole mini is unreadable" and the probe then
  // reports `no-readable-haps` for a pattern that plays perfectly well (#1021).
  //
  // Named through the READERS' OWN rule rather than a local copy: a second
  // implementation of the same grammar question is exactly how the instrument
  // drifts from the thing it measures, and an oracle that is more permissive than
  // production is a divergence just as much as a stricter one. Joining rather than
  // taking the head is what keeps `bd:3` distinct from `bd:1`, so a write-back that
  // drops or changes the index is still caught as a corruption instead of matching.
  if (Array.isArray(v)) return tailToken(v)?.toLowerCase() ?? null
  if (typeof v === 'object') {
    const o = v as { s?: unknown; note?: unknown; n?: unknown }
    if (o.s !== undefined) return String(o.s).toLowerCase()
    if (o.note !== undefined) return String(o.note).toLowerCase()
    if (o.n !== undefined) return String(o.n)
  }
  return null
}

interface Hap {
  hasOnset?: () => boolean
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
  part?: { begin: { valueOf(): number } }
  value: unknown
}

/**
 * The onsets a mini plays in ONE given cycle, or null if it won't reify / has an atom
 * we can't name.
 *
 * POSITIONS ARE ABSOLUTE — cycle 2's downbeat is `pos = 2`, not `0`. This comment used
 * to say "normalised into [0,1)" and that was simply false; it went unnoticed because
 * the only caller that reads a position back out is `probeEdit`, which reads cycle 0,
 * where the two frames coincide. The first caller to read a LATER cycle (`liveness`,
 * #1020) trusted the comment, derived a column from an absolute position, and produced
 * a plausible corruption rate for views that are perfectly fine. Callers that need a
 * cycle-local offset must subtract the cycle themselves.
 *
 * A bar-expanded projection (#930) shows several cycles at once, so verifying an
 * edit against cycle 0 alone would miss a write-back that corrupts a LATER bar —
 * the exact silent multi-cycle loss the projection has to be trusted not to do.
 */
export function enginePlayedCycle(src: string, cyc: number): Note[] | null {
  let haps: Hap[]
  try {
    haps = (reifyMini(src) as { queryArc(a: number, b: number): Hap[] }).queryArc(cyc, cyc + 1)
  } catch {
    return null
  }
  const out: Note[] = []
  for (const h of haps) {
    const onset =
      h.hasOnset?.() ??
      (!!h.whole &&
        !!h.part &&
        Math.abs(h.whole.begin.valueOf() - h.part.begin.valueOf()) < 1e-9)
    if (!onset || !h.whole) continue
    const atom = atomOf(h.value)
    if (atom === null) return null
    out.push({
      pos: h.whole.begin.valueOf(),
      dur: h.whole.end.valueOf() - h.whole.begin.valueOf(),
      atom,
    })
  }
  return out
}

export const enginePlayed = (src: string): Note[] | null => enginePlayedCycle(src, 0)

/** an onset position that plays exactly ONE note — deleting the model element there removes exactly that hap */
export function singletonPos(base: Note[]): number | null {
  const counts = new Map<number, number>()
  for (const n of base) counts.set(Math.round(n.pos * HRES), (counts.get(Math.round(n.pos * HRES)) ?? 0) + 1)
  for (const n of base) if (counts.get(Math.round(n.pos * HRES)) === 1) return n.pos
  return null
}

/* ── the modeled delete, per surface — the real UI edit through the real writer ── */

/**
 * Delete the single note sounding at model column `col`; null if not a clean
 * single-note target.
 *
 * The COLUMN is passed in rather than derived from a cycle-0 position, because on
 * a bar-expanded model `steps` spans every bar — `pos * steps` would stretch a
 * cycle-0 onset across the whole grid and probe the wrong column.
 */
export function deleteFromRoll(model: PianoRollModel, col: number): string | null {
  const here = model.notes.filter((n) => n.start === col)
  if (here.length !== 1) return null // chord / no note starts here — not our clean target
  const edited: PianoRollModel = { ...model, notes: model.notes.filter((n) => n !== here[0]) }
  return serializePianoRoll(edited)
}

/** clear the single lane on at model column `col`; null if not a clean single-lane target */
export function deleteFromGrid(model: StepGridModel, col: number): string | null {
  const on = model.lanes.filter((l) => isCellOn(l.cells[col]))
  if (on.length !== 1) return null
  const edited: StepGridModel = {
    ...model,
    lanes: model.lanes.map((l) =>
      l === on[0] ? { ...l, cells: l.cells.map((c, j) => (j === col ? false : c)) } : l,
    ),
  }
  return serializeStepGrid(edited)
}

/* ── the probe ──────────────────────────────────────────────────────────────── */

/**
 * Why a model got no clean single-note delete probe. Each is UNVERIFIED, and each
 * is a different fact about the model — a census that reports one number for all
 * four cannot say whether a writer is untested or untestable.
 */
export type NoProbeReason =
  /**
   * `steps / bars` is not a whole number, so there is no column to probe.
   *
   * DEFENSIVE — measured at **0 firings over both populations** (the 1217
   * core-served asks and the 2783 core-refused ones). Kept because the hazard is
   * real and silent if it ever occurs: `Math.round(pos * perBar)` on a fractional
   * `perBar` probes the WRONG column and the edit is then verified against a note
   * nobody deleted, which passes. A guard whose absence would be invisible is
   * exactly the one to keep after measuring that it does not fire.
   */
  | 'non-integer-per-bar'
  /**
   * the mini plays a value the oracle cannot name (or will not reify at all)
   *
   * This is a claim about the ORACLE's vocabulary, and it has been wrong in exactly
   * that way before: `atomOf` could not name krill's `:`-variant array, so 94 asks
   * that play perfectly well were filed here (#1021). Any ask landing here deserves
   * the question "can the instrument name this, or can production?" before it is read
   * as a fact about the pattern.
   */
  | 'unnameable-value'
  /**
   * the mini plays NOTHING in any bar the model spans — a view of silence
   *
   * Split out of the old `no-readable-haps`, which meant this AND the case above
   * (#1022). "I cannot name this value" is an oracle limitation worth fixing; "this
   * rests here" is a property of the notation. One label for both defeated the whole
   * point of reporting the `no-probe` bucket by reason.
   */
  | 'silent-in-probed-window'
  /** the first SOUNDING bar is all chords — no position in it plays exactly one note */
  | 'fully-chorded'
  /** the writer declined the delete (a safe no-op), which is not reach */
  | 'writer-declined'

export type EditProbe =
  | { verdict: 'ok'; out: string }
  | { verdict: 'corrupt'; out: string }
  | { verdict: 'no-probe'; why: NoProbeReason }

export interface Surface {
  key: 'step' | 'roll'
  /**
   * Does this surface COLLAPSE identical events at one instant?
   *
   * The only per-surface property of the comparison. Duration is deliberately NOT
   * one — see `sig` — because it is an axis of the document rather than of the
   * panel, and the flag that used to make it optional certified 11 writes that
   * silently changed a note's length (#1026).
   */
  collapses: boolean
  del: (model: StepGridModel & PianoRollModel, col: number) => string | null
}

export const GRID_SURFACE: Surface = {
  key: 'step',
  collapses: true, // a cell holds a hit or not — two identical hits at one instant are one cell
  del: (m, col) => deleteFromGrid(m, col),
}

export const ROLL_SURFACE: Surface = {
  key: 'roll',
  collapses: false, // overlap-free by construction — nothing to collapse, so a multiset is exact
  del: (m, col) => deleteFromRoll(m, col),
}

/**
 * Delete one cleanly-singleton note from `model` through the real writer and ask
 * the engine whether the emitted document plays the original minus that note, in
 * EVERY bar the model spans.
 *
 * `mini` is the source the model was read from; `model` is whichever writer's
 * model is under test. The two are passed separately on purpose: the census hands
 * in a DIFFERENT writer's model for the same mini, which is the whole
 * counterfactual.
 */
/**
 * THE RULER: where each bar of a model starts and how many columns it holds.
 *
 * A column is not one width across bars when the model is drawn per bar (#1827) —
 * `<~ ~ bd*3 bd*4 …>` is 1 + 1 + 3 + 4 + … cells — so every "cycle → column" question in
 * these gates is asked of this, never of `steps / bars`. That quotient was computed in four
 * places; on the drum pattern it came out a whole 3, so nothing refused, the probe deleted
 * the wrong cell and filed the model as `corrupt`. Uniform models get one width per bar,
 * which is the old arithmetic exactly; null when that width is not a whole number.
 */
export function barRuler(model: { steps: number; bars?: number; barSteps?: readonly number[] }): {
  widths: number[]
  starts: number[]
} | null {
  const bars = Math.max(1, model.bars ?? 1)
  const widths = model.barSteps
    ? [...model.barSteps]
    : Array.from({ length: bars }, () => model.steps / bars)
  if (!widths.every((w) => Number.isInteger(w) && w > 0)) return null
  const starts = widths.map((_, b) => widths.slice(0, b).reduce((a, w) => a + w, 0))
  return { widths, starts }
}

/** the column a time `t` (absolute cycles) lands on, in bar `bar` of `ruler` */
export function columnAt(ruler: { widths: number[]; starts: number[] }, bar: number, t: number): number {
  return ruler.starts[bar] + (t - bar) * ruler.widths[bar]
}

export function probeEdit(
  mini: string,
  model: StepGridModel & PianoRollModel,
  s: Surface,
): EditProbe {
  // Bar-expanded projections (#930) show `bars` cycles at once. `steps` then spans
  // every bar, so the probe column comes from the PER-BAR width, and the edit is
  // checked against every bar — a delete in bar 0 that quietly rewrites bar 1 is
  // the multi-cycle loss this gate exists to catch, and comparing cycle 0 alone
  // would call it a pass.
  const bars = model.bars ?? 1
  if (barRuler(model) === null) return { verdict: 'no-probe', why: 'non-integer-per-bar' }

  // THE PROBE ADVANCES PAST SILENT BARS (#1022). It used to read cycle 0 and nothing
  // else, so an alternation whose first arm is a rest — `<- c5>`, `<~ sd ~ sd ~>` — came
  // back empty and was filed as unreadable. That is the window-dependence that has bitten
  // these measurements before: a pattern that rests in cycle 0 and plays in cycle 1 looks
  // silent to a single-cycle probe.
  //
  // The scan stops at `bars`, never beyond it. Past that lies music the model does not
  // claim to show, and a delete aimed there addresses a column the view does not have.
  let bar = -1
  let played: Note[] = []
  for (let b = 0; b < bars; b++) {
    const here = enginePlayedCycle(mini, b)
    // a value the oracle cannot name is a fact about the ORACLE and stops the probe
    // immediately — advancing would just hide it in a later bar
    if (here === null) return { verdict: 'no-probe', why: 'unnameable-value' }
    if (here.length > 0) {
      bar = b
      played = here
      break
    }
  }
  if (bar < 0) return { verdict: 'no-probe', why: 'silent-in-probed-window' }

  // …and `fully-chorded` is now asked of the first bar that SOUNDS rather than of bar 0,
  // which is what the label always meant.
  const pos = singletonPos(played)
  if (pos === null) return { verdict: 'no-probe', why: 'fully-chorded' }
  return probeDeleteAt(mini, model, s, bar, pos)
}

/**
 * Delete the note this mini plays at `pos` within cycle `bar`, and require every bar
 * to come back as predicted.
 *
 * THE ONE delete-and-verify rule. `probeEdit` is this called at (bar 0, the first
 * cleanly-singleton onset); `liveness` is this called at EVERY singleton onset of
 * every bar. They ask different questions — "does one modelled edit survive" versus
 * "how much of this view responds" — and the answer to both is the same comparison,
 * so it is written once. A second copy would be a second oracle for the question this
 * file exists to define ([[PV192]]), and the census has already been bitten once by an
 * instrument that named things its own way ([[P347]]).
 *
 * `bar` is the model bar the delete targets and `pos` is the note's position in the
 * ABSOLUTE frame `enginePlayedCycle` reports — cycle 2's downbeat is `2`, not `0`. The
 * column is therefore `starts[bar] + round((pos - bar) * widths[bar])` from `barRuler` — for a
 * uniform model `bar * perBar + round((pos - bar) * perBar)`: the cycle offset
 * has to come out before scaling and go back in as whole bars, because on a
 * bar-expanded model `steps` spans every bar. At `bar = 0` this is exactly
 * `round(pos * perBar)`, which is what `probeEdit` has always computed.
 */
export function probeDeleteAt(
  mini: string,
  model: StepGridModel & PianoRollModel,
  s: Surface,
  bar: number,
  pos: number,
): EditProbe {
  const bars = model.bars ?? 1
  const ruler = barRuler(model)
  if (ruler === null) return { verdict: 'no-probe', why: 'non-integer-per-bar' }
  const out = s.del(model, ruler.starts[bar] + Math.round((pos - bar) * ruler.widths[bar]))
  if (out === null) return { verdict: 'no-probe', why: 'writer-declined' }

  for (let b = 0; b < bars; b++) {
    const want = enginePlayedCycle(mini, b)
    const got = enginePlayedCycle(out, b)
    if (want === null || got === null) return { verdict: 'corrupt', out }
    // the deleted note is gone from the bar it was deleted in; every other bar is
    // untouched. `pos` and `n.pos` are both absolute, so they compare directly.
    const expected =
      b === bar
        ? want.filter((n) => Math.round(n.pos * HRES) !== Math.round(pos * HRES))
        : want
    if (sig(got, s.collapses) !== sig(expected, s.collapses)) return { verdict: 'corrupt', out }
  }
  return { verdict: 'ok', out }
}

/**
 * How much of a view actually RESPONDS — the fraction of its cleanly-singleton notes
 * whose own delete round-trips, over every bar the model spans.
 *
 * `probeEdit` answers "is this view editable at all", which is one note. That is the
 * right question for a reach floor and the wrong one for "is this view worth showing":
 * the roll cap was left at 4 partly because the views a raise opened were only
 * **13–58% live** ([[PV222]]), and a one-note probe cannot see that. This is that
 * measurement, defined once so a sweep and a gate cannot disagree about it.
 *
 * Chorded positions are not probed and not counted — they are `probeEdit`'s
 * `fully-chorded`, unverified rather than dead — so `probed` is the honest
 * denominator and a view with none is reported as `null` rather than as 0%.
 *
 * `corrupt` IS REPORTED SEPARATELY, and it is the reason this is worth running at all
 * beyond the liveness number. `probeEdit` verifies ONE note per view; a note it never
 * probed can still mis-write, and that loss is invisible to every reach figure in the
 * project. A note that is merely declined is a dead cell — disappointing. A note that
 * corrupts is the view lying about the document, and the two must not share a bucket.
 */
export function liveness(
  mini: string,
  model: StepGridModel & PianoRollModel,
  s: Surface,
): { alive: number; probed: number; corrupt: number } | null {
  const bars = model.bars ?? 1
  if (barRuler(model) === null) return null
  let alive = 0
  let probed = 0
  let corrupt = 0
  for (let b = 0; b < bars; b++) {
    const played = enginePlayedCycle(mini, b)
    if (played === null) return null
    const counts = new Map<number, number>()
    for (const n of played) {
      const k = Math.round(n.pos * HRES)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const [k, c] of counts) {
      if (c !== 1) continue // a chord — unverifiable, not dead
      probed++
      const v = probeDeleteAt(mini, model, s, b, k / HRES).verdict
      if (v === 'ok') alive++
      else if (v === 'corrupt') corrupt++
    }
  }
  return probed === 0 ? null : { alive, probed, corrupt }
}
