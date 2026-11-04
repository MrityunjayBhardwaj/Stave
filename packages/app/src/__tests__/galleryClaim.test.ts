// @vitest-environment node
// #2320 — bring what a browser published before sign-in into the account (the
// claim), and #2321 — My shares and private links that follow the account.
// #2352 — the records are in Postgres (PGlite here); the short links' sealed
// bytes and manage-token hashes are in the dev folder share store. Auth.js's
// `auth()` is mocked so each test says who is signed in.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown, failLinkRecord: false }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));
// #2352 — a failure injected into the repository: recording a link on the
// account throws (the claim records links last, after every other move).
vi.mock("../db/repo/links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/repo/links")>();
  return {
    ...actual,
    recordAccountLink: vi.fn(async (...args: Parameters<typeof actual.recordAccountLink>) => {
      if (fake.failLinkRecord) throw new TypeError("injected failure: recording the link");
      return actual.recordAccountLink(...args);
    }),
  };
});

import {
  AUTHOR_KEY_HEADER,
  MANAGE_TOKEN_HEADER,
  SHARE_LINK_NAME_HEADER,
  type AuthorMovedResponse,
  type AuthorPageResponse,
  type ClaimResponse,
  type GalleryCollection,
  type GalleryEntry,
  type GalleryManifest,
  type GallerySessionResponse,
  type MySharesResponse,
} from "../gallery/types";
import { sealShare } from "../shareCrypto";
import { GET as authorGetRoute, PUT as authorPutRoute } from "../app/api/gallery/authors/[authorId]/route";
import { POST as collectionPostRoute } from "../app/api/gallery/collections/route";
import { GET as collectionGetRoute } from "../app/api/gallery/collections/[id]/route";
import { POST as claimRoute } from "../app/api/gallery/claim/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { GET as mySharesRoute } from "../app/api/gallery/me/shares/route";
import { POST as sharePostRoute } from "../app/api/share/route";
import { DELETE as shareDeleteRoute, GET as shareGetRoute } from "../app/api/share/[id]/route";
import { createAuthor } from "../app/api/gallery/authors";
import { hashToken, newManageToken } from "../app/api/gallery/auth";
import { galleryPaths, galleryStore, putJson } from "../app/api/gallery/store";
import { accountHashOf, attachAuthorToAccount } from "../app/api/gallery/session";
import { getDb, useDbForTests, type Db } from "../db/client";
import { getAuthor as storedAuthor, updateAuthorProfile } from "../db/repo/accounts";
import { collectionsOfAuthor } from "../db/repo/collections";
import { entriesOfAuthor, getEntryRecord, insertEntry } from "../db/repo/entries";
import { listAccountLinks as linksOnAccount } from "../db/repo/links";
import { rowsOf } from "../db/repo/tx";
import { sql } from "drizzle-orm";

// #2352 — the gallery's records are in an in-memory Postgres (PGlite) per test
// file. Starting it takes a few seconds, once; do it here, not inside the first test.
beforeAll(() => getDb(), 60_000);
const db = async (): Promise<Db> => (await getDb())!;

const EMAIL = "qq.distinctive.claim+account@example-privacy-three.test";
/** #2329 — the key header browsers sent before #2329. The server must ignore it. */
const OLD_KEY_HEADER = "x-stave-share-key";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-claim-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  fake.session = null;
  fake.failLinkRecord = false;
  useDbForTests(undefined);
});

let n = 0;
const freshId = () => `acct${++n}-${Date.now().toString(36)}`;

