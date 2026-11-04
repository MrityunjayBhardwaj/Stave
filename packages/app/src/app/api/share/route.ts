import { isSealedShape, MAX_SEALED_BYTES, newShareId } from "../../../shareCrypto";
import { SHARE_LINK_KEY_HEADER, SHARE_LINK_NAME_HEADER } from "../../../gallery/types";
import { hashToken, newManageToken } from "../gallery/auth";
import { cleanProjectName, isShareKey, recordAccountLink, shareUrl } from "../gallery/accountLinks";
import { accountHashOf, sessionClaim } from "../gallery/session";
import { galleryStore } from "../gallery/store";
import { shareStore } from "./store";

// #2248 — store a sealed shared project and hand back its short id.
//
// The body is the browser's sealed bytes. All this route can check is the
// shape (version byte, length), so that is all it checks.
//
// Signed out, the key never reaches here. #2321 — signed in, the browser also
// sends the key and the project's name in headers, and the whole link is kept
// on the account (gallery/accountLinks.ts) so My shares can copy it again from
// any device. That is the one place the server keeps a private link's key, and
// only the account reads it back. A key header from a signed-out request is
// ignored, never stored. Link creation itself needs no account.
//
// #2250 — how often one visitor may upload is limited before this code runs, by a
// Vercel Firewall rate-limit rule on stave-code-app: POST on path /api/share,
// fixed window, 10 per 10 minutes, keyed by IP, answered 429. It lives in the
// project's Firewall settings, not in this repo; a deploy elsewhere needs its own.
// The client copies the long link on a 429 and says why.

export async function POST(req: Request): Promise<Response> {
  const store = shareStore();
  if (!store) return Response.json({ error: "short links are not set up here" }, { status: 503 });

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
 * #2321 — keep the new link on the signed-in account. False when the browser
 * didn't ask (no key header), nobody is signed in, or keeping it failed: the
 * link itself is made either way, and the browser still keeps its own copy.
 */
async function recordOnAccount(req: Request, id: string): Promise<boolean> {
  const key = req.headers.get(SHARE_LINK_KEY_HEADER);
  if (!isShareKey(key)) return false;
  try {
    const gallery = galleryStore();
    if (!gallery) return false;
    const signedIn = await sessionClaim();
    if (!signedIn) return false;
    let name = "";
    try {
      name = decodeURIComponent(req.headers.get(SHARE_LINK_NAME_HEADER) ?? "");
    } catch {
      /* a malformed name is just no name */
    }
    const accountHash = accountHashOf(signedIn.claim.provider, signedIn.claim.providerAccountId);
    await recordAccountLink(gallery, accountHash, {
      id,
      url: shareUrl(new URL(req.url).origin, id, key),
      projectName: cleanProjectName(name),
      createdAt: Date.now(),
    });
    return true;
  } catch (err) {
    console.warn("[stave] couldn't keep the link on the account:", err);
    return false;
  }
}
