import { and, desc, eq } from "drizzle-orm";

import type { AccountLink } from "../../gallery/types";
import { accountLinks } from "../schema";
import type { Q } from "./tx";

/*
 * #2321 / #2329 — private links listed on an account: `{ id, projectName,
 * createdAt }` only, never the link's key or the full link. The caller builds
 * the link with accountLinks.ts accountLinkRecord (which cleans the name and
 * checks nothing else rides along) and checks the share id's shape.
 *
 * The account row must exist (foreign key): sessionAuthor makes it on the
 * account's first gallery use, so call that (or getAccount) before recording.
 */

/**
 * Record a link on the account. False when it was already there (nothing written).
 * Phase 2 callers: POST /api/share (signed in), claim.ts (links by manage token).
 */
export async function recordAccountLink(db: Q, accountHash: string, link: AccountLink): Promise<boolean> {
  const rows = await db
    .insert(accountLinks)
    .values({ accountId: accountHash, shareId: link.id, projectName: link.projectName, createdAt: link.createdAt })
    .onConflictDoNothing()
    .returning({ shareId: accountLinks.shareId });
  return rows.length > 0;
}

/**
 * Is this link recorded on the account?
 * Phase 2 caller: DELETE /api/share/[id] (the account may revoke without the token).
 */
export async function hasAccountLink(db: Q, accountHash: string, shareId: string): Promise<boolean> {
  const rows = await db
    .select({ shareId: accountLinks.shareId })
    .from(accountLinks)
    .where(and(eq(accountLinks.accountId, accountHash), eq(accountLinks.shareId, shareId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Forget a link on the account (revoked, or its share is gone).
 * Phase 2 callers: DELETE /api/share/[id], accountLinks.ts listAccountLinks (tidying dead links).
 */
export async function forgetAccountLink(db: Q, accountHash: string, shareId: string): Promise<void> {
  await db.delete(accountLinks).where(and(eq(accountLinks.accountId, accountHash), eq(accountLinks.shareId, shareId)));
}

/**
 * The account's links, newest first.
 * Phase 2 caller: accountLinks.ts listAccountLinks → GET /api/gallery/me/shares.
 */
export async function listAccountLinks(db: Q, accountHash: string): Promise<AccountLink[]> {
  const rows = await db
    .select()
    .from(accountLinks)
    .where(eq(accountLinks.accountId, accountHash))
    .orderBy(desc(accountLinks.createdAt), desc(accountLinks.shareId));
  return rows.map((r) => ({ id: r.shareId, projectName: r.projectName, createdAt: r.createdAt }));
}
