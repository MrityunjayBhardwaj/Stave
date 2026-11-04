import { SHARE_ID_PATTERN } from "../../../shareCrypto";
import type { AccountLink } from "../../../gallery/types";
import * as links from "../../../db/repo/links";
import type { Q } from "../../../db/repo/tx";
import type { ShareStore } from "../share/store";

// #2321 — private links listed on an account, so My shares can show them and
// revoke them from any device.
//
// #2329 — what is kept is only `{ id, projectName, createdAt }`. Never the
// link's key and never the full link: the key lives only after the `#` in the
// link, in the browser that made it, so the server can't read a private link
// even for a signed-in person. Copying a link again works only on the device
// that holds the key (the browser's own list); other devices can revoke it.
//
// #2352 — the list is the `account_links` table (src/db/schema.ts), whose only
// columns are the account, the share id, the name and the date: there is no
// column a key or a link could be written into. (The Blob version rewrote old
// records that still held the full link as they were read; a table can't hold
// one, so that step is gone.) The sealed bytes and the manage-token hash stay
// in the share store, beside the share, as before.
//
// A link gets here two ways: made while signed in (POST /api/share), or brought
// in by the claim (#2320) from this browser's list. The account's row must
// exist first (a foreign key): both callers have the session's author, which
// makes it.

export const MAX_PROJECT_NAME_CHARS = 200;

export function cleanProjectName(name: unknown): string {
  const s = typeof name === "string" ? name.trim() : "";
  return (s || "Untitled project").slice(0, MAX_PROJECT_NAME_CHARS);
}

/**
 * The only shape an account link is ever written in. Built field by field, so
 * nothing else a caller carries, such as a `url` or a key, can ride along.
 */
export function accountLinkRecord(id: string, projectName: unknown, createdAt: unknown): AccountLink {
  return {
    id,
    projectName: cleanProjectName(projectName),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

/** Record a link on the account. Returns false when it was already there (nothing written). */
export async function recordAccountLink(db: Q, accountHash: string, link: AccountLink): Promise<boolean> {
  if (!SHARE_ID_PATTERN.test(link.id)) return false;
  return links.recordAccountLink(db, accountHash, accountLinkRecord(link.id, link.projectName, link.createdAt));
}

export async function hasAccountLink(db: Q, accountHash: string, id: string): Promise<boolean> {
  if (!SHARE_ID_PATTERN.test(id)) return false;
  return links.hasAccountLink(db, accountHash, id);
}

export async function forgetAccountLink(db: Q, accountHash: string, id: string): Promise<void> {
  if (!SHARE_ID_PATTERN.test(id)) return;
  await links.forgetAccountLink(db, accountHash, id);
}

/**
 * The account's links, newest first. A link whose share is gone (revoked from
 * another account or with its token) is left out and its row removed, so the
 * list never offers a dead link.
 */
export async function listAccountLinks(db: Q, shares: ShareStore | null, accountHash: string): Promise<AccountLink[]> {
  const listed = await links.listAccountLinks(db, accountHash);
  const found = await Promise.all(
    listed.map(async (link) => {
      // Links recorded here always have a manage record (made after #2311), so
      // its absence means the share is gone.
      if (shares && (await shares.getManageHash(link.id)) === null) {
        await forgetAccountLink(db, accountHash, link.id);
        return null;
      }
      return link;
    }),
  );
  return found.filter((l): l is AccountLink => l !== null);
}
