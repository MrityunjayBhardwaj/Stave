import { SHARE_ID_PATTERN } from "../../../../shareCrypto";
import { shareStore } from "../store";

// #2248 — fetch one sealed shared project by its id. Never lists; a stored
// project never changes, so the answer can be cached for good.

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
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
