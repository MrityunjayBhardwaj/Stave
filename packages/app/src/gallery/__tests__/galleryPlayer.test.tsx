/**
 * The page inside the preview frame (GalleryPlayer.tsx), as far as it can be
 * read without an audio engine: its status line, and the note for visuals past
 * the limit. Playing for real is gallery-sandbox.spec.ts.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { GalleryPlayer, MAX_PREVIEW_VISUALS, visualsCappedNote } from "../GalleryPlayer";

afterEach(() => cleanup());

const statusLine = () => document.querySelector<HTMLElement>("[data-gallery-player-status]")!;

/**
 * #2580 — embedded in the gallery's preview, the page's own status line is the
 * one shown and announced; the frame's line is hidden (which also takes it out
 * of what a screen reader reads). Opened on its own, the frame shows it.
 */
describe("GalleryPlayer — its status line (#2580)", () => {
  it("embedded: the frame's own line is hidden, so the page's is the only one seen and heard", async () => {
    const parent = Object.getOwnPropertyDescriptor(window, "parent");
    // a stand-in parent window: what `window.parent` is inside the gallery's iframe
    Object.defineProperty(window, "parent", { configurable: true, get: () => ({ postMessage() {} }) });
    try {
      await act(async () => {
        render(<GalleryPlayer />);
      });
      expect(statusLine().hidden).toBe(true);
      expect(statusLine().textContent).toBe("Preview ready.");
    } finally {
      if (parent) Object.defineProperty(window, "parent", parent);
    }
  });

  it("CONTROL: opened on its own, the frame shows its status line", async () => {
    expect(window.parent).toBe(window);
    await act(async () => {
      render(<GalleryPlayer />);
    });
    expect(statusLine().hidden).toBe(false);
    expect(statusLine().textContent).toBe("Preview ready.");
  });
});

/** #2581 — a pattern that calls for more visuals than the preview draws is told so. */
describe("GalleryPlayer — visuals past the limit (#2581)", () => {
  it("the limit is four", () => {
    expect(MAX_PREVIEW_VISUALS).toBe(4);
  });

  it("five visuals: a note naming how many and that the first four are drawn", () => {
    expect(visualsCappedNote(5)).toBe("This pattern calls for 5 visuals; the preview draws the first 4.");
    expect(visualsCappedNote(9)).toBe("This pattern calls for 9 visuals; the preview draws the first 4.");
  });

  it("four or fewer: no note", () => {
    for (const n of [0, 1, 2, 3, 4]) expect(visualsCappedNote(n), String(n)).toBeNull();
  });
});
