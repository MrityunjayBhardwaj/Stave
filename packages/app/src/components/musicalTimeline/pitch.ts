/**
 * pitch — Phase 20-12 α-6.
 *
 * Pitch extraction for chrome's Y-as-pitch axis (β-4). Reads pitch from an
 * IREvent in priority order, normalising every shape to MIDI:
 *
 *   1. evt.note               — top-level (Play-leaf, set by parseMini for
 *                               note(...) literals; collect.ts:230 area).
 *   2. evt.params.note        — chained `.note(...)` Param (collect.ts:438
 *                               flow — `n / note / bank / scale / pan / speed`
 *                               flow through params only, NOT to top-level).
 *   3. evt.params.n           — chained `.n(...)` Param.
 *   4. evt.params.freq        — chained `.freq(...)` Param (whitelist add
 *                               in α-1 / D-06; pre-α-1 always undefined).
 *
 * String values go through the editor's `noteToMidi`, the one note-name
 * reader, whose grammar is Strudel's (`cs3`, `ef3` and a bare `g` all read,
 * #1928); numeric values are MIDI directly except `freq` which routes through
 * `freqToMidi`.
 *
 * `n` interpretation: in Strudel, `.n(N)` is a scale-degree offset when a
 *  `.scale(...)` is attached, otherwise a direct MIDI number. v1 chrome
 *  treats `.n(N)` as MIDI; the `.scale()`-aware refinement is deferred.
 *  Surfaced here so the chrome doesn't silently mis-position scale-bound
 *  notes.
 */

import { noteToMidi, type IREvent } from '@stave/editor'

/**
 * Convert frequency (Hz) to MIDI (float). 440 Hz → 69 (A4). Useful for
 * `.freq(440)` chains where the user supplied a literal Hz.
 */
export function freqToMidi(freq: number): number {
  if (!Number.isFinite(freq) || freq <= 0) return NaN
  return 12 * Math.log2(freq / 440) + 69
}

export type ExtractedPitchSource =
  | 'note'
  | 'params.note'
  | 'params.n'
  | 'params.freq'

export interface ExtractedPitch {
  /** Which axis the pitch was read from — useful for tooltip explanation. */
  source: ExtractedPitchSource
  /** MIDI value (may be fractional for `.freq()` reads). */
  midi: number
}

/**
 * Read pitch from an event, normalised to MIDI. Returns null when no pitch
 * source is present (percussive event). Used by β-4's pitch-to-Y mapping
 * and by β-5's tooltip enrichment.
 *
 * `evt.params` may be undefined for legacy events without 20-10's Param
 * substrate; treat as empty.
 */
export function extractPitch(evt: IREvent): ExtractedPitch | null {
  // 1. evt.note (top-level, Play-leaf only — collect.ts:230 area).
  if (evt.note !== null && evt.note !== undefined) {
    if (typeof evt.note === 'number') {
      return { source: 'note', midi: evt.note }
    }
    if (typeof evt.note === 'string') {
      const m = noteToMidi(evt.note)
      if (m !== null) return { source: 'note', midi: m }
    }
  }
  // 2-4. evt.params (.note(), .n(), .freq() chains).
  const params = evt.params
  if (!params) return null

  const tryParam = (
    key: 'note' | 'n' | 'freq',
    source: ExtractedPitchSource,
  ): ExtractedPitch | null => {
    const v = (params as Record<string, unknown>)[key]
    // `v == null` rejects undefined + null but PRESERVES 0 (a valid MIDI;
    // C-1). Using `!v` would skip 0 — wrong.
    if (v === null || v === undefined) return null
    if (typeof v === 'number') {
      const midi = key === 'freq' ? freqToMidi(v) : v
      if (!Number.isFinite(midi)) return null
      return { source, midi }
    }
    if (typeof v === 'string') {
      const midi = noteToMidi(v)
      if (midi !== null) return { source, midi }
    }
    return null
  }

  return (
    tryParam('note', 'params.note') ??
    tryParam('n', 'params.n') ??
    tryParam('freq', 'params.freq')
  )
}

/**
 * Phase 20-12 β-4 — map a MIDI value to a Y coordinate within a sub-row's
 * Y-band, using auto-fit per `range`.
 *
 * Inputs:
 *   - `midi`: pitch (may be fractional for `.freq()` reads).
 *   - `band`: { top, height } of the sub-row's vertical extent (px from grid
 *      top); β-2's `LeafLayout.{top, height}` is the producer.
 *   - `range`: { min, max } MIDI values for THIS leaf — auto-fit per leaf
 *      so two leaves on the same track don't share an axis (CONTEXT
 *      pre-mortem #1: sub-row Y-band collapse).
 *   - `barHeight`: bar's render height in px; reserved at the bottom of the
 *      band so the bar doesn't clip below the next sub-row.
 *   - `padding`: top + bottom inset within the band (default 2px).
 *
 * Output: y = top of bar within the band (px from grid top).
 *
 * Invariants:
 *   - Single-pitch leaf (range.min === range.max) → bar centred in band.
 *   - High pitch maps near band TOP, low pitch near band BOTTOM (DAW
 *     convention; high notes float visually).
 *   - Multi-pitch midpoint maps to ~mid of band (linearity test).
 *   - Band too small for any mapping (innerHeight ≤ 0) → returns band.top
 *     (flatline).
 */
export function pitchToY(
  midi: number,
  band: { top: number; height: number },
  range: { min: number; max: number },
  barHeight: number,
  padding = 2,
): number {
  const innerTop = band.top + padding
  const innerHeight = band.height - 2 * padding - barHeight
  if (innerHeight <= 0) return band.top
  if (range.max <= range.min) return innerTop + innerHeight / 2
  const t = (midi - range.min) / (range.max - range.min)
  // Inverted: high pitch at top of band. y measured from top of grid.
  return innerTop + (1 - t) * innerHeight
}
