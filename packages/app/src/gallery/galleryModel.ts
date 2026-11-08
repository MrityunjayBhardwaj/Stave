/**
 * Community gallery (#2300) — the gallery's pure logic: which filter an entry
 * is in, how the grid is ordered, what a search matches, how a `#gallery=<id>`
 * link is read, and where an added file lands. No React, no fetch — so every rule here is unit-tested.
 */
import { GALLERY_ID_PATTERN, type GalleryEntry, type GalleryKind, type GalleryManifest } from "./types";
import { shownName } from "./reservedNames";

/**
 * #2486 — what the gallery shows: the browse grid, My shares, or (admins only)
 * Moderation. My shares and Moderation are header buttons, not list tabs.
 */
export type GalleryTab = "browse" | "mine" | "moderation";

/** Is this one of the gallery's views? (A saved place is checked against it.) */
export function isGalleryTab(v: unknown): v is GalleryTab {
  return v === "browse" || v === "mine" || v === "moderation";
}

/** #2486 — the browse grid's filter: everything, or one kind. */
export type GalleryFilter = "all" | GalleryKind;

export const GALLERY_FILTERS: ReadonlyArray<{ id: GalleryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "project", label: "Projects" },
  { id: "music", label: "Music" },
  { id: "viz", label: "Visuals" },
];

export function isGalleryFilter(v: unknown): v is GalleryFilter {
  return GALLERY_FILTERS.some((f) => f.id === v);
}

/** #2486 — the browse grid's order. */
export type GallerySort = "newest" | "oldest" | "title" | "artist";

export const GALLERY_SORTS: ReadonlyArray<{ id: GallerySort; label: string }> = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "Title A–Z" },
  { id: "artist", label: "Artist A–Z" },
];

export function isGallerySort(v: unknown): v is GallerySort {
  return GALLERY_SORTS.some((s) => s.id === v);
}

/** One entry's kind, as a card or a detail line names it. */
export const KIND_LABEL: Record<GalleryKind, string> = {
  project: "Project",
  music: "Music",
  viz: "Visual",
};

export const GALLERY_HASH_PREFIX = "#gallery=";

/**
 * The entry id a `#gallery=<id>` fragment names, or null. An id that is not the
 * gallery's shape is refused here, so a crafted link never reaches a fetch.
 */
export function readGalleryFragment(hash: string): string | null {
  if (!hash.startsWith(GALLERY_HASH_PREFIX)) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(GALLERY_HASH_PREFIX.length));
  } catch {
    return null;
  }
  return GALLERY_ID_PATTERN.test(id) ? id : null;
}

/** What a gallery link in the URL fragment opens (#2300, #2314, #2315). */
export type GalleryLinkTarget =
  | { kind: "entry"; id: string }
  | { kind: "author"; id: string }
  | { kind: "collection"; id: string };

export const GALLERY_AUTHOR_HASH_PREFIX = "#gallery-author=";
export const GALLERY_COLLECTION_HASH_PREFIX = "#gallery-collection=";

/**
 * Author and collection ids: the contract fixes no length for them, so this is the
 * id alphabet only (base64url, at most 64) — enough that a crafted link can never
 * carry a path or a query into a fetch.
 */
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Read any gallery link in a fragment. `null` when the fragment is not a gallery
 * link at all; `"invalid"` when it is one but its id is not a gallery id (the
 * caller says so, rather than fetching it).
 */
export function readGalleryLink(hash: string): GalleryLinkTarget | "invalid" | null {
  if (hash.startsWith(GALLERY_HASH_PREFIX)) {
    const id = readGalleryFragment(hash);
    return id ? { kind: "entry", id } : "invalid";
  }
  for (const [prefix, kind] of [
    [GALLERY_AUTHOR_HASH_PREFIX, "author"],
    [GALLERY_COLLECTION_HASH_PREFIX, "collection"],
  ] as const) {
    if (!hash.startsWith(prefix)) continue;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(prefix.length));
    } catch {
      return "invalid";
    }
    return PROFILE_ID_PATTERN.test(id) ? { kind, id } : "invalid";
  }
  return null;
}

