import { createHash } from "node:crypto";

import { auth, type StaveAccountClaim } from "../../../auth";
import { signInAvailable } from "../../../authProviders";
import { AUTHOR_KEY_HEADER, MAX_AUTHOR_NAME_CHARS, type GalleryAuthorProfile, type GalleryVerified } from "../../../gallery/types";
import { authorForKey, createKeylessAuthor, keyOwnsAuthor } from "./authors";
import { galleryPaths, galleryStore, getJson, putJson, type GalleryBlobStore, type PrivateAuthorRecord } from "./store";

/*
 * #2319 — signed-in accounts and the gallery author each one is linked to.
 *
 * Every gallery route that needs to know WHO is asking goes through this file.
 * Auth.js (src/auth.ts) keeps the session in a signed cookie; the session's
 * `account` claim names the provider and the provider's account id. This module
 * turns that into an author.
 *
 * ── Records (all private, in the gallery Blob store; see store.ts) ──────────
 *
 *   gallery/accounts/<accountHash>.json       GalleryAccountRecord
 *       accountHash = sha256("<provider>:<providerAccountId>"), hex.
 *       Holds authorId, the account's email, provider, and the public badge
 *       (GitHub login / avatar). The email lives here and in the author's
 *       private record; no response ever carries it.
 *   gallery/author-accounts/<authorId>.json   AuthorAccountPointer { accountHash }
 *       The reverse index: which account an author belongs to.
 *
 *   So an account record is readable both ways:
 *     by account → readAccount(store, accountHashOf(provider, id))
 *     by author  → accountForAuthor(store, authorId)
 *
 * ── API ─────────────────────────────────────────────────────────────────────
 *
 *   sessionClaim()                       → StaveAccountClaim | null
 *       The signed-in account from the cookie; null when signed out, or when
 *       sign-in isn't set up (auth() failing counts as signed out).
 *
 *   sessionAuthor(req, { create? })      → { authorId, account } | null
 *       The author linked to the session's account. With `create` (default
 *       true) the first call for an account makes a keyless author named after
 *       the account and links it — "first gallery use". With create:false it
 *       only looks (ownership checks use this, so checking never makes one).
 *       Refreshes the badge when the GitHub login or avatar changed.
 *
 *   requireSessionAuthor(req)            → { authorId, account } | Response
 *       sessionAuthor, or the Response to send instead: 503 (no store, or no
 *       sign-in set up here), 401 { error: "sign in to publish" }, 500.
 *
 *   mayManageAuthor(req, store, authorId)
 *       True when the session's author IS authorId, or the request carries
 *       that author's key (AUTHOR_KEY_HEADER) — the fallback for profiles
 *       made before sign-in.
 *
 *   accountHashOf(provider, providerAccountId) → string
 *   readAccount(store, accountHash)            → GalleryAccountRecord | null
 *   accountForAuthor(store, authorId)          → GalleryAccountRecord | null
 *
 *   attachAuthorToAccount(store, claim, email, authorId, { replace? })
 *       → { ok: true, account } | { ok: false, reason }
 *       Link author X to account Y: writes the account record and the reverse
 *       pointer, puts the badge on the public profile and the account email in
 *       the author's private record. Refuses ("author-taken") an author already
 *       linked to a DIFFERENT account. Refuses ("account-linked") an account
 *       already linked to a different author unless `replace: true` — that is
 *       the merge step #2320 needs (move the account onto the browser's older
 *       author); with replace the old author's reverse pointer is removed.
 *
 * #2320 (claim what this browser published before sign-in) builds on
 * attachAuthorToAccount + keyOwnsAuthor; #2321 (My shares from the account)
 * builds on sessionAuthor + accountForAuthor.
 *
 * Known gap: two first requests from one new account racing (e.g. the session
 * read and a publish at the same moment) can each make an author; the second
 * write of the account record wins and the other author is left with no
 * account. Blob has no compare-and-set, and the window is one round trip.
 */

/** A signed-in account and the author it is linked to. Never served. */
export interface GalleryAccountRecord {
  accountHash: string;
  /** Auth.js provider id ("github", "google", "test-login"). */
  provider: string;
  authorId: string;
  email: string;
  verified: GalleryVerified;
  createdAt: number;
  updatedAt: number;
}

/** `gallery/author-accounts/<authorId>.json`. Never served. */
export interface AuthorAccountPointer {
  accountHash: string;
}

export interface SessionAuthor {
  authorId: string;
  account: GalleryAccountRecord;
}

export function accountHashOf(provider: string, providerAccountId: string): string {
  return createHash("sha256").update(`${provider}:${providerAccountId}`, "utf8").digest("hex");
}

export function readAccount(store: GalleryBlobStore, accountHash: string): Promise<GalleryAccountRecord | null> {
  return getJson<GalleryAccountRecord>(store, galleryPaths.account(accountHash));
}

export async function accountForAuthor(store: GalleryBlobStore, authorId: string): Promise<GalleryAccountRecord | null> {
  const pointer = await getJson<AuthorAccountPointer>(store, galleryPaths.authorAccount(authorId));
  if (!pointer) return null;
  const account = await readAccount(store, pointer.accountHash);
  // The account record is the truth; a pointer it disagrees with is stale.
  return account && account.authorId === authorId ? account : null;
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

async function putBadge(store: GalleryBlobStore, authorId: string, verified: GalleryVerified): Promise<void> {
  const profile = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(authorId));
  if (profile && !sameVerified(profile.verified, verified)) {
    await putJson(store, galleryPaths.author(authorId), { ...profile, verified });
  }
}

