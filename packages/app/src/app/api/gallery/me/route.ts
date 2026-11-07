import { offeredProviders, signInAvailable } from "../../../../authProviders";
import type { GallerySessionResponse } from "../../../../gallery/types";
import { getDb } from "../../../../db/client";
import { getAuthor } from "../../../../db/repo/accounts";
import { adminIdOf, isAdmin } from "../admin";
import { renewSessionCookie, sessionAuthor, sessionClaim } from "../session";
import { withDatabase } from "../../../../db/errors";

// #2319 — who the gallery thinks you are: what sign-in offers here, and, when
// signed in, your author (made on this first gallery use) with its badge.
//
// The client reads this instead of Auth.js's /api/auth/session because it
// answers three things in one request — whether sign-in exists here, which
// providers to offer, and which author is yours (for My profile and Edit) —
// and because it never sends the email back to the page.
//
// #2367 — every page load reads this route, so it's also where an active session
// is renewed (session.ts renewSessionCookie). NO_STORE matters doubly then: an
// answer carrying a Set-Cookie must never be cached.

const NO_STORE = { "Cache-Control": "no-store" };

async function myAdminId(): Promise<string | undefined> {
  const signedIn = await sessionClaim();
  return signedIn ? adminIdOf(signedIn.claim.provider, signedIn.claim.providerAccountId) : undefined;
}

async function handleGET(req: Request): Promise<Response> {
  const available = signInAvailable(process.env);
  const body: GallerySessionResponse = {
    signInAvailable: available,
    providers: available ? offeredProviders(process.env) : [],
    user: null,
    isAdmin: false,
  };
  const db = available ? await getDb() : null;
  if (db) {
    const mine = await sessionAuthor(req);
    if (mine) {
      const profile = await getAuthor(db, mine.authorId);
      body.user = { name: profile?.name ?? "", authorId: mine.authorId, verified: mine.account.verified };
      // #2331 — the id STAVE_GALLERY_ADMINS lists, so a person can find their own; and whether they are one.
      body.user.accountId = await myAdminId();
      body.isAdmin = await isAdmin(req);
    }
  }
  const res = Response.json(body, { headers: NO_STORE });
  if (body.user) await renewSessionCookie(req, res);
  return res;
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const GET = withDatabase(handleGET);
