/**
 * #2300 — the gallery's pure rules: the `#gallery=` link, search, the browse
 * grid's filter, order and counts (#2486), and where an added file lands.
 */
import { describe, it, expect } from "vitest";
import {
  browseEntries,
  countByFilter,
  GALLERY_SORTS,
  entryMatches,
  fileToAdd,
  generatedCard,
  readGalleryFragment,
} from "../galleryModel";
import type { GalleryEntry, GalleryManifest } from "../types";

const entry = (over: Partial<GalleryEntry>): GalleryEntry => ({
  id: "AAAAAAAAAAA",
  title: "Untitled",
  kind: "project",
  tags: [],
  authorName: "Someone",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail: false,
  ...over,
});

const ENTRIES: GalleryEntry[] = [
  entry({ id: "p1xxxxxxxxx", title: "Dub Techno Sketch", kind: "project", tags: ["dub", "techno"], authorName: "Alice", publishedAt: 100 }),
  entry({ id: "p2xxxxxxxxx", title: "Ambient Drift", kind: "project", tags: ["ambient"], authorName: "Bob", publishedAt: 300 }),
  entry({ id: "m1xxxxxxxxx", title: "Breakbeat", kind: "music", tags: ["dnb"], authorName: "Alice", publishedAt: 200 }),
  entry({ id: "v1xxxxxxxxx", title: "Kaleido", kind: "viz", tags: ["hydra"], authorName: "Carol", publishedAt: 50 }),
];

describe("readGalleryFragment", () => {
  it("reads a well-formed id", () => {
    expect(readGalleryFragment("#gallery=Ab3_-xY9zQ1")).toBe("Ab3_-xY9zQ1");
  });
  it("decodes a percent-encoded id", () => {
    expect(readGalleryFragment("#gallery=Ab3%5F-xY9zQ1")).toBe("Ab3_-xY9zQ1");
  });
  it("refuses anything that is not a gallery id", () => {
    expect(readGalleryFragment("#gallery=")).toBeNull();
    expect(readGalleryFragment("#gallery=short")).toBeNull();
    expect(readGalleryFragment("#gallery=../../api/xx")).toBeNull();
    expect(readGalleryFragment("#gallery=%E0%A4%A")).toBeNull(); // malformed escape
    expect(readGalleryFragment("#share=Ab3_-xY9zQ1")).toBeNull();
    expect(readGalleryFragment("")).toBeNull();
  });
});

