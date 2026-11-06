import { getDb } from "../../../db/client";
import { suspensionOfAccount, suspensionOfAuthor, type SuspensionRecord } from "../../../db/repo/suspensions";
import { accountHashOf, sessionClaim } from "./session";

/*
 * #2400 — what a suspended account may not do: publish, edit its profile or
 * collections, bring old shares into the account, or report. It can still browse,
 * play, make private links, and delete its own work (keeping nothing after a delete
 * is a promise on the privacy page, and a suspension doesn't change it).
 * gallerySuspension.test.ts scans every write route, so a new one has to choose.
 */

function refusal(s: SuspensionRecord): Response {
  const when = s.until === null ? "" : ` until ${new Date(s.until).toUTCString().slice(5, 16)}`;
  return Response.json(
    {
      error: `This account is suspended from publishing, editing and reporting${when}.`,
      suspendedUntil: s.until,
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The 403 to answer with when the signed-in account is suspended, else null. Pass
 * `authorId` where a request can also act for an author by key, without a session.
 */
export async function suspendedRefusal(authorId?: string): Promise<Response | null> {
  const db = await getDb();
  if (!db) return null;
  const signedIn = await sessionClaim();
  if (signedIn) {
    const { provider, providerAccountId } = signedIn.claim;
    const mine = await suspensionOfAccount(db, accountHashOf(provider, providerAccountId));
    if (mine) return refusal(mine);
  }
  const theirs = authorId ? await suspensionOfAuthor(db, authorId) : null;
  return theirs ? refusal(theirs) : null;
}
