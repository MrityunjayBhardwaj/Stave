// @vitest-environment jsdom
/**
 * #2311 — the private links this browser made: remembered newest first, and
 * revoked only through the server (forgotten here once it agreed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addPrivateLink,
  listPrivateLinks,
  LOCAL_SHARES_CHANGED,
  removePrivateLink,
  type LocalPrivateLink,
} from "../localShares";
import { revokeMyLink, type RevokeDeps } from "../myShares";

const link = (id: string, createdAt: number): LocalPrivateLink => ({
  id,
  url: `http://x/s/${id}#key`,
  projectName: `Project ${id}`,
  createdAt,
  manageToken: `tok-${id}`,
});

afterEach(() => localStorage.clear());

describe("remembered private links", () => {
  it("lists newest first, replaces by id, and tells an open My shares tab", () => {
    const heard = vi.fn();
    window.addEventListener(LOCAL_SHARES_CHANGED, heard);
    addPrivateLink(link("a", 1));
    addPrivateLink(link("b", 3));
    addPrivateLink({ ...link("a", 2), projectName: "renamed" });
    expect(listPrivateLinks().map((l) => [l.id, l.projectName])).toEqual([
      ["b", "Project b"],
      ["a", "renamed"],
    ]);
    removePrivateLink("b");
    expect(listPrivateLinks().map((l) => l.id)).toEqual(["a"]);
    expect(heard).toHaveBeenCalledTimes(4);
    window.removeEventListener(LOCAL_SHARES_CHANGED, heard);
  });

  it("reads a corrupted store as empty rather than throwing", () => {
    localStorage.setItem("stave.share.links", "{not json");
    expect(listPrivateLinks()).toEqual([]);
  });

  it("is kept apart from gallery entries", () => {
    addPrivateLink(link("a", 1));
    expect(localStorage.getItem("stave.gallery.shares")).toBeNull();
  });
});

describe("revoking a private link", () => {
  const deps = (over: Partial<RevokeDeps> = {}): RevokeDeps & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      confirm: async () => (calls.push("confirm"), true),
      revoke: async (id, token) => void calls.push(`revoke ${id} ${token}`),
      forget: (id) => void calls.push(`forget ${id}`),
      ...over,
    };
  };

  it("asks, revokes with this browser's token, then forgets", async () => {
    const d = deps();
    expect(await revokeMyLink(link("a", 1), d)).toBe("revoked");
    expect(d.calls).toEqual(["confirm", "revoke a tok-a", "forget a"]);
  });

  it("does nothing when the person says no", async () => {
    const d = deps({ confirm: async () => false });
    expect(await revokeMyLink(link("a", 1), d)).toBe("cancelled");
    expect(d.calls).toEqual([]);
  });

  it("keeps the link (and its key) when the server refuses, so it can be tried again", async () => {
    const d = deps({
      revoke: async () => {
        throw new Error("that key doesn't match this link");
      },
    });
    await expect(revokeMyLink(link("a", 1), d)).rejects.toThrow("doesn't match");
    expect(d.calls).not.toContain("forget a");
  });
});
