/**
 * #2314 / #2315 — who may edit, how a collection's order changes, what the forms
 * send, and how `#gallery-author=` / `#gallery-collection=` links are read.
 */
import { describe, expect, it } from "vitest";
import { readGalleryLink } from "../galleryModel";
import {
  buildCollectionRequest,
  buildProfileRequest,
  collectionCover,
  moveEntry,
  ownerKeyFor,
  removeEntry,
  toggleEntry,
} from "../profileModel";
import { MAX_BIO_CHARS, MAX_COLLECTION_ENTRIES, type GalleryEntry } from "../types";

const E = (id: string, hasThumbnail = false): GalleryEntry => ({
  id,
  title: id,
  kind: "music",
  tags: [],
  authorName: "Ada",
  authorId: "auth1",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail,
});

describe("who may edit a profile", () => {
  it("only the remembered author, and only with a key", () => {
    const me = { name: "Ada", email: "a@x.io", authorId: "auth1", authorKey: "k" };
    expect(ownerKeyFor(me, "auth1")).toBe("k");
    expect(ownerKeyFor(me, "auth2")).toBeNull();
    expect(ownerKeyFor({ ...me, authorKey: undefined }, "auth1")).toBeNull();
    expect(ownerKeyFor({ name: "Ada", email: "a@x.io" }, "auth1")).toBeNull();
    expect(ownerKeyFor(null, "auth1")).toBeNull();
  });
});

describe("a collection's order", () => {
  it("moves up and down, and an edge move changes nothing", () => {
    expect(moveEntry(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveEntry(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveEntry(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveEntry(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveEntry(["a"], 5, -1)).toEqual(["a"]);
  });

  it("does not change the list it was given", () => {
    const ids = ["a", "b"];
    moveEntry(ids, 0, 1);
    expect(ids).toEqual(["a", "b"]);
  });

  it("ticking adds at the end (picking order is kept), unticking drops", () => {
    let ids: string[] = [];
    ids = toggleEntry(ids, "c");
    ids = toggleEntry(ids, "a");
    ids = toggleEntry(ids, "b");
    expect(ids).toEqual(["c", "a", "b"]);
    expect(toggleEntry(ids, "a")).toEqual(["c", "b"]);
    expect(removeEntry(ids, "c")).toEqual(["a", "b"]);
    expect(removeEntry(ids, "zz")).toEqual(["c", "a", "b"]);
  });
});

describe("the collection form", () => {
  it("trims, keeps order, drops repeats and anything not the author's own", () => {
    const r = buildCollectionRequest(
      { title: "  EP ", description: " two tracks ", entryIds: ["b", "a", "b", "theirs"] },
      ["a", "b"],
    );
    expect(r).toEqual({ request: { title: "EP", description: "two tracks", entryIds: ["b", "a"] }, errors: [] });
  });

  it("needs a title and holds the limits", () => {
    expect(buildCollectionRequest({ title: " ", description: "", entryIds: [] }).errors).toEqual(["Add a title."]);
    expect(buildCollectionRequest({ title: "x".repeat(81), description: "", entryIds: [] }).errors[0]).toMatch(/at most 80/);
    expect(buildCollectionRequest({ title: "t", description: "x".repeat(1001), entryIds: [] }).errors[0]).toMatch(/at most 1000/);
    const many = Array.from({ length: MAX_COLLECTION_ENTRIES + 1 }, (_, i) => `e${i}`);
    expect(buildCollectionRequest({ title: "t", description: "", entryIds: many }).errors).toEqual([
      `A collection holds at most ${MAX_COLLECTION_ENTRIES} entries.`,
    ]);
  });

  it("an empty collection is allowed", () => {
    expect(buildCollectionRequest({ title: "t", description: "", entryIds: [] }).request).toEqual({
      title: "t",
      description: "",
      entryIds: [],
    });
  });
});

describe("the profile form", () => {
  it("trims the name, keeps the bio as written, holds the limits", () => {
    expect(buildProfileRequest({ name: " Ada ", bio: "  # hi\n" })).toEqual({
      request: { name: "Ada", bio: "  # hi\n" },
      errors: [],
    });
    expect(buildProfileRequest({ name: "", bio: "" }).errors).toEqual(["Add your name."]);
    expect(buildProfileRequest({ name: "x".repeat(61), bio: "" }).errors[0]).toMatch(/at most 60/);
    expect(buildProfileRequest({ name: "a", bio: "x".repeat(MAX_BIO_CHARS + 1) }).errors[0]).toMatch(/at most 10,000/);
  });
});

describe("a collection's cover", () => {
  it("is the first entry, in collection order, that has a picture", () => {
    const entries = [E("a"), E("b", true), E("c", true)];
    expect(collectionCover({ entryIds: ["a", "c", "b"] }, entries)?.id).toBe("c");
    expect(collectionCover({ entryIds: ["a"] }, entries)).toBeNull();
    expect(collectionCover({ entryIds: ["gone"] }, entries)).toBeNull();
  });
});

describe("reading gallery links", () => {
  it("an entry, a profile, a collection", () => {
    expect(readGalleryLink("#gallery=AbCdEfGhIjK")).toEqual({ kind: "entry", id: "AbCdEfGhIjK" });
    expect(readGalleryLink("#gallery-author=auth_1-X")).toEqual({ kind: "author", id: "auth_1-X" });
    expect(readGalleryLink("#gallery-collection=Col1234abcd")).toEqual({ kind: "collection", id: "Col1234abcd" });
    expect(readGalleryLink("#gallery-collection=Col%31")).toEqual({ kind: "collection", id: "Col1" });
  });

  it("not a gallery link at all → null (the app leaves the fragment alone)", () => {
    expect(readGalleryLink("")).toBeNull();
    expect(readGalleryLink("#share=abc")).toBeNull();
    expect(readGalleryLink("#gallery-artist=abc")).toBeNull();
  });

  it("a gallery link whose id isn't an id → invalid, never fetched", () => {
    expect(readGalleryLink("#gallery-author=")).toBe("invalid");
    expect(readGalleryLink("#gallery-author=../../admin")).toBe("invalid");
    expect(readGalleryLink("#gallery-collection=a%2Fb")).toBe("invalid");
    expect(readGalleryLink("#gallery-collection=%E0%A4%A")).toBe("invalid");
    expect(readGalleryLink("#gallery-author=" + "a".repeat(65))).toBe("invalid");
    expect(readGalleryLink("#gallery=short")).toBe("invalid");
  });
});
