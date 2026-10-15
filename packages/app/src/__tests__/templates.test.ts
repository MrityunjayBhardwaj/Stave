import { describe, it, expect, beforeEach } from "vitest";
import {
  PITCHWHEEL_P5_CODE,
  SPIRAL_P5_CODE,
  bundledPresetId,
  workspaceFileIdForPreset,
  createWorkspaceFile,
  getFile,
  deleteWorkspaceFile,
  getChildOrder,
} from "@stave/editor";
import {
  PITCHWHEEL_P5_UNTIL_2021,
  PITCHWHEEL_P5_UNTIL_1929,
  PITCHWHEEL_P5_FIRST,
  SPIRAL_P5_UNTIL_2021,
  SPIRAL_P5_FIRST,
} from "../retiredPresetSources";
import { TEMPLATES, getTemplateFiles, FULL_SONG_CODE, seedMissingPresetFiles, seedProjectFromTemplate } from "../templates";

describe("project templates", () => {
  // getTemplateFiles answers an id it does not know with the Starter files.
  // A template listed in the dialog without its own case would therefore open
  // as Starter and nothing would say so.
  it("every listed template has files of its own, not the Starter fallback", () => {
    const starter = JSON.stringify(getTemplateFiles("starter"));
    expect(JSON.stringify(getTemplateFiles("no-such-template"))).toBe(starter);
    for (const t of TEMPLATES) {
      if (t.id === "starter") continue;
      expect(JSON.stringify(getTemplateFiles(t.id)), t.id).not.toBe(starter);
    }
  });

  it("Full Song is one Strudel file holding the song", () => {
    expect(TEMPLATES.map((t) => t.id)).toContain("song");
    const files = getTemplateFiles("song");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "song.strudel", language: "strudel", content: FULL_SONG_CODE });
  });

  it("the song's five tracks each run 48 bars", () => {
    const tracks = [...FULL_SONG_CODE.matchAll(/^(\w+):\s+arrange\((.*)\)$/gm)];
    expect(tracks.map((m) => m[1])).toEqual(["drums", "bass", "keys", "lead", "voice"]);
    for (const [, name, sections] of tracks) {
      const bars = [...sections.matchAll(/\[(\d+),/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      expect(bars, name).toBe(48);
    }
  });
});

/**
 * #2021 — a project keeps its own copy of each bundled sketch, so a fix to the
 * bundled source reaches an existing project only if its copy is replaced. An
 * unedited copy is; an edited one is somebody's work and is not.
 */
describe("bundled sketches in an existing project (#2021)", () => {
  // name, the sketch as bundled now, the sketch as it shipped before
  const cases = [
    ["pitchwheel", PITCHWHEEL_P5_CODE, PITCHWHEEL_P5_UNTIL_2021],
    ["pitchwheel", PITCHWHEEL_P5_CODE, PITCHWHEEL_P5_UNTIL_1929],
    ["pitchwheel", PITCHWHEEL_P5_CODE, PITCHWHEEL_P5_FIRST],
    ["spiral", SPIRAL_P5_CODE, SPIRAL_P5_UNTIL_2021],
    ["spiral", SPIRAL_P5_CODE, SPIRAL_P5_FIRST],
  ] as const;
  const idOf = (name: string) => workspaceFileIdForPreset(bundledPresetId(name, "p5"));
  // each case starts with neither sketch in the project
  beforeEach(() => {
    for (const [name] of cases) deleteWorkspaceFile(idOf(name));
  });

  it("the records are five different old sketches", () => {
    expect(new Set(cases.map((c) => c[2])).size).toBe(5);
  });

  it.each(cases)("%s: an unedited old copy is brought up to date", (name, current, old) => {
    // controls: the record really is the old sketch, and really differs from the new
    expect(old).toContain("createCanvas(300, 200)");
    expect(current).not.toContain("createCanvas(300, 200)");
    createWorkspaceFile(idOf(name), `preset/viz/${name}.p5`, old, "p5js");
    seedMissingPresetFiles();
    expect(getFile(idOf(name))?.content).toBe(current);
  });

  it.each(cases)("%s: an edited copy is left exactly as its owner wrote it", (name, _current, old) => {
    const edited = old + "\n// mine";
    createWorkspaceFile(idOf(name), `preset/viz/${name}.p5`, edited, "p5js");
    seedMissingPresetFiles();
    expect(getFile(idOf(name))?.content).toBe(edited);
  });

  it("a current copy is not rewritten, and a missing one is seeded current", () => {
    createWorkspaceFile(idOf("pitchwheel"), "preset/viz/pitchwheel.p5", PITCHWHEEL_P5_CODE, "p5js");
    seedMissingPresetFiles();
    expect(getFile(idOf("pitchwheel"))?.content).toBe(PITCHWHEEL_P5_CODE);
    expect(getFile(idOf("spiral"))?.content).toBe(SPIRAL_P5_CODE);
  });
});

describe("each template is a sound project of its own (#2076)", () => {
  // The bundled visualisers every project carries (seedMissingPresetFiles).
  const presetIds = new Set(
    getTemplateFiles("starter").filter((f) => f.meta?.presetId !== undefined).map((f) => f.id),
  );
  const ownFiles = (id: string) => getTemplateFiles(id).filter((f) => !presetIds.has(f.id));

  it("control: the bundled visualisers are found, and only under preset/viz", () => {
    expect(presetIds.size).toBeGreaterThan(10);
    for (const f of getTemplateFiles("starter")) {
      if (presetIds.has(f.id)) expect(f.path.startsWith("preset/viz/"), f.path).toBe(true);
    }
  });

  it("a template's own files sit at the root, not among the presets", () => {
    for (const t of TEMPLATES) {
      for (const f of ownFiles(t.id)) expect(f.path, `${t.id}: ${f.path}`).not.toContain("/");
    }
  });

  it("no template's own file takes a bundled visualiser's id", () => {
    for (const t of TEMPLATES) {
      for (const f of getTemplateFiles(t.id)) {
        if (presetIds.has(f.id)) expect(f.path.startsWith("preset/viz/"), `${t.id}: ${f.path}`).toBe(true);
      }
    }
  });

  it("no two templates start the same project", () => {
    const seen = new Map<string, string>();
    for (const t of TEMPLATES) {
      const key = JSON.stringify(ownFiles(t.id).map((f) => [f.language, f.content]));
      expect(seen.get(key), `${t.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, t.id);
    }
  });

  it("a new project lists its own files above the preset folder", () => {
    seedProjectFromTemplate("song");
    expect(getChildOrder("")).toEqual(["f:song.strudel", "d:preset"]);
  });
});
