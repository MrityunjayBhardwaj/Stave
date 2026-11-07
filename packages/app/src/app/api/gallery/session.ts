import { createHash } from "node:crypto";

import type { GetServerSidePropsContext } from "next";

import { auth, type StaveAccountClaim } from "../../../auth";
import { signInAvailable } from "../../../authProviders";
import { getDb, type Db } from "../../../db/client";
import { databaseUnavailable, isDatabaseUnavailable, withoutQueryValues } from "../../../db/errors";
import {
  ensureAccountAuthor,
  getAccount,
  getAccountByAuthor,
  getAuthor,
  linkAccount,
  refreshAccount,
  type AccountClaimInput,
  type AccountRecord,
} from "../../../db/repo/accounts";
import { isReservedName } from "../../../gallery/reservedNames";
import { AUTHOR_KEY_HEADER, MAX_AUTHOR_NAME_CHARS, type GalleryVerified } from "../../../gallery/types";
import { sessionRenewalDue } from "../../../sessionLifetime";
import { authorForKey, keyOwnsAuthor } from "./authors";

/*
 * #2319 — signed-in accounts and the gallery author each one is linked to.
 *
 * Every gallery route that needs to know WHO is asking goes through this file.
 * Auth.js (src/auth.ts) keeps the session in a signed cookie; the session's
 * `account` claim names the provider and the provider's account id. This module
 * turns that into an author.
 *
 * ── Records (#2352: in Postgres, see src/db/schema.ts) ──────────────────────
 *
 *   accounts   one row per signed-in account, keyed by
 *              accountHash = sha256("<provider>:<providerAccountId>"), hex.
 *              Holds authorId (unique: an author belongs to at most one
 *              account), the account's email, provider, and the public badge
 *              (GitHub login / avatar). No response ever carries the email.
 *   authors    the profile the account is linked to.
 *
 *   An account is readable both ways:
 *     by account → readAccount(accountHash)
 *     by author  → accountForAuthor(authorId)
 *
 * Profiles live only in the database. (Phase 1 of the move also wrote a new
 * account's profile to Blob for the routes that still read it there; phase 2
 * moved those readers and removed that copy.)
 *
 * ── API ─────────────────────────────────────────────────────────────────────
 *
 *   sessionClaim()                       → StaveAccountClaim | null
 *       The signed-in account from the cookie; null when signed out, or when
 *       sign-in isn't set up (auth() failing counts as signed out).
 *
 *   renewSessionCookie(req, res)
 *       #2367 — puts a renewed session cookie on `res` when the request's cookie
 *       is at least a day old. Only GET /api/gallery/me calls it: every page load
 *       reads that route, and it answers no-store.
 *
 *   sessionAuthor(req, { create? })      → { authorId, account } | null
 *       The author linked to the session's account. With `create` (default
 *       true) the first call for an account makes its author (named after the
 *       account, unless that name is reserved, #2368) — "first gallery use". #2349: race-safe; any number of first
 *       requests at once, on any servers, make ONE author and all answer with
 *       it (db/repo/accounts.ts ensureAccountAuthor). With create:false it only
 *       looks (ownership checks use this, so checking never makes one).
 *       Follows a changed GitHub login, avatar or email. Null when there is no
 *       database here. Throws when the database can't be reached (routes answer
 *       503 for that, #2351).
 *
 *   requireSessionAuthor(req, { signedOut? }) → { authorId, account } | Response
 *       sessionAuthor, or the Response to send instead: 503 (no database here,
 *       sign-in not set up here, or the database unreachable),
 *       401 { error: signedOut ?? "sign in to publish" }, 500.
 *
 *   actingAuthor(req)
 *       The session's author, else the author the key names. #2320 — a key
 *       whose profile was merged into an account acts for nobody.
 *
 *   mayManageAuthor(req, authorId)
 *       True when the session's author IS authorId, or the request carries
 *       that author's key (AUTHOR_KEY_HEADER) — the fallback for profiles
 *       made before sign-in.
 *
 *   accountHashOf(provider, providerAccountId) → string
 *   readAccount(accountHash)                   → GalleryAccountRecord | null
 *   accountForAuthor(authorId)                 → GalleryAccountRecord | null
 *
 *   attachAuthorToAccount(claim, email, authorId, { replace? })
 *       → { ok: true, account } | { ok: false, reason }
 *       Link author X to account Y (db/repo/accounts.ts linkAccount, one
 *       transaction); the badge goes on the profile and the account email on
 *       the author. Refuses ("author-taken") an author already linked to a
 *       DIFFERENT account. Refuses ("account-linked") an account already
 *       linked to a different author unless `replace: true`.
 */

