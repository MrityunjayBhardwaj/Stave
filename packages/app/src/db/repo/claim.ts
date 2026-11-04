import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../client";
import { authors, collections, entries } from "../schema";
import { inTransaction } from "./tx";

/*
 * #2320 — the claim's moves: bring what a browser published before sign-in
 * onto the account's author. Each move is ONE transaction, so there is no
 * half-moved state and no write order to get right (the Blob version needed
 * one, see claim.ts's header): either everything moved, or nothing did and the
 * browser's retry starts clean.
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
  db: Db,
  fromId: string,
  to: ClaimTarget,
): Promise<{ entries: number; collections: number }> {
  return inTransaction(db, async (tx) => {
    const now = Date.now();
    const movedEntries = await tx
      .update(entries)
      .set({
        authorId: to.authorId,
        authorName: to.name ? to.name : sql`${entries.authorName}`,
        authorEmail: to.email,
      })
      .where(and(eq(entries.authorId, fromId), isNull(entries.removedAt)))
      .returning({ id: entries.id });
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
    return { entries: movedEntries.length, collections: movedCollections.length };
  });
}

/**
 * Move one live entry from `fromId` (null: an entry from before profiles) to
 * the target. True when it moved; false when it is gone, removed, or no longer
 * `fromId`'s (someone else moved it first). One statement, so it is atomic.
 *
 * Phase 2 caller: claim.ts runClaim (entries by manage token) — POST /api/gallery/claim.
 */
export async function moveEntry(db: Db, id: string, fromId: string | null, to: ClaimTarget): Promise<boolean> {
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
