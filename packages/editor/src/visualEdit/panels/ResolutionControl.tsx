/**
 * ResolutionControl — the "Slots" grid-resolution control shared by both grids
 * (#479, reshaped by #1059).
 *
 *     Slots   ÷2   [ 16 ]   ×2
 *                    ▲ double-click → 4 / 8 / 16 / 32 / 64
 *
 * ── WHY RELATIVE STEPS AND NOT ABSOLUTE PRESETS ───────────────────────────────
 * `RESOLUTION_PRESETS` are absolute counts — the right vocabulary for a document
 * op ("make this pattern 16 elements"), the wrong one for a VIEW derived from the
 * pattern's own resolution. A 3-element pattern's clean finer views are 6, 12, 24
 * and none of them is a preset, so under absolutes every offer it gets is a
 * rewrite. Measured over the corpus (#1059): 334 grid offers / 219 roll offers
 * still wrote the file for that reason alone, and a ×k vocabulary converts every
 * one of them — grid 96 of 96 units, roll 64 of 64, none stranded.
 *
 * `freeZoneScale` never needed changing for this: its only shape test is
 * `target % docSteps`, so it already admits any whole multiple. The picker was the
 * one layer still speaking absolutes.
 *
 * ── GROUNDED IN THE DAW STANDARD, NOT INFERRED ────────────────────────────────
 * This is Ableton's model. Live drives its grid with *Narrow Grid* (Cmd-1), which
 * doubles grid density, and *Widen Grid* (Cmd-2), which halves it — relative
 * stepping is the primary interaction, and the absolute value stays on screen as a
 * readout rather than as the thing you click. Logic likewise offers a Division
 * value (1/1 … 1/64) you can also pick directly. So: steps to move, readout to
 * know where you are, dropdown to jump.
 *
 * ⚠ THE READOUT IS A COUNT, NOT A NOTE VALUE, AND THAT IS A DELIBERATE DIVERGENCE.
 * Every DAW labels this "1/16". That label asserts the cycle is a 4/4 bar, which
 * Strudel does not guarantee — `cps` is free and a pattern can be any length — so
 * "1/16" would be true only by coincidence. "16 slots" is what we can actually
 * warrant.
 *
 * ── THE TWO ZONES, AND WHERE THE LINE BETWEEN THEM ACTUALLY SITS ──────────────
 * Every target this control offers falls in one of two zones, and the boundary is
 * ONE number: the count the DOCUMENT itself spells (`documentSteps`, not `steps` —
 * `steps` is what is currently drawn, which may be a refined view of it).
 *
 *     target  >=  document count   →  FREE.   Nothing is written. The panel just
 *                                     draws the same notation more or less finely.
 *     target  <   document count   →  WRITES. This is an edit to the user's file.
 *
 * ⚠ THE ZONE IS NOT THE DIRECTION. The natural reading of a ÷2 / ×2 pair is "up is
 * a view, down is a rewrite", and it is wrong in the half nobody looks at. Coming
 * back DOWN through a refined view is free the whole way to the document — that is
 * exactly what makes refining reversible, and `freeZoneScale(D, D)` returns
 * `UNREFINED` by construction to say so. Only going below the document is an edit.
 *
 * So ÷2 is not one control with one meaning. Standing on a ×4 view of a 4-column
 * pattern, ÷2 is free; standing on the document itself, the same button is an edit
 * (and on the grid, a refused one). Which is why every button here ASKS `slotState`
 * for its own target rather than deriving anything from the arrow it is drawn with.
 *
 * Measured over every standing a user can occupy (#1059 — 3571 grid standings,
 * 1982 roll):
 *   - ×2 upward .................. 3420 free / 82 refused (leaf units, by design)
 *   - ÷2 staying >= document ..... 2613 grid / 1438 roll, ALL free — not one write
 *                                  leaks into the descent
 *   - ÷2 below the document ...... grid 546 of 546 REFUSED; roll 223 live writes
 *
 * That last asymmetry is the two surfaces disagreeing honestly, not a bug: the grid
 * preserves note length, and half a column has no spelling, so the writer declines
 * and the control says so. The roll carries a duration natively and can write it.
 * Whether the grid should offer anything there at all is #1061's product call.
 *
 * ── HOW A TARGET IS DRAWN ─────────────────────────────────────────────────────
 * Every button asks `slotState` for the target it would apply — the SAME call the
 * grid runs on click, never a prediction of it. States:
 *   - `active`   — the current count (highlighted, not clickable);
 *   - `view`     — the free zone (#1057): a whole multiple of what the DOCUMENT
 *      spells, so the panel simply draws the same notation more finely and your
 *      file is not touched at all. Drawn normal, and the tooltip says so — a user
 *      deciding whether it is safe to press should not find out by pressing;
 *   - `lossless` — writes, but every hit keeps its position (haps identical);
 *   - `quantize` — writes, and notes snap to the nearest new slot, so timing moves;
 *   - `disabled` — not offered.
 *
 * ⚠ THE `~` CUE MEANS ONE THING: THIS IS ABOUT TO REWRITE YOUR FILE (#1059). It
 * used to mark `quantize` alone, i.e. "this changes your timing". Since Phase 4
 * refining never writes at all, the honest split is no longer straight-vs-quantized
 * but FREE-vs-WRITES — and `lossless` is on the writing side of it (2 live offers
 * on the roll, 0 on the grid). Cueing only `quantize` would leave a file-rewriting
 * button drawn exactly like a free one.
 */