/** A signed-in account and the author it is linked to. Never served. */
export type GalleryAccountRecord = AccountRecord;

export interface SessionAuthor {
  authorId: string;
  account: GalleryAccountRecord;
}

export function accountHashOf(provider: string, providerAccountId: string): string {
  return createHash("sha256").update(`${provider}:${providerAccountId}`, "utf8").digest("hex");
}

/** The gallery database; throws when it can't be opened, or when none is configured here. */
async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("the gallery has no database configured here");
  return d;
}

export async function readAccount(accountHash: string): Promise<GalleryAccountRecord | null> {
  return getAccount(await db(), accountHash);
}

export async function accountForAuthor(authorId: string): Promise<GalleryAccountRecord | null> {
  return getAccountByAuthor(await db(), authorId);
}

/** The public badge for a claim. Only what the provider shows publicly anyway. */
export function verifiedOf(claim: StaveAccountClaim): GalleryVerified {
  const v: GalleryVerified = { provider: claim.badge };
  if (claim.badge === "github" && claim.login) v.login = claim.login;
  if (claim.avatarUrl && /^https:\/\//.test(claim.avatarUrl)) v.avatarUrl = claim.avatarUrl;
  return v;
}

const sameVerified = (a: GalleryVerified | undefined, b: GalleryVerified): boolean =>
  !!a && a.provider === b.provider && a.login === b.login && a.avatarUrl === b.avatarUrl;

/** The session's account claim and email, or null when signed out or sign-in isn't set up. */
export async function sessionClaim(): Promise<{ claim: StaveAccountClaim; email: string; name: string } | null> {
  if (!signInAvailable(process.env)) return null;
  let session;
  try {
    session = await auth();
  } catch {
    return null;
  }
  const claim = session?.account;
  if (!claim?.provider || !claim.providerAccountId) return null;
  return { claim, email: session?.user?.email ?? "", name: session?.user?.name ?? "" };
}

/** Auth.js's session cookie: `__Secure-` over https, `.0`, `.1`… when it's long enough to be split. */
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?=/;

/**
 * Keep an active session alive. Auth.js re-issues the cookie on every session
 * read, but plain `auth()` drops it; this form of `auth()` hands it over, on the
 * Response it's given. So: read into a spare Response, and copy the cookie across
 * only when it's due, which keeps most answers free of Set-Cookie. Only the session
 * cookie: the read also mints Auth.js's sign-in cookies (CSRF, callback URL), which
 * a session read has no business setting.
 */
export async function renewSessionCookie(req: Request, res: Response): Promise<void> {
  const reissued = new Response();
  const session = await auth({ req, res: reissued } as unknown as GetServerSidePropsContext);
  if (!sessionRenewalDue(session?.issuedAt)) return;
  for (const cookie of reissued.headers.getSetCookie()) {
    if (SESSION_COOKIE.test(cookie)) res.headers.append("Set-Cookie", cookie);
  }
}

const claimInput = (claim: StaveAccountClaim, email: string): AccountClaimInput => ({
  accountHash: accountHashOf(claim.provider, claim.providerAccountId),
  provider: claim.provider,
  providerAccountId: claim.providerAccountId,
  email,
  verified: verifiedOf(claim),
});

export type AttachResult =
  | { ok: true; account: GalleryAccountRecord }
  | { ok: false; reason: "no-author" | "author-taken" | "account-linked" };

/** Link author `authorId` to the claim's account. See the header for the rules. */
export async function attachAuthorToAccount(
  claim: StaveAccountClaim,
  email: string,
  authorId: string,
  opts: { replace?: boolean } = {},
): Promise<AttachResult> {
  const linked = await linkAccount(await db(), claimInput(claim, email), authorId, opts);
  return linked.ok ? { ok: true, account: linked.account } : linked;
}

/**
 * The name a new author starts with: the account's name, else its login, else a
 * placeholder. #2368 — a reserved one is passed over, never a reason to refuse
 * the sign-in: a GitHub account really named "Stave" gets the next one down.
 * Checked after the cut, because the cut is what gets stored.
 */
function startingName(name: string, claim: StaveAccountClaim): string {
  for (const candidate of [name, claim.login ?? ""]) {
    const n = candidate.trim().slice(0, MAX_AUTHOR_NAME_CHARS);
    if (n && !isReservedName(n)) return n;
  }
  return "New artist";
}

/**
 * The author linked to the session's account, made on first use unless
 * `create: false`. `req` is taken so callers never change if reading the
 * session moves onto the request; Auth.js reads it from the request scope today.
 */
export async function sessionAuthor(
  _req: Request,
  opts: { create?: boolean } = {},
): Promise<SessionAuthor | null> {
  const signedIn = await sessionClaim();
  if (!signedIn) return null;
  const { claim, email, name } = signedIn;
  const d = await getDb();
  if (!d) return null;

  const input = claimInput(claim, email);
  const account = await getAccount(d, input.accountHash);
  if (account) {
    if (sameVerified(account.verified, input.verified) && account.email === email) return { authorId: account.authorId, account };
    // The GitHub login, avatar or email changed since the last visit: follow it.
    const refreshed = await refreshAccount(d, input.accountHash, { email, verified: input.verified });
    return { authorId: account.authorId, account: refreshed ?? account };
  }
  if (opts.create === false) return null;

  // #2349 — race-safe: one author however many first requests arrive at once.
  const made = await ensureAccountAuthor(d, { ...input, name: startingName(name, claim) });
  return { authorId: made.account.authorId, account: made.account };
}

/**
 * sessionAuthor, or the Response to answer with. `signedOut` is the 401's
 * message (the #2320 / #2321 routes say what needs signing in for).
 */
export async function requireSessionAuthor(
  req: Request,
  opts: { signedOut?: string } = {},
): Promise<SessionAuthor | Response> {
  const notSetUp = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  if (!signInAvailable(process.env)) {
    return Response.json(
      { error: "sign-in isn't set up on this site, so publishing is turned off" },
      { status: 503 },
    );
  }
  if (!(await sessionClaim())) {
    return Response.json({ error: opts.signedOut ?? "sign in to publish" }, { status: 401 });
  }
  let found: SessionAuthor | null;
  try {
    if (!(await getDb())) return notSetUp();
    found = await sessionAuthor(req);
  } catch (err) {
    // #2351 — the database can't be reached: "try again shortly", never a 500.
    if (!isDatabaseUnavailable(err)) throw err;
    console.warn("[stave] gallery database unavailable:", withoutQueryValues(err));
    return databaseUnavailable();
  }
  if (!found) return Response.json({ error: "could not set up your gallery profile" }, { status: 500 });
  return found;
}

/** The session's author is `authorId`, or the request holds that author's key. */
export async function mayManageAuthor(req: Request, authorId: string): Promise<boolean> {
  const mine = await sessionAuthor(req, { create: false });
  if (mine?.authorId === authorId) return true;
  return keyOwnsAuthor(await db(), authorId, req.headers.get(AUTHOR_KEY_HEADER));
}

/** Whose request is this: the session's author, else the author the key names, else null. */
export async function actingAuthor(req: Request): Promise<string | null> {
  const mine = await sessionAuthor(req);
  if (mine) return mine.authorId;
  const d = await db();
  const keyed = await authorForKey(d, req.headers.get(AUTHOR_KEY_HEADER));
  if (!keyed) return null;
  // #2320 — a key whose profile was merged into an account acts for nobody:
  // what it made now belongs to the account, and the key is not the account.
  return (await getAuthor(d, keyed))?.mergedInto ? null : keyed;
}