function signIn(id: string | null) {
  fake.session = id
    ? {
        user: { name: `Ada ${id}`, email: EMAIL },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};

const json = (method: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const authorCtx = (authorId: string) => ({ params: Promise.resolve({ authorId }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

/** The account's author: what opening the app signed in makes (GET /api/gallery/me). */
async function openAppAs(id: string): Promise<string> {
  signIn(id);
  const me = (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;
  return me.user!.authorId;
}

let entrySeq = 0;
/** An entry written the way publishing worked before sign-in, under `authorId` (manifest in Blob, record in the database). */
async function legacyEntry(authorId: string | undefined, title: string) {
  const id = `E${String(++entrySeq).padStart(4, "0")}${Date.now().toString(36)}`.slice(0, 11).padEnd(11, "x");
  const manageToken = newManageToken();
  await putJson(galleryStore()!, galleryPaths.manifest(id), manifest);
  const entry: GalleryEntry = {
    id, title, kind: "music", tags: [], authorName: "Old Ada", ...(authorId ? { authorId } : {}),
    publishedAt: Date.now() + entrySeq, fileCount: 1, hasThumbnail: false,
  };
  expect(await insertEntry(await db(), { entry, authorEmail: EMAIL, manageTokenHash: hashToken(manageToken) })).toBe(true);
  return { id, manageToken };
}

/** A key-held author from before sign-in, with `count` entries and (optionally) a collection of them. */
async function legacyAuthor(count: number, withCollection = false) {
  const made = (await createAuthor(await db(), "Old Ada", EMAIL))!;
  await updateAuthorProfile(await db(), made.authorId, { name: "Old Ada", bio: "the old bio" });
  const entries = [];
  for (let i = 0; i < count; i++) entries.push(await legacyEntry(made.authorId, `Old ${i}`));
  let collection: GalleryCollection | null = null;
  if (withCollection) {
    signIn(null);
    const res = await collectionPostRoute(
      json("POST", "http://x/api/gallery/collections", { title: "Old EP", description: "", entryIds: entries.map((e) => e.id) }, {
        [AUTHOR_KEY_HEADER]: made.authorKey,
      }),
    );
    expect(res.status).toBe(201);
    collection = ((await res.json()) as { collection: GalleryCollection }).collection;
  }
  return { key: made.authorKey, authorId: made.authorId, entries, collection };
}

/** A private short link, made signed out (the token is all the browser keeps). */
async function anonymousLink(name = "Linked song") {
  signIn(null);
  const { sealed, key } = await sealShare(new TextEncoder().encode(name));
  const res = await sharePostRoute(new Request("http://x/api/share", { method: "POST", body: sealed as BodyInit }));
  expect(res.status).toBe(201);
  const { id, manageToken } = (await res.json()) as { id: string; manageToken: string };
  return { id, manageToken, url: `http://x/s/${id}#${key}`, projectName: name, createdAt: Date.now() };
}

/** Every stored account-link row, every column (as Postgres names them). */
async function storedLinks(): Promise<Array<Record<string, unknown>>> {
  return rowsOf<Record<string, unknown>>(await (await db()).execute(sql`select * from account_links`)).map((r) => ({
    ...r,
    created_at: Number(r.created_at),
  }));
}

/** Every row the claim could touch (the records tables, not the rate-limit counters), in a stable order. */
async function records(): Promise<string[]> {
  const out: string[] = [];
  for (const table of ["authors", "author_keys", "accounts", "entries", "collections", "collection_entries", "account_links"]) {
    const rows = rowsOf<Record<string, unknown>>(await (await db()).execute(sql.raw(`select * from ${table}`)));
    for (const r of rows) out.push(`${table} ${JSON.stringify(r)}`);
  }
  return out.sort();
}

const claim = async (as: string, body: unknown) => {
  signIn(as);
  return claimRoute(json("POST", "http://x/api/gallery/claim", body));
};
const claimOk = async (as: string, body: unknown): Promise<ClaimResponse> => {
  const res = await claim(as, body);
  expect(res.status).toBe(200);
  return (await res.json()) as ClaimResponse;
};
/** Refusals in words, as the toast shows them (kind and id checked where they matter). */
const said = (r: ClaimResponse) => r.refused.map(({ what, reason }) => ({ what, reason }));
const getAuthor = (authorId: string) => authorGetRoute(new Request(`http://x/api/gallery/authors/${authorId}`), authorCtx(authorId));
const myShares = async (as: string | null) => {
  signIn(as);
  return mySharesRoute(new Request("http://x/api/gallery/me/shares"));
};
const mySharesOk = async (as: string): Promise<MySharesResponse> => {
  const res = await myShares(as);
  expect(res.status).toBe(200);
  return (await res.json()) as MySharesResponse;
};
const revoke = (id: string, headers: Record<string, string> = {}) =>
  shareDeleteRoute(new Request(`http://x/api/share/${id}`, { method: "DELETE", headers }), idCtx(id));
const getShare = (id: string) => shareGetRoute(new Request(`http://x/api/share/${id}`), idCtx(id));

describe("#2320 the claim", () => {
  it("merges the old author: entries, collections and links move, the old profile points to the new one", async () => {
    const old = await legacyAuthor(2, true);
    const link = await anonymousLink();
    const user = freshId();
    const mine = await openAppAs(user);
    expect(mine).not.toBe(old.authorId);

    const result = await claimOk(user, { authorKey: old.key, entries: old.entries, links: [link] });
    expect(result).toEqual({ authorId: mine, moved: { entries: 2, collections: 1, links: 1 }, refused: [] });

    // The old profile answers where it went.
    const moved = await getAuthor(old.authorId);
    expect(moved.status).toBe(200);
    expect((await moved.json()) as AuthorMovedResponse).toEqual({ movedTo: mine });
    // ...and can no longer be edited as itself.
    signIn(null);
    const put = await authorPutRoute(
      json("PUT", `http://x/api/gallery/authors/${old.authorId}`, { name: "x", bio: "" }, { [AUTHOR_KEY_HEADER]: old.key }),
      authorCtx(old.authorId),
    );
    expect(put.status).toBe(409);

    // The account's profile has everything, and the old bio came along.
    const page = (await (await getAuthor(mine)).json()) as AuthorPageResponse;
    expect(page.entries.map((e) => e.id).sort()).toEqual(old.entries.map((e) => e.id).sort());
    expect(page.entries.every((e) => e.authorId === mine && e.authorName === `Ada ${user}`)).toBe(true);
    expect(page.collections.map((c) => c.id)).toEqual([old.collection!.id]);
    expect(page.collections[0].entryIds.sort()).toEqual(old.entries.map((e) => e.id).sort());
    expect(page.author.bio).toBe("the old bio");

    // The old author holds nothing; the account's author holds it all.
    expect(await entriesOfAuthor(await db(), old.authorId)).toEqual([]);
    expect(await collectionsOfAuthor(await db(), old.authorId)).toEqual([]);
    expect((await entriesOfAuthor(await db(), mine)).length).toBe(2);
    expect((await storedAuthor(await db(), old.authorId))?.mergedInto).toBe(mine);

    // The old key no longer acts for anyone: it can't make a collection on the retired profile.
    const viaKey = await collectionPostRoute(
      json("POST", "http://x/api/gallery/collections", { title: "x", description: "", entryIds: [] }, { [AUTHOR_KEY_HEADER]: old.key }),
    );
    expect(viaKey.status).toBe(403);

    // The link is on the account: id, name and date, never the link itself (#2329).
    const shares = await mySharesOk(user);
    expect(shares.links).toEqual([{ id: link.id, projectName: link.projectName, createdAt: link.createdAt }]);
  });

  it("changes nothing the second time", async () => {
    const old = await legacyAuthor(1, true);
    const link = await anonymousLink();
    const user = freshId();
    await openAppAs(user);
    const body = { authorKey: old.key, entries: old.entries, links: [link] };
    const first = await claimOk(user, body);
    expect(first.moved).toEqual({ entries: 1, collections: 1, links: 1 });

    const before = await records();
    expect(before.length).toBeGreaterThan(5); // control: the snapshot reads real rows
    const second = await claimOk(user, body);
    expect(second).toEqual({ authorId: first.authorId, moved: { entries: 0, collections: 0, links: 0 }, refused: [] });
    // Not a single record written or removed (every column of every row, times
    // included). #2330's counter of claims counts every call, so it is left out.
    expect(await records()).toEqual(before);
  });

  it("refuses an author that belongs to another account, and moves none of its work", async () => {
    const old = await legacyAuthor(1);
    // Another account linked this author first (e.g. it was claimed by linking).
    const otherId = freshId();
    const linked = await attachAuthorToAccount(
      { provider: "test-login", providerAccountId: otherId, badge: "github", login: otherId },
      EMAIL,
      old.authorId,
    );
    expect(linked.ok).toBe(true);

    const user = freshId();
    const mine = await openAppAs(user);
    const result = await claimOk(user, { authorKey: old.key, entries: [], links: [] });
    expect(result.moved).toEqual({ entries: 0, collections: 0, links: 0 });
    expect(result.refused).toEqual([{ what: "your old profile", kind: "author", reason: "that profile belongs to another account" }]);
    // Its entry stays where it was, by token too.
    const byToken = await claimOk(user, { entries: old.entries, links: [] });
    expect(byToken.refused).toEqual([
      { what: `entry ${old.entries[0].id}`, kind: "entry", id: old.entries[0].id, reason: "it belongs to another account" },
    ]);
    const page = (await (await getAuthor(old.authorId)).json()) as AuthorPageResponse;
    expect(page.entries.map((e) => e.id)).toEqual([old.entries[0].id]);
    expect(((await (await getAuthor(mine)).json()) as AuthorPageResponse).entries).toEqual([]);
  });

  it("refuses an author already merged into a different account", async () => {
    const old = await legacyAuthor(1);
    const first = freshId();
    await openAppAs(first);
    expect((await claimOk(first, { authorKey: old.key, entries: [], links: [] })).moved.entries).toBe(1);

    const second = freshId();
    await openAppAs(second);
    const result = await claimOk(second, { authorKey: old.key, entries: old.entries, links: [] });
    expect(result.moved).toEqual({ entries: 0, collections: 0, links: 0 });
    expect(said(result)).toEqual([
      { what: "your old profile", reason: "that profile belongs to another account" },
      { what: `entry ${old.entries[0].id}`, reason: "it belongs to another account" },
    ]);
  });

  it("ignores a bad key or token, and says why", async () => {
    const old = await legacyAuthor(1);
    const link = await anonymousLink();
    const user = freshId();
    const mine = await openAppAs(user);
    const result = await claimOk(user, {
      authorKey: "not-the-key",
      entries: [{ id: old.entries[0].id, manageToken: "wrong-token" }, { id: "AAAAAAAAAAA", manageToken: "x" }],
      links: [{ ...link, manageToken: "wrong-token" }],
    });
    expect(result.moved).toEqual({ entries: 0, collections: 0, links: 0 });
    expect(said(result)).toEqual([
      { what: "your old profile", reason: "this browser's profile key doesn't match any profile" },
      { what: `entry ${old.entries[0].id}`, reason: "this browser's key for it doesn't match" },
      { what: "entry AAAAAAAAAAA", reason: "it is no longer in the gallery" },
      { what: `private link ${link.id}`, reason: "this browser's key for it doesn't match" },
    ]);
    // Nothing moved.
    const page = (await (await getAuthor(old.authorId)).json()) as AuthorPageResponse;
    expect(page.entries.map((e) => e.id)).toEqual([old.entries[0].id]);
    expect((await mySharesOk(user)).links).toEqual([]);
    expect((await mySharesOk(user)).authorId).toBe(mine);
  });

  it("moves an entry by its token even when it was made under another (unowned) profile, or none", async () => {
    const stray = await legacyAuthor(1); // a second profile this browser once made
    const ancient = await legacyEntry(undefined, "From before profiles");
    const user = freshId();
    const mine = await openAppAs(user);
    const result = await claimOk(user, { entries: [...stray.entries, ancient], links: [] });
    expect(result).toEqual({ authorId: mine, moved: { entries: 2, collections: 0, links: 0 }, refused: [] });
    const ids = ((await (await getAuthor(mine)).json()) as AuthorPageResponse).entries.map((e) => e.id);
    expect(ids.sort()).toEqual([stray.entries[0].id, ancient.id].sort());
    // The stray profile is not retired: only the author key claims a profile.
    expect(((await (await getAuthor(stray.authorId)).json()) as AuthorPageResponse).entries).toEqual([]);
  });

  it("#2352: one that fails halfway leaves NOTHING moved, and the retry moves it all", async () => {
    const old = await legacyAuthor(2, true);
    const stray = await legacyEntry(undefined, "From before profiles");
    const link = await anonymousLink();
    const user = freshId();
    const mine = await openAppAs(user);
    const body = { authorKey: old.key, entries: [...old.entries, stray], links: [link] };
    const before = await records();

    // Recording the link is the claim's LAST write: the merge (two entries, the
    // collection, the retirement) and the stray entry's move have all run by then.
    const { recordAccountLink } = await import("../db/repo/links");
    const calls = vi.mocked(recordAccountLink).mock.calls.length;
    fake.failLinkRecord = true;
    await expect(claim(user, body)).rejects.toThrow("injected failure");
    expect(vi.mocked(recordAccountLink).mock.calls.length).toBe(calls + 1); // control: the failure was reached

    // Not one row changed, and each thing is still where it was.
    expect(await records()).toEqual(before);
    const d = await db();
    expect((await storedAuthor(d, old.authorId))?.mergedInto).toBeUndefined();
    expect((await entriesOfAuthor(d, old.authorId)).map((e) => e.id).sort()).toEqual(old.entries.map((e) => e.id).sort());
    expect((await collectionsOfAuthor(d, old.authorId)).map((c) => c.id)).toEqual([old.collection!.id]);
    expect(await entriesOfAuthor(d, mine)).toEqual([]);
    expect((await getEntryRecord(d, stray.id))?.entry.authorId).toBeUndefined();
    expect(await linksOnAccount(d, accountHashOf("test-login", user))).toEqual([]);

    // The browser retries: everything moves at once.
    fake.failLinkRecord = false;
    const retry = await claimOk(user, body);
    expect(retry).toEqual({ authorId: mine, moved: { entries: 3, collections: 1, links: 1 }, refused: [] });
  });

  it("needs a signed-in session, and a well-formed body", async () => {
    signIn(null);
    const res = await claimRoute(json("POST", "http://x/api/gallery/claim", { entries: [], links: [] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign in to bring your shares into your account" });
    expect((await claim(freshId(), { entries: "nope", links: [] })).status).toBe(400);
    expect((await claim(freshId(), { entries: [{ id: "x" }], links: [] })).status).toBe(400);
  });
});

describe("#2321 shares that follow the account", () => {
  it("lists the account's entries, collections and links, and only the account's", async () => {
    const a = freshId();
    const b = freshId();
    const oldA = await legacyAuthor(2, true);
    const linkA = await anonymousLink("A's song");
    await openAppAs(a);
    await claimOk(a, { authorKey: oldA.key, entries: [], links: [linkA] });
    const oldB = await legacyAuthor(1);
    const linkB = await anonymousLink("B's song");
    await openAppAs(b);
    await claimOk(b, { authorKey: oldB.key, entries: [], links: [linkB] });

    const sharesA = await mySharesOk(a);
    expect(sharesA.entries.map((e) => e.id).sort()).toEqual(oldA.entries.map((e) => e.id).sort());
    expect(sharesA.collections.map((c) => c.id)).toEqual([oldA.collection!.id]);
    expect(sharesA.links.map((l) => l.id)).toEqual([linkA.id]);

    const sharesB = await mySharesOk(b);
    expect(sharesB.entries.map((e) => e.id)).toEqual([oldB.entries[0].id]);
    expect(sharesB.collections).toEqual([]);
    expect(sharesB.links.map((l) => l.id)).toEqual([linkB.id]);

    const res = await myShares(a);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await myShares(null)).status).toBe(401);
  });

  it("another account can't read your links, or revoke them without the token", async () => {
    const a = freshId();
    const link = await anonymousLink("Secret song");
    await openAppAs(a);
    await claimOk(a, { entries: [], links: [link] });

    const b = freshId();
    await openAppAs(b);
    const text = await (await myShares(b)).text();
    expect(text).not.toContain(link.id);
    expect(text).not.toContain(link.url.split("#")[1]);
    signIn(b);
    expect((await revoke(link.id)).status).toBe(403);
    expect((await getShare(link.id)).status).toBe(200);
  });

  it("revokes a link through the session, with no token", async () => {
    const a = freshId();
    const link = await anonymousLink();
    await openAppAs(a);
    await claimOk(a, { entries: [], links: [link] });
    signIn(null);
    expect((await revoke(link.id)).status).toBe(403); // signed out, no token: refused

    signIn(a);
    expect((await revoke(link.id)).status).toBe(204);
    expect((await getShare(link.id)).status).toBe(404);
    expect((await mySharesOk(a)).links).toEqual([]);
  });

  it("a link revoked with its token elsewhere drops out of the account's list", async () => {
    const a = freshId();
    const link = await anonymousLink();
    await openAppAs(a);
    await claimOk(a, { entries: [], links: [link] });
    signIn(null);
    expect((await revoke(link.id, { [MANAGE_TOKEN_HEADER]: link.manageToken })).status).toBe(204);
    expect((await mySharesOk(a)).links).toEqual([]);
  });

  it("records a link made while signed in by id, name and date only; signed out, nothing is recorded", async () => {
    const a = freshId();
    await openAppAs(a);
    const { sealed, key } = await sealShare(new TextEncoder().encode("new song"));
    // An older browser still sends the key header: it is ignored.
    const headers = { [OLD_KEY_HEADER]: key, [SHARE_LINK_NAME_HEADER]: encodeURIComponent("Nüe Song") };
    signIn(a);
    const res = await sharePostRoute(new Request("http://x/api/share", { method: "POST", body: sealed as BodyInit, headers }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; manageToken: string; onAccount: boolean };
    expect(made.onAccount).toBe(true);
    expect(made.manageToken).toBeTruthy(); // still handed back

    const links = (await mySharesOk(a)).links;
    expect(links).toEqual([{ id: made.id, projectName: "Nüe Song", createdAt: expect.any(Number) }]);

    // Signed out: the link is made, the key header is not kept anywhere.
    signIn(null);
    const anon = await sealShare(new TextEncoder().encode("anon"));
    const res2 = await sharePostRoute(
      new Request("http://x/api/share", { method: "POST", body: anon.sealed as BodyInit, headers: { [OLD_KEY_HEADER]: anon.key } }),
    );
    expect(res2.status).toBe(201);
    const anonMade = (await res2.json()) as { id: string; onAccount: boolean };
    expect(anonMade.onAccount).toBe(false);
    const recorded = (await storedLinks()).map((r) => r.share_id);
    expect(recorded).not.toContain(anonMade.id);
    // Control: the signed-in one IS stored, so the scan reads the right place.
    expect(recorded).toContain(made.id);
  });
});

describe("#2329 a private link's key never reaches the account", () => {
  /** #2352 — every stored account-link row (every account), every column. */
  async function accountLinkRows(): Promise<Array<Record<string, unknown>>> {
    return storedLinks();
  }

  /** No stored account-link row holds either key or a `#`, and each holds only account, id, name and date. */
  async function scanStore(when: string, keys: string[]): Promise<number> {
    const rows = await accountLinkRows();
    for (const row of rows) {
      const text = JSON.stringify(row);
      for (const key of keys) expect(text, `${when}: ${text}`).not.toContain(key);
      expect(text, `${when}: ${text}`).not.toContain("#");
      expect(Object.keys(row).sort(), `${when}: ${text}`).toEqual(["account_id", "created_at", "project_name", "share_id"]);
    }
    return rows.length;
  }

  it("is in no stored account-link row and no response, after a signed-in link, a claim and My shares", async () => {
    const user = freshId();
    await openAppAs(user);
    const bodies: Array<[string, string]> = [];
    const keep = async (label: string, res: Response) => {
      bodies.push([label, await res.clone().text()]);
      return res;
    };

    // 1. A link made signed in, by an older browser that still sends the key header.
    const made = await sealShare(new TextEncoder().encode("signed-in song"));
    signIn(user);
    const madeRes = await keep(
      "share POST signed in",
      await sharePostRoute(
        new Request("http://x/api/share", {
          method: "POST",
          body: made.sealed as BodyInit,
          headers: { [OLD_KEY_HEADER]: made.key, [SHARE_LINK_NAME_HEADER]: encodeURIComponent("Made signed in") },
        }),
      ),
    );
    const madeId = ((await madeRes.json()) as { id: string }).id;
    // Scanned as written, before anything reads the list.
    expect(await scanStore("after the signed-in link", [made.key])).toBeGreaterThanOrEqual(1);

    // 2. A claim from an older browser that still sends each link's full url.
    const old = await anonymousLink("Claimed song");
    const oldKey = old.url.split("#")[1];
    await keep("claim", await claim(user, { entries: [], links: [old] }));
    expect(await scanStore("after the claim", [made.key, oldKey])).toBeGreaterThanOrEqual(2);

    // 3. My shares.
    await keep("my shares", await myShares(user));

    const rows = await accountLinkRows();
    const mine = rows.filter((r) => r.share_id === madeId || r.share_id === old.id);
    // Controls: both links are on the account, and the scan reads real records.
    expect(mine).toHaveLength(2);
    const accountHash = accountHashOf("test-login", user);
    expect(mine).toEqual(
      expect.arrayContaining([
        { account_id: accountHash, share_id: madeId, project_name: "Made signed in", created_at: expect.any(Number) },
        { account_id: accountHash, share_id: old.id, project_name: "Claimed song", created_at: old.createdAt },
      ]),
    );
    expect(oldKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(bodies.find(([l]) => l === "my shares")![1]).toContain(madeId);

    // The scan: EVERY stored account-link row (all accounts in this database), then every response.
    expect(await scanStore("after My shares", [made.key, oldKey])).toBeGreaterThanOrEqual(2);
    for (const [label, body] of bodies) {
      expect(body, label).not.toContain(made.key);
      expect(body, label).not.toContain(oldKey);
      expect(body, label).not.toContain("#");
    }
  });

  it("has nowhere to keep one: the table's columns are the account, the id, the name and the date", async () => {
    // #2352 — the Blob records could hold extra fields (an old browser's full
    // link), so they were rewritten as they were read. A table row can't: these
    // are all the columns there are.
    const cols = rowsOf<{ column_name: string }>(
      await (await db()).execute(
        sql`select column_name from information_schema.columns where table_name = 'account_links' order by column_name`,
      ),
    ).map((c) => c.column_name);
    expect(cols).toEqual(["account_id", "created_at", "project_name", "share_id"]);
  });
});

describe("the email stays on the server (#2320 / #2321 routes)", () => {
  it("appears in no response from the claim, My shares, profiles, collections, the session or a link", async () => {
    const old = await legacyAuthor(1, true);
    const link = await anonymousLink();
    const user = freshId();
    const mine = await openAppAs(user);
    const bodies: Array<[string, string]> = [];
    const keep = async (label: string, res: Response) => bodies.push([label, await res.text()]);

    await keep("claim", await claim(user, { authorKey: old.key, entries: old.entries, links: [link] }));
    await keep("claim again", await claim(user, { authorKey: old.key, entries: old.entries, links: [link] }));
    await keep("claim refused", await claim(freshId(), { authorKey: old.key, entries: old.entries, links: [] }));
    await keep("claim 401", await (signIn(null), claimRoute(json("POST", "http://x/api/gallery/claim", {}))));
    await keep("my shares", await myShares(user));
    await keep("moved profile", await getAuthor(old.authorId));
    await keep("new profile", await getAuthor(mine));
    signIn(null);
    await keep(
      "moved profile PUT 409",
      await authorPutRoute(
        json("PUT", `http://x/api/gallery/authors/${old.authorId}`, { name: "x", bio: "" }, { [AUTHOR_KEY_HEADER]: old.key }),
        authorCtx(old.authorId),
      ),
    );
    signIn(user);
    await keep(
      "new profile PUT",
      await authorPutRoute(json("PUT", `http://x/api/gallery/authors/${mine}`, { name: "Ada", bio: "hi" }), authorCtx(mine)),
    );
    signIn(user);
    await keep(
      "collection POST",
      await collectionPostRoute(json("POST", "http://x/api/gallery/collections", { title: "Mine", description: "", entryIds: [old.entries[0].id] })),
    );
    const cid = (JSON.parse(bodies[bodies.length - 1][1]) as { collection: GalleryCollection }).collection.id;
    await keep("collection GET", await collectionGetRoute(new Request(`http://x/api/gallery/collections/${cid}`), idCtx(cid)));
    signIn(user);
    await keep("me", await meRoute(new Request("http://x/api/gallery/me")));
    signIn(user);
    const { sealed, key } = await sealShare(new TextEncoder().encode("x"));
    await keep(
      "share POST signed in",
      await sharePostRoute(new Request("http://x/api/share", { method: "POST", body: sealed as BodyInit, headers: { [OLD_KEY_HEADER]: key } })),
    );
    signIn(user);
    await keep("share DELETE by session", await revoke(link.id));

    const byLabel = Object.fromEntries(bodies);
    // Controls: the email IS stored (on the account's author, and on the moved
    // entry's private side), and the routes answered with real data.
    expect((await storedAuthor(await db(), mine))?.email).toBe(EMAIL);
    expect((await getEntryRecord(await db(), old.entries[0].id))?.authorEmail).toBe(EMAIL);
    expect(byLabel["claim"]).toContain(mine);
    expect(byLabel["collection GET"]).toContain(old.entries[0].id);
    expect(byLabel["me"]).toContain(mine);
    expect(byLabel["new profile PUT"]).toContain("hi");
    expect(byLabel["my shares"]).toContain(old.entries[0].id);
    expect(byLabel["moved profile"]).toContain(mine);
    expect(byLabel["share POST signed in"]).toContain("onAccount");
    for (const [label, body] of bodies) {
      expect(body, label).not.toContain(EMAIL);
      expect(body, label).not.toContain("example-privacy-three.test");
    }
  });
});

describe("a production build with no database", () => {
  it("answers 503 on the claim and My shares", async () => {
    useDbForTests(null);
    expect((await claim(freshId(), { entries: [], links: [] })).status).toBe(503);
    expect((await myShares(freshId())).status).toBe(503);
  });
});

