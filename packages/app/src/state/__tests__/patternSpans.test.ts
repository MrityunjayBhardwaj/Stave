/**
 * #2423 — a pattern's viz span is stored per pattern file; the old global switch
 * is read only as the default for patterns with no setting of their own.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defaultPatternSpan, loadPatternSpans, savePatternSpans } from "../patternSpans";

describe("patternSpans", () => {
  afterEach(() => window.localStorage.clear());

  it("round-trips per project, per pattern file", () => {
    savePatternSpans("p1", new Map([["song", "workspace"], ["other", "file"]]));
    expect(loadPatternSpans("p1")).toEqual(new Map([["song", "workspace"], ["other", "file"]]));
    expect(loadPatternSpans("p2")).toEqual(new Map());
  });

  it("ignores values that are not a span", () => {
    window.localStorage.setItem("stave:patternSpan:p1", JSON.stringify({ a: "workspace", b: "sideways" }));
    expect(loadPatternSpans("p1")).toEqual(new Map([["a", "workspace"]]));
  });

  it("migration: the old global Workspace switch becomes the default for patterns without a setting", () => {
    expect(defaultPatternSpan()).toBe("file");
    window.localStorage.setItem("stave:backdropVizSpan", "workspace");
    expect(defaultPatternSpan()).toBe("workspace");
    window.localStorage.setItem("stave:backdropVizSpan", "file");
    expect(defaultPatternSpan()).toBe("file");
  });
});
