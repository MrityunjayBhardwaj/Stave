// @vitest-environment jsdom
/**
 * #2000 — every menu item the desktop's menu bar offers is in the phone's drawer.
 *
 * Both draw `buildMenus`. This walks what each one actually RENDERS and compares it to
 * the list, so an item drawn by hand in one of them — or dropped by one of them — shows
 * here rather than on somebody's phone.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MenuBar } from "../MenuBar";
import { PhoneDrawer, PHONE_MENU_TAB } from "../PhoneDrawer";
import { buildMenus, flatItems, type MenuActions } from "../menuModel";

afterEach(cleanup);

function actions(over: Partial<MenuActions> = {}): MenuActions {
  const noop = () => undefined;
  return {
    onOpenEditorSettings: noop,
    onOpenShortcuts: noop,
    onNewProject: noop,
    onOpenProject: noop,
    recentProjects: [
      { id: "c", name: "Chorus idea", current: true },
      { id: "b", name: "Bassline", current: false },
    ],
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
    canRedo: false,
    ...over,
  };
}

/** what a rendered menu item says, less the shortcut drawn beside it */
const labelOf = (el: Element): string => (el.firstElementChild?.textContent ?? "").trim();
const isOpener = (el: Element): boolean => el.hasAttribute("aria-haspopup");

function menuBarLabels(a: MenuActions): string[] {
  const noop = () => undefined;
  const { container } = render(
    <MenuBar
      projectName="P"
      {...a}
      isPlaying={false}
      getSongPosition={() => null}
      getCps={() => null}
      getAudioHealth={() => null}
      evalError={null}
      onEvalLamp={noop}
    />,
  );
  const out: string[] = [];
  for (const menu of buildMenus(a)) {
    fireEvent.click(screen.getByRole("button", { name: menu.label }));
    // open every submenu this menu has, so its items are drawn too
    for (const opener of [...container.querySelectorAll("[data-stave-menu-item][aria-haspopup]")]) fireEvent.click(opener);
    for (const el of container.querySelectorAll("[data-stave-menu-item]")) if (!isOpener(el)) out.push(labelOf(el));
    fireEvent.click(screen.getByRole("button", { name: menu.label }));
  }
  cleanup();
  return out;
}

function renderDrawer(a: MenuActions, onClose = vi.fn()) {
  return render(
    <PhoneDrawer
      openOn={PHONE_MENU_TAB}
      projectName="P"
      onSelect={() => undefined}
      onClose={onClose}
      renderPanel={() => null}
      menus={buildMenus(a)}
      readout={null}
    />,
  );
}

describe("the menus are one list, drawn twice (#2000)", () => {
  it("the menu bar and the drawer both draw every item, in the list's order", () => {
    const a = actions();
    const want = flatItems(buildMenus(a)).map((i) => i.label);
    // a real list, with the submenu's items in it
    expect(want.length).toBeGreaterThan(15);
    expect(want).toContain("Bassline");

    expect(menuBarLabels(a)).toEqual(want);

    const { container } = renderDrawer(a);
    expect([...container.querySelectorAll("[data-stave-menu-item]")].map(labelOf)).toEqual(want);
  });

  it("greys the same items in both", () => {
    const a = actions({ canBounceToWav: () => false, canUndo: false });
    const off = flatItems(buildMenus(a)).filter((i) => i.disabled).map((i) => i.label);
    expect(off).toEqual(expect.arrayContaining(["Bounce to WAV...", "Undo", "Redo", "Chorus idea"]));

    const { container } = renderDrawer(a);
    const drawn = [...container.querySelectorAll("[data-stave-menu-item]")].filter((el) => (el as HTMLButtonElement).disabled).map(labelOf);
    expect(drawn).toEqual(off);
  });

  it("a drawer item closes the drawer and then does its work; a greyed one does neither", () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    const a = actions({
      onNewProject: () => order.push("new"),
      onOpenRecent: (id) => order.push(`recent:${id}`),
      canBounceToWav: () => false,
      onBounceToWav: () => order.push("bounce"),
    });
    const { container } = renderDrawer(a, onClose);
    const row = (label: string): HTMLElement =>
      [...container.querySelectorAll<HTMLElement>("[data-stave-menu-item]")].find((el) => labelOf(el) === label)!;

    fireEvent.click(row("New Project..."));
    fireEvent.click(row("Bassline"));
    fireEvent.click(row("Bounce to WAV..."));
    expect(order).toEqual(["close", "new", "close", "recent:b"]);
  });

  it("names its menus, and shows a note beside an item but not a keyboard shortcut", () => {
    const { container } = renderDrawer(actions());
    for (const id of ["file", "edit", "view", "help"]) expect(container.querySelector(`[data-phone-menu="${id}"]`)).not.toBeNull();
    const file = within(container.querySelector('[data-phone-menu="file"]') as HTMLElement);
    // "open now" is said; ⌘N is not — a phone has no ⌘
    expect(file.getByText("open now")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[⌘⇧]/);
  });
});
