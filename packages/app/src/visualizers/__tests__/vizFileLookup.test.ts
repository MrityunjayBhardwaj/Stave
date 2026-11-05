/**
 * vizFileLookup — the file ✎ opens, ✂ crops and the ref watcher recompiles
 * must be the file the renderer draws (#2322).
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceFile, WorkspaceLanguage } from "@stave/editor";
import {
  findVizFileByName,
  findVizFileByPresetId,
  p5VizBasenames,
  presetIdForVizFile,
  qualifiedVizName,
  resolveVizFile,
} from "../vizFileLookup";

function file(
  id: string,
  path: string,
  language: WorkspaceLanguage,
  presetId?: string,
): WorkspaceFile {
  return {
    id,
    path,
    language,
    content: "",
    ...(presetId ? { meta: { presetId } } : {}),
  } as WorkspaceFile;
}

describe("a pattern sharing the visual's name (#2322)", () => {
  const pattern = file("pat", "fold.strudel", "strudel");
  const sketch = file("viz", "Fold.p5", "p5js");

  it("resolves the bare name to the sketch, whatever the list order", () => {
    expect(findVizFileByName([pattern, sketch], "fold")?.id).toBe("viz");
    expect(findVizFileByName([sketch, pattern], "fold")?.id).toBe("viz");
  });

  it("resolves the zone's preset id to the sketch", () => {
    expect(resolveVizFile([pattern, sketch], "fold", "user_Fold")?.id).toBe("viz");
  });

  it("finds nothing when only the pattern has the name", () => {
    expect(findVizFileByName([pattern], "fold")).toBeUndefined();
    expect(resolveVizFile([pattern], "fold", null)).toBeUndefined();
  });
});

describe("hydra / glsl twins of a p5 sketch", () => {
  const p5 = file("p5", "scope.p5", "p5js");
  const hydra = file("hy", "scope.hydra", "hydra");
  const glsl = file("gl", "scope.glsl", "glsl");
  const files = [hydra, glsl, p5];

  it("gives the bare name to the p5 sketch", () => {
    expect(findVizFileByName(files, "scope")?.id).toBe("p5");
  });

  it("gives `name:hydra` / `name:glsl` to their renderers", () => {
    expect(findVizFileByName(files, "scope:hydra")?.id).toBe("hy");
    expect(findVizFileByName(files, "scope:glsl")?.id).toBe("gl");
  });

  it("qualifies only a non-p5 file that shares a p5 basename", () => {
    const p5s = p5VizBasenames(files);
    expect(qualifiedVizName(hydra, p5s)).toBe("scope:hydra");
    expect(qualifiedVizName(glsl, p5s)).toBe("scope:glsl");
    expect(qualifiedVizName(p5, p5s)).toBeNull();
    expect(qualifiedVizName(file("w", "wave.hydra", "hydra"), p5s)).toBeNull();
  });

  it("gives a lone hydra file its bare name", () => {
    expect(findVizFileByName([file("w", "wave.hydra", "hydra")], "wave")?.id).toBe("w");
  });
});

describe("names resolve the way the registry does", () => {
  it("matches a normalized name (case, spaces, hyphens, underscores)", () => {
    const pr = file("pr", "Piano Roll.p5", "p5js");
    expect(findVizFileByName([pr], "pianoroll")?.id).toBe("pr");
    expect(findVizFileByName([pr], "piano_roll")?.id).toBe("pr");
  });

  it("matches a viz file inside a folder by its basename", () => {
    const nested = file("n", "viz/sketches/Fold.p5", "p5js");
    expect(findVizFileByName([file("pat", "fold.strudel", "strudel"), nested], "fold")?.id).toBe("n");
  });

  it("gives a re-registered name to the LAST file, as the registry does", () => {
    const a = file("a", "a/fold.p5", "p5js");
    const b = file("b", "b/fold.p5", "p5js");
    expect(findVizFileByName([a, b], "fold")?.id).toBe("b");
  });

  it("prefers an exact registered name over a normalized one", () => {
    const exact = file("exact", "fold.p5", "p5js");
    const loose = file("loose", "x/Fold.p5", "p5js");
    expect(findVizFileByName([exact, loose], "fold")?.id).toBe("exact");
  });
});

describe("preset ids", () => {
  it("use the seeded preset id, else the renderer's user_ id", () => {
    expect(presetIdForVizFile(file("s", "Piano Roll.p5", "p5js", "bundled_pr"))).toBe("bundled_pr");
    expect(presetIdForVizFile(file("u", "viz/My Fold.p5", "p5js"))).toBe("user_viz_My_Fold");
  });

  it("map back to viz files only", () => {
    const pattern = file("pat", "fold.strudel", "strudel", "user_fold");
    const sketch = file("viz", "Fold.p5", "p5js", "seeded_fold");
    expect(findVizFileByPresetId([pattern, sketch], "user_fold")).toBeUndefined();
    expect(findVizFileByPresetId([pattern, sketch], "seeded_fold")?.id).toBe("viz");
  });

  it("win over the name: the zone's preset is the viz being drawn", () => {
    const p5 = file("p5", "scope.p5", "p5js", "scope_p5");
    const hydra = file("hy", "scope.hydra", "hydra", "scope_hydra");
    expect(resolveVizFile([p5, hydra], "scope", "scope_p5")?.id).toBe("p5");
    // a hydra zone whose preset resolved: the preset decides, not the bare name
    expect(resolveVizFile([p5, hydra], "scope", "scope_hydra")?.id).toBe("hy");
  });

  it("fall back to the name when the preset has no file here", () => {
    const sketch = file("viz", "Fold.p5", "p5js");
    expect(resolveVizFile([sketch], "fold", "user_gone")?.id).toBe("viz");
  });
});
