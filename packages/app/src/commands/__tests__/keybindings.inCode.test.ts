/**
 * #2100 — an app shortcut runs while the cursor is in the code, when the editor
 * doesn't use that key and the keystroke can't type text.
 *
 * In the browser, a key Monaco uses (⌘Z, ⌘/, ⌘D …) is handled and stopped inside
 * the editor and never reaches the window dispatcher, so the dispatcher only has
 * to decide for the keys that do arrive. Each case below pairs a keystroke that
 * must run with the closest one that must not.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { registerCommand } from "../registry";
import { installKeybindingDispatcher } from "../keybindings";

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } satisfies Storage,
});

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** The code editor's text input, as Monaco mounts it. */
function codeInput(): HTMLTextAreaElement {
  const editor = document.createElement("div");
  editor.className = "monaco-editor";
  const input = document.createElement("textarea");
  input.className = "inputarea";
  editor.appendChild(input);
  document.body.appendChild(editor);
  return input;
}

/** Monaco's own Find box: a text field inside the editor. */
function findInput(): HTMLTextAreaElement {
  const editor = document.createElement("div");
  editor.className = "monaco-editor";
  const widget = document.createElement("div");
  widget.className = "find-widget";
  const input = document.createElement("textarea");
  widget.appendChild(input);
  editor.appendChild(widget);
  document.body.appendChild(editor);
  return input;
}

/** A plain text field elsewhere in the app, like a rename box. */
function renameInput(): HTMLInputElement {
  const input = document.createElement("input");
  document.body.appendChild(input);
  return input;
}

let cleanup: Array<() => void> = [];
let platform: { mockRestore(): void };
const onPlatform = (p: string) => {
  platform?.mockRestore();
  platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue(p);
};

let sidebar: Mock<[], void>;
let zen: Mock<[], void>;
let palette: Mock<[], void>;

beforeEach(() => {
  onPlatform("MacIntel");
  sidebar = vi.fn<[], void>();
  zen = vi.fn<[], void>();
  palette = vi.fn<[], void>();
  cleanup.push(registerCommand({ id: "test2100.sidebar", title: "Sidebar", keybinding: "mod+b", run: sidebar }));
  cleanup.push(registerCommand({ id: "test2100.zen", title: "Zen", keybinding: "mod+alt+z", run: zen }));
  cleanup.push(registerCommand({ id: "stave.palette.test2100", title: "Palette", keybinding: "mod+shift+p", run: palette }));
  cleanup.push(installKeybindingDispatcher());
});

afterEach(() => {
  cleanup.forEach((d) => d());
  cleanup = [];
  document.body.innerHTML = "";
  platform.mockRestore();
});

describe("on a Mac", () => {
  it("⌘B runs from the code, and the keystroke is taken", () => {
    const e = press(codeInput(), { key: "b", code: "KeyB", metaKey: true });
    expect(sidebar).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("⌘B does not run from a rename box or from the editor's Find box", () => {
    press(renameInput(), { key: "b", code: "KeyB", metaKey: true });
    press(findInput(), { key: "b", code: "KeyB", metaKey: true });
    expect(sidebar).toHaveBeenCalledTimes(0);
  });

  it("a keystroke the editor already handled does not run an app command", () => {
    const input = codeInput();
    input.addEventListener("keydown", (e) => e.preventDefault()); // the editor took it
    press(input, { key: "b", code: "KeyB", metaKey: true });
    expect(sidebar).toHaveBeenCalledTimes(0);
  });

  it("⌘⌥Z runs Zen from the code (⌘ held, so nothing is typed)", () => {
    press(codeInput(), { key: "Dead", code: "KeyZ", metaKey: true, altKey: true });
    expect(zen).toHaveBeenCalledTimes(1);
  });

  it("a chord without ⌘ does not run from the code: ⌥K types ˚", () => {
    const option = vi.fn<[], void>();
    cleanup.push(registerCommand({ id: "test2100.option", title: "Option", keybinding: "alt+k", run: option }));
    press(codeInput(), { key: "˚", code: "KeyK", altKey: true });
    expect(option).toHaveBeenCalledTimes(0);
    press(document.body, { key: "˚", code: "KeyK", altKey: true });
    expect(option).toHaveBeenCalledTimes(1);
  });

  it("the palette still runs from a rename box", () => {
    press(renameInput(), { key: "P", code: "KeyP", metaKey: true, shiftKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });
});

describe("on Windows and Linux", () => {
  beforeEach(() => onPlatform("Win32"));

  it("Ctrl+B runs from the code", () => {
    press(codeInput(), { key: "b", code: "KeyB", ctrlKey: true });
    expect(sidebar).toHaveBeenCalledTimes(1);
  });

  it("AltGr+Z (Ctrl+Alt, types ż on Polish Programmers) does not run Zen from the code", () => {
    const e = press(codeInput(), { key: "ż", code: "KeyZ", ctrlKey: true, altKey: true });
    expect(zen).toHaveBeenCalledTimes(0);
    expect(e.defaultPrevented).toBe(false); // the ż reaches the editor
  });

  it("Ctrl+Alt+Z still runs Zen away from the code, where nothing is typed", () => {
    press(document.body, { key: "z", code: "KeyZ", ctrlKey: true, altKey: true });
    expect(zen).toHaveBeenCalledTimes(1);
  });
});
