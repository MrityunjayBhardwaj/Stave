/**
 * #2491 — an entry's page: every action it had is still there, the code is
 * coloured text, and a project's files each play from their own row, one at a time.
 */
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntryPage, type EntryPageProps } from "../GalleryEntry";
import type { GalleryEntry, GalleryEntryResponse } from "../types";

afterEach(cleanup);

const ENTRY: GalleryEntry = {
  id: "proj1xxxxxx",
  title: "Dub Techno Starter",
  kind: "project",
  tags: ["dub", "techno"],
  authorName: "mira.k",
  authorId: "mira",
  publishedAt: Date.now() - 2 * 86400_000,
  fileCount: 3,
  hasThumbnail: false,
};

const MANIFEST: GalleryEntryResponse["manifest"] = {
  schemaVersion: 1,
  project: { name: "Dub Techno Starter", sharedAt: 1 },
  files: [
    { id: "f1", path: "main.strudel", language: "strudel", content: '// kick\nstack(s("bd*4"))' },
    { id: "f2", path: "bass.strudel", language: "strudel", content: 'note("c2")' },
    { id: "f3", path: "viz/bloom.hydra", language: "hydra", content: "osc(10).out()" },
    { id: "f4", path: "README.md", language: "markdown", content: "# hi" },
  ],
  fileOrder: {},
  subfolderOrder: {},
};

function renderPage(over: Partial<EntryPageProps> = {}) {
  const props: EntryPageProps = {
    detail: { status: "ready", id: ENTRY.id, data: { entry: ENTRY, manifest: MANIFEST } },
    busy: false,
    backLabel: null,
    onBack: vi.fn(),
    onHome: vi.fn(),
    onKind: vi.fn(),
    onAuthor: vi.fn(),
    onRetry: vi.fn(),
    onOpenAsProject: vi.fn(),
    onAddToProject: vi.fn(),
    onCopyLink: vi.fn(),
    onReport: vi.fn(),
    listed: [ENTRY, { ...ENTRY, id: "musc9xxxxxx", title: "Tape Hiss Loop", kind: "music" }, { ...ENTRY, id: "othr1xxxxxx", authorId: "else", title: "Not hers" }],
    onOpenEntry: vi.fn(),
    ...over,
  };
  render(<EntryPage {...props} />);
  return props;
}

const frames = () => document.querySelectorAll("[data-gallery-preview-frame]");
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe("EntryPage", () => {
  it("keeps every action: open, copy link, report; and the safety note", () => {
    const p = renderPage();
    fireEvent.click(screen.getByText("Open as new project"));
    expect(p.onOpenAsProject).toHaveBeenCalledWith(ENTRY, MANIFEST);
    fireEvent.click(screen.getByText("Copy link"));
    expect(p.onCopyLink).toHaveBeenCalledWith(ENTRY.id);
    fireEvent.click(screen.getByText("Report"));
    expect(p.onReport).toHaveBeenCalledWith(ENTRY);
    expect(document.querySelector("[data-gallery-safe-note]")!.textContent).toContain("Nothing from this entry has run");
    // a project is opened whole; music and visuals can also be added
    expect(screen.queryByText("Add to this project")).toBeNull();
  });

  it("music offers Add to this project", () => {
    const p = renderPage({
      detail: { status: "ready", id: "m", data: { entry: { ...ENTRY, kind: "music" }, manifest: { ...MANIFEST, files: [MANIFEST.files[0]] } } },
    });
    fireEvent.click(screen.getByText("Add to this project"));
    expect(p.onAddToProject).toHaveBeenCalled();
  });

  it("the code is coloured text with a line per line, and nothing in it runs", () => {
    renderPage();
    const pre = document.querySelector('[data-gallery-code="main.strudel"]')!;
    expect(pre.querySelectorAll(".sg-code-line")).toHaveLength(2);
    expect(pre.querySelector(".sg-tc")!.textContent).toBe("// kick");
    expect(pre.querySelector(".sg-tk")!.textContent).toBe("stack");
    expect(pre.querySelector(".sg-ts")!.textContent).toBe('"bd*4"');
    expect(pre.textContent).toBe('// kick\nstack(s("bd*4"))\n');
    expect(frames()).toHaveLength(0);
  });

  it("In this project: one row per file with what it is; the README has no play button", () => {
    renderPage();
    expect(document.querySelector(".sg-contents-head")!.textContent).toBe("In this project 2 patterns · 1 visual · 1 other file");
    const rows = Array.from(document.querySelectorAll("[data-gallery-file-row]")).map((r) => r.getAttribute("data-gallery-file-row"));
    expect(rows).toEqual(["main.strudel", "bass.strudel", "viz/bloom.hydra", "README.md"]);
    expect(document.querySelector('[data-gallery-file-play="README.md"]')).toBeNull();
    expect(document.querySelector('[data-gallery-file-play="bass.strudel"]')).not.toBeNull();
  });

  it("a row's play puts its file in the one preview and starts it; only one frame ever", async () => {
    renderPage();
    fireEvent.click(document.querySelector('[data-gallery-file-play="bass.strudel"]')!);
    await waitFor(() => expect(frames()).toHaveLength(1));
    expect(document.querySelector('[data-gallery-file-row="bass.strudel"]')!.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f2");
    expect(document.querySelector('[data-gallery-code="bass.strudel"]')).not.toBeNull();

    fireEvent.click(document.querySelector('[data-gallery-file-play="viz/bloom.hydra"]')!);
    await waitFor(() => expect(document.querySelector("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f3"));
    await waitFor(() => expect(frames()).toHaveLength(1));
    // the old file's frame went: a new one for the new code
    expect((frames()[0] as HTMLElement).closest("[data-gallery-preview]")!.getAttribute("data-gallery-preview")).toBe("proj1xxxxxx/f3");
  });

  it("choosing a file to read doesn't start it", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "bass.strudel" }));
    // long enough for a start (it opens on the next animation frame) to have landed
    await act(async () => {
      await nextFrame();
      await nextFrame();
    });
    expect(document.querySelector('[data-gallery-code="bass.strudel"]')).not.toBeNull();
    expect(frames()).toHaveLength(0);
  });

  it("the side column: title, artist, tags, details, and more by the same artist", () => {
    const p = renderPage();
    expect(document.querySelector(".sg-side-title")!.textContent).toBe("Dub Techno Starter");
    expect(document.querySelector(".sg-byline")!.textContent).toMatch(/mira\.kPublished 2 days ago/);
    expect(Array.from(document.querySelectorAll(".sg-side-tag")).map((t) => t.textContent)).toEqual(["dub", "techno"]);
    expect(document.querySelector(".sg-facts")!.textContent).toContain("Contains2 patterns, 1 visual, 1 other file");
    const more = Array.from(document.querySelectorAll("[data-gallery-more]")).map((m) => m.getAttribute("data-gallery-more"));
    expect(more).toEqual(["musc9xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-more="musc9xxxxxx"]')!);
    expect(p.onOpenEntry).toHaveBeenCalledWith("musc9xxxxxx");
  });

  it("the breadcrumb, with Back only when something else is under the entry", () => {
    const p = renderPage({ backLabel: "← Back" });
    fireEvent.click(screen.getByText("← Back"));
    expect(p.onBack).toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-gallery-crumb="kind"]')!);
    expect(p.onKind).toHaveBeenCalledWith("project");
    cleanup();
    renderPage();
    expect(screen.queryByText("← Back")).toBeNull();
  });
});
