import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerCommand } from "../registry";
import {
  setKeybindingOverride,
  getKeybindingFor,
  isKeybindingOverridden,
  resetAllKeybindings,
  hasAnyKeybindingOverride,
  findConflicts,
  conflictsForCommand,
  subscribeKeybindings,
} from "../keybindings";

const STORAGE_KEY = "stave:keybindings";

// This jsdom (opaque about:blank origin) ships no functional localStorage, so
// install a Map-backed stub. The store survives vi.resetModules so the
// "load at module init" fresh-import test can read what we wrote.
const store = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (k) => (store.has(k) ? store.get(k)! : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true, writable: true });

// Register two disposable commands with default bindings for the whole file.
let dispose: Array<() => void> = [];

beforeEach(() => {
  resetAllKeybindings();
  window.localStorage.clear();
  dispose = [
    registerCommand({ id: "test.undo", title: "Undo", category: "Edit", keybinding: "mod+z", run: () => {} }),
    registerCommand({ id: "test.redo", title: "Redo", category: "Edit", keybinding: "mod+shift+z", run: () => {} }),
  ];
});

afterEach(() => {
  dispose.forEach((d) => d());
  resetAllKeybindings();
  window.localStorage.clear();
});

describe("keybinding overrides — persistence", () => {
  it("writes an override through to localStorage", () => {
    setKeybindingOverride("test.undo", "mod+j");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ "test.undo": "mod+j" });
  });

  it("getKeybindingFor prefers the override over the declared default", () => {
    setKeybindingOverride("test.undo", "mod+j");
    expect(getKeybindingFor({ id: "test.undo", title: "Undo", keybinding: "mod+z", run: () => {} })).toBe("mod+j");
  });

  it("loads persisted overrides at module init (fresh import)", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ "test.undo": "mod+k" }));
    // Fresh keybindings, NOT a fresh editor: the chord helpers come from `@stave/editor`
    // (#1943), and evaluating that module twice in one process throws — p5 registers its
    // colour spaces in colorjs.io, which a module reset does not clear. Hand the re-import
    // the editor module already loaded, which is all the app ever has.
    const editor = await import("@stave/editor");
    vi.resetModules();
    vi.doMock("@stave/editor", () => editor);
    const fresh = await import("../keybindings");
    vi.doUnmock("@stave/editor");
    expect(
      fresh.getKeybindingFor({ id: "test.undo", title: "Undo", keybinding: "mod+z", run: () => {} }),
    ).toBe("mod+k");
  });
});

describe("keybinding overrides — reset", () => {
  it("per-binding reset falls back to the declared default", () => {
    setKeybindingOverride("test.undo", "mod+j");
    expect(isKeybindingOverridden("test.undo")).toBe(true);
    setKeybindingOverride("test.undo", null);
    expect(isKeybindingOverridden("test.undo")).toBe(false);
    expect(getKeybindingFor({ id: "test.undo", title: "Undo", keybinding: "mod+z", run: () => {} })).toBe("mod+z");
  });

  it("resetAllKeybindings clears every override", () => {
    setKeybindingOverride("test.undo", "mod+j");
    setKeybindingOverride("test.redo", "mod+y");
    expect(hasAnyKeybindingOverride()).toBe(true);
    resetAllKeybindings();
    expect(hasAnyKeybindingOverride()).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({});
  });
});

describe("findConflicts", () => {
  it("finds a command whose binding matches the chord, excluding self", () => {
    // Rebind redo onto undo's chord.
    setKeybindingOverride("test.redo", "mod+z");
    const hits = findConflicts("mod+z", "test.redo");
    expect(hits.map((c) => c.id)).toContain("test.undo");
    expect(hits.map((c) => c.id)).not.toContain("test.redo");
  });

  it("is modifier-order-insensitive", () => {
    // 'shift+mod+z' should collide with redo's 'mod+shift+z'.
    const hits = findConflicts("shift+mod+z", "test.undo");
    expect(hits.map((c) => c.id)).toContain("test.redo");
  });

  it("returns [] for an empty chord", () => {
    expect(findConflicts("", "test.undo")).toEqual([]);
  });

  it("conflictsForCommand reports the other side of a collision", () => {
    setKeybindingOverride("test.redo", "mod+z");
    expect(conflictsForCommand("test.redo").map((c) => c.id)).toContain("test.undo");
    expect(conflictsForCommand("test.undo").map((c) => c.id)).toContain("test.redo");
  });
});

