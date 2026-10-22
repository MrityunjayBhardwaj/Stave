/**
 * MixerStrips — the channel-strip row.
 *
 * Renders one `ChannelStrip` per top-level statement, cursor-independent, in a
 * horizontal scroller. Fader/pan gestures route through `useMixerModel`'s single
 * write path (`applyToStrip` → tagged `Writeback`), so every move is a surgical,
 * one-undo text edit and the strips re-derive from the result (master strip and
 * meters land in later slices). Returns null when the document has no editable
 * statements, so the host can fall back to the param panel's own standby.
 *
 * Live while playing: every edit here goes through `Writeback`, which re-evals
 * the playing file on commit (a single click immediately, a drag once on
 * release) — so mute / fader / pan are all audible at once, no manual eval. That
 * lives at the write boundary (shared by every visual surface), not here.
 */
import * as React from 'react'

import { useMixerModel } from './useMixerModel'
import { useTrackMeters } from './useTrackMeters'
import { useExpandedStrips } from './expandStore'
import { useMixerZoom } from './mixerZoomStore'
import { useSoloMuteSync } from './soloMuteSync'
import { ChannelStrip } from './ChannelStrip'
import { ExpandDrawer } from './ExpandDrawer'
import { MasterStrip } from './MasterStrip'
import { gainEdit, panEdit, muteEdit, renameEdit, commit } from '../../codeView'
import { otherTrackNames } from '../../codeView'
import { masterGainEdit, masterMuteEdit } from '../../codeView'
import { trackIdentity } from '../../codeView'
import { getActiveFileId, onActiveEditorChange } from '../../workspace/editorRegistry'
import { getTrackMeta, setTrackMeta } from '../../workspace/WorkspaceFile'
import { useTrackMetaMap } from '../../workspace/useTrackMeta'

/** Reserved `expandStore` id for the MASTER strip's drawer — never a real strip
 *  id (strip ids are chunk-derived), so the master's open state coexists with the
 *  channels' in the same per-file persisted store. */
const MASTER_EXPAND_ID = '__master__'

/**
 * Console strips render their FACE at 1.5× via CSS `zoom` (aspect-exact, and —
 * unlike `transform: scale` — it leaves the delta-based fader/pan drags
 * untouched: they read pointer deltas ÷ DRAG_SPAN_PX, never a bounding box). The
 * zoom is applied to the strip face only, NOT the expand drawer: the drawer is a
 * non-zoomed sibling that stretches to the scaled face height (V-mixer-10
 * parity), so it grows TALLER (its knob chain stops scrolling) while its content
 * stays 1×. The master face is zoomed in lockstep (it sits outside the groups).
 * Console only: the Pattern-tab local strip and inspector mount `ChannelStrip`
 * directly, not through here, so they stay 1×.
 */
// The baseline the "100%" readout maps to (#759). The user's [-] % [+] scale
// (mixerZoomStore) multiplies it: faceZoom = CONSOLE_ZOOM * userScale, so
// scale === 1 keeps this historical 1.5x look exactly.
const CONSOLE_ZOOM = 1.5

