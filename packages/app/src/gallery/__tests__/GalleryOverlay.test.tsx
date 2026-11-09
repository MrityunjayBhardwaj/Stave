// @vitest-environment jsdom
/**
 * #2300 / #2302 / #2304 — the overlay against a mocked gallery: tabs group by
 * kind, search filters, an entry shows its code (and runs nothing), a removed
 * entry says so, and My shares deletes with confirmation.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

const confirmMock = vi.fn(async () => true);
vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: (...a: unknown[]) => confirmMock(...(a as [])),
  showPrompt: vi.fn(async () => null),
  showToast: vi.fn(),
}));

import { GalleryOverlay } from "../GalleryOverlay";
import { addLocalShare, listLocalShares } from "../localShares";
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
  E({ id: "proj1xxxxxx", title: "Dub Techno", kind: "project", tags: ["dub"], authorName: "Alice", publishedAt: 4 }),
  E({ id: "proj2xxxxxx", title: "Ambient", kind: "project", authorName: "Bob", hasThumbnail: true, publishedAt: 3 }),
  E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", authorName: "Alice", publishedAt: 2 }),
  E({ id: "vizz1xxxxxx", title: "Kaleido", kind: "viz", authorName: "Carol", publishedAt: 1 }),
];

const ENTRY: GalleryEntryResponse = {
  entry: LIST[2],
  manifest: {
    schemaVersion: 1,
    project: { name: "Breakbeat", sharedAt: 1 },
    files: [{ id: "f1", path: "break.strudel", language: "strudel", content: 'window.__ran = 1\ns("bd sd")' }],
    fileOrder: {},
    subfolderOrder: {},
  },
};

function mockGallery(over: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (over[key]) return over[key]();
    if (key === "GET /api/gallery") return Response.json({ entries: LIST });
    if (key === `GET /api/gallery/${ENTRY.entry.id}`) return Response.json(ENTRY);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const noopOpen = vi.fn(async () => true);

function renderOverlay(initialEntryId: string | null = null, onClose = vi.fn()) {
  render(
    <GalleryOverlay
      open
      initialEntryId={initialEntryId}
      onClose={onClose}
      onOpenAsProject={noopOpen}
      onAddToProject={noopOpen}
    />,
  );
  return { onClose };
}

const cards = () =>
  Array.from(document.querySelectorAll("[data-gallery-card]")).map((el) => el.getAttribute("data-gallery-card"));

beforeEach(() => confirmMock.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GalleryOverlay", () => {
  it("shows loading, then every entry under All; each filter shows its kind, with counts", async () => {
    mockGallery();
    renderOverlay();
    expect(screen.getByText("Loading the gallery…")).toBeTruthy();
    await waitFor(() => expect(cards()).toEqual(["proj1xxxxxx", "proj2xxxxxx", "musc1xxxxxx", "vizz1xxxxxx"]));
    const filterText = (id: string) => document.querySelector(`[data-gallery-filter="${id}"]`)!.textContent;
    expect([filterText("all"), filterText("project"), filterText("music"), filterText("viz")]).toEqual([
      "All4",
      "Projects2",
      "Music1",
      "Visuals1",
    ]);
    fireEvent.click(document.querySelector('[data-gallery-filter="project"]')!);
    expect(cards()).toEqual(["proj1xxxxxx", "proj2xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-filter="music"]')!);
    expect(cards()).toEqual(["musc1xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-filter="viz"]')!);
    expect(cards()).toEqual(["vizz1xxxxxx"]);
    // no tag chips and no "Viz" left anywhere in the browse view
    expect(document.querySelector("[data-gallery-view]")!.textContent).not.toMatch(/\bViz\b/);
  });

  it("the filter is one Tab stop; arrow keys move along it, wrapping, as a radio group does", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards()).toHaveLength(4));
    const f = (id: string) => document.querySelector(`[data-gallery-filter="${id}"]`) as HTMLElement;
    expect([f("all").tabIndex, f("project").tabIndex]).toEqual([0, -1]);
    f("all").focus();
    fireEvent.keyDown(f("all"), { key: "ArrowRight" });
    expect(f("project").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(f("project"));
    expect(cards()).toEqual(["proj1xxxxxx", "proj2xxxxxx"]);
    fireEvent.keyDown(f("project"), { key: "ArrowLeft" });
    fireEvent.keyDown(f("all"), { key: "ArrowLeft" });
    expect(f("viz").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(f("viz"), { key: "Home" });
    expect(f("all").getAttribute("aria-checked")).toBe("true");
  });

  it("Sort by orders the grid: Newest, Oldest, Title A–Z, Artist A–Z", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards()).toHaveLength(4));
    const sortBy = (v: string) => fireEvent.change(document.querySelector("[data-gallery-sort]")!, { target: { value: v } });
    sortBy("oldest");
    expect(cards()).toEqual(["vizz1xxxxxx", "musc1xxxxxx", "proj2xxxxxx", "proj1xxxxxx"]);
    sortBy("title");
    expect(cards()).toEqual(["proj2xxxxxx", "musc1xxxxxx", "proj1xxxxxx", "vizz1xxxxxx"]);
    sortBy("artist");
    // Alice's two (by title), Bob, Carol
    expect(cards()).toEqual(["musc1xxxxxx", "proj1xxxxxx", "proj2xxxxxx", "vizz1xxxxxx"]);
    sortBy("newest");
    expect(cards()).toEqual(["proj1xxxxxx", "proj2xxxxxx", "musc1xxxxxx", "vizz1xxxxxx"]);
  });

  it("/ puts the cursor in the search, but not while typing somewhere else", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards()).toHaveLength(4));
    const search = screen.getByLabelText("Search the gallery");
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(search);

    search.blur();
    // a control inside the gallery that takes typed keys keeps them
    const sort = document.querySelector("[data-gallery-sort]") as HTMLSelectElement;
    sort.focus();
    fireEvent.keyDown(sort, { key: "/" });
    expect(document.activeElement).toBe(sort);

    const elsewhere = document.createElement("textarea");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: "/" });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("My shares is a header button: it always opens My shares, and Back returns to the grid", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards()).toHaveLength(4));
    const mine = document.querySelector('[data-gallery-tab="mine"]')!;
    expect(mine.closest(".sg-header")).toBeTruthy();
    fireEvent.click(mine);
    expect(mine.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-gallery-browsebar]")).toBeNull();
    // pressed again it stays (opening the gallery on My shares and pressing it must not leave)
    fireEvent.click(mine);
    expect(document.querySelector('[data-gallery-state="mine-empty"]')).toBeTruthy();
    fireEvent.click(document.querySelector("[data-gallery-browse]")!);
    expect(cards()).toHaveLength(4);
    expect(mine.getAttribute("aria-current")).toBeNull();
  });

  it("an entry's breadcrumb: Gallery goes back to the grid, the kind to the grid filtered to it", async () => {
    mockGallery();
    renderOverlay("musc1xxxxxx");
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    const crumbs = document.querySelector(".sg-crumbs")!;
    expect(crumbs.textContent).toBe("Gallery/Music/Breakbeat×");
    // the page's own bar replaces the header (its × still closes the overlay)
    expect(document.querySelector(".sg-header")).toBeNull();
    fireEvent.click(document.querySelector('[data-gallery-crumb="kind"]')!);
    expect(document.querySelector("[data-gallery-detail]")).toBeNull();
    expect(document.querySelector('[data-gallery-filter="music"]')!.getAttribute("aria-checked")).toBe("true");
    expect(cards()).toEqual(["musc1xxxxxx"]);

    fireEvent.click(document.querySelector('[data-gallery-card="musc1xxxxxx"]')!);
    await waitFor(() => expect(document.querySelector('[data-gallery-detail="musc1xxxxxx"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-gallery-crumb="gallery"]')!);
    expect(document.querySelector("[data-gallery-detail]")).toBeNull();
    expect(cards()).toEqual(["musc1xxxxxx"]); // the filter chosen stays
  });

  it("thumbnails come from the thumbnail route, otherwise a generated card", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards().length).toBe(4));
    const withThumb = document.querySelector('[data-gallery-card="proj2xxxxxx"] img') as HTMLImageElement;
    expect(withThumb.getAttribute("src")).toBe("/api/gallery/proj2xxxxxx/thumbnail");
    expect(document.querySelector('[data-gallery-card="proj1xxxxxx"] [data-gallery-thumb="generated"]')).toBeTruthy();
  });

  it("search filters by author, and says so when nothing matches", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards().length).toBe(4));
    fireEvent.change(screen.getByLabelText("Search the gallery"), { target: { value: "alice" } });
    expect(cards()).toEqual(["proj1xxxxxx", "musc1xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-filter="project"]')!);
    expect(cards()).toEqual(["proj1xxxxxx"]);
    fireEvent.change(screen.getByLabelText("Search the gallery"), { target: { value: "carol" } });
    expect(document.querySelector('[data-gallery-state="empty"]')!.textContent).toBe('Nothing in Projects matches "carol".');
    fireEvent.click(document.querySelector('[data-gallery-filter="all"]')!);
    fireEvent.change(screen.getByLabelText("Search the gallery"), { target: { value: "zzz" } });
    expect(document.querySelector('[data-gallery-state="empty"]')!.textContent).toContain('matches "zzz"');
  });

  it("an error loading the list says so, with Try again", async () => {
    mockGallery({ "GET /api/gallery": () => Response.json({ error: "boom" }, { status: 500 }) });
    renderOverlay();
    await waitFor(() => expect(document.querySelector('[data-gallery-state="error"]')!.textContent).toContain("boom"));
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("opening an entry shows its code as text, with the actions its kind allows", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards().length).toBe(4));
    fireEvent.click(document.querySelector('[data-gallery-card="musc1xxxxxx"]')!);
    const code = await waitFor(() => {
      const el = document.querySelector('[data-gallery-code="break.strudel"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(code.textContent).toContain("window.__ran = 1");
    // shown, not run
    expect((window as unknown as { __ran?: number }).__ran).toBeUndefined();
    expect(screen.getByText("Open as new project")).toBeTruthy();
    expect(screen.getByText("Add to this project")).toBeTruthy();
    fireEvent.click(screen.getByText("Open as new project"));
    await waitFor(() => expect(noopOpen).toHaveBeenCalledWith(ENTRY.entry, ENTRY.manifest));
  });

  it("a removed entry (410) says it was removed", async () => {
    mockGallery({ "GET /api/gallery/gone1xxxxxx": () => new Response(null, { status: 410 }) });
    renderOverlay("gone1xxxxxx");
    await waitFor(() =>
      expect(document.querySelector('[data-gallery-state="removed"]')!.textContent).toBe(
        "This was removed from the gallery.",
      ),
    );
  });

  it("Esc closes, but not while a dialog is on top; backdrop click closes", async () => {
    mockGallery();
    const { onClose } = renderOverlay();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('[data-gallery="overlay"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe("My shares", () => {
    it("explains publishing when empty", async () => {
      mockGallery();
      renderOverlay();
      fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);
      expect(document.querySelector('[data-gallery-state="mine-empty"]')!.textContent).toContain("Publish to Gallery");
    });

    it("lists local shares, marks one missing from the gallery, and deletes after confirming", async () => {
      addLocalShare({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", publishedAt: 2, manageToken: "t1" });
      addLocalShare({ id: "gone1xxxxxx", title: "Old thing", kind: "viz", publishedAt: 1, manageToken: "t2" });
      const fetchMock = mockGallery({ "DELETE /api/gallery/musc1xxxxxx": () => new Response(null, { status: 204 }) });
      renderOverlay();
      await waitFor(() => expect(cards().length).toBe(4));
      fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);

      const listed = document.querySelector('[data-gallery-mine="musc1xxxxxx"]') as HTMLElement;
      const missing = document.querySelector('[data-gallery-mine="gone1xxxxxx"]') as HTMLElement;
      expect(listed.getAttribute("data-gallery-status")).toBe("listed");
      expect(missing.getAttribute("data-gallery-status")).toBe("missing");
      expect(missing.textContent).toContain("No longer in the gallery");

      fireEvent.click(within(listed).getByText("Delete"));
      await waitFor(() => expect(document.querySelector('[data-gallery-mine="musc1xxxxxx"]')).toBeNull());
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/gallery/musc1xxxxxx" && i?.method === "DELETE")).toBe(true);
      expect(listLocalShares().map((s) => s.id)).toEqual(["gone1xxxxxx"]);
    });

    it("a cancelled confirm deletes nothing", async () => {
      addLocalShare({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", publishedAt: 2, manageToken: "t1" });
      confirmMock.mockResolvedValueOnce(false);
      const fetchMock = mockGallery();
      renderOverlay();
      fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);
      fireEvent.click(screen.getByText("Delete"));
      await waitFor(() => expect(confirmMock).toHaveBeenCalled());
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
      expect(listLocalShares()).toHaveLength(1);
    });
  });
});