import * as React from 'react'

import {
  RESOLUTION_PRESETS,
  NO_RESOLUTION_EFFECT,
  type GridResolutionEffect,
  type SlotState,
} from '../../codeView'

/**
 * Lift a grid's resolution control up to the Pattern inspector (#601). The grid
 * owns the model and the write-back; the inspector only RENDERS the buttons — so
 * each grid reports its `ResolutionControlProps` upward and `PatternPanel` pushes
 * them down to `MixerBody` (the same path `division`/Snap already takes).
 *
 * It re-lifts only when the slot COUNT changes — that's both the headline state
 * and the active highlight. `slotState`/`onScaleTo` are ref-backed so they always
 * read the latest model/mutate WITHOUT re-firing the lift, which keeps it
 * loop-free no matter whether the grid's model object is referentially stable
 * (PianoRollGrid's `scaleToSlots` is a fresh closure each render). `null` steps
 * (no grid-editable pattern) lifts `null`, and unmount clears it — so the
 * inspector shows Slots exactly when a grid is editable.
 */
export function useLiftResolution(
  steps: number | null,
  slotState: (target: number) => SlotState,
  onScaleTo: (target: number) => void,
  onResolution?: (r: ResolutionControlProps | null) => void,
  /**
   * LAST AND OPTIONAL because it is a surface's offer, not an obligation (#1061). Both
   * grids pass one (the roll since #1933); a surface that passes nothing gets copy that
   * falls back to the mechanism alone.
   * Held behind the same ref as the other two so it always reads the CURRENT model —
   * the lift re-fires on a `steps` change, and a plain closure would keep answering
   * about the model the grid had when it last resized.
   */
  effect?: (target: number) => GridResolutionEffect,
): void {
  const slotStateRef = React.useRef(slotState)
  slotStateRef.current = slotState
  const onScaleToRef = React.useRef(onScaleTo)
  onScaleToRef.current = onScaleTo
  const effectRef = React.useRef(effect)
  effectRef.current = effect
  const stableSlotState = React.useCallback((t: number) => slotStateRef.current(t), [])
  const stableScaleTo = React.useCallback((t: number) => onScaleToRef.current(t), [])
  // `undefined` has to survive the wrapper, or a surface that passes none would advertise an effect
  // reporter that answers with zeros — a claim of "no consequence" where the truth is
  // "not asked". The two must stay distinguishable at the prop.
  const hasEffect = effect !== undefined
  const stableEffect = React.useCallback(
    (t: number) => effectRef.current?.(t) ?? NO_RESOLUTION_EFFECT,
    [],
  )

  React.useEffect(() => {
    if (!onResolution) return
    onResolution(
      steps == null
        ? null
        : {
            steps,
            slotState: stableSlotState,
            onScaleTo: stableScaleTo,
            ...(hasEffect ? { effect: stableEffect } : {}),
          },
    )
  }, [steps, onResolution, stableSlotState, stableScaleTo, hasEffect, stableEffect])

  // Clear on unmount only (e.g. cursor leaves a grid pattern → grid unmounts) so
  // a steps change re-lifts in place without a null flicker.
  React.useEffect(() => {
    return () => onResolution?.(null)
  }, [onResolution])
}