export function MixerStrips({
  emptyFallback,
}: {
  /** rendered in place of the band when the document has no editable
   *  statements — lets the host (the Mixer console) show a standby without a
   *  second `useMixerModel` subscription just to read the count. */
  emptyFallback?: React.ReactNode
} = {}): React.ReactElement | null {
  const {
    strips,
    chunks,
    applyToStrip,
    applyToStripAt,
    masterGain,
    masterMuted,
    masterChunk,
    applyToMaster,
    applyToMasterChunk,
    beginGesture,
    endGesture,
    selectedId,
    selectTrack,
  } = useMixerModel()
  // One capped RAF loop + bus subscription for every strip's live meter (S2).
  const meters = useTrackMeters()
  // Per-track custom colour (Phase D, #581). Track the active file (same source
  // as the meters' bus pin) and read its whole-file overrides as one ref-stable
  // map keyed by the strip's DISPLAY NAME (`strip.name`) — the same key the Song
  // Timeline uses, so a colour set in either view shows in both. Resolved through
  // the shared `trackIdentity` so the dot can't diverge from the Timeline lane.
  const [fileId, setFileId] = React.useState<string | null>(() => getActiveFileId())
  React.useEffect(() => onActiveEditorChange(() => setFileId(getActiveFileId())), [])
  // #639 — `selectedId` comes from `useMixerModel`, DERIVED from the editor caret
  // (the strip whose statement holds the cursor). Clicking a strip calls
  // `selectTrack`, which moves the caret there — so the selection is unified with
  // the editor: caret ⇄ selected strip stay in lockstep both ways.
  const trackMeta = useTrackMetaMap(fileId ?? undefined)
  // Per-file ephemeral expand state (S4b): which strips show their knob chain.
  // Persisted in localStorage, never the file (V-mixer-1). The master reuses the
  // same store under a reserved id (never a real strip id), so its open state
  // persists alongside the channels'.
  const { expanded, toggle } = useExpandedStrips()
  const masterExpanded = expanded.has(MASTER_EXPAND_ID)
  // Solo (S5): session-ephemeral, never persisted/written; applies an eval-input
  // overlay that silences non-soloed tracks in the string sent to the engine.
  const { soloed, toggle: toggleSolo } = useSoloMuteSync()
  const soloActive = soloed.size > 0
  // User zoom (#759): the [-] % [+] bar's scale multiplies the console baseline
  // so every strip face (and the master) scales in lockstep. scale === 1 → the
  // historical 1.5x. Read here so a change re-renders the whole band at once.
  const { zoom: userZoom } = useMixerZoom()
  const faceZoom = CONSOLE_ZOOM * userZoom
  if (strips.length === 0) return <>{emptyFallback ?? null}</>

  return (
    <div
      data-mixer-strips
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: 8,
        // Each strip group is content-tall (its strip face's natural height), so
        // an expanded drawer matches the strips rather than the whole panel
        // (#550 height parity). The band still fills the panel: the row pins to
        // the top with slack below, and tall knob chains scroll inside.
        height: '100%',
        minHeight: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        borderBottom: '1px solid var(--border, #3a3a42)',
        background: 'var(--background, #1c1c20)',
      }}
    >
      {strips.map((strip, i) => {
        const isOpen = expanded.has(strip.id)
        // Resolve the dot colour through the shared `trackIdentity`: the custom
        // override (keyed by the strip's display name) or the deterministic
        // palette (#581). Same function the Timeline lane uses → they can't diverge.
        const customColor = trackMeta.get(strip.name)?.color
        const dotColor = trackIdentity(strip.name, customColor).color
        return (
          // A strip + (when open) its expand drawer, side-by-side: the drawer
          // grows to the RIGHT, so later strips push along the horizontal
          // scroller (design §6.7). The group is the flex item.
          <div
            key={strip.id}
            data-mixer-strip-group
            data-mixer-strip-group-selected={strip.id === selectedId ? '' : undefined}
            // Strip face + (when open) its drawer, side-by-side and SAME height:
            // the zoomed strip face is the group's only in-flow height, so the
            // group is (scaled-)strip-tall, and `alignItems: stretch` sizes the
            // drawer to match (its knob chain is absolutely filled, so it adds no
            // height). The drawer itself is NOT zoomed — it just grows taller to
            // the scaled face, so its 1× content stops scrolling (V-mixer-10).
            style={{
              display: 'flex',
              alignItems: 'stretch',
              flexShrink: 0,
              // #639 — the SELECTION highlight is a single accent ring on THIS
              // wrapper, which encapsulates the strip face AND (when open) its
              // drawer. The box-shadow follows the group's border-radius and sits
              // at its outer edge, so one continuous purple outline wraps the whole
              // unit and AUTOMATICALLY grows to include the drawer when expanded —
              // the face/drawer keep their own neutral #609 borders; only this div
              // highlights. box-shadow (not border) → no layout shift on select.
              borderRadius: 6,
              boxShadow:
                strip.id === selectedId ? '0 0 0 1.5px var(--accent, #6ea8fe)' : undefined,
            }}
          >
            <ChannelStrip
              strip={strip}
              zoom={faceZoom}
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
              onRename={(newLabel) =>
                // Anchored, NOT id-addressed (#877). A rename changes the strip's
                // own id — naming an anonymous track turns `#0` into `drums` AND
                // renumbers every later anonymous strip — so `applyToStrip(id)`
                // would resolve a repeated write onto a DIFFERENT track and rename
                // that one too. The statement's start offset is invariant under the
                // rename, so the write addresses the track by it.
                applyToStripAt(chunks[i].statementRange[0], (fresh, wb, doc) => {
                  // Reject a rename that would duplicate another track's display
                  // name (#585). Read from the FRESH document, not the render-time
                  // `strips` — the same `otherTrackNames` projection the Song
                  // Timeline's rename uses, so both views reject the same set.
                  const taken = new Set(otherTrackNames(doc, fresh.statementRange[0]))
                  // Tagged 'rename' like the track chip and the Song Timeline lane
                  // — the same gesture from three surfaces is one kind of edit.
                  if (commit(wb, renameEdit(fresh, newLabel, taken), 'rename') !== 'written') return
                  // Migrate a custom-colour override from the OLD display name to
                  // the new label so the rename doesn't orphan it (#581) — only once
                  // the rename is actually in the document.
                  if (fileId) {
                    const prevColor = getTrackMeta(fileId, strip.name).color
                    if (prevColor && strip.name !== newLabel) {
                      setTrackMeta(fileId, newLabel, { color: prevColor })
                      setTrackMeta(fileId, strip.name, { color: undefined })
                    }
                  }
                })
              }
              dotColor={dotColor}
              onPickColor={
                fileId
                  ? (color) => setTrackMeta(fileId, strip.name, { color })
                  : undefined
              }
              onResetColor={
                fileId
                  ? () => setTrackMeta(fileId, strip.name, { color: undefined })
                  : undefined
              }
              soloed={soloed.has(strip.id)}
              onSoloToggle={() => toggleSolo(strip.id)}
              dimmed={soloActive && !soloed.has(strip.id)}
              selected={strip.id === selectedId}
              onSelect={() => selectTrack(strip.id)}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
              meters={meters}
              expanded={isOpen}
              onToggleExpand={() => toggle(strip.id)}
            />
            {isOpen && chunks[i] && (
              <ExpandDrawer
                id={strip.id}
                chunk={chunks[i]}
                applyEdit={(m) => applyToStrip(strip.id, m)}
                beginGesture={beginGesture}
                endGesture={endGesture}
                // #763 — scale the drawer content by the USER zoom (not faceZoom)
                // so it tracks the face and the unit reads as one zoomed strip.
                zoom={userZoom}
              />
            )}
          </div>
        )
      })}
      {/* master group — a plain trailing flex item (no longer sticky-pinned), so
          it behaves exactly like a channel group: the face sits left and, when
          the master EXPANDS, its drawer grows to the RIGHT and pushes the
          scroller, same as any track strip. */}
      <div
        data-mixer-master-group
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'stretch',
          flexShrink: 0,
          borderRadius: 6,
        }}
      >
        <MasterStrip
          zoom={faceZoom}
          gain={masterGain.value}
          foreign={masterGain.foreign}
          muted={masterMuted}
          expanded={masterExpanded}
          onToggleExpand={() => toggle(MASTER_EXPAND_ID)}
          onGainChange={(value) =>
            applyToMaster((doc, wb) => commit(wb, masterGainEdit(doc, value), 'mixer'))
          }
          onMuteToggle={() =>
            applyToMaster((doc, wb) => commit(wb, masterMuteEdit(doc, !masterMuted), 'mixer'))
          }
          onGestureStart={beginGesture}
          onGestureEnd={endGesture}
        />
        {masterExpanded && (
          // The master's drawer grows to the RIGHT of the face, exactly like a
          // channel drawer (the master is now a plain trailing group).
          <ExpandDrawer
            id={MASTER_EXPAND_ID}
            chunk={masterChunk}
            applyEdit={applyToMasterChunk}
            beginGesture={beginGesture}
            endGesture={endGesture}
            zoom={userZoom}
          />
        )}
      </div>
    </div>
  )
}
