import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ProjectMeta } from "@stave/editor";
import { TemplateModal } from "../TemplateModal";
import { StartScreen } from "../StartScreen";
import { TEMPLATES } from "../../templates";

/**
 * #2076: a template shows the logos of the files it creates, the same logos
 * the file tree shows (#2074), instead of an emoji or a generic "new" mark.
 */

afterEach(cleanup);

const EMOJI = /\p{Extended_Pictographic}/u;
const logosIn = (el: Element) =>
  [...el.querySelectorAll("img")].map((i) => i.getAttribute("src")!.replace(/^.*\//, ""));

function cardFor(name: string): Element {
  const card = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(name));
  expect(card, name).toBeDefined();
  return card!;
}

describe("template icons (#2076)", () => {
  it("the New Project cards show the logos of the files each template creates", () => {
    render(<TemplateModal open onClose={() => {}} onCreate={() => {}} />);
    expect(logosIn(cardFor("Starter"))).toEqual(["strudel.svg", "p5.svg", "hydra.svg"]);
    expect(logosIn(cardFor("Strudel Sketch"))).toEqual(["strudel.svg"]);
    expect(logosIn(cardFor("Full Song"))).toEqual(["strudel.svg"]);
    expect(logosIn(cardFor("Hydra Visual"))).toEqual(["hydra.svg"]);
    // Blank creates nothing of its own: a plain page, drawn, no logo.
    expect(logosIn(cardFor("Blank"))).toEqual([]);
    expect(cardFor("Blank").querySelector("svg")).not.toBeNull();
    for (const t of TEMPLATES) expect(cardFor(t.name).textContent, t.name).not.toMatch(EMOJI);
  });

  it("the start screen's New project list shows the same logos", () => {
    const project = { id: "c", name: "Chorus idea", createdAt: 0, lastOpenedAt: 0 } as ProjectMeta;
    render(
      <StartScreen
        open version="9.9.9" activeProject={project} projects={[project]} templates={TEMPLATES}
        showAtStart onClose={vi.fn()} onOpenProject={vi.fn()} onNewFromTemplate={vi.fn()}
        onOpenArchive={vi.fn()} onBrowseProjects={vi.fn()} onShowAtStartChange={vi.fn()}
      />,
    );
    const rows = [...document.querySelectorAll('[data-start-screen="template"]')];
    expect(rows.map((r) => r.textContent)).toEqual(TEMPLATES.map((t) => t.name));
    expect(logosIn(rows[0])).toEqual(["strudel.svg", "p5.svg", "hydra.svg"]);
    expect(logosIn(rows[TEMPLATES.findIndex((t) => t.id === "hydra")])).toEqual(["hydra.svg"]);
  });
});
