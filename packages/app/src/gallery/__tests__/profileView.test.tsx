// @vitest-environment jsdom
/**
 * #2493 — an artist's profile: a header with the right buttons for a visitor and
 * the owner, the bio, then their work searched, filtered and sorted like the
 * gallery. #2494 — no New collection and no Collections section, though the
 * data still has collections.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: vi.fn(async () => true),
  showPrompt: vi.fn(async () => null),
  showToast: vi.fn(),
}));

import { GalleryView } from "../GalleryView";
import { createGalleryStore } from "../galleryStore";
import { placeOf } from "../galleryTab";
import { resetGallerySessionForTests } from "../session";
import type { AuthorPageResponse, GalleryEntry, GalleryEntryResponse } from "../types";

const E = (over: Partial<GalleryEntry>): GalleryEntry => ({
  id: "AAAAAAAAAAA",
  title: "t",
  kind: "project",
  tags: [],
  authorName: "Alice",
  authorId: "alice",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail: false,
  ...over,
});

const WORK: GalleryEntry[] = [
  E({ id: "proj1xxxxxx", title: "Dub Set", kind: "project", publishedAt: 3 }),
  E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", publishedAt: 2, tags: ["dnb"] }),
  E({ id: "musc2xxxxxx", title: "Acid Dub", kind: "music", publishedAt: 1 }),
];

const AUTHOR: AuthorPageResponse = {
  author: { authorId: "alice", name: "Alice", bio: "# Hi", createdAt: 1, updatedAt: 1 },
  entries: WORK,
  collections: [{ id: "coll0000001", authorId: "alice", title: "EP", description: "", entryIds: ["musc1xxxxxx"], createdAt: 1, updatedAt: 1 }],
};

const ENTRY: GalleryEntryResponse = {
  entry: WORK[1],
  manifest: {
    schemaVersion: 1,
    project: { name: "Breakbeat", sharedAt: 1 },
    files: [{ id: "f1", path: "break.strudel", language: "strudel", content: 's("bd sd")' }],
    fileOrder: {},
    subfolderOrder: {},
  },
};

function mockGallery() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key === "GET /api/gallery") return Response.json({ entries: WORK });
    if (key === "GET /api/gallery/authors/alice") return Response.json(AUTHOR);
    if (key === `GET /api/gallery/${ENTRY.entry.id}`) return Response.json(ENTRY);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const noop = vi.fn(async () => true);
const cards = () => Array.from(document.querySelectorAll("[data-gallery-card]")).map((el) => el.getAttribute("data-gallery-card"));
const count = (f: string) =>
  document.querySelector(`[data-gallery-profile-filter="${f}"] [data-gallery-filter-count]`)!.textContent;

function openProfile() {
  mockGallery();
  const store = createGalleryStore();
  store.open({ kind: "author", id: "alice" });
  render(<GalleryView store={store} onOpenAsProject={noop} onAddToProject={noop} />);
  return store;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetGallerySessionForTests();
});

describe("a profile (#2493)", () => {
  it("a visitor: crumbs Gallery / name, the header, Copy profile link, no Edit, no collections", async () => {
    resetGallerySessionForTests({ status: "ready", session: { signInAvailable: true, providers: [], user: null } });
    const store = openProfile();
    await waitFor(() => expect(document.querySelector("[data-gallery-profile-head]")).not.toBeNull());
    expect(document.querySelector(".sg-crumb-here")!.textContent).toBe("Alice");
    // The gallery's header gives way to the crumbs, as on an entry.
    expect(document.querySelector(".sg-header")).toBeNull();
    const head = document.querySelector("[data-gallery-profile-head]") as HTMLElement;
    expect(head.querySelector("h2")!.textContent).toBe("Alice");
    expect(head.querySelector("[data-gallery-published-count]")!.textContent).toBe("3 published");
    expect(within(head).queryByText("Copy profile link")).not.toBeNull();
    expect(head.querySelector("[data-gallery-edit-profile]")).toBeNull();
    expect(document.querySelector("[data-gallery-markdown] h1")!.textContent).toBe("Hi");
    // #2494 — the author has a collection, and the profile neither lists nor offers to make one.
    expect(document.querySelector('[data-gallery-section="collections"]')).toBeNull();
    expect(document.querySelector("[data-gallery-collection-card]")).toBeNull();
    expect(document.querySelector("[data-gallery-new-collection]")).toBeNull();
    // The tab says whose profile it is.
    expect(placeOf(store.getState()).title).toBe("Alice");
  });

  it("the owner sees Edit profile (and still no New collection)", async () => {
    resetGallerySessionForTests({
      status: "ready",
      session: { signInAvailable: true, providers: [], user: { name: "Alice", authorId: "alice", verified: { provider: "github", login: "alice" } } },
    });
    openProfile();
    await waitFor(() => expect(document.querySelector("[data-gallery-edit-profile]")).not.toBeNull());
    expect(document.querySelector("[data-gallery-new-collection]")).toBeNull();
  });

  it("search, filter and sort work on the artist's own work, with no Artist order", async () => {
    openProfile();
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(cards()).toEqual(["proj1xxxxxx", "musc1xxxxxx", "musc2xxxxxx"]); // newest first
    expect([count("all"), count("project"), count("music"), count("viz")]).toEqual(["3", "1", "2", "0"]);
    const sort = document.querySelector("[data-gallery-profile-sort]") as HTMLSelectElement;
    expect(Array.from(sort.options).map((o) => o.value)).toEqual(["newest", "oldest", "title"]);

    fireEvent.click(document.querySelector('[data-gallery-profile-filter="music"]')!);
    expect(cards()).toEqual(["musc1xxxxxx", "musc2xxxxxx"]);
    fireEvent.change(sort, { target: { value: "title" } });
    expect(cards()).toEqual(["musc2xxxxxx", "musc1xxxxxx"]); // Acid Dub, Breakbeat
    fireEvent.change(screen.getByLabelText("Search Alice's work"), { target: { value: "dub" } });
    expect(cards()).toEqual(["musc2xxxxxx"]);
    expect([count("all"), count("project"), count("music")]).toEqual(["2", "1", "1"]);
    fireEvent.change(screen.getByLabelText("Search Alice's work"), { target: { value: "nothing" } });
    expect(document.querySelector('[data-gallery-state="profile-none"]')!.textContent).toBe(
      'Nothing of Alice\'s matches "nothing".',
    );
  });

  it("its search, filter and order survive opening one of their entries and coming Back; a fresh visit starts clean", async () => {
    const store = openProfile();
    await waitFor(() => expect(cards()).toHaveLength(3));
    fireEvent.click(document.querySelector('[data-gallery-profile-filter="music"]')!);
    fireEvent.change(screen.getByLabelText("Search Alice's work"), { target: { value: "break" } });
    expect(cards()).toEqual(["musc1xxxxxx"]);

    fireEvent.click(document.querySelector('[data-gallery-card="musc1xxxxxx"]')!);
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).not.toBeNull());
    fireEvent.click(screen.getByText("← Back"));
    await waitFor(() => expect(cards()).toEqual(["musc1xxxxxx"]));
    expect((screen.getByLabelText("Search Alice's work") as HTMLInputElement).value).toBe("break");
    expect(document.querySelector('[data-gallery-profile-filter="music"]')!.getAttribute("aria-checked")).toBe("true");

    // Back to the grid, then the same profile again: a fresh visit.
    fireEvent.click(document.querySelector('[data-gallery-crumb="gallery"]')!);
    store.push({ kind: "author", id: "alice" });
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect((screen.getByLabelText("Search Alice's work") as HTMLInputElement).value).toBe("");
  });
});
