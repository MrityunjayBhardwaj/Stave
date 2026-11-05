/**
 * #2314 / #2315 — the browser side of the profile and collection routes, against
 * a mocked fetch: the method, the path, the key header, the body, and a message
 * a person can act on for each refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  deleteCollection,
  fetchAuthorPage,
  fetchCollectionPage,
  galleryAuthorLink,
  galleryCollectionLink,
  updateAuthor,
  updateCollection,
} from "../client";
import { AUTHOR_KEY_HEADER } from "../types";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit | undefined];
  return { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
};

const AUTHOR = { authorId: "auth1", name: "Ada", bio: "# hi", createdAt: 1, updatedAt: 2 };
const COLLECTION = { id: "col1", authorId: "auth1", title: "EP", description: "", entryIds: ["a", "b"], createdAt: 1, updatedAt: 1 };

describe("profiles", () => {
  it("loads a profile page, with no key sent", async () => {
    fetchMock.mockResolvedValue(json({ author: AUTHOR, entries: [], collections: [] }));
    const page = await fetchAuthorPage("auth/1");
    expect(page.author.name).toBe("Ada");
    expect(call()).toMatchObject({ url: "/api/gallery/authors/auth%2F1", method: "GET" });
    expect(AUTHOR_KEY_HEADER in call().headers).toBe(false);
  });

  it("a missing profile says so", async () => {
    fetchMock.mockResolvedValue(json({ error: "nope" }, 404));
    await expect(fetchAuthorPage("x")).rejects.toThrow("this profile wasn't found");
  });

  it("saving sends PUT with the key and the fields, and returns the saved profile", async () => {
    fetchMock.mockResolvedValue(json({ author: { ...AUTHOR, bio: "new" } }));
    const a = await updateAuthor("auth1", "key-1", { name: "Ada", bio: "new" });
    expect(a.bio).toBe("new");
    const c = call();
    expect(c).toMatchObject({ url: "/api/gallery/authors/auth1", method: "PUT" });
    expect(c.headers[AUTHOR_KEY_HEADER]).toBe("key-1");
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(c.body as string)).toEqual({ name: "Ada", bio: "new" });
  });

  it("a wrong key, a bad field and a throttle each say what happened", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "forbidden" }, 403));
    await expect(updateAuthor("auth1", "k", { name: "a", bio: "" })).rejects.toThrow(/can't edit that profile/);
    fetchMock.mockResolvedValueOnce(json({ error: "the bio is too long" }, 400));
    await expect(updateAuthor("auth1", "k", { name: "a", bio: "" })).rejects.toThrow("the bio is too long");
    fetchMock.mockResolvedValueOnce(json({}, 429));
    await expect(updateAuthor("auth1", "k", { name: "a", bio: "" })).rejects.toThrow(/too many changes/);
  });
});

describe("collections", () => {
  const req = { title: "EP", description: "", entryIds: ["b", "a"] };

  it("creating sends POST with the key and the picked ids in order", async () => {
    fetchMock.mockResolvedValue(json({ collection: COLLECTION }, 201));
    const c = await createCollection("key-1", req);
    expect(c.id).toBe("col1");
    expect(call()).toMatchObject({ url: "/api/gallery/collections", method: "POST" });
    expect(call().headers[AUTHOR_KEY_HEADER]).toBe("key-1");
    expect(JSON.parse(call().body as string)).toEqual(req);
  });

  it("creating with someone else's entry passes the server's reason through", async () => {
    fetchMock.mockResolvedValue(json({ error: "a collection holds only your own entries" }, 400));
    await expect(createCollection("k", req)).rejects.toThrow("a collection holds only your own entries");
  });

  it("loads a collection page; a missing one says so", async () => {
    fetchMock.mockResolvedValueOnce(json({ collection: COLLECTION, author: { authorId: "auth1", name: "Ada" }, entries: [] }));
    expect((await fetchCollectionPage("col1")).collection.title).toBe("EP");
    expect(call()).toMatchObject({ url: "/api/gallery/collections/col1", method: "GET" });
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(fetchCollectionPage("col1")).rejects.toThrow("this collection wasn't found");
  });

  it("saving sends PUT with the key and the new order", async () => {
    fetchMock.mockResolvedValue(json({ collection: { ...COLLECTION, entryIds: ["b", "a"] } }));
    const c = await updateCollection("col1", "key-1", req);
    expect(c.entryIds).toEqual(["b", "a"]);
    expect(call()).toMatchObject({ url: "/api/gallery/collections/col1", method: "PUT" });
    expect(call().headers[AUTHOR_KEY_HEADER]).toBe("key-1");
    expect(JSON.parse(call().body as string).entryIds).toEqual(["b", "a"]);
    fetchMock.mockResolvedValueOnce(json({}, 403));
    await expect(updateCollection("col1", "k", req)).rejects.toThrow(/can't change that collection/);
  });

  it("deleting sends DELETE with the key; already gone counts as done; a wrong key says so", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteCollection("col1", "key-1");
    expect(call()).toMatchObject({ url: "/api/gallery/collections/col1", method: "DELETE" });
    expect(call().headers[AUTHOR_KEY_HEADER]).toBe("key-1");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteCollection("col1", "k")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(deleteCollection("col1", "k")).rejects.toThrow(/can't delete that collection/);
  });

  it("#2319 signed in, no key is held: nothing goes in the key header (the session cookie says who)", async () => {
    fetchMock.mockResolvedValue(json({ collection: COLLECTION }, 201));
    await createCollection(null, req);
    expect(AUTHOR_KEY_HEADER in call().headers).toBe(false);
    expect(call().headers["Content-Type"]).toBe("application/json");
  });

  it("links open the overlay on a profile or a collection", () => {
    expect(galleryAuthorLink("auth1")).toBe(`${window.location.origin}/#gallery-author=auth1`);
    expect(galleryCollectionLink("col1")).toBe(`${window.location.origin}/#gallery-collection=col1`);
  });
});
