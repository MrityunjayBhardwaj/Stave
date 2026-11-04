import { SHARE_ID_PATTERN } from "../../../shareCrypto";
import type { AccountLink } from "../../../gallery/types";
import type { ShareStore } from "../share/store";
import { indexedIds } from "./authors";
import { galleryPaths, getJson, putJson, type GalleryBlobStore } from "./store";

// #2321 — private links kept on an account, so My shares can list them, copy
// them again and revoke them from any device.
//
// This is the one place the server holds a whole private link, key included.
// It lives at `gallery/account-links/<accountHash>/<shareId>.json` (private
// Blob, like every gallery record), one blob per link, and only one route reads
// it back: GET /api/gallery/me/shares, for the signed-in account itself.
//
// A link gets here two ways: made while signed in (POST /api/share with the key
// header), or brought in by the claim (#2320) from this browser's list.

export const MAX_PROJECT_NAME_CHARS = 200;
const KEY_PART = /^[A-Za-z0-9_-]{22}$/;
const MAX_URL_CHARS = 512;

/** The link for share `id` with key `key`, on `origin`. */
export function shareUrl(origin: string, id: string, key: string): string {
  return `${origin}/s/${id}#${key}`;
}

/** Does `url` look like the short link for `id` (http(s), `/s/<id>`, a whole key after `#`)? */
export function isShareUrlFor(url: unknown, id: string): url is string {
  if (typeof url !== "string" || url.length > MAX_URL_CHARS) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.pathname.replace(/\/$/, "") !== `/s/${id}`) return false;
  return KEY_PART.test(u.hash.slice(1));
}

export const isShareKey = (key: unknown): key is string => typeof key === "string" && KEY_PART.test(key);

export function cleanProjectName(name: unknown): string {
  const s = typeof name === "string" ? name.trim() : "";
  return (s || "Untitled project").slice(0, MAX_PROJECT_NAME_CHARS);
}

/** Record a link on the account. Returns false when it was already there (nothing written). */
export async function recordAccountLink(
  store: GalleryBlobStore,
  accountHash: string,
  link: AccountLink,
): Promise<boolean> {
  if (!SHARE_ID_PATTERN.test(link.id)) return false;
  if (await store.get(galleryPaths.accountLink(accountHash, link.id))) return false;
  await putJson(store, galleryPaths.accountLink(accountHash, link.id), link);
  return true;
}

export async function hasAccountLink(store: GalleryBlobStore, accountHash: string, id: string): Promise<boolean> {
  if (!SHARE_ID_PATTERN.test(id)) return false;
  return (await store.get(galleryPaths.accountLink(accountHash, id))) !== null;
}

export async function forgetAccountLink(store: GalleryBlobStore, accountHash: string, id: string): Promise<void> {
  if (!SHARE_ID_PATTERN.test(id)) return;
  await store.del([galleryPaths.accountLink(accountHash, id)]);
}

/**
 * The account's links, newest first. A link whose share is gone (revoked from
 * another account or with its token) is left out and its record tidied, so the
 * list never offers a dead link to copy.
 */
export async function listAccountLinks(
  store: GalleryBlobStore,
  shares: ShareStore | null,
  accountHash: string,
): Promise<AccountLink[]> {
  const ids = await indexedIds(store, galleryPaths.accountLinksOf(accountHash));
  const found = await Promise.all(
    ids.map(async (id) => {
      const link = await getJson<AccountLink>(store, galleryPaths.accountLink(accountHash, id)).catch(() => null);
      if (!link) return null;
      // Links recorded here always have a manage record (made after #2311), so
      // its absence means the share is gone.
      if (shares && (await shares.getManageHash(id)) === null) {
        await forgetAccountLink(store, accountHash, id);
        return null;
      }
      return link;
    }),
  );
  return found.filter((l): l is AccountLink => l !== null).sort((a, b) => b.createdAt - a.createdAt);
}
