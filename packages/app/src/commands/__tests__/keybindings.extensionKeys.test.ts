/**
 * #2513 — keys an extension declares, in the code.
 *
 * While a (test-only) extension is on and the cursor is in a code editor, a declared key
 * that is not handed back runs no Stave command. Handed back, it does. Outside the code,
 * and in the side-by-side diff (which no extension gets), it always does. A key the person
 * bound to a Stave command themselves wins over the extension. Play and Stop run the
 * editor's own action before any extension can swallow the key, unless the extension
 * declares that key and it is not handed back. The dispatcher is handed the extension
 * state, so nothing here loads an extension.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { ExtensionKeyInCode } from "@stave/editor";
import { registerCommand } from "../registry";
import { installKeybindingDispatcher, setKeybindingOverride } from "../keybindings";

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/**
 * Monaco's text input inside a code editor; `swallow` is an extension's key handler
 * inside Monaco, which takes every key and stops it, as monaco-vim does.
 */
function codeInput(opts: { offered?: boolean; swallow?: boolean } = {}): HTMLTextAreaElement {
  const view = document.createElement("div");
  if (opts.offered !== false) view.setAttribute("data-code-editor", "");
  const editor = document.createElement("div");
  editor.className = "monaco-editor";
  const input = document.createElement("textarea");
  editor.appendChild(input);
  view.appendChild(editor);
  document.body.appendChild(view);
  if (opts.swallow) {
    input.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
  return input;
}

let cleanup: Array<() => void> = [];
let platform: { mockRestore(): void };
let taken: ExtensionKeyInCode[];
let active: boolean;
let play: Mock<() => void>;
let stop: Mock<() => void>;
let redo: Mock<() => void>;
let sidebar: Mock<() => void>;

const key = (k: string, name = "Test"): ExtensionKeyInCode => ({ extensionId: "zzkeys", extensionName: "Keys test", key: k, name });

beforeEach(() => {
  platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
  taken = [];
  active = true;
  play = vi.fn<() => void>();
  stop = vi.fn<() => void>();
  redo = vi.fn<() => void>();
  sidebar = vi.fn<() => void>();
  // Ctrl+R is a Stave command here (on Windows `mod` is Ctrl), and the extension wants it
  cleanup.push(registerCommand({ id: "test2513.redo", title: "Redo", keybinding: "mod+r", run: redo }));
  cleanup.push(registerCommand({ id: "test2513.sidebar", title: "Sidebar", keybinding: "mod+b", run: sidebar }));
  const actions: Record<string, () => void> = { "stave.play": play, "stave.stop": stop };
  cleanup.push(
    installKeybindingDispatcher({
      extensionKeysInCode: () => taken,
      extensionsActive: () => active,
      codeEditorAt: (target) =>
        target.closest("[data-code-editor]") ? { getAction: (id: string) => (actions[id] ? { run: actions[id] } : null) } : null,
    }),
  );
});

afterEach(() => {
  cleanup.forEach((d) => d());
  cleanup = [];
  setKeybindingOverride("test2513.redo", null);
  setKeybindingOverride("test2513.sidebar", null);
  document.body.innerHTML = "";
  platform.mockRestore();
});

describe("a declared key in the code", () => {
  it("runs no Stave command while the extension takes it", () => {
    taken = [key("ctrl+r", "Redo")];
    const e = press(codeInput(), { key: "r", code: "KeyR", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(0);
    expect(e.defaultPrevented).toBe(false); // left for the extension inside the editor
  });

  it("handed back (no longer taken), it runs the Stave command as before", () => {
    taken = [];
    press(codeInput(), { key: "r", code: "KeyR", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("outside the code it always runs the Stave command", () => {
    taken = [key("ctrl+r")];
    press(document.body, { key: "r", code: "KeyR", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("in the side-by-side diff, which no extension gets, it runs the Stave command", () => {
    taken = [key("ctrl+r")];
    press(codeInput({ offered: false }), { key: "r", code: "KeyR", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("another key in the code is untouched", () => {
    taken = [key("ctrl+r")];
    press(codeInput(), { key: "b", code: "KeyB", ctrlKey: true });
    expect(sidebar).toHaveBeenCalledTimes(1);
  });

  it("the person's own rebind wins, even over an extension that swallows the key inside Monaco", () => {
    taken = [key("ctrl+r")];
    setKeybindingOverride("test2513.sidebar", "mod+r");
    const e = press(codeInput({ swallow: true }), { key: "r", code: "KeyR", ctrlKey: true });
    expect(sidebar).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    // the default command on that key does not run: the rebind took the keystroke
    expect(redo).toHaveBeenCalledTimes(0);
  });

  it("a rebind that can type text does not run from the code (the #2100 rule still holds)", () => {
    taken = [key("j")];
    setKeybindingOverride("test2513.sidebar", "j");
    press(codeInput(), { key: "j", code: "KeyJ" });
    expect(sidebar).toHaveBeenCalledTimes(0);
  });

  it("a Mac's Control key is not ⌘: an extension's ctrl+r leaves ⌘R to Stave", () => {
    platform.mockRestore();
    platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    taken = [key("ctrl+r")];
    press(codeInput(), { key: "r", code: "KeyR", metaKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    press(codeInput(), { key: "r", code: "KeyR", ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });
});

describe("Play and Stop with an extension on", () => {
  it("run the editor's own action before an extension that swallows every key", () => {
    const input = codeInput({ swallow: true });
    const e = press(input, { key: "Enter", code: "Enter", ctrlKey: true });
    press(input, { key: ".", code: "Period", ctrlKey: true });
    expect(play).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("go to the extension only when it declares the key and it is not handed back", () => {
    taken = [key("mod+enter", "Run in Vim")];
    press(codeInput({ swallow: true }), { key: "Enter", code: "Enter", ctrlKey: true });
    expect(play).toHaveBeenCalledTimes(0);
  });

  it("with no extension on, the dispatcher leaves them to the editor exactly as before", () => {
    active = false;
    const e = press(codeInput(), { key: "Enter", code: "Enter", ctrlKey: true });
    expect(play).toHaveBeenCalledTimes(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it("outside a code editor they are not run", () => {
    press(document.body, { key: "Enter", code: "Enter", ctrlKey: true });
    expect(play).toHaveBeenCalledTimes(0);
  });
});
