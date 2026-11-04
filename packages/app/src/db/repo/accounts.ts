import { and, eq, isNull, ne } from "drizzle-orm";

import { newShareId } from "../../shareCrypto";
import type { GalleryAuthorProfile, GalleryVerified } from "../../gallery/types";
import type { Db } from "../client";
import { accounts, authorKeys, authors } from "../schema";
import { inTransaction, type Q } from "./tx";

/*
 * #2314 / #2319 / #2349 — accounts and authors.
 *
 * An account (a signed-in provider account) is linked to exactly one author,
 * and an author to at most one account (unique `accounts.author_id`). An
 * account's first gallery use makes its author: ensureAccountAuthor, which is
 * race-safe across requests and servers through the unique primary key on
 * `accounts.id` (#2349).
 */

/** A signed-in account and the author it is linked to. Never served. */
export interface AccountRecord {
  /** sha256("<provider>:<providerAccountId>"), hex. */
  accountHash: string;
  /** Auth.js provider id ("github", "google", "test-login"). */
  provider: string;
  authorId: string;
  email: string;
  verified: GalleryVerified;
  createdAt: number;
  updatedAt: number;
}

/** An author as stored: the public profile, plus the private email and the #2320 merge marker. */
export interface StoredAuthor extends GalleryAuthorProfile {
  /** PRIVATE. */
  email: string;
  /** #2320 — retired by a claim into this author. */
  mergedInto?: string;
}

type AccountRow = typeof accounts.$inferSelect;
type AuthorRow = typeof authors.$inferSelect;

const toAccount = (r: AccountRow): AccountRecord => ({
  accountHash: r.id,
  provider: r.provider,
  authorId: r.authorId,
  email: r.email,
  verified: r.verified,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toAuthor = (r: AuthorRow): StoredAuthor => {
  const out: StoredAuthor = {
    authorId: r.id,
    name: r.name,
    bio: r.bio,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    email: r.email,
  };
  if (r.verified) out.verified = r.verified;
  if (r.mergedInto) out.mergedInto = r.mergedInto;
  return out;
};

/** The public profile only: what a response may carry. */
export function publicProfile(a: GalleryAuthorProfile): GalleryAuthorProfile {
  const out: GalleryAuthorProfile = {
    authorId: a.authorId,
    name: a.name,
    bio: a.bio,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
  if (a.verified) {
    const v = a.verified;
    out.verified = { provider: v.provider };
    if (v.login) out.verified.login = v.login;
    if (v.avatarUrl) out.verified.avatarUrl = v.avatarUrl;
  }
  return out;
}

// ── accounts ─────────────────────────────────────────────────────────────────

/**
 * The account with this hash, or null.
 * Called by: session.ts sessionAuthor (every route that asks who is signed in);
 * phase 2: claim.ts ownedElsewhere.
 */
export async function getAccount(db: Q, accountHash: string): Promise<AccountRecord | null> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountHash)).limit(1);
  return row ? toAccount(row) : null;
}

/**
 * The account an author is linked to, or null.
 * Called by: session.ts accountForAuthor → claim.ts ownedElsewhere (POST /api/gallery/claim).
 */
export async function getAccountByAuthor(db: Q, authorId: string): Promise<AccountRecord | null> {
  const [row] = await db.select().from(accounts).where(eq(accounts.authorId, authorId)).limit(1);
  return row ? toAccount(row) : null;
}

export interface AccountClaimInput {
  accountHash: string;
  provider: string;
  providerAccountId: string;
  email: string;
  verified: GalleryVerified;
}

/**
 * #2349 — the account's author, made on first use. Idempotent and race-safe:
 *
 *   1. the account exists → it (no write);
 *   2. else, in ONE transaction: insert a new author, then insert the account
 *      `ON CONFLICT DO NOTHING`. Another request (on any server) that inserted
 *      the account first wins the unique key: this one's insert returns no row,
 *      the transaction is rolled back (so its author is never left behind), and
 *   3. the winner's account is read back.
 *
 * However many first requests race, exactly one author is made and every one
 * of them answers with it. `created` is true for the request that made it.
 *
 * Called by: session.ts sessionAuthor (create: true) — GET /api/gallery/me,
 * POST /api/gallery (publish), POST /api/gallery/claim, GET /api/gallery/me/shares,
 * POST /api/gallery/collections (actingAuthor).
 */
export async function ensureAccountAuthor(
  db: Db,
  input: AccountClaimInput & { name: string },
): Promise<{ account: AccountRecord; created: boolean }> {
  const existing = await getAccount(db, input.accountHash);
  if (existing) return { account: existing, created: false };

  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const authorId = newShareId();
    const made = await inTransaction(db, async (tx) => {
      const [author] = await tx
        .insert(authors)
        .values({ id: authorId, name: input.name, bio: "", verified: input.verified, email: input.email, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: authors.id });
      if (!author) return "id-taken" as const; // 64 random bits clashed: try another id
      const [account] = await tx
        .insert(accounts)
        .values({
          id: input.accountHash,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          authorId,
          email: input.email,
          verified: input.verified,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!account) {
        // Lost the race: undo our author. Returning (not throwing) after
        // deleting keeps the transaction's own work at nothing.
        await tx.delete(authors).where(eq(authors.id, authorId));
        return "lost" as const;
      }
      return toAccount(account);
    });
    if (made === "id-taken") continue;
    if (made === "lost") break;
    return { account: made, created: true };
  }
  const winner = await getAccount(db, input.accountHash);
  if (!winner) throw new Error("the account's author could not be made");
  return { account: winner, created: false };
}

