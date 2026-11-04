// @vitest-environment node
// #2314 / #2315 — authors (profiles) and collections against the dev folder
// store: authors made on publish, the author key, the profile page, editing it,
// collections of your own entries, takedowns leaving every page, and the rule
// that the email never leaves the server.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_KEY_HEADER,
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

const ADMIN_KEY = "test-admin-key-authors-0123";
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
  vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", ADMIN_KEY);
});

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

async function publish(key?: string, over: Record<string, unknown> = {}): Promise<PublishResponse> {
  const res = await publishRoute(
    json(
      "POST",
      "http://x/api/gallery",
      { title: "Track", kind: "music", tags: [], authorName: "Ada", authorEmail: EMAIL, manifest, ...over },
      key ? { [AUTHOR_KEY_HEADER]: key } : {},
    ),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as PublishResponse;
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
const putAuthor = (authorId: string, body: unknown, key?: string) =>
  authorPutRoute(
    json("PUT", `http://x/api/gallery/authors/${authorId}`, body, key ? { [AUTHOR_KEY_HEADER]: key } : {}),
    authorCtx(authorId),
  );

const postCollection = (body: unknown, key?: string) =>
  collectionPostRoute(json("POST", "http://x/api/gallery/collections", body, key ? { [AUTHOR_KEY_HEADER]: key } : {}));
const getCollection = (id: string) =>
  collectionGetRoute(new Request(`http://x/api/gallery/collections/${id}`), idCtx(id));
const putCollection = (id: string, body: unknown, key?: string) =>
  collectionPutRoute(
    json("PUT", `http://x/api/gallery/collections/${id}`, body, key ? { [AUTHOR_KEY_HEADER]: key } : {}),
    idCtx(id),
  );
const deleteCollection = (id: string, headers: Record<string, string> = {}) =>
  collectionDeleteRoute(new Request(`http://x/api/gallery/collections/${id}`, { method: "DELETE", headers }), idCtx(id));
const deleteEntry = (id: string, headers: Record<string, string>) =>
  deleteEntryRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers }), idCtx(id));

async function made(body: unknown, key: string): Promise<GalleryCollection> {
  const res = await postCollection(body, key);
  expect(res.status).toBe(201);
  return ((await res.json()) as { collection: GalleryCollection }).collection;
}

/** An author with `n` entries: [key, authorId, entry publish responses oldest first]. */
async function authorWith(n: number) {
  const first = await publish(undefined, { title: "Track 0" });
  const key = first.authorKey!;
  const rest: PublishResponse[] = [];
  for (let i = 1; i < n; i++) rest.push(await publish(key, { title: `Track ${i}` }));
  return { key, authorId: first.authorId, entries: [first, ...rest] };
}

describe("authors on publish", () => {
  it("makes an author on the first publish and hands back its key once", async () => {
    const res = await publish();
    expect(res.authorId).toMatch(GALLERY_ID_PATTERN);
    expect(res.authorKey!.length).toBeGreaterThanOrEqual(40);
    const page = await authorPage(res.authorId);
    expect(page.author).toEqual({
      authorId: res.authorId,
      name: "Ada",
      bio: "",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    const entry = (await (await entryRoute(new Request("http://x"), idCtx(res.id))).json()) as {
      entry: { authorId: string };
    };
    expect(entry.entry.authorId).toBe(res.authorId);
  });

  it("lands a publish with the key on the same author, with no new key", async () => {
    const first = await publish();
    const second = await publish(first.authorKey);
    expect(second.authorId).toBe(first.authorId);
    expect(second).not.toHaveProperty("authorKey");
    const page = await authorPage(first.authorId);
    expect(page.entries.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("makes a fresh author for a key that matches no author", async () => {
    const first = await publish();
    const stale = await publish("not-a-real-author-key-at-all-000000000000000");
    expect(stale.authorId).not.toBe(first.authorId);
    expect(stale.authorKey).toBeTruthy();
    expect(stale.authorKey).not.toBe(first.authorKey);
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
  it("needs the author's own key", async () => {
    const a = await publish();
    const b = await publish();
    const edit = { name: "Ada L.", bio: "# Hi\n\n<script>alert(1)</script>" };
    expect((await putAuthor(a.authorId, edit)).status).toBe(403);
    expect((await putAuthor(a.authorId, edit, b.authorKey)).status).toBe(403);
    expect((await putAuthor(a.authorId, edit, "wrong")).status).toBe(403);
    expect((await authorPage(a.authorId)).author.name).toBe("Ada");

    const ok = await putAuthor(a.authorId, edit, a.authorKey);
    expect(ok.status).toBe(200);
    const { author } = (await ok.json()) as { author: GalleryAuthorProfile };
    // The bio is stored exactly as typed; the client escapes it when rendering.
    expect(author).toMatchObject({ authorId: a.authorId, name: "Ada L.", bio: edit.bio });
    expect((await authorPage(a.authorId)).author.bio).toBe(edit.bio);
    expect((await putAuthor("AAAAAAAAAAA", edit, a.authorKey)).status).toBe(404);
  });

  it("enforces the name and bio limits", async () => {
    const a = await publish();
    const k = a.authorKey;
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
    expect((await deleteCollection(c.id, { [AUTHOR_KEY_HEADER]: key })).status).toBe(204);
    expect((await getCollection(c.id)).status).toBe(404);
    expect((await deleteCollection(c.id, { [AUTHOR_KEY_HEADER]: key })).status).toBe(404);
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

  it("needs a valid author key to create or change one", async () => {
    const mine = await authorWith(1);
    const other = await publish();
    const body = { title: "T", description: "", entryIds: [] };
    expect((await postCollection(body)).status).toBe(403);
    expect((await postCollection(body, "bogus")).status).toBe(403);
    const c = await made(body, mine.key);
    expect((await putCollection(c.id, body)).status).toBe(403);
    expect((await putCollection(c.id, body, other.authorKey)).status).toBe(403);
    expect((await deleteCollection(c.id, { [AUTHOR_KEY_HEADER]: other.authorKey! })).status).toBe(403);
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

    expect((await deleteEntry(e1.id, { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(204);

    const page = (await (await getCollection(c.id)).json()) as CollectionPageResponse;
    expect(page.collection.entryIds).toEqual([e0.id, e2.id]);
    expect(page.entries.map((e) => e.id)).toEqual([e0.id, e2.id]);
    const profile = await authorPage(authorId);
    expect(profile.collections[0].entryIds).toEqual([e0.id, e2.id]);
    expect(profile.entries.map((e) => e.id)).not.toContain(e1.id);
  });

  it("lets the maintainer delete any collection with the admin key", async () => {
    const { key } = await authorWith(1);
    const c = await made({ title: "T", description: "", entryIds: [] }, key);
    expect((await deleteCollection(c.id, { [ADMIN_KEY_HEADER]: "wrong" })).status).toBe(403);
    expect((await deleteCollection(c.id, { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(204);
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
    await keep("collection DELETE", await deleteCollection(cid, { [AUTHOR_KEY_HEADER]: key }));

    // Controls: the routes really answered with the data, so an empty body can't pass.
    const byLabel = Object.fromEntries(bodies);
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
    expect((await deleteCollection(id, { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(503);
  });
});
