/**
 * #2097 — a shortcut the menu shows is the one that runs the command.
 *
 * The menu's shortcut labels are written by hand, apart from the bindings the commands
 * register in StaveApp. View › Zen Mode said "⌘K Z" while Zen was bound to mod+alt+z,
 * so anyone following the menu pressed keys that did nothing. Each row below is a menu
 * item and the chord its command registers; the label must be that chord, formatted the
 * way the Keyboard Shortcuts panel formats it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildMenus, flatItems, type MenuActions } from "../menuModel";
import { formatKeybinding } from "../../commands/keybindings";

afterEach(() => {
  vi.restoreAllMocks();
});

function actions(over: Partial<MenuActions> = {}): MenuActions {
  const noop = () => undefined;
  return {
    onOpenEditorSettings: noop,
    onOpenShortcuts: noop,
    onNewProject: noop,
    onOpenProject: noop,
    recentProjects: [],
    onOpenRecent: noop,
    onOpenStartScreen: noop,
    onRenameProject: noop,
    onExportProject: noop,
    onBounceToWav: noop,
    canBounceToWav: () => true,
    onImportProject: noop,
    onShareProject: noop,
    onVersionHistory: noop,
    onToggleSidebar: noop,
    sidebarCollapsed: false,
    onToggleZenMode: noop,
    zenMode: false,
    onUndo: noop,
    onRedo: noop,
    canUndo: true,
    canRedo: true,
    ...over,
  };
}

// menu label → the chord its command registers in StaveApp's registerCommand calls
const BOUND: ReadonlyArray<readonly [string, string]> = [
  ["New Project...", "mod+n"],
  ["Open Project...", "mod+o"],
  ["Undo", "mod+z"],
  ["Redo", "mod+shift+z"],
  ["Hide Sidebar", "mod+b"],
  ["Zen Mode (Fullscreen)", "mod+alt+z"],
];

describe("menu shortcut labels", () => {
  it.each(BOUND)("%s shows the chord its command is bound to (%s)", (label, chord) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const entry = flatItems(buildMenus(actions())).find((i) => i.label === label);
    expect(entry, `no menu item called "${label}"`).toBeDefined();
    expect(entry!.shortcut).toBe(formatKeybinding(chord));
  });

  it("Exit Zen Mode keeps the same shortcut", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const entry = flatItems(buildMenus(actions({ zenMode: true }))).find((i) => i.label === "Exit Zen Mode");
    expect(entry!.shortcut).toBe(formatKeybinding("mod+alt+z"));
  });
});
