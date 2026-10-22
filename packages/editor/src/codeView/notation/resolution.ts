/**
 * resolution.ts — pure ×2 / ÷2 grid-resolution transforms (#479).
 *
 * A flat Strudel sequence conflates LENGTH and RESOLUTION: the token count IS
 * the number of equal cycle subdivisions, so `s("bd ~ sn ~ bd")` is exactly 5
 * slots and appending a token re-times every event (grounded with real haps in
 * #479). The only RATIO-PRESERVING way to change the slot count — the standard
 * step-sequencer "Rate / resolution" control (Logic, Elektron) decoupled from
 * length — is an integer resolution change:
 *
 *   ×2  each slot splits into two; every hit keeps its position, the new
 *       in-between slots are empty (editable). `bd ~ sn` → `bd ~ ~ ~ sn ~`.
 *   ÷2  the inverse, and LOSSLESS only when every odd column is empty (a step
 *       grid) / every note starts and lasts an even number of columns (a roll).
 *       Otherwise it would drop or shorten notes, so it's disabled (the `canHalve*`
 *       predicates) — an honest control, never a silent corruption.
 *
 * Verified against real `@strudel` haps (#479): the doubled model serializes to
 * onsets byte-identical to the source — `bd ~ sn ~ bd` and its ×2 both query to
 * `[0, 0.4, 0.8]`; `note("c3 e3 g3")` and `note("c3@2 e3@2 g3@2")` both to
 * `[0, ⅓, ⅔]`. Roll notes scale duration too (a held `@n` keeps its time span).
 *
 * Pure (no React, no DOM), in the `notation/` model-op family alongside
 * `lane.ts` / `place.ts` / `resize.ts`: a transform returns the SAME model
 * reference when it can't apply, so `useGridModel.mutate` skips the write and
 * the document is left untouched.
 */
import { cellOn, clampLane, isCellOn, scaleCell } from './model'
import type {
  AltSource,
  GridCells,
  NotationSource,
  PianoRollModel,
  RollNote,
  StepCell,
  StepGridModel,
} from './model'
import { ifGridSpellable, ifRollSpellable } from './serialize'
import {
  absorbViewScale,
  MAX_VIEW_STEPS,
  UNREFINED,
  documentSteps,
  type ViewScale,
} from './viewResolution'

/** which way the resolution control scales the grid */
export type ResolutionDir = 'double' | 'halve'

/**
 * Cap on the doubled column count. A flat grid past this is unwieldy to edit and
 * the serialized mini grows linearly, so `canDouble*` stops here rather than let
 * repeated ×2 run away. 256 columns = a 16-bar 1/16 grid, well beyond the grids'
 * editable range.
 */
export const MAX_RESOLUTION_STEPS = 256

/** columns per bar (≥1); 1 when single-cycle. Used to keep `<...>` bars integral. */
function perBar(steps: number, bars?: number): number {
  return bars && bars > 0 ? steps / bars : steps
}

/* ── step grid ─────────────────────────────────────────────────── */

/**
 * ── STRUCTURE vs SPELLABILITY ──────────────────────────────────────────────────
 * The `structurallyCan*` predicates below are the op's own arithmetic: is there an
 * integer grid to scale onto, and does ÷2 drop information. They are PRIVATE, because
 * they are only half of "can this op apply". The other half — can the writer SPELL the
 * result — is asked of the real writer by `ifGridSpellable`, and the exported `can*`
 * predicates are derived from the composed op so that the two can never disagree.
 * See `ifGridSpellable` in `serialize.ts` for why the prediction had to stop (#1010 P4c).
 */
function structurallyCanDouble(model: StepGridModel): boolean {
  return model.steps >= 1 && model.steps * 2 <= MAX_RESOLUTION_STEPS
}

/**
 * ÷2 drops no information only when nothing lives on the odd columns: every lane's
 * odd cells are empty AND every odd per-column gain is neutral. Multi-bar grids
 * also need an even columns-per-bar so each `<...>` slot stays integral.
 */
function structurallyCanHalve(model: StepGridModel): boolean {
  if (model.steps < 2 || model.steps % 2 !== 0) return false
  if ((model.bars ?? 1) > 1 && perBar(model.steps, model.bars) % 2 !== 0) return false
  const oddCellEmpty = model.lanes.every((lane) =>
    lane.cells.every((cell, i) => i % 2 === 0 || !isCellOn(cell)),
  )
  if (!oddCellEmpty) return false
  if (model.gains) {
    if (!model.gains.every((g, i) => i % 2 === 0 || g === 1)) return false
  }
  return true
}

/**
 * Scale a step grid's resolution. `double` splits each column in two (odd columns
 * inserted empty / neutral); `halve` merges pairs back, keeping the even column.
 * Returns the model unchanged when the direction can't apply (so `mutate` skips) —
 * which now includes "the writer cannot spell the result", not only the arithmetic.
 */
