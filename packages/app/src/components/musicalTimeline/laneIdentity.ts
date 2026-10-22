/**
 * laneIdentity — the source-containment reconciler for timeline lanes.
 *
 * A lane's KEY is the editor's `laneKeyOf` (`trackId ?? s ?? '$default'`), read
 * from `@stave/editor`. This file used to keep a copy of it (`resolveLaneKey`),
 * with a drift test, because the app's tests could not load the editor's main
 * entry; #1938 fixed that and #1943 retired the copy.
 *
 * Milestone #497 (timeline unification), phase U1 (#498).
 */

/**
 * SOURCE CONTAINMENT — the one reconciler for "which declared statement does
 * this source offset belong to": the anchor whose start is the LARGEST one ≤
 * `start`. This is the rule that aligns the two lane-NAME spaces at this
 * boundary, where string equality splits them (PV175): an anon `$:` is `d{N}` to
 * the IR and `$N` to the engine, and a `.p('name')` track is `d{N}` to the IR and
 * `name` to the row. Both sides carry source offsets; only the names disagree.
 *
 * `anchors` MUST be ascending by offset — the scan breaks on the first anchor
 * past `start`, so an unsorted list silently returns a wrong (or no) answer.
 * Callers sort once and pass the sorted list.
 *
 * Its completeness is load-bearing in the same way: an anchor list built only
 * from event-PRODUCING tracks makes a located hap of a silent track fold into
 * the previous track's lane (P306). Build anchors from what the DOCUMENT
 * declares, not from what produced output.
 *
 * `undefined` start (a hap with no `loc`, a row with no statement offset) has no
 * positional answer and returns `undefined` — never a guess.
 */
export function containingAnchor(
  anchors: ReadonlyArray<readonly [string, number]>,
  start: number | undefined,
): string | undefined {
  if (typeof start !== 'number' || !Number.isFinite(start)) return undefined
  let hit: string | undefined
  for (const [key, pos] of anchors) {
    if (pos <= start) hit = key
    else break // ascending → no later anchor can be ≤ start
  }
  return hit
}
