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
import { claimToasts, countMine, mineItems, movedPhrase, myRows, shownMine, type MyRows } from "../myShares";
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

describe("#2492 My shares as one list", () => {
  const row = (id: string, home: "account" | "browser", publishedAt = 1, title = id) => ({
    id, title, kind: "music" as const, publishedAt, manageToken: home === "browser" ? "t" : null, home,
  });
  const link = (id: string, home: "account" | "browser", createdAt = 1, projectName = id) => ({
    id, url: null, projectName, createdAt, manageToken: null, home,
  });
  const rows = (entries: MyRows["entries"], links: MyRows["links"] = []): MyRows => ({ entries, links, collections: [] });
  const pills = (r: MyRows, listed: GalleryEntry[] | null, signedIn: boolean) =>
    mineItems(r, listed, signedIn).map((i) => [i.row.id, i.pill]);

  it("gives each row one pill: Removed, then Only in this browser, then In the gallery / Private link", () => {
    const r = rows(
      [row("acct0000000", "account"), row("here0000000", "browser"), row("gone0000000", "browser")],
      [link("lacct000000", "account"), link("lhere000000", "browser")],
    );
    const listed = [ENTRY("acct0000000", 1), ENTRY("here0000000", 1)];
    expect(pills(r, listed, true)).toEqual([
      ["acct0000000", "gallery"],
      ["here0000000", "browser"],
      ["gone0000000", "removed"],
      ["lacct000000", "private"],
      ["lhere000000", "browser"],
    ]);
    // Signed out everything is this browser's, so that isn't said.
    expect(pills(r, listed, false)).toEqual([
      ["acct0000000", "gallery"],
      ["here0000000", "gallery"],
      ["gone0000000", "removed"],
      ["lacct000000", "private"],
      ["lhere000000", "private"],
    ]);
  });

  it("claims nothing about a browser row while the list hasn't loaded (a load error is never 'Removed')", () => {
    const r = rows([row("acct0000000", "account"), row("here0000000", "browser")]);
    expect(pills(r, null, false)).toEqual([
      ["acct0000000", "gallery"],
      ["here0000000", null],
    ]);
    // Signed in, a browser row is still only in this browser, loaded or not.
    expect(pills(r, null, true)).toEqual([
      ["acct0000000", "gallery"],
      ["here0000000", "browser"],
    ]);
  });

  it("filters, searches titles, counts per filter for the search, and orders", () => {
    const items = mineItems(
      rows([row("e1", "browser", 3, "Dub one"), row("e2", "browser", 1, "ambient")], [link("l1", "browser", 2, "Dub link")]),
      [],
      false,
    );
    const ids = (f: "all" | "published" | "links", q: string, s: "newest" | "oldest" | "title") =>
      shownMine(items, f, q, s).map((i) => i.row.id);
    expect(ids("all", "", "newest")).toEqual(["e1", "l1", "e2"]);
    expect(ids("all", "", "oldest")).toEqual(["e2", "l1", "e1"]);
    expect(ids("all", "", "title")).toEqual(["e2", "l1", "e1"]); // case-blind: ambient, Dub link, Dub one
    expect(ids("published", "", "newest")).toEqual(["e1", "e2"]);
    expect(ids("links", "", "newest")).toEqual(["l1"]);
    expect(ids("all", "dub", "newest")).toEqual(["e1", "l1"]);
    expect(countMine(items, "")).toEqual({ all: 3, published: 2, links: 1 });
    expect(countMine(items, "dub")).toEqual({ all: 2, published: 1, links: 1 });
    expect(countMine(items, "nothing")).toEqual({ all: 0, published: 0, links: 0 });
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
    addLocalShare(SHARE("lgone000000", 0));
    let account: MySharesResponse = {
      authorId: ME,
      entries: [ENTRY("acct0000000", 3)],
      collections: [{ id: "coll0000000", authorId: ME, title: "EP", description: "", entryIds: ["acct0000000"], createdAt: 1, updatedAt: 1 }],
      links: [{ id: "lacct000000", projectName: "Linked", createdAt: 4 }],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      // local000000 is still in the gallery; lgone000000 was taken down.
      if (key === "GET /api/gallery") return Response.json({ entries: [ENTRY("acct0000000", 3), ENTRY("local000000", 1)] });
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
    await waitFor(() => expect(local.querySelector("[data-gallery-pill]")?.textContent).toBe("Only in this browser"));
    // #2492 — one pill a row: the account's is in the gallery; removed outranks "only in this browser".
    expect(acct.querySelector("[data-gallery-pill]")!.textContent).toBe("In the gallery");
    const gone = document.querySelector('[data-gallery-mine="lgone000000"]') as HTMLElement;
    expect(gone.querySelector("[data-gallery-pill]")!.textContent).toBe("Removed");
    expect(document.querySelector('[data-gallery-link="lacct000000"] [data-gallery-pill]')!.textContent).toBe("Private link");
    expect(document.querySelector("[data-gallery-mine-who]")!.textContent).toBe(
      "Signed in as Ada with GitHub. Everything you've shared, from any device.",
    );
    expect(document.querySelector('[data-gallery-my-collection="coll0000000"]')).not.toBeNull();
    expect(document.querySelector('[data-gallery-links-note]')!.textContent).toContain("only you can see this list");
    expect(document.querySelector('[data-gallery-links-note]')!.textContent).toContain(
      "A link's key is kept only in the browser that made it",
    );
    expect(document.querySelector('[data-gallery-my-profile]')!.getAttribute("data-gallery-my-profile")).toBe(ME);

    pickFromMenu(acct, "Delete");
    await waitFor(() => expect(document.querySelector('[data-gallery-mine="acct0000000"]')).toBeNull());
    const del = fetchMock.mock.calls.find(([u, i]) => u === "/api/gallery/acct0000000" && i?.method === "DELETE")!;
    expect((del[1]!.headers as Record<string, string>)[MANAGE_TOKEN_HEADER]).toBeUndefined();

    const link = document.querySelector('[data-gallery-link="lacct000000"]') as HTMLElement;
    pickFromMenu(link, "Revoke");
    await waitFor(() => expect(document.querySelector('[data-gallery-link="lacct000000"]')).toBeNull());
    const rev = fetchMock.mock.calls.find(([u, i]) => u === "/api/share/lacct000000" && i?.method === "DELETE")!;
    expect((rev[1]!.headers as Record<string, string>)[MANAGE_TOKEN_HEADER]).toBeUndefined();
  });

  it("#2329 offers Copy link only for a link this browser made; one made elsewhere can only be revoked", async () => {
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

    expect(within(here).queryByText("Copy link")).not.toBeNull();
    expect(here.querySelector("[data-gallery-link-elsewhere]")).toBeNull();

    expect(within(elsewhere).queryByText("Copy link")).toBeNull();
    // Revoke is under ⋯ on both.
    for (const row of [here, elsewhere]) {
      fireEvent.click(row.querySelector("[data-gallery-more]")!);
      expect(within(row).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Revoke"]);
      fireEvent.click(row.querySelector("[data-gallery-more]")!);
    }
    expect(elsewhere.querySelector("[data-gallery-link-elsewhere]")!.textContent).toBe(
      "Made on another device. The link's key is only kept there.",
    );

    fireEvent.click(within(here).getByText("Copy link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK("lhere000000", 5).url));
  });
});

/** Open a My shares row's ⋯ menu and pick `label`. */
function pickFromMenu(row: HTMLElement, label: string): void {
  fireEvent.click(row.querySelector("[data-gallery-more]")!);
  fireEvent.click(within(row).getByRole("menuitem", { name: label }));
}
