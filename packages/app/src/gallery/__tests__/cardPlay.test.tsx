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
  it("is a focusable button named for the entry, on every card", async () => {
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
