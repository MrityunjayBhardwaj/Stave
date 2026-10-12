// @vitest-environment jsdom
/**
 * #2019 — the start screen, through what a person sees and presses.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ProjectMeta } from "@stave/editor";
import { StartScreen } from "../StartScreen";
import { START_SCREEN_RECENT_LIMIT } from "../../startScreen";

afterEach(cleanup);

const project = (id: string, name: string, lastOpenedAt = Date.now()): ProjectMeta =>
  ({ id, name, createdAt: 0, lastOpenedAt }) as ProjectMeta;

const CURRENT = project("c", "Chorus idea");
const OTHERS = [project("b", "Bassline"), project("a", "Ambient")];

function show(over: Partial<React.ComponentProps<typeof StartScreen>> = {}) {
  const calls = {
    onClose: vi.fn(), onOpenProject: vi.fn(), onNewProject: vi.fn(),
    onOpenArchive: vi.fn(), onBrowseProjects: vi.fn(), onShowAtStartChange: vi.fn(),
  };
  render(
    <StartScreen
      open
      activeProject={CURRENT}
      projects={[CURRENT, ...OTHERS]}
      showAtStart
      {...calls}
      {...over}
    />,
  );
  return calls;
}

const rows = () =>
  [...document.querySelectorAll('[data-start-screen="continue"], [data-start-screen="project"]')].map(
    (r) => r.textContent,
  );

describe("StartScreen (#2019)", () => {
  it("draws nothing when closed", () => {
    const { container } = render(
      <StartScreen
        open={false} activeProject={CURRENT} projects={[CURRENT]} showAtStart
        onShowAtStartChange={() => undefined} onClose={() => undefined} onOpenProject={() => undefined}
        onNewProject={() => undefined} onOpenArchive={() => undefined} onBrowseProjects={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists the open project first as Continue, then the others in order", () => {
    show();
    expect(rows()).toEqual(["Chorus ideaopened just nowContinue", "Basslineopened just now", "Ambientopened just now"]);
  });

  it("Continue is there before the project list has loaded", () => {
    show({ projects: [] });
    expect(rows()).toEqual(["Chorus ideaopened just nowContinue"]);
  });

  it("Continue closes the screen and switches nothing", () => {
    const c = show();
    fireEvent.click(screen.getByRole("button", { name: /Chorus idea/ }));
    expect(c.onClose).toHaveBeenCalledTimes(1);
    expect(c.onOpenProject).not.toHaveBeenCalled();
  });

  it("another project asks to open that one", () => {
    const c = show();
    fireEvent.click(screen.getByRole("button", { name: /Bassline/ }));
    expect(c.onOpenProject.mock.calls).toEqual([["b"]]);
  });

  it("New project and Open a project archive each ask for their own thing", () => {
    const c = show();
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open a project archive/ }));
    expect(c.onNewProject).toHaveBeenCalledTimes(1);
    expect(c.onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it("Escape, the close button and a click outside each close it; a click inside does not", () => {
    const c = show();
    fireEvent.click(screen.getByRole("dialog"));
    expect(c.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(document.querySelector('[data-start-screen="backdrop"]')!);
    expect(c.onClose).toHaveBeenCalledTimes(3);
  });

  it("the checkbox shows the remembered choice and reports a change", () => {
    const c = show({ showAtStart: true });
    const box = screen.getByRole("checkbox", { name: /Show this when Stave starts/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(c.onShowAtStartChange.mock.calls).toEqual([[false]]);
  });

  it("past the limit, the rest are one link to the full list", () => {
    const many = Array.from({ length: START_SCREEN_RECENT_LIMIT + 2 }, (_, i) => project(`p${i}`, `Project ${i}`));
    const c = show({ projects: [CURRENT, ...many] });
    expect(rows()).toHaveLength(START_SCREEN_RECENT_LIMIT);
    // limit rows = Continue + (limit - 1) others, so (limit + 2) - (limit - 1) = 3 are left over
    fireEvent.click(screen.getByRole("button", { name: "3 more projects…" }));
    expect(c.onBrowseProjects).toHaveBeenCalledTimes(1);
  });

  it("with nothing left over there is no such link", () => {
    show();
    expect(screen.queryByRole("button", { name: /more project/ })).toBeNull();
  });
});