/**
 * A memoized "does the parser really draw this at `scale`?" prover (#1057).
 *
 * The free zone is offered only on proof, and the proof is a real parse — the whole
 * point is that it cannot be predicted. But `slotState` is asked once per preset on
 * every render of the control, so the naive prover parses five times per render, at a
 * measured 0.84ms (grid) / 1.74ms (roll) per refined ask. That cost is fine per
 * GESTURE and wrong per FRAME, and nothing bounds how often this control re-renders.
 *
 * So the answers are cached per mini. The cache is keyed by the mini itself and thrown
 * away whenever it changes, which makes staleness unrepresentable rather than
 * something to remember to invalidate: a cached answer can only ever be read for the
 * exact string it was computed from. Bounded by construction — at most one entry per
 * preset, for one mini at a time.
 */
export function useViewProver(
  mini: string | null | undefined,
  parse: (mini: string, scale: number) => { ok: boolean },
): (scale: number) => boolean {
  const cacheRef = React.useRef<{ mini: string | null; answers: Map<number, boolean> }>({
    mini: null,
    answers: new Map(),
  })
  const parseRef = React.useRef(parse)
  parseRef.current = parse
  const key = mini ?? null
  return React.useCallback(
    (scale: number): boolean => {
      if (key == null) return false
      const c = cacheRef.current
      if (c.mini !== key) {
        c.mini = key
        c.answers = new Map()
      }
      const hit = c.answers.get(scale)
      if (hit !== undefined) return hit
      const answer = parseRef.current(key, scale).ok
      c.answers.set(scale, answer)
      return answer
    },
    [key],
  )
}

export interface ResolutionControlProps {
  /** current column count — the active preset */
  steps: number
  /** how setting the grid to `target` behaves (active / lossless / quantize / disabled) */
  slotState: (target: number) => SlotState
  /** scale the grid to `target` columns */
  onScaleTo: (target: number) => void
  /**
   * What pressing `target` would COST, asked of the op (#1061). `slotState` names the
   * mechanism; this names the consequences, and they are genuinely independent — a
   * coarsening can keep timing and still lengthen notes, or move timing and lengthen
   * nothing. Folding both into one label would hide whichever the user cared about.
   *
   * Optional, and the copy degrades to the mechanism alone without it. The step grid
   * and the piano roll (#1933) both supply it.
   */
  effect?: (target: number) => GridResolutionEffect
}

/** does this state write to the document? `active`/`disabled` do nothing at all. */
const writes = (s: SlotState): boolean => s === 'lossless' || s === 'quantize'
/** can the user press it? */
const pressable = (s: SlotState): boolean => s === 'view' || writes(s)

/**
 * One sentence per state, and the first clause of a writing one says so. #1059 asks
 * for the cue to mean "this rewrites your file" — so the copy has to lead with that
 * rather than with the timing consequence, which is a detail of HOW it rewrites.
 *
 * #1061 ADDS THE SECOND CONSEQUENCE, and it does not follow from the state. `quantize`
 * is the mechanism the op reaches for; whether it actually moves an onset, and whether
 * it holds a note at one column because the new grid cannot spell anything shorter, are
 * two more facts the op knows and the state does not carry. Reading them off `effect`
 * rather than inferring them from `state` is the whole point — a coarsening that keeps
 * every onset in place would otherwise be announced as "changes timing", which is the
 * kind of wrong that teaches users to ignore the label.
 */