export function scaleStepGrid(model: StepGridModel, dir: ResolutionDir): StepGridModel {
  if (dir === 'double') {
    if (!structurallyCanDouble(model)) return model
    return ifGridSpellable(model, {
      ...model,
      steps: model.steps * 2,
      lanes: model.lanes.map((lane) => ({
        ...lane,
        cells: lane.cells.flatMap((cell): StepCell[] => [scaleCell(cell, 2), false]),
      })),
      ...(model.gains ? { gains: model.gains.flatMap((g) => [g, 1]) } : {}),
    })
  }
  if (!structurallyCanHalve(model)) return model
  return ifGridSpellable(model, {
    ...model,
    steps: model.steps / 2,
    lanes: model.lanes.map((lane) => ({
      ...lane,
      cells: lane.cells.filter((_, i) => i % 2 === 0).map((cell) => scaleCell(cell, 0.5)),
    })),
    ...(model.gains ? { gains: model.gains.filter((_, i) => i % 2 === 0) } : {}),
  })
}

/**
 * Can the control offer ×2 / ÷2 at all — asked of the composed op, so an enabled
 * control and a working one are the same statement. `canScaleStepGridTo` has always
 * been spelled this way; these two used to predict instead, and a prediction is what
 * left the ÷2 button present and dead on every unit that offered it.
 */
export function canDoubleStepGrid(model: StepGridModel): boolean {
  return scaleStepGrid(model, 'double') !== model
}
export function canHalveStepGrid(model: StepGridModel): boolean {
  return scaleStepGrid(model, 'halve') !== model
}

/* ── piano roll ────────────────────────────────────────────────── */

/** the roll's own arithmetic — private, for the same reason the grid's is (see above) */
function structurallyCanDoubleRoll(model: PianoRollModel): boolean {
  return model.steps >= 1 && model.steps * 2 <= MAX_RESOLUTION_STEPS
}

/**
 * ÷2 drops nothing only when every note sits on an even column AND spans an even
 * number of columns (so halving keeps integer start/duration). Multi-bar rolls also
 * need an even columns-per-bar.
 *
 * This one has always been written as a question about what the NOTATION can carry —
 * `RollNote.duration` counts whole steps, so an odd `@n` has no halved spelling
 * ([[PV240]]'s admissibility corollary). That is the same question `ifRollSpellable`
 * asks, arrived at by hand; keeping both costs nothing and the derived predicate below
 * is what guarantees they agree.
 */
function structurallyCanHalveRoll(model: PianoRollModel): boolean {
  if (model.steps < 2 || model.steps % 2 !== 0) return false
  if ((model.bars ?? 1) > 1 && perBar(model.steps, model.bars) % 2 !== 0) return false
  return model.notes.every((n) => n.start % 2 === 0 && n.duration % 2 === 0)
}

export function canDoublePianoRoll(model: PianoRollModel): boolean {
  return scalePianoRoll(model, 'double') !== model
}
export function canHalvePianoRoll(model: PianoRollModel): boolean {
  return scalePianoRoll(model, 'halve') !== model
}

/**
 * Scale a piano roll's resolution. Every note's start AND duration scale with the
 * grid, so a note keeps its time span (a held `@n` doubles to `@2n`) and onsets
 * are preserved (#479, hap-verified). Returns the model unchanged when the
 * direction can't apply.
 */
export function scalePianoRoll(model: PianoRollModel, dir: ResolutionDir): PianoRollModel {
  if (dir === 'double') {
    if (!structurallyCanDoubleRoll(model)) return model
    return ifRollSpellable(model, {
      ...model,
      steps: model.steps * 2,
      notes: model.notes.map((n) => ({ ...n, start: n.start * 2, duration: n.duration * 2 })),
    })
  }
  if (!structurallyCanHalveRoll(model)) return model
  return ifRollSpellable(model, {
    ...model,
    steps: model.steps / 2,
    notes: model.notes.map((n) => ({ ...n, start: n.start / 2, duration: n.duration / 2 })),
  })
}

/* ── absolute slot-count targets (the 4 / 8 / 16 / 32 / 64 control) ── */

/**
 * The absolute slot counts the "Slots" control offers. Clicking one SETS the
 * grid to that column count. When the target is a power-of-2 ratio of the current
 * count it's a lossless ×2/÷2 (`scaleStepGridTo`/`scalePianoRollTo`); otherwise
 * the grid QUANTIZES — every note snaps to the nearest of the new slots and
 * notes that collide merge (`quantizeStepGridTo`/`quantizePianoRollTo`). So any
 * pattern can be coarsened to any preset (a 64-step choir → 16), at the cost of
 * timing for the non-lossless cases — the control marks which is which.
 */
export const RESOLUTION_PRESETS = [4, 8, 16, 32, 64] as const

/** is n a power of two (≥1)? */
function isPow2(n: number): boolean {
  return n >= 1 && Number.isInteger(n) && (n & (n - 1)) === 0
}

/**
 * Drive a grid to an absolute `target` column count by repeated ×2 / ÷2. Only a
 * power-of-2 ratio to the current count is reachable, and every halving on the
 * way down must be lossless (`scale` returns its input unchanged when it can't
 * halve / would exceed the cap → we abort to the ORIGINAL model). Returns the
 * model unchanged when the target isn't losslessly reachable, so the control
 * disables it and `mutate` skips the write.
 */
