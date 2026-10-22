/**
 * writeStrip.ts — the strip controls' write decisions, as PURE functions.
 *
 * Each takes a freshly-detected chunk and a target value and returns the single
 * surgical text edit to make (a replace range + text), or null when the control
 * must hand off (a foreign/patterned value it can't safely rewrite). Keeping the
 * decision pure — `ChunkInfo` + value → `OffsetEdit` — means the fader/pan
 * write-back is unit-testable without Monaco; the caller just applies the edit
 * through the tagged `Writeback` inside `applyToStrip` (one undo step).
 *
 * Surgical & conservative (V-mixer-1, P194): only the targeted literal changes;
 * a signal/expression value disables the control rather than corrupting it.
 */
import type { ChunkInfo } from '../chunkDetect'
import { readGainState, scaleManagedGain } from './gain'
import { setNumberCall } from '../chainEdit'
import type { OffsetEdit } from '../writeback'
import { splitMuteMarker, isWritableName } from '../ir/trackId'
import { detectAllChunks } from '../chunkDetect'
import { buildStripModels } from './stripModel'


/**
 * The edit a fader drag makes for `value` (a linear gain):
 *  - scalar  → replace the literal;
 *  - managed → rescale every velocity column to the new ceiling (shape kept);
 *  - absent  → append `.gain(value)` at the end of the expression;
 *  - foreign → null (a signal gain — the fader is disabled).
 */
export function gainEdit(fresh: ChunkInfo, value: number): OffsetEdit | null {
  const g = readGainState(fresh)
  switch (g.kind) {
    case 'scalar':
    case 'absent':
      return setNumberCall(fresh, ['gain'], 'gain', value)
    case 'managed':
      return { range: g.range, text: scaleManagedGain(g.mg, value) }
    case 'foreign':
      return null
  }
}

/**
 * The edit a pan drag makes for `value` (0..1, 0.5 = centre — grounded GR2):
 *  - scalar  → replace the literal;
 *  - absent  → append `.pan(value)`;
 *  - patterned/signal → null (hands off).
 */
export function panEdit(fresh: ChunkInfo, value: number): OffsetEdit | null {
  return setNumberCall(fresh, ['pan'], 'pan', value)
}

/**
 * The edit a mute toggle makes — flip the `_`-prefix marker on the statement's
 * label (design §6.4, D2). Mute is ORTHOGONAL to gain: it never touches `.gain`
 * (the P194 dual-representation trap, V-mixer-2), only the one-character marker
 * at `statementRange[0]` (the label's first char):
 *  - mute   → insert `_` before the label (`$: …`→`_$: …`, `d1: …`→`_d1: …`);
 *  - unmute → delete that leading `_`.
 * Returns null when already in the requested state, or for an unlabelled
 * statement (a bare expression — `_s(...)` would be a different identifier, so
 * the marker doesn't apply). Surgical: only the marker changes, so unmute is the
 * exact inverse of mute and round-trips byte-for-byte.
 */
export function muteEdit(fresh: ChunkInfo, muted: boolean): OffsetEdit | null {
  if (fresh.label === null) return null // unlabelled — can't carry the marker
  const marker = splitMuteMarker(fresh.label)
  const isMuted = marker.prefix || marker.suffix
  if (muted === isMuted) return null // already in the requested state
  const pos = fresh.statementRange[0]
  if (muted) return { range: [pos, pos], text: '_' } // insert the marker
  // #1679 — unmute removes the marker the label HAS. A trailing `_` (`drums_:`)
  // is Strudel's other spelling; rewriting the label to its bare name covers it
  // and both-sides alike. The prefix-only case keeps its one-character delete.
  if (!marker.suffix) return { range: [pos, pos + 1], text: '' } // delete the leading `_`
  return { range: [pos, pos + fresh.label.length], text: marker.bare }
}


/** A valid track label: a name the user can write (`isWritableName` — any JS
 *  identifier that is not a reserved word, the same rule a section rename uses,
 *  #1924). Exported so the rename UIs can gate/validate keystrokes without
 *  re-deriving the rule. */
export function isValidTrackLabel(name: string): boolean {
  return isWritableName(name)
}