function describeTarget(target: number, state: SlotState, effect?: GridResolutionEffect): string {
  switch (state) {
    case 'active':
      return `${target} slots (current)`
    case 'view':
      return `${target} slots — view only, your pattern is unchanged`
    case 'lossless':
    case 'quantize': {
      // `lossless` is lossless by construction. A `quantize` is only known to move
      // timing if the op says it did — and with no report we keep the old, cautious
      // wording rather than promise something we have not asked about.
      const keepsTiming =
        state === 'lossless' || (effect !== undefined && effect.snapped === 0 && effect.merged === 0)
      const lengths = lengthChange(effect)
      return keepsTiming
        ? `${target} slots — rewrites your file, keeps timing${lengths}`
        : `${target} slots — rewrites your file and snaps notes to the grid (changes timing)${lengths}`
    }
    default:
      return `${target} slots — unavailable`
  }
}

/**
 * The length clause: how many notes the press makes longer and how many shorter (#1948),
 * each named only when it happens. They are separate counts because they are separate
 * losses — a note held at one column sounds longer, a note cut to the next onset or to its
 * chord's shortest length sounds shorter — and one press can do both.
 */
function lengthChange(effect?: GridResolutionEffect): string {
  const notes = (n: number): string => `${n} note${n === 1 ? '' : 's'}`
  const longer = effect?.lengthened ?? 0
  const shorter = effect?.shortened ?? 0
  if (longer > 0 && shorter > 0) return `, and makes ${notes(longer)} longer and ${notes(shorter)} shorter`
  if (longer > 0) return `, and makes ${notes(longer)} longer`
  if (shorter > 0) return `, and makes ${notes(shorter)} shorter`
  return ''
}

/** shared visual language for anything that names a target */
function targetStyle(state: SlotState): React.CSSProperties {
  const active = state === 'active'
  return {
    background: active ? 'var(--accent, #6ea8fe)' : 'transparent',
    color: active
      ? '#fff'
      : pressable(state)
        ? 'var(--foreground, #e6e6ea)'
        : 'var(--foreground-muted, #a0a0aa)',
    // a writing target is dimmer + italic — the visible half of the `~` cue
    fontStyle: writes(state) ? 'italic' : 'normal',
    opacity: !active && !pressable(state) ? 0.4 : writes(state) ? 0.75 : 1,
    cursor: active ? 'default' : pressable(state) ? 'pointer' : 'not-allowed',
  }
}

