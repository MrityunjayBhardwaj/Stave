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
  E({ id: "proj1xxxxxx", title: "Dub Techno", kind: "project", tags: ["dub"], authorName: "Alice" }),
  E({ id: "proj2xxxxxx", title: "Ambient", kind: "project", authorName: "Bob", hasThumbnail: true }),
  E({ id: "musc1xxxxxx", title: "Breakbeat", kind: "music", authorName: "Alice" }),
  E({ id: "vizz1xxxxxx", title: "Kaleido", kind: "viz", authorName: "Carol" }),
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
  it("shows loading, then groups cards by kind per tab", async () => {
    mockGallery();
    renderOverlay();
    expect(screen.getByText("Loading the gallery…")).toBeTruthy();
    await waitFor(() => expect(cards()).toEqual(["proj1xxxxxx", "proj2xxxxxx"]));
    fireEvent.click(document.querySelector('[data-gallery-tab="music"]')!);
    expect(cards()).toEqual(["musc1xxxxxx"]);
    fireEvent.click(document.querySelector('[data-gallery-tab="viz"]')!);
    expect(cards()).toEqual(["vizz1xxxxxx"]);
  });

  it("thumbnails come from the thumbnail route, otherwise a generated card", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards().length).toBe(2));
    const withThumb = document.querySelector('[data-gallery-card="proj2xxxxxx"] img') as HTMLImageElement;
    expect(withThumb.getAttribute("src")).toBe("/api/gallery/proj2xxxxxx/thumbnail");
    expect(document.querySelector('[data-gallery-card="proj1xxxxxx"] [data-gallery-thumb="generated"]')).toBeTruthy();
  });

  it("search filters by author, and says so when nothing matches", async () => {
    mockGallery();
    renderOverlay();
    await waitFor(() => expect(cards().length).toBe(2));
    fireEvent.change(screen.getByLabelText("Search the gallery"), { target: { value: "alice" } });
    expect(cards()).toEqual(["proj1xxxxxx"]);
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
    await waitFor(() => expect(cards().length).toBe(2));
    fireEvent.click(document.querySelector('[data-gallery-tab="music"]')!);
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
      await waitFor(() => expect(cards().length).toBe(2));
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
