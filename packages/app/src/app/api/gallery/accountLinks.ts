import { SHARE_ID_PATTERN } from "../../../shareCrypto";
import type { AccountLink } from "../../../gallery/types";
import type { ShareStore } from "../share/store";
import { indexedIds } from "./authors";
import { galleryPaths, getJson, putJson, type GalleryBlobStore } from "./store";

// #2321 — private links listed on an account, so My shares can show them and
// revoke them from any device.
//
// #2329 — what is kept here is only `{ id, projectName, createdAt }`. Never the
// link's key and never the full link: the key lives only after the `#` in the
// link, in the browser that made it, so the server can't read a private link
// even for a signed-in person. Copying a link again works only on the device
// that holds the key (the browser's own list); other devices can revoke it.
//
// It lives at `gallery/account-links/<accountHash>/<shareId>.json` (private
// Blob, like every gallery record), one blob per link, and only one route reads
// it back: GET /api/gallery/me/shares, for the signed-in account itself.
//
// A link gets here two ways: made while signed in (POST /api/share), or brought
// in by the claim (#2320) from this browser's list.

export const MAX_PROJECT_NAME_CHARS = 200;

export function cleanProjectName(name: unknown): string {
  const s = typeof name === "string" ? name.trim() : "";
  return (s || "Untitled project").slice(0, MAX_PROJECT_NAME_CHARS);
}

/**
 * The only shape an account link is ever written in. Built field by field, so
 * nothing else a caller (or an old record) carries, such as a `url` or a key,
 * can ride along into the store.
 */
export function accountLinkRecord(id: string, projectName: unknown, createdAt: unknown): AccountLink {
  return {
    id,
    projectName: cleanProjectName(projectName),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

/** Record a link on the account. Returns false when it was already there (nothing written). */
export async function recordAccountLink(
  store: GalleryBlobStore,
  accountHash: string,
  link: AccountLink,
): Promise<boolean> {
  if (!SHARE_ID_PATTERN.test(link.id)) return false;
  if (await store.get(galleryPaths.accountLink(accountHash, link.id))) return false;
  await putJson(store, galleryPaths.accountLink(accountHash, link.id), accountLinkRecord(link.id, link.projectName, link.createdAt));
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

const KEPT_FIELDS = new Set<string>(["id", "projectName", "createdAt"]);

/**
 * #2329 — read one account link, keeping only `{ id, projectName, createdAt }`.
 * A record written before #2329 also held the whole link (key included): it is
 * rewritten once without it, so the key leaves the store the first time the
 * list is read. The id comes from the record's path, not its contents.
 */
async function readAccountLink(store: GalleryBlobStore, accountHash: string, id: string): Promise<AccountLink | null> {
  if (!SHARE_ID_PATTERN.test(id)) return null;
  const path = galleryPaths.accountLink(accountHash, id);
  const raw = await getJson<Record<string, unknown>>(store, path).catch(() => null);
  if (!raw || typeof raw !== "object") return null;
  const link = accountLinkRecord(id, raw.projectName, raw.createdAt);
  const extra = Object.keys(raw).some((k) => !KEPT_FIELDS.has(k));
  if (extra || raw.id !== id || raw.projectName !== link.projectName || raw.createdAt !== link.createdAt) {
    await putJson(store, path, link);
  }
  return link;
}

/**
 * The account's links, newest first. A link whose share is gone (revoked from
 * another account or with its token) is left out and its record tidied, so the
 * list never offers a dead link.
 */
export async function listAccountLinks(
  store: GalleryBlobStore,
  shares: ShareStore | null,
  accountHash: string,
): Promise<AccountLink[]> {
  const ids = await indexedIds(store, galleryPaths.accountLinksOf(accountHash));
  const found = await Promise.all(
    ids.map(async (id) => {
      // Links recorded here always have a manage record (made after #2311), so
      // its absence means the share is gone.
      if (shares && (await shares.getManageHash(id)) === null) {
        await forgetAccountLink(store, accountHash, id);
        return null;
      }
      return readAccountLink(store, accountHash, id);
    }),
  );
  return found.filter((l): l is AccountLink => l !== null).sort((a, b) => b.createdAt - a.createdAt);
}
