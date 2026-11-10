// @vitest-environment jsdom
/**
 * #2473 — the gallery as a workspace tab: the place it saves in the layout is
 * read back as carefully as a link, its label says where you are, a tab
 * restored after a reload picks up its place once, and coming back to the tab
 * never fetches the list again.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: vi.fn(async () => true),
  showPrompt: vi.fn(async () => null),
  showToast: vi.fn(),
}));

import type { AppTabState } from "@stave/editor";
import { createGalleryStore } from "../galleryStore";
import {
  GALLERY_APP_KEY,
  GalleryTabBody,
  galleryTabLabel,
  openGalleryStore,
  readPlace,
  SEARCH_WRITE_DELAY_MS,
  resetGalleryTabForTests,
  type GalleryPlace,
} from "../galleryTab";
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
const LIST: GalleryEntry[] = [
  E({ id: "proj1xxxxxx", title: "Dub Techno", kind: "project" }),
  E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music" }),
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

function mockGallery() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key === "GET /api/gallery") return Response.json({ entries: LIST });
    if (key === `GET /api/gallery/${ENTRY.entry.id}`) return Response.json(ENTRY);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const listFetches = (f: ReturnType<typeof mockGallery>) => f.mock.calls.filter(([u]) => u === "/api/gallery").length;
const tab = (state?: AppTabState) => ({ kind: "app" as const, id: `app-${GALLERY_APP_KEY}`, appKey: GALLERY_APP_KEY, ...(state !== undefined ? { state } : {}) });
const noop = vi.fn(async () => true);

beforeEach(() => resetGalleryTabForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** #2492 — My shares' own filter, order and search, as a fresh place has them. */
const MINE0 = { mineFilter: "all", mineSort: "newest", mineQuery: "" } as const;

describe("readPlace — a saved place is read back like a link", () => {
  it("keeps a well-formed place", () => {
    expect(
      readPlace({
        tab: "browse",
        filter: "music",
        sort: "artist",
        query: "dub",
        stack: [{ kind: "entry", id: "musc1xxxxxx" }, { kind: "author", id: "alice" }],
        title: "Breakbeat",
      }),
    ).toEqual({
      tab: "browse",
      filter: "music",
      sort: "artist",
      query: "dub",
      ...MINE0,
      stack: [{ kind: "entry", id: "musc1xxxxxx" }, { kind: "author", id: "alice" }],
      title: "Breakbeat",
    });
    expect(readPlace({ tab: "mine", stack: [] })).toMatchObject({ tab: "mine" });
    expect(readPlace({ tab: "mine", mineFilter: "links", mineSort: "title", mineQuery: "set", stack: [] })).toMatchObject({
      tab: "mine",
      mineFilter: "links",
      mineSort: "title",
      mineQuery: "set",
    });
  });

  it("#2492 My shares' filter, order and search fall back on their own; the grid's choices don't leak into them", () => {
    // "artist" is a grid order, "music" a grid filter: neither is one of My shares'.
    expect(readPlace({ tab: "mine", mineFilter: "music", mineSort: "artist", mineQuery: "y".repeat(201), stack: [] })).toMatchObject(
      MINE0,
    );
    expect(readPlace({ tab: "mine", mineFilter: "published", mineSort: "oldest", mineQuery: 3, stack: [] })).toMatchObject({
      mineFilter: "published",
      mineSort: "oldest",
      mineQuery: "",
    });
  });

  it("a place saved before #2486 (a kind as its tab, no filter or sort) opens on All, Newest", () => {
    for (const old of ["project", "music", "viz"]) {
      expect(readPlace({ tab: old, stack: [] })).toEqual({ tab: "browse", filter: "all", sort: "newest", query: "", ...MINE0, stack: [] });
    }
  });

  it("an unknown filter or sort, or a search no one typed, falls back to the start", () => {
    expect(readPlace({ tab: "browse", filter: "albums", sort: "random", query: "x".repeat(201), stack: [] })).toEqual({
      tab: "browse",
      filter: "all",
      sort: "newest",
      query: "",
      ...MINE0,
      stack: [],
    });
    expect(readPlace({ tab: "browse", filter: "viz", sort: "title", query: 5, stack: [] })).toMatchObject({ filter: "viz", sort: "title", query: "" });
  });

  it("drops views a pasted link would refuse, and an unknown view becomes browse", () => {
    const place = readPlace({
      tab: "nonsense",
      stack: [
        { kind: "entry", id: "../../admin" }, // not a gallery id
        { kind: "author", id: "a/b?c=1" }, // path and query characters
        { kind: "settings", id: "alice" }, // not a kind of view
        { kind: "author", id: 7 }, // not a string
        "author:alice", // not an object
        { kind: "collection", id: "late-bus_1" }, // the one good view
      ],
      title: 42,
    });
    expect(place).toEqual({
      tab: "browse",
      filter: "all",
      sort: "newest",
      query: "",
      ...MINE0,
      stack: [{ kind: "collection", id: "late-bus_1" }],
    });
  });

  it("is null for no state or a state that isn't an object", () => {
    expect(readPlace(undefined)).toBeNull();
    expect(readPlace("gallery")).toBeNull();
    expect(readPlace([1, 2])).toBeNull();
  });

  it("keeps only the innermost 32 views of a Back stack", () => {
    const stack = Array.from({ length: 40 }, (_, i) => ({ kind: "author", id: `a${i}` }));
    const place = readPlace({ tab: "project", stack })!;
    expect(place.stack).toHaveLength(32);
    expect(place.stack[31]).toEqual({ kind: "author", id: "a39" });
  });
});