function scaleTo<M extends { steps: number }>(
  model: M,
  target: number,
  scale: (m: M, dir: ResolutionDir) => M,
): M {
  if (target < 1 || target === model.steps) return model
  const up = target > model.steps
  const ratio = up ? target / model.steps : model.steps / target
  if (!isPow2(ratio)) return model
  let cur = model
  while (cur.steps !== target) {
    const next = scale(cur, up ? 'double' : 'halve')
    if (next === cur) return model // a halving wasn't lossless (or hit the cap)
    cur = next
  }
  return cur
}

export function scaleStepGridTo(model: StepGridModel, target: number): StepGridModel {
  return scaleTo(model, target, scaleStepGrid)
}
export function scalePianoRollTo(model: PianoRollModel, target: number): PianoRollModel {
  return scaleTo(model, target, scalePianoRoll)
}

/** can the step grid losslessly reach exactly `target` columns? (false for the current count) */
export function canScaleStepGridTo(model: StepGridModel, target: number): boolean {
  return target !== model.steps && scaleStepGridTo(model, target) !== model
}
export function canScalePianoRollTo(model: PianoRollModel, target: number): boolean {
  return target !== model.steps && scalePianoRollTo(model, target) !== model
}

/* ── quantize-set: snap any pattern onto a target slot count ────── */

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** the bucket a source column `c` of `from` slots maps onto in `to` slots */
const bucket = (c: number, from: number, to: number): number =>
  clampInt(Math.round((c * to) / from), 0, to - 1)

/**
 * WHAT SETTING THE GRID TO `target` DID TO THE NOTES — reported by the op, never
 * reconstructed from its output (#1061).
 *
 * The control has to tell the user what a press costs BEFORE they make it, and a
 * press can cost four different things independently (a roll's FINER press too: its
 * snapped onsets can crowd a note, #1948). `SlotState` names the
 * MECHANISM (`lossless` / `quantize`); this names the CONSEQUENCES, which is what the
 * copy is actually about. Splitting them is deliberate: one control with one label
 * covering several effects is what left the last gate certifying a control that no
 * longer existed, and widening a single verdict until the arithmetic comes out buries
 * the very distinction the user needs.
 *
 * Every field is counted inside the op, at the step that decides it — the two length
 * counts after the merge and the clamp, on the note that is written — so a caller cannot
 * describe a write the op did not make. A DECLINED op reports `NO_RESOLUTION_EFFECT` — nothing happened, so
 * nothing is claimed.
 */
export interface GridResolutionEffect {
  /**
   * notes held at one column because scaling would have put them BELOW one, and the
   * grid has no spelling for half a column. These sound LONGER than they did — the
   * length grows to the coarsest thing the new grid can say (#1061). Counted on the note
   * a column KEEPS, like `shortened`: a floored note that merged away is `merged` (#1968).
   */
  lengthened: number
  /** notes whose onset moved off its exact proportional position — i.e. timing changed */
  snapped: number
  /** notes that landed on a column their own lane had already filled, and merged */
  merged: number
  /**
   * notes written SHORTER than their exact scaled length (#1948): cut to the next onset
   * that snapped closer, rounded down to whole columns (roll), or given the shorter length
   * of whatever merged or stacked with them. Compared against the note's OWN source — the
   * one that kept the column — so a note that merged away is `merged`, not this.
   */
  shortened: number
}

/** the effect of a press that writes nothing — one value, so no caller spells it with a field missing */
export const NO_RESOLUTION_EFFECT: GridResolutionEffect = Object.freeze({
  lengthened: 0,
  snapped: 0,
  merged: 0,
  shortened: 0,
})

/**
 * The roll compares positions and lengths computed as `x * target / from`, which can
 * miss an exact whole number by a rounding error. Below this, the two are equal.
 */
const EFFECT_EPS = 1e-9

/**
 * THE COARSENING FLOOR (#1061). Below one column the grid has no spelling for a
 * length, and until now the whole op declined there — correct about the notation and
 * wrong as a product: a user typing `bd ~ ~ ~ sn ~ ~ ~` and asking for 4 slots is
 * asking for `bd ~ sn ~`, and got a greyed button with no explanation.
 *
 * So a note that would go sub-column keeps ONE column of the new grid instead. Nothing
 * is lost — the length grows to the coarsest thing the new grid can spell — and it can
 * never overlap, because one column is the minimum a note can occupy. The reason this
 * is honest now and was not before is #1056: the panel DRAWS note length, so a change
 * to it is a change the user can watch happen rather than one made behind their back.
 *
 * A note that already scales cleanly never reaches this — `bd _ ~ ~` → `bd ~` is
 * byte-identical either way.
 */
const COARSEN_FLOOR = 1

/**
 * Set a step grid to exactly `target` columns by quantizing: each ON cell snaps
 * to the nearest target column, several hits in a column collapse to one (OR),
 * and a bucket's gain is the loudest source hit that lands in it. Lossless when
 * `target` is a power-of-2 ratio (identical to `scaleStepGridTo`); a quantize
 * otherwise. Single-bar only — a multi-bar `<...>` grid keeps the lossless path
 * (a target that isn't bar-aligned can't serialize). Returns the model unchanged
 * for the current count, an invalid target, or multi-bar.
 */
