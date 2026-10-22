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

const TEMPLATE_LIST = [
  { id: "starter", name: "Starter", description: "d", icon: "x", files: [] },
  { id: "song", name: "Full Song", description: "d", icon: "x", files: [] },
];

function props() {
  return {
    onClose: vi.fn(), onOpenProject: vi.fn(), onNewFromTemplate: vi.fn(),
    onOpenArchive: vi.fn(), onBrowseProjects: vi.fn(), onShowAtStartChange: vi.fn(),
  };
}

function show(over: Partial<React.ComponentProps<typeof StartScreen>> = {}) {
  const calls = props();
  render(
    <StartScreen
      open
      version="9.9.9"
      activeProject={CURRENT}
      projects={[CURRENT, ...OTHERS]}
      templates={TEMPLATE_LIST}
      showAtStart
      {...calls}
      {...over}
    />,
  );
  return calls;
}

/** a browser that is, or is not, isolated from other origins and able to frame without credentials */
function browser(isolated: boolean, credentiallessFrames: boolean) {
  vi.stubGlobal("crossOriginIsolated", isolated);
  if (credentiallessFrames) (HTMLIFrameElement.prototype as unknown as { credentialless: boolean }).credentialless = false;
  else delete (HTMLIFrameElement.prototype as unknown as { credentialless?: boolean }).credentialless;
}

const rows = () =>
  [...document.querySelectorAll('[data-start-screen="continue"], [data-start-screen="project"]')].map(
    (r) => r.textContent,
  );

describe("StartScreen (#2019)", () => {
  it("draws nothing when closed", () => {
    const { container } = render(
      <StartScreen
        open={false} version="9.9.9" activeProject={CURRENT} projects={[CURRENT]} templates={TEMPLATE_LIST}
        showAtStart {...props()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists the open project first, to continue, then the others in order", () => {
    show();
    expect(rows()).toEqual(["Chorus ideacontinue", "Basslinejust now", "Ambientjust now"]);
  });

  it("Continue is there before the project list has loaded", () => {
    show({ projects: [] });
    expect(rows()).toEqual(["Chorus ideacontinue"]);
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

  it("the links are the documentation and the source, and the film is not among them (#2048)", () => {
    show();
    // the film is the picture at the top, with its own Play: a link to it below was a second way to the same place
    const links = [...document.querySelectorAll('[data-start-screen="root"] a')] as HTMLAnchorElement[];
    expect(links.map((l) => l.textContent)).toEqual(["Documentation", "Source on GitHub"]);
    expect(links.filter((l) => /youtube/i.test(l.href))).toEqual([]);
    expect(document.querySelector('[data-start-screen="play"]')).not.toBeNull();
  });

  it("each template starts a new project from that template", () => {
    const c = show();
    expect([...document.querySelectorAll('[data-start-screen="template"]')].map((t) => t.textContent)).toEqual(["Starter", "Full Song"]);
    fireEvent.click(screen.getByRole("button", { name: "Full Song" }));
    expect(c.onNewFromTemplate.mock.calls).toEqual([[TEMPLATE_LIST[1]]]);
  });

  it("Open… and Open a project archive… each ask for their own thing", () => {
    const c = show();
    fireEvent.click(screen.getByRole("button", { name: "Open…" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a project archive…" }));
    expect(c.onBrowseProjects).toHaveBeenCalledTimes(1);
    expect(c.onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it("shows the version it was given", () => {
    show();
    expect(screen.getByText("v9.9.9")).toBeTruthy();
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
    // limit rows = the open project + (limit - 1) others, so (limit + 2) - (limit - 1) = 3 are left over
    fireEvent.click(screen.getByRole("button", { name: "3 more projects…" }));
    expect(c.onBrowseProjects).toHaveBeenCalledTimes(1);
  });

  it("with nothing left over there is no such link", () => {
    show();
    expect(screen.queryByRole("button", { name: /more project/ })).toBeNull();
  });
});

describe("StartScreen — the intro film (#2019)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLIFrameElement.prototype as unknown as { credentialless?: boolean }).credentialless;
  });

  const film = () => document.querySelector('[data-start-screen="film"]') as HTMLIFrameElement | null;
  const press = () => fireEvent.click(screen.getByRole("button", { name: /Watch the intro/ }));

  it("nothing is loaded from YouTube until Play is pressed", () => {
    browser(false, false);
    show();
    expect(film()).toBeNull();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/start/introducing-stave.jpg");
  });

  it("a page not isolated from other origins plays it in place", () => {
    browser(false, false);
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    show();
    press();
    expect(film()?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/LoVfu-FCTAg?autoplay=1&rel=0");
    expect(opened).not.toHaveBeenCalled();
  });

  it("an isolated page that can frame without credentials plays it in place, without credentials", () => {
    browser(true, true);
    show();
    press();
    expect(film()?.hasAttribute("credentialless")).toBe(true);
  });

  it("an isolated page that cannot opens it on YouTube instead of showing a blank frame", () => {
    browser(true, false);
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    show();
    press();
    expect(film()).toBeNull();
    expect(opened.mock.calls[0][0]).toBe("https://www.youtube.com/watch?v=LoVfu-FCTAg");
  });
});
