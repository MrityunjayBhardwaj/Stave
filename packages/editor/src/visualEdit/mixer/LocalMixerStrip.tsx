/**
 * LocalMixerStrip — the Pattern tab's single, cursor-bound channel strip (#540 / S4a).
 *
 * The Pattern tab is the local view of ONE track. Beside the param panel
 * (instrument/knobs/Snap) it shows that track's channel strip — mute, solo, the
 * fused fader+meter, pan — so you can ride the fader, mute/solo and watch the
 * level while editing the track's notes, without leaving for the global Mixer
 * tab. It carries NO name/colour: identity already lives in the Pattern top-bar
 * chip (#589), so the strip is just the mixing controls.
 *
 * It binds the cursor's TOP-LEVEL track — the strip whose statement CONTAINS the
 * cursor. For a top-level cursor that's an exact match; for a cursor inside a
 * `stack(...)`/`cat(...)` voice (#395, where the grid edits that voice's notes)
 * it's the CONTAINING parent track (#620, was vanishing). Binding the track —
 * not the nested voice — is what makes the full strip coherent: the engine
 * schedules the `$:` statement as ONE track, so mute (`_`-prefix), solo (the
 * eval overlay) and the meter (`captureId`) are all track-level and only a
 * top-level strip carries them. DAW convention: the channel strip mixes the
 * TRACK; the grid edits the notes. Writes ride `applyToStrip(id, …)` (one undo,
 * live while playing via the centralised Writeback re-eval).
 */
import * as React from 'react'

import { useActiveChunk } from '../panels/useActiveChunk'
import { useMixerModel } from './useMixerModel'
import { useTrackMeters } from './useTrackMeters'
import { useSoloMuteSync } from './soloMuteSync'
import { ChannelStrip } from './ChannelStrip'
import { gainEdit, panEdit, muteEdit, commit } from '../../codeView'

export function LocalMixerStrip(): React.ReactElement | null {
  const { chunk } = useActiveChunk()
  const { strips, applyToStrip, beginGesture, endGesture } = useMixerModel()
  const meters = useTrackMeters()
  const { soloed, toggle: toggleSolo } = useSoloMuteSync()

  // The cursor's top-level track: the strip whose statement contains the cursor
  // chunk's range. Exact match at top level; the containing parent for a nested
  // stack voice (top-level statements don't nest, so at most one matches).
  const r = chunk ? chunk.statementRange : null
  const strip = r
    ? strips.find((s) => s.statementRange[0] <= r[0] && r[1] <= s.statementRange[1])
    : undefined
  if (!strip) return null

  const soloActive = soloed.size > 0

  return (
    <div
      data-mixer-local-strip
      style={{
        flexShrink: 0,
        display: 'flex',
        padding: '10px 12px',
        borderBottom: '1px solid var(--border, #3a3a42)',
        background: 'var(--background, #1c1c20)',
        overflow: 'hidden',
      }}
    >
      <ChannelStrip
        strip={strip}
        showHeader={false}
        orientation="horizontal"
        onGainChange={(value) =>
          applyToStrip(strip.id, (fresh, wb) =>
            commit(wb, gainEdit(fresh, value), 'mixer'),
          )
        }
        onPanChange={(value) =>
          applyToStrip(strip.id, (fresh, wb) =>
            commit(wb, panEdit(fresh, value), 'mixer'),
          )
        }
        onMuteToggle={() =>
          applyToStrip(strip.id, (fresh, wb) =>
            commit(wb, muteEdit(fresh, !strip.muted), 'mixer'),
          )
        }
        soloed={soloed.has(strip.id)}
        onSoloToggle={() => toggleSolo(strip.id)}
        dimmed={soloActive && !soloed.has(strip.id)}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
        meters={meters}
      />
    </div>
  )
}
