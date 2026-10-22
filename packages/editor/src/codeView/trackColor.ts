/**
 * trackColor — the SINGLE deterministic track-color algorithm, shared by the
 * Mixer console strips and the Song/musical Timeline (V-track-1, issue #579).
 *
 * Before this module each view coloured tracks its own way: the Timeline used
 * `paletteForTrack(trackIndexOf(laneKey), laneKey)` over a 32-cell palette
 * (`app/.../musicalTimeline/colors.ts`), while the Mixer used the drum-voice
 * palette (`stripModel.stripColor` → `sampleVoice`). Same track, two colours.
 *
 * The palette lived in the APP package, which the EDITOR cannot import
 * (`panels/noteColor.ts:13-15` — the editor barrel can't reach app code), which
 * is exactly why the two diverged. So the canonical algorithm lives HERE, in the
 * editor, where the Mixer can import it directly. The app's `colors.ts` keeps an
 * identical copy (it can't import the editor barrel either — that drags
 * `@strudel/draw → gifenc` into app unit tests and crashes them, P172), and a
 * drift-guard test deep-imports THIS module and asserts the two never diverge —
 * the same mirror-with-guard pattern as `laneKeyOf`/`resolveLaneKey`. One
 * algorithm, two provably-equal copies, neither importing the other at runtime.
 *
 * This file is PURE: no React, no audio, no IR, no heavy deps — so the Mixer can
 * import it freely and the drift-guard can deep-import it barrel-free.
 *
 * Keep this byte-for-byte equivalent (in OUTPUT) to `colors.ts` — the
 * drift-guard test (`musicalTimeline/__tests__/trackColor.drift.test.ts`) fails
 * loudly if they diverge.
 */

/**
 * TRACK_PALETTE_32 — 4 stem hues × 8 lightness steps = 32 cells.
 * Allocation: index `i` → stem-family `i % 4`, shade `Math.floor(i / 4)`.
 * `paletteForTrack` composes with `stemHueGroup` to bias a track's slot toward
 * its sample-derived hue family. Mirror of `colors.ts:TRACK_PALETTE_32`.
 */
export const TRACK_PALETTE_32: readonly string[] = [
  // Drums (orange family) — 8 lightness steps
  '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
  // Bass (cyan family) — 8 lightness steps
  '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
  // Pad (green family) — 8 lightness steps
  '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b',
  // Melody (purple family) — 8 lightness steps
  '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95',
] as const

/**
 * Stem regex precedence (DV-11). Order matters — first match wins, and the
 * family index IS the array position (drums=0, bass=1, pad=2, melody=3). Each
 * pattern is anchored with `^` so prefixes match without hitting embedded
 * substrings. Mirror of `colors.ts:STEM_PATTERNS` (the palette-relevant subset):
 * both classify by POSITION, so the two arrays MUST keep the same regexes in the
 * same ORDER — `trackColor.drift.test.ts` fuzzes `stemHueGroup` to catch a
 * divergence. (#586: a previous version stored an explicit index here while the
 * app returned the loop position — equal only because the stored values happened
 * to be 0,1,2,3 in order; that redundant index was the latent reorder hazard, so
 * it's dropped and both now classify identically by position.)
 */
const STEM_PATTERNS: ReadonlyArray<RegExp> = [
  // Family 0 — drums
  /^(?:bd|hh|sd|cp|hat|kick|snare|drum|perc|ride|crash|tom)/i,
  // Family 1 — bass
  /^(?:bass|sub|808)/i,
  // Family 2 — pads
  /^(?:pad|pads)/i,
  // Family 3 — melody / lead / synth / piano / keys / guitar
  /^(?:lead|melody|synth|piano|keys|guitar)/i,
] as const

// FNV-1a 32-bit. Locally scoped (mirrors `colors.ts:fnv1a32`).
function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// Stem-family classifier — returns the array POSITION of the first matching
// pattern, an index 0..3 (drums|bass|pad|melody). Unknown → 3 (melody). Position-
// based, byte-identical to `colors.ts:stemHueGroup` (#586).
function stemHueGroup(sample?: string): number {
  if (!sample) return 3
  for (let i = 0; i < STEM_PATTERNS.length; i++) {
    if (STEM_PATTERNS[i].test(sample)) return i
  }
  return 3
}

