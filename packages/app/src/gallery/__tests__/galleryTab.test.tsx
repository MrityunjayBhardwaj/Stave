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

describe("readPlace — a saved place is read back like a link", () => {
  it("keeps a well-formed place", () => {
    expect(readPlace({ tab: "music", stack: [{ kind: "entry", id: "musc1xxxxxx" }, { kind: "author", id: "alice" }], title: "Breakbeat" })).toEqual({
      tab: "music",
      stack: [{ kind: "entry", id: "musc1xxxxxx" }, { kind: "author", id: "alice" }],
      title: "Breakbeat",
    });
  });

  it("drops views a pasted link would refuse, and an unknown list tab becomes Projects", () => {
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
    expect(place).toEqual({ tab: "project", stack: [{ kind: "collection", id: "late-bus_1" }] });
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
});

describe("GalleryTabBody", () => {
  it("a tab restored after a reload picks up its place once; coming back fetches nothing again", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    const saved = { tab: "music", stack: [{ kind: "entry", id: "musc1xxxxxx" }] };
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
    fireEvent.click(screen.getByText("← Back to the gallery"));
    await waitFor(() => expect(places.at(-1)).toEqual({ tab: "music", stack: [] }));
  });

  it("after a real open the body doesn't resume over it", async () => {
    const fetchMock = mockGallery();
    const store = createGalleryStore();
    openGalleryStore(store, { kind: "entry", id: "musc1xxxxxx" });
    render(
      <GalleryTabBody
        tab={tab({ tab: "project", stack: [] })}
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