export function quantizeStepGridToWithEffect(
  model: StepGridModel,
  target: number,
): { model: StepGridModel; effect: GridResolutionEffect } {
  const unchanged = { model, effect: NO_RESOLUTION_EFFECT }
  if (target < 1 || target > MAX_RESOLUTION_STEPS || target === model.steps) return unchanged
  if ((model.bars ?? 1) > 1) {
    // A multi-bar grid keeps the strictly-lossless path, which by definition scales
    // every length cleanly — so there is no floor to apply and nothing to report.
    const scaled = scaleStepGridTo(model, target)
    return scaled === model ? unchanged : { model: scaled, effect: NO_RESOLUTION_EFFECT }
  }
  const from = model.steps
  const addingSlots = target > from
  let lengthened = 0
  let snapped = 0
  let merged = 0
  let shortened = 0
  const lanes = model.lanes.map((lane) => {
    const cells = Array<StepCell>(target).fill(false)
    // the exact length of the source that took each column first — the note the column
    // keeps; the floor can grow it and the merge and the clamp can each cut it, so both
    // directions are compared at the end, on the note that is written (#1948, #1968)
    const keptExact: (number | undefined)[] = Array(target)
    lane.cells.forEach((cell, c) => {
      if (!isCellOn(cell)) return
      const b = bucket(c, from, target)
      // The onset's EXACT proportional position. `bucket` rounds to the nearest column,
      // so any disagreement here is timing the user will hear move — counted at the one
      // place that knows both numbers.
      if (b !== (c * target) / from) snapped++
      // SCALE FIRST, then merge. Coarsening scales every length by `target / from`;
      // merging takes the SHORTEST, so a merged note never sounds longer than one of
      // the notes it stands for (the choice `quantizePianoRollTo` makes for a chord).
      // Doing it the other way round rescales a value already scaled by an earlier
      // source cell in the same bucket — 1 and 1 columns became 0.25 instead of 0.5.
      // Refining keeps the COLUMN count instead (#607, the roll's rule): the onset is
      // preserved and the note simply no longer spans the widened gap.
      const exact = addingSlots ? cell.duration : cell.duration * (target / from)
      // …and the floor is applied AFTER the scale and BEFORE the merge, so a merge still
      // takes the shortest of two lengths the grid can actually spell.
      const scaled = addingSlots ? exact : Math.max(COARSEN_FLOOR, exact)
      const prev = cells[b]
      if (isCellOn(prev)) merged++
      else keptExact[b] = exact
      cells[b] = cellOn(isCellOn(prev) ? Math.min(prev.duration, scaled) : scaled)
    })
    const clamped = clampLane(cells, target)
    clamped.forEach((cell, b) => {
      const exact = keptExact[b]
      if (!isCellOn(cell) || exact === undefined) return
      if (cell.duration - exact > EFFECT_EPS) lengthened++
      if (exact - cell.duration > EFFECT_EPS) shortened++
    })
    return { ...lane, cells: clamped }
  })
  let gains: number[] | undefined
  if (model.gains) {
    gains = Array<number>(target).fill(1)
    const filled = new Set<number>()
    for (let c = 0; c < from; c++) {
      if (!model.lanes.some((l) => isCellOn(l.cells[c]))) continue // only audible columns carry gain
      const b = bucket(c, from, target)
      const g = model.gains[c] ?? 1
      gains[b] = filled.has(b) ? Math.max(gains[b], g) : g
      filled.add(b)
    }
  }
  // The floor removes the sub-column refusal, not the admissibility rule: a length that
  // scales to a NON-INTEGER number of columns (3 columns of 8 → 1.5 of 4) still has no
  // spelling, and is still declined here rather than rounded into a different pattern.
  const next = ifGridSpellable(model, {
    ...model,
    steps: target,
    lanes,
    ...(gains ? { gains } : {}),
  })
  // A declined op made no write, so it reports no effect — the counters above describe
  // a candidate, and a candidate the writer refused never reaches the user.
  return next === model ? unchanged : { model: next, effect: { lengthened, snapped, merged, shortened } }
}

/** the plain projection of {@link quantizeStepGridToWithEffect} — the model it produced */
export function quantizeStepGridTo(model: StepGridModel, target: number): StepGridModel {
  return quantizeStepGridToWithEffect(model, target).model
}

/**
 * What pressing `target` would cost, for the control's copy. Asked of the op itself so
 * the sentence the user reads and the write they get cannot describe different things.
 */
export function stepResolutionEffect(model: StepGridModel, target: number): GridResolutionEffect {
  return quantizeStepGridToWithEffect(model, target).effect
}

