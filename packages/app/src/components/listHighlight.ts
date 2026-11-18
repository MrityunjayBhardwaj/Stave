import { useCallback, useRef } from "react";

/**
 * #2614 — how a keyboard-driven list (command palette, docs search, workspace
 * search) keeps its highlighted row, so Enter always runs a row the reader sees
 * highlighted.
 *
 * 1. The highlight follows the mouse only when the mouse MOVES. Browsers report
 *    the row under a still pointer as hovered whenever rows are drawn or slide
 *    beneath it: opening a palette under the pointer, or filtering as you type.
 *    Treating that as a choice made Enter run the row under a resting mouse
 *    ("Help: Search Documentation") instead of the top match ("Publish…").
 * 2. The highlighted index is always read through `shownIndex`, so a list that
 *    shrank never leaves the highlight (and Enter) pointing past its end.
 */

type Point = { x: number; y: number };

/**
 * Whether a pointer at (x, y) has moved since `last`. The first position a list
 * ever sees is not a move: it may be a still pointer the list was drawn under.
 */
export function pointerMoved(last: Point | null, x: number, y: number): boolean {
  return last !== null && (last.x !== x || last.y !== y);
}

/**
 * A handler for a row's `onMouseMove`: true when the pointer really moved (and
 * the row under it should be highlighted), false for a still pointer the rows
 * were redrawn under.
 */
export function usePointerMoved(): (e: { screenX: number; screenY: number }) => boolean {
  const last = useRef<Point | null>(null);
  return useCallback((e) => {
    const moved = pointerMoved(last.current, e.screenX, e.screenY);
    last.current = { x: e.screenX, y: e.screenY };
    return moved;
  }, []);
}

/** The highlighted row of a list of `count` rows, or -1 when there are none. */
export function shownIndex(active: number, count: number): number {
  if (count <= 0) return -1;
  return Math.min(Math.max(active, 0), count - 1);
}
