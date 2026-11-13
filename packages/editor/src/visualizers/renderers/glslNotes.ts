/**
 * glslNotes — pack the upcoming notes into the float texture a GLSL shader reads
 * as `uNotes` / `staveNote(i)` (#2571).
 *
 * A shader has no per-frame JavaScript, so it can't call `stave.scheduler.query()`
 * the way p5, hydra and three.js sketches do. Instead the host packs the same
 * window of notes (now−4 … now+2 cycles) into an RGBA32F texture,
 * `STAVE_MAX_NOTES` wide and 2 tall:
 *
 *   row 0: (begin, end, midi, gain)
 *   row 1: (velocity, track, 0, 0)
 *
 * Times are absolute cycles (compare with `uNow`). `midi` is −1 for a note with
 * no pitch (a drum sample). `track` is the index `staveTrack(i)` uses — the
 * position of the note's track key in the bus's track list — or −1 when the note
 * belongs to no track.
 *
 * Over the cap, the notes nearest to now are kept (distance from now to the
 * note's span; 0 while it sounds), then sorted by begin.
 *
 * Pure (no GL) so it's unit-testable; `glslCore` uploads `data` only when
 * `version` moves.
 *
 * REF: glslShaderSource.ts (the `StaveNote` struct that reads this layout),
 *      glslCore.ts (the upload), rollingHapWindow.ts (the window's version).
 */

import { STAVE_MAX_NOTES } from './glslShaderSource'

/** How many notes the texture holds (its width) — the preamble's `#define`. */
export { STAVE_MAX_NOTES }

/** Floats per texel (RGBA). */
const RGBA = 4

/** The fields a note needs; both the worker's `RawHapSummary` and the main
 *  thread's `IREvent` have them. */
export interface NoteLike {
  begin: number
  end: number
  midi?: number | null
  gain?: number | null
  velocity?: number | null
  /** The track's SCHEDULER key (`$0`, `d1`, …), from the hap's track tag. */
  trackKey?: string | null
}

/** Distance (cycles) from `now` to the note's span; 0 while it sounds. */
function distanceToNow(n: NoteLike, now: number): number {
  if (n.begin > now) return n.begin - now
  if (n.end < now) return now - n.end
  return 0
}

/**
 * The index `staveTrack(i)` uses for `key`: its position in `trackKeys`. A note
 * with no track tag belongs to the one track of a bare document (no `.p`, so
 * nothing is tagged and the whole pattern is its single track); otherwise −1.
 */
export function noteTrackIndex(key: string | null | undefined, trackKeys: readonly string[]): number {
  if (key == null) return trackKeys.length === 1 ? 0 : -1
  return trackKeys.indexOf(key)
}

/**
 * Pick at most `STAVE_MAX_NOTES` of `events` (the nearest to `now` when over the
 * cap), sorted by begin. Returns the kept notes and how many were dropped.
 */
export function selectNotes<T extends NoteLike>(
  events: readonly T[],
  now: number,
): { notes: T[]; dropped: number } {
  let notes: T[]
  if (events.length > STAVE_MAX_NOTES) {
    notes = [...events]
      .sort((a, b) => distanceToNow(a, now) - distanceToNow(b, now) || a.begin - b.begin)
      .slice(0, STAVE_MAX_NOTES)
  } else {
    notes = [...events]
  }
  notes.sort((a, b) => a.begin - b.begin)
  return { notes, dropped: events.length - notes.length }
}

/** Write `notes` (already selected, ≤ cap) into `out` (length cap × 2 × 4). Slots
 *  past the count are zeroed. */
export function writeNoteTexels(
  notes: readonly NoteLike[],
  trackKeys: readonly string[],
  out: Float32Array,
): void {
  out.fill(0)
  const row1 = STAVE_MAX_NOTES * RGBA
  const n = Math.min(notes.length, STAVE_MAX_NOTES)
  for (let i = 0; i < n; i++) {
    const e = notes[i]
    const o = i * RGBA
    out[o] = e.begin
    out[o + 1] = e.end
    out[o + 2] = typeof e.midi === 'number' && Number.isFinite(e.midi) ? e.midi : -1
    out[o + 3] = e.gain ?? 1
    out[row1 + o] = e.velocity ?? 1
    out[row1 + o + 1] = noteTrackIndex(e.trackKey, trackKeys)
  }
}

/**
 * The note texture's CPU side for one sketch: repacks only when the window's
 * notes (its `version`) or the track list changed, and keeps its own `version`
 * so the GL side re-uploads only then.
 */
export class GLSLNoteFeed {
  /** RGBA32F texels, row 0 then row 1. */
  readonly data = new Float32Array(STAVE_MAX_NOTES * 2 * RGBA)
  /** Notes in `data` (`uNoteCount`). */
  count = 0
  /** Notes the last pack dropped over the cap. */
  dropped = 0
  /** Bumps on every repack; the GL side uploads when it differs from its own. */
  version = 0
  /** Scheduler now (`uNow`) and cycles per second (`uCps`), set every frame. */
  now = 0
  cps = 0
  private windowVersion: number | null = null
  private trackSig = ''
  private warned = false

  /**
   * Feed one frame. `windowVersion` is the window's own change counter
   * (`RollingHapWindow.version`); when it and the track list are unchanged the
   * texels are left alone. Absent → always repack. Returns true when the texels
   * were rewritten. `onDrop` runs once per feed, the first time notes are
   * dropped over the cap.
   */
  update(
    events: readonly NoteLike[],
    windowVersion: number | undefined,
    now: number,
    cps: number,
    trackKeys: readonly string[],
    onDrop?: (dropped: number, total: number) => void,
  ): boolean {
    this.now = now
    this.cps = cps
    const sig = trackKeys.join('\u0000')
    if (
      windowVersion !== undefined &&
      windowVersion === this.windowVersion &&
      sig === this.trackSig
    ) {
      return false
    }
    this.windowVersion = windowVersion ?? null
    this.trackSig = sig
    const { notes, dropped } = selectNotes(events, now)
    writeNoteTexels(notes, trackKeys, this.data)
    this.count = notes.length
    this.dropped = dropped
    this.version++
    if (dropped > 0 && !this.warned) {
      this.warned = true
      onDrop?.(dropped, events.length)
    }
    return true
  }
}

/** The one-time warning when the window holds more notes than the texture. */
export function droppedNotesMessage(dropped: number, total: number): string {
  return (
    `GLSL: ${total} notes in the window (now−4 … now+2 cycles), but uNotes holds ${STAVE_MAX_NOTES}. ` +
    `Kept the ${STAVE_MAX_NOTES} nearest to now and dropped ${dropped}; uNoteCount says how many came through.`
  )
}
