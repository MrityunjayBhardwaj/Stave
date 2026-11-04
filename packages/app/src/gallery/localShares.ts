/**
 * Community gallery (#2306) — what this browser remembers about the person
 * publishing: their name and email (so the dialog is pre-filled) and every
 * entry they published, with its manage token (so My shares can delete it).
 *
 * localStorage, not IndexedDB: tiny, synchronous, and survives project switches.
 * Clearing site data loses the tokens, and with them control of the uploads;
 * the publish dialog says so.
 */
import type { GalleryKind } from "./types";

export interface GalleryAuthor {
  name: string;
  email: string;
}

export interface LocalShare {
  id: string;
  title: string;
  kind: GalleryKind;
  publishedAt: number;
  manageToken: string;
}

/** #2311 — a private short link this browser made (Copy Share Link). */
export interface LocalPrivateLink {
  id: string;
  /** The whole link, key included, so it can be copied again. */
  url: string;
  projectName: string;
  createdAt: number;
  manageToken: string;
}

const LINKS_KEY = "stave.share.links";
const AUTHOR_KEY = "stave.gallery.author";
const SHARES_KEY = "stave.gallery.shares";
/** Fired on window when the local share list changes, so an open My shares tab refreshes. */
export const LOCAL_SHARES_CHANGED = "stave:gallery-shares-changed";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadAuthor(): GalleryAuthor | null {
  const a = read<GalleryAuthor | null>(AUTHOR_KEY, null);
  return a && typeof a.name === "string" && typeof a.email === "string" ? a : null;
}

export function saveAuthor(author: GalleryAuthor): void {
  write(AUTHOR_KEY, author);
}

/** Newest first. */
export function listLocalShares(): LocalShare[] {
  const list = read<LocalShare[]>(SHARES_KEY, []);
  return Array.isArray(list) ? [...list].sort((a, b) => b.publishedAt - a.publishedAt) : [];
}

export function addLocalShare(share: LocalShare): void {
  const rest = listLocalShares().filter((s) => s.id !== share.id);
  write(SHARES_KEY, [share, ...rest]);
  window.dispatchEvent(new Event(LOCAL_SHARES_CHANGED));
}

export function removeLocalShare(id: string): void {
  write(SHARES_KEY, listLocalShares().filter((s) => s.id !== id));
  window.dispatchEvent(new Event(LOCAL_SHARES_CHANGED));
}

/** #2311 — private links, newest first. */
export function listPrivateLinks(): LocalPrivateLink[] {
  const list = read<LocalPrivateLink[]>(LINKS_KEY, []);
  return Array.isArray(list) ? [...list].sort((a, b) => b.createdAt - a.createdAt) : [];
}

export function addPrivateLink(link: LocalPrivateLink): void {
  const rest = listPrivateLinks().filter((l) => l.id !== link.id);
  write(LINKS_KEY, [link, ...rest]);
  window.dispatchEvent(new Event(LOCAL_SHARES_CHANGED));
}

export function removePrivateLink(id: string): void {
  write(LINKS_KEY, listPrivateLinks().filter((l) => l.id !== id));
  window.dispatchEvent(new Event(LOCAL_SHARES_CHANGED));
}
