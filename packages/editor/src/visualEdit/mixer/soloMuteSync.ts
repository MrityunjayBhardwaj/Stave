/**
 * soloMuteSync — solo as a CODE operation (#735).
 *
 * Mute is a document property: the `_` marker in the source (`d1:` → `_d1:`), so
 * it's visible and bidirectional. Solo used to be an in-memory eval overlay with
 * no code-view trace, which read as inconsistent. This makes solo WRITE the mute
 * markers instead: soloing a track mutes every other (muteable) track in the
 * source and un-mutes the soloed one, so the engine silences off the file and the
 * code shows exactly what you hear. Un-soloing RESTORES the mutes that were set by
 * hand before solo (snapshotted in `soloStore`), so a pre-existing mute survives a
 * solo→un-solo round-trip instead of being wiped.
 *
 * The policy and the edits it makes are pure code↔view operations
 * (`reconcileSoloMutes` / `soloMuteEdits` in `codeView/mixer/writeStrip`, #1909);
 * this hook wires them to the active editor and commits the markers in one undo
 * step.
 */
import * as React from 'react'

import { getActiveEditor, getActiveFileId } from '../../workspace/editorRegistry'
import { commitToEditor, soloMuteEdits } from '../../codeView'
import {
  getPreSoloMutes,
  setPreSoloMutes,
  useSoloStrips,
} from './soloStore'

/**
 * The Mixer's solo hook: `soloed` for the button highlight + a `toggle` that flips
 * the solo set AND writes the resulting `_` mute markers into the source as one
 * undo step. Self-contained — it derives the strips from the active editor at
 * click time (the same pure `buildStripModels` projection the Mixer renders), so
 * it needs no mixer-model plumbing and can't write to the wrong strip.
 */
export function useSoloMuteSync(): {
  soloed: ReadonlySet<string>
  toggle: (id: string) => void
} {
  const { soloed, toggle: toggleSet } = useSoloStrips()
  const toggle = React.useCallback(
    (id: string) => {
      const fileId = getActiveFileId()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor: any = getActiveEditor()
      const model = editor?.getModel?.()

      const newSolo = new Set(soloed)
      if (newSolo.has(id)) newSolo.delete(id)
      else newSolo.add(id)

      if (editor && model) {
        // Only the strips whose marker actually changes, as ONE undo step (and one
        // live re-eval). The snapshot moves on even when nothing needed writing —
        // but not when there was no document to write to.
        const { edits, nextSnapshot } = soloMuteEdits(model.getValue(), newSolo, getPreSoloMutes(fileId))
        if (commitToEditor(editor, edits, 'mixer') !== 'no-document') {
          setPreSoloMutes(fileId, nextSnapshot)
        }
      }

      // Update the in-memory highlight set (the solo button's lit state).
      toggleSet(id)
    },
    [soloed, toggleSet],
  )
  return { soloed, toggle }
}
