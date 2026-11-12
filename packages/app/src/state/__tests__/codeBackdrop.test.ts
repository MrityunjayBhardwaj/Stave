/**
 * #2413 / #2414 — the code's background belongs to the pattern file that
 * declared it and follows that file's code. These pin the rule the editor
 * client applies on every edit and every evaluation.
 */
import { describe, expect, it } from "vitest";
import {
  codeBackdropName,
  fileShownIn,
  isEvaluationOnly,
  openPatternFiles,
  paneCodeBackdrops,
  panesShowing,
  pickSpanningBackdrop,
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
    expect(isEvaluationOnly(played)).toBe(false);
    expect(codeBackdropName(null, played)).toBeNull();
  });

  it("a renamed master line wins over what was played", () => {
    const played = recordEvaluatedBackdrop("Red", null, "Red");
    expect(codeBackdropName("Green", played)).toEqual({ name: "Green", source: "code" });
  });

  // #2394 — the reader sees a track's background too, so it follows the code
  it("reads a track-level declaration like a master one: deleting its call takes it away", () => {
    expect(codeBackdropName("scope", null)).toEqual({ name: "scope", source: "code" });
    const played = recordEvaluatedBackdrop("scope", { fill: 1 }, "scope");
    expect(codeBackdropName("scope", played)).toEqual({ name: "scope", source: "code" });
    expect(codeBackdropName(null, played)).toBeNull();
  });

  it("keeps a background only the last evaluation found — the code reader can't see it", () => {
    const played = recordEvaluatedBackdrop("scope", { fill: 1 }, null);
    expect(isEvaluationOnly(played)).toBe(true);
    expect(codeBackdropName(null, played)).toEqual({ name: "scope", source: "evaluation" });
  });

  it("an evaluation that disagreed with an unchanged code reader stays what played", () => {
    const played = recordEvaluatedBackdrop("scope", null, "Red");
    expect(codeBackdropName("Red", played)).toEqual({ name: "scope", source: "evaluation" });
    // …until what the code declares changes: the user's new choice shows
    expect(codeBackdropName("Green", played)).toEqual({ name: "Green", source: "code" });
    // …and with the declaration deleted, what only the evaluation found still shows
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

describe("openPatternFiles (#2395) — the patterns whose backgrounds may hold options", () => {
  const isPattern = (id: string) => id.startsWith("song") || id === "other";
  it("every pattern open as an editor tab, active or not, in pane order, once", () => {
    const panes = [
      { id: "l", tabs: [{ id: "a", kind: "editor", fileId: "song" }, { id: "b", kind: "editor", fileId: "fold" }], activeTabId: "b" },
      { id: "r", tabs: [{ id: "c", kind: "editor", fileId: "other" }, { id: "d", kind: "editor", fileId: "song" }], activeTabId: "c" },
    ];
    expect(openPatternFiles(panes, isPattern)).toEqual(["song", "other"]);
  });
  it("a closed pattern is not open; a preview or history tab does not count", () => {
    const panes = [
      { id: "l", tabs: [{ id: "p", kind: "preview", fileId: "song2" }, { id: "h", kind: "history" }], activeTabId: "p" },
    ];
    expect(openPatternFiles(panes, isPattern)).toEqual([]);
  });
});

describe("pickSpanningBackdrop (#2423) — a pattern set to Workspace covers every pane", () => {
  const shown = new Map([["a", "fold"], ["b", "scope"], ["c", null as string | null]]);
  const shownOf = (id: string) => shown.get(id) ?? null;

  it("no pattern set to Workspace: nothing spans (File mode)", () => {
    expect(pickSpanningBackdrop(["a", "b"], () => "file", shownOf, new Map())).toBeNull();
  });

  it("the Workspace pattern's own background spans, owned by that pattern", () => {
    const span = (id: string) => (id === "b" ? "workspace" : "file");
    expect(pickSpanningBackdrop(["a", "b"], span, shownOf, new Map())).toEqual({ fileId: "scope", ownerFileId: "b" });
  });

  it("two Workspace patterns: the most recently used wins; unused ones rank by pane order", () => {
    const ws = () => "workspace" as const;
    expect(pickSpanningBackdrop(["a", "b"], ws, shownOf, new Map())).toEqual({ fileId: "fold", ownerFileId: "a" });
    expect(pickSpanningBackdrop(["a", "b"], ws, shownOf, new Map([["b", 2], ["a", 1]]))).toEqual({ fileId: "scope", ownerFileId: "b" });
    expect(pickSpanningBackdrop(["a", "b"], ws, shownOf, new Map([["a", 3], ["b", 2]]))).toEqual({ fileId: "fold", ownerFileId: "a" });
  });

  it("a Workspace pattern with no background does not span", () => {
    expect(pickSpanningBackdrop(["c"], () => "workspace", shownOf, new Map())).toBeNull();
  });
});

describe("sameVizName", () => {
  it("compares the way the backdrop resolves names", () => {
    expect(sameVizName("Piano Roll", "pianoroll")).toBe(true);
    expect(sameVizName("Red", "Green")).toBe(false);
    expect(sameVizName(null, "Red")).toBe(false);
  });
});
