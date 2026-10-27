import { isSealedShape, MAX_SEALED_BYTES, newShareId } from "../../../shareCrypto";
import { shareStore } from "./store";

// #2248 — store a sealed shared project and hand back its short id.
//
// The body is the browser's sealed bytes; the key never reaches here. All this
// route can check is the shape (version byte, length), so that is all it checks.

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
    if (await store.put(id, bytes)) return Response.json({ id }, { status: 201 });
  }
  return Response.json({ error: "could not store the project" }, { status: 500 });
}
