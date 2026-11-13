/**
 * #2511 — the Extensions view's rules, on manifests made here (the shipped list is empty).
 */
import { describe, expect, it } from "vitest";
import type { ExtensionManifest } from "@stave/editor";
import {
  addsOf,
  codeNamesOf,
  extensionRow,
  extensionTabKey,
  failedToStart,
  groupExtensions,
  LEFTOVER_TEXT,
  languagesLabel,
  leftoversOf,
  matchesQuery,
  showsExtensionsPanel,
  switchStateLine,
} from "../extensionsView";

const load = async () => ({});

const voice: ExtensionManifest = {
  id: "voice",
  name: "Voice",
  description: "A singing voice you write in code",
  languages: ["strudel"],
  provides: { strudel: { sounds: ["voice"], controls: ["lyric"] } },
  load,
  about: { version: "0.1.0", experimental: true, worklets: ["the voice engine"], prepares: "Loads the voice engine." },
};
const vim: ExtensionManifest = {
  id: "vim",
  name: "Vim keybindings",
  description: "Vim modes and motions in the code editor",
  languages: "*",
  load,
};
const hydraThing: ExtensionManifest = {
  id: "hy",
  name: "Hydra things",
  description: "Shapes",
  languages: ["hydra", "strudel"],
  load,
};
const ALL = [voice, vim, hydraThing];
const WORDS = { control: "the control stays `listed`", worklet: "the worklet stays loaded" };

describe("the panel shows only once an extension is listed", () => {
  it("hidden for an empty list, shown for one", () => {
    expect(showsExtensionsPanel([])).toBe(false);
    expect(showsExtensionsPanel([vim])).toBe(true);
  });
});

describe("languages", () => {
  it('"All languages" for *, else the names in order', () => {
    expect(languagesLabel("*")).toBe("All languages");
    expect(languagesLabel(["strudel"])).toBe("Strudel");
    expect(languagesLabel(["hydra", "strudel"])).toBe("Hydra, Strudel");
    expect(extensionRow(vim, new Set()).languages).toBe("All languages");
  });
});

describe("code names", () => {
  it("sounds as s(\"…\") and controls as .name()", () => {
    expect(codeNamesOf(voice)).toEqual(['s("voice")', ".lyric()"]);
    expect(codeNamesOf(vim)).toEqual([]);
  });
});

describe("groups", () => {
  it("off and not needed: Built into Stave; on: On; each in exactly one group", () => {
    const g = groupExtensions(ALL, { enabled: new Set(["vim"]) });
    expect(g.on.map((r) => r.id)).toEqual(["vim"]);
    expect(g.builtIn.map((r) => r.id)).toEqual(["voice", "hy"]);
    expect(g.needed).toEqual([]);
  });

  it("needed and off: Needed by this project; needed and on: On", () => {
    const off = groupExtensions(ALL, { enabled: new Set(), needed: new Set(["voice"]) });
    expect(off.needed.map((r) => r.id)).toEqual(["voice"]);
    expect(off.builtIn.map((r) => r.id)).toEqual(["vim", "hy"]);
    const on = groupExtensions(ALL, { enabled: new Set(["voice"]), needed: new Set(["voice"]) });
    expect(on.needed).toEqual([]);
    expect(on.on.map((r) => r.id)).toEqual(["voice"]);
  });
});

describe("filters", () => {
  const enabled = new Set(["vim"]);
  const ids = (f: "all" | "on" | "off") => {
    const g = groupExtensions(ALL, { enabled, filter: f });
    return [...g.needed, ...g.on, ...g.builtIn].map((r) => r.id).sort();
  };
  it("All shows every one, On only the on, Off only the off", () => {
    expect(ids("all")).toEqual(["hy", "vim", "voice"]);
    expect(ids("on")).toEqual(["vim"]);
    expect(ids("off")).toEqual(["hy", "voice"]);
  });
});

describe("search", () => {
  const row = extensionRow(voice, new Set());
  it("matches name, description, id, code names and languages, any case", () => {
    expect(matchesQuery(row, "VOI")).toBe(true);
    expect(matchesQuery(row, "singing")).toBe(true);
    expect(matchesQuery(row, ".lyric")).toBe(true);
    expect(matchesQuery(row, "strudel")).toBe(true);
    expect(matchesQuery(row, "  ")).toBe(true);
    expect(matchesQuery(row, "hydra")).toBe(false);
  });
  it("narrows the groups", () => {
    const g = groupExtensions(ALL, { enabled: new Set(), query: "keybind" });
    expect(g.builtIn.map((r) => r.id)).toEqual(["vim"]);
  });
});

describe("the row and the page read one switch", () => {
  it("a row's on is the store's, and the page's state line follows it", () => {
    expect(extensionRow(voice, new Set(["voice"])).on).toBe(true);
    expect(extensionRow(voice, new Set()).on).toBe(false);
    expect(switchStateLine(true)).toBe("On — takes effect at once, no reload");
    expect(switchStateLine(false)).toBe("Off — its code has not been loaded");
  });
  it("switched on but failed to start: the line says so, and points to the Console (#2552)", () => {
    expect(switchStateLine(true, "chunk 404.")).toBe("Couldn't switch on: chunk 404. The Console has the details.");
    // a failure left over from before it was switched off is not shown
    expect(switchStateLine(false, "chunk 404.")).toBe("Off — its code has not been loaded");
    expect(failedToStart(true, "chunk 404.")).toBe(true);
    expect(failedToStart(true, undefined)).toBe(false);
    expect(failedToStart(false, "chunk 404.")).toBe(false);
  });
});

describe("what it adds, from the manifest alone", () => {
  it("languages, sounds, controls (method and global), worklets and what it prepares", () => {
    const lines = addsOf(voice);
    expect(lines.map((l) => l.kind)).toEqual(["Languages", "Sounds", "Controls", "Audio worklet", "Before playing"]);
    expect(lines.find((l) => l.kind === "Controls")?.names).toEqual([".lyric(…)", "lyric(…)"]);
    expect(lines.find((l) => l.kind === "Sounds")?.names).toEqual(['s("voice")']);
  });
  it("an extension that adds no names still says its languages", () => {
    expect(addsOf(vim)).toEqual([{ kind: "Languages", text: "All languages" }]);
  });
});

describe("when switched off", () => {
  it("lists a leftover for its controls and one for its worklets", () => {
    expect(leftoversOf(voice, WORDS)).toEqual([
      { names: [".lyric(…)"], text: WORDS.control },
      { names: [], text: WORDS.worklet },
    ]);
  });
  it("nothing for an extension with neither", () => {
    expect(leftoversOf(vim)).toEqual([]);
  });
  it("in plain words: no library, function or parser names (#2552)", () => {
    const shown = leftoversOf(voice).map((n) => n.text);
    expect(shown).toEqual([LEFTOVER_TEXT.control, LEFTOVER_TEXT.worklet]);
    for (const text of shown) {
      expect(text).not.toMatch(/superdough|registerWorklet|controlAlias|parser|Strudel's control list|worklet|`/i);
    }
  });
});

describe("tabs", () => {
  it("one tab key per extension", () => {
    expect(extensionTabKey("voice")).toBe("extension:voice");
    expect(extensionTabKey("voice")).not.toBe(extensionTabKey("vim"));
  });
});
