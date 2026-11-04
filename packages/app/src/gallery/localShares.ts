/**
 * Community gallery (#2306) — what this browser remembers about the person
 * publishing: their name and email (so the dialog is pre-filled) and every
 * entry they published, with its manage token (so My shares can delete it).
 *
 * localStorage, not IndexedDB: tiny, synchronous, and survives project switches.
 * Clearing site data loses the tokens, and with them control of the uploads;
 * the publish dialog says so.
 */
import { MAX_CLAIM_ITEMS, type ClaimRefusal, type ClaimRequest, type GalleryKind } from "./types";

export interface GalleryAuthor {
  name: string;
  email: string;
  /** #2314 — this browser's author identity, once it has published. */
  authorId?: string;
  /** #2314 — the private key that edits this author's profile and collections. */
  authorKey?: string;
  /** #2320 — the account author this key was brought into (claimed); unset until then. */
  claimedBy?: string;
  /** #2320 — the account author a claim tried this for and the server refused (kept here). */
  claimRefusedBy?: string;
}

export interface LocalShare {
  id: string;
  title: string;
  kind: GalleryKind;
  publishedAt: number;
  manageToken: string;
  /** #2320 — the account author a claim brought this into; unset until then. */
  claimedBy?: string;
  /** #2320 — the account author a claim tried this for and the server refused (kept here). */
  claimRefusedBy?: string;
}

/** #2311 — a private short link this browser made (Copy Share Link). */
export interface LocalPrivateLink {
  id: string;
  /**
   * The whole link, key included, so it can be copied again. #2329 — kept only
   * here, in this browser: the account's list never has it, so Copy again works
   * only on the device that made the link.
   */
  url: string;
  projectName: string;
  createdAt: number;
  manageToken: string;
  /** #2320 — the account author a claim brought this into (or that recorded it when made). */
  claimedBy?: string;
  /** #2320 — the account author a claim tried this for and the server refused (kept here). */
  claimRefusedBy?: string;
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

// ── #2320 claiming what this browser holds into the signed-in account ────────

/** Has a claim for `authorId` already settled this item, either way? */
const settled = (x: { claimedBy?: string; claimRefusedBy?: string }, authorId: string) =>
  x.claimedBy === authorId || x.claimRefusedBy === authorId;

/**
 * What this browser still has to bring into account author `authorId`: its
 * author key and every entry and private link a claim hasn't settled for that
 * account yet. Null when there is nothing.
 */
export function pendingClaim(authorId: string): ClaimRequest | null {
  const author = loadAuthor();
  const req: ClaimRequest = {
    entries: listLocalShares()
      .filter((s) => !settled(s, authorId))
      .map((s) => ({ id: s.id, manageToken: s.manageToken }))
      // #2345 — one claim carries at most MAX_CLAIM_ITEMS of each; markClaimed
      // marks only what was sent, so the rest go with the next page load.
      .slice(0, MAX_CLAIM_ITEMS),
    links: listPrivateLinks()
      .filter((l) => !settled(l, authorId))
      // #2329 — never the url: the link's key stays in this browser.
      .map((l) => ({ id: l.id, manageToken: l.manageToken, projectName: l.projectName, createdAt: l.createdAt }))
      .slice(0, MAX_CLAIM_ITEMS),
  };
  if (author?.authorKey && !settled(author, authorId)) req.authorKey = author.authorKey;
  return req.authorKey || req.entries.length || req.links.length ? req : null;
}

/**
 * After the server answered a claim: mark each item it was sent, so it isn't
 * sent again on every load. Refused ones are marked refused (they stay "only
 * in this browser"); the rest are on the account now (moved, or already there).
 * The keys stay (a fallback until they are removed later); only the mark is added.
 */
export function markClaimed(authorId: string, sent: ClaimRequest, refused: ClaimRefusal[] = []): void {
  const no = (kind: ClaimRefusal["kind"]) => new Set(refused.filter((r) => r.kind === kind).map((r) => r.id));
  const noEntries = no("entry");
  const noLinks = no("link");
  const mark = <T extends { id: string }>(x: T, refusedIds: Set<string | undefined>): T =>
    refusedIds.has(x.id) ? { ...x, claimRefusedBy: authorId } : { ...x, claimedBy: authorId };
  const entryIds = new Set(sent.entries.map((e) => e.id));
  const linkIds = new Set(sent.links.map((l) => l.id));
  write(SHARES_KEY, listLocalShares().map((s) => (entryIds.has(s.id) ? mark(s, noEntries) : s)));
  write(LINKS_KEY, listPrivateLinks().map((l) => (linkIds.has(l.id) ? mark(l, noLinks) : l)));
  const author = loadAuthor();
  if (author && sent.authorKey && author.authorKey === sent.authorKey) {
    const authorRefused = refused.some((r) => r.kind === "author");
    saveAuthor(authorRefused ? { ...author, claimRefusedBy: authorId } : { ...author, claimedBy: authorId });
  }
  window.dispatchEvent(new Event(LOCAL_SHARES_CHANGED));
}
