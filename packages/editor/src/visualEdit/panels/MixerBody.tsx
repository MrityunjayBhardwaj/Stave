/**
 * MixerBody — the full per-chunk knob chain (#381 body, extracted for S4b).
 *
 * Given ONE chunk plus its write handlers, this renders the sound/kit picker,
 * the Snap picker (roll), the quick-transform row, and a Knob for every numeric
 * argument in the chain. It is binding-agnostic: the Pattern tab's `Mixer`
 * wrapper feeds it the cursor chunk (`useActiveChunk`), and the Mixer console's
 * `ExpandDrawer` feeds it a strip's chunk (`applyToStrip(id, …)`). Same body,
 * two bindings, zero duplicated write logic (the S4 redesign's whole point).
 *
 * Unlike the old `Mixer`, MixerBody does NOT early-return on an empty chain — it
 * always renders the body so an effect-less strip still shows the transforms row
 * (you can ADD an effect, then drag it). The standby for "no chunk under the
 * cursor" lives in the `Mixer` wrapper, which only mounts MixerBody once a chunk
 * exists. The catalog hooks live here (called unconditionally — MixerBody always
 * renders), so the wrapper can keep its own early-return.
 */
import * as React from 'react'

import { type ChunkInfo, type ChainCall } from '../../codeView'
import { type Writeback, commit } from '../../codeView'
import {
  type ChainArgRef,
  knobEdit,
  knobRangeEdit,
  knobRangeResetEdit,
  toggleCallEdit,
  removeNamedCall,
  readSoundCall,
  soundArgLabel,
  soundPickEdit,
  soundPickRefusal,
  type SoundArg,
} from '../../codeView'
import { Knob } from './Knob'
import { knobRangeFor, isKnownControl, isStrudelControl, customRange } from './knobRanges'
import { FAVORITES, isEffectActive, effectNames, type Effect } from './effectCatalog'
import { AddEffectMenu } from './AddEffectMenu'
import { SoundPickerMenu } from './SoundPickerMenu'
import { ResolutionControl, type ResolutionControlProps } from './ResolutionControl'
import { patternKind, rollShape } from '../../codeView'
import { type Division, DIVISIONS, isRepresentable, stepsPerBar } from './division'
import { chooserEnd } from '../../codeView'
import { INSTRUMENTS, DRUM_KITS } from './soundCatalog'
import { useSoundCatalog, useDrumKitCatalog } from '../../workspace/soundRegistry'
import { auditionSound } from '../audition'

/** one knob = one numeric argument of one chain call; the `ChainArgRef` half is
 *  the address its writes are made at */
interface KnobEntry extends ChainArgRef {
  label: string
  value: number
  /** the user-authored dial range from `.control(value, min, max)` (#844), when
   *  both extra args are present; undefined → the method's default range. */
  customRange?: { min: number; max: number }
  /** whether this dial's range can be edited via the double-click popup (#844).
   *  Only single-value controls qualify — their args 2+ are Strudel-ignored, so
   *  they can safely carry range metadata; a multi-arg function's args are real. */
  rangeEditable: boolean
}

/**
 * What a control's extra args mean for its dial (#844/#847). The guardrail: only
 * a shape we fully model is acted on — anything else is INERT, so unsupported
 * code in the text never spawns a broken dial nor lets the popup clobber it.
 *
 *  - 0 extra args → no custom range, but editable (double-click can ADD one).
 *  - exactly 2 FINITE numeric literals → that's the range; editable.
 *  - 1, 3+, or any non-numeric / non-finite slot → we don't model it: no custom
 *    range AND not editable (the range popup can't overwrite a signal/expr or
 *    extra args we didn't author).
 */
function rangeInfo(call: ChainCall): { customRange?: { min: number; max: number }; editable: boolean } {
  const extra = call.args.slice(1)
  if (extra.length === 0) return { editable: true }
  if (extra.length === 2) {
    const min = extra[0].numeric
    const max = extra[1].numeric
    if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
      return { customRange: { min, max }, editable: true }
    }
  }
  return { editable: false }
}

/**
 * Flatten a chunk's chain into the numeric-arg knobs it exposes. `pan` is always
 * skipped — the strip pan row owns it. `gain` is skipped too by default (the
 * strip fader owns it, #575 division of labor), EXCEPT when `includeGain` — a
 * nested stack voice (#620) whose gain the track-scoped strip fader doesn't
 * reach, so the inspector surfaces it as a per-voice fader knob.
 */
