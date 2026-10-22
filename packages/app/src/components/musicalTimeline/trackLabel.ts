/**
 * trackLabel — resolve a Song-timeline lane's DISPLAY name from the source label
 * (V-track-1, #579 STEP 2).
 *
 * The live engine keys every track positionally as `d{N}` (the hap `trackId`),
 * dropping the JS label — so a named `bass:` track shows `d1` in the Timeline
 * while the Mixer shows `bass` (the divergence the user reported). STEP 2 closes
 * it: read the label back from the source at the track's OWN `dollarPos` — the
 * `$:`/`bass:` statement offset the engine already stamps on every event
 * (`IREvent.dollarPos`) — so a NAMED track displays its label (and colours by
 * it) while an ANONYMOUS `$:` keeps `d{N}` (shown as `Track N` since #2151 —
 * `resolveLaneShownName` below).
 *
 * Using each lane's OWN `dollarPos` (engine provenance) avoids re-deriving a
 * parallel `d{N}` numbering from the source — the assumption that broke this
 * design TWICE (the engine excludes config lines and counts `_`-muted tracks in
 * ways a naive source parse gets wrong). Each lane resolves independently: no
 * ordering, no off-by-one. Verified live (#579): for `bass:/$:/d3:/$:/lead:/$:`
 * the lanes' dollarPos point exactly at `bass:`, `$:`, `d3:`, `$:`, `lead:`, `$:`.
 *
 * Anonymous-stays-positional (`Track N` on screen) is deliberate friction: a descriptive name requires an
 * explicit `name:` label — the tool never auto-writes one for display
 * (no-auto-naming principle, #579). The display resolves a label when present;
 * it never creates one.
 *
 * Reading the label is the editor's (`labelAtOffset`, since #1921 — the one rule
 * for what a name is, shared with section names, the Mixer and the rename
 * validators). This file keeps only the display fallback.
 */
import { labelAtOffset, shownTrackName } from '@stave/editor'

/**
 * A lane's display NAME: the source label when the track is named, else the
 * positional `laneKey` (`d{N}`). `labelOffset` is the lane's `dollarPos`; null
 * when the lane has no source provenance (a producer-built lane like a chord
 * progression, or `code` not yet available) → keep `laneKey`.
 *
 * The lane's IDENTITY stays `laneKey` (`d{N}`) for the live hap-overlay match —
 * only the display name (and the colour derived from it) resolves to the label.
 */
export function resolveLaneName(
  laneKey: string,
  labelOffset: number | null | undefined,
  code: string | null | undefined,
): string {
  if (code == null || labelOffset == null) return laneKey
  return labelAtOffset(code, labelOffset) ?? laneKey
}

/**
 * What a lane's header SHOWS (#2151): `Track 1` for an unnamed `d1`, else the
 * same name `resolveLaneName` gives. Text only — the colour and the saved
 * per-track settings stay keyed by `resolveLaneName`.
 *
 * Reads the label itself rather than comparing the name with `laneKey`: a track
 * the user labelled `d2:` has `d2` as both, and it must keep showing `d2`. A lane
 * with no source provenance has no label to read, so a positional `d{N}` key
 * there shows as `Track N` too.
 */
export function resolveLaneShownName(
  laneKey: string,
  labelOffset: number | null | undefined,
  code: string | null | undefined,
): string {
  const label = code == null || labelOffset == null ? null : labelAtOffset(code, labelOffset)
  return shownTrackName(label ?? laneKey, label)
}
