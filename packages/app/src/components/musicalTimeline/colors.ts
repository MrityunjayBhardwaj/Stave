/**
 * colors — stem-aware track-color fallback (Phase 20-02 DV-04).
 *
 * The mockup's Variant A panel uses 4 stem-family colors derived
 * from the design tokens at artifacts/daw-level1-mockup.html:18-22:
 *   --stem-drums:  #f97316  (orange)
 *   --stem-bass:   #06b6d4  (cyan)
 *   --stem-pad:    #10b981  (green)
 *   --stem-melody: #a78bfa  (purple)
 *
 * Match precedence (DV-11): drums → bass → pad → melody. First match
 * wins. Fallback (no match) returns melody/purple — chosen so that an
 * unrecognized sample lands in the most-musical visual register
 * rather than a neutral gray.
 *
 * Match input: `event.s ?? trackId`. Sample name (when present)
 * outranks trackId because users author with `s("bd")` and the
 * trackId is often a synthetic dedupe of the sample.
 *
 * `evt.color` per-event override is honored at the call site (D-06
 * user-override) — `MusicalTimeline.tsx`'s
 * `evt.color ?? trackColorFromStem(...)` chain. This module owns
 * only the fallback.
 *
 * Phase 20-02 (T-02). Replaces the PR #92 hash-based fallback.
 */

/** Stem palette literals — copied verbatim from the mockup tokens. */
export const STEM_DRUMS = '#f97316'
export const STEM_BASS = '#06b6d4'
export const STEM_PAD = '#10b981'
export const STEM_MELODY = '#a78bfa'
export const STEM_FALLBACK = STEM_MELODY // DV-04 — fallback equals melody.

/**
 * Stem regex precedence (DV-11). Order matters — first match wins.
 * Each pattern is anchored with `^` so prefixes match without
 * accidentally hitting embedded substrings (e.g. `pre-bd` should
 * not match `bd`).
 */
const STEM_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Drums.
  [/^(?:bd|hh|sd|cp|hat|kick|snare|drum|perc|ride|crash|tom)/i, STEM_DRUMS],
  // Bass.
  [/^(?:bass|sub|808)/i,                                          STEM_BASS],
  // Pads.
  [/^(?:pad|pads)/i,                                               STEM_PAD],
  // Melody / lead / synth / piano / keys / guitar.
  [/^(?:lead|melody|synth|piano|keys|guitar)/i,                    STEM_MELODY],
] as const

/**
 * Map a track to its stem color.
 *
 * @deprecated Phase 20-11 — use the editor's `trackIdentity(trackId).color`
 * (`@stave/editor`) instead. This shim is preserved for back-compat during the
 * 20-11 → 20-12 chrome migration. Existing callers (chord-progression demo
 * files, tests) keep working until 20-12 retires this.
 *
 * @param trackId  the row's stable track id (never null — '$default'
 *                 is the sentinel from groupEventsByTrack)
 * @param sample   optional first-seen sample name from the row's
 *                 events (`event.s`). Outranks `trackId` for matching.
 * @returns        a hex color string from the stem palette, or
 *                 STEM_FALLBACK if no pattern matches.
 */
export function trackColorFromStem(
  trackId: string,
  sample?: string,
): string {
  const candidate = sample ?? trackId
  for (const [pattern, color] of STEM_PATTERNS) {
    if (pattern.test(candidate)) return color
  }
  return STEM_FALLBACK
}

/**
 * The track palette (`TRACK_PALETTE_32`, `paletteForTrack`, `trackIndexOf`,
 * `colorForTrack`, `trackIdentity`) lives in the editor's `codeView/trackColor.ts`,
 * and the app reads it from `@stave/editor`. This file kept a mirrored copy, with a
 * drift test, until the app's tests could load the editor's main entry (#1938);
 * #1943 retired it.
 */

// FNV-1a 32-bit — a stable string-to-slot hash for the automation palette below.
function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Automation-curve hues, keyed by PARAMETER (#1485).
 *
 * A lane can carry several automated parameters — 47 corpus documents automate
 * `pan` and 76 automate `cutoff`, and a track doing both is ordinary. Drawn in
 * one colour they are three identical lines sharing a band, and since every
 * curve is normalised to its OWN range there is no positional cue either: a
 * curve near the top of the band is not "the high one", it is whichever signal
 * happens to be near its own maximum. The stacked bounds captions name three
 * parameters and tie none of them to a line.
 *
 * ⚠ DELIBERATELY NOT `TRACK_PALETTE_32`. Reusing the track palette is the
 * obvious "reuse the solved problem" move and it collides: an automation curve
 * is drawn INSIDE a lane, over that lane's own marks, so a `cutoff` curve
 * landing on a neighbouring track's swatch reads as belonging to that track.
 * What is genuinely reused is the solved part — `fnv1a32`, a stable string to
 * slot — over a palette of its own.
 *
 * Chosen to stay legible over both the light and dark row fills the timeline
 * draws, and to be distinguishable from each other at 1.5px stroke width, which
 * is what a curve is.
 */
export const AUTOMATION_PALETTE: readonly string[] = [
  '#8cc8ff', // blue — the family's original single colour, kept as slot 0
  '#f0a3c8', // pink
  '#8ce8b4', // green
  '#ffd08a', // amber
  '#c9a8ff', // violet
  '#6fe3e3', // teal
  '#ff9e8a', // salmon
  '#d6e08c', // olive
]

/**
 * A parameter's stable curve colour.
 *
 * Keyed on the parameter name rather than on its position in the lane, so
 * `cutoff` is the same colour in every track and across redraws — a lane
 * gaining a second automation must not recolour the first, or the hue means
 * "how many curves are here" instead of "which parameter is this".
 */
export function colorForAutomation(paramKey: string): string {
  return AUTOMATION_PALETTE[fnv1a32(paramKey) % AUTOMATION_PALETTE.length]
}

/**
 * The colour one automation takes ON ITS LANE — the palette hue when the lane
 * carries several, the theme's own automation colour when it carries one.
 *
 * ⚠ THE RULE LIVES HERE BECAUSE IT NOW HAS TWO READERS. The curve and its
 * caption are drawn by `drawTimeline`; #1464 Stage 2 draws an input over that
 * caption, and the input must take the same colour or the tie between a bound
 * and its curve breaks for exactly the lanes the hue exists to disambiguate.
 * With ONE automation there is nothing to disambiguate, so the lane keeps the
 * theme colour and looks as it always did — and the count, not the position, is
 * what decides, so a lane gaining a second curve does not recolour the first.
 */
export function automationColorOnLane(
  paramKey: string,
  laneAutomationCount: number,
  singleColor: string,
): string {
  return laneAutomationCount <= 1 ? singleColor : colorForAutomation(paramKey)
}

/**
 * The count `automationColorOnLane` is asked with, for a lane: curves AND
 * staircases together, the way the canvas counts them (#1463). A DOM editor
 * coloured to match what the canvas painted asks here, so it cannot count one
 * class and open in a different colour from the text it covers (#1576).
 * A lane that is not found counts as one, which is the single-colour answer.
 */
export function automationCountOnLane(
  lane: { readonly automations: readonly unknown[]; readonly stepped: readonly unknown[] } | undefined,
): number {
  return lane ? lane.automations.length + lane.stepped.length : 1
}