/**
 * The edit an inline rename makes — write the user's chosen `name:` label into
 * the code (#580, Phase C). Renaming is the ONLY way a descriptive name reaches
 * the file: the display never auto-names (the positional `Track N` friction prompts THIS edit).
 *
 *  - named   (`bass:`)  → replace the label with `newLabel` (`lead: …`);
 *  - anon    (`$:`, label `'$'`) → replace the `$` → INSERT a name (`drums: …`);
 *  - the `_` mute marker is PRESERVED (only the bare label is rewritten), so a
 *    muted track stays muted across a rename and the edit round-trips cleanly.
 *
 * Returns null when the statement is unlabelled (a bare expression has no label
 * slot), when `newLabel` is not a valid track label (invalid → no write, the UI
 * reverts), when it equals the current bare label (no-op), or when it would
 * COLLIDE with another track's display name (#585 — see `takenNames`). Surgical:
 * only the label characters change; the pattern expression is byte-identical.
 *
 * `takenNames` = the display names of all OTHER tracks (the caller excludes the
 * track being renamed). A rename whose new label equals one of them is rejected
 * rather than written: a duplicate label collides on the engine's capture/meter
 * join AND on the per-track colour-override key (which is keyed by display name,
 * #581), so two tracks would share one meter and one colour. Consistent with the
 * friction principle (#579) — the UI reverts, exactly like an invalid label, and
 * the user picks a name that's free. Two tracks the user DELIBERATELY labels the
 * same are valid JS and stay shared identity by design (Phase D); this guard only
 * prevents a rename from silently CREATING a new duplicate.
 */
export function renameEdit(
  fresh: ChunkInfo,
  newLabel: string,
  takenNames: ReadonlySet<string>,
): OffsetEdit | null {
  if (fresh.label === null) return null // a bare expression has no label slot
  if (!isValidTrackLabel(newLabel)) return null // invalid → caller reverts
  const { bare: bareLabel, prefix, suffix } = splitMuteMarker(fresh.label)
  if (newLabel === bareLabel) return null // no-op
  if (takenNames.has(newLabel)) return null // #585: would duplicate another track
  // keep the `_` marker on whichever side it is (#1679: a trailing one too)
  const start = fresh.statementRange[0] + (prefix ? 1 : 0)
  const end = fresh.statementRange[0] + fresh.label.length - (suffix ? 1 : 0)
  return { range: [start, end], text: newLabel }
}

/** The subset of strip facts the solo reconciliation needs — `id` (solo key + mute
 *  target), whether it currently carries the `_`, and whether it CAN (labelled). */
export interface SoloStripFacts {
  id: string
  muted: boolean
  muteable: boolean
}

/**
 * The mute markers the code should have after a solo change, plus the snapshot to
 * carry forward — the entire solo/mute policy in one pure, testable function (#735).
 * Solo is a CODE operation: soloing a track writes `_` mute markers on every other
 * track, so the engine silences off the file and the code shows what you hear.
 *
 *  - solo ACTIVE (`newSolo` non-empty): mute every muteable track that ISN'T
 *    soloed; the soloed track(s) go un-muted (audible). The snapshot is captured
 *    on the FIRST activation (the mutes present then) and preserved across further
 *    solo edits, so it always reflects the pre-solo hand-set mutes.
 *  - solo CLEARED (`newSolo` empty): restore the snapshot — the hand-set mutes
 *    from before solo — and drop it. An empty/absent snapshot un-mutes everything.
 *
 * `targetMuted` is the set of ids that should carry `_` afterwards; the caller
 * writes only the strips whose current `muted` differs.
 */
export function reconcileSoloMutes(
  strips: readonly SoloStripFacts[],
  newSolo: ReadonlySet<string>,
  prevSnapshot: ReadonlySet<string> | null,
): { targetMuted: Set<string>; nextSnapshot: ReadonlySet<string> | null } {
  if (newSolo.size > 0) {
    const snapshot =
      prevSnapshot ?? new Set(strips.filter((s) => s.muted).map((s) => s.id))
    const targetMuted = new Set(
      strips.filter((s) => s.muteable && !newSolo.has(s.id)).map((s) => s.id),
    )
    return { targetMuted, nextSnapshot: snapshot }
  }
  // Solo cleared → restore the pre-solo mutes (empty set if there were none).
  return { targetMuted: new Set(prevSnapshot ?? []), nextSnapshot: null }
}

/**
 * The edits a solo change makes to `doc` (#1909): `reconcileSoloMutes` over the
 * document's strips, then a `muteEdit` for each muteable strip whose marker must
 * change. All offsets come from ONE detection of `doc`, so the list is applied
 * together as one undo step. `edits` is empty when every marker is already right —
 * `nextSnapshot` must still be carried forward then.
 */
export function soloMuteEdits(
  doc: string,
  newSolo: ReadonlySet<string>,
  prevSnapshot: ReadonlySet<string> | null,
): { edits: OffsetEdit[]; nextSnapshot: ReadonlySet<string> | null } {
  const chunks = detectAllChunks(doc)
  const strips = buildStripModels(chunks, doc)
  const { targetMuted, nextSnapshot } = reconcileSoloMutes(
    strips.map((s) => ({ id: s.id, muted: s.muted, muteable: s.muteable })),
    newSolo,
    prevSnapshot,
  )
  const edits: OffsetEdit[] = []
  for (const s of strips) {
    if (!s.muteable) continue
    const want = targetMuted.has(s.id)
    if (want === s.muted) continue
    const e = muteEdit(chunks[s.index], want)
    if (e) edits.push(e)
  }
  return { edits, nextSnapshot }
}
