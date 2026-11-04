import {
  ADMIN_KEY_HEADER,
  GALLERY_ID_PATTERN,
  MANAGE_TOKEN_HEADER,
  type GalleryEntry,
  type GalleryEntryResponse,
  type GalleryManifest,
} from "../../../../gallery/types";
import { isAdminKey, tokenMatches } from "../auth";
import { sessionAuthor } from "../session";
import {
  galleryPaths,
  galleryStore,
  getJson,
  putJson,
  type PrivateRecord,
  type RemovedMarker,
} from "../store";

// #2299 / #2303 — one gallery entry: open it, or take it down.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });

type Ctx = { params: Promise<{ id: string }> };

// Not cached at the CDN: a takedown must answer 410 at once, and opening an
// entry is one request per click, not per overlay open.
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const [removed, entry, manifest] = await Promise.all([
    getJson<RemovedMarker>(store, galleryPaths.removed(id)),
    getJson<GalleryEntry>(store, galleryPaths.entry(id)),
    getJson<GalleryManifest>(store, galleryPaths.manifest(id)),
  ]);
  if (removed) return Response.json({ error: "this entry was removed" }, { status: 410 });
  if (!entry || !manifest) return notFound();

  const body: GalleryEntryResponse = { entry, manifest };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

// The author deletes while signed in (#2319) or with their manage token; the
// maintainer with the admin key (#2303). Either way the removed marker goes down first, so even a delete that
// fails halfway reads as removed (410, gone from the list), then everything else
// about the entry is deleted — the private record with the email included.
export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  if (await store.get(galleryPaths.removed(id))) return notFound();
  const record = await getJson<PrivateRecord>(store, galleryPaths.privateRecord(id));
  if (!record) return notFound();

  const listed = await getJson<GalleryEntry>(store, galleryPaths.entry(id)).catch(() => null);
  // #2319 — the signed-in author of the entry may delete it with no token.
  const mine = listed?.authorId ? await sessionAuthor(req, { create: false, store }) : null;

  let by: RemovedMarker["by"];
  if (isAdminKey(req.headers.get(ADMIN_KEY_HEADER))) by = "admin";
  else if (mine && mine.authorId === listed?.authorId) by = "author";
  else if (tokenMatches(req.headers.get(MANAGE_TOKEN_HEADER), record.manageTokenHash)) by = "author";
  else return Response.json({ error: "that token does not manage this entry" }, { status: 403 });

  const marker: RemovedMarker = { removedAt: Date.now(), by };
  await putJson(store, galleryPaths.removed(id), marker);
  // #2314 / #2315 — the entry leaves its author's page and every collection
  // because those reads re-check each entry (authors.ts liveEntry). Dropping the
  // author-index marker here is tidying, not the guarantee.
  const reports = await store.list(galleryPaths.reportsOf(id));
  await store.del([
    ...(listed?.authorId ? [galleryPaths.authorEntry(listed.authorId, id)] : []),
    galleryPaths.entry(id),
    galleryPaths.manifest(id),
    galleryPaths.thumbnail(id),
    galleryPaths.privateRecord(id),
    ...reports.map((r) => r.pathname),
  ]);
  return new Response(null, { status: 204 });
}