describe("galleryTabLabel — the tab says where you are", () => {
  it("names the view on top of the Back stack", () => {
    expect(galleryTabLabel(tab()).title).toBe("Gallery");
    expect(galleryTabLabel(tab({ tab: "music", stack: [] })).title).toBe("Gallery");
    expect(galleryTabLabel(tab({ tab: "music", stack: [{ kind: "entry", id: "musc1xxxxxx" }], title: "Breakbeat" })).title).toBe(
      "Gallery · Breakbeat",
    );
    // the entry's title isn't known yet: the plain name rather than a guess
    expect(galleryTabLabel(tab({ tab: "music", stack: [{ kind: "entry", id: "musc1xxxxxx" }] })).title).toBe("Gallery");
    expect(galleryTabLabel(tab({ tab: "project", stack: [{ kind: "author", id: "alice" }] })).title).toBe("Gallery · Profile");
  });

  it("#2492 names My shares and Moderation; what is open on top of them wins", () => {
    expect(galleryTabLabel(tab({ tab: "mine", stack: [] })).title).toBe("Gallery · My shares");
    expect(galleryTabLabel(tab({ tab: "moderation", stack: [] })).title).toBe("Gallery · Moderation");
    expect(galleryTabLabel(tab({ tab: "mine", stack: [{ kind: "author", id: "alice" }] })).title).toBe("Gallery · Profile");
  });

  it("#2493 names a profile by the artist once it has loaded", () => {
    expect(galleryTabLabel(tab({ tab: "browse", stack: [{ kind: "author", id: "alice" }], title: "Alice" })).title).toBe(
      "Gallery · Alice",
    );
  });
});

