/**
 * #2367 — the browser's session store: a tab left open past a day re-reads when
 * you come back to it, since that read is what renews the session, and a failed
 * re-read doesn't throw away what's known. The sign-out lock is observed in a real
 * browser (tests/gallery-session-lifetime.spec.ts): jsdom has no Web Locks.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadGallerySession, resetGallerySessionForTests, useGallerySession } from "../session";

const DAY = 24 * 60 * 60 * 1000;
const signedIn = { signInAvailable: true, providers: [], isAdmin: false, user: { name: "Ada", authorId: "a1" } };
const signedOut = { ...signedIn, user: null };

const fetchMock = vi.fn();
const meCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/gallery/me").length;
const answer = (body: unknown) => fetchMock.mockImplementationOnce(async () => Response.json(body));

function setVisibility(value: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Mounted and read once, at the clock's current time. */
async function mounted() {
  answer(signedIn);
  const hook = renderHook(() => useGallerySession());
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  return hook;
}

const userOf = (s: ReturnType<typeof useGallerySession>) => (s.status === "ready" ? s.session.user?.name ?? null : s.status);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 10, 7) });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  resetGallerySessionForTests();
});
afterEach(() => {
  cleanup();
  setVisibility("visible");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("coming back to an open tab", () => {
  it("doesn't re-read within a day", async () => {
    await mounted();
    vi.setSystemTime(Date.now() + DAY - 60_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(meCalls()).toBe(1);
  });

  it("re-reads after a day, when the tab is visible, and only once", async () => {
    await mounted();
    vi.setSystemTime(Date.now() + DAY + 60_000);
    setVisibility("hidden");
    expect(meCalls()).toBe(1);
    answer(signedIn);
    setVisibility("visible");
    expect(meCalls()).toBe(2);
    await waitFor(() => expect(fetchMock.mock.results.length).toBe(2));
    await vi.waitFor(() => {
      setVisibility("visible");
      expect(meCalls()).toBe(2);
    });
  });

  it("shows you signed out when the session has ended", async () => {
    const hook = await mounted();
    vi.setSystemTime(Date.now() + 8 * DAY);
    answer(signedOut);
    setVisibility("visible");
    await waitFor(() => expect(userOf(hook.result.current)).toBeNull());
  });

  it("a failed re-read keeps what's known", async () => {
    const hook = await mounted();
    vi.setSystemTime(Date.now() + 2 * DAY);
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    await loadGallerySession();
    expect(userOf(hook.result.current)).toBe("Ada");
  });

  it("a failed first read still says so", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    await loadGallerySession();
    const hook = renderHook(() => useGallerySession());
    expect(hook.result.current.status).toBe("error");
  });
});
