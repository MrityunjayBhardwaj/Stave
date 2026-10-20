/**
 * Pattern — the single adaptive visual-editing panel (#398).
 *
 * One tab that follows the cursor instead of three the musician has to choose
 * between. `chunkSurface` decides which grid editor the focused pattern needs:
 * a drum pattern (`s`/`sound`) gets the Sequencer step grid, a melody
 * (`note`/`n`) gets the Piano Roll, and — since #1240 — a unit whose content
 * span the RESOLVER named is routed on its content, because its head (`lpf`,
 * `seq`, `pick`, or none) says nothing about which view the values belong to.
 * Anything with no content span still shows a standby hint. The Mixer is pinned on the right for whatever is focused — it edits the
 * numeric chain args of any pattern, so it stays constant across the switch.
 *
 * On a PHONE the grid is shown ALONE (#1990): the pinned column is more than half a
 * phone's width. The knobs are still in the Mixer tab; the snap picker and the Slots
 * control have no other home, so on a phone they keep their current value. A tablet has
 * the room and keeps the column, like a desktop.
 *
 * Off a phone the column can be put away (#2044): a menu button in the tab's header row
 * hides it and the grid takes the whole width. Hidden, it is as on a phone — the snap
 * picker and the Slots control keep their current value.
 *
 * This is pure composition: SequencerGrid / PianoRollGrid / Mixer keep their
 * own binding, write-back and standby behaviour unchanged. Each binds the
 * active chunk independently through useActiveChunk, so they all converge on
 * the same pattern under the cursor; this panel only picks which grid mounts.
 *
 * There is no "both grids at once" case — `chunkSurface` returns exactly one
 * surface, and the cursor→chunk binding resolves exactly one chain.
 */
import * as React from 'react'
import { CODE_UNDO_ACTIVE, CODE_UNDO_ATTR } from '../../workspace/codeUndo'

import { useActiveChunk } from './useActiveChunk'
import { usePhone } from '../../workspace/usePhone'
import { usePatternSideShown } from './patternSide'
import { chunkSurface } from '../../codeView'
import { SequencerGrid } from './SequencerGrid'
import { RhythmChartGrid } from './RhythmChartGrid'
import { PianoRollGrid } from './PianoRollGrid'
import { MixerPanel } from '../mixer/MixerPanel'
import { VisualEditStandby } from './VisualEditStandby'
import { PATTERN_TAB_ID } from './tabs'
import type { SelectedNote } from './inspector'
import { type Division, DEFAULT_DIVISION } from './division'
import type { ResolutionControlProps } from './ResolutionControl'

/** width of the pinned Mixer column. The channel strip moved to a horizontal
 *  bar atop the inspector (#600), so the param panel no longer shares the column
 *  with a side strip — it fits a narrower column, and the grid reclaims the
 *  difference (was 300 when the strip sat beside the panel). */
const MIXER_WIDTH = 220

export function PatternPanel(): React.ReactElement {
  const { chunk } = useActiveChunk()
  const kind = chunkSurface(chunk)
  const phone = usePhone()
  const sideShown = usePatternSideShown()
  const gridAlone = phone || !sideShown

  // The copy/paste selection (#528) — a ⌘/Ctrl-clicked cell on the Piano Roll.
  // Owned here so it survives the grid's own re-renders. Cleared when the cursor
  // moves to a different statement — selection is per-pattern.
  const [selected, setSelected] = React.useState<SelectedNote | null>(null)
  const stmtId = chunk ? chunk.statementRange[0] : null
  const stmtRef = React.useRef<number | null>(stmtId)
  React.useEffect(() => {
    if (stmtRef.current !== stmtId) {
      stmtRef.current = stmtId
      setSelected(null)
    }
  }, [stmtId])

  // The Piano Roll snap/quantize division (#432 Slice 2). A UI preference, so —
  // unlike the selection — it PERSISTS across pattern switches (Logic keeps the
  // Snap value global). Owned here so the grid (snaps to it) and the Mixer
  // (renders the picker) share one source.
  const [division, setDivision] = React.useState<Division>(DEFAULT_DIVISION)

  // The grid's resolution ("Slots") control, lifted from whichever grid is
  // mounted so the inspector can render it (#601). The grid owns the model +
  // write-back; this only carries the rendered control across the sibling
  // boundary. Cleared to null when the active grid unmounts (cursor leaves a
  // grid-editable pattern), so Slots shows exactly when a grid does.
  const [resolution, setResolution] = React.useState<ResolutionControlProps | null>(null)

  const grid =
    kind === 'step' ? (
      // a `.struct` rhythm line draws the chords it times (#2120)
      chunk?.structRhythm ? <RhythmChartGrid onResolution={setResolution} /> : <SequencerGrid onResolution={setResolution} />
    ) : kind === 'roll' ? (
      <PianoRollGrid selected={selected} onSelect={setSelected} division={division} onResolution={setResolution} />
    ) : (
      <VisualEditStandby
        panel={PATTERN_TAB_ID}
        hint="Click a drum or melodic pattern to edit it here."
        icon="symbol-array"
      />
    )

  return (
    <div
      data-bottom-panel-tab="pattern"
      // The grids and the mixer write to the active code editor, so ⌘Z pressed
      // in here walks that editor's history (#1800).
      {...{ [CODE_UNDO_ATTR]: CODE_UNDO_ACTIVE }}
      style={{ display: 'flex', height: '100%', width: '100%', minWidth: 0 }}
    >
      {/* adaptive grid — Sequencer for drums, Piano Roll for melodies */}
      <div data-pattern-grid style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {grid}
      </div>
      {/* Mixer — pinned, constant across the grid switch; not on a phone, and not
          while it is put away (#2044) */}
      {gridAlone ? null : (
        <div
          data-pattern-mixer
          style={{
            width: MIXER_WIDTH,
            flexShrink: 0,
            height: '100%',
            overflow: 'hidden',
            borderLeft: '1px solid var(--border, #3a3a42)',
          }}
        >
          <MixerPanel division={division} onDivisionChange={setDivision} resolution={resolution} />
        </div>
      )}
    </div>
  )
}
