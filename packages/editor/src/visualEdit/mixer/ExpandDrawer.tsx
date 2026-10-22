/**
 * ExpandDrawer — a strip's full knob chain, inline to the right (#550 / S4b).
 *
 * The Mixer console strip is the SUMMARY (dot/name/mute, pan/fader/meter/gain);
 * this drawer is the EFFECTS chain (quick-transforms + a Knob per numeric arg —
 * lpf, attack, crush, send levels, …). It mounts the shared `MixerBody`, the
 * very same body the Pattern-tab inspector uses, bound via an injected `applyEdit`
 * instead of the cursor: a channel passes `(m) => applyToStrip(strip.id, m)`, the
 * MASTER passes `applyToMasterChunk` (which adapts/materializes the `all()` line).
 * Either way every knob edit is a surgical, tagged, one-undo text change that goes
 * live while playing for free (centralised Writeback re-eval). The drawer holds no
 * document state itself — which strips are open is the console's ephemeral,
 * persisted UI state (`expandStore`), never the file (V-mixer-1).
 *
 * Two pieces of `MixerBody` are omitted because they're pattern-authoring
 * concerns, not mixing: the Snap picker (`division` left undefined) and the
 * sound-source picker (`showSoundPicker={false}`) — instrument/kit selection
 * lives on the Pattern tab inspector, its natural home.
 */
import * as React from 'react'

import type { ChunkInfo } from '../../codeView'
import type { Writeback } from '../../codeView'
import { MixerBody } from '../panels/MixerBody'

interface ExpandDrawerProps {
  /** stable id for the drawer's data attribute (a strip id, or `__master__`). */
  id: string
  /** the render-time chunk (a strip's chunk, or the adapted master chunk) */
  chunk: ChunkInfo
  /** the write path — re-resolves a FRESH chunk at write time and hands `mutate`
   *  it + the tagged Writeback (identical shape to `useActiveChunk.applyEdit`).
   *  Channels pass `(m) => applyToStrip(strip.id, m)`; the master passes
   *  `applyToMasterChunk` (which adapts/materializes the `all()` line). */
  applyEdit: (mutate: (fresh: ChunkInfo, wb: Writeback) => void) => void
  beginGesture: () => void
  endGesture: () => void
  /** User zoom factor from the console zoom bar (#763). Scales the drawer
   *  CONTENT so it tracks the face (which scales by CONSOLE_ZOOM × this). This is
   *  the user multiplier, NOT the face's 1.5× baseline: at 100% the drawer keeps
   *  its established 1× content; at 200% it doubles — same factor the face does,
   *  so the strip + drawer read as one coherently-zoomed unit. Applied to an
   *  INNER wrapper (not the outer card) so the card keeps its stretch-to-face-
   *  height contract; CSS `zoom` (not `transform`) keeps knob drags delta-exact. */
  zoom?: number
}

export function ExpandDrawer({
  id,
  chunk,
  applyEdit,
  beginGesture,
  endGesture,
  zoom = 1,
}: ExpandDrawerProps): React.ReactElement {
  return (
    <div
      data-mixer-expand-drawer
      data-mixer-expand-for={id}
      style={{
        flexShrink: 0,
        // The body grows WIDER as knobs are added (the band scrolls
        // horizontally), never taller. `minWidth` keeps a panel-like base (room
        // for ~3 knobs/row); the body's `max-content` width drives the rest.
        // STRETCH to the group's height so the drawer is ALWAYS the same height
        // as the (1.5×-zoomed) strip face — including an EMPTY drawer with no
        // knobs yet (its short content would otherwise leave it ~150px shorter
        // than the face). The group is face-tall (V-mixer-10), so stretch closes
        // the gap; the empty space below the effect-add row is the waiting drawer.
        alignSelf: 'stretch',
        display: 'flex',
        // Scale the base floor with the zoom so a near-empty drawer keeps a
        // panel-like width proportional to the (zoomed) face, not a fixed 264.
        minWidth: 264 * zoom,
        // Full outline (#609): the strip face drops its RIGHT border when
        // expanded, so the drawer's LEFT border is the single hairline seam
        // between them and the top/right/bottom borders close the card — the
        // strip + drawer read as ONE connected, outlined unit that belongs
        // together (the strip rounds its left corners, the drawer its right). The
        // SELECTION highlight (#639) is NOT here — it lives on the wrapping group
        // div (MixerStrips), which encapsulates both the face and this drawer, so
        // the accent outline wraps the whole unit and grows with the drawer.
        border: '1px solid var(--border, #3a3a42)',
        background: '#26262c69',
        borderRadius: '0 6px 6px 0',
        overflow: 'hidden',
      }}
    >
      {/* Inner wrapper carries the user zoom (#763): the CONTENT scales while the
          outer card above keeps `alignSelf: stretch` (so it still matches the
          face height). `flex: 1` lets it fill the card width; `alignSelf:
          flex-start` keeps the (zoomed) content pinned to the top with the empty
          waiting-space below, exactly as at 1×. */}
      <div style={{ zoom, display: 'flex', flex: 1, alignSelf: 'flex-start' }}>
        <MixerBody
          chunk={chunk}
          applyEdit={applyEdit}
          beginGesture={beginGesture}
          endGesture={endGesture}
          knobFlow="columns"
          // The console is for mixing (levels / pan / effects). Picking a track's
          // instrument is a pattern-authoring decision — its home is the Pattern
          // tab inspector, so the drawer omits the sound-source picker.
          showSoundPicker={false}
        />
      </div>
    </div>
  )
}
