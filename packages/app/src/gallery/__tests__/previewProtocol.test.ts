/**
 * #2328 — the gallery and its sandboxed preview frame act only on these exact
 * message shapes; anything else (which the code in the frame could post too)
 * is ignored.
 */
import { describe, it, expect } from "vitest";
import { MAX_PREVIEW_CODE, parseFromFrame, parseToFrame, previewKindOf } from "../previewProtocol";

describe("gallery → frame", () => {
  it("accepts play and stop in their exact shapes", () => {
    expect(parseToFrame({ play: true, code: 's("bd")', kind: "strudel" })).toEqual({ play: true, code: 's("bd")', kind: "strudel" });
    for (const kind of ["hydra", "p5", "glsl"]) expect(parseToFrame({ play: true, code: "x", kind })).not.toBeNull();
    expect(parseToFrame({ stop: true })).toEqual({ stop: true });
  });

  it("ignores anything else", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "play",
      42,
      [],
      { play: true, code: "x" }, // no kind
      { play: true, code: "x", kind: "sonicpi" }, // a kind with no preview
      { play: "yes", code: "x", kind: "strudel" },
      { play: true, code: 7, kind: "strudel" },
      { play: true, code: "x", kind: "strudel", extra: 1 }, // extra key
      { stop: false },
      { stop: true, code: "x" },
      { play: true, code: "x".repeat(MAX_PREVIEW_CODE + 1), kind: "strudel" }, // oversized
      Object.assign(Object.create({ inherited: 1 }), { stop: true }), // not a plain object
      new Date(),
    ];
    for (const b of bad) expect(parseToFrame(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
  });
});

describe("frame → gallery", () => {
  it("accepts a state, with or without a message", () => {
    expect(parseFromFrame({ state: "ready" })).toEqual({ state: "ready" });
    expect(parseFromFrame({ state: "playing" })).toEqual({ state: "playing" });
    expect(parseFromFrame({ state: "stopped" })).toEqual({ state: "stopped" });
    expect(parseFromFrame({ state: "error", message: "boom" })).toEqual({ state: "error", message: "boom" });
  });

  it("cuts a long message short", () => {
    expect(parseFromFrame({ state: "error", message: "x".repeat(5000) })!.message!.length).toBe(500);
  });

  it("ignores anything else — e.g. what the entry's own code might post", () => {
    const bad: unknown[] = [
      null,
      "playing",
      { state: "hacked" },
      { state: "playing", message: 3 },
      { state: "playing", openUrl: "https://evil.example" },
      { state: "error", message: "x", html: "<b>" },
      { hostileProbe: { cookie: "" } },
      [],
    ];
    for (const b of bad) expect(parseFromFrame(b), JSON.stringify(b)).toBeNull();
  });
});

describe("previewKindOf", () => {
  it("names the preview by file extension, as the editor does", () => {
    expect(previewKindOf({ path: "a/b.strudel" })).toBe("strudel");
    expect(previewKindOf({ path: "bloom.hydra" })).toBe("hydra");
    expect(previewKindOf({ path: "x.hy" })).toBe("hydra");
    expect(previewKindOf({ path: "x.p5" })).toBe("p5");
    expect(previewKindOf({ path: "x.js" })).toBe("p5");
    expect(previewKindOf({ path: "x.frag" })).toBe("glsl");
  });

  it("falls back to the stored language, and has none for Sonic Pi or Markdown", () => {
    expect(previewKindOf({ path: "noext", language: "p5js" })).toBe("p5");
    expect(previewKindOf({ path: "x.rb", language: "sonicpi" })).toBeNull();
    expect(previewKindOf({ path: "README.md", language: "markdown" })).toBeNull();
  });
});
