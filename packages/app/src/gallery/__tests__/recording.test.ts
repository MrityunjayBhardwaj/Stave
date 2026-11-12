/**
 * #2487 — the record of what an entry plays: one reader for the route and the
 * cards, which refuses anything of the wrong shape rather than trimming it.
 */
import { describe, expect, it } from "vitest";
import {
  RECORDING_LIMITS,
  contentsLine,
  coverPattern,
  encodeRecording,
  mayHavePreview,
  readRecording,
  type GalleryRecording,
} from "../recording";
import { drawnCycles, lengthLabel } from "../GalleryTimeline";
import { fileRole } from "../galleryModel";
import { previewKindOf } from "../previewProtocol";

const REC: GalleryRecording = {
  v: 1,
  cover: "main.strudel",
  contents: { patterns: 2, visuals: 1, other: 0 },
  files: [
    {
      path: "main.strudel",
      span: "arranged",
      cycles: 16,
      lanes: [{ name: "bd" }, { name: "hh" }],
      events: [
        [0, 0, 0.25, null],
        [1, 0.5, 0.125, 64],
      ],
      sections: [
        [0, 4, "intro"],
        [4, 16, "drop"],
      ],
    },
    { path: "bass.strudel", span: "loop", cycles: 2, lanes: [{ name: "sawtooth" }], events: [[0, 0, 1, 36]], sections: [] },
  ],
};

const withFile = (over: Record<string, unknown>) => ({ ...REC, files: [{ ...REC.files[0], ...over }] });

describe("readRecording", () => {
  it("reads a good record back unchanged", () => {
    expect(readRecording(JSON.parse(JSON.stringify(REC)))).toEqual(REC);
  });

  it.each([
    ["not an object", "x"],
    ["another version", { ...REC, v: 2 }],
    ["a cover that isn't text", { ...REC, cover: 5 }],
    ["counts that aren't counts", { ...REC, contents: { patterns: -1, visuals: 0, other: 0 } }],
    ["a span it doesn't know", withFile({ span: "forever" })],
    ["no cycles", withFile({ cycles: 0 })],
    ["too many cycles", withFile({ cycles: RECORDING_LIMITS.cycles + 1 })],
    ["a lane with no name", withFile({ lanes: [{ name: "  " }] })],
    ["an event with three parts", withFile({ events: [[0, 0, 1]] })],
    ["an event on a missing lane", withFile({ events: [[2, 0, 1, null]] })],
    ["an event starting past the end", withFile({ events: [[0, 17, 1, null]] })],
    ["a negative length", withFile({ events: [[0, 0, -1, null]] })],
    ["a pitch past 127", withFile({ events: [[0, 0, 1, 128]] })],
    ["a section running backwards", withFile({ sections: [[4, 4, "x"]] })],
    ["a section past the end", withFile({ sections: [[0, 17, "x"]] })],
    ["too many files", { ...REC, files: Array.from({ length: RECORDING_LIMITS.files + 1 }, () => REC.files[1]) }],
    ["too many lanes", withFile({ lanes: Array.from({ length: RECORDING_LIMITS.lanesPerFile + 1 }, () => ({ name: "x" })) })],
  ])("refuses %s", (_why, raw) => {
    expect(readRecording(raw)).toBeNull();
  });

  it("keeps only the fields it knows, strips control characters from names, caps their length", () => {
    const raw = {
      ...REC,
      extra: 1,
      files: [{ ...REC.files[0], secret: 2, lanes: [{ name: "b\u0000d", x: 1 }, { name: "h".repeat(100) }] }],
    };
    const rec = readRecording(raw)!;
    expect(JSON.stringify(rec)).not.toMatch(/extra|secret|"x"/);
    expect(rec.files[0].lanes[0].name).toBe("bd");
    expect(rec.files[0].lanes[1].name).toHaveLength(RECORDING_LIMITS.nameLength);
  });

  it("an over-size record isn't encoded", () => {
    expect(encodeRecording(REC)!.byteLength).toBeGreaterThan(0);
    const big = { ...REC, files: [withFile({ lanes: [{ name: "x".repeat(40) }], events: [] }).files[0]] };
    expect(encodeRecording(big)).not.toBeNull();
    const huge = { ...REC, files: Array.from({ length: 12 }, (_, i) => ({ ...REC.files[0], path: `f${i}.strudel`, events: Array.from({ length: 4000 }, () => [0, 1.234, 0.125, 60] as [number, number, number, number]) })) };
    expect(encodeRecording(huge as GalleryRecording)).toBeNull();
  });
});

describe("what a card reads from it", () => {
  it("the cover pattern, and the contents line", () => {
    expect(coverPattern(REC)?.path).toBe("main.strudel");
    expect(coverPattern({ ...REC, cover: "viz.hydra" })).toBeNull();
    expect(coverPattern(null)).toBeNull();
    expect(contentsLine(REC)).toBe("2 patterns · 1 visual");
    expect(contentsLine(null)).toBeNull();
  });

  it("a song is drawn once; a short loop repeats to fill four bars", () => {
    expect(drawnCycles(REC.files[0])).toEqual({ cycles: 16, repeats: 1 });
    expect(drawnCycles(REC.files[1])).toEqual({ cycles: 4, repeats: 2 });
    expect(drawnCycles({ span: "loop", cycles: 8 })).toEqual({ cycles: 8, repeats: 1 });
  });

  it("names a length the way the entry page shows it", () => {
    expect(lengthLabel(REC.files[0])).toBe("16 bars");
    expect(lengthLabel(REC.files[1])).toBe("2-bar loop");
    expect(lengthLabel({ span: "arranged", cycles: 1 })).toBe("1 bar");
  });
});

describe("mayHavePreview (#2548)", () => {
  const withContents = (patterns: number, visuals: number, other: number): GalleryRecording => ({ ...REC, contents: { patterns, visuals, other } });

  it("no pattern and no visual: nothing to preview", () => {
    expect(mayHavePreview(withContents(0, 0, 3))).toBe(false);
    expect(mayHavePreview(withContents(0, 0, 0))).toBe(false);
  });

  it("a pattern, or a visual, is something to preview", () => {
    expect(mayHavePreview(withContents(1, 0, 0))).toBe(true);
    expect(mayHavePreview(withContents(0, 1, 5))).toBe(true);
  });

  it("no record: the card can't tell, so yes", () => {
    expect(mayHavePreview(null)).toBe(true);
  });

  // The record counts by fileRole; the preview plays by previewKindOf. The card's
  // rule is only as true as these two agree on what a file's name says it is.
  it("fileRole counts a file as a pattern or a visual exactly when previewKindOf plays it by its name", () => {
    const exts = ["strudel", "hydra", "hy", "p5", "p5js", "js", "glsl", "frag", "shader", "three", "rb", "sonicpi", "md", "txt", "json", "ts", "wav", "STRUDEL", "Hydra"];
    for (const ext of exts) {
      const path = `dir/file.${ext}`;
      expect(fileRole(path) !== "file", path).toBe(previewKindOf({ path }) !== null);
      expect(fileRole(path) === "pattern", path).toBe(previewKindOf({ path }) === "strudel");
    }
  });
});