/**
 * Set a piano roll to exactly `target` columns by quantizing. Each note's START
 * snaps proportionally onto the new grid (`bucket`), so the timing stays
 * relatively justified in both directions. The DURATION is CONSERVATIVE when
 * ADDING slots (#607): a note keeps its slot-count instead of stretching to fill
 * the finer grid, so a 1-slot note stays 1 slot and a held `@n` stays `@n` — the
 * onset is preserved, the note simply no longer spans the widened gap. When
 * REDUCING slots the duration scales DOWN proportionally so a coarser grid can't
 * push a note out of range. Notes that collide on a column merge (same pitch →
 * one; different pitches → a chord sharing the column's duration), and durations
 * are clamped so nothing overlaps or runs past the grid — the result always
 * serializes (no silent drop). A multi-bar `<…>` grid stays power-of-2 only;
 * ADDING slots there is conservative too (#607 — each start doubles, duration
 * kept), REDUCING keeps the lossless ×2 halve. Returns the model unchanged for
 * the current count or an unreachable target.
 *
 * Reports what it did the way {@link quantizeStepGridToWithEffect} does (#1933): each
 * count is taken in the step that causes it, and a declined op reports `NO_RESOLUTION_EFFECT`.
 */
export function quantizePianoRollToWithEffect(
  model: PianoRollModel,
  target: number,
): { model: PianoRollModel; effect: GridResolutionEffect } {
  const unchanged = { model, effect: NO_RESOLUTION_EFFECT }
  if (target < 1 || target > MAX_RESOLUTION_STEPS || target === model.steps) return unchanged
  if ((model.bars ?? 1) > 1) {
    // Neither multi-bar path costs anything the control reports: the reduce is the
    // lossless halve, and the add doubles every start exactly and keeps each length.
    const next = quantizeMultiBarRoll(model, target)
    return next === model ? unchanged : { model: next, effect: NO_RESOLUTION_EFFECT }
  }
  const from = model.steps
  const addingSlots = target > from
  let snapped = 0
  let merged = 0
  let lengthened = 0
  let shortened = 0
  // 1. map each note onto the target grid: the START snaps proportionally; the
  //    DURATION keeps its slot-count when ADDING slots (conservative, #607 — no
  //    stretch) and scales down proportionally when REDUCING (stays in range).
  const q = model.notes
    .map((n) => {
      const start = bucket(n.start, from, target)
      // the onset's exact proportional position; any distance from it is timing moved
      if (Math.abs(start - (n.start * target) / from) > EFFECT_EPS) snapped++
      // the length the new grid gives this note before any rounding, floor or clamp
      const exact = addingSlots ? n.duration : (n.duration * target) / from
      return {
        pitch: n.pitch,
        start,
        duration: addingSlots ? Math.max(1, n.duration) : Math.max(1, Math.round(exact)),
        exact,
        gain: n.gain ?? 1,
      }
    })
    .sort((a, b) => a.start - b.start)
  // 2. group by start column, dropping a same-pitch collision (keep the first)
  const byCol = new Map<number, { pitch: string; duration: number; exact: number; gain: number }[]>()
  for (const n of q) {
    const grp = byCol.get(n.start) ?? []
    if (grp.some((m) => m.pitch === n.pitch)) {
      merged++
      continue
    }
    grp.push({ pitch: n.pitch, duration: n.duration, exact: n.exact, gain: n.gain })
    byCol.set(n.start, grp)
  }
  // 3. emit, clamping each group's shared duration to the next start (no overlap)
  const starts = [...byCol.keys()].sort((a, b) => a - b)
  const notes: RollNote[] = []
  starts.forEach((start, i) => {
    const limit = (i + 1 < starts.length ? starts[i + 1] : target) - start
    const grp = byCol.get(start)!
    const duration = clampInt(Math.min(...grp.map((m) => m.duration)), 1, limit)
    const gain = Math.max(...grp.map((m) => m.gain)) // a chord shares one gain
    for (const m of grp) {
      // Counted on the length the note is EMITTED with: the floor and the rounding can
      // lengthen it, and the clamp to the next start can take that back. The rounding,
      // the chord's shortest length and the clamp can each make it shorter (#1948).
      if (duration - m.exact > EFFECT_EPS) lengthened++
      if (m.exact - duration > EFFECT_EPS) shortened++
      notes.push({ pitch: m.pitch, start, duration, gain })
    }
  })
  const next = ifRollSpellable(model, { ...model, steps: target, notes })
  return next === model ? unchanged : { model: next, effect: { lengthened, snapped, merged, shortened } }
}

/**
 * Multi-bar `<…>`: only power-of-2 targets are offered (slotState disables the rest — an
 * off-bar count can't serialize). ADDING slots is conservative like the single-bar path
 * (#607): each note's start doubles (keeping the columns-per-bar integral) but its
 * DURATION is kept, so a 1-slot note stays 1 slot. REDUCING keeps the lossless ×2 halve.
 */
function quantizeMultiBarRoll(model: PianoRollModel, target: number): PianoRollModel {
  if (target <= model.steps) return scalePianoRollTo(model, target)
  if (!isPow2(target / model.steps)) return model
  let cur = model
  while (cur.steps < target) {
    cur = { ...cur, steps: cur.steps * 2, notes: cur.notes.map((n) => ({ ...n, start: n.start * 2 })) }
  }
  // This branch KEEPS each duration while doubling the starts (#607), so a note can end
  // up spanning less of the widened grid than the next start allows — and on a multi-bar
  // `<…>` the result is not always spellable. Gated like every other op rather than
  // trusted: it was the one path in this file still returning unchecked (found by the
  // op-admissibility sweep, 52 unwritable results, all from here).
  return ifRollSpellable(model, cur)
}

