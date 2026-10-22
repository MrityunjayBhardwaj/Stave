/**
 * Test helper: reduce synthetic collect-style events to lane skeletons through the REAL
 * production reducer, for tests whose `structuralWalk` fixture has no real IR to walk. Since
 * #1943 the app tests take every other editor name from the real `@stave/editor` (an
 * `importOriginal` spread), so this file re-exports nothing; it only builds the fixture, and
 * never a hand-rolled copy of the reducer, which would be a second oracle free to drift.
 */
// ⚠ BY SOURCE PATH, NEVER `@stave/editor`: this file is loaded INSIDE the tests'
// `vi.mock('@stave/editor', …)` factories, so importing the module being mocked from here
// waits on the factory that is waiting on this file — the run hangs, silently (#1943).
import {
  aggregateLaneItems,
  type LaneItem,
  type WalkWindow,
} from '../../../../../editor/src/codeView/ir/structuralWalk'
import type { IREvent } from '../../../../../editor/src/codeView/ir/IREvent'

/**
 * Reduce collect-style events to lane skeletons exactly as `structuralWalk` aggregates its own
 * walk items — the identical event→LaneItem mapping the corpus gate's oracle uses
 * (`structuralWalk.test.ts` `collectLanes`). Lets a synthetic-event mock produce the structure
 * maps without a real IR to walk, while still routing through the production reducer.
 */
export function skeletonsFromEvents(
  events: readonly Partial<IREvent>[],
  window: WalkWindow,
): ReturnType<typeof aggregateLaneItems> {
  const items: LaneItem[] = events.map((ev) => ({
    laneKey: ev.trackId ?? ev.s ?? '$default',
    cycle: Math.floor(ev.begin ?? 0),
    ...(ev.dollarPos !== undefined ? { dollarPos: ev.dollarPos } : {}),
    ...(ev.leafIndex !== undefined ? { leafIndex: ev.leafIndex } : {}),
    ...(ev.armIndex !== undefined ? { armIndex: ev.armIndex } : {}),
    ...(ev.loc ? { loc: ev.loc } : {}),
    labelValue: ev.s ?? (ev.note != null ? String(ev.note) : undefined),
  }))
  // The window travels straight through — a mock that dropped it would report
  // the same skeletons at every origin, which is the defect #1209 fixed.
  return aggregateLaneItems(items, window)
}
