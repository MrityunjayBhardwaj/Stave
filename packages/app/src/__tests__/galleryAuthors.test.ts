// @vitest-environment node
// #2314 / #2315 — authors (profiles) and collections against the dev folder
// store: authors made on publish, the profile page, editing it, collections of
// your own entries, takedowns leaving every page, and the rule that the email
// never leaves the server.
//
// #2319 — who is asking comes from the signed-in session. Auth.js's `auth()` is
// mocked at module level (src/auth.ts), so each test says who is signed in. A
// "who" token stands for a caller: `user:<id>` is signed in as that account; any
// other string is sent as the old author key (things made before sign-in).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import {
  AUTHOR_KEY_HEADER,
  GALLERY_ID_PATTERN,
  MANAGE_TOKEN_HEADER,
  MAX_AUTHOR_NAME_CHARS,
  MAX_BIO_CHARS,
  MAX_COLLECTION_DESCRIPTION_CHARS,
  MAX_COLLECTION_ENTRIES,
  MAX_COLLECTION_TITLE_CHARS,
  type AuthorPageResponse,
  type CollectionPageResponse,
  type GalleryAuthorProfile,
  type GalleryCollection,
  type GalleryManifest,
  type PublishResponse,
} from "../gallery/types";
import { GET as listRoute, POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteEntryRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { GET as authorGetRoute, PUT as authorPutRoute } from "../app/api/gallery/authors/[authorId]/route";
import { POST as collectionPostRoute } from "../app/api/gallery/collections/route";
import {
  DELETE as collectionDeleteRoute,
  GET as collectionGetRoute,
  PUT as collectionPutRoute,
} from "../app/api/gallery/collections/[id]/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { createAuthor } from "../app/api/gallery/authors";
import { hashToken, newManageToken } from "../app/api/gallery/auth";
import { galleryPaths, galleryStore, getJson, putJson } from "../app/api/gallery/store";
import { accountForAuthor, accountHashOf, readAccount } from "../app/api/gallery/session";
import type { GalleryEntry, GallerySessionResponse } from "../gallery/types";

// #2331 — the admin is a signed-in account listed in STAVE_GALLERY_ADMINS; the old
// shared key stays set on the server to prove its header opens nothing.
const ADMIN = "user:mod-authors";
const OLD_ADMIN_HEADER = "x-stave-admin-key";
const OLD_KEY = "test-admin-key-authors-0123";
const EMAIL = "qq.distinctive.profile+authors@example-privacy-two.test";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-authors-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", OLD_KEY);
  vi.stubEnv("STAVE_GALLERY_ADMINS", "test-login:mod-authors");
  // #2319 — sign-in is set up (the test provider), and nobody is signed in yet.
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  fake.session = null;
});

