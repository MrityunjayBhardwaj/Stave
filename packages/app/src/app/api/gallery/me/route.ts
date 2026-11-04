import { offeredProviders, signInAvailable } from "../../../../authProviders";
import type { GalleryAuthorProfile, GallerySessionResponse } from "../../../../gallery/types";
import { sessionAuthor } from "../session";
import { galleryPaths, galleryStore, getJson } from "../store";

// #2319 — who the gallery thinks you are: what sign-in offers here, and, when
// signed in, your author (made on this first gallery use) with its badge.
//
// The client reads this instead of Auth.js's /api/auth/session because it
// answers three things in one request — whether sign-in exists here, which
// providers to offer, and which author is yours (for My profile and Edit) —
// and because it never sends the email back to the page.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const available = signInAvailable(process.env);
  const body: GallerySessionResponse = {
    signInAvailable: available,
    providers: available ? offeredProviders(process.env) : [],
    user: null,
  };
  const store = galleryStore();
  if (available && store) {
    const mine = await sessionAuthor(req, { store });
    if (mine) {
      const profile = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(mine.authorId));
      body.user = { name: profile?.name ?? "", authorId: mine.authorId, verified: mine.account.verified };
    }
  }
  return Response.json(body, { headers: NO_STORE });
}
