/**
 * #2300 — the overlay's pure rules: the `#gallery=` link, search, tab grouping,
 * and where an added file lands.
 */
import { describe, it, expect } from "vitest";
import {
  countByKind,
  entriesForTab,
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

describe("tab grouping", () => {
  it("each kind tab shows only its kind, newest first", () => {
    expect(entriesForTab(ENTRIES, "project", "").map((e) => e.id)).toEqual(["p2xxxxxxxxx", "p1xxxxxxxxx"]);
    expect(entriesForTab(ENTRIES, "music", "").map((e) => e.id)).toEqual(["m1xxxxxxxxx"]);
    expect(entriesForTab(ENTRIES, "viz", "").map((e) => e.id)).toEqual(["v1xxxxxxxxx"]);
  });
  it("search narrows within the tab, never across tabs", () => {
    expect(entriesForTab(ENTRIES, "project", "alice").map((e) => e.id)).toEqual(["p1xxxxxxxxx"]);
    expect(entriesForTab(ENTRIES, "viz", "alice")).toEqual([]);
  });
  it("counts each kind", () => {
    expect(countByKind(ENTRIES)).toEqual({ project: 2, music: 1, viz: 1 });
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
