/**
 * PatternTrackChip — the Pattern tab's "which track am I editing" badge (#589, Phase E).
 *
 * The pianoroll/sequencer edit ONE track (the chunk under the cursor) but showed
 * no name or colour. This chip puts the track's IDENTITY at the focal point: a
 * colour dot + the track name, with the SAME affordances as the Mixer strip and
 * Song Timeline lane — click the dot to recolour, double-click the name to rename.
 *
 * It resolves the identity the same way `LocalMixerStrip` does — match the
 * cursor's chunk to its strip out of the WHOLE-document strip set by the
 * statement-start anchor — so `{name, color}` are byte-identical to the Mixer and
 * Timeline (anonymous `$:` numbering stays correct, GR1). Recolour writes through
 * `setTrackMeta` and rename through `renameEdit`, the same primitives the other
 * views use, so a colour/rename here shows everywhere and migrates on rename, and
 * the per-eval prune (#583) applies.
 */
import * as React from 'react'

import { useActiveChunk } from './useActiveChunk'
import { useMixerModel } from '../mixer/useMixerModel'
import { stripContainingOffset, otherTrackNames } from '../../codeView'
import { StripColorPopover } from '../mixer/StripColorPopover'
import { renameEdit, commit } from '../../codeView'
import { trackIdentity } from '../../codeView'
import { getActiveFileId, onActiveEditorChange } from '../../workspace/editorRegistry'
import { getTrackMeta, setTrackMeta } from '../../workspace/WorkspaceFile'
import { useTrackMetaMap } from '../../workspace/useTrackMeta'

export function PatternTrackChip(): React.ReactElement | null {
  const { chunk } = useActiveChunk()
  const { strips, applyToStripAt } = useMixerModel()
  // Active file for the per-file colour override (same source as the Mixer).
  const [fileId, setFileId] = React.useState<string | null>(() => getActiveFileId())
  React.useEffect(() => onActiveEditorChange(() => setFileId(getActiveFileId())), [])
  const trackMeta = useTrackMetaMap(fileId ?? undefined)

  const [colorAnchor, setColorAnchor] = React.useState<DOMRect | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const settledRef = React.useRef(false)
  const openRename = (): void => {
    settledRef.current = false
    setRenaming(true)
  }
  const cancelRename = (): void => {
    settledRef.current = true
    setRenaming(false)
  }

  // Match the cursor's chunk to its OWNING strip — the top-level statement whose
  // range contains the chunk anchor — so the d{N} numbering matches the Mixer
  // (P-MIX-5). Containment (not exact start) is what keeps the chip showing when
  // the cursor sits inside a NESTED chunk: a `pickRestart` section, a `stack`
  // arm, or an `arrange` arm carry the nested span as their statementRange, which
  // never equals a top-level strip's start (#727).
  const anchor = chunk ? chunk.statementRange[0] : null
  const strip = anchor != null ? stripContainingOffset(strips, anchor) : undefined
  if (!strip) return null

  const customColor = trackMeta.get(strip.name)?.color
  const dotColor = trackIdentity(strip.name, customColor).color

  // Inline rename seed: the bare label (mute marker stripped); anon `$:` seeds
  // empty so the field invites a fresh name (mirrors ChannelStrip, #580).
  // `strip.label` is already bare — `stripModel` strips the marker (#1679).
  const bareLabel = strip.label ?? ''
  const renameSeed = bareLabel !== '' && bareLabel !== '$' ? bareLabel : ''

  // ONE write per rename gesture, addressed by the STATEMENT (#877) — the same
  // contract as the Mixer strip and the Timeline lane. Committing unmounts the
  // field and the write focuses the editor, so it also blurs → the blur handler
  // committed a second time; and a rename CHANGES the strip's id (naming a track
  // renumbers every later anonymous `#k`), so that second write resolved onto a
  // DIFFERENT track and renamed it too. Settle once, and anchor the write to the
  // statement's start — the one address a rename cannot move.
  const commitRename = (raw: string): void => {
    if (settledRef.current) return
    settledRef.current = true
    setRenaming(false)
    const v = raw.trim()
    if (!v) return
    applyToStripAt(strip.statementRange[0], (fresh, wb, doc) => {
      // Reject a rename that would duplicate another track's display name (#585) —
      // read from the FRESH document, the same projection the other views use.
      const taken = new Set(otherTrackNames(doc, fresh.statementRange[0]))
      // renameEdit validates + no-ops + dup-rejects (→ silent revert); the colour
      // below moves only once the rename is actually in the document.
      if (commit(wb, renameEdit(fresh, v, taken), 'rename') !== 'written') return
      // Migrate a custom-colour override from the OLD display name to the new
      // label so the rename doesn't orphan it (#581).
      if (fileId) {
        const prevColor = getTrackMeta(fileId, strip.name).color
        if (prevColor && strip.name !== v) {
          setTrackMeta(fileId, v, { color: prevColor })
          setTrackMeta(fileId, strip.name, { color: undefined })
        }
      }
    })
  }

  return (
    <div
      data-pattern-track-chip
      // Opaque "box" so the dot + name stay readable: the chip is an overlay
      // pinned to the grid's TOP-LEFT corner, and without a background the
      // pitch-row labels / cells scrolling underneath bled through and made it
      // hard to read (#589). The theme surface bg + border + subtle shadow lift
      // it off the grid; padding gives the dot/name room. Only the BOTTOM-RIGHT
      // corner is rounded — the other three sit flush in the panel corner.
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        padding: '3px 8px',
        background: 'var(--surface, #14142a)',
        border: '1px solid var(--border, #2a2a4a)',
        borderRadius: '0 0 6px 0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {fileId ? (
        <button
          type="button"
          data-pattern-track-dot
          aria-label={`Change colour of ${strip.shownName}`}
          title={`${strip.shownName} — click to change colour`}
          onClick={(e) => setColorAnchor(e.currentTarget.getBoundingClientRect())}
          style={{
            width: 9,
            height: 9,
            padding: 0,
            border: 'none',
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            cursor: 'pointer',
          }}
        />
      ) : (
        <span
          data-pattern-track-dot
          style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
        />
      )}
      {colorAnchor && fileId && (
        <StripColorPopover
          anchorRect={colorAnchor}
          currentColor={dotColor}
          onPick={(color) => setTrackMeta(fileId, strip.name, { color })}
          onReset={() => setTrackMeta(fileId, strip.name, { color: undefined })}
          onClose={() => setColorAnchor(null)}
        />
      )}
      {renaming ? (
        <input
          data-pattern-track-rename
          autoFocus
          defaultValue={renameSeed}
          placeholder="name this track"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            // preventDefault BEFORE committing (#877): the commit unmounts this
            // input, so the browser delivers the keystroke's default action to
            // whatever takes focus next — the editor — typing it into the code.
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename(e.currentTarget.value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelRename()
            }
            e.stopPropagation() // don't let the editor swallow the keystrokes
          }}
          onBlur={(e) => commitRename(e.currentTarget.value)}
          style={{
            minWidth: 0,
            width: 96,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: 'var(--foreground, #e6e6ea)',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 3,
            padding: '0 3px',
            outline: 'none',
          }}
        />
      ) : (
        <span
          data-pattern-track-name
          title={`${strip.shownName} — double-click to rename`}
          onDoubleClick={openRename}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--foreground, #e6e6ea)',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'text',
          }}
        >
          {strip.shownName}
        </span>
      )}
    </div>
  )
}
