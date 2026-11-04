// @vitest-environment node
// #2320 — bring what a browser published before sign-in into the account (the
// claim), and #2321 — My shares and private links that follow the account.
// Against the dev folder stores (gallery and short links), with Auth.js's
// `auth()` mocked so each test says who is signed in.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

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
import { POST as claimRoute } from "../app/api/gallery/claim/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { GET as mySharesRoute } from "../app/api/gallery/me/shares/route";
import { POST as sharePostRoute } from "../app/api/share/route";
import { DELETE as shareDeleteRoute, GET as shareGetRoute } from "../app/api/share/[id]/route";
import { createAuthor } from "../app/api/gallery/authors";
import { hashToken, newManageToken } from "../app/api/gallery/auth";
import { galleryPaths, galleryStore, getJson, putJson } from "../app/api/gallery/store";
import { attachAuthorToAccount } from "../app/api/gallery/session";
import { getDb } from "../db/client";

// #2352 — the gallery's records are in an in-memory Postgres (PGlite) per test
// file. Starting it takes a few seconds, once; do it here, not inside the first test.
beforeAll(() => getDb(), 60_000);

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
/** An entry written the way publishing worked before sign-in, under `authorId`. */
async function legacyEntry(authorId: string | undefined, title: string) {
  const store = galleryStore()!;
  const id = `E${String(++entrySeq).padStart(4, "0")}${Date.now().toString(36)}`.slice(0, 11).padEnd(11, "x");
  const manageToken = newManageToken();
  await putJson(store, galleryPaths.privateRecord(id), { authorEmail: EMAIL, manageTokenHash: hashToken(manageToken) });
  await putJson(store, galleryPaths.manifest(id), manifest);
  if (authorId) await putJson(store, galleryPaths.authorEntry(authorId, id), {});
  const entry: GalleryEntry = {
    id, title, kind: "music", tags: [], authorName: "Old Ada", ...(authorId ? { authorId } : {}),
    publishedAt: Date.now() + entrySeq, fileCount: 1, hasThumbnail: false,
  };
  await putJson(store, galleryPaths.entry(id), entry);
  return { id, manageToken };
}

/** A key-held author from before sign-in, with `count` entries and (optionally) a collection of them. */
async function legacyAuthor(count: number, withCollection = false) {
  const store = galleryStore()!;
  const made = (await createAuthor(store, "Old Ada", EMAIL))!;
  await putJson(store, galleryPaths.author(made.authorId), {
    ...(await getJson<object>(store, galleryPaths.author(made.authorId))),
    bio: "the old bio",
  });
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

    // The old per-author indexes are empty; the new ones hold it all.
    const store = galleryStore()!;
    expect(await store.list(galleryPaths.authorEntriesOf(old.authorId))).toEqual([]);
    expect(await store.list(galleryPaths.authorCollectionsOf(old.authorId))).toEqual([]);
    expect((await store.list(galleryPaths.authorEntriesOf(mine))).length).toBe(2);

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

    const store = galleryStore()!;
    const before = await store.list("gallery/");
    const second = await claimOk(user, body);
    expect(second).toEqual({ authorId: first.authorId, moved: { entries: 0, collections: 0, links: 0 }, refused: [] });
    // Not a single record written or removed. (#2330's counter of claims counts
    // every call, but since #2352 it lives in the database, not here.)
    const after = await store.list("gallery/");
    const records = (bs: typeof before) => bs.map((b) => `${b.pathname}@${b.uploadedAt}`).sort();
    expect(records(after)).toEqual(records(before));
  });

  it("refuses an author that belongs to another account, and moves none of its work", async () => {
    const old = await legacyAuthor(1);
    // Another account linked this author first (e.g. it was claimed by linking).
    const store = galleryStore()!;
    const otherId = freshId();
    const linked = await attachAuthorToAccount(
      store,
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
    const recorded = await readdir(path.join(dir, "gallery/account-links"), { recursive: true });
    expect(recorded.some((f) => String(f).includes(anonMade.id))).toBe(false);
    // Control: the signed-in one IS on disk, so the scan reads the right place.
    expect(recorded.some((f) => String(f).includes(made.id))).toBe(true);
  });
});

