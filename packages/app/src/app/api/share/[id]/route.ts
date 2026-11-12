import { SHARE_ID_PATTERN } from "../../../../shareCrypto";
import { MANAGE_TOKEN_HEADER } from "../../../../gallery/types";
import { tokenMatches } from "../../gallery/auth";
import { getDb, type Db } from "../../../../db/client";
import { forgetAccountLink, hasAccountLink } from "../../gallery/accountLinks";
import { accountHashOf, sessionClaim } from "../../gallery/session";
import { shareStore } from "../store";
import { assertSameOrigin } from "../../gallery/origin";
import { withDatabase } from "../../../../db/errors";

// #2248 — fetch one sealed shared project by its id. Never lists.
//
// #2311 — a share can now be revoked, so its answer must not outlive it: no
// shared or browser cache. (Links still carry their key; a cached copy of the
// sealed bytes plus the key would keep opening after a revoke.)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!SHARE_ID_PATTERN.test(id)) return new Response("not found", { status: 404 });
  const store = shareStore();
  if (!store) return new Response("short links are not set up here", { status: 503 });
  const bytes = await store.get(id);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * #2311 — revoke a short link. Needs the manage token handed back when the link
 * was made, or (#2321) the signed-in session of the account the link is
 * recorded on. Links made before #2311 have no token on record: 403, they
 * can't be revoked. An unknown id is 404; the client treats that as already gone.
 */
async function handleDELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!SHARE_ID_PATTERN.test(id)) return new Response("not found", { status: 404 });
  const store = shareStore();
  if (!store) return new Response("short links are not set up here", { status: 503 });

  // #2321 — the signed-in account the link is recorded on may revoke it with
  // no token. Looked up only when a token doesn't already settle it.
  const token = req.headers.get(MANAGE_TOKEN_HEADER);
  const hash = await store.getManageHash(id);
  const byToken = hash !== null && tokenMatches(token, hash);
  const account = await linkAccount(id);
  const byAccount = !byToken && account !== null && (await hasAccountLink(account.db, account.hash, id));

  if (!byToken && !byAccount) {
    if (!hash) {
      const exists = (await store.get(id)) !== null;
      return exists
        ? Response.json({ error: "this link was made before links could be revoked" }, { status: 403 })
        : new Response("not found", { status: 404 });
    }
    return Response.json({ error: "that key doesn't match this link" }, { status: 403 });
  }
  // The share first (the link is dead once it's gone), then the account's record of it.
  await store.remove(id);
  if (account) await forgetAccountLink(account.db, account.hash, id);
  return new Response(null, { status: 204 });
}

/**
 * The signed-in account's hash and the gallery database, or null when signed
 * out or there is no database here. Only the account's hash is needed: an
 * account with no row yet has no links to find, so nothing is made here.
 */
async function linkAccount(id: string): Promise<{ db: Db; hash: string } | null> {
  if (!SHARE_ID_PATTERN.test(id)) return null;
  const signedIn = await sessionClaim();
  if (!signedIn) return null;
  const db = await getDb();
  if (!db) return null;
  return { db, hash: accountHashOf(signedIn.claim.provider, signedIn.claim.providerAccountId) };
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const DELETE = withDatabase(handleDELETE);
