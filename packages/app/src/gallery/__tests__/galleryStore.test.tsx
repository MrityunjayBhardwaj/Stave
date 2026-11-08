// @vitest-environment jsdom
/**
 * #2472 — the gallery keeps your place when its view is unmounted (a tab you
 * switched away from), and a fresh open still fetches what it fetched before.
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

import { GalleryView } from "../GalleryView";
import { GalleryOverlay } from "../GalleryOverlay";
import { createGalleryStore, scrollKey } from "../galleryStore";
import { addLocalShare } from "../localShares";
import type { AuthorPageResponse, GalleryEntry, GalleryEntryResponse } from "../types";

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

const LIST: GalleryEntry[] = [
  E({ id: "proj1xxxxxx", title: "Dub Techno", kind: "project", authorName: "Alice" }),
  E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", authorName: "Alice", authorId: "alice" }),
  E({ id: "musc2xxxxxx", title: "Jungle", kind: "music", authorName: "Bob" }),
];

const ENTRY: GalleryEntryResponse = {
  entry: LIST[1],
  manifest: {
    schemaVersion: 1,
    project: { name: "Breakbeat", sharedAt: 1 },
    files: [{ id: "f1", path: "break.strudel", language: "strudel", content: 's("bd sd")' }],
    fileOrder: {},
    subfolderOrder: {},
  },
};

const AUTHOR: AuthorPageResponse = {
  author: { authorId: "alice", name: "Alice", bio: "", createdAt: 1, updatedAt: 1 },
  entries: [LIST[1]],
  collections: [],
};

function mockGallery() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key === "GET /api/gallery") return Response.json({ entries: LIST });
    if (key === `GET /api/gallery/${ENTRY.entry.id}`) return Response.json(ENTRY);
    if (key === "GET /api/gallery/authors/alice") return Response.json(AUTHOR);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (f: ReturnType<typeof mockGallery>, url: string) => f.mock.calls.filter(([u]) => u === url).length;
const cards = () =>
  Array.from(document.querySelectorAll("[data-gallery-card]")).map((el) => el.getAttribute("data-gallery-card"));
const selectedFilter = () =>
  document.querySelector('[data-gallery-filter][aria-checked="true"]')?.getAttribute("data-gallery-filter");
const noop = vi.fn(async () => true);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("gallery store", () => {
  it("keeps the chosen filter, the view and the Back stack across an unmount and remount", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    store.open(null);
    const view = () => <GalleryView store={store} onOpenAsProject={noop} onAddToProject={noop} />;

    const first = render(view());
    await waitFor(() => expect(cards()).toContain("proj1xxxxxx"));
    fireEvent.click(document.querySelector('[data-gallery-filter="music"]')!);
    fireEvent.click(document.querySelector('[data-gallery-card="musc1xxxxxx"]')!);
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-gallery-detail] [data-gallery-author-link="alice"]')!);
    await waitFor(() => expect(document.querySelector('[data-gallery-profile="alice"]')).toBeTruthy());

    first.unmount();
    expect(document.querySelector("[data-gallery-view]")).toBeNull();

    render(view());
    // Drawn again on the profile, two deep, without fetching the list again.
    await waitFor(() => expect(document.querySelector('[data-gallery-profile="alice"]')).toBeTruthy());
    expect(screen.getByText("← Back")).toBeTruthy();
    expect(calls(fetchMock, "/api/gallery")).toBe(1);

    fireEvent.click(screen.getByText("← Back"));
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    fireEvent.click(screen.getByText("← Back to the gallery"));
    expect(selectedFilter()).toBe("music");
    expect(cards()).toEqual(["musc1xxxxxx", "musc2xxxxxx"]);
    expect(calls(fetchMock, "/api/gallery")).toBe(1);
  });

  it("puts the scroll back when the same view is drawn again, and forgets it on navigation", async () => {
    mockGallery();
    const store = createGalleryStore();
    store.open(null);
    const view = () => <GalleryView store={store} onOpenAsProject={noop} onAddToProject={noop} />;
    const first = render(view());
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    const body = document.querySelector(".sg-body") as HTMLElement;
    body.scrollTop = 240;
    fireEvent.scroll(body);
    expect(store.savedScroll()).toEqual({ key: scrollKey([]), top: 240 });
    first.unmount();

    // jsdom lays nothing out: give the new body room to scroll so the restore can land.
    const proto = HTMLElement.prototype;
    const sh = vi.spyOn(proto, "scrollHeight", "get").mockReturnValue(2000);
    try {
      render(view());
      expect((document.querySelector(".sg-body") as HTMLElement).scrollTop).toBe(240);
    } finally {
      sh.mockRestore();
    }
    store.push({ kind: "entry", id: "musc1xxxxxx" });
    expect(store.savedScroll()).toBeNull();
  });

  it("reopening the overlay starts at the top, as it always did", async () => {
    mockGallery();
    const store = createGalleryStore();
    const props = { initialEntryId: null, onClose: vi.fn(), onOpenAsProject: noop, onAddToProject: noop, store };
    const r = render(<GalleryOverlay open {...props} />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    const body = document.querySelector(".sg-body") as HTMLElement;
    body.scrollTop = 240;
    fireEvent.scroll(body);
    expect(store.savedScroll()?.top).toBe(240);
    r.rerender(<GalleryOverlay open={false} {...props} />);
    const sh = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
    try {
      r.rerender(<GalleryOverlay open {...props} />);
      expect((document.querySelector(".sg-body") as HTMLElement).scrollTop).toBe(0);
      expect(store.savedScroll()).toBeNull();
    } finally {
      sh.mockRestore();
    }
  });

  it("a fresh open still refetches the list and re-reads this browser's shares, starting from the link's view", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    const props = { initialEntryId: null, onClose: vi.fn(), onOpenAsProject: noop, onAddToProject: noop, store };
    const r = render(<GalleryOverlay open {...props} />);
    await waitFor(() => expect(cards()).toContain("proj1xxxxxx"));
    fireEvent.click(document.querySelector('[data-gallery-filter="music"]')!);
    fireEvent.click(document.querySelector('[data-gallery-card="musc1xxxxxx"]')!);
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    expect(calls(fetchMock, "/api/gallery")).toBe(1);

    r.rerender(<GalleryOverlay open={false} {...props} />);
    addLocalShare({ id: "musc2xxxxxx", title: "Jungle", kind: "music", publishedAt: 2, manageToken: "t" });
    r.rerender(<GalleryOverlay open {...props} />);

    // As the overlay always did: the list is fetched again and shown loading, the
    // Back stack starts empty, the chosen filter carries over.
    expect(screen.getByText("Loading the gallery…")).toBeTruthy();
    expect(calls(fetchMock, "/api/gallery")).toBe(2);
    expect(store.getState().stack).toEqual([]);
    expect(selectedFilter()).toBe("music");
    await waitFor(() => expect(cards()).toEqual(["musc1xxxxxx", "musc2xxxxxx"]));
    fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);
    expect(document.querySelector('[data-gallery-mine="musc2xxxxxx"]')).toBeTruthy();

    r.rerender(<GalleryOverlay open={false} {...props} />);
    r.rerender(<GalleryOverlay open {...props} initialView={{ kind: "author", id: "alice" }} />);
    expect(store.getState().stack).toEqual([{ kind: "author", id: "alice" }]);
    expect(calls(fetchMock, "/api/gallery")).toBe(3);
  });
});