/**
 * Map a track to a stable 0..31 palette index. Auto-name shape (`d1`..`d{N}`):
 * parse the digit, return N-1 mod 32 — so `d1`,`d2`,… get sequential cells.
 * Any other name: FNV-1a 32-bit hash mod 32. Mirror of `colors.ts:trackIndexOf`.
 */
export function trackIndexOf(trackId: string): number {
  const m = trackId.match(/^d(\d+)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1) return ((n - 1) % 32 + 32) % 32
  }
  return fnv1a32(trackId) % 32
}

/**
 * Map a (trackIndex, sampleHint) to a palette slot:
 * `(trackIndex * 4 + stemHueGroup(sampleHint)) % 32`. Mirror of
 * `colors.ts:paletteForTrack`.
 */
export function paletteForTrack(trackIndex: number, sampleHint?: string): string {
  const hueGroup = stemHueGroup(sampleHint)
  const slot = (((trackIndex * 4 + hueGroup) % 32) + 32) % 32 // safe mod for negative
  return TRACK_PALETTE_32[slot]
}

/**
 * THE canonical entry point: a track's colour from its canonical key. Composes
 * the two steps the Timeline already applies at its call site
 * (`FullSongTimeline.tsx`: `paletteForTrack(trackIndexOf(laneKey), laneKey)`),
 * so passing the SAME key in any view yields the SAME colour. The key is its own
 * stem hint — a `d1`/`bass` key biases its own hue family, exactly as the
 * Timeline does today.
 *
 * Pass the track's canonical key: the statement label (`d1`, `bass`) for a named
 * track, the positional id (`#0`…) for an anonymous `$:`. For a named track this
 * equals the Timeline's `laneKey` (the inner `.p()` name == the label), so the
 * Mixer dot and the Timeline lane resolve to one colour.
 */
export function colorForTrack(key: string): string {
  return paletteForTrack(trackIndexOf(key), key)
}

/** A track's resolved visual identity — name + colour from one canonical key. */
export interface TrackIdentity {
  /** the canonical key both name and colour derive from */
  readonly key: string
  /** the display name (the key itself: a label, or a sample for an anon track) */
  readonly name: string
  /** the dot/lane colour = `customColor ?? colorForTrack(key)` (V-track-2, #581) */
  readonly color: string
}

/**
 * THE track-identity resolver (V-track-1, #579, Phase B): a track's name AND
 * colour from ONE canonical key, so no view derives either independently. The
 * name IS the key (a label like `d1`, or a sample like `hh` for an anonymous
 * track — whichever the caller resolved as the track's display key); the colour
 * is `colorForTrack(key)`.
 *
 * Both views feed this with their own key, resolved from their own substrate:
 * the Mixer from the detected chunk (label → sample → head), the Song Timeline
 * from the evaluated hap's laneKey (`trackId ?? s`). For one track those keys are
 * equal, so both views resolve to one {name, colour}. The Timeline produces this
 * shape by construction (its header shows `laneKey` and colours by
 * `paletteForTrack(trackIndexOf(laneKey), laneKey)` === `colorForTrack(laneKey)`),
 * mirror-guarded by `trackColor.drift.test.ts`; the Mixer calls this directly.
 *
 * Phase D (V-track-2, #581): an optional `customColor` LAYERS a per-track user
 * override on top of the deterministic palette — `customColor ?? colorForTrack(key)`.
 * The override is persisted per-file in the `TrackMeta` Yjs store keyed by the
 * track's DISPLAY NAME (the same `key` both views resolve to), NEVER written into
 * the source code. Passing it HERE — not at each view's call site — keeps the
 * layering single-source so the Mixer dot and the Timeline lane can't disagree on
 * an overridden colour (the same reason the deterministic palette is centralised).
 * `colorForTrack` stays pure/deterministic (recompute-safe); only this resolver
 * knows about the override.
 */
export function trackIdentity(key: string, customColor?: string): TrackIdentity {
  return { key, name: key, color: customColor ?? colorForTrack(key) }
}
