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
  getTrackMeta,
  setTrackMeta,
  getZoneHeightOverride,
  setZoneHeightOverride,
  pruneZoneOverrides,
  listWorkspaceFiles,
  loadShellState,
  saveShellState,
  buildDefaultSnapshot,
  clearShellState,
} from "@stave/editor";
import {
  PITCHWHEEL_P5_UNTIL_2021,
  PITCHWHEEL_P5_UNTIL_1929,
  PITCHWHEEL_P5_FIRST,
  SPIRAL_P5_UNTIL_2021,
  SPIRAL_P5_FIRST,
} from "../retiredPresetSources";
import { TEMPLATES, getTemplateFiles, FULL_SONG_CODE, STRUDEL_CODE, seedMissingPresetFiles, seedProjectFromTemplate } from "../templates";
import { VIZ_LIBRARY, VIZ_LIB_ROOT, planVizLibFiles } from "../assetLibrary/vizLibrary";
import { loadPerTabBackdrop, savePerTabBackdrop } from "../state/tabBackdrops";

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
      for (const f of ownFiles(t.id)) {
        // a Viz Library package a template brings (#2240) sits where the Library puts it
        if (f.path.startsWith(`${VIZ_LIB_ROOT}/`)) continue;
        expect(f.path, `${t.id}: ${f.path}`).not.toContain("/");
      }
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
    seedProjectFromTemplate("song", "test-project");
    expect(getChildOrder("")).toEqual(["f:song.strudel", "d:preset"]);
  });
});

describe("template tracks open as Bars, a vocal as Waveform", () => {
  /** A file's track names as the timeline keys them: a label's name, or d1,
   *  d2… for each `$:` in order (muted `_` labels are not tracks). */
  function trackNames(code: string): string[] {
    let anonymous = 0;
    const names: string[] = [];
    for (const m of code.matchAll(/^([A-Za-z_$][\w$]*):/gm)) {
      const name = m[1];
      if (name.startsWith("_") || name.endsWith("_")) continue;
      names.push(name === "$" ? `d${++anonymous}` : name);
    }
    return names;
  }

  const strudelFiles = () =>
    TEMPLATES.flatMap((t) => getTemplateFiles(t.id).filter((f) => f.language === "strudel").map((f) => ({ t: t.id, f })));

  it("every named track of the Full Song is saved as Bars, except its voice as Waveform", () => {
    seedProjectFromTemplate("song", "test-project");
    const f = getTemplateFiles("song")[0];
    const names = trackNames(f.content);
    expect(names).toEqual(["drums", "bass", "keys", "lead", "voice"]);
    for (const name of names) {
      expect(getTrackMeta(f.id, name).display, name).toBe(name === "voice" ? "waveform" : "bars");
    }
  });

  it("saves nothing for a `$:` track, whose d1, d2… name follows whatever is written first", () => {
    expect(strudelFiles().length).toBeGreaterThanOrEqual(3); // Starter, Strudel Sketch, Full Song
    for (const { t, f } of strudelFiles()) {
      for (const name of Object.keys(f.trackDisplays ?? {})) expect(name, `${t} ${name}`).not.toMatch(/^d\d+$/);
    }
    // The Starter and the Sketch name their tracks (#2112) but save no type, so
    // a song written over them later is not held to these tracks' types.
    const expected: Record<string, string[]> = { starter: ["kick", "snare", "hats", "bass", "pads", "lead"], strudel: ["drums", "bass"] };
    for (const t of ["starter", "strudel"]) {
      seedProjectFromTemplate(t, "test-project");
      const f = getTemplateFiles(t).find((x) => x.language === "strudel")!;
      expect(trackNames(f.content), t).toEqual(expected[t]);
      for (const name of trackNames(f.content)) expect(getTrackMeta(f.id, name).display, `${t} ${name}`).toBeUndefined();
    }
  });

  it("names only tracks the song has, so a renamed track cannot be missed silently", () => {
    for (const { t, f } of strudelFiles()) {
      const names = new Set(trackNames(f.content));
      for (const name of Object.keys(f.trackDisplays ?? {})) expect(names.has(name), `${t} ${name}`).toBe(true);
    }
  });

  it("seeding again keeps a type the user picked", () => {
    seedProjectFromTemplate("song", "test-project");
    setTrackMeta("song.strudel", "keys", { display: "waveform" });
    setTrackMeta("song.strudel", "voice", { display: "bars" });
    seedProjectFromTemplate("song", "test-project");
    expect(getTrackMeta("song.strudel", "keys").display).toBe("waveform");
    expect(getTrackMeta("song.strudel", "voice").display).toBe("bars");
    // A track with only a colour saved still gets its type, beside the colour.
    setTrackMeta("song.strudel", "keys", { display: undefined, color: "#ff0000" });
    seedProjectFromTemplate("song", "test-project");
    expect(getTrackMeta("song.strudel", "keys")).toEqual({ color: "#ff0000", display: "bars" });
  });
});