describe("search", () => {
  it("matches title, tags and author, case-insensitively", () => {
    const e = ENTRIES[0];
    expect(entryMatches(e, "techno")).toBe(true);
    expect(entryMatches(e, "DUB")).toBe(true);
    expect(entryMatches(e, "alice")).toBe(true);
    expect(entryMatches(e, "#dub")).toBe(true);
    expect(entryMatches(e, "bob")).toBe(false);
  });
  it("needs every word to match somewhere", () => {
    expect(entryMatches(ENTRIES[0], "dub alice")).toBe(true);
    expect(entryMatches(ENTRIES[0], "dub bob")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(entryMatches(ENTRIES[3], "   ")).toBe(true);
  });
});

describe("browse grid (#2486)", () => {
  const ids = (es: GalleryEntry[]) => es.map((e) => e.id);
  it("All shows every entry, newest first", () => {
    expect(ids(browseEntries(ENTRIES, "all", "", "newest"))).toEqual(
      [...ENTRIES].sort((a, b) => b.publishedAt - a.publishedAt).map((e) => e.id),
    );
    expect(browseEntries(ENTRIES, "all", "", "newest")).toHaveLength(ENTRIES.length);
  });
  it("each kind filter shows only its kind", () => {
    expect(ids(browseEntries(ENTRIES, "project", "", "newest"))).toEqual(["p2xxxxxxxxx", "p1xxxxxxxxx"]);
    expect(ids(browseEntries(ENTRIES, "music", "", "newest"))).toEqual(["m1xxxxxxxxx"]);
    expect(ids(browseEntries(ENTRIES, "viz", "", "newest"))).toEqual(["v1xxxxxxxxx"]);
  });
  it("search narrows within the filter, never across it", () => {
    expect(ids(browseEntries(ENTRIES, "project", "alice", "newest"))).toEqual(["p1xxxxxxxxx"]);
    expect(browseEntries(ENTRIES, "viz", "alice", "newest")).toEqual([]);
  });
  it("a #tag search still finds tags with no chips", () => {
    expect(ids(browseEntries(ENTRIES, "all", "#techno", "newest"))).toEqual(["p1xxxxxxxxx"]);
  });
  it("counts follow the search, and All is the sum of the kinds", () => {
    expect(countByFilter(ENTRIES, "")).toEqual({ all: 4, project: 2, music: 1, viz: 1 });
    expect(countByFilter(ENTRIES, "alice")).toEqual({ all: 2, project: 1, music: 1, viz: 0 });
  });

  const SORTABLE: GalleryEntry[] = [
    entry({ id: "s1xxxxxxxxx", title: "track 10", authorName: "zed", publishedAt: 50 }),
    entry({ id: "s2xxxxxxxxx", title: "Track 2", authorName: "Émile", publishedAt: 40 }),
    entry({ id: "s3xxxxxxxxx", title: "alpha", authorName: "   ", publishedAt: 60 }),
    entry({ id: "s4xxxxxxxxx", title: "Alpha", authorName: "bea", publishedAt: 10 }),
  ];
  it("Oldest is Newest reversed", () => {
    expect(ids(browseEntries(SORTABLE, "all", "", "oldest"))).toEqual(["s4xxxxxxxxx", "s2xxxxxxxxx", "s1xxxxxxxxx", "s3xxxxxxxxx"]);
  });
  it("Title A–Z ignores case and reads numbers as numbers; equal titles go by artist", () => {
    // "alpha" (blank name → "Unnamed artist") and "Alpha" (bea) tie on the title: bea comes first.
    expect(ids(browseEntries(SORTABLE, "all", "", "title"))).toEqual(["s4xxxxxxxxx", "s3xxxxxxxxx", "s2xxxxxxxxx", "s1xxxxxxxxx"]);
  });
  it("Artist A–Z sorts by the name the card shows, accents folded", () => {
    // bea, Émile, Unnamed artist (blank), zed
    expect(ids(browseEntries(SORTABLE, "all", "", "artist"))).toEqual(["s4xxxxxxxxx", "s2xxxxxxxxx", "s3xxxxxxxxx", "s1xxxxxxxxx"]);
  });
  it("offers exactly Newest, Oldest, Title A–Z, Artist A–Z", () => {
    expect(GALLERY_SORTS.map((s) => s.label)).toEqual(["Newest", "Oldest", "Title A–Z", "Artist A–Z"]);
  });
  it("never reorders the list it was given", () => {
    const before = ids(SORTABLE);
    browseEntries(SORTABLE, "all", "", "title");
    expect(ids(SORTABLE)).toEqual(before);
  });
});

describe("fileToAdd", () => {
  const manifest = (path: string, language = "strudel"): GalleryManifest => ({
    schemaVersion: 1,
    project: { name: "x", sharedAt: 0 },
    files: [{ id: "f1", path, language, content: "s(\"bd\")" }],
    fileOrder: {},
    subfolderOrder: {},
  });
  it("puts the file at the project root under its own name", () => {
    expect(fileToAdd(manifest("songs/groove.strudel"))).toMatchObject({ path: "groove.strudel", ext: "strudel" });
  });
  it("never lets a published path climb out of the root", () => {
    const f = fileToAdd(manifest("../../evil/..hidden.hydra", "hydra"))!;
    expect(f.path).not.toContain("/");
    expect(f.path.startsWith(".")).toBe(false);
    expect(f.ext).toBe("hydra");
  });
  it("returns null for an empty manifest", () => {
    expect(fileToAdd({ ...manifest("a.strudel"), files: [] })).toBeNull();
  });
});

describe("generatedCard", () => {
  it("is stable per entry and takes two initials", () => {
    const a = generatedCard({ id: "p1xxxxxxxxx", title: "dub techno" });
    expect(a).toEqual(generatedCard({ id: "p1xxxxxxxxx", title: "dub techno" }));
    expect(a.initials).toBe("DT");
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });
});
