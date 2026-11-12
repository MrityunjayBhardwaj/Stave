/**
 * #2545 — Keyboard Shortcuts with an extension that declares keys, drawn: the Source column,
 * the Source filter, the extension's read-only rows, the "inside the code" conflict badge,
 * the toggle (the same setting as the extension's page, live in both), and everything gone
 * once it is switched off, with the person's shortcuts never written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  extensionKeys,
  onExtensionKeysChange,
  setExtensionKeyGivenBack,
  type ExtensionKeyInCode,
  type ExtensionManifest,
} from "@stave/editor";
import { KeyboardShortcutsPanel } from "../KeyboardShortcutsPanel";
import { ExtensionKeysContext, type ExtensionKeysSource } from "../../../extensions/useExtensionKeys";
import { ExtensionPage } from "../../../extensions/ExtensionPage";
import { registerCommand } from "../../../commands/registry";
import { setKeybindingOverride, resetAllKeybindings } from "../../../commands/keybindings";

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

/** A stand-in for the page runtime: which extensions are on is settable; taken keys follow the real setting. */
function stand(): ExtensionKeysSource & { switchOn(on: boolean): void } {
  let on = true;
  const subs = new Set<() => void>();
  const fire = () => {
    for (const fn of [...subs]) fn();
  };
  return {
    subscribe(fn) {
      subs.add(fn);
      const off = onExtensionKeysChange(fn);
      return () => {
        subs.delete(fn);
        off();
      };
    },
    active: () => (on ? [ext] : []),
    taken: (): ExtensionKeyInCode[] =>
      on
        ? extensionKeys(ext)
            .filter((k) => !k.givenBack)
            .map((k) => ({ extensionId: ext.id, extensionName: ext.name, key: k.key, name: k.name }))
        : [],
    switchOn(v) {
      on = v;
      fire();
    },
  };
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  cleanups.push(
    registerCommand({ id: "zz.sidebar", title: "Toggle Sidebar ZZ", category: "View", keybinding: "mod+b", run: () => {} }),
    registerCommand({ id: "zz.quick", title: "Quick Open ZZ", category: "Go", keybinding: "mod+p", run: () => {} }),
    registerCommand({ id: "zz.scoped", title: "Scoped ZZ", category: "Timeline", keybinding: "mod+b", scope: "zz-panel", run: () => {} }),
  );
});
afterEach(() => {
  cleanup();
  while (cleanups.length) cleanups.pop()!();
  for (const k of ext.provides!.keys!) setExtensionKeyGivenBack(ext.id, k.key, null);
  resetAllKeybindings();
  localStorage.clear();
});

const byId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function panel(source: ExtensionKeysSource, withPage = false) {
  return render(
    <ExtensionKeysContext.Provider value={source}>
      <div className="stave-settings">
        <KeyboardShortcutsPanel query="" />
      </div>
      {withPage ? <ExtensionPage manifest={ext} section="keys" onSection={() => {}} /> : null}
    </ExtensionKeysContext.Provider>,
  );
}

