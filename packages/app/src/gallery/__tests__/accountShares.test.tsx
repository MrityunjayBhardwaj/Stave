// @vitest-environment jsdom
/**
 * #2320 / #2321 — the browser side: what a claim sends and marks, the toast it
 * earns, My shares merging the account's list with this browser's, an old
 * profile link followed to the new one, and the signed-in overlay managing
 * things through the session (no keys sent).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const confirmMock = vi.fn(async () => true);
vi.mock("../../dialogs/host", () => ({
  getDialog: () => null,
  showConfirm: (...a: unknown[]) => confirmMock(...(a as [])),
  showPrompt: vi.fn(async () => null),
  showToast: vi.fn(),
}));

import { GalleryOverlay } from "../GalleryOverlay";
import { fetchAuthorPage } from "../client";
import { resetClaimRunForTests, runClaimOnce } from "../claimRun";
import {
  addLocalShare,
  addPrivateLink,
  listLocalShares,
  listPrivateLinks,
  loadAuthor,
  markClaimed,
  pendingClaim,
  saveAuthor,
  type LocalPrivateLink,
  type LocalShare,
} from "../localShares";
import { claimToasts, movedPhrase, myRows } from "../myShares";
import { resetGallerySessionForTests } from "../session";
import { MANAGE_TOKEN_HEADER, MAX_CLAIM_ITEMS, type ClaimResponse, type GalleryEntry, type MySharesResponse } from "../types";

const ME = "acctAuthor1";
const SHARE = (id: string, publishedAt: number, over: Partial<LocalShare> = {}): LocalShare => ({
  id, title: `Local ${id}`, kind: "music", publishedAt, manageToken: `tok-${id}`, ...over,
});
const LINK = (id: string, createdAt: number, over: Partial<LocalPrivateLink> = {}): LocalPrivateLink => ({
  id, url: `http://x/s/${id}#${"k".repeat(22)}`, projectName: `Song ${id}`, createdAt, manageToken: `lt-${id}`, ...over,
});
const ENTRY = (id: string, publishedAt: number): GalleryEntry => ({
  id, title: `Account ${id}`, kind: "music", tags: [], authorName: "Ada", authorId: ME, publishedAt, fileCount: 1, hasThumbnail: false,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetClaimRunForTests();
  resetGallerySessionForTests();
});
beforeEach(() => confirmMock.mockClear());

describe("what a claim sends and marks", () => {
  it("sends the author key, entries and links not yet claimed for this account, and nothing once marked", () => {
    expect(pendingClaim(ME)).toBeNull();
    saveAuthor({ name: "Old", email: "", authorId: "oldAuthor01", authorKey: "old-key" });
    addLocalShare(SHARE("e1xxxxxxxxx", 1));
    addPrivateLink(LINK("l1xxxxxxxxx", 2));
    addPrivateLink(LINK("l2xxxxxxxxx", 3, { claimedBy: ME })); // recorded on the account when made

    const req = pendingClaim(ME)!;
    expect(req).toEqual({
      authorKey: "old-key",
      entries: [{ id: "e1xxxxxxxxx", manageToken: "tok-e1xxxxxxxxx" }],
      // #2329 — never the url: the link's key stays in this browser.
      links: [{ id: "l1xxxxxxxxx", manageToken: "lt-l1xxxxxxxxx", projectName: "Song l1xxxxxxxxx", createdAt: 2 }],
    });
    expect(JSON.stringify(req)).not.toContain("#");

    markClaimed(ME, req);
    expect(pendingClaim(ME)).toBeNull();
    // The keys stay: only the mark is added.
    expect(loadAuthor()).toMatchObject({ authorKey: "old-key", claimedBy: ME });
    expect(listLocalShares()[0]).toMatchObject({ manageToken: "tok-e1xxxxxxxxx", claimedBy: ME });
    expect(listPrivateLinks().map((l) => l.manageToken)).toEqual(["lt-l2xxxxxxxxx", "lt-l1xxxxxxxxx"]);
    // A different account on this browser still gets asked.
    expect(pendingClaim("someoneElse")?.entries).toHaveLength(1);
  });

  it(`#2345: sends at most ${MAX_CLAIM_ITEMS} entries and links at a time, and the rest on the next claim`, () => {
    const extra = 7;
    for (let i = 0; i < MAX_CLAIM_ITEMS + extra; i++) {
      const n = String(i).padStart(3, "0");
      addLocalShare(SHARE(`e${n}xxxxxxx`, i));
      addPrivateLink(LINK(`l${n}xxxxxxx`, i));
    }
    const first = pendingClaim(ME)!;
    expect(first.entries).toHaveLength(MAX_CLAIM_ITEMS);
    expect(first.links).toHaveLength(MAX_CLAIM_ITEMS);
    markClaimed(ME, first);
    const second = pendingClaim(ME)!;
    expect(second.entries).toHaveLength(extra);
    expect(second.links).toHaveLength(extra);
    expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(MAX_CLAIM_ITEMS + extra);
    markClaimed(ME, second);
    expect(pendingClaim(ME)).toBeNull();
  });

  it("marks a refused item refused, not claimed, so it stays 'only in this browser' and isn't re-sent", () => {
    addLocalShare(SHARE("e1xxxxxxxxx", 1));
    addLocalShare(SHARE("e2xxxxxxxxx", 2));
    const req = pendingClaim(ME)!;
    markClaimed(ME, req, [{ what: "entry e2xxxxxxxxx", kind: "entry", id: "e2xxxxxxxxx", reason: "it belongs to another account" }]);
    expect(pendingClaim(ME)).toBeNull();
    const byId = Object.fromEntries(listLocalShares().map((s) => [s.id, s]));
    expect(byId["e1xxxxxxxxx"]).toMatchObject({ claimedBy: ME });
    expect(byId["e2xxxxxxxxx"]).toMatchObject({ claimRefusedBy: ME });
    expect(byId["e2xxxxxxxxx"].claimedBy).toBeUndefined();
    const rows = myRows({ authorId: ME, entries: [ENTRY("e1xxxxxxxxx", 1)], collections: [], links: [] }, listLocalShares(), []);
    expect(rows.entries.map((r) => [r.id, r.home])).toEqual([
      ["e2xxxxxxxxx", "browser"],
      ["e1xxxxxxxxx", "account"],
    ]);
  });

  it("an item the account took but no longer lists (deleted on another device) is not shown again", () => {
    const rows = myRows(
      { authorId: ME, entries: [], collections: [], links: [] },
      [SHARE("gone0000000", 1, { claimedBy: ME })],
      [LINK("lgone000000", 1, { claimedBy: ME })],
    );
    expect(rows.entries).toEqual([]);
    expect(rows.links).toEqual([]);
  });

  it("runs once, toasts what came in, and marks only after the server answered", async () => {
    addLocalShare(SHARE("e1xxxxxxxxx", 1));
    const toast = vi.fn();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await runClaimOnce(ME, { claim: failing, toast })).toBeNull();
    expect(pendingClaim(ME)).not.toBeNull(); // not marked: the next load tries again
    expect(await runClaimOnce(ME, { claim: failing, toast })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1); // once per page load

    resetClaimRunForTests();
    const answer: ClaimResponse = { authorId: ME, moved: { entries: 3, collections: 1, links: 2 }, refused: [] };
    const claim = vi.fn(async () => answer);
    expect(await runClaimOnce(ME, { claim, toast })).toEqual(answer);
    expect(toast).toHaveBeenCalledWith("Brought 3 entries, 1 collection and 2 private links into your account.", "info");
    expect(pendingClaim(ME)).toBeNull();
  });

  it("says plainly what it couldn't bring", () => {
    expect(movedPhrase({ entries: 1, collections: 0, links: 0 })).toBe("1 entry");
    expect(movedPhrase({ entries: 0, collections: 2, links: 1 })).toBe("2 collections and 1 private link");
    expect(movedPhrase({ entries: 0, collections: 0, links: 0 })).toBe("");
    expect(
      claimToasts({
        authorId: ME,
        moved: { entries: 0, collections: 0, links: 0 },
        refused: [
          { what: "your old profile", kind: "author", reason: "that profile belongs to another account" },
          { what: "entry X", kind: "entry", id: "X", reason: "it belongs to another account" },
        ],
      }),
    ).toEqual([
      {
        text: "Couldn't bring your old profile into your account: that profile belongs to another account (and 1 more). It stays in this browser.",
        kind: "error",
      },
    ]);
  });
});

describe("My shares rows", () => {
  it("signed out: this browser's own; signed in: the account's, then local ones it lacks, marked as browser", () => {
    const local = [SHARE("both0000000", 5), SHARE("local000000", 1)];
    const links = [LINK("lboth000000", 4), LINK("llocal00000", 2)];
    const out = myRows(null, local, links);
    expect(out.entries.map((e) => [e.id, e.home, e.manageToken])).toEqual([
      ["both0000000", "browser", "tok-both0000000"],
      ["local000000", "browser", "tok-local000000"],
    ]);

    const account: MySharesResponse = {
      authorId: ME,
      entries: [ENTRY("both0000000", 5), ENTRY("acct0000000", 3)],
      collections: [],
      links: [
        { id: "lboth000000", projectName: "P", createdAt: 4 },
        { id: "lelse000000", projectName: "Made elsewhere", createdAt: 3 },
      ],
    };
    const signed = myRows(account, local, links);
    expect(signed.entries.map((e) => [e.id, e.home, e.manageToken])).toEqual([
      ["both0000000", "account", null],
      ["acct0000000", "account", null],
      ["local000000", "browser", "tok-local000000"],
    ]);
    // #2329 — a row can be copied only when this browser holds the link.
    expect(signed.links.map((l) => [l.id, l.home, l.url])).toEqual([
      ["lboth000000", "account", LINK("lboth000000", 4).url],
      ["lelse000000", "account", null],
      ["llocal00000", "browser", LINK("llocal00000", 2).url],
    ]);
  });
});

describe("an old profile link", () => {
  it("follows { movedTo } to the profile it was merged into", async () => {
    const page = { author: { authorId: "newAuthor01", name: "Ada", bio: "", createdAt: 1, updatedAt: 1 }, entries: [], collections: [] };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/oldAuthor01") ? Response.json({ movedTo: "newAuthor01" }) : Response.json(page),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAuthorPage("oldAuthor01")).toEqual(page);
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["/api/gallery/authors/oldAuthor01", "/api/gallery/authors/newAuthor01"]);
  });
});

describe("the overlay signed in", () => {
  it("lists the account's shares and this browser's extras, and deletes and revokes through the session", async () => {
    resetGallerySessionForTests({
      status: "ready",
      session: { signInAvailable: true, providers: [], user: { name: "Ada", authorId: ME, verified: { provider: "github", login: "ada" } } },
    });
    addLocalShare(SHARE("local000000", 1));
    let account: MySharesResponse = {
      authorId: ME,
      entries: [ENTRY("acct0000000", 3)],
      collections: [{ id: "coll0000000", authorId: ME, title: "EP", description: "", entryIds: ["acct0000000"], createdAt: 1, updatedAt: 1 }],
      links: [{ id: "lacct000000", projectName: "Linked", createdAt: 4 }],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      if (key === "GET /api/gallery") return Response.json({ entries: [ENTRY("acct0000000", 3)] });
      if (key === "GET /api/gallery/me/shares") return Response.json(account);
      if (key === "DELETE /api/gallery/acct0000000") {
        account = { ...account, entries: [] };
        return new Response(null, { status: 204 });
      }
      if (key === "DELETE /api/share/lacct000000") {
        account = { ...account, links: [] };
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GalleryOverlay open initialEntryId={null} onClose={vi.fn()} onOpenAsProject={vi.fn()} onAddToProject={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);

    await waitFor(() => expect(document.querySelector('[data-gallery-mine="acct0000000"]')).not.toBeNull());
    expect(document.querySelector('[data-gallery-mine-source="account"]')).not.toBeNull();
    const acct = document.querySelector('[data-gallery-mine="acct0000000"]') as HTMLElement;
    const local = document.querySelector('[data-gallery-mine="local000000"]') as HTMLElement;
    expect(acct.textContent).not.toContain("only in this browser");
    expect(local.textContent).toContain("only in this browser");
    expect(document.querySelector('[data-gallery-my-collection="coll0000000"]')).not.toBeNull();
    expect(document.querySelector('[data-gallery-links-note]')!.textContent).toContain("only you can see this list");
    expect(document.querySelector('[data-gallery-links-note]')!.textContent).toContain(
      "A link's key is kept only in the browser that made it",
    );
    expect(document.querySelector('[data-gallery-my-profile]')!.getAttribute("data-gallery-my-profile")).toBe(ME);

    fireEvent.click(within(acct).getByText("Delete"));
    await waitFor(() => expect(document.querySelector('[data-gallery-mine="acct0000000"]')).toBeNull());
    const del = fetchMock.mock.calls.find(([u, i]) => u === "/api/gallery/acct0000000" && i?.method === "DELETE")!;
    expect((del[1]!.headers as Record<string, string>)[MANAGE_TOKEN_HEADER]).toBeUndefined();

    const link = document.querySelector('[data-gallery-link="lacct000000"]') as HTMLElement;
    fireEvent.click(within(link).getByText("Revoke"));
    await waitFor(() => expect(document.querySelector('[data-gallery-link="lacct000000"]')).toBeNull());
    const rev = fetchMock.mock.calls.find(([u, i]) => u === "/api/share/lacct000000" && i?.method === "DELETE")!;
    expect((rev[1]!.headers as Record<string, string>)[MANAGE_TOKEN_HEADER]).toBeUndefined();
  });

  it("#2329 offers Copy again only for a link this browser made; one made elsewhere can only be revoked", async () => {
    resetGallerySessionForTests({
      status: "ready",
      session: { signInAvailable: true, providers: [], user: { name: "Ada", authorId: ME, verified: { provider: "github", login: "ada" } } },
    });
    addPrivateLink(LINK("lhere000000", 5, { claimedBy: ME }));
    const account: MySharesResponse = {
      authorId: ME,
      entries: [],
      collections: [],
      links: [
        { id: "lhere000000", projectName: "Made here", createdAt: 5 },
        { id: "lelse000000", projectName: "Made elsewhere", createdAt: 4 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/gallery/me/shares" ? Response.json(account) : url === "/api/gallery" ? Response.json({ entries: [] }) : new Response(null, { status: 404 }),
      ),
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<GalleryOverlay open initialEntryId={null} onClose={vi.fn()} onOpenAsProject={vi.fn()} onAddToProject={vi.fn()} />);
    fireEvent.click(document.querySelector('[data-gallery-tab="mine"]')!);

    await waitFor(() => expect(document.querySelector('[data-gallery-link="lelse000000"]')).not.toBeNull());
    const here = document.querySelector('[data-gallery-link="lhere000000"]') as HTMLElement;
    const elsewhere = document.querySelector('[data-gallery-link="lelse000000"]') as HTMLElement;

    expect(within(here).queryByText("Copy again")).not.toBeNull();
    expect(within(here).queryByText("Revoke")).not.toBeNull();
    expect(here.querySelector("[data-gallery-link-elsewhere]")).toBeNull();

    expect(within(elsewhere).queryByText("Copy again")).toBeNull();
    expect(within(elsewhere).queryByText("Revoke")).not.toBeNull();
    expect(elsewhere.querySelector("[data-gallery-link-elsewhere]")!.textContent).toBe(
      "Made on another device. The link's key is only kept there.",
    );

    fireEvent.click(within(here).getByText("Copy again"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK("lhere000000", 5).url));
  });
});