describe("#2329 a private link's key never reaches the account", () => {
  /** Every file under the dev store's account-link area, with its contents. */
  async function accountLinkFiles(): Promise<Array<[string, string]>> {
    const root = path.join(dir, "gallery/account-links");
    const names = (await readdir(root, { recursive: true }).catch(() => [] as string[])).map(String);
    const out: Array<[string, string]> = [];
    for (const name of names) {
      const text = await readFile(path.join(root, name), "utf8").catch(() => null); // null: a folder
      if (text !== null) out.push([name, text]);
    }
    return out;
  }

  /** No stored account-link file holds either key or a `#`, and each holds only id, name and date. */
  async function scanStore(when: string, keys: string[]): Promise<number> {
    const files = await accountLinkFiles();
    for (const [name, text] of files) {
      for (const key of keys) expect(text, `${when}: ${name}`).not.toContain(key);
      expect(text, `${when}: ${name}`).not.toContain("#");
      expect(Object.keys(JSON.parse(text)).sort(), `${when}: ${name}`).toEqual(["createdAt", "id", "projectName"]);
    }
    return files.length;
  }

  it("is in no stored account-link file and no response, after a signed-in link, a claim and My shares", async () => {
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
    // Scanned as written, before anything reads the list (a read tidies old records).
    expect(await scanStore("after the signed-in link", [made.key])).toBeGreaterThanOrEqual(1);

    // 2. A claim from an older browser that still sends each link's full url.
    const old = await anonymousLink("Claimed song");
    const oldKey = old.url.split("#")[1];
    await keep("claim", await claim(user, { entries: [], links: [old] }));
    expect(await scanStore("after the claim", [made.key, oldKey])).toBeGreaterThanOrEqual(2);

    // 3. My shares.
    await keep("my shares", await myShares(user));

    const files = await accountLinkFiles();
    const mine = files.filter(([name]) => name.includes(madeId) || name.includes(old.id));
    // Controls: both links are on the account, and the scan reads real records.
    expect(mine).toHaveLength(2);
    expect(mine.map(([, text]) => JSON.parse(text))).toEqual(
      expect.arrayContaining([
        { id: madeId, projectName: "Made signed in", createdAt: expect.any(Number) },
        { id: old.id, projectName: "Claimed song", createdAt: old.createdAt },
      ]),
    );
    expect(oldKey).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(bodies.find(([l]) => l === "my shares")![1]).toContain(madeId);

    // The scan: EVERY stored account-link file (all accounts in this store), then every response.
    expect(await scanStore("after My shares", [made.key, oldKey])).toBeGreaterThanOrEqual(2);
    for (const [label, body] of bodies) {
      expect(body, label).not.toContain(made.key);
      expect(body, label).not.toContain(oldKey);
      expect(body, label).not.toContain("#");
    }
  });

  it("strips the full link from an account record written before #2329, once, as it is read", async () => {
    const user = freshId();
    await openAppAs(user);
    const link = await anonymousLink("Old record song");
    const store = galleryStore()!;
    const { accountHashOf } = await import("../app/api/gallery/session");
    const accountHash = accountHashOf("test-login", user);
    const where = galleryPaths.accountLink(accountHash, link.id);
    // What #2321 wrote: the whole link, key included (and a stray key field for good measure).
    await putJson(store, where, { id: link.id, url: link.url, key: link.url.split("#")[1], projectName: "Old record song", createdAt: 7 });
    const onDisk = () => readFile(path.join(dir, where), "utf8");
    expect(await onDisk()).toContain("#"); // control: the old record really holds the link

    const res = await myShares(user);
    const text = await res.text();
    expect(JSON.parse(text).links).toEqual([{ id: link.id, projectName: "Old record song", createdAt: 7 }]);
    expect(text).not.toContain(link.url.split("#")[1]);
    // Rewritten on disk without it.
    expect(JSON.parse(await onDisk())).toEqual({ id: link.id, projectName: "Old record song", createdAt: 7 });

    // Once: a second read leaves the clean record alone (same bytes, same mtime).
    const { stat } = await import("node:fs/promises");
    const before = (await stat(path.join(dir, where))).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect((await mySharesOk(user)).links).toHaveLength(1);
    expect((await stat(path.join(dir, where))).mtimeMs).toBe(before);
  });
});

describe("the email stays on the server (#2320 / #2321 routes)", () => {
  it("appears in no response from the claim, My shares, a moved profile or a link", async () => {
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
    signIn(user);
    const { sealed, key } = await sealShare(new TextEncoder().encode("x"));
    await keep(
      "share POST signed in",
      await sharePostRoute(new Request("http://x/api/share", { method: "POST", body: sealed as BodyInit, headers: { [OLD_KEY_HEADER]: key } })),
    );
    signIn(user);
    await keep("share DELETE by session", await revoke(link.id));

    const byLabel = Object.fromEntries(bodies);
    // Controls: the routes answered with real data.
    expect(byLabel["claim"]).toContain(mine);
    expect(byLabel["my shares"]).toContain(old.entries[0].id);
    expect(byLabel["moved profile"]).toContain(mine);
    expect(byLabel["share POST signed in"]).toContain("onAccount");
    for (const [label, body] of bodies) {
      expect(body, label).not.toContain(EMAIL);
      expect(body, label).not.toContain("example-privacy-three.test");
    }
  });
});

describe("a store-less production build", () => {
  it("answers 503 on the claim and My shares", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STAVE_SHARE_DEV_STORE", "");
    expect((await claim(freshId(), { entries: [], links: [] })).status).toBe(503);
    expect((await myShares(freshId())).status).toBe(503);
  });
});

