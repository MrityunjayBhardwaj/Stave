/**
 * Pure health-meter classification for the Transport LCD (#859).
 *
 * Kept in its own module — with NO `@stave/editor` import — so the logic is
 * unit-testable without the editor barrel, which an app test could not load
 * until #1938. TransportLCD imports these; the profiler read stays in the component.
 */

export type HealthClass = "good" | "warn" | "crit";

/**
 * Map a health sample to a meter class.
 * `fps` is the worst live viz cadence (profiler on) or the rAF cadence (off);
 * `slow` = the profiler saw a uniformly-slow viz; `stallMs` = the worst recent
 * main-thread longtask (0 if none in the window). A recent stall pulls the
 * meter down even when `fps` looks fine — the whole point of the layered signal.
 */
export function healthClass(fps: number, slow: boolean, stallMs: number): HealthClass {
  if (fps < 30 || slow || stallMs >= 120) return "crit";
  if (fps < 55 || stallMs > 0) return "warn";
  return "good";
}

/** Lit-bar count (of 5) for a health class — warn/crit visibly drop bars even
 *  when the smoothed fps number lags. */
export function healthBars(cls: HealthClass, fps: number): number {
  if (cls === "crit") return 1;
  if (cls === "warn") return 3;
  return Math.round((Math.min(fps, 60) / 60) * 5);
}

/** One reading of the engine's running counts (#1348). */
export interface AudioHealthSample {
  /** `performance.now()` when read. */
  at: number;
  lateNotes: number;
  /** Null where the browser does not report underruns. */
  underruns: number | null;
}

/** How far back the audio cell looks, in ms. */
export const AUDIO_HEALTH_WINDOW_MS = 5000;

export type AudioHealthClass = "ok" | "late" | "glitch";

/**
 * What the audio cell shows for the last few seconds (#1348).
 *
 * The engine's counts only ever grow, so trouble in the window is the latest
 * reading minus the one from about a window ago. A GLITCH (the audio thread
 * missed a deadline) outranks LATE notes (the main thread handed notes over too
 * late and they were dropped): both are heard, but a glitch is a click across
 * everything playing. A count that went DOWN means the engine was replaced (a
 * new file, a restart), so the history starts again from there rather than
 * reading a negative.
 *
 * `history` is updated in place: readings older than the window are dropped,
 * keeping the newest of them as the baseline.
 */
export function audioHealthReading(
  history: AudioHealthSample[],
  sample: AudioHealthSample,
): { cls: AudioHealthClass; late: number; glitches: number } {
  const prev = history[history.length - 1];
  if (
    prev &&
    (sample.lateNotes < prev.lateNotes ||
      (sample.underruns !== null && prev.underruns !== null && sample.underruns < prev.underruns))
  ) {
    history.length = 0;
  }
  history.push(sample);
  while (history.length > 1 && history[1].at <= sample.at - AUDIO_HEALTH_WINDOW_MS) history.shift();
  const base = history[0];
  const late = sample.lateNotes - base.lateNotes;
  const glitches =
    sample.underruns !== null && base.underruns !== null ? sample.underruns - base.underruns : 0;
  const cls: AudioHealthClass = glitches > 0 ? "glitch" : late > 0 ? "late" : "ok";
  return { cls, late, glitches };
}
