/**
 * silencedTracks — the cross-view "which tracks read as inactive" selector.
 *
 * A track is SILENCED when it's MUTED (the `_` marker) OR a solo is active
 * elsewhere and it isn't one of the soloed tracks — the exact rule the Mixer
 * dims a strip by (`LocalMixerStrip`: mute button + `dimmed = soloActive &&
 * !soloed.has(id)`), widened to include mute so the Song Timeline can express
 * BOTH as a lane fade (the Timeline has no mute button — dimming is its only
 * "inactive" affordance).
 *
 * It returns the silenced tracks' DISPLAY NAMES (`StripModel.name`) — the SAME
 * key the Song Timeline lanes by (`SceneLane.displayName`, both from the shared
 * `trackIdentity`), NOT the strip's `id` (which is `#k` for anonymous tracks and
 * would never match a lane's `d{N}` display key). Joining by display name is why
 * a mute in the Mixer fades the right lane and the two views can't disagree
 * (PV155).
 *
 * READ-ONLY: it OBSERVES solo via `useSoloedIds` (which, unlike `useSoloStrips`,
 * does NOT acquire the eval-source overlay), so a Timeline that merely reflects
 * solo can never keep the audio silencing alive. It re-derives the strip names
 * from the active document on every edit — the same pure `buildStripModels`
 * projection the Mixer renders (invariant V-mixer-1) — so a mute typed in code
 * and a solo clicked in the Mixer both light here without a shared store between
 * them.
 */
import * as React from 'react'

import { getActiveEditor, onActiveEditorChange } from '../../workspace/editorRegistry'
import { detectAllChunks } from '../../codeView'
import { buildStripModels } from '../../codeView'
import { useSoloedIds } from './soloStore'

/** The minimal strip facts the fade rule needs: stable `id` (the solo key), the
 *  `name` (the Timeline join key), and whether it carries the mute marker. */
export interface SilenceFacts {
  id: string
  name: string
  muted: boolean
}

/**
 * The DISPLAY NAMES silenced by mute or a solo elsewhere — the pure rule behind
 * the hook, exported so it unit-tests without a React harness. A track is
 * silenced when it's `muted`, OR any track is soloed and THIS one isn't among
 * them (the Mixer's `dimmed` rule). Keyed by `name` because that's the Timeline's
 * lane key; `id` is only the solo membership test. Empty in → empty out.
 */
export function silencedNamesFrom(
  strips: readonly SilenceFacts[],
  soloed: ReadonlySet<string>,
): Set<string> {
  const soloActive = soloed.size > 0
  const out = new Set<string>()
  for (const s of strips) {
    if (s.muted || (soloActive && !soloed.has(s.id))) out.add(s.name)
  }
  return out
}

/**
 * The DISPLAY NAMES of every track that currently reads as silenced (muted, or
 * dimmed by a solo elsewhere) for the active file. Feed it to the Song Timeline
 * to fade the matching lanes, mirroring the Mixer. Empty when nothing is muted
 * and no solo is active (every track plays → nothing faded).
 */
export function useSilencedTrackNames(): ReadonlySet<string> {
  const soloed = useSoloedIds()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editor, setEditor] = React.useState<any>(() => getActiveEditor())
  const [strips, setStrips] = React.useState<SilenceFacts[]>([])

  // Track the active editor (same registry source as the Mixer, so the strip
  // names here match what the Mixer shows for the same document).
  React.useEffect(() => {
    setEditor(getActiveEditor())
    return onActiveEditorChange(() => setEditor(getActiveEditor()))
  }, [])

  // Re-derive the strip names on mount and on every content change — a pure
  // projection of the document, so it always reflects the live text (a mute
  // marker typed or removed in code re-derives immediately, like the Mixer).
  React.useEffect(() => {
    if (!editor) {
      setStrips([])
      return
    }
    const rederive = (): void => {
      const model = editor.getModel?.()
      if (!model) {
        setStrips([])
        return
      }
      setStrips(
        buildStripModels(detectAllChunks(model.getValue()), model.getValue()).map((s) => ({
          id: s.id,
          name: s.name,
          muted: s.muted,
        })),
      )
    }
    rederive()
    const model = editor.getModel?.()
    const sub = model?.onDidChangeContent?.(rederive)
    return () => sub?.dispose?.()
  }, [editor])

  return React.useMemo(() => silencedNamesFrom(strips, soloed), [strips, soloed])
}
