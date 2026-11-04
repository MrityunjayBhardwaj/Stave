import { SHARE_ID_PATTERN } from "../../../../shareCrypto";
import { MANAGE_TOKEN_HEADER } from "../../../../gallery/types";
import { tokenMatches } from "../../gallery/auth";
import { shareStore } from "../store";

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
 * was made. Links made before #2311 have no token on record: 403, they can't be
 * revoked. An unknown id is 404; the client treats that as already gone.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!SHARE_ID_PATTERN.test(id)) return new Response("not found", { status: 404 });
  const store = shareStore();
  if (!store) return new Response("short links are not set up here", { status: 503 });
  const hash = await store.getManageHash(id);
  if (!hash) {
    const exists = (await store.get(id)) !== null;
    return exists
      ? Response.json({ error: "this link was made before links could be revoked" }, { status: 403 })
      : new Response("not found", { status: 404 });
  }
  if (!tokenMatches(req.headers.get(MANAGE_TOKEN_HEADER), hash)) {
    return Response.json({ error: "that key doesn't match this link" }, { status: 403 });
  }
  await store.remove(id);
  return new Response(null, { status: 204 });
}
