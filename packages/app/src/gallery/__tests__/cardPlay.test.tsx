// @vitest-environment jsdom
/**
 * #2495 — a card's play button opens the entry with its preview starting; the
 * card's own click opens it without. The start is a one-off for that opening:
 * coming back to the entry, or opening it from its card, doesn't start it.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: vi.fn(async () => true),
  showPrompt: vi.fn(async () => null),
  showToast: vi.fn(),
}));

import { GalleryOverlay } from "../GalleryOverlay";
import { Card } from "../GalleryCards";
import { forgetGalleryRecordingsForTests } from "../client";
import type { GalleryEntry, GalleryEntryResponse } from "../types";

const E = (over: Partial<GalleryEntry>): GalleryEntry => ({
  id: "AAAAAAAAAAA",
  title: "t",
  kind: "project",
  tags: [],
  authorName: "a",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail: false,
  ...over,
});

const MUSIC = E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", authorName: "Alice", authorId: "alice", publishedAt: 2 });
// A project whose recorded cover is its SECOND file in the manifest.
const PROJ = E({ id: "proj1xxxxxx", title: "Dub Techno", kind: "project", authorName: "Bob", publishedAt: 3, fileCount: 2, hasRecording: true });
const LIST = [PROJ, MUSIC];

const entryOf = (entry: GalleryEntry, files: GalleryEntryResponse["manifest"]["files"]): GalleryEntryResponse => ({
  entry,
  manifest: { schemaVersion: 1, project: { name: entry.title, sharedAt: 1 }, files, fileOrder: {}, subfolderOrder: {} },
});
const ENTRIES: Record<string, GalleryEntryResponse> = {
  [MUSIC.id]: entryOf(MUSIC, [{ id: "f1", path: "break.strudel", language: "strudel", content: 's("bd sd")' }]),
  [PROJ.id]: entryOf(PROJ, [
    { id: "p1", path: "intro.strudel", language: "strudel", content: 's("hh*4")' },
    { id: "p2", path: "main.strudel", language: "strudel", content: 's("bd*4")' },
  ]),
};
const REC = {
  v: 1,
  cover: "main.strudel",
  contents: { patterns: 2, visuals: 0, other: 0 },
  files: [{ path: "main.strudel", span: "arranged", cycles: 4, lanes: [{ name: "bd" }], events: [[0, 0, 0.5, null]], sections: [] }],
};

function mockGallery() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/gallery") return Response.json({ entries: LIST });
      if (url === `/api/gallery/${PROJ.id}/recording`) return Response.json(REC);
      if (url === "/api/gallery/authors/alice")
        return Response.json({ author: { authorId: "alice", name: "Alice", bio: "", createdAt: 1, updatedAt: 1 }, entries: [MUSIC], collections: [] });
      const id = url.match(/^\/api\/gallery\/([^/]+)$/)?.[1];
      if (id && ENTRIES[id]) return Response.json(ENTRIES[id]);
      return new Response(null, { status: 404 });
    }),
  );
}

function renderGallery() {
  mockGallery();
  render(<GalleryOverlay open initialEntryId={null} onClose={vi.fn()} onOpenAsProject={vi.fn(async () => true)} onAddToProject={vi.fn(async () => true)} />);
}

const frame = () => document.querySelector("[data-gallery-preview-frame]");
const stage = () => document.querySelector("[data-gallery-preview]");
const previewState = () => document.querySelector("[data-gallery-preview-state]")?.getAttribute("data-gallery-preview-state");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetGalleryRecordingsForTests();
});

describe("a gallery card's play button (#2495)", () => {
  it("is a focusable button named for the entry, on every card with something to preview", async () => {
    renderGallery();
    const play = await screen.findByRole("button", { name: "Play Breakbeat" });
    expect(play.tagName).toBe("BUTTON");
    expect(play.tabIndex).toBe(0);
    play.focus();
    expect(document.activeElement).toBe(play);
    expect(screen.getByRole("button", { name: "Play Dub Techno" })).toBeTruthy();
  });

  it("opens the entry with its preview starting", async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole("button", { name: "Play Breakbeat" }));
    await screen.findByRole("heading", { name: "Breakbeat" });
    await waitFor(() => expect(frame(), "the preview opened its frame by itself").not.toBeNull());
    expect(document.querySelector("[data-gallery-preview-state]")?.textContent).toBe("Loading the preview…");
  });

  it("the card's own click opens the entry WITHOUT starting it", async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole("button", { name: "Breakbeat" }));
    await screen.findByRole("heading", { name: "Breakbeat" });
    await new Promise((r) => setTimeout(r, 50));
    expect(frame()).toBeNull();
    expect(previewState()).toBe("closed");

    // and a click on the card's body, not its title
    fireEvent.click(screen.getByRole("button", { name: /Gallery/ }));
    fireEvent.click(document.querySelector(`[data-gallery-card="${MUSIC.id}"] [data-gallery-card-picture]`)!);
    await screen.findByRole("heading", { name: "Breakbeat" });
    await new Promise((r) => setTimeout(r, 50));
    expect(frame()).toBeNull();
  });

  it("starts once: back to the grid and the card's click later doesn't start it again", async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole("button", { name: "Play Breakbeat" }));
    await waitFor(() => expect(frame()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Gallery/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Breakbeat" }));
    await screen.findByRole("heading", { name: "Breakbeat" });
    await new Promise((r) => setTimeout(r, 50));
    expect(frame()).toBeNull();
  });

  it("starts once: away to the artist and Back to the entry doesn't start it again", async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole("button", { name: "Play Breakbeat" }));
    await waitFor(() => expect(frame()).not.toBeNull());
    fireEvent.click(document.querySelector('[data-gallery-detail] [data-gallery-author-link="alice"]')!);
    await waitFor(() => expect(document.querySelector("[data-gallery-detail]")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    await screen.findByRole("heading", { name: "Breakbeat" });
    await new Promise((r) => setTimeout(r, 100));
    expect(frame()).toBeNull();
  });

  it("starts on the card's cover file, and never on the manifest's first file on the way", async () => {
    renderGallery();
    // the card has its record (the cover's timeline) before the click
    await waitFor(() =>
      expect(document.querySelector(`[data-gallery-card="${PROJ.id}"] [data-gallery-card-picture]`)?.getAttribute("data-gallery-card-picture")).toBe("timeline"),
    );
    // every file the stage holds, in order: a start on the first file and a
    // switch to the cover when the entry's own record arrives would show here
    const held: string[] = [];
    const seen = new MutationObserver(() => {
      const k = stage()?.getAttribute("data-gallery-preview");
      if (k && held[held.length - 1] !== k) held.push(k);
    });
    seen.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-gallery-preview"] });
    fireEvent.click(screen.getByRole("button", { name: "Play Dub Techno" }));
    await waitFor(() => expect(frame()).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    seen.disconnect();
    expect(stage()?.getAttribute("data-gallery-preview")).toBe(`${PROJ.id}/p2`);
    expect(held).toEqual([`${PROJ.id}/p2`]);
  });
});

/**
 * #2548 — the play button only where there is something to preview, judged from
 * the entry's publish record (what it holds) since the card has no files. With no
 * record the card can't tell, and keeps it.
 */
