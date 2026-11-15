/**
 * #2489 — the piano roll the preview frame draws while a music file plays, and
 * the line under it that says what is playing and where.
 *
 * The roll is Stave's own built-in "pianoroll" visual (the one `.viz("pianoroll")`
 * and the `.pianoroll()` backdrop draw), fed the way the frame feeds a pattern's
 * own visuals: the playing pattern's scheduler, queried each frame for the notes
 * around now. Nothing about it leaves the frame — it reads the frame's own
 * engine and draws into the frame's own canvas — so the page learns nothing new.
 *
 * WHEN IT SHOWS: a pattern's picture is the visuals it asks for. When the frame
 * draws none of them (it asks for none, or none of its names resolve), the roll
 * is its picture. When the frame draws even one, the roll stays out, so it is
 * never stacked over a picture the author chose.
 *
 * THE LINE: "▶ main.strudel · bar 9 of 32" for a song with an end, "▶ main.strudel
 * · bar 9" for a loop. A bar is one cycle, as the gallery's timeline counts them.
 * The "of 32" comes from the song's own arrangement (`songEndOf`, the reading
 * play-once and the bounce stop at); where there is no arrangement, or one the
 * parser can't vouch for, there is no total to give, so none is made up. It
 * doesn't say "Playing": the page's status line says that, and #2580 keeps that
 * to one line.
 */

/**
 * ERRORS THE ROLL MEETS ARE THE CODE'S, AND ARE REPORTED. The roll asks the
 * playing pattern for its notes about 60 times a second, so when the entry's
 * code throws while being queried, the roll's query is where it throws first.
 * Strudel catches that inside `queryArc` and only logs it (`[query] error: …`,
 * `@strudel/core/pattern.mjs` queryArc), and its logger drops the same message
 * again within a second (`@strudel/core/logger.mjs`, the `debounce` check). The
 * engine raises only what is logged during the SCHEDULER's own query
 * (`listenForPlayTimeErrors`), so the scheduler's copy of the error, arriving
 * inside that second, was dropped, and the error went unreported (observed:
 * every logged copy came from the roll's draw). So the frame listens to what is
 * logged during the roll's own queries and reports it as the code's error: the
 * same message the engine would have raised.
 */
export const STRUDEL_LOG_EVENT = "strudel.log";

/**
 * The code's error a Strudel log entry reports, or null. The engine's own rule
 * (`playTimeErrorFrom` in StrudelEngine.ts): `[origin] error: message`, any
 * origin but `eval` (an evaluate's error is reported by the evaluate).
 */
export function codeErrorFromLog(detail: unknown): string | null {
  const message = (detail as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return null;
  const m = message.match(/^\[([^\]]+)\] error: ([\s\S]+)$/);
  if (!m || m[1] === "eval") return null;
  return m[2];
}

/** The built-in visual the roll is. */
export const PREVIEW_ROLL_VIZ = "pianoroll";

/** Does the roll show, given how many of the pattern's own visuals the frame drew? */
export function rollShows(drawnVisuals: number): boolean {
  return drawnVisuals === 0;
}

/** A song's length in bars, or `null` when it has no end anyone can vouch for. */
export function songBarsOf(extent: { kind: string; cycles?: number } | null | undefined): number | null {
  if (!extent || extent.kind !== "arranged") return null;
  const c = extent.cycles;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return Math.ceil(c);
}

/**
 * The bar playing at `cycle`, counted from 1. A song wraps round its length
 * (the preview plays it again from the top, as the engine does); a loop counts on.
 */
export function barAt(cycle: number, bars: number | null): number {
  const c = Number.isFinite(cycle) && cycle > 0 ? Math.floor(cycle) : 0;
  return (bars ? c % bars : c) + 1;
}

/** "▶ main.strudel · bar 9 of 32", or "▶ main.strudel · bar 9" with no known length (the file's path in the entry). */
export function rollLabel(path: string, cycle: number, bars: number | null): string {
  const bar = barAt(cycle, bars);
  return bars ? `▶ ${path} · bar ${bar} of ${bars}` : `▶ ${path} · bar ${bar}`;
}
