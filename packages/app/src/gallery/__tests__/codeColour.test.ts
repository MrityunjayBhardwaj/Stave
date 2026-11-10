/**
 * #2491 — the code viewer's colouring: it gives the code back exactly, and puts
 * each piece in the right colour.
 */
import { describe, it, expect } from "vitest";
import { codeLanguageOf, colourLines, type Token } from "../codeColour";
import { contentsSummary, fileRole, publishedAgo } from "../galleryModel";

const joined = (lines: Token[][]) => lines.map((l) => l.map((t) => t.text).join("")).join("\n");
const kinds = (lines: Token[][], kind: Token["kind"]) => lines.flat().filter((t) => t.kind === kind).map((t) => t.text);

const STRUDEL = `// 122 bpm, four bars of chords under a steady kick
setcps(122/60/4)

stack(
  s("bd*4, ~ hh ~ hh, ~ ~ cp ~").bank("RolandTR909"),
  note("<[c3,eb3,g3] [ab2,c3,eb3]>/2")
    .s("sawtooth").lpf(600).room(0.8).delay(0.5)
).viz("bloom")`;

describe("colourLines", () => {
  it("gives every character back, line for line", () => {
    for (const code of [STRUDEL, "", "\n\n", "a /* open", "'unclosed\nnext", "`a\nb` + 1", "x = 0x1f + 1e-3 + .5"]) {
      const lines = colourLines(code);
      expect(joined(lines)).toBe(code);
      expect(lines).toHaveLength(code.split("\n").length);
    }
  });

  it("colours the mockup's pattern as the mockup does", () => {
    const lines = colourLines(STRUDEL);
    expect(kinds(lines, "comment")).toEqual(["// 122 bpm, four bars of chords under a steady kick"]);
    expect(kinds(lines, "keyword")).toEqual(["stack"]);
    expect(kinds(lines, "function")).toEqual(["setcps", "s", "bank", "note", "s", "lpf", "room", "delay", "viz"]);
    expect(kinds(lines, "number")).toEqual(["122", "60", "4", "600", "0.8", "0.5"]);
    expect(kinds(lines, "string")).toContain('"<[c3,eb3,g3] [ab2,c3,eb3]>/2"');
  });

  it("a block comment or a template string over several lines is coloured on each line", () => {
    const lines = colourLines("a /* one\ntwo */ b\n`x\ny`");
    expect(lines[0].at(-1)).toEqual({ kind: "comment", text: "/* one" });
    expect(lines[1][0]).toEqual({ kind: "comment", text: "two */" });
    expect(lines[2]).toEqual([{ kind: "string", text: "`x" }]);
    expect(lines[3]).toEqual([{ kind: "string", text: "y`" }]);
  });

  it("an escaped quote doesn't end a string; an unclosed one stops at the line's end", () => {
    expect(kinds(colourLines('"a\\"b" + c'), "string")).toEqual(['"a\\"b"']);
    const lines = colourLines("'open\nnote(1)");
    expect(lines[0]).toEqual([{ kind: "string", text: "'open" }]);
    expect(kinds([lines[1]], "function")).toEqual(["note"]);
  });

  it("digits inside a name are part of the name", () => {
    expect(kinds(colourLines("vec3 x1 = s2(3)", "glsl"), "number")).toEqual(["3"]);
    expect(kinds(colourLines("vec3 x1 = s2(3)", "glsl"), "keyword")).toEqual(["vec3"]);
  });

  it("markup in the code stays text", () => {
    const code = '"<img src=x onerror=alert(1)>" // <script>';
    expect(joined(colourLines(code))).toBe(code);
  });

  it("GLSL by extension, JavaScript otherwise", () => {
    expect(codeLanguageOf("a/b.frag")).toBe("glsl");
    expect(codeLanguageOf("x.glsl")).toBe("glsl");
    expect(codeLanguageOf("x.strudel")).toBe("js");
    expect(codeLanguageOf("x.hydra")).toBe("js");
  });
});

describe("what an entry holds", () => {
  it("names each file a pattern, a visual or a file", () => {
    expect(["main.strudel", "viz/bloom.hydra", "grain.p5", "s.glsl", "README.md"].map(fileRole)).toEqual([
      "pattern",
      "visual",
      "visual",
      "visual",
      "file",
    ]);
  });
  it("counts them, singular and plural", () => {
    const files = ["a.strudel", "b.strudel", "c.strudel", "v.hydra", "w.p5"].map((path) => ({ path }));
    expect(contentsSummary(files)).toBe("3 patterns · 2 visuals");
    expect(contentsSummary([{ path: "a.strudel" }, { path: "n.md" }], ", ")).toBe("1 pattern, 1 other file");
    expect(contentsSummary([])).toBe("");
  });
  it("says how long ago, then the date past a year", () => {
    const now = Date.UTC(2026, 10, 9);
    expect(publishedAgo(now - 2 * 86400_000, now)).toMatch(/2 days ago/);
    expect(publishedAgo(now - 400 * 86400_000, now)).toMatch(/2025/);
  });
});
