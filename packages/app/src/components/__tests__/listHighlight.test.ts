import { describe, expect, it } from "vitest";

import { pointerMoved, shownIndex } from "../listHighlight";

/**
 * #2614 — the rules a keyboard-driven list keeps its highlight by. The browser
 * side (a resting mouse over the command palette) is
 * tests/command-palette-resting-mouse.spec.ts.
 */
describe("shownIndex: the highlight never points past the list", () => {
  it("keeps an index that is on the list", () => {
    expect(shownIndex(0, 6)).toBe(0);
    expect(shownIndex(4, 6)).toBe(4);
  });

  it("a list that shrank under the highlight shows its last row, never a missing one", () => {
    // the palette's case: row 5 of 23 was highlighted, then the list filtered to one row
    expect(shownIndex(5, 1)).toBe(0);
    expect(shownIndex(9, 3)).toBe(2);
  });

  it("an empty list has no highlighted row, and a negative index reads as the top", () => {
    expect(shownIndex(0, 0)).toBe(-1);
    expect(shownIndex(3, 0)).toBe(-1);
    expect(shownIndex(-1, 4)).toBe(0);
  });
});

describe("pointerMoved: only a real move takes the highlight", () => {
  it("the first position a list sees is not a move (it may be a still pointer the list opened under)", () => {
    expect(pointerMoved(null, 640, 330)).toBe(false);
  });

  it("the same position again is not a move (rows redrawn under a still pointer)", () => {
    expect(pointerMoved({ x: 640, y: 330 }, 640, 330)).toBe(false);
  });

  it("a different position is a move", () => {
    expect(pointerMoved({ x: 640, y: 330 }, 641, 330)).toBe(true);
    expect(pointerMoved({ x: 640, y: 330 }, 640, 300)).toBe(true);
  });
});