describe("Keyboard Shortcuts with an extension's keys", () => {
  it("every row has a Source; the extension's keys are read-only rows with its name as Source", () => {
    const { container } = panel(stand());
    expect(byId(container, "source-zz.sidebar")!.textContent).toBe("Stave");
    const row = byId(container, "ext-key-zz-keys-mod+b")!;
    expect(row.textContent).toContain("Do a thing");
    expect(byId(container, "ext-where-zz-keys-mod+b")!.textContent).toBe("inside the code · Keyed uses it");
    expect(byId(container, "source-zz-keys-mod+b")!.textContent).toBe("Keyed");
    // read-only: no chord button to rebind it
    expect(row.querySelector("button.chord")).toBeNull();
    // the key handed back by default shows that way
    expect(byId(container, "ext-key-zz-keys-mod+p")!.getAttribute("data-given-back")).toBe("true");
    expect(byId(container, "ext-toggle-zz-keys-mod+p")!.textContent).toBe("Use in Keyed");
  });

  it("marks a Stave command whose key the extension takes inside the code, not a scoped one or a handed-back key", () => {
    const { container } = panel(stand());
    expect(byId(container, "ext-conflict-zz.sidebar")!.textContent).toContain("Inside the code, Keyed uses this key");
    expect(byId(container, "ext-conflict-zz.scoped")).toBeNull();
    expect(byId(container, "ext-conflict-zz.quick")).toBeNull();
  });

  it("Give back to Stave clears the badge and shows on the extension's page at once; and back again", () => {
    const { container } = panel(stand(), true);
    const pageRow = () => container.querySelector('[data-extension-key="mod+b"]')!;
    expect(pageRow().getAttribute("data-given-back")).toBe("false");

    act(() => fireEvent.click(byId(container, "ext-toggle-zz-keys-mod+b")!));
    expect(byId(container, "ext-conflict-zz.sidebar")).toBeNull();
    expect(byId(container, "ext-toggle-zz-keys-mod+b")!.textContent).toBe("Use in Keyed");
    expect(pageRow().getAttribute("data-given-back")).toBe("true");
    expect(pageRow().querySelector("[data-extension-key-toggle]")!.textContent).toBe("Use in Keyed");

    // the page's toggle is the same setting: the panel follows
    act(() => fireEvent.click(pageRow().querySelector("[data-extension-key-toggle]")!));
    expect(byId(container, "ext-conflict-zz.sidebar")).not.toBeNull();
    expect(byId(container, "ext-key-zz-keys-mod+b")!.getAttribute("data-given-back")).toBe("false");

    // "Use in Keyed" on a key handed back by default gives it to the extension: quick open gets the badge
    act(() => fireEvent.click(byId(container, "ext-toggle-zz-keys-mod+p")!));
    expect(byId(container, "ext-key-zz-keys-mod+p")!.getAttribute("data-given-back")).toBe("false");
    expect(byId(container, "ext-conflict-zz.quick")!.textContent).toContain("Inside the code, Keyed uses this key");
    expect(container.querySelector('[data-extension-key="mod+p"]')!.getAttribute("data-given-back")).toBe("false");
    expect(localStorage.getItem("stave:keybindings")).toBeNull();
  });

  it("the person's own key wins inside the code: a rebound command has Source You and no badge", () => {
    setKeybindingOverride("zz.quick", "mod+b");
    const { container } = panel(stand());
    expect(byId(container, "source-zz.quick")!.textContent).toBe("You");
    expect(byId(container, "ext-conflict-zz.quick")).toBeNull();
  });

  it("the Source filter narrows the list to one source", () => {
    setKeybindingOverride("zz.quick", "mod+j");
    const { container } = panel(stand());
    const filter = byId(container, "source-filter")!;
    expect([...filter.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All", "Stave", "You", "Keyed"]);

    act(() => fireEvent.click(byId(container, "source-filter-extension:zz-keys")!));
    expect(byId(container, "ext-key-zz-keys-mod+b")).not.toBeNull();
    expect(byId(container, "source-zz.sidebar")).toBeNull();

    act(() => fireEvent.click(byId(container, "source-filter-you")!));
    expect(byId(container, "source-zz.quick")!.textContent).toBe("You");
    expect(byId(container, "source-zz.sidebar")).toBeNull();
    expect(byId(container, "ext-key-zz-keys-mod+b")).toBeNull();

    act(() => fireEvent.click(byId(container, "source-filter-stave")!));
    expect(byId(container, "source-zz.sidebar")).not.toBeNull();
    expect(byId(container, "source-zz.quick")).toBeNull();
  });

  it("switched off: its rows, badges, nav item and filter choice go; the saved shortcuts are byte-for-byte the same", () => {
    setKeybindingOverride("zz.quick", "mod+j");
    const saved = localStorage.getItem("stave:keybindings");
    const source = stand();
    const { container } = panel(source);
    act(() => fireEvent.click(byId(container, "source-filter-extension:zz-keys")!));
    act(() => fireEvent.click(byId(container, "ext-toggle-zz-keys-mod+b")!));
    act(() => fireEvent.click(byId(container, "ext-toggle-zz-keys-mod+b")!));

    act(() => source.switchOn(false));
    expect(container.querySelector('[data-testid^="ext-key-"]')).toBeNull();
    expect(container.querySelector('[data-testid^="ext-conflict-"]')).toBeNull();
    expect(byId(container, "keys-nav-extension:zz-keys")).toBeNull();
    expect(byId(container, "source-filter-extension:zz-keys")).toBeNull();
    // the filter fell back to All, so the list is not empty
    expect(byId(container, "source-zz.sidebar")).not.toBeNull();
    expect(localStorage.getItem("stave:keybindings")).toBe(saved);
  });
});