describe("a gallery card's play button shows only when there's something to preview (#2548)", () => {
  const rec = (contents: { patterns: number; visuals: number; other: number }, cover: string | null = null) => ({ v: 1, cover, contents, files: [] });
  const CASES = {
    notes: { entry: E({ id: "note1xxxxxx", title: "Liner Notes", kind: "project", fileCount: 2, hasRecording: true }), rec: rec({ patterns: 0, visuals: 0, other: 2 }) },
    sonic: { entry: E({ id: "soni1xxxxxx", title: "Ruby Loop", kind: "music", hasRecording: true }), rec: rec({ patterns: 0, visuals: 0, other: 1 }, "loop.rb") },
    patterns: { entry: E({ id: "patt1xxxxxx", title: "Two Grooves", kind: "project", fileCount: 3, hasRecording: true }), rec: rec({ patterns: 2, visuals: 0, other: 1 }) },
    visualProject: { entry: E({ id: "visp1xxxxxx", title: "Light Show", kind: "project", fileCount: 2, hasRecording: true }), rec: rec({ patterns: 0, visuals: 1, other: 1 }) },
    music: { entry: E({ id: "musr1xxxxxx", title: "House", kind: "music", hasRecording: true }), rec: rec({ patterns: 1, visuals: 0, other: 0 }, "house.strudel") },
    viz: { entry: E({ id: "vizr1xxxxxx", title: "Bloom", kind: "viz", hasRecording: true }), rec: rec({ patterns: 0, visuals: 1, other: 0 }, "bloom.hydra") },
  } as const;

  /** Render one card; resolves once its record (when it has one) has been read and drawn. */
  async function renderCard(entry: GalleryEntry, record: unknown | null) {
    const served = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `/api/gallery/${entry.id}/recording` && record) {
          served();
          return Response.json(record);
        }
        return new Response(null, { status: 404 });
      }),
    );
    render(<Card entry={entry} onOpen={vi.fn()} onPlay={vi.fn()} />);
    if (entry.hasRecording) await waitFor(() => expect(served).toHaveBeenCalled());
    // the record's json() and the card's re-render
    await new Promise((r) => setTimeout(r, 30));
  }
  const play = (id: string) => document.querySelector(`[data-gallery-card-play="${id}"]`);

  it("a project whose record counts no pattern and no visual has no play button", async () => {
    const { entry, rec: r } = CASES.notes;
    await renderCard(entry, r);
    expect(document.querySelector("[data-gallery-card-count]")?.textContent, "the record arrived").toBe("2 other files");
    expect(play(entry.id)).toBeNull();
  });

  it("a music entry that is a Sonic Pi file (counted as other: the preview can't play it) has none either", async () => {
    const { entry, rec: r } = CASES.sonic;
    await renderCard(entry, r);
    expect(play(entry.id)).toBeNull();
  });

  it("a project with a pattern keeps it", async () => {
    const { entry, rec: r } = CASES.patterns;
    await renderCard(entry, r);
    expect(document.querySelector("[data-gallery-card-count]")?.textContent).toBe("2 patterns · 1 other file");
    expect(play(entry.id)).not.toBeNull();
  });

  it("a project with only a visual keeps it", async () => {
    const { entry, rec: r } = CASES.visualProject;
    await renderCard(entry, r);
    expect(document.querySelector("[data-gallery-card-count]")?.textContent).toBe("1 visual · 1 other file");
    expect(play(entry.id)).not.toBeNull();
  });

  it("a music card and a visual card, with their records, keep it", async () => {
    await renderCard(CASES.music.entry, CASES.music.rec);
    expect(play(CASES.music.entry.id)).not.toBeNull();
    cleanup();
    forgetGalleryRecordingsForTests();
    await renderCard(CASES.viz.entry, CASES.viz.rec);
    expect(play(CASES.viz.entry.id)).not.toBeNull();
  });

  it("an entry with no record (published before recording) keeps it", async () => {
    const entry = E({ id: "old01xxxxxx", title: "Old Song", kind: "project", fileCount: 2 });
    await renderCard(entry, null);
    expect(play(entry.id)).not.toBeNull();
  });

  it("an entry whose record can't be fetched keeps it: the card can't tell", async () => {
    const entry = E({ id: "lost1xxxxxx", title: "Lost Record", kind: "project", fileCount: 2, hasRecording: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    render(<Card entry={entry} onOpen={vi.fn()} onPlay={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(play(entry.id)).not.toBeNull();
  });

  it("CONTROL: a card with no onPlay still has none, whatever it holds", async () => {
    const { entry, rec: r } = CASES.patterns;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(r)));
    render(<Card entry={entry} onOpen={vi.fn()} />);
    await new Promise((r2) => setTimeout(r2, 30));
    expect(play(entry.id)).toBeNull();
  });
});

