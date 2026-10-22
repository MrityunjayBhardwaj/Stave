/**
 * trackMetaPrune.ts — per-eval cleanup of orphaned per-track metadata (#581 / #583).
 *
 * `stripModel` is a PURE projection and `WorkspaceFile` owns the stateful Yjs
 * store; this tiny module is the one place that bridges them, so neither side
 * takes on the other's concern. It computes the current track set straight from
 * the code (the SAME `buildStripModels` projection the Mixer renders, so the keys
 * match `setTrackMeta`'s display-name keys exactly) and drops `TrackMeta` records
 * for tracks that no longer exist.
 *
 * Guard: an evaluate that yields no strips (a transient/empty source) must never
 * wipe the user's colours — so an empty set is a no-op, never a full prune.
 */
import { detectAllChunks } from '../../codeView'
import { buildStripModels } from '../../codeView'
import { pruneTrackMeta } from '../../workspace/WorkspaceFile'

export function pruneTrackMetaForCode(fileId: string, code: string): void {
  const names = new Set<string>()
  for (const s of buildStripModels(detectAllChunks(code), code)) {
    if (s.name) names.add(s.name)
  }
  if (names.size === 0) return
  pruneTrackMeta(fileId, names)
}