/**
 * The GitHub login, avatar or email changed since the last visit: follow it on
 * the account and the author's badge and private email. One transaction.
 * Called by: session.ts sessionAuthor.
 */
export async function refreshAccount(
  db: Db,
  accountHash: string,
  next: { email: string; verified: GalleryVerified },
): Promise<AccountRecord | null> {
  return inTransaction(db, async (tx) => {
    const now = Date.now();
    const [row] = await tx
      .update(accounts)
      .set({ email: next.email, verified: next.verified, updatedAt: now })
      .where(eq(accounts.id, accountHash))
      .returning();
    if (!row) return null;
    await tx.update(authors).set({ email: next.email, verified: next.verified }).where(eq(authors.id, row.authorId));
    return toAccount(row);
  });
}

export type LinkResult =
  | { ok: true; account: AccountRecord; replaced: string | null }
  | { ok: false; reason: "no-author" | "author-taken" | "account-linked" };

/**
 * Link `authorId` to the account (#2319 attachAuthorToAccount). Refuses
 * "no-author" (no such author), "author-taken" (linked to a DIFFERENT account),
 * "account-linked" (the account is linked to a different author, unless
 * `replace`). On success the account row points at the author, and the
 * author's badge and private email follow the account. One transaction;
 * `replaced` is the author the account was linked to before, if any.
 *
 * Called by: session.ts attachAuthorToAccount (tests, and the claim flow's
 * future "link instead of merge").
 */
export async function linkAccount(
  db: Db,
  input: AccountClaimInput,
  authorId: string,
  opts: { replace?: boolean } = {},
): Promise<LinkResult> {
  return inTransaction(db, async (tx) => {
    const [author] = await tx.select({ id: authors.id }).from(authors).where(eq(authors.id, authorId)).limit(1);
    if (!author) return { ok: false, reason: "no-author" } as const;
    const [owner] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.authorId, authorId), ne(accounts.id, input.accountHash)))
      .limit(1);
    if (owner) return { ok: false, reason: "author-taken" } as const;
    const existing = await getAccount(tx, input.accountHash);
    if (existing && existing.authorId !== authorId && !opts.replace) return { ok: false, reason: "account-linked" } as const;

    const now = Date.now();
    const [row] = await tx
      .insert(accounts)
      .values({
        id: input.accountHash,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        authorId,
        email: input.email,
        verified: input.verified,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { authorId, email: input.email, verified: input.verified, updatedAt: now },
      })
      .returning();
    await tx.update(authors).set({ email: input.email, verified: input.verified }).where(eq(authors.id, authorId));
    const replaced = existing && existing.authorId !== authorId ? existing.authorId : null;
    return { ok: true, account: toAccount(row), replaced } as const;
  });
}

// ── authors ──────────────────────────────────────────────────────────────────

/**
 * The stored author, or null.
 * Phase 2 callers: GET/PUT /api/gallery/authors/[authorId], POST /api/gallery
 * (the profile name on a new entry), GET /api/gallery/me, claim.ts,
 * session.ts actingAuthor, GET /api/gallery/collections/[id].
 */
export async function getAuthor(db: Q, authorId: string): Promise<StoredAuthor | null> {
  const [row] = await db.select().from(authors).where(eq(authors.id, authorId)).limit(1);
  return row ? toAuthor(row) : null;
}

/**
 * Make a key-held author (#2314, before sign-in): the author and its key hash
 * in one transaction. Returns the new id, or null after three id clashes.
 * Called by: authors.ts createAuthor (#2320's claim tests, and the dev-only seed
 * route the browser specs use; no route makes one for real any more).
 */
export async function insertKeyedAuthor(
  db: Db,
  input: { name: string; email: string; keyHash: string },
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newShareId();
    const now = Date.now();
    const made = await inTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(authors)
        .values({ id, name: input.name, bio: "", email: input.email, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: authors.id });
      if (!row) return false;
      await tx.insert(authorKeys).values({ keyHash: input.keyHash, authorId: id });
      return true;
    });
    if (made) return id;
  }
  return null;
}

/**
 * The author a key hash belongs to, or null. The caller still confirms with
 * the constant-time compare against authorKeyHash (authors.ts keyOwnsAuthor).
 * Called by: authors.ts authorForKey (claim, collections, author PUT).
 */
export async function authorIdForKeyHash(db: Q, keyHash: string): Promise<string | null> {
  const [row] = await db.select({ authorId: authorKeys.authorId }).from(authorKeys).where(eq(authorKeys.keyHash, keyHash)).limit(1);
  return row?.authorId ?? null;
}

/**
 * The stored key hash of an author, or null (an account's author has no key).
 * Called by: authors.ts keyOwnsAuthor.
 */
export async function authorKeyHash(db: Q, authorId: string): Promise<string | null> {
  const [row] = await db.select({ keyHash: authorKeys.keyHash }).from(authorKeys).where(eq(authorKeys.authorId, authorId)).limit(1);
  return row?.keyHash ?? null;
}

/**
 * Change an author's name and bio; the updated public profile, or null when
 * there is no such author or it was merged away.
 * Called by: PUT /api/gallery/authors/[authorId].
 */
export async function updateAuthorProfile(
  db: Q,
  authorId: string,
  next: { name: string; bio: string },
): Promise<GalleryAuthorProfile | null> {
  const [row] = await db
    .update(authors)
    .set({ name: next.name, bio: next.bio, updatedAt: Date.now() })
    .where(and(eq(authors.id, authorId), isNull(authors.mergedInto)))
    .returning();
  return row ? publicProfile(toAuthor(row)) : null;
}
