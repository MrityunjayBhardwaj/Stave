import { isSealedShape, MAX_SEALED_BYTES, newShareId } from "../../../shareCrypto";
import { SHARE_LINK_NAME_HEADER } from "../../../gallery/types";
import { getDb } from "../../../db/client";
import { hashToken, newManageToken } from "../gallery/auth";
import { accountLinkRecord, recordAccountLink } from "../gallery/accountLinks";
import { limitRequest } from "../gallery/rateLimit";
import { sessionAuthor, sessionClaim } from "../gallery/session";
import { requireTurnstile } from "../gallery/turnstile";
import { shareStore } from "./store";
import { assertSameOrigin } from "../gallery/origin";
import { withDatabase, withoutQueryValues } from "../../../db/errors";

// #2248 — store a sealed shared project and hand back its short id.
//
// The body is the browser's sealed bytes. All this route can check is the
// shape (version byte, length), so that is all it checks.
//
// The key never reaches here: it lives after the `#` in the link, which
// browsers never send. #2321 / #2329 — signed in, the browser also sends the
// project's name in a header, and the link is listed on the account as
// `{ id, projectName, createdAt }` (gallery/accountLinks.ts; #2352: the
// `account_links` table) so My shares can show it and revoke it from any
// device. The sealed bytes and the manage-token hash stay in the share store. Never the key or the full link: an
// older browser that still sends a key header is ignored, and nothing from it
// is stored. Link creation itself needs no account.
//
// #2250 — how often one visitor may upload is limited before this code runs, by a
// Vercel Firewall rate-limit rule on stave-code-app: POST on path /api/share,
// fixed window, 10 per 10 minutes, keyed by IP, answered 429. It lives in the
// project's Firewall settings, not in this repo; a deploy elsewhere needs its own.
// The client copies the long link on a 429 and says why.
//
// #2364 — signed out, a link also needs the "are you human" check when this site
// has one (requireTurnstile). A signed-in session skips it, so its links stay one
// click. sessionClaim answers null for a session it can't read, so that gets the
// check too: only a session actually read as signed in goes without.
//
// The limit runs first, as on publish and report. It is what stops a script making
// this server call Cloudflare without end (each check is a request that can take
// ten seconds), and it means a request that would be turned away anyway doesn't use
// up a token, which is good only once. The cost is that a request with no token
// counts toward its address's limit; the page never sends one when it knows it is
// signed out. Both run before the body is read.

async function handlePOST(req: Request): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const store = shareStore();
  if (!store) return Response.json({ error: "short links are not set up here" }, { status: 503 });
  const limited = await limitRequest("link", req); // #2330 — per account, or per address signed out
  if (limited) return limited;
  if (!(await sessionClaim())) {
    const unchecked = await requireTurnstile(req, "share-link"); // #2364
    if (unchecked) return unchecked;
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_SEALED_BYTES) {
    return Response.json({ error: "project too large for a short link" }, { status: 413 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_SEALED_BYTES) {
    return Response.json({ error: "project too large for a short link" }, { status: 413 });
  }
  if (!isSealedShape(bytes)) {
    return Response.json({ error: "not a sealed Stave project" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newShareId();
    if (await store.put(id, bytes)) {
      // #2311 — the token that lets whoever made this link revoke it. Shown once;
      // only its hash is kept, beside the share.
      const manageToken = newManageToken();
      await store.putManageHash(id, hashToken(manageToken));
      const onAccount = await recordOnAccount(req, id);
      return Response.json({ id, manageToken, onAccount }, { status: 201 });
    }
  }
  return Response.json({ error: "could not store the project" }, { status: 500 });
}

/**
 * #2321 — list the new link on the signed-in account (id, name, date only;
 * #2329). False when nobody is signed in or keeping it failed: the link itself
 * is made either way, and the browser still keeps its own copy. Any key header
 * is never read.
 */
async function recordOnAccount(req: Request, id: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    // The account's row first (account_links has a foreign key to it): a
    // signed-in person's first link can come before any other gallery use.
    const mine = await sessionAuthor(req);
    if (!mine) return false;
    let name = "";
    try {
      name = decodeURIComponent(req.headers.get(SHARE_LINK_NAME_HEADER) ?? "");
    } catch {
      /* a malformed name is just no name */
    }
    return await recordAccountLink(db, mine.account.accountHash, accountLinkRecord(id, name, Date.now()));
  } catch (err) {
    console.warn("[stave] couldn't keep the link on the account:", withoutQueryValues(err));
    return false;
  }
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