/** the plain projection of {@link quantizePianoRollToWithEffect} — the model it produced */
export function quantizePianoRollTo(model: PianoRollModel, target: number): PianoRollModel {
  return quantizePianoRollToWithEffect(model, target).model
}

/**
 * What pressing `target` would cost on the piano roll, asked of the op the press runs —
 * the roll's {@link stepResolutionEffect} (#1933).
 */
export function rollResolutionEffect(model: PianoRollModel, target: number): GridResolutionEffect {
  return quantizePianoRollToWithEffect(model, target).effect
}

/* ── the free zone: a finer target is a VIEW change, not a rewrite (#1057) ── */

/**
 * THE FREE ZONE — where asking to look more closely must not rewrite your file.
 *
 * `bd ~ sn ~` + "Slots 16" used to write `bd ~ ~ ~ ~ ~ ~ ~ sn ~ ~ ~ ~ ~ ~ ~`. No note
 * was placed; the user expressed a VIEW preference and their document was rewritten.
 * #1052 settled the rule that fixes it: **refining is a view change, coarsening edits
 * your document.**
 *
 * A target is in the free zone when it is the document's own column count or a whole
 * multiple of it — because that is exactly when the same notation can be DRAWN at the
 * target without respelling anything. The returned value is the view scale that draws
 * it, so `target === documentSteps` yields `UNREFINED` and refining is reversible: the
 * user can always come back to the document's own resolution the same way they left it.
 *
 * ⚠ ASKED OF `documentSteps`, NEVER `model.steps`. `model.steps` is what is DRAWN, so at
 * scale 2 on a 4-column document it reads 8 — and a free zone keyed off it would call
 * "16" a ×2 refine when it is really ×4, i.e. the offer would depend on how closely the
 * user happened to be looking. Same hazard [[PV260]] names for the stored value.
 *
 * ⚠ ARITHMETIC ONLY — this says a view is REPRESENTABLE, never that the parser will
 * actually draw it. Four projections refuse a finer view (#1117), so an offer made on
 * this answer alone would ship exactly the dead buttons #1010 P4c had to repair: a
 * control whose enabled state was PREDICTED rather than asked. The composed offer lives
 * in `slotState` behind `canDrawView`, which is the same private-arithmetic /
 * ask-the-real-subsystem split `structurallyCan*` and `ifGridSpellable` already use
 * above — and the default is "no free zone", so a caller that cannot prove it never
 * offers it.
 *
 * Bounded by the VIEW ceiling rather than the document's: refining expands nothing in
 * the notation, so `MAX_STEPS` (a document-expansion guard) is the wrong question and
 * `MAX_VIEW_STEPS` is the right one — `viewResolution.ts` argues this at length.
 */
export function freeZoneScale(docSteps: number, target: number): ViewScale | null {
  if (!Number.isInteger(docSteps) || docSteps < 1) return null
  if (target < docSteps || target % docSteps !== 0) return null
  if (target > MAX_VIEW_STEPS) return null
  return target / docSteps
}

/**
 * WHAT RESOLUTION SHOULD A WRITE SPELL? (#1057)
 *
 * While the view is refined the panel holds a model drawn `k×` finer than the file,
 * and serializing THAT model spells every column at the drawn resolution. Which is
 * right when the edit actually used one of the new columns — and wrong when it did
 * not. A velocity drag never does: it changes `gain` and leaves every onset exactly
 * where the document already put it, yet it would still respell `bd ~ sn ~` as
 * `bd _ ~ ~ sn _ ~ ~` and widen the `.gain` mini to match. That is the same harm the
 * free zone exists to prevent — a file rewritten to record how closely someone was
 * looking — arriving through a different gesture.
 *
 * So a write asks this FIRST: can what I am about to write be said at the document's
 * own resolution? The question is already answered by the ÷k guard the resolution
 * control uses, because a refinement is an exact `k×` embedding — an edit that stayed
 * on the document's grid collapses cleanly, and one that did not cannot.
 *
 * ⚠ NOTE LENGTH IS THE DISCRIMINATOR, and it is why this needs no new rule. A note
 * placed in a column that exists only in the view is shorter than any column the
 * document can spell, so the guard refuses and the finer spelling is written
 * (`bd ~ sn ~` + a hit at drawn column 1 → `[bd bd] ~ sn ~`). A gain change leaves
 * every note its inherited `k` columns, so it halves exactly back to the source.
 *
 * Returns the model expressed at the document's resolution, or `null` when the edit
 * genuinely needs the finer spelling. An UNREFINED model is returned unchanged —
 * there is nothing to collapse, which is the case every pre-#1057 caller is in.
 */
export function collapseStepGridToDocument(model: StepGridModel): StepGridModel | null {
  if (model.viewScale === undefined) return model
  const docSteps = documentSteps(model)
  if (docSteps === model.steps) return absorbViewScale(model)
  if (!canScaleStepGridTo(model, docSteps)) return null
  return absorbViewScale(
    descaleSource(scaleStepGridTo(model, docSteps), model.viewScale, descaleGridCells),
  )
}

