import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import type { ActiveSuspension } from "../../gallery/types";
import { accounts, authors, suspensions } from "../schema";
import type { Q } from "./tx";

/*
 * #2400 — accounts suspended by an admin. A row counts while `until` is null or in
 * the future, so a suspension ends by itself. Nothing here returns the email.
 */

const inForce = (at: number) => or(isNull(suspensions.until), gt(suspensions.until, at));

export interface SuspensionRecord {
  until: number | null;
  hideProfile: boolean;
}

/** Suspend an account, replacing any suspension it already has. */
export async function upsertSuspension(
  q: Q,
  s: { accountId: string; at: number; until: number | null; reason: string; hideProfile: boolean },
): Promise<void> {
  await q
    .insert(suspensions)
    .values(s)
    .onConflictDoUpdate({
      target: suspensions.accountId,
      set: { at: s.at, until: s.until, reason: s.reason, hideProfile: s.hideProfile },
    });
}

/** The suspension in force on this account, or null. */
export async function suspensionOfAccount(q: Q, accountId: string, at = Date.now()): Promise<SuspensionRecord | null> {
  const [row] = await q
    .select({ until: suspensions.until, hideProfile: suspensions.hideProfile })
    .from(suspensions)
    .where(and(eq(suspensions.accountId, accountId), inForce(at)))
    .limit(1);
  return row ?? null;
}

/** The suspension in force on this author's account, or null (also for an author with no account). */
export async function suspensionOfAuthor(q: Q, authorId: string, at = Date.now()): Promise<SuspensionRecord | null> {
  const [row] = await q
    .select({ until: suspensions.until, hideProfile: suspensions.hideProfile })
    .from(suspensions)
    .innerJoin(accounts, eq(accounts.id, suspensions.accountId))
    .where(and(eq(accounts.authorId, authorId), inForce(at)))
    .limit(1);
  return row ?? null;
}

/** End the suspension in force on this account. False when there is none. */
export async function liftSuspensionOf(q: Q, accountId: string, at = Date.now()): Promise<boolean> {
  const rows = await q
    .delete(suspensions)
    .where(and(eq(suspensions.accountId, accountId), inForce(at)))
    .returning({ accountId: suspensions.accountId });
  return rows.length > 0;
}

/** Every suspension in force, newest first, for the Moderation tab. */
export async function activeSuspensions(q: Q, at = Date.now()): Promise<ActiveSuspension[]> {
  return q
    .select({
      authorId: authors.id,
      name: authors.name,
      at: suspensions.at,
      until: suspensions.until,
      reason: suspensions.reason,
      hideProfile: suspensions.hideProfile,
    })
    .from(suspensions)
    .innerJoin(accounts, eq(accounts.id, suspensions.accountId))
    .innerJoin(authors, eq(authors.id, accounts.authorId))
    .where(inForce(at))
    .orderBy(desc(suspensions.at));
}
