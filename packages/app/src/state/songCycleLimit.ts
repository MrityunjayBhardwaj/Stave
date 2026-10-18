"use client";

/**
 * How many cycles the Song timeline looks through for a repeat (#2109).
 *
 * The song analysis grows its horizon until it finds the song's loop or reaches a
 * limit (`AnalyzeSongOptions.capCycles`); a song that has not repeated by then is
 * drawn that many cycles wide and marked "N+ cycles". The analysis defaults that
 * limit to 256, which draws most such songs as a sliver at the left of the view, so
 * the app passes this setting instead — 64 unless the user picks otherwise.
 *
 * Every caller that runs the analysis for the user reads it here (the timeline, the
 * song-length dialog, the shape-swap preview), so the three answer over the same
 * horizon. A declared end (`arrange(...)`) is not limited by it.
 *
 * Kept in localStorage, like `takesPhoneAudio`.
 */

const STORAGE_KEY = "stave:songCycleLimit";
export const SONG_CYCLE_LIMIT_DEFAULT = 64;
export const SONG_CYCLE_LIMIT_MIN = 16;
export const SONG_CYCLE_LIMIT_MAX = 256;
export const SONG_CYCLE_LIMIT_STEP = 16;

function clamp(n: number): number {
  const stepped = Math.round(n / SONG_CYCLE_LIMIT_STEP) * SONG_CYCLE_LIMIT_STEP;
  return Math.max(SONG_CYCLE_LIMIT_MIN, Math.min(SONG_CYCLE_LIMIT_MAX, stepped));
}

function read(): number {
  try {
    if (typeof window === "undefined") return SONG_CYCLE_LIMIT_DEFAULT;
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    if (saved === null || saved === undefined) return SONG_CYCLE_LIMIT_DEFAULT;
    const n = Number(saved);
    return Number.isFinite(n) ? clamp(n) : SONG_CYCLE_LIMIT_DEFAULT;
  } catch {
    return SONG_CYCLE_LIMIT_DEFAULT;
  }
}

function write(next: number): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, String(next));
  } catch {
    /* storage unavailable — in-session value still updates */
  }
}

let current = read();
const listeners = new Set<(cycles: number) => void>();

export function getSongCycleLimit(): number {
  return current;
}

export function setSongCycleLimit(next: number): void {
  const clamped = clamp(next);
  if (clamped === current) return;
  current = clamped;
  write(clamped);
  for (const cb of Array.from(listeners)) cb(clamped);
}

/** Called after every change. Returns the unsubscribe. */
export function subscribeSongCycleLimit(cb: (cycles: number) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