/** the roll's half of `collapseStepGridToDocument` — one rule, both surfaces */
export function collapsePianoRollToDocument(model: PianoRollModel): PianoRollModel | null {
  if (model.viewScale === undefined) return model
  const docSteps = documentSteps(model)
  if (docSteps === model.steps) return absorbViewScale(model)
  if (!canScalePianoRollTo(model, docSteps)) return null
  return absorbViewScale(
    descaleSource(scalePianoRollTo(model, docSteps), model.viewScale, descaleRollNotes),
  )
}

/* ── the SOURCE half of the inverse (#1121) ─────────────────────── */

/**
 * WHY THE COLLAPSE CANNOT BE THE RESOLUTION OP ALONE.
 *
 * `scale*To` above is the DOCUMENT's resolution control: "produce a grid at N columns".
 * It is entitled to reach that count and let the writer rebuild the notation, because
 * that is precisely what the user asked for when they clicked ÷2 — the old spelling is
 * the thing being changed.
 *
 * Used as the inverse of a VIEW refine it is too strong, and it fails in a way no
 * column-count assertion can see. It scales `steps`, cells, gains and notes, and spreads
 * `source` / `altSource` through UNTOUCHED — so a model back at 8 columns still carries a
 * source description that says `div=4`, i.e. 16. The writer's covers-check correctly
 * refuses a description that no longer describes the grid and falls to the rebuild, and
 * the rebuild is the flat spelling: `[- - - -] [cp - - -] …` came back
 * `~ ~ ~ ~ cp ~ ~ ~ …`, with `steps` right and every note in the right place.
 *
 * So the inverse has TWO halves and the op above is only one of them. The source
 * description is scaled by the refine exactly as the cells are (`div`, each region's
 * `[from, to)`, and the view content each region remembers), so undoing the refine means
 * undoing it there too — the same rule, asked of the second carrier.
 *
 * `leafSource` is deliberately absent, and the reason is STRUCTURAL rather than
 * observed: `parse.ts`'s total gate refuses to hand back any model that does not
 * report the scale it was asked for, and the leaf path anchors each note to its own
 * source span so it has no span to subdivide and carries no scale. A leaf model
 * therefore cannot reach here with a `viewScale` at all — the corpus gate's shape set
 * (which also has no `leaf` row) confirms that, it does not establish it. If that gate
 * ever changes, a stale `leafSource` would splice at refined spans, so the two must
 * move together.
 *
 * ⚠ `surgical` IS REACHABLE HERE WITH A `viewScale`, AND IT IS THE FIRST THING THAT EVER
 * WAS (#1010 P4d). The paragraph above was written when leaf spans and the leaf VIEW were
 * the same field, so "cannot carry a scale" followed from the projection. `surgical`
 * separates them: it overlays leaf spans on a view the element writer owns, and that view
 * refines normally, so a refined model now arrives here carrying spans indexed to the
 * DOCUMENT's columns.
 *
 * It is deliberately NOT scaled by the halves below, and that is the safe direction rather
 * than an omission. The spans index source BYTES and hold one entry per document column,
 * so there is nothing in them a refine could have multiplied — scaling them is what would
 * make them wrong. What decides whether they may be used is `anchorsDescribe`
 * (`serialize.ts`), which requires the anchored width to still describe the model: at the
 * refined width it does not, so the write refuses and the element writer answers exactly
 * as before; after this collapse the model is back at the document's own width and the
 * spans fit again. That is also what makes an edit spell the same whether or not the user
 * zoomed — attaching the overlay only at the unrefined scale broke that equivalence on
 * five corpus units before this was understood.
 *
 * So the invariant to keep is the WIDTH GUARD, not the absence of the field. If
 * `anchorsDescribe` is ever weakened to something that does not pin the layout, this
 * carrier starts splicing at refined spans — the failure the paragraph above predicts,
 * arriving through the field it does not name.
 *
 * THE ONE ASSUMPTION LEFT, stated because it is silent if wrong: every quantity here
 * divides by `k` exactly, because the refine is what multiplied them. A source that
 * did not come from this refine would yield a fractional `div` — which the writer's
 * covers-check rejects, so it degrades to the rebuild this fix exists to avoid rather
 * than to a wrong splice. Wrong-and-loud is not available here; wrong-and-old is.
 *
 * ⚠ K IS A POWER OF TWO, and that is a property of the offers rather than of this code.
 * Every target comes from `RESOLUTION_PRESETS` (all powers of two) and `freeZoneScale`
 * admits one only when it is a whole multiple of the document's own count — and only a
 * power-of-two count divides a power-of-two preset. `scale*To` refuses any other ratio,
 * so a hypothetical `k=3` view declines the collapse and writes the finer spelling. That
 * is unreachable today; generalising it would be untested surface.
 */