export function knobsFromChunk(chunk: ChunkInfo, includeGain = false): KnobEntry[] {
  const knobs: KnobEntry[] = []
  const chooser = chooserEnd(chunk.chain)
  chunk.chain.forEach((call, chainIndex) => {
    if (chainIndex < chooser) return // builds the number a `pick` chooses by, not a control (#2118)
    if (call.name === 'pan') return // pan lives on the strip pan row
    if (call.name === 'gain' && !includeGain) return // gain lives on the strip fader
    const numericArgs = call.args
      .map((a, argIndex) => ({ a, argIndex }))
      .filter((x) => x.a.numeric !== null)
    // A known Strudel control (room, lpf, delay, …) is UNARY — the chainable
    // prototype method reads only its first argument (controls.mjs:50), so extra
    // positional numbers are ignored at runtime. Surface ONE knob for it, never a
    // phantom "room 2"/"room 3" that edits a literal with no audible effect (#842).
    // Genuinely multi-arg functions (euclid, range, …) aren't controls → one knob
    // per numeric arg, as before.
    // A control (or unary range-table method) is ONE dial — extra numeric args
    // aren't independent dials (#842). Only a genuine Strudel control can carry
    // range metadata in those extra args (#844); a range-table-only method
    // (slow/fast/…) is one-dial but not range-editable (#847).
    const isControl = isKnownControl(call.name)
    const dialArgs = isControl ? numericArgs.slice(0, 1) : numericArgs
    const info = isStrudelControl(call.name) ? rangeInfo(call) : { editable: false }
    dialArgs.forEach(({ a, argIndex }) => {
      knobs.push({
        chainIndex,
        argIndex,
        method: call.name,
        // disambiguate when a single call exposes several numeric knobs
        label: dialArgs.length > 1 ? `${call.name} ${argIndex + 1}` : call.name,
        value: a.numeric as number,
        customRange: info.customRange,
        rangeEditable: info.editable,
      })
    })
  })
  return knobs
}


/**
 * Columns-per-bar of the roll under the cursor, or null when it isn't a grid-editable
 * melody. The division picker uses it to grey out divisions this grid can't snap to
 * (#432 Slice 2). The shape is read by `rollShape` (#1942).
 */
/**
 * What a sound / kit picker shows for the argument it edits (#2226). `value` is the
 * one name that plays (a pattern of one name shows that name, so ▶ previews it);
 * a pattern of several shows how many and which, and says why a pick may not
 * replace it.
 */
function pickerArg(
  arg: SoundArg | null,
  noun: string,
): { value: string; summary?: string; refusal?: string } {
  if (!arg) return { value: '' }
  if (arg.kind === 'one') return { value: arg.name }
  if (arg.names.length === 1) return { value: arg.names[0] }
  return { value: '', summary: soundArgLabel(arg, noun), refusal: soundPickRefusal(arg, noun) ?? undefined }
}

function rollStepsPerBar(chunk: ChunkInfo | null): number | null {
  const shape = rollShape(chunk)
  return shape ? stepsPerBar(shape.steps, shape.bars, shape.barSteps) : null
}

/**
 * Snap/quantize division picker (#432 Slice 2) — Piano Roll only (the Sequencer
 * is already cell-quantized, no continuous gesture to snap). Divisions the grid
 * can't represent are disabled, never silently inert (honest control).
 */
