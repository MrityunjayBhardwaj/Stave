// @vitest-environment jsdom
/**
 * #2020 — File → Open Recent, through the menu a user presses.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MenuBar } from "../MenuBar";
import type { RecentProjectEntry } from "../../recentProjects";

afterEach(cleanup);

function menu(recentProjects: RecentProjectEntry[], onOpenRecent = vi.fn()) {
  const noop = () => undefined;
  render(
    <MenuBar
      projectName="P"
      onOpenEditorSettings={noop}
      onOpenShortcuts={noop}
      onNewProject={noop}
      onOpenProject={noop}
      recentProjects={recentProjects}
      onOpenRecent={onOpenRecent}
      onOpenStartScreen={noop}
      onRenameProject={noop}
      onExportProject={noop}
      onBounceToWav={noop}
      canBounceToWav={() => false}
      onImportProject={noop}
      onShareProject={noop}
      onVersionHistory={noop}
      onToggleSidebar={noop}
      sidebarCollapsed={false}
      onToggleZenMode={noop}
      zenMode={false}
      onUndo={noop}
      onRedo={noop}
      canUndo={false}
      canRedo={false}
      isPlaying={false}
      getSongPosition={() => null}
      getCps={() => null}
      getAudioHealth={() => null}
      evalError={null}
      onEvalLamp={noop}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  fireEvent.click(screen.getByRole("button", { name: /Open Recent/ }));
  return onOpenRecent;
}

const RECENT: RecentProjectEntry[] = [
  { id: "c", name: "Chorus idea", current: true },
  { id: "b", name: "Bassline", current: false },
  { id: "a", name: "Ambient", current: false },
];

describe("MenuBar — Open Recent (#2020)", () => {
  it("lists the projects in the order given, under Open Recent", () => {
    menu(RECENT);
    const list = screen.getByRole("menu", { name: "Open Recent" });
    expect([...list.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Chorus ideaopen now",
      "Bassline",
      "Ambient",
    ]);
  });

  it("choosing a project asks to open that one, and closes the menu", () => {
    const onOpenRecent = menu(RECENT);
    fireEvent.click(screen.getByRole("button", { name: "Bassline" }));
    expect(onOpenRecent.mock.calls).toEqual([["b"]]);
    expect(screen.queryByRole("menu", { name: "Open Recent" })).toBeNull();
  });

  it("the project that is open now cannot be chosen", () => {
    const onOpenRecent = menu(RECENT);
    const current = screen.getByRole("button", { name: /Chorus idea/ }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    fireEvent.click(current);
    expect(onOpenRecent).not.toHaveBeenCalled();
  });

  it("with no other project, it says so", () => {
    menu([{ id: "c", name: "Chorus idea", current: true }]);
    const none = screen.getByRole("button", { name: "No other projects" }) as HTMLButtonElement;
    expect(none.disabled).toBe(true);
  });

  it("with another project, it does not say there are none", () => {
    menu(RECENT);
    expect(screen.queryByRole("button", { name: "No other projects" })).toBeNull();
  });
});