function descaleSource<M extends { source?: NotationSource<C>; altSource?: AltSource<C> }, C>(
  model: M,
  k: ViewScale,
  content: (c: C, k: ViewScale) => C,
): M {
  if (k === UNREFINED) return model
  if (model.altSource) {
    const a = model.altSource
    return {
      ...model,
      altSource: {
        ...a,
        perBar: a.perBar / k,
        div: a.div / k,
        regions: a.regions.map((r) => ({
          ...r,
          from: r.from / k,
          to: r.to / k,
          perBar: r.perBar.map((c) => content(c, k)),
        })),
      },
    }
  }
  if (model.source) {
    const s = model.source
    return {
      ...model,
      source: {
        ...s,
        parts: s.parts.map((p) => ({
          ...p,
          div: p.div / k,
          regions: p.regions.map((r) => ({
            ...r,
            from: r.from / k,
            to: r.to / k,
            content: content(r.content, k),
          })),
        })),
      },
    }
  }
  return model
}

/**
 * A region's remembered grid content, de-scaled — the same shape `scaleStepGrid`'s halve
 * applies to a lane: keep the columns the document itself spells, and give each cell back
 * the length it had before the view stretched it.
 */
const descaleGridCells = (cells: GridCells, k: ViewScale): GridCells =>
  cells
    .filter((_, i) => i % k === 0)
    .map((column) => column.map((cell) => ({ ...cell, duration: cell.duration / k })))

/** the roll's half — start and duration scale together, as they do in `scalePianoRoll` */
const descaleRollNotes = (notes: RollNote[], k: ViewScale): RollNote[] =>
  notes.map((n) => ({ ...n, start: n.start / k, duration: n.duration / k }))

/**
 * how setting the grid to `target` slots behaves, for the control's label/state.
 *
 * `view` is the free zone (#1057): the click changes only how finely the panel DRAWS
 * the pattern and leaves the document byte-identical. Every other member still writes.
 */
export type SlotState = 'active' | 'view' | 'lossless' | 'quantize' | 'disabled'

/**
 * `applies` is the DECIDING input, and it is the op itself rather than a prediction of it.
 *
 * This used to return `'quantize'` for any single-bar, non-lossless target — i.e. it enabled
 * the control and left the op to sort it out. That was the same prediction the `can<Op>`
 * predicates were making, in the one place it reaches a user: after #1010 P4c a coarsening
 * quantize declines, so the "Slots" button stayed clickable and did nothing. The control's
 * state now comes from whether the op it would run actually applies.
 */
function slotState(
  steps: number,
  docSteps: number,
  bars: number | undefined,
  lossless: boolean,
  applies: boolean,
  target: number,
  canDrawView: ((scale: ViewScale) => boolean) | undefined,
): SlotState {
  // `steps` is what is DRAWN, so "the one I am already looking at" is the right
  // reading of `active` — at scale 2 on a 4-column document the user sees 8 columns
  // and 8 is the live preset.
  if (target === steps) return 'active'
  // THE FREE ZONE COMES FIRST, and that ordering is the whole phase: every branch
  // below this line writes to the document, so a target that can be satisfied by
  // looking more closely must be taken off the writing path before it reaches them.
  // Offered only when a caller can PROVE the view draws — see `freeZoneScale`.
  if (canDrawView) {
    const scale = freeZoneScale(docSteps, target)
    if (scale !== null && canDrawView(scale)) return 'view'
  }
  if (lossless) return 'lossless'
  // MULTI-BAR, STATED RATHER THAN INHERITED (#1057 asks for this explicitly): a
  // `<…>` grid still cannot quantize off the bar grid, so a non-multiple target is
  // disabled exactly as before. What DID change is that its refines no longer fall
  // to this branch at all — a whole multiple is a view change above, and multi-bar
  // patterns are the ones that gained most from that, having never had a refine.
  if ((bars ?? 1) > 1) return 'disabled'
  return applies ? 'quantize' : 'disabled'
}

/**
 * A look-only model offers no other resolution (#1975): the one drawn is the one it
 * has. `lossless` would otherwise be offered from arithmetic on the columns alone and
 * the press would do nothing, because the writer declines.
 */
const lookOnlySlotState = (steps: number, target: number): SlotState =>
  target === steps ? 'active' : 'disabled'

/**
 * `canDrawView` is how the caller PROVES a finer view is really drawable — it is handed
 * a candidate scale and answers by asking the parser, not by predicting it. Omitting it
 * disables the free zone entirely, so every existing caller keeps today's behaviour
 * exactly and no offer is ever made on an unproven claim.
 */
export function stepSlotState(
  model: StepGridModel,
  target: number,
  canDrawView?: (scale: ViewScale) => boolean,
): SlotState {
  if (model.lookOnly) return lookOnlySlotState(model.steps, target)
  return slotState(
    model.steps,
    documentSteps(model),
    model.bars,
    canScaleStepGridTo(model, target),
    quantizeStepGridTo(model, target) !== model,
    target,
    canDrawView,
  )
}
export function rollSlotState(
  model: PianoRollModel,
  target: number,
  canDrawView?: (scale: ViewScale) => boolean,
): SlotState {
  if (model.lookOnly) return lookOnlySlotState(model.steps, target)
  return slotState(
    model.steps,
    documentSteps(model),
    model.bars,
    canScalePianoRollTo(model, target),
    quantizePianoRollTo(model, target) !== model,
    target,
    canDrawView,
  )
}
