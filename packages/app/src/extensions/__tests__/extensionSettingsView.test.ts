/**
 * #2556 — the rules Settings › Extensions and an extension's page follow: the `@ext:` filter,
 * search by label and description, only switched-on extensions, and defaults in words.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionManifest, ExtensionSetting, ExtensionSettingState } from "@stave/editor";
import {
  defaultText,
  emptyExtensionFilterLine,
  extensionSettingGroups,
  extensionSettingsQuery,
  parseSettingsQuery,
  settingMatches,
  typeText,
} from "../extensionSettingsView";

const SETTINGS: readonly ExtensionSetting[] = [
  { id: "relative", label: "Relative line numbers", description: "Number lines from the cursor.", type: "boolean", default: false },
  { id: "leader", label: "Leader key", description: "The key that starts a mapping.", type: "text", default: "\\" },
  {
    id: "mode",
    label: "Start in",
    description: "Which mode a new editor opens in.",
    type: "choice",
    options: [
      { value: "normal", label: "Normal mode" },
      { value: "insert", label: "Insert mode" },
    ],
    default: "normal",
  },
  { id: "size", label: "Size", description: "Letters, in pixels.", type: "number", default: 12 },
];

const manifest = (id: string, name: string, settings: readonly ExtensionSetting[] = SETTINGS): ExtensionManifest => ({
  id,
  name,
  description: "",
  languages: "*",
  provides: { settings },
  load: async () => ({}),
});

const VIMISH = manifest("vimish", "Vimish");
const OTHER = manifest("other", "Other", [SETTINGS[0]]);
const BARE = manifest("bare", "Bare", []);
const ALL = [VIMISH, OTHER, BARE];

/** Read the declared settings at their defaults, without the store. */
const read = (m: ExtensionManifest): ExtensionSettingState[] =>
  (m.provides?.settings ?? []).map((setting) => ({ setting, value: setting.default, isDefault: true }));

const ids = (groups: ReturnType<typeof extensionSettingGroups>) =>
  groups.map((g) => `${g.manifest.id}:${g.rows.map((r) => r.setting.id).join(",")}`);

describe("parseSettingsQuery", () => {
  it("finds @ext:<id> anywhere, and keeps the rest as lower-case words", () => {
    expect(parseSettingsQuery("@ext:vimish")).toEqual({ extensionId: "vimish", text: "" });
    expect(parseSettingsQuery("  Leader @ext:vimish  ")).toEqual({ extensionId: "vimish", text: "leader" });
    expect(parseSettingsQuery("@ext:vimish Line")).toEqual({ extensionId: "vimish", text: "line" });
    expect(parseSettingsQuery("Font")).toEqual({ extensionId: null, text: "font" });
    expect(parseSettingsQuery("mail@ext:x")).toEqual({ extensionId: null, text: "mail@ext:x" });
  });
  it("the page's Settings button asks for exactly the filter the parser reads", () => {
    expect(parseSettingsQuery(extensionSettingsQuery("e2e-tone")).extensionId).toBe("e2e-tone");
  });
});

describe("settingMatches", () => {
  it("matches the label and the description, and everything with no words", () => {
    expect(settingMatches(SETTINGS[0], "relative")).toBe(true);
    expect(settingMatches(SETTINGS[0], "cursor")).toBe(true);
    expect(settingMatches(SETTINGS[0], "leader")).toBe(false);
    expect(settingMatches(SETTINGS[0], "")).toBe(true);
  });
});

describe("extensionSettingGroups", () => {
  const on = new Set(["vimish", "other", "bare"]);

  it("one group per switched-on extension that has settings, in the listed order", () => {
    expect(ids(extensionSettingGroups(ALL, on, parseSettingsQuery(""), read))).toEqual([
      "vimish:relative,leader,mode,size",
      "other:relative",
    ]);
  });

  it("a switched-off extension's settings stay out, even under its own @ext filter", () => {
    expect(ids(extensionSettingGroups(ALL, new Set(["other"]), parseSettingsQuery(""), read))).toEqual(["other:relative"]);
    expect(extensionSettingGroups(ALL, new Set(["other"]), parseSettingsQuery("@ext:vimish"), read)).toEqual([]);
  });

  it("@ext narrows to that one extension", () => {
    expect(ids(extensionSettingGroups(ALL, on, parseSettingsQuery("@ext:other"), read))).toEqual(["other:relative"]);
  });

  it("search finds a setting by its description alone", () => {
    expect(ids(extensionSettingGroups(ALL, on, parseSettingsQuery("starts a mapping"), read))).toEqual(["vimish:leader"]);
  });

  it("search by label, across extensions", () => {
    expect(ids(extensionSettingGroups(ALL, on, parseSettingsQuery("relative"), read))).toEqual([
      "vimish:relative",
      "other:relative",
    ]);
  });

  it("the extension's name shows all of its settings", () => {
    expect(ids(extensionSettingGroups(ALL, on, parseSettingsQuery("vimish"), read))).toEqual(["vimish:relative,leader,mode,size"]);
  });

  it("no match, no group", () => {
    expect(extensionSettingGroups(ALL, on, parseSettingsQuery("zzz"), read)).toEqual([]);
  });
});

describe("emptyExtensionFilterLine", () => {
  const line = (q: string, enabled: string[]) => {
    const parsed = parseSettingsQuery(q);
    const groups = extensionSettingGroups(ALL, new Set(enabled), parsed, read);
    return emptyExtensionFilterLine(ALL, new Set(enabled), parsed, groups, read);
  };
  it("says why an @ext filter shows nothing", () => {
    expect(line("@ext:vimish", [])).toBe("Vimish is switched off. Switch it on to see and change its settings.");
    expect(line("@ext:bare", ["bare"])).toBe("Bare has no settings.");
    expect(line("@ext:nope", [])).toBe("There is no extension called “nope”.");
    expect(line("@ext:vimish zzz", ["vimish"])).toBe("None of Vimish’s settings match “zzz”.");
  });
  it("is null when something shows, or there is no @ext filter", () => {
    expect(line("@ext:vimish", ["vimish"])).toBeNull();
    expect(line("zzz", [])).toBeNull();
  });
});

describe("defaults and kinds in words", () => {
  it("each type", () => {
    expect(SETTINGS.map(defaultText)).toEqual(["Off", "“\\”", "Normal mode", "12"]);
    expect(defaultText({ ...SETTINGS[0], default: true } as ExtensionSetting)).toBe("On");
    expect(defaultText({ ...SETTINGS[1], default: "" } as ExtensionSetting)).toBe("(empty)");
    expect(SETTINGS.map(typeText)).toEqual(["on/off", "text", "choice", "number"]);
  });
});