describe("subscribeKeybindings", () => {
  it("notifies on set and reset", () => {
    const cb = vi.fn();
    const unsub = subscribeKeybindings(cb);
    setKeybindingOverride("test.undo", "mod+j");
    expect(cb).toHaveBeenCalledTimes(1);
    resetAllKeybindings();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setKeybindingOverride("test.undo", "mod+j");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// #1795 — scoped commands and alternate default chords
// ---------------------------------------------------------------------------

import {
  getKeybindingsFor,
  matchScopedCommand,
  installKeybindingDispatcher,
} from "../keybindings";
import { scopedCommand, setScopeHandler, listEnabledCommands, executeCommand } from "../registry";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("#1795 scoped commands", () => {
  let scoped: Array<() => void> = [];
  beforeEach(() => {
    scoped = [
      registerCommand(
        scopedCommand({
          id: "test.clip.delete",
          title: "Delete section",
          category: "Song timeline",
          keybinding: "delete",
          alternateKeybindings: ["backspace"],
          scope: "panelA",
        }),
      ),
      registerCommand(
        scopedCommand({ id: "test.clip.duplicate", title: "Duplicate section", keybinding: "mod+d", scope: "panelA" }),
      ),
      registerCommand(scopedCommand({ id: "test.other.delete", title: "Other delete", keybinding: "delete", scope: "panelB" })),
      registerCommand({ id: "test.global.b", title: "Toggle", keybinding: "mod+b", run: () => {} }),
    ];
  });
  afterEach(() => scoped.forEach((d) => d()));

  it("a command answers to its default AND its alternates", () => {
    const cmd = { id: "x", title: "x", keybinding: "delete", alternateKeybindings: ["backspace"], run: () => {} };
    expect(getKeybindingsFor(cmd)).toEqual(["delete", "backspace"]);
  });

  it("a rebind REPLACES the alternates rather than adding to them", () => {
    setKeybindingOverride("test.clip.delete", "x");
    expect(matchScopedCommand("panelA", key({ key: "x" }))?.id).toBe("test.clip.delete");
    expect(matchScopedCommand("panelA", key({ key: "Backspace" }))).toBeUndefined();
    expect(matchScopedCommand("panelA", key({ key: "Delete" }))).toBeUndefined();
  });

  it("matches only its own scope, exactly — a modified chord is not the plain one", () => {
    expect(matchScopedCommand("panelA", key({ key: "Backspace" }))?.id).toBe("test.clip.delete");
    expect(matchScopedCommand("panelA", key({ key: "d", metaKey: true }))?.id).toBe("test.clip.duplicate");
    // #1421: Shift+d IS 'D' — ⌘⇧D must not reach ⌘D.
    expect(matchScopedCommand("panelA", key({ key: "D", metaKey: true, shiftKey: true }))).toBeUndefined();
    // ⌘⇧Backspace (ripple) must not reach plain Backspace (#1460).
    expect(matchScopedCommand("panelA", key({ key: "Backspace", metaKey: true, shiftKey: true }))).toBeUndefined();
    expect(matchScopedCommand("panelB", key({ key: "Delete" }))?.id).toBe("test.other.delete");
    expect(matchScopedCommand("panelC", key({ key: "Delete" }))).toBeUndefined();
  });

  it("the global dispatcher never runs a scoped command, and still runs a global one", () => {
    const ran: string[] = [];
    const handler = { canRun: () => true, run: (id: string) => (ran.push(id), true) };
    const release = setScopeHandler("panelA", handler);
    const uninstall = installKeybindingDispatcher();
    const globalRan = vi.fn();
    const g = registerCommand({ id: "test.global.b", title: "Toggle", keybinding: "mod+b", run: globalRan });
    try {
      document.body.dispatchEvent(key({ key: "Delete" }))
      document.body.dispatchEvent(key({ key: "d", metaKey: true }))
      expect(ran).toEqual([]);
      document.body.dispatchEvent(key({ key: "b", metaKey: true }))
      expect(globalRan).toHaveBeenCalledTimes(1);
    } finally {
      g();
      uninstall();
      release();
    }
  });

  it("run and when go through the mounted panel's handler; nothing runs with no panel", () => {
    const ran: string[] = [];
    let applies = false;
    expect(executeCommand("test.clip.duplicate")).toBe(false); // no handler → when() false
    const release = setScopeHandler("panelA", {
      canRun: () => applies,
      run: (id) => (ran.push(id), true),
    });
    expect(listEnabledCommands().some((c) => c.id === "test.clip.duplicate")).toBe(false);
    applies = true;
    expect(listEnabledCommands().some((c) => c.id === "test.clip.duplicate")).toBe(true);
    expect(executeCommand("test.clip.duplicate")).toBe(true);
    expect(ran).toEqual(["test.clip.duplicate"]);
    release();
    expect(listEnabledCommands().some((c) => c.id === "test.clip.duplicate")).toBe(false);
  });

  it("a stale release does not remove a newer panel's handler", () => {
    const a = { canRun: () => true, run: () => true };
    const b = { canRun: () => true, run: () => true };
    const releaseA = setScopeHandler("panelA", a);
    const releaseB = setScopeHandler("panelA", b);
    releaseA();
    expect(listEnabledCommands().some((c) => c.id === "test.clip.duplicate")).toBe(true);
    releaseB();
  });

  it("conflicts: scoped vs global collide, same scope collides, different panels do not", () => {
    // Different panels, same key: no conflict.
    expect(conflictsForCommand("test.clip.delete").map((c) => c.id)).not.toContain("test.other.delete");
    // A panel chord rebound onto a global chord collides.
    setKeybindingOverride("test.clip.duplicate", "mod+b");
    expect(conflictsForCommand("test.clip.duplicate").map((c) => c.id)).toContain("test.global.b");
    expect(conflictsForCommand("test.global.b").map((c) => c.id)).toContain("test.clip.duplicate");
    // Same panel, same chord.
    setKeybindingOverride("test.clip.duplicate", "backspace");
    expect(conflictsForCommand("test.clip.duplicate").map((c) => c.id)).toContain("test.clip.delete");
    // An ALTERNATE chord is checked too, not only the first.
    expect(conflictsForCommand("test.clip.delete").map((c) => c.id)).toContain("test.clip.duplicate");
  });
});

// ---------------------------------------------------------------------------
// #1799 — one chord builder: ⌥-letters, ⇧-digits and ⌃ on a Mac
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("#1799 chords on a Mac, from real key presses", () => {
  let platform: { mockRestore(): void };
  let cleanup: Array<() => void> = [];
  beforeEach(() => {
    platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
  });
  afterEach(() => {
    cleanup.forEach((d) => d());
    cleanup = [];
    platform.mockRestore();
  });
  const scoped = (id: string, keybinding: string) =>
    cleanup.push(registerCommand(scopedCommand({ id, title: id, keybinding, scope: "panel1799" })));

  it("⌥K (key Dead) reaches alt+k; ⌥⌘K reaches mod+alt+k in Chromium and Firefox", () => {
    scoped("t.altk", "alt+k");
    scoped("t.stepinput", "mod+alt+k");
    expect(matchScopedCommand("panel1799", key({ key: "Dead", code: "KeyK", altKey: true }))?.id).toBe("t.altk");
    expect(matchScopedCommand("panel1799", key({ key: "Dead", code: "KeyK", altKey: true, metaKey: true }))?.id).toBe("t.stepinput");
    expect(matchScopedCommand("panel1799", key({ key: "˚", code: "KeyK", altKey: true, metaKey: true }))?.id).toBe("t.stepinput");
  });

  it("⇧3 (key #) reaches shift+3", () => {
    scoped("t.sharp", "shift+3");
    expect(matchScopedCommand("panel1799", key({ key: "#", code: "Digit3", shiftKey: true }))?.id).toBe("t.sharp");
  });

  it("⌃⌫ reaches ctrl+backspace and not mod+backspace; ⌘⌫ the reverse", () => {
    scoped("t.clearstep", "ctrl+backspace");
    scoped("t.cmdback", "mod+backspace");
    expect(matchScopedCommand("panel1799", key({ key: "Backspace", code: "Backspace", ctrlKey: true }))?.id).toBe("t.clearstep");
    expect(matchScopedCommand("panel1799", key({ key: "Backspace", code: "Backspace", metaKey: true }))?.id).toBe("t.cmdback");
  });

  it("⌘⌥Z reaches Zen's mod+alt+z in Firefox too (key \u2019)", () => {
    scoped("t.zen", "mod+alt+z");
    expect(matchScopedCommand("panel1799", key({ key: "\u2019", code: "KeyZ", metaKey: true, altKey: true }))?.id).toBe("t.zen");
  });

  it("Space reaches space", () => {
    scoped("t.space", "space");
    expect(matchScopedCommand("panel1799", key({ key: " ", code: "Space" }))?.id).toBe("t.space");
  });

  it("⌃⇧P does not run the palette; ⌘⇧P does", () => {
    const palette = vi.fn();
    cleanup.push(registerCommand({ id: "stave.palette.test1799", title: "p", keybinding: "mod+shift+p", run: palette }));
    const uninstall = installKeybindingDispatcher();
    cleanup.push(uninstall);
    document.body.dispatchEvent(key({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }));
    expect(palette).toHaveBeenCalledTimes(0);
    document.body.dispatchEvent(key({ key: "P", code: "KeyP", metaKey: true, shiftKey: true }));
    expect(palette).toHaveBeenCalledTimes(1);
  });
});

// Every chord the app declares today, with the key press a Mac sends for it
// (real OS keys, Chromium and Firefox, 2026-09-27). The rebuilt matcher must
// reach each one. ⌘⌥Z (Zen) never matched before #1799: its key arrives as
// "Dead" in Chromium and "’" in Firefox.
const DECLARED_CHORDS: Array<[string, KeyboardEventInit]> = [
  ["mod+shift+p", { key: "P", code: "KeyP", metaKey: true, shiftKey: true }],
  ["mod+shift+d", { key: "D", code: "KeyD", metaKey: true, shiftKey: true }],
  ["mod+n", { key: "n", code: "KeyN", metaKey: true }],
  ["mod+o", { key: "o", code: "KeyO", metaKey: true }],
  ["mod+z", { key: "z", code: "KeyZ", metaKey: true }],
  ["mod+shift+z", { key: "Z", code: "KeyZ", metaKey: true, shiftKey: true }],
  ["mod+b", { key: "b", code: "KeyB", metaKey: true }],
  ["mod+alt+z", { key: "Dead", code: "KeyZ", metaKey: true, altKey: true }],
  ["mod+=", { key: "=", code: "Equal", metaKey: true }],
  ["mod+-", { key: "-", code: "Minus", metaKey: true }],
  ["mod+\\", { key: "\\", code: "Backslash", metaKey: true }],
  ["mod+shift+\\", { key: "\\", code: "Backslash", metaKey: true, shiftKey: true }],
  ["mod+/", { key: "/", code: "Slash", metaKey: true }],
  ["mod+p", { key: "p", code: "KeyP", metaKey: true }],
  ["mod+shift+f", { key: "F", code: "KeyF", metaKey: true, shiftKey: true }],
  ["mod+d", { key: "d", code: "KeyD", metaKey: true }],
  ["s", { key: "s", code: "KeyS" }],
  ["delete", { key: "Delete", code: "Delete" }],
  ["backspace", { key: "Backspace", code: "Backspace" }],
  ["mod+shift+backspace", { key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true }],
  ["mod+shift+delete", { key: "Delete", code: "Delete", metaKey: true, shiftKey: true }],
  ["mod+i", { key: "i", code: "KeyI", metaKey: true }],
  ["f2", { key: "F2", code: "F2" }],
  ["enter", { key: "Enter", code: "Enter" }],
  ["p", { key: "p", code: "KeyP" }],
];

describe("#1799 every declared chord still matches its key press", () => {
  it("the table covers every chord literal the app declares", () => {
    const src = ["../../components/StaveApp.tsx", "../../components/musicalTimeline/clipGestures.ts"]
      .map((p) => readFileSync(resolve(__dirname, p), "utf8"))
      .join("\n");
    const declared = new Set<string>();
    for (const m of src.matchAll(/keybinding:\s*["']((?:\\.|[^"'])+)["']/g)) declared.add(m[1].replace(/\\\\/g, "\\"));
    for (const m of src.matchAll(/alternateKeybindings:\s*\[([^\]]*)\]/g)) {
      for (const a of m[1].matchAll(/["']([^"']+)["']/g)) declared.add(a[1]);
    }
    expect(declared.size).toBeGreaterThan(20);
    expect([...declared].sort()).toEqual(DECLARED_CHORDS.map(([c]) => c).sort());
  });

  it.each(DECLARED_CHORDS)("%s", (chord, init) => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const off = registerCommand(scopedCommand({ id: "t.table", title: "t", keybinding: chord, scope: "table1799" }));
    try {
      expect(matchScopedCommand("table1799", key(init))?.id).toBe("t.table");
    } finally {
      off();
      platform.mockRestore();
    }
  });
});
