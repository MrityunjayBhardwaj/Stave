/**
 * #2545 — the rules behind the Source column, the Source filter, an extension's key rows,
 * the "inside the code" conflict badge, and the toggle both places share.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extensionKeys,
  setExtensionKeyGivenBack,
  isExtensionKeyGivenBack,
  type ExtensionKeyInCode,
  type ExtensionManifest,
} from "@stave/editor";
import {
  clashLine,
  commandSource,
  extensionClashes,
  extensionKeyRows,
  extensionRowMatches,
  extensionSource,
  liveFilter,
  sourceLabel,
  sourceOptions,
  sourceShows,
  toggleExtensionKey,
  toggleLabel,
  whereLine,
  withKeys,
  type CommandKeys,
} from "../extensionKeysView";

const load = async () => ({});
const ext: ExtensionManifest = {
  id: "zz-keys",
  name: "Keyed",
  description: "Takes keys",
  languages: "*",
  provides: {
    keys: [
      { key: "mod+b", name: "Do a thing", where: "code" },
      { key: "mod+p", name: "Up a line", where: "code", givenBack: true },
    ],
  },
  load,
};
const other: ExtensionManifest = {
  id: "zz-other",
  name: "Other",
  description: "Also takes keys",
  languages: "*",
  provides: { keys: [{ key: "mod+b", name: "Its thing", where: "code" }] },
  load,
};
const plain: ExtensionManifest = { id: "zz-plain", name: "Plain", description: "No keys", languages: "*", load };

/** What the runtime's `extensionKeysInCode` gives for these extensions switched on: their keys not handed back. */
const keysTakenBy = (ms: ExtensionManifest[]): ExtensionKeyInCode[] =>
  ms.flatMap((m) =>
    extensionKeys(m)
      .filter((k) => !k.givenBack)
      .map((k) => ({ extensionId: m.id, extensionName: m.name, key: k.key, name: k.name })),
  );

const sidebar: CommandKeys = { id: "s", title: "Toggle Sidebar", chords: ["mod+b"], overridden: false };
const quickOpen: CommandKeys = { id: "q", title: "Quick Open", chords: ["mod+p"], overridden: false };

afterEach(() => {
  for (const m of [ext, other]) for (const k of m.provides!.keys!) setExtensionKeyGivenBack(m.id, k.key, null);
  localStorage.clear();
});

describe("Source", () => {
  it("is Stave by default, You once changed, and the extension's name for its rows", () => {
    expect(commandSource(false)).toBe("stave");
    expect(commandSource(true)).toBe("you");
    expect(sourceLabel("stave", [ext])).toBe("Stave");
    expect(sourceLabel("you", [ext])).toBe("You");
    expect(sourceLabel(extensionSource("zz-keys"), [ext])).toBe("Keyed");
  });

  it("the filter offers All, Stave, You and each extension that declares keys, and shows only its source", () => {
    expect(sourceOptions([ext, plain]).map((o) => o.label)).toEqual(["All", "Stave", "You", "Keyed"]);
    expect(withKeys([ext, plain])).toEqual([ext]);
    expect(sourceShows("all", "you")).toBe(true);
    expect(sourceShows("you", "you")).toBe(true);
    expect(sourceShows("you", "stave")).toBe(false);
    expect(sourceShows(extensionSource("zz-keys"), "stave")).toBe(false);
  });

  it("a filter on an extension that is switched off falls back to All", () => {
    expect(liveFilter(extensionSource("zz-keys"), [ext])).toBe(extensionSource("zz-keys"));
    expect(liveFilter(extensionSource("zz-keys"), [])).toBe("all");
    expect(liveFilter("you", [])).toBe("you");
  });
});

describe("an extension's rows", () => {
  it("every declared key, handed back or not, with the Stave commands on the same key", () => {
    const rows = extensionKeyRows(ext, [sidebar, quickOpen]);
    expect(rows.map((r) => [r.key, r.givenBack, r.staveCommands])).toEqual([
      ["mod+b", false, ["Toggle Sidebar"]],
      ["mod+p", true, ["Quick Open"]],
    ]);
    expect(rows[0].source).toBe("extension:zz-keys");
    expect(rows[0].extensionName).toBe("Keyed");
  });

  it("a scoped command, or one the person rebound, does not share the key in the code", () => {
    const rows = extensionKeyRows(ext, [{ ...sidebar, scope: "timeline" }, { ...quickOpen, overridden: true }]);
    expect(rows.map((r) => r.staveCommands)).toEqual([[], []]);
  });

  it("a search matches the key's name, its spelling and the extension's name", () => {
    const [row] = extensionKeyRows(ext, []);
    expect(extensionRowMatches(row, "thing")).toBe(true);
    expect(extensionRowMatches(row, "MOD+B")).toBe(true);
    expect(extensionRowMatches(row, "keyed")).toBe(true);
    expect(extensionRowMatches(row, "zzz")).toBe(false);
  });
});

