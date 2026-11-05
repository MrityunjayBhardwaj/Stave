/**
 * #2302 — My shares: deleting asks first, deletes on the server with the token,
 * and only then forgets the share locally; a removed entry reads as removed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { deleteMyShare, defaultDeleteDeps, shareStatus } from "../myShares";
import { addLocalShare, listLocalShares, type LocalShare } from "../localShares";
import { MANAGE_TOKEN_HEADER, type GalleryEntry } from "../types";

const SHARE: LocalShare = { id: "Ab3_-xY9zQ1", title: "My loop", kind: "music", publishedAt: 5, manageToken: "tok-123" };

afterEach(() => vi.unstubAllGlobals());

describe("deleteMyShare", () => {
  it("does nothing when the person cancels", async () => {
    const remove = vi.fn();
    const forget = vi.fn();
    const out = await deleteMyShare(SHARE, { confirm: async () => false, remove, forget });
    expect(out).toBe("cancelled");
    expect(remove).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it("deletes with the manage token, then forgets the share", async () => {
    const calls: string[] = [];
    const out = await deleteMyShare(SHARE, {
      confirm: async () => true,
      remove: async (id, token) => void calls.push(`remove ${id} ${token}`),
      forget: (id) => void calls.push(`forget ${id}`),
    });
    expect(out).toBe("deleted");
    expect(calls).toEqual(["remove Ab3_-xY9zQ1 tok-123", "forget Ab3_-xY9zQ1"]);
  });

  it("keeps the token when the server refuses, so it can be tried again", async () => {
    const forget = vi.fn();
    await expect(
      deleteMyShare(SHARE, {
        confirm: async () => true,
        remove: async () => {
          throw new Error("this browser's key for that entry doesn't match");
        },
        forget,
      }),
    ).rejects.toThrow("doesn't match");
    expect(forget).not.toHaveBeenCalled();
  });

  it("end to end through the real client and localStorage", async () => {
    addLocalShare(SHARE);
    expect(listLocalShares().map((s) => s.id)).toEqual([SHARE.id]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    window.addEventListener("stave:gallery-shares-changed", changed);

    const out = await deleteMyShare(SHARE, defaultDeleteDeps(async () => true));

    window.removeEventListener("stave:gallery-shares-changed", changed);
    expect(out).toBe("deleted");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/gallery/${SHARE.id}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)[MANAGE_TOKEN_HEADER]).toBe("tok-123");
    expect(listLocalShares()).toEqual([]);
    expect(changed).toHaveBeenCalled();
  });

  it("an entry already removed elsewhere (410) still counts as deleted", async () => {
    addLocalShare(SHARE);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 410 })));
    await expect(deleteMyShare(SHARE, defaultDeleteDeps(async () => true))).resolves.toBe("deleted");
    expect(listLocalShares()).toEqual([]);
  });
});

describe("shareStatus", () => {
  const listed = [{ id: SHARE.id } as GalleryEntry];
  it("listed / missing once the list is known", () => {
    expect(shareStatus(SHARE, listed)).toBe("listed");
    expect(shareStatus(SHARE, [])).toBe("missing");
  });
  it("unknown while the list hasn't loaded, so a load error never reads as removed", () => {
    expect(shareStatus(SHARE, null)).toBe("unknown");
  });
});