export function ResolutionControl({
  steps,
  slotState,
  onScaleTo,
  effect,
}: ResolutionControlProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  // Close on any press outside, and on Escape. Registered only while OPEN so the
  // control costs nothing in its resting state.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // ⚠ ASKED OF `slotState`, NEVER COMPUTED. `steps / 2` and `steps * 2` are only
  // the TARGETS; whether either is free, writes, or is unavailable is the control's
  // decision and this reads it back. A halve of an odd count is not a target at all
  // — there is no integer grid to ask about.
  const halveTarget = steps % 2 === 0 ? steps / 2 : null
  const doubleTarget = steps * 2
  const halveState: SlotState = halveTarget === null ? 'disabled' : slotState(halveTarget)
  const doubleState: SlotState = slotState(doubleTarget)

  const stepButton = (
    dir: 'halve' | 'double',
    target: number | null,
    state: SlotState,
  ): React.ReactElement => {
    const label = dir === 'halve' ? '÷2' : '×2'
    // ASKED ONCE PER BUTTON, not once per attribute. `effect` runs the real op — a full
    // `quantizeStepGridTo` plus a `serializeStepGrid` over every lane — so calling it from
    // both the tooltip and the marker doubles that for every target on every render. Same
    // reason `placeable`/`coverage` hang off the model in `SequencerGrid` ([[P380]]): the
    // cost is invisible until something re-renders in a loop, and then it is the whole
    // frame budget.
    const eff = target === null ? undefined : effect?.(target)
    return (
      <button
        type="button"
        data-resolution-halve={dir === 'halve' ? 'true' : undefined}
        data-resolution-double={dir === 'double' ? 'true' : undefined}
        data-resolution-target={target ?? undefined}
        data-resolution-writes={writes(state) ? 'true' : undefined}
        data-resolution-view={state === 'view' ? 'true' : undefined}
        aria-label={dir === 'halve' ? 'halve slots' : 'double slots'}
        title={
          target === null
            ? `÷2 — unavailable on an odd slot count (${steps})`
            : describeTarget(target, state, eff)
        }
        data-resolution-lengthens={(eff?.lengthened ?? 0) > 0 ? 'true' : undefined}
        data-resolution-shortens={(eff?.shortened ?? 0) > 0 ? 'true' : undefined}
        disabled={!pressable(state)}
        onClick={() => {
          if (target !== null && pressable(state)) onScaleTo(target)
        }}
        style={{
          padding: '2px 7px',
          fontSize: 11,
          border: 'none',
          background: 'transparent',
          ...targetStyle(state),
          // a step button is never "active" — it is a move, not a destination
          color: pressable(state) ? 'var(--foreground, #e6e6ea)' : 'var(--foreground-muted, #a0a0aa)',
        }}
      >
        {writes(state) ? `~${label}` : label}
      </button>
    )
  }

  return (
    <div
      data-resolution-control
      ref={rootRef}
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, position: 'relative' }}
    >
      <span style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>Slots</span>
      <div
        role="group"
        aria-label="grid resolution"
        style={{
          display: 'inline-flex',
          alignItems: 'stretch',
          border: '1px solid var(--border, #3a3a42)',
          borderRadius: 4,
          overflow: 'visible',
        }}
      >
        {stepButton('halve', halveTarget, halveState)}
        {/*
          THE READOUT. Double-click opens the absolute presets, which is what the
          design asks for — but a control reachable only by double-click is
          unreachable from the keyboard, so Enter/Space open it too. That is an
          addition to the gesture, not a substitute for it.
        */}
        <button
          type="button"
          data-resolution-current={steps}
          data-resolution-presets-open={open ? 'true' : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${steps} slots — double-click for presets`}
          title={`${steps} slots (current) — double-click for presets`}
          onDoubleClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen((v) => !v)
            }
          }}
          style={{
            padding: '2px 10px',
            fontSize: 11,
            border: 'none',
            borderLeft: '1px solid var(--border, #3a3a42)',
            borderRight: '1px solid var(--border, #3a3a42)',
            background: 'var(--accent, #6ea8fe)',
            color: '#fff',
            cursor: 'pointer',
            minWidth: 34,
          }}
        >
          {steps}
        </button>
        {stepButton('double', doubleTarget, doubleState)}
      </div>

      {open && (
        <div
          role="listbox"
          data-resolution-presets
          aria-label="slot presets"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 96,
            border: '1px solid var(--border, #3a3a42)',
            borderRadius: 4,
            background: 'var(--background-elevated, #26262c)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}
        >
          {RESOLUTION_PRESETS.map((preset) => {
            const state: SlotState = preset === steps ? 'active' : slotState(preset)
            const eff = effect?.(preset) // once per preset — see `stepButton` for why
            return (
              <button
                key={preset}
                type="button"
                role="option"
                data-resolution-step={preset}
                data-resolution-active={state === 'active' ? 'true' : undefined}
                data-resolution-quantize={state === 'quantize' ? 'true' : undefined}
                data-resolution-writes={writes(state) ? 'true' : undefined}
                // the free zone is observable from the DOM: a spec can assert that
                // pressing this wrote nothing WITHOUT having to infer which state it was in
                data-resolution-view={state === 'view' ? 'true' : undefined}
                // #1061 — a coarsening that holds notes at one column is observable
                // from the DOM, so a spec asserts the CONSEQUENCE the user was promised
                // rather than re-deriving it from the pattern that came back.
                data-resolution-lengthens={(eff?.lengthened ?? 0) > 0 ? 'true' : undefined}
                data-resolution-shortens={(eff?.shortened ?? 0) > 0 ? 'true' : undefined}
                aria-selected={state === 'active'}
                aria-label={`${preset} slots`}
                title={describeTarget(preset, state, eff)}
                disabled={state !== 'active' && !pressable(state)}
                onClick={() => {
                  if (pressable(state)) onScaleTo(preset)
                  setOpen(false)
                }}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  border: 'none',
                  textAlign: 'left',
                  ...targetStyle(state),
                }}
              >
                {writes(state) ? `~${preset}` : preset}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