describe("the conflict badge", () => {
  it("marks a Stave command whose key an extension takes inside the code", () => {
    const clashes = extensionClashes(sidebar, keysTakenBy([ext]));
    expect(clashes).toEqual([{ extensionId: "zz-keys", extensionName: "Keyed", key: "mod+b" }]);
    expect(clashLine(clashes)).toBe("Inside the code, Keyed uses this key");
  });

  it("not for a key handed back, a scoped command, or the person's own key (theirs wins in the code)", () => {
    expect(extensionClashes(quickOpen, keysTakenBy([ext]))).toEqual([]);
    expect(extensionClashes({ ...sidebar, scope: "timeline" }, keysTakenBy([ext]))).toEqual([]);
    expect(extensionClashes({ ...sidebar, overridden: true }, keysTakenBy([ext]))).toEqual([]);
  });

  it("the person's own key wins only where the key dispatcher lets it: a keystroke that cannot type text, or the palette and quick open", () => {
    const ctrl: ExtensionManifest = { ...ext, id: "zz-ctrl", name: "Ctrl", provides: { keys: [{ key: "ctrl+r", name: "Redo", where: "code" }] } };
    const taken = keysTakenBy([ctrl]);
    const mine = (id: string, chord: string): CommandKeys => ({ id, title: id, chords: [chord], overridden: true });
    // on a Mac, Control+R can type text as far as the dispatcher goes: the extension keeps it
    expect(extensionClashes(mine("zz.mine", "ctrl+r"), taken, { isMac: true }).length).toBe(1)
    // … unless it is quick open or the palette
    expect(extensionClashes(mine("stave.quickOpen", "ctrl+r"), taken, { isMac: true })).toEqual([]);
    // off a Mac, Ctrl+R cannot type text: the person's own key wins
    expect(extensionClashes(mine("zz.mine", "ctrl+r"), taken, { isMac: false })).toEqual([]);
    // and the extension's row agrees with the badge
    expect(extensionKeyRows(ctrl, [mine("zz.mine", "ctrl+r")], { isMac: true })[0].staveCommands).toEqual(["zz.mine"]);
    expect(extensionKeyRows(ctrl, [mine("zz.mine", "ctrl+r")], { isMac: false })[0].staveCommands).toEqual([]);
  });

  it("names every extension that takes it, once each", () => {
    const clashes = extensionClashes(sidebar, keysTakenBy([ext, other]));
    expect(clashes.map((c) => c.extensionName)).toEqual(["Keyed", "Other"]);
    expect(clashLine(clashes)).toBe("Inside the code, Keyed and Other use this key");
  });

  it("goes once the key is handed back", () => {
    setExtensionKeyGivenBack("zz-keys", "mod+b", true);
    expect(extensionClashes(sidebar, keysTakenBy([ext]))).toEqual([]);
  });
});

describe("the toggle", () => {
  it("says what pressing it does, and where the key goes now", () => {
    expect(toggleLabel(false, "Vim")).toBe("Give back to Stave");
    expect(toggleLabel(true, "Vim")).toBe("Use in Vim");
    expect(whereLine(false, "Vim")).toBe("Vim uses it");
    expect(whereLine(true, "Vim")).toBe("Given back to Stave");
  });

  it("flips the extension's own setting, and flipping back to the default clears the choice", () => {
    const set = vi.fn();
    toggleExtensionKey({ key: "mod+b", givenBack: false, givenBackByDefault: false }, "zz-keys", set);
    expect(set).toHaveBeenLastCalledWith("zz-keys", "mod+b", true);
    toggleExtensionKey({ key: "mod+b", givenBack: true, givenBackByDefault: false }, "zz-keys", set);
    expect(set).toHaveBeenLastCalledWith("zz-keys", "mod+b", null);
    toggleExtensionKey({ key: "mod+p", givenBack: true, givenBackByDefault: true }, "zz-keys", set);
    expect(set).toHaveBeenLastCalledWith("zz-keys", "mod+p", false);
  });

  it("through the real setting: the key moves, and the person's shortcuts are never written", () => {
    const before = localStorage.getItem("stave:keybindings");
    const [row] = extensionKeyRows(ext, []);
    toggleExtensionKey(row, "zz-keys");
    expect(isExtensionKeyGivenBack(ext, "mod+b")).toBe(true);
    const [back] = extensionKeyRows(ext, []);
    toggleExtensionKey(back, "zz-keys");
    expect(isExtensionKeyGivenBack(ext, "mod+b")).toBe(false);
    expect(JSON.parse(localStorage.getItem("stave:extension-keys") ?? "{}")).toEqual({});
    expect(localStorage.getItem("stave:keybindings")).toBe(before);
  });
});
