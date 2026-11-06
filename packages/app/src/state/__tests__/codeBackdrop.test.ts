/**
 * #2413 / #2414 — the code's background belongs to the pattern file that
 * declared it and follows that file's code. These pin the rule the editor
 * client applies on every edit and every evaluation.
 */
import { describe, expect, it } from "vitest";
import {
  codeBackdropName,
  fileShownIn,
  isTrackLevel,
  paneCodeBackdrops,
  panesShowing,
  recordEvaluatedBackdrop,
  sameVizName,
  shownTabBackdrop,
} from "../codeBackdrop";

describe("codeBackdropName — what a pattern file's code asks for now", () => {
  it("reads the master line, played or not", () => {
    expect(codeBackdropName("Red", null)).toEqual({ name: "Red", source: "code" });
    const played = recordEvaluatedBackdrop("Red", null, "Red");
    expect(codeBackdropName("Red", played)).toEqual({ name: "Red", source: "code" });
  });

  it("deleting the master line after a Play takes the background away (no re-run)", () => {
    // the bug: the evaluated request outlived the line that declared it
    const played = recordEvaluatedBackdrop("Red", null, "Red");
    expect(codeBackdropName(null, played)).toBeNull();
  });

  it("deleting the line also clears when the evaluation spelled the name differently", () => {
    const played = recordEvaluatedBackdrop("red", null, "Red");
    expect(isTrackLevel(played)).toBe(false);
    expect(codeBackdropName(null, played)).toBeNull();
  });

  it("a renamed master line wins over what was played", () => {
    const played = recordEvaluatedBackdrop("Red", null, "Red");
    expect(codeBackdropName("Green", played)).toEqual({ name: "Green", source: "code" });
  });

  it("keeps a track-level background from the last evaluation — the code reader can't see it", () => {
    const played = recordEvaluatedBackdrop("scope", { fill: 1 }, null);
    expect(isTrackLevel(played)).toBe(true);
    expect(codeBackdropName(null, played)).toEqual({ name: "scope", source: "evaluation" });
  });

  it("a track-level background that won over an unchanged master line stays what played", () => {
    const played = recordEvaluatedBackdrop("scope", null, "Red");
    expect(codeBackdropName("Red", played)).toEqual({ name: "scope", source: "evaluation" });
    // …until the master line changes: the user's new choice shows
    expect(codeBackdropName("Green", played)).toEqual({ name: "Green", source: "code" });
    // …and with the master line deleted the track's still shows
    expect(codeBackdropName(null, played)).toEqual({ name: "scope", source: "evaluation" });
  });

  it("nothing declared, nothing played → no code background", () => {
    expect(codeBackdropName(null, null)).toBeNull();
    expect(recordEvaluatedBackdrop(null, null, null)).toBeNull();
  });
});

describe("shownTabBackdrop — what a tab's \"set bg\" button names (#2414)", () => {
  it("names the code's background when nothing is pinned", () => {
    expect(shownTabBackdrop(undefined, "red-file")).toBe("red-file");
  });
  it("the code's background wins over the pinned one, as on screen", () => {
    expect(shownTabBackdrop("green-file", "red-file")).toBe("red-file");
  });
  it("falls back to the pinned one, then none", () => {
    expect(shownTabBackdrop("green-file", undefined)).toBe("green-file");
    expect(shownTabBackdrop(undefined, undefined)).toBeNull();
    expect(shownTabBackdrop(null, null)).toBeNull();
  });
});

describe("panes in File mode (#2421) — a pattern's background stays in its own pane", () => {
  const pane = (id: string, fileId: string | null, kind = "editor") => ({
    id,
    tabs: fileId ? [{ id: `t-${id}`, kind, fileId }] : [],
    activeTabId: fileId ? `t-${id}` : null,
  });
  const code = new Map([["song", "red-file"]]);

  it("a viz pane beside the pattern gets no code background, whichever pane has focus", () => {
    const out = paneCodeBackdrops([pane("left", "song"), pane("right", "green")], code);
    expect(out.get("left")).toBe("red-file");
    expect(out.get("right")).toBeNull();
  });

  it("the same with the panes swapped, and an empty pane gets none", () => {
    const out = paneCodeBackdrops([pane("left", "green"), pane("right", "song"), pane("empty", null)], code);
    expect(out.get("left")).toBeNull();
    expect(out.get("right")).toBe("red-file");
    expect(out.get("empty")).toBeNull();
  });

  it("the pattern open in two panes shows in both", () => {
    expect(panesShowing([pane("a", "song"), pane("b", "green"), pane("c", "song")], "song")).toEqual(["a", "c"]);
  });

  it("fileShownIn reads the pane's ACTIVE tab, editor or preview, not another of its tabs", () => {
    expect(fileShownIn(pane("p", "green", "preview"))).toBe("green");
    expect(fileShownIn({ id: "x", tabs: [{ id: "a", kind: "editor", fileId: "song" }, { id: "b", kind: "editor", fileId: "green" }], activeTabId: "b" })).toBe("green");
    expect(fileShownIn({ id: "x", tabs: [{ id: "h", kind: "history" }], activeTabId: "h" })).toBeNull();
    expect(fileShownIn(undefined)).toBeNull();
  });
});

describe("sameVizName", () => {
  it("compares the way the backdrop resolves names", () => {
    expect(sameVizName("Piano Roll", "pianoroll")).toBe(true);
    expect(sameVizName("Red", "Green")).toBe(false);
    expect(sameVizName(null, "Red")).toBe(false);
  });
});
