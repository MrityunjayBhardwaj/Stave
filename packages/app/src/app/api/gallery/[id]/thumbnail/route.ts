import { GALLERY_ID_PATTERN } from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { isDatabaseUnavailable } from "../../../../../db/errors";
import { getEntryRecord } from "../../../../../db/repo/entries";
import { galleryPaths, galleryStore } from "../../store";
import { sniffImage } from "../../validate";

// #2299 — an entry's thumbnail. Served with the type the bytes themselves say
// (checked again here, not trusted from storage) and nosniff, so the browser
// never treats it as anything but an image. Cached for 5 minutes only, so a
// taken-down entry's picture doesn't outlive it by long.
// #2352 — whether the entry exists and is live comes from Postgres; the bytes from Blob.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return new Response("not found", { status: 404 });
  const store = galleryStore();
  if (!store) return new Response("the gallery is not set up here", { status: 503 });

  let live: boolean;
  try {
    const db = await getDb();
    if (!db) return new Response("the gallery is not set up here", { status: 503 });
    const record = await getEntryRecord(db, id);
    live = record !== null && record.removed === null;
  } catch (err) {
    // #2351 — an image answers in plain text, not the JSON 503 the other routes send.
    if (!isDatabaseUnavailable(err)) throw err;
    return new Response("the gallery is having trouble right now", {
      status: 503,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }
  if (!live) return new Response("not found", { status: 404 });
  const bytes = await store.get(galleryPaths.thumbnail(id));
  const type = bytes && sniffImage(bytes);
  if (!bytes || !type) return new Response("not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
