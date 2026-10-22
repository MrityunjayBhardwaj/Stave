/**
 * A section's display NAME, read from the user's own source (#1391).
 *
 * The sibling of `trackLabel.ts`, one level down: that module resolves a
 * TRACK's name from the labelled statement at its `dollarPos`; this one
 * resolves a SECTION's name from the arrange arm's source range. Same division
 * of labour, deliberately — the walk carries an offset out of the IR, and the
 * layer that holds the user's code turns it into a name. Kept in its own file so
 * `trackLabel.ts` keeps meaning what it says.
 *
 * ── THE NAME IS ALREADY THERE ────────────────────────────────────────────────
 * Nothing new is asked of the musician. `ArrangeArm.loc` is the `[n, pat]` TUPLE
 * range — it exists so write-back can edit the weight `n` — and those same bytes
 * carry whatever the arm was written as. Measured on a real document:
 *
 *   arm 0  weight=4  source="[4, intro]"
 *   arm 1  weight=8  source="[8, verse]"
 *   arm 2  weight=4  source="[4, outro]"
 *
 * So `intro` / `verse` / `outro` are recoverable without a `name:` field, a new
 * combinator, or any new syntax. The name is the one the musician already wrote.
 *
 * ── WHY IT ONLY EVER ACCEPTS A BARE IDENTIFIER ───────────────────────────────
 * An arm can be any expression. `arrange([4, s("bd*4").gain(0.8)], …)` has no
 * name in it, and the honest answer there is a positional fallback rather than a
 * caption derived from the music — a clip labelled `bd` is what this issue was
 * opened about. So the rule is narrow on purpose: a bare identifier is a name,
 * and everything else is unnamed.
 *
 * Reading the name is the editor's (`sectionNameAt`, since #1921), so a section
 * and a track agree on what a name is — `前奏` names either. This file keeps only
 * the ordinal fallback.
 */
import { sectionNameAt } from '@stave/editor'

/**
 * The name of an arm that has none: an ORDINAL, never a guess at the music.
 *
 * Shared by the collector (which knows `armIndex` but holds no source) and the
 * resolver below (which has both), so the two cannot drift into disagreeing
 * about what an unnamed section is called.
 */
export function positionalSectionName(armIndex: number): string {
  return `§${armIndex + 1}`
}

/**
 * A clip's display name: the identifier its arm was bound to, else a positional
 * `§{n}`.
 *
 * ⚠ THE CLIP'S IDENTITY STAYS `armIndex`, exactly as a lane's identity stays
 * `laneKey` while only its `displayName` resolves to the source label. Renaming
 * a section must not make it a different clip.
 *
 * The fallback is an ORDINAL, never a guess at the music — `§2` says "the second
 * section, which has no name", which is true and useful. Naming it after the
 * first sample that happens to fire in it is precisely the behaviour #1391 was
 * filed to remove.
 */
export function resolveSectionName(
  armIndex: number,
  nameRange: readonly [number, number] | null | undefined,
  code: string | null | undefined,
): string {
  const positional = positionalSectionName(armIndex)
  if (code == null || nameRange == null) return positional
  return sectionNameAt(code, nameRange) ?? positional
}
