import { and, eq, isNull, sql } from "drizzle-orm";

import { authors, collections, entries } from "../schema";
import type { Q } from "./tx";

/*
 * #2320 — the claim's moves: bring what a browser published before sign-in
 * onto the account's author.
 *
 * #2352 — the claim (app/api/gallery/claim.ts runClaim) runs ALL of its moves
 * in ONE transaction and passes it here as `db`, so a claim that fails halfway
 * leaves nothing moved and the browser's retry starts clean. There is no write
 * order to get right (the Blob version needed one per item). mergeAuthorInto is
 * also atomic on its own: a savepoint inside the claim's transaction, its own
 * transaction when called with the database.
 *
 * Who may claim what (keys, tokens, "belongs to another account") is decided
 * by claim.ts before it calls these; these only move.
 */

/** Who the moved work lands on. */
export interface ClaimTarget {
  authorId: string;
  /** The target profile's name, put on each moved entry (kept when empty). */
  name: string;
  /** PRIVATE. The account's email, put on each moved entry's private side. */
  email: string;
}

/**
 * Merge author `fromId` into the target, in one transaction:
 *   1. every live entry of `fromId` moves (author id, shown name, private email);
 *   2. every collection of `fromId` moves;
 *   3. the target's bio is taken from `fromId` when the target has none;
 *   4. `fromId` is retired: `merged_into` = the target (its page answers `{ movedTo }`).
 * Returns what moved. Running it again after a success moves nothing (the old
 * author has nothing left) and leaves the retirement as it was.
 *
 * Phase 2 caller: claim.ts runClaim (the old profile, by its author key) —
 * POST /api/gallery/claim.
 */
export async function mergeAuthorInto(
  db: Q,
  fromId: string,
  to: ClaimTarget,
): Promise<{ entries: number; collections: number }> {
  return db.transaction(async (tx) => {
    const now = Date.now();
    const movedEntries = await tx
      .update(entries)
      .set({
        authorId: to.authorId,
        authorName: to.name ? to.name : sql`${entries.authorName}`,
        authorEmail: to.email,
      })
      // #2401 — hidden entries move too, so a restored one isn't left on a retired author.
      .where(and(eq(entries.authorId, fromId), isNull(entries.purgedAt)))
      .returning({ id: entries.id, removedAt: entries.removedAt });
    const movedCollections = await tx
      .update(collections)
      .set({ authorId: to.authorId })
      .where(eq(collections.authorId, fromId))
      .returning({ id: collections.id });

    const [old] = await tx.select().from(authors).where(eq(authors.id, fromId)).limit(1);
    if (old && !old.mergedInto) {
      if (old.bio) {
        await tx
          .update(authors)
          .set({ bio: old.bio, updatedAt: now })
          .where(and(eq(authors.id, to.authorId), eq(authors.bio, "")));
      }
      await tx.update(authors).set({ mergedInto: to.authorId, updatedAt: now }).where(eq(authors.id, fromId));
    }
    return { entries: movedEntries.filter((e) => e.removedAt === null).length, collections: movedCollections.length };
  });
}

/**
 * Move one live entry from `fromId` (null: an entry from before profiles) to
 * the target. True when it moved; false when it is gone, removed, or no longer
 * `fromId`'s (someone else moved it first). One statement, so it is atomic.
 *
 * Phase 2 caller: claim.ts runClaim (entries by manage token) — POST /api/gallery/claim.
 */
export async function moveEntry(db: Q, id: string, fromId: string | null, to: ClaimTarget): Promise<boolean> {
  const owner = fromId === null ? isNull(entries.authorId) : eq(entries.authorId, fromId);
  const rows = await db
    .update(entries)
    .set({
      authorId: to.authorId,
      authorName: to.name ? to.name : sql`${entries.authorName}`,
      authorEmail: to.email,
    })
    .where(and(eq(entries.id, id), owner, isNull(entries.removedAt)))
    .returning({ id: entries.id });
  return rows.length > 0;
}
