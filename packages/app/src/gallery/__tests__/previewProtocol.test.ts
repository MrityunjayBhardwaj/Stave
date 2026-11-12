/**
 * #2328 — the gallery and its sandboxed preview frame act only on these exact
 * message shapes; anything else (which the code in the frame could post too)
 * is ignored.
 *
 * #2490 — a play carries the entry's files, not one file: every malformed list
 * is refused whole, and the gallery's own message always passes.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PREVIEW_CODE,
  MAX_PREVIEW_FILES,
  MAX_PREVIEW_PATH,
  MAX_PREVIEW_TOTAL,
  parseFromFrame,
  parseToFrame,
  previewKindOf,
  previewPlayFor,
} from "../previewProtocol";

/** A project's play message: its pattern, with its visual beside it. */
const GOOD = {
  play: true,
  path: "main.strudel",
  files: [
    { path: "main.strudel", kind: "strudel", code: 's("bd").viz("bloom")' },
    { path: "viz/bloom.hydra", kind: "hydra", code: "osc(10).out()" },
  ],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (): any => JSON.parse(JSON.stringify(GOOD));
const one = (code: string, path = "a.strudel", kind = "strudel") => ({ play: true, path, files: [{ path, kind, code }] });
const hydras = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.hydra`, kind: "hydra", code: "x" }));

describe("gallery → frame", () => {
  it("accepts play and stop in their exact shapes", () => {
    expect(parseToFrame(GOOD)).toEqual(GOOD);
    // a one-file entry (music, visual) is the same shape with one file
    expect(parseToFrame(one('s("bd")'))).toEqual(one('s("bd")'));
    for (const kind of ["hydra", "p5", "glsl", "three"]) expect(parseToFrame(one("x", "v.x", kind)), kind).not.toBeNull();
    expect(parseToFrame({ stop: true })).toEqual({ stop: true });
  });

  it("accepts the caps exactly: as many files, as long a path, as much code as allowed", () => {
    expect(parseToFrame({ play: true, path: "f0.hydra", files: hydras(MAX_PREVIEW_FILES) })).not.toBeNull();
    const long = "a".repeat(MAX_PREVIEW_PATH - ".strudel".length) + ".strudel";
    expect(long.length).toBe(MAX_PREVIEW_PATH);
    expect(parseToFrame(one("x", long))).not.toBeNull();
    expect(parseToFrame(one("x".repeat(MAX_PREVIEW_CODE)))).not.toBeNull();
    const full = Array.from({ length: MAX_PREVIEW_TOTAL / MAX_PREVIEW_CODE }, (_, i) => ({ path: `f${i}.strudel`, kind: "strudel", code: "x".repeat(MAX_PREVIEW_CODE) }));
    expect(parseToFrame({ play: true, path: "f0.strudel", files: full })).not.toBeNull();
  });

  it("ignores anything else", () => {
    const bad: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["a string", "play"],
      ["a number", 42],
      ["an array", []],
      ["the old one-file shape", { play: true, code: "x", kind: "strudel" }],
      ["old shape plus files", { ...clone(), code: "x", kind: "strudel" }],
      ["extra key on the message", { ...clone(), extra: 1 }],
      ["play not true", { ...clone(), play: "yes" }],
      ["no path", { play: true, files: clone().files }],
      ["no files", { play: true, path: "main.strudel" }],
      ["files not an array", { ...clone(), files: { 0: clone().files[0] } }],
      ["empty files", { ...clone(), files: [] }],
      ["path not among the files", { ...clone(), path: "other.strudel" }],
      ["path a number", { ...clone(), path: 7 }],
      ["file with an extra key", (() => { const m = clone(); m.files[1].extra = 1; return m; })()],
      ["file missing code", (() => { const m = clone(); delete m.files[1].code; return m; })()],
      ["file code not a string", (() => { const m = clone(); m.files[1].code = 7; return m; })()],
      ["file kind unknown", (() => { const m = clone(); m.files[1].kind = "sonicpi"; return m; })()],
      ["file path a number", (() => { const m = clone(); m.files[1].path = 3; return m; })()],
      ["file not a plain object", (() => { const m = clone(); m.files[1] = Object.assign(Object.create({ x: 1 }), m.files[1]); return m; })()],
      ["a file listed twice", (() => { const m = clone(); m.files.push({ ...m.files[1] }); return m; })()],
      ["oversize file", one("x".repeat(MAX_PREVIEW_CODE + 1))],
      ["too many files", { play: true, path: "f0.hydra", files: hydras(MAX_PREVIEW_FILES + 1) }],
      [
        "files together over the total",
        {
          play: true,
          path: "f0.strudel",
          files: [
            ...Array.from({ length: MAX_PREVIEW_TOTAL / MAX_PREVIEW_CODE }, (_, i) => ({ path: `f${i}.strudel`, kind: "strudel", code: "x".repeat(MAX_PREVIEW_CODE) })),
            { path: "last.strudel", kind: "strudel", code: "x" },
          ],
        },
      ],
      ["path too long", one("x", "a".repeat(MAX_PREVIEW_PATH) + ".strudel")],
      ["empty path", one("x", "")],
      ["path climbing out", one("x", "../secret.strudel")],
      ["path with a dot segment", one("x", "a/./b.strudel")],
      ["absolute path", one("x", "/etc/x.strudel")],
      ["empty segment", one("x", "a//b.strudel")],
      ["trailing slash", one("x", "a/")],
      ["backslash", one("x", "a\\b.strudel")],
      ["control character", one("x", "a\nb.strudel")],
      ["stop with extra", { stop: true, code: "x" }],
      ["stop false", { stop: false }],
      ["not a plain object", Object.assign(Object.create({ inherited: 1 }), { stop: true })],
      ["a Date", new Date()],
    ];
    for (const [why, b] of bad) expect(parseToFrame(b), why).toBeNull();
  });
});

describe("previewPlayFor — what the gallery sends (#2490)", () => {
  const manifest = [
    { path: "main.strudel", language: "strudel", content: 's("bd").viz("bloom")' },
    { path: "bass.strudel", language: "strudel", content: 'note("c2")' },
    { path: "viz/bloom.hydra", language: "hydra", content: "osc(10).out()" },
    { path: "README.md", language: "markdown", content: "# hi" },
    { path: "tune.rb", language: "sonicpi", content: "play 60" },
  ];

  it("sends the chosen file first, then the entry's other files the frame can run", () => {
    const msg = previewPlayFor(manifest, "viz/bloom.hydra")!;
    expect(msg.path).toBe("viz/bloom.hydra");
    expect(msg.files.map((f) => [f.path, f.kind])).toEqual([
      ["viz/bloom.hydra", "hydra"],
      ["main.strudel", "strudel"],
      ["bass.strudel", "strudel"],
    ]);
    // and the frame takes it, exactly
    expect(parseToFrame(msg)).toEqual(msg);
  });

  it("a one-file entry sends its one file", () => {
    const msg = previewPlayFor([manifest[0]], "main.strudel")!;
    expect(msg).toEqual({ play: true, path: "main.strudel", files: [{ path: "main.strudel", kind: "strudel", code: manifest[0].content }] });
    expect(parseToFrame(msg)).toEqual(msg);
  });

  it("sends nothing for a file it can't play, or one the manifest doesn't hold", () => {
    expect(previewPlayFor(manifest, "README.md")).toBeNull();
    expect(previewPlayFor(manifest, "nope.strudel")).toBeNull();
    expect(previewPlayFor([{ path: "big.strudel", content: "x".repeat(MAX_PREVIEW_CODE + 1) }], "big.strudel")).toBeNull();
    expect(previewPlayFor([{ path: "../up.strudel", content: "x" }], "../up.strudel")).toBeNull();
  });

  it("stays inside the caps the frame checks: other files past them are left out", () => {
    const many = Array.from({ length: MAX_PREVIEW_FILES + 5 }, (_, i) => ({ path: `v${i}.hydra`, content: "x" }));
    const msg = previewPlayFor(many, `v${MAX_PREVIEW_FILES + 2}.hydra`)!;
    expect(msg.files).toHaveLength(MAX_PREVIEW_FILES);
    expect(msg.files[0].path).toBe(`v${MAX_PREVIEW_FILES + 2}.hydra`);
    expect(parseToFrame(msg)).not.toBeNull();

    const heavy = Array.from({ length: MAX_PREVIEW_TOTAL / MAX_PREVIEW_CODE + 2 }, (_, i) => ({ path: `h${i}.strudel`, content: "x".repeat(MAX_PREVIEW_CODE) }));
    const last = `h${heavy.length - 1}.strudel`;
    const fits = previewPlayFor(heavy, last)!;
    expect(fits.files.reduce((n, f) => n + f.code.length, 0)).toBeLessThanOrEqual(MAX_PREVIEW_TOTAL);
    expect(fits.files[0].path).toBe(last);
    expect(fits.files.length).toBe(MAX_PREVIEW_TOTAL / MAX_PREVIEW_CODE);
    expect(parseToFrame(fits)).not.toBeNull();
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
