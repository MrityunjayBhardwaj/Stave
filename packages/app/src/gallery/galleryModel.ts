/**
 * Community gallery (#2300) — the overlay's pure logic: which tab an entry is
 * in, what a search matches, how a `#gallery=<id>` link is read, and where an
 * added file lands. No React, no fetch — so every rule here is unit-tested.
 */
import { GALLERY_ID_PATTERN, type GalleryEntry, type GalleryKind, type GalleryManifest } from "./types";

export type GalleryTab = "project" | "music" | "viz" | "mine" | "moderation";

export const GALLERY_TABS: ReadonlyArray<{ id: GalleryTab; label: string }> = [
  { id: "project", label: "Projects" },
  { id: "music", label: "Music" },
  { id: "viz", label: "Viz" },
  { id: "mine", label: "My shares" },
];

/** #2331 — the admins' tab, added after My shares only when /api/gallery/me says isAdmin. */
export const MODERATION_TAB: { id: GalleryTab; label: string } = { id: "moderation", label: "Moderation" };

/** The tabs to show: the kinds and My shares, plus Moderation for an admin. */
export function galleryTabs(isAdmin: boolean): ReadonlyArray<{ id: GalleryTab; label: string }> {
  return isAdmin ? [...GALLERY_TABS, MODERATION_TAB] : GALLERY_TABS;
}

/** Is this tab one of the entry kinds (Projects / Music / Viz), with a count and a search? */
export function isKindTab(tab: GalleryTab): tab is GalleryKind {
  return tab !== "mine" && tab !== "moderation";
}

export const KIND_LABEL: Record<GalleryKind, string> = {
  project: "Project",
  music: "Music",
  viz: "Viz",
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

/** The entries one kind-tab shows, newest first, filtered by the search. */
export function entriesForTab(entries: readonly GalleryEntry[], kind: GalleryKind, query: string): GalleryEntry[] {
  return entries
    .filter((e) => e.kind === kind && entryMatches(e, query))
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/** How many entries each kind holds — the tab badges. */
export function countByKind(entries: readonly GalleryEntry[]): Record<GalleryKind, number> {
  const out: Record<GalleryKind, number> = { project: 0, music: 0, viz: 0 };
  for (const e of entries) if (e.kind in out) out[e.kind] += 1;
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