/** Sign in as the account `id` (null signs out). Its email is EMAIL unless given. */
function signIn(id: string | null, over: { name?: string; email?: string; login?: string; badge?: "github" | "google"; avatarUrl?: string } = {}) {
  fake.session = id
    ? {
        user: { name: over.name ?? "Ada", email: over.email ?? EMAIL },
        account: {
          provider: "test-login",
          providerAccountId: id,
          badge: over.badge ?? "github",
          login: over.login ?? id,
          ...(over.avatarUrl ? { avatarUrl: over.avatarUrl } : {}),
        },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

/** Act as `who`: `user:<id>` signs in; any other string is an author key header; nothing is nobody. */
function as(who?: string): Record<string, string> {
  if (who?.startsWith("user:")) {
    signIn(who.slice(5));
    return {};
  }
  signIn(null);
  return who ? { [AUTHOR_KEY_HEADER]: who } : {};
}

let users = 0;
const freshUser = () => `user:u${++users}-${Date.now().toString(36)}`;

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};

const json = (method: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/** Publish as `who` (a fresh account when none is named). `who` comes back for later calls. */
async function publish(who?: string, over: Record<string, unknown> = {}): Promise<PublishResponse & { who: string }> {
  const user = who ?? freshUser();
  const headers = as(user);
  const res = await publishRoute(
    json("POST", "http://x/api/gallery", { title: "Track", kind: "music", tags: [], manifest, ...over }, headers),
  );
  expect(res.status).toBe(201);
  return { ...((await res.json()) as PublishResponse), who: user };
}

/**
 * #2319 — an author and entries the way publishing worked BEFORE sign-in: a
 * key-held author, entries with manage tokens. Written straight to the store,
 * since the publish route no longer makes them.
 */
async function legacyAuthor(n: number) {
  const store = galleryStore()!;
  const made = (await createAuthor(store, "Old Ada", EMAIL))!;
  const entries: Array<{ id: string; manageToken: string }> = [];
  for (let i = 0; i < n; i++) {
    const id = `L${String(users++).padStart(4, "0")}${Date.now().toString(36).slice(-6)}`.slice(0, 11).padEnd(11, "x");
    const manageToken = newManageToken();
    await putJson(store, galleryPaths.privateRecord(id), { authorEmail: EMAIL, manageTokenHash: hashToken(manageToken) });
    await putJson(store, galleryPaths.manifest(id), manifest);
    await putJson(store, galleryPaths.authorEntry(made.authorId, id), {});
    const entry: GalleryEntry = {
      id, title: `Old ${i}`, kind: "music", tags: [], authorName: "Old Ada", authorId: made.authorId,
      publishedAt: Date.now(), fileCount: 1, hasThumbnail: false,
    };
    await putJson(store, galleryPaths.entry(id), entry);
    entries.push({ id, manageToken });
  }
  return { key: made.authorKey, authorId: made.authorId, entries };
}

const authorCtx = (authorId: string) => ({ params: Promise.resolve({ authorId }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const getAuthor = (authorId: string) =>
  authorGetRoute(new Request(`http://x/api/gallery/authors/${authorId}`), authorCtx(authorId));
const authorPage = async (authorId: string) => {
  const res = await getAuthor(authorId);
  expect(res.status).toBe(200);
  return (await res.json()) as AuthorPageResponse;
};
const putAuthor = (authorId: string, body: unknown, who?: string) =>
  authorPutRoute(json("PUT", `http://x/api/gallery/authors/${authorId}`, body, as(who)), authorCtx(authorId));

const postCollection = (body: unknown, who?: string) =>
  collectionPostRoute(json("POST", "http://x/api/gallery/collections", body, as(who)));
const getCollection = (id: string) =>
  collectionGetRoute(new Request(`http://x/api/gallery/collections/${id}`), idCtx(id));
const putCollection = (id: string, body: unknown, who?: string) =>
  collectionPutRoute(json("PUT", `http://x/api/gallery/collections/${id}`, body, as(who)), idCtx(id));
/** `who` as in as(); extra headers on top; `body` (an admin's `{ reason }`) as JSON. */
const withBody = (body: unknown) => (body === undefined ? {} : { body: JSON.stringify(body) });
const deleteCollection = (id: string, who?: string, headers: Record<string, string> = {}, body?: unknown) =>
  collectionDeleteRoute(
    new Request(`http://x/api/gallery/collections/${id}`, {
      method: "DELETE",
      headers: { ...as(who), ...headers },
      ...withBody(body),
    }),
    idCtx(id),
  );
const deleteEntry = (id: string, headers: Record<string, string>, who?: string, body?: unknown) =>
  deleteEntryRoute(
    new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers: { ...as(who), ...headers }, ...withBody(body) }),
    idCtx(id),
  );

async function made(body: unknown, key: string): Promise<GalleryCollection> {
  const res = await postCollection(body, key);
  expect(res.status).toBe(201);
  return ((await res.json()) as { collection: GalleryCollection }).collection;
}

/** A signed-in author with `n` entries: `key` is the "who" token that acts as them. */
async function authorWith(n: number) {
  const first = await publish(undefined, { title: "Track 0" });
  const key = first.who;
  const rest: PublishResponse[] = [];
  for (let i = 1; i < n; i++) {
    // Apart in time, so "newest first" has one answer.
    await new Promise((r) => setTimeout(r, 3));
    rest.push(await publish(key, { title: `Track ${i}` }));
  }
  return { key, authorId: first.authorId, entries: [first, ...rest] };
}

describe("authors on publish", () => {
  it("makes the account's author on its first publish, with the badge and no key", async () => {
    const res = await publish();
    expect(res.authorId).toMatch(GALLERY_ID_PATTERN);
    expect(res).not.toHaveProperty("authorKey");
    const page = await authorPage(res.authorId);
    expect(page.author).toEqual({
      authorId: res.authorId,
      name: "Ada",
      bio: "",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      verified: { provider: "github", login: res.who.slice(5) },
    });
    const entry = (await (await entryRoute(new Request("http://x"), idCtx(res.id))).json()) as {
      entry: { authorId: string };
    };
    expect(entry.entry.authorId).toBe(res.authorId);
  });

  it("lands every publish from one account on the same author", async () => {
    const first = await publish();
    const second = await publish(first.who);
    expect(second.authorId).toBe(first.authorId);
    const page = await authorPage(first.authorId);
    expect(page.entries.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("gives a different account a different author", async () => {
    const a = await publish();
    const b = await publish();
    expect(b.authorId).not.toBe(a.authorId);
  });

  it("ignores an author key sent with the publish: the session decides", async () => {
    const old = await legacyAuthor(0);
    const user = freshUser();
    as(user);
    const res = await publishRoute(
      json("POST", "http://x/api/gallery", { title: "T", kind: "music", tags: [], manifest }, { [AUTHOR_KEY_HEADER]: old.key }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as PublishResponse).authorId).not.toBe(old.authorId);
  });
});

describe("#2319 the account behind an author", () => {
  it("is readable by account and by author, holds the account email, and refreshes the badge", async () => {
    const res = await publish();
    const id = res.who.slice(5);
    const store = galleryStore()!;
    const byAccount = await readAccount(store, accountHashOf("test-login", id));
    const byAuthor = await accountForAuthor(store, res.authorId);
    expect(byAccount).toEqual(byAuthor);
    expect(byAccount).toMatchObject({ authorId: res.authorId, email: EMAIL, provider: "test-login" });
    // The entry's private record keeps the account email, whatever the body said.
    const record = await getJson<{ authorEmail: string }>(store, galleryPaths.privateRecord(res.id));
    expect(record?.authorEmail).toBe(EMAIL);

    // The GitHub login changed since: the next gallery use follows it.
    signIn(id, { login: "renamed", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" });
    const me = (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;
    expect(me.user).toEqual({
      name: "Ada",
      authorId: res.authorId,
      verified: { provider: "github", login: "renamed", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      accountId: `test-login:${id}`,
    });
    expect((await authorPage(res.authorId)).author.verified).toEqual(me.user!.verified);
  });

  it("a Google account's badge has no login, and only an https avatar is kept", async () => {
    signIn("g-1", { badge: "google", login: "should-not-show", avatarUrl: "http://insecure.example/a.png" });
    const me = (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;
    expect(me.user?.verified).toEqual({ provider: "google" });
    expect((await authorPage(me.user!.authorId)).author.verified).toEqual({ provider: "google" });
  });

  it("the session route says what sign-in offers, and who you are without the email", async () => {
    signIn(null);
    let me = (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;
    expect(me).toEqual({
      signInAvailable: true,
      providers: [{ id: "test-login", name: "Test account" }],
      user: null,
      isAdmin: false,
    });

    signIn("me-1");
    const res = await meRoute(new Request("http://x/api/gallery/me"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).toContain("authorId");
    expect(text).not.toContain(EMAIL);

    vi.stubEnv("AUTH_SECRET", "");
    me = (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;
    expect(me).toEqual({ signInAvailable: false, providers: [], user: null, isAdmin: false });
  });
});

describe("#2319 a key from before sign-in still works for what it made", () => {
  it("edits the profile, makes and changes collections, and deletes entries", async () => {
    const old = await legacyAuthor(2);
    const edit = { name: "Old Ada", bio: "still here" };
    expect((await putAuthor(old.authorId, edit, old.key)).status).toBe(200);
    expect((await putAuthor(old.authorId, edit, "wrong")).status).toBe(403);

    const c = await made({ title: "Old EP", description: "", entryIds: old.entries.map((e) => e.id) }, old.key);
    expect(c.authorId).toBe(old.authorId);
    expect((await putCollection(c.id, { title: "Old EP 2", description: "", entryIds: [] }, old.key)).status).toBe(200);

    // A signed-in stranger is refused everywhere.
    const stranger = freshUser();
    expect((await putAuthor(old.authorId, edit, stranger)).status).toBe(403);
    expect((await putCollection(c.id, { title: "x", description: "", entryIds: [] }, stranger)).status).toBe(403);
    expect((await deleteCollection(c.id, stranger)).status).toBe(403);
    expect((await deleteEntry(old.entries[0].id, {}, stranger)).status).toBe(403);

    expect((await deleteCollection(c.id, old.key)).status).toBe(204);
    expect((await deleteEntry(old.entries[0].id, { [MANAGE_TOKEN_HEADER]: old.entries[0].manageToken })).status).toBe(204);
    expect((await authorPage(old.authorId)).entries.map((e) => e.id)).toEqual([old.entries[1].id]);
  });
});

describe("#2319 a second account can't touch the first one's things", () => {
  it("gets 403 on the profile, its collections, and its entries", async () => {
    const mine = await authorWith(2);
    const c = await made({ title: "Mine", description: "", entryIds: [mine.entries[0].id] }, mine.key);
    const other = (await publish()).who;
    const body = { title: "Taken", description: "", entryIds: [] };

    expect((await putAuthor(mine.authorId, { name: "Mallory", bio: "" }, other)).status).toBe(403);
    expect((await putCollection(c.id, body, other)).status).toBe(403);
    expect((await deleteCollection(c.id, other)).status).toBe(403);
    expect((await deleteEntry(mine.entries[1].id, {}, other)).status).toBe(403);
    // ...and adding my entry to their own collection is refused too.
    expect((await postCollection({ title: "x", description: "", entryIds: [mine.entries[0].id] }, other)).status).toBe(400);

    expect((await authorPage(mine.authorId)).author.name).toBe("Ada");
    expect((await (await getCollection(c.id)).json() as CollectionPageResponse).collection.title).toBe("Mine");

    // The owner, signed in, deletes their own entry with no token at all.
    expect((await deleteEntry(mine.entries[1].id, {}, mine.key)).status).toBe(204);
  });
});

describe("the author page", () => {
  it("lists the author's entries newest first and drops one taken down", async () => {
    const { authorId, entries } = await authorWith(3);
    const other = await publish(); // someone else's entry never shows here
    let page = await authorPage(authorId);
    expect(page.entries.map((e) => e.id)).toEqual([entries[2].id, entries[1].id, entries[0].id]);
    expect(page.entries.map((e) => e.id)).not.toContain(other.id);

    const res = await deleteEntry(entries[1].id, { [MANAGE_TOKEN_HEADER]: entries[1].manageToken });
    expect(res.status).toBe(204);
    page = await authorPage(authorId);
    expect(page.entries.map((e) => e.id)).toEqual([entries[2].id, entries[0].id]);
  });

  it("is not cached, and answers 404 for an unknown or malformed id", async () => {
    const { authorId } = await publish();
    expect((await getAuthor(authorId)).headers.get("cache-control")).toBe("no-store");
    expect((await getAuthor("AAAAAAAAAAA")).status).toBe(404);
    expect((await getAuthor("../private")).status).toBe(404);
  });
});

describe("editing a profile", () => {
  it("needs the author's own account", async () => {
    const a = await publish();
    const b = await publish();
    const edit = { name: "Ada L.", bio: "# Hi\n\n<script>alert(1)</script>" };
    expect((await putAuthor(a.authorId, edit)).status).toBe(403);
    expect((await putAuthor(a.authorId, edit, b.who)).status).toBe(403);
    expect((await putAuthor(a.authorId, edit, "wrong")).status).toBe(403);
    expect((await authorPage(a.authorId)).author.name).toBe("Ada");

    const ok = await putAuthor(a.authorId, edit, a.who);
    expect(ok.status).toBe(200);
    const { author } = (await ok.json()) as { author: GalleryAuthorProfile };
    // The bio is stored exactly as typed; the client escapes it when rendering.
    expect(author).toMatchObject({ authorId: a.authorId, name: "Ada L.", bio: edit.bio });
    expect((await authorPage(a.authorId)).author.bio).toBe(edit.bio);
    expect((await putAuthor("AAAAAAAAAAA", edit, a.who)).status).toBe(404);
  });

  it("enforces the name and bio limits", async () => {
    const a = await publish();
    const k = a.who;
    expect((await putAuthor(a.authorId, { name: "", bio: "" }, k)).status).toBe(400);
    expect((await putAuthor(a.authorId, { name: "x".repeat(MAX_AUTHOR_NAME_CHARS + 1), bio: "" }, k)).status).toBe(400);
    expect((await putAuthor(a.authorId, { name: "Ada", bio: "x".repeat(MAX_BIO_CHARS + 1) }, k)).status).toBe(400);
    expect((await putAuthor(a.authorId, { name: "Ada" }, k)).status).toBe(400);
    expect((await putAuthor(a.authorId, { name: "x".repeat(MAX_AUTHOR_NAME_CHARS), bio: "x".repeat(MAX_BIO_CHARS) }, k)).status).toBe(200);
  });
});

describe("collections", () => {
  it("creates, updates, reorders and deletes, leaving the entries", async () => {
    const { key, authorId, entries } = await authorWith(3);
    const [e0, e1, e2] = entries.map((e) => e.id);

    const c = await made({ title: " Album ", description: " first ", entryIds: [e0, e1, e0] }, key);
    expect(c).toMatchObject({ authorId, title: "Album", description: "first", entryIds: [e0, e1] });
    expect(c.id).toMatch(GALLERY_ID_PATTERN);

    let page = (await (await getCollection(c.id)).json()) as CollectionPageResponse;
    expect(page.author).toEqual({ authorId, name: "Ada" });
    expect(page.entries.map((e) => e.id)).toEqual([e0, e1]);

    const res = await putCollection(c.id, { title: "Album 2", description: "", entryIds: [e2, e1, e0] }, key);
    expect(res.status).toBe(200);
    page = (await (await getCollection(c.id)).json()) as CollectionPageResponse;
    expect(page.collection).toMatchObject({ title: "Album 2", entryIds: [e2, e1, e0], createdAt: c.createdAt });
    expect(page.entries.map((e) => e.id)).toEqual([e2, e1, e0]);

    expect((await authorPage(authorId)).collections.map((x) => x.id)).toEqual([c.id]);

    expect((await deleteCollection(c.id)).status).toBe(403);
    expect((await deleteCollection(c.id, key)).status).toBe(204);
    expect((await getCollection(c.id)).status).toBe(404);
    expect((await deleteCollection(c.id, key)).status).toBe(404);
    const after = await authorPage(authorId);
    expect(after.collections).toEqual([]);
    expect(after.entries.map((e) => e.id).sort()).toEqual([e0, e1, e2].sort());
    for (const id of [e0, e1, e2]) expect((await entryRoute(new Request("http://x"), idCtx(id))).status).toBe(200);
  });

  it("lists an author's collections newest first", async () => {
    const { key, authorId, entries } = await authorWith(1);
    const a = await made({ title: "A", description: "", entryIds: [] }, key);
    await new Promise((r) => setTimeout(r, 5));
    const b = await made({ title: "B", description: "", entryIds: [entries[0].id] }, key);
    expect((await authorPage(authorId)).collections.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("refuses someone else's entry, an unknown one, and a removed one, naming the id", async () => {
    const mine = await authorWith(1);
    const theirs = await publish();
    let res = await postCollection({ title: "T", description: "", entryIds: [mine.entries[0].id, theirs.id] }, mine.key);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(theirs.id);

    res = await postCollection({ title: "T", description: "", entryIds: ["AAAAAAAAAAA"] }, mine.key);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("AAAAAAAAAAA");

    const gone = await publish(mine.key);
    await deleteEntry(gone.id, { [MANAGE_TOKEN_HEADER]: gone.manageToken });
    res = await postCollection({ title: "T", description: "", entryIds: [gone.id] }, mine.key);
    expect(res.status).toBe(400);

    const c = await made({ title: "T", description: "", entryIds: [mine.entries[0].id] }, mine.key);
    res = await putCollection(c.id, { title: "T", description: "", entryIds: [theirs.id] }, mine.key);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(theirs.id);
  });

  it("needs the author's account (or key) to create or change one", async () => {
    const mine = await authorWith(1);
    const other = await publish();
    const body = { title: "T", description: "", entryIds: [] };
    expect((await postCollection(body)).status).toBe(403);
    expect((await postCollection(body, "bogus")).status).toBe(403);
    const c = await made(body, mine.key);
    expect((await putCollection(c.id, body)).status).toBe(403);
    expect((await putCollection(c.id, body, other.who)).status).toBe(403);
    expect((await deleteCollection(c.id, other.who)).status).toBe(403);
    expect((await putCollection("AAAAAAAAAAA", body, mine.key)).status).toBe(404);
  });

  it("enforces the title, description and size limits", async () => {
    const { key, entries } = await authorWith(1);
    const id = entries[0].id;
    const post = (b: unknown) => postCollection(b, key).then((r) => r.status);
    expect(await post({ title: "", description: "", entryIds: [] })).toBe(400);
    expect(await post({ title: "x".repeat(MAX_COLLECTION_TITLE_CHARS + 1), description: "", entryIds: [] })).toBe(400);
    expect(await post({ title: "T", description: "x".repeat(MAX_COLLECTION_DESCRIPTION_CHARS + 1), entryIds: [] })).toBe(400);
    expect(await post({ title: "T", description: "", entryIds: "nope" })).toBe(400);
    expect(await post({ title: "T", description: "", entryIds: ["../x"] })).toBe(400);
    // Duplicates collapse before the cap is counted.
    expect(await post({ title: "T", description: "", entryIds: Array(MAX_COLLECTION_ENTRIES + 5).fill(id) })).toBe(201);
    const many = Array.from({ length: MAX_COLLECTION_ENTRIES + 1 }, (_, i) => `A${String(i).padStart(10, "0")}`);
    expect(await post({ title: "T", description: "", entryIds: many })).toBe(400);
  });

  it("drops an entry taken down, from the collection page and the profile", async () => {
    const { key, authorId, entries } = await authorWith(3);
    const [e0, e1, e2] = entries;
    const c = await made({ title: "Album", description: "", entryIds: [e0.id, e1.id, e2.id] }, key);

    expect((await deleteEntry(e1.id, {}, ADMIN, { reason: "taken down in a test" })).status).toBe(204);

    const page = (await (await getCollection(c.id)).json()) as CollectionPageResponse;
    expect(page.collection.entryIds).toEqual([e0.id, e2.id]);
    expect(page.entries.map((e) => e.id)).toEqual([e0.id, e2.id]);
    const profile = await authorPage(authorId);
    expect(profile.collections[0].entryIds).toEqual([e0.id, e2.id]);
    expect(profile.entries.map((e) => e.id)).not.toContain(e1.id);
  });

  it("lets an admin delete any collection, with a reason", async () => {
    const { key } = await authorWith(1);
    const c = await made({ title: "T", description: "", entryIds: [] }, key);
    expect((await deleteCollection(c.id, undefined, { [OLD_ADMIN_HEADER]: OLD_KEY })).status).toBe(403);
    expect((await deleteCollection(c.id, freshUser(), {}, { reason: "not an admin" })).status).toBe(403);
    expect((await deleteCollection(c.id, ADMIN)).status).toBe(400);
    expect((await deleteCollection(c.id, ADMIN, {}, { reason: "spam collection" })).status).toBe(204);
    expect((await getCollection(c.id)).status).toBe(404);
  });
});

describe("the email stays on the server", () => {
  it("appears in no response from the author or collection routes", async () => {
    const { key, authorId, entries } = await authorWith(2);
    const bodies: Array<[string, string]> = [];
    const keep = async (label: string, res: Response) => {
      bodies.push([label, await res.text()]);
    };

    await keep("author GET", await getAuthor(authorId));
    await keep("author PUT", await putAuthor(authorId, { name: "Ada", bio: "hello" }, key));
    await keep("author PUT 403", await putAuthor(authorId, { name: "x", bio: "" }, "wrong"));
    await keep("author PUT 400", await putAuthor(authorId, { name: "", bio: "" }, key));
    const created = await postCollection({ title: "Album", description: "", entryIds: entries.map((e) => e.id) }, key);
    const createdText = await created.text();
    bodies.push(["collection POST", createdText]);
    const cid = (JSON.parse(createdText) as { collection: GalleryCollection }).collection.id;
    await keep("collection GET", await getCollection(cid));
    await keep("collection PUT", await putCollection(cid, { title: "Album", description: "d", entryIds: [] }, key));
    await keep("collection PUT 400", await putCollection(cid, { title: "", description: "", entryIds: [] }, key));
    await keep("collection 403", await postCollection({ title: "T", description: "", entryIds: [] }));
    await keep("author GET again", await getAuthor(authorId));
    await keep("list", await listRoute());
    as(key); // signed in as the author, so "me" answers with them
    await keep("me", await meRoute(new Request("http://x/api/gallery/me")));
    await keep("collection DELETE", await deleteCollection(cid, key));

    // Controls: the routes really answered with the data, so an empty body can't pass.
    const byLabel = Object.fromEntries(bodies);
    expect(byLabel["me"]).toContain(authorId);
    expect(byLabel["author GET"]).toContain(authorId);
    expect(byLabel["author GET"]).toContain(entries[0].id);
    expect(byLabel["collection GET"]).toContain(entries[1].id);
    expect(byLabel["author GET again"]).toContain(cid);
    for (const [label, body] of bodies) {
      expect(body, label).not.toContain(EMAIL);
      expect(body, label).not.toContain("example-privacy-two.test");
    }
  });
});

describe("a production build with no store", () => {
  it("answers 503 on every new route", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STAVE_SHARE_DEV_STORE", "");
    const id = "AAAAAAAAAAA";
    const body = { title: "T", description: "", entryIds: [] };
    expect((await getAuthor(id)).status).toBe(503);
    expect((await putAuthor(id, { name: "x", bio: "" }, "k")).status).toBe(503);
    expect((await postCollection(body, "k")).status).toBe(503);
    expect((await getCollection(id)).status).toBe(503);
    expect((await putCollection(id, body, "k")).status).toBe(503);
    expect((await deleteCollection(id, ADMIN, {}, { reason: "x" })).status).toBe(503);
  });
});
