import { offeredProviders, signInAvailable } from "../../../../authProviders";
import type { GalleryAuthorProfile, GallerySessionResponse } from "../../../../gallery/types";
import { adminIdOf, isAdmin } from "../admin";
import { sessionAuthor, sessionClaim } from "../session";
import { galleryPaths, galleryStore, getJson } from "../store";

// #2319 — who the gallery thinks you are: what sign-in offers here, and, when
// signed in, your author (made on this first gallery use) with its badge.
//
// The client reads this instead of Auth.js's /api/auth/session because it
// answers three things in one request — whether sign-in exists here, which
// providers to offer, and which author is yours (for My profile and Edit) —
// and because it never sends the email back to the page.

const NO_STORE = { "Cache-Control": "no-store" };

async function myAdminId(): Promise<string | undefined> {
  const signedIn = await sessionClaim();
  return signedIn ? adminIdOf(signedIn.claim.provider, signedIn.claim.providerAccountId) : undefined;
}

export async function GET(req: Request): Promise<Response> {
  const available = signInAvailable(process.env);
  const body: GallerySessionResponse = {
    signInAvailable: available,
    providers: available ? offeredProviders(process.env) : [],
    user: null,
    isAdmin: false,
  };
  const store = galleryStore();
  if (available && store) {
    const mine = await sessionAuthor(req, { store });
    if (mine) {
      const profile = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(mine.authorId));
      body.user = { name: profile?.name ?? "", authorId: mine.authorId, verified: mine.account.verified };
      // #2331 — the id STAVE_GALLERY_ADMINS lists, so a person can find their own; and whether they are one.
      body.user.accountId = await myAdminId();
      body.isAdmin = await isAdmin(req);
    }
  }
  return Response.json(body, { headers: NO_STORE });
}