/** Lower-cased words of a query; an empty query matches everything. */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean);
}

/**
 * Does the entry match every word of the query, each against its title, tags or
 * author name? (All words must match somewhere — "dub alice" finds Alice's dub.)
 */
export function entryMatches(entry: GalleryEntry, query: string): boolean {
  const ts = terms(query);
  if (ts.length === 0) return true;
  const hay = [entry.title, entry.authorName, ...entry.tags].map((s) => s.toLowerCase());
  return ts.every((t) => hay.some((h) => h.includes(t)));
}

/** Case- and accent-blind, "Track 2" before "Track 10". */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const newestFirst = (a: GalleryEntry, b: GalleryEntry) => b.publishedAt - a.publishedAt || collator.compare(a.id, b.id);
const byTitle = (a: GalleryEntry, b: GalleryEntry) => collator.compare(a.title.trim(), b.title.trim());
// By the name the card shows (shownName, #2465), so the order matches what you read.
const byArtist = (a: GalleryEntry, b: GalleryEntry) => collator.compare(shownName(a.authorName), shownName(b.authorName));

const ORDER: Record<GallerySort, (a: GalleryEntry, b: GalleryEntry) => number> = {
  newest: newestFirst,
  oldest: (a, b) => -newestFirst(a, b),
  title: (a, b) => byTitle(a, b) || byArtist(a, b) || newestFirst(a, b),
  artist: (a, b) => byArtist(a, b) || byTitle(a, b) || newestFirst(a, b),
};

/** Does the entry pass the filter? `all` lets every entry through, whatever its kind. */
export function inFilter(entry: GalleryEntry, filter: GalleryFilter): boolean {
  return filter === "all" || entry.kind === filter;
}

/** #2486 — the browse grid: the entries the filter and the search let through, in the chosen order. */
export function browseEntries(
  entries: readonly GalleryEntry[],
  filter: GalleryFilter,
  query: string,
  sort: GallerySort,
): GalleryEntry[] {
  return entries.filter((e) => inFilter(e, filter) && entryMatches(e, query)).sort(ORDER[sort]);
}

/** How many entries each filter would show for this search — the filter's counts. */
export function countByFilter(entries: readonly GalleryEntry[], query: string): Record<GalleryFilter, number> {
  const out: Record<GalleryFilter, number> = { all: 0, project: 0, music: 0, viz: 0 };
  for (const e of entries) {
    if (!entryMatches(e, query)) continue;
    out.all += 1;
    if (e.kind === "project" || e.kind === "music" || e.kind === "viz") out[e.kind] += 1;
  }
  return out;
}

export function formatGalleryDate(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Where "Add to this project" puts a music / viz entry's file: its own name at
 * the project's root (the caller suffixes on a collision), so a published path
 * can never point outside the root. `ext` is returned so the caller can take the
 * language from the extension (lib/newFile's `extensionToLanguage`) rather than
 * trusting the manifest's label; it is not imported here to keep this module
 * free of the editor package.
 */
export function fileToAdd(
  manifest: GalleryManifest,
): { path: string; ext: string; content: string; language: string } | null {
  const f = manifest.files.find((x) => !x.path.split("/").pop()?.startsWith(".")) ?? manifest.files[0];
  if (!f) return null;
  const base = (f.path.split("/").pop() ?? "").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "") || "gallery";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return { path: base, ext: ext.toLowerCase(), content: f.content, language: f.language };
}

/** A two-letter monogram + hue for a card with no thumbnail, stable per entry. */
export function generatedCard(entry: Pick<GalleryEntry, "id" | "title">): { initials: string; hue: number } {
  const words = entry.title.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of entry.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { initials, hue: h % 360 };
}
