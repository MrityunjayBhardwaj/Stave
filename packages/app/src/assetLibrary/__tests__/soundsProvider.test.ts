import { describe, it, expect, vi } from "vitest";
import {
  soundMapToAssets,
  createSoundsProvider,
  type SoundMapDict,
} from "../soundsProvider";

// The GM-family grouping is the editor's own (`gmFamily` / `soundfontGroupLabel`,
// whose map gmFamilies.test.ts covers there); the provider imports it directly now
// that the app's tests can load the editor's main entry (#1938, #1943).
const deps = {
  startPreview: () => ({ stop: () => {} }),
  onInsert: () => {},
};

const DICT: SoundMapDict = {
  piano: { data: { type: "soundfont" } },
  gm_alto_sax: { data: { type: "soundfont" } },
  sawtooth: { data: { type: "synth" } },
  wt_fmsynth: { data: { type: "wavetable" } },
  bd: { data: { type: "sample" } },
  RolandTR909_bd: { data: { type: "sample", tag: "drum-machines" } },
  RolandTR909_sd: { data: { type: "sample", tag: "drum-machines" } },
  _internal: { data: { type: "synth" } }, // superdough internal — skipped
  mic: { data: { type: "input" } }, // audio-in bus — skipped
  mysteryNewType: { data: { type: "granular" } }, // unknown → Samples (include-by-default)
};

describe("soundMapToAssets", () => {
  it("null dict → empty", () => {
    expect(soundMapToAssets(null, deps)).toEqual([]);
  });

  it("skips `_`-internals and the audio-in bus", () => {
    const ids = soundMapToAssets(DICT, deps).map((a) => a.id);
    expect(ids).not.toContain("_internal");
    expect(ids).not.toContain("mic");
  });

  it("INCLUDES drum-machine voices (unlike groupSoundCatalog) grouped by bank", () => {
    const drums = soundMapToAssets(DICT, deps).filter((a) => a.tags.includes("drums"));
    expect(drums.map((a) => a.id).sort()).toEqual(["RolandTR909_bd", "RolandTR909_sd"]);
    expect(drums.every((a) => a.group === "Drums · RolandTR909")).toBe(true);
  });

  it("groups melodic sounds by type", () => {
    const byId = new Map(soundMapToAssets(DICT, deps).map((a) => [a.id, a]));
    expect(byId.get("sawtooth")?.group).toBe("Synths");
    expect(byId.get("piano")?.group).toBe("Soundfonts"); // unmapped soundfont → flat
    expect(byId.get("wt_fmsynth")?.group).toBe("Wavetables");
    expect(byId.get("bd")?.group).toBe("Samples");
  });

  it("sub-categorises gm_* soundfonts by GM family + adds the family search tag (#807)", () => {
    const a = soundMapToAssets(DICT, deps).find((x) => x.id === "gm_alto_sax");
    expect(a?.group).toBe("Soundfonts · Reed");
    expect(a?.tags).toContain("reed"); // searchable by family name
  });

  it("unknown type falls through to Samples (never dropped — P254)", () => {
    const a = soundMapToAssets(DICT, deps).find((x) => x.id === "mysteryNewType");
    expect(a).toBeTruthy();
    expect(a?.group).toBe("Samples");
  });

  it("friendly label for soundfonts; id stays the raw s() string", () => {
    const a = soundMapToAssets(DICT, deps).find((x) => x.id === "gm_alto_sax");
    expect(a?.name).toBe("Alto Sax");
    expect(a?.id).toBe("gm_alto_sax"); // what s("…") writes
    expect(a?.tags).toContain("gm_alto_sax"); // raw key searchable
  });

  it("sorted by (group, name)", () => {
    const groups = soundMapToAssets(DICT, deps).map((a) => a.group);
    const sorted = [...groups].sort();
    expect(groups).toEqual(sorted);
  });

  it("preview/insert wire through to the injected deps", () => {
    const startPreview = vi.fn(() => ({ stop: () => {} }));
    const onInsert = vi.fn();
    const a = soundMapToAssets({ piano: { data: { type: "soundfont" } } }, {
      ...deps,
      startPreview,
      onInsert,
    })[0];
    a.preview?.();
    a.insert?.();
    expect(startPreview).toHaveBeenCalledWith("piano");
    expect(onInsert).toHaveBeenCalledWith("piano");
  });
});

describe("createSoundsProvider", () => {
  it("isLoading true until the soundMap fills, then lists", () => {
    let dict: SoundMapDict | null = null;
    const p = createSoundsProvider({ readDict: () => dict, ...deps });
    expect(p.isLoading()).toBe(true);
    expect(p.list()).toEqual([]);
    dict = { piano: { data: { type: "soundfont" } } };
    expect(p.isLoading()).toBe(false);
    expect(p.list().map((a) => a.id)).toEqual(["piano"]);
  });

  it("is a sound-typed provider", () => {
    const p = createSoundsProvider({ readDict: () => null, ...deps });
    expect(p.type).toBe("sound");
    expect(p.label).toBe("Sounds");
  });

  it("memoises list() on entry count — stable ref between calls, rebuilds on growth", () => {
    let dict: SoundMapDict = { a: { data: { type: "synth" } } };
    const readDict = vi.fn(() => dict);
    const p = createSoundsProvider({ readDict, ...deps });
    const first = p.list();
    const second = p.list();
    expect(second).toBe(first); // same array — no per-keystroke rebuild

    // Catalog grows (warm-up) → rebuild, new array with the extra sound.
    dict = { a: { data: { type: "synth" } }, b: { data: { type: "sample" } } };
    const third = p.list();
    expect(third).not.toBe(first);
    expect(third.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
});