export type AttachResult =
  | { ok: true; account: GalleryAccountRecord }
  | { ok: false; reason: "no-author" | "author-taken" | "account-linked" };

/** Link author `authorId` to the claim's account. See the header for the rules. */
export async function attachAuthorToAccount(
  store: GalleryBlobStore,
  claim: StaveAccountClaim,
  email: string,
  authorId: string,
  opts: { replace?: boolean } = {},
): Promise<AttachResult> {
  const accountHash = accountHashOf(claim.provider, claim.providerAccountId);
  const privateRecord = await getJson<PrivateAuthorRecord>(store, galleryPaths.authorPrivate(authorId));
  if (!privateRecord) return { ok: false, reason: "no-author" };

  const owner = await getJson<AuthorAccountPointer>(store, galleryPaths.authorAccount(authorId));
  if (owner && owner.accountHash !== accountHash) {
    const other = await readAccount(store, owner.accountHash);
    if (other && other.authorId === authorId) return { ok: false, reason: "author-taken" };
  }
  const existing = await readAccount(store, accountHash);
  if (existing && existing.authorId !== authorId && !opts.replace) return { ok: false, reason: "account-linked" };

  const now = Date.now();
  const verified = verifiedOf(claim);
  const account: GalleryAccountRecord = {
    accountHash,
    provider: claim.provider,
    authorId,
    email,
    verified,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Private sides first, the public badge last.
  await putJson(store, galleryPaths.authorPrivate(authorId), { ...privateRecord, authorEmail: email });
  await putJson(store, galleryPaths.authorAccount(authorId), { accountHash } satisfies AuthorAccountPointer);
  await putJson(store, galleryPaths.account(accountHash), account);
  if (existing && existing.authorId !== authorId) await store.del([galleryPaths.authorAccount(existing.authorId)]);
  await putBadge(store, authorId, verified);
  return { ok: true, account };
}

/** The name a new author starts with: the account's name, else its login, else a placeholder. */
function startingName(name: string, claim: StaveAccountClaim): string {
  const n = (name || claim.login || "").trim();
  return (n || "New artist").slice(0, MAX_AUTHOR_NAME_CHARS);
}

/**
 * The author linked to the session's account, made on first use unless
 * `create: false`. `req` is taken so callers never change if reading the
 * session moves onto the request; Auth.js reads it from the request scope today.
 */
export async function sessionAuthor(
  _req: Request,
  opts: { create?: boolean; store?: GalleryBlobStore | null } = {},
): Promise<SessionAuthor | null> {
  const store = opts.store === undefined ? galleryStore() : opts.store;
  if (!store) return null;
  const signedIn = await sessionClaim();
  if (!signedIn) return null;
  const { claim, email, name } = signedIn;

  const accountHash = accountHashOf(claim.provider, claim.providerAccountId);
  const account = await readAccount(store, accountHash);
  if (account) {
    const verified = verifiedOf(claim);
    if (sameVerified(account.verified, verified) && account.email === email) return { authorId: account.authorId, account };
    // The GitHub login, avatar or email changed since the last visit: follow it.
    const refreshed = await attachAuthorToAccount(store, claim, email, account.authorId);
    return refreshed.ok ? { authorId: account.authorId, account: refreshed.account } : { authorId: account.authorId, account };
  }
  if (opts.create === false) return null;

  const authorId = await createKeylessAuthor(store, startingName(name, claim), email, verifiedOf(claim));
  if (!authorId) return null;
  const linked = await attachAuthorToAccount(store, claim, email, authorId);
  return linked.ok ? { authorId, account: linked.account } : null;
}

/** sessionAuthor, or the Response to answer with. */
export async function requireSessionAuthor(req: Request): Promise<SessionAuthor | Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  if (!signInAvailable(process.env)) {
    return Response.json(
      { error: "sign-in isn't set up on this site, so publishing is turned off" },
      { status: 503 },
    );
  }
  if (!(await sessionClaim())) return Response.json({ error: "sign in to publish" }, { status: 401 });
  const found = await sessionAuthor(req, { store });
  if (!found) return Response.json({ error: "could not set up your gallery profile" }, { status: 500 });
  return found;
}

/** The session's author is `authorId`, or the request holds that author's key. */
export async function mayManageAuthor(req: Request, store: GalleryBlobStore, authorId: string): Promise<boolean> {
  const mine = await sessionAuthor(req, { create: false, store });
  if (mine?.authorId === authorId) return true;
  return keyOwnsAuthor(store, authorId, req.headers.get(AUTHOR_KEY_HEADER));
}

/** Whose request is this: the session's author, else the author the key names, else null. */
export async function actingAuthor(req: Request, store: GalleryBlobStore): Promise<string | null> {
  const mine = await sessionAuthor(req, { store });
  if (mine) return mine.authorId;
  return authorForKey(store, req.headers.get(AUTHOR_KEY_HEADER));
}
