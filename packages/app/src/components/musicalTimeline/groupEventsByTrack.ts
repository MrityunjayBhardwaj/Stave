/**
 * groupEventsByTrack — pure event-grouping helper for MusicalTimeline.
 *
 * D-04: track key = `event.trackId ?? event.s ?? '$default'`. The
 * `'$default'` sentinel is never a real producer name — drumPattern.ts
 * sets `trackId = hit.s` and chordProgression.ts sets `trackId = 'chord-N'`.
 * Anything that falls through to '$default' is a Pure node or a future
 * producer that hasn't claimed an explicit track.
 *
 * Insertion order: each unique key is appended in first-seen order across
 * the input array. Stable across snapshots is the COMPONENT's job
 * (`stableTrackOrder`); this helper just preserves the order it sees.
 *
 * PV34: returns a fresh array on every call — listeners using shallow
 * comparison will see real changes propagate.
 *
 * Phase 20-01 PR-B (T-02).
 */

import type { IREvent } from '@stave/editor'
import { laneKeyOf } from '@stave/editor'

export interface TrackGroup {
  /** Track id — never null. `'$default'` is the fallback sentinel. */
  readonly trackId: string
  readonly events: readonly IREvent[]
}

/**
 * Group events by their lane key (the editor's `laneKeyOf` = `trackId ?? s ?? '$default'`,
 * the single identity source shared with the scene + overlay, #498). Insertion
 * order matches first-seen-key order in the input.
 */
export function groupEventsByTrack(
  events: readonly IREvent[],
): readonly TrackGroup[] {
  if (events.length === 0) return []
  const order: string[] = []
  const buckets = new Map<string, IREvent[]>()
  for (const evt of events) {
    const key = laneKeyOf(evt)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.push(evt)
  }
  return order.map((trackId) => ({ trackId, events: buckets.get(trackId)! }))
}