describe("GalleryTabBody", () => {
  it("a tab restored after a reload picks up its place once; coming back fetches nothing again", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    const saved = { tab: "browse", filter: "music", sort: "title", query: "", ...MINE0, stack: [{ kind: "entry", id: "musc1xxxxxx" }] };
    const places: GalleryPlace[] = [];
    // as the shell does: what the body writes is the state the next draw gets
    let state: AppTabState = saved;
    const write = (p: GalleryPlace) => {
      places.push(p);
      state = JSON.parse(JSON.stringify(p)) as AppTabState;
    };
    const body = () => (
      <GalleryTabBody tab={tab(state)} store={store} onOpenAsProject={noop} onAddToProject={noop} onPlaceChange={write} />
    );

    const first = render(body());
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    expect(listFetches(fetchMock)).toBe(1);
    // the entry's title arrives: the label's copy is written once, with it
    await waitFor(() => expect(places.at(-1)).toEqual({ ...saved, title: "Breakbeat" }));
    const writes = places.length;

    first.unmount();
    render(body());
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    expect(listFetches(fetchMock)).toBe(1);
    expect(places.length).toBe(writes);

    // a real navigation is written
    fireEvent.click(document.querySelector('[data-gallery-crumb="gallery"]')!);
    await waitFor(() => expect(places.at(-1)).toEqual({ ...saved, stack: [] }));
    // the filter and sort it came back with are the grid's
    expect(document.querySelector('[data-gallery-filter="music"]')!.getAttribute("aria-checked")).toBe("true");
    expect((document.querySelector("[data-gallery-sort]") as HTMLSelectElement).value).toBe("title");
  });

  it("filter and sort are written at once; the search only once typing pauses, and on leaving the tab", async () => {
    mockGallery();
    const store = createGalleryStore();
    openGalleryStore(store, null);
    const places: GalleryPlace[] = [];
    const view = render(
      <GalleryTabBody tab={tab()} store={store} onOpenAsProject={noop} onAddToProject={noop} onPlaceChange={(p) => places.push(p)} />,
    );
    await waitFor(() => expect(document.querySelector('[data-gallery-card="proj1xxxxxx"]')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-gallery-filter="viz"]')!);
    expect(places.at(-1)).toMatchObject({ filter: "viz" });
    fireEvent.change(document.querySelector("[data-gallery-sort]")!, { target: { value: "oldest" } });
    expect(places.at(-1)).toMatchObject({ filter: "viz", sort: "oldest" });

    const n = places.length;
    const search = screen.getByLabelText("Search the gallery");
    fireEvent.change(search, { target: { value: "k" } });
    fireEvent.change(search, { target: { value: "ka" } });
    expect(places.length).toBe(n);
    await waitFor(() => expect(places.at(-1)).toMatchObject({ query: "ka" }), { timeout: SEARCH_WRITE_DELAY_MS * 4 });
    expect(places.length).toBe(n + 1);

    fireEvent.change(search, { target: { value: "kal" } });
    view.unmount();
    expect(places.at(-1)).toMatchObject({ query: "kal" });
  });

  it("#2492 My shares' filter and sort are written at once, its search once typing pauses", async () => {
    mockGallery();
    const store = createGalleryStore();
    openGalleryStore(store, null);
    const places: GalleryPlace[] = [];
    const view = render(
      <GalleryTabBody tab={tab()} store={store} onOpenAsProject={noop} onAddToProject={noop} onPlaceChange={(p) => places.push(p)} />,
    );
    await waitFor(() => expect(document.querySelector('[data-gallery-card="proj1xxxxxx"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);
    expect(places.at(-1)).toMatchObject({ tab: "mine" });
    fireEvent.click(document.querySelector('[data-gallery-mine-filter="links"]')!);
    expect(places.at(-1)).toMatchObject({ mineFilter: "links", filter: "all" });
    fireEvent.change(document.querySelector("[data-gallery-mine-sort]")!, { target: { value: "title" } });
    expect(places.at(-1)).toMatchObject({ mineSort: "title", sort: "newest" });

    const n = places.length;
    const search = screen.getByLabelText("Search your shares");
    fireEvent.change(search, { target: { value: "s" } });
    fireEvent.change(search, { target: { value: "se" } });
    expect(places.length).toBe(n);
    await waitFor(() => expect(places.at(-1)).toMatchObject({ mineQuery: "se", query: "" }), {
      timeout: SEARCH_WRITE_DELAY_MS * 4,
    });
    expect(places.length).toBe(n + 1);
    fireEvent.change(search, { target: { value: "set" } });
    view.unmount();
    expect(places.at(-1)).toMatchObject({ mineQuery: "set" });
  });

  it("after a real open the body doesn't resume over it", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    openGalleryStore(store, { kind: "entry", id: "musc1xxxxxx" });
    render(
      <GalleryTabBody
        tab={tab({ tab: "browse", stack: [] })}
        store={store}
        onOpenAsProject={noop}
        onAddToProject={noop}
        onPlaceChange={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    expect(listFetches(fetchMock)).toBe(1);
  });

  it("has no close button and ignores Esc", async () => {
    mockGallery();
    const store = createGalleryStore();
    render(<GalleryTabBody tab={tab()} store={store} onOpenAsProject={noop} onAddToProject={noop} onPlaceChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-gallery-card="proj1xxxxxx"]')).toBeTruthy());
    expect(screen.queryByLabelText("Close gallery")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector('[data-gallery="tab"]')).toBeTruthy();
  });
});