function DivisionSelect({
  division,
  spb,
  onChange,
}: {
  division: Division
  spb: number | null
  onChange: (d: Division) => void
}): React.ReactElement {
  return (
    <label
      data-mixer-division
      style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}
    >
      <span style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>Snap</span>
      <select
        data-mixer-division-select
        value={division}
        onChange={(e) => onChange(e.target.value as Division)}
        style={{
          padding: '4px 8px',
          fontSize: 12,
          borderRadius: 4,
          border: '1px solid var(--border, #3a3a42)',
          background: 'var(--background-elevated, #26262c)',
          color: 'var(--foreground, #e6e6ea)',
          maxWidth: 220,
        }}
      >
        {DIVISIONS.map((d) => {
          const ok = spb == null || isRepresentable(spb, d.value)
          return (
            <option key={d.value} value={d.value} disabled={!ok}>
              {ok ? d.label : `${d.label} (n/a)`}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export interface MixerBodyProps {
  /** the chunk this body edits (cursor chunk, or a strip's chunk in the drawer) */
  chunk: ChunkInfo
  /** the shared write path — re-resolves the chunk fresh, hands `mutate` it + the
   *  tagged Writeback (identical shape to `useActiveChunk.applyEdit`). */
  applyEdit: (mutate: (fresh: ChunkInfo, wb: Writeback) => void) => void
  /** wrap a knob drag as one undo step (coalesced gesture) */
  beginGesture: () => void
  endGesture: () => void
  /** Piano-Roll snap/quantize division (#432) — a Pattern-tab concern, so the
   *  Mixer console drawer leaves it undefined and the Snap picker is omitted. */
  division?: Division
  onDivisionChange?: (d: Division) => void
  /** the grid-resolution ("Slots") control, lifted from the active grid (#601).
   *  Owned by the grid (model + write-back); the inspector only renders it. The
   *  Mixer console drawer leaves it undefined (the console mixes a track, it
   *  doesn't restructure the grid), so the Slots row is omitted there. `null`
   *  when the cursor isn't in a grid-editable pattern. */
  resolution?: ResolutionControlProps | null
  /** optional `data-bottom-panel-tab` marker — the Pattern inspector sets it
   *  (`"mixer"`), the drawer leaves it off so it doesn't pollute the console
   *  tab's scoping (P-MIX-7: one body marker per tab). */
  dataTab?: string
  /** how the knob grid flows when it overflows:
   *  - `'rows'` (default, Pattern inspector): wrap into new ROWS, body scrolls
   *    vertically — the body has no fixed height to wrap a column against.
   *  - `'columns'` (Mixer console drawer): the drawer height is fixed (= strip
   *    face), so knobs fill a COLUMN top-to-bottom and wrap into a new column,
   *    and the body grows WIDER instead of scrolling. The header (picker +
   *    transforms) keeps a base width so the drawer only widens once the knob
   *    columns exceed it. */
  knobFlow?: 'rows' | 'columns'
  /** show the sound-source picker (Instrument for a roll / Kit for a step).
   *  Default `true` (Pattern inspector — the natural home for picking a track's
   *  sound). The Mixer console drawer sets it `false`: the console is for mixing
   *  (levels / pan / effects), not choosing the instrument, which is a
   *  pattern-authoring decision made on the Pattern tab. */
  showSoundPicker?: boolean
  /** surface a per-voice GAIN control — a gain knob (when the chain has a numeric
   *  `.gain`) plus a "Gain" add/remove toggle. Default `false`: gain is owned by
   *  the channel-strip fader. The Pattern inspector sets it `true` for a nested
   *  stack voice (#620), whose gain the track-scoped strip fader can't reach. */
  showGain?: boolean
}

/** the per-voice gain control surfaced when `showGain` (#620). Default unity so
 *  adding it gives a fader to pull DOWN; reuses the effect add/remove plumbing. */
const GAIN_EFFECT: Effect = { method: 'gain', label: 'Gain', group: 'Level', def: 1 }

/** Base content width of the drawer header (picker + transforms) in column flow,
 *  so the drawer stays ~264px until the knob columns grow past it. */
const COLUMN_HEADER_W = 232

export function MixerBody({
  chunk,
  applyEdit,
  beginGesture,
  endGesture,
  division,
  onDivisionChange,
  resolution,
  dataTab,
  knobFlow = 'rows',
  showSoundPicker = true,
  showGain = false,
}: MixerBodyProps): React.ReactElement {
  const columnFlow = knobFlow === 'columns'
  // Live instrument registry (#514 / PV141 #6) — prefer the engine's real
  // soundMap (synths/soundfonts/samples) over the curated shortlist; fall back
  // to INSTRUMENTS until the live list is available.
  const liveInstruments = useSoundCatalog()
  // Live drum-kit registry (#515 / PV141 #6) — bank names from the
  // tidal-drum-machines manifest; fall back to curated DRUM_KITS until ready.
  const liveKits = useDrumKitCatalog()

  const knobs = knobsFromChunk(chunk, showGain)

  // Every gesture below asks the code↔view area what to write (#1888) and hands
  // the answer to the writer. Null = nothing may be written: the control it was
  // drawn for is gone, or its value is not ours to replace.
  const writeKnob = React.useCallback(
    (entry: KnobEntry, value: number): void => {
      applyEdit((fresh, wb) => commit(wb, knobEdit(fresh, entry, value), 'knob'))
    },
    [applyEdit],
  )

  // Custom dial range (#844): the double-click popup writes `min, max` into the
  // control's range slots — one tagged, one-undo text edit, bidirectionally
  // linked (the strip re-derives from the text, so the dial re-ranges live).
  const writeRange = React.useCallback(
    (entry: KnobEntry, min: number, max: number): void => {
      applyEdit((fresh, wb) => commit(wb, knobRangeEdit(fresh, entry, min, max), 'knob'))
    },
    [applyEdit],
  )

  // Reset the dial back to its default range — drop the `, min, max` metadata.
  const resetRange = React.useCallback(
    (entry: KnobEntry): void => {
      applyEdit((fresh, wb) => commit(wb, knobRangeResetEdit(fresh, entry), 'knob'))
    },
    [applyEdit],
  )

  // Add/remove an effect (#575). Favorites and the ＋More menu both call this.
  // Alias-aware: an effect already on the chain under any of its spellings is
  // removed; otherwise it is added at its default.
  const toggleEffect = React.useCallback(
    (e: Effect): void => {
      applyEdit((fresh, wb) => commit(wb, toggleCallEdit(fresh, effectNames(e), e.method, e.def), 'knob'))
    },
    [applyEdit],
  )

  // Remove one method by its exact name — the knob's `×` affordance (#575).
  const removeMethod = React.useCallback(
    (method: string): void => {
      applyEdit((fresh, wb) => commit(wb, removeNamedCall(fresh, method), 'knob'))
    },
    [applyEdit],
  )

  // Sound assignment (#514 instrument / #515 kit): set a string-valued chain
  // method (`.sound`/`.s`/`.bank`). Reuses the `'knob'` write source. A pattern
  // of several sounds is never replaced by one (#2226): the edit is refused, and
  // the picker already showed why, so nothing is written.
  const writeChainMethod = React.useCallback(
    (names: string[], canonical: string, value: string, noun: string): void => {
      if (value === '') return
      applyEdit((fresh, wb) => {
        const pick = soundPickEdit(fresh, names, canonical, value, noun)
        commit(wb, 'edit' in pick ? pick.edit : null, 'knob')
      })
    },
    [applyEdit],
  )

  const present = new Set(chunk.chain.map((c) => c.name))
  const kind = patternKind(chunk)
  const rollSpb = kind === 'roll' ? rollStepsPerBar(chunk) : null

  return (
    <div
      data-bottom-panel-tab={dataTab}
      data-mixer-body
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        // Column flow sizes to its content (header + two knob rows) and grows
        // WIDER as knobs are added — a constant height, no scroll. Row flow
        // (inspector) fills the panel and scrolls vertically as before.
        height: columnFlow ? undefined : '100%',
        overflowY: columnFlow ? 'visible' : 'auto',
        width: columnFlow ? 'max-content' : undefined,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {/* header (picker + transforms). In column flow it holds a base width so
          the drawer only widens once the knob COLUMNS exceed it. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flexShrink: 0,
          width: columnFlow ? COLUMN_HEADER_W : undefined,
        }}
      >
      {/* Grid resolution ("Slots") — moved here from the grid header (#601). Lifted
          from the active grid (it owns the model + write-back); shown only when a
          grid-editable pattern is under the cursor. */}
      {resolution && <ResolutionControl {...resolution} />}
      {showSoundPicker && kind === 'roll' && (
        <SoundPickerMenu
          label="Instrument"
          groups={liveInstruments ?? INSTRUMENTS}
          {...pickerArg(readSoundCall(chunk, ['sound', 's']), 'sound')}
          placeholder="Default synth"
          onChange={(v) => writeChainMethod(['sound', 's'], 'sound', v, 'sound')}
          onAudition={(v) => auditionSound(v)}
        />
      )}
      {kind === 'roll' && division !== undefined && onDivisionChange && (
        <DivisionSelect division={division} spb={rollSpb} onChange={onDivisionChange} />
      )}
      {showSoundPicker && kind === 'step' && (
        <SoundPickerMenu
          label="Kit"
          groups={liveKits ?? DRUM_KITS}
          {...pickerArg(readSoundCall(chunk, ['bank']), 'kit')}
          placeholder="Default kit"
          onChange={(v) => writeChainMethod(['bank'], 'bank', v, 'kit')}
        />
      )}
      <div
        data-mixer-transforms
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
      >
        {showGain &&
          (() => {
            // Per-voice gain (#620): add/remove `.gain` for a nested voice the
            // track strip doesn't fader. Once present (numeric), its knob below
            // is the per-voice fader. Reuses the effect add/remove plumbing.
            const active = isEffectActive(present, GAIN_EFFECT)
            return (
              <button
                type="button"
                data-mixer-transform="gain"
                data-mixer-transform-active={active ? 'true' : undefined}
                aria-pressed={active}
                title={active ? 'Remove Gain' : 'Add a per-voice Gain fader'}
                onClick={() => toggleEffect(GAIN_EFFECT)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: active
                    ? '1px solid var(--accent, #6ea8fe)'
                    : '1px solid var(--border, #3a3a42)',
                  background: active ? 'var(--accent, #6ea8fe)' : 'var(--background-elevated, #26262c)',
                  color: active ? '#0b0b0e' : 'var(--foreground, #e6e6ea)',
                }}
              >
                {active ? '✓' : '+'} Gain
              </button>
            )
          })()}
        {FAVORITES.map((e) => {
          // A present effect is an ON toggle: clicking it again removes the call.
          // Filled = on; the leading glyph flips +/✓ to telegraph the second
          // click takes it off. The long tail lives in the ＋More menu.
          const active = isEffectActive(present, e)
          return (
            <button
              key={e.method}
              type="button"
              data-mixer-transform={e.method}
              data-mixer-transform-active={active ? 'true' : undefined}
              aria-pressed={active}
              title={active ? `Remove ${e.label}` : `Add ${e.label}`}
              onClick={() => toggleEffect(e)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                borderRadius: 4,
                cursor: 'pointer',
                border: active
                  ? '1px solid var(--accent, #6ea8fe)'
                  : '1px solid var(--border, #3a3a42)',
                background: active ? 'var(--accent, #6ea8fe)' : 'var(--background-elevated, #26262c)',
                color: active ? '#0b0b0e' : 'var(--foreground, #e6e6ea)',
              }}
            >
              {active ? '✓' : '+'} {e.label}
            </button>
          )
        })}
        <AddEffectMenu present={present} onToggle={toggleEffect} />
      </div>
      </div>
      {knobs.length > 0 ? (
        <div
          data-mixer-knobs
          style={
            columnFlow
              ? // Always two rows: a knob fills row 1 then row 2 of a column,
                // then flows into a new column to the right — so adding knobs
                // grows the drawer WIDER (grid track widths are intrinsic, so it
                // grows) at a constant height, never taller and never scrolling.
                // The two rows are always reserved (minmax floor), so the layout
                // starts with room for ~3 knobs/row and stays two rows tall.
                {
                  display: 'grid',
                  gridAutoFlow: 'column',
                  gridTemplateRows: 'repeat(2, minmax(78px, max-content))',
                  gridAutoColumns: 'max-content',
                  gap: 16,
                  alignContent: 'flex-start',
                  justifyContent: 'flex-start',
                }
              : { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }
          }
        >
          {knobs.map((k) => (
            <Knob
              key={`${k.chainIndex}:${k.argIndex}`}
              label={k.label}
              value={k.value}
              range={
                k.customRange
                  ? customRange(k.customRange.min, k.customRange.max, k.value)
                  : knobRangeFor(k.method, k.value)
              }
              onChange={(v) => writeKnob(k, v)}
              onRemove={() => removeMethod(k.method)}
              onRangeChange={k.rangeEditable ? (min, max) => writeRange(k, min, max) : undefined}
              onRangeReset={
                k.rangeEditable && k.customRange ? () => resetRange(k) : undefined
              }
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)' }}>
          Add an effect above, or drag a knob once the pattern has one.
        </span>
      )}
    </div>
  )
}
