// @vitest-environment jsdom
/**
 * #2331 — the Moderation tab: there only when /api/gallery/me says isAdmin;
 * lists flagged entries with their report reasons and the action log; Take down
 * and Dismiss ask for a reason and send it, and asking-then-cancelling sends nothing.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const promptMock = vi.fn(async (_o: unknown): Promise<string | null> => null);
vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: vi.fn(async () => true),
  showPrompt: (o: unknown) => promptMock(o),
  showToast: vi.fn(),
}));

import { GalleryOverlay } from "../GalleryOverlay";
import { resetGallerySessionForTests } from "../session";
import type { AdminLogResponse, GalleryEntry, GallerySessionResponse, ModerationReportsResponse } from "../types";

const ENTRY: GalleryEntry = {
  id: "flag1xxxxxx",
  title: "Rude title",
  kind: "music",
  tags: [],
  authorName: "Eve",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail: false,
};
const FLAGGED: ModerationReportsResponse = {
  flagged: [
    {
      entryId: ENTRY.id,
      entry: ENTRY,
      reports: [
        { reason: "offensive title", reportedAt: 2 },
        { reason: "spam", reportedAt: 1 },
      ],
    },
  ],
};
const LOG: AdminLogResponse = {
  actions: [
    {
      at: 3,
      admin: { provider: "github", accountId: "42", name: "Mo" },
      action: "dismiss-report",
      target: "othr1xxxxxx",
      reason: "reviewed, fine",
    },
  ],
};

function mockServer(isAdmin: boolean) {
  const me: GallerySessionResponse = {
    signInAvailable: true,
    providers: [{ id: "github", name: "GitHub" }],
    user: { name: "Mo", authorId: "moAuthor", verified: { provider: "github", login: "mo" }, accountId: "github:42" },
    isAdmin,
  };
  const calls: Array<{ key: string; body: string | null }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, body: typeof init?.body === "string" ? init.body : null });
    if (key === "GET /api/gallery") return Response.json({ entries: [ENTRY] });
    if (key === "GET /api/gallery/me") return Response.json(me);
    if (key === "GET /api/gallery/me/shares") return Response.json({ authorId: "moAuthor", entries: [], collections: [], links: [] });
    if (key === "GET /api/gallery/admin/reports") return Response.json(FLAGGED);
    if (key === "GET /api/gallery/admin/log") return Response.json(LOG);
    if (key === `DELETE /api/gallery/${ENTRY.id}`) return new Response(null, { status: 204 });
    if (key === `POST /api/gallery/admin/reports/${ENTRY.id}/dismiss`) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderOverlay() {
  render(
    <GalleryOverlay open initialEntryId={null} onClose={vi.fn()} onOpenAsProject={vi.fn(async () => true)} onAddToProject={vi.fn(async () => true)} />,
  );
}

beforeEach(() => {
  resetGallerySessionForTests();
  promptMock.mockReset();
  promptMock.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const moderationTab = () => document.querySelector('[data-gallery-tab="moderation"]');

describe("the Moderation tab", () => {
  it("is not there for a signed-in non-admin", async () => {
    const calls = mockServer(false);
    renderOverlay();
    // The session has loaded once the overlay asks for the account's shares (it needs the author id).
    await waitFor(() => expect(calls.map((c) => c.key)).toContain("GET /api/gallery/me/shares"));
    expect(moderationTab()).toBeNull();
    expect(calls.some((c) => c.key.includes("/admin/"))).toBe(false);
  });

  it("for an admin lists flagged entries with their reasons, and the log", async () => {
    const calls = mockServer(true);
    renderOverlay();
    await waitFor(() => expect(moderationTab()).not.toBeNull());
    fireEvent.click(moderationTab()!);
    const row = await waitFor(() => {
      const el = document.querySelector(`[data-gallery-flagged="${ENTRY.id}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(row.textContent).toContain("Rude title");
    expect(row.textContent).toContain("2 reports");
    expect([...row.querySelectorAll("[data-gallery-report-reason]")].map((li) => li.textContent)).toEqual([
      expect.stringContaining("offensive title"),
      expect.stringContaining("spam"),
    ]);
    const log = await waitFor(() => {
      const el = document.querySelector('[data-gallery-log-action="dismiss-report"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(log.textContent).toContain("Mo");
    expect(log.textContent).toContain("reviewed, fine");
    // No search box on this tab.
    expect(screen.queryByLabelText("Search the gallery")).toBeNull();
    expect(calls.map((c) => c.key)).toContain("GET /api/gallery/admin/log");
  });

  it("Take down asks for a reason and sends it; cancelling sends nothing", async () => {
    const calls = mockServer(true);
    renderOverlay();
    await waitFor(() => expect(moderationTab()).not.toBeNull());
    fireEvent.click(moderationTab()!);
    const button = await waitFor(() => {
      const el = document.querySelector(`[data-gallery-take-down="${ENTRY.id}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    promptMock.mockResolvedValueOnce(null);
    fireEvent.click(button);
    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1));
    expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);

    promptMock.mockResolvedValueOnce("  copied work  ");
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.key === `DELETE /api/gallery/${ENTRY.id}`)).toBe(true));
    const del = calls.find((c) => c.key === `DELETE /api/gallery/${ENTRY.id}`)!;
    expect(JSON.parse(del.body!)).toEqual({ reason: "copied work" });
    expect(promptMock.mock.calls[1][0]).toMatchObject({ confirmLabel: "Take down" });
  });

  it("Dismiss asks for a reason and posts it to the dismiss route", async () => {
    const calls = mockServer(true);
    renderOverlay();
    await waitFor(() => expect(moderationTab()).not.toBeNull());
    fireEvent.click(moderationTab()!);
    const button = await waitFor(() => {
      const el = document.querySelector(`[data-gallery-dismiss="${ENTRY.id}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    promptMock.mockResolvedValueOnce("reviewed");
    fireEvent.click(button);
    const key = `POST /api/gallery/admin/reports/${ENTRY.id}/dismiss`;
    await waitFor(() => expect(calls.some((c) => c.key === key)).toBe(true));
    expect(JSON.parse(calls.find((c) => c.key === key)!.body!)).toEqual({ reason: "reviewed" });
  });
});