/**
 * #2240 — the sketch Stave opens with, and what a project made from the Starter
 * starts with: Sunset Drive behind the song, the two inline visuals at one
 * height, and Sunset Drive's code open beside the song.
 */
describe("the Starter (#2240)", () => {
  const sunset = planVizLibFiles(VIZ_LIBRARY.find((i) => i.id === "sunset-drive")!)[0];
  const pid = "starter-test-project";
  const wipe = () => {
    for (const f of listWorkspaceFiles()) deleteWorkspaceFile(f.id);
    localStorage.clear();
    clearShellState(pid);
  };
  beforeEach(wipe);

  it("is six named tracks, with a knob, a piano roll, a scope and Sunset Drive behind it", () => {
    const tracks = [...STRUDEL_CODE.matchAll(/^(\w+): /gm)].map((m) => m[1]);
    expect(tracks).toEqual(["kick", "snare", "hats", "bass", "pads", "lead"]);
    expect(STRUDEL_CODE).toContain("slider(");
    expect(STRUDEL_CODE).toContain("._pianoroll()");
    expect(STRUDEL_CODE).toContain('.viz("scope")');
    expect(STRUDEL_CODE).toContain('.viz("Sunset Drive", { backdrop: true })');
  });

  it("brings Sunset Drive at the id and path the Library's + would write", () => {
    const f = getTemplateFiles("starter").find((x) => x.id === sunset.workspaceId);
    expect(f).toMatchObject({ path: sunset.path, content: sunset.content, language: "p5js" });
  });

  it("a new project: Sunset Drive pinned behind the song, both visuals at 160px, two tabs", () => {
    seedProjectFromTemplate("starter", pid);
    expect([...loadPerTabBackdrop(pid)]).toEqual([["pattern.strudel", sunset.workspaceId]]);
    expect(getZoneHeightOverride("pattern.strudel", "bass")).toBe(160);
    expect(getZoneHeightOverride("pattern.strudel", "lead")).toBe(160);
    const tabs = loadShellState(pid, new Set(listWorkspaceFiles().map((f) => f.id)))!;
    const group = tabs.groups[tabs.activeGroupId];
    expect(group.tabs.map((t) => (t as { fileId: string }).fileId)).toEqual(["pattern.strudel", sunset.workspaceId]);
    expect(group.activeTabId).toBe("tab-pattern.strudel");
  });

  it("a seeded height goes when the track's visual changes, as a dragged one does", () => {
    seedProjectFromTemplate("starter", pid);
    pruneZoneOverrides("pattern.strudel", new Map([
      ["bass", { vizId: "pianoroll" }],
      ["lead", { vizId: "spectrum" }],
    ]));
    expect(getZoneHeightOverride("pattern.strudel", "bass")).toBe(160);
    expect(getZoneHeightOverride("pattern.strudel", "lead")).toBeUndefined();
  });

  it("keeps what is already chosen: a backdrop, a height, the tabs", () => {
    savePerTabBackdrop(pid, new Map([["pattern.strudel", "something-else"]]));
    seedProjectFromTemplate("starter", "another-project"); // the files exist; pid's choices are untouched
    setZoneHeightOverride("pattern.strudel", "lead", 300);
    saveShellState(pid, buildDefaultSnapshot("g-main", "pattern.strudel"));
    seedProjectFromTemplate("starter", pid);
    expect(loadPerTabBackdrop(pid).get("pattern.strudel")).toBe("something-else");
    expect(getZoneHeightOverride("pattern.strudel", "lead")).toBe(300);
    expect(getZoneHeightOverride("pattern.strudel", "bass")).toBe(160);
    const tabs = loadShellState(pid, new Set(listWorkspaceFiles().map((f) => f.id)))!;
    expect(tabs.groups[tabs.activeGroupId].tabs).toHaveLength(1);
  });

  it("an existing project gains the bundled visualisers, not the Starter's Library package", () => {
    seedMissingPresetFiles();
    const paths = listWorkspaceFiles().map((f) => f.path);
    expect(paths.some((p) => p.startsWith("preset/viz/"))).toBe(true);
    expect(paths.filter((p) => p.startsWith(`${VIZ_LIB_ROOT}/`))).toEqual([]);
  });
});
