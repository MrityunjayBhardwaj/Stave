import { newShareId } from "../../../shareCrypto";
import type { GalleryEntry, GalleryListResponse, PublishResponse } from "../../../gallery/types";
import { hashToken, newManageToken } from "./auth";
import { galleryPaths, galleryStore, getJson, putJson, type PrivateRecord } from "./store";
import { checkPublish, MAX_PUBLISH_BODY_BYTES, readJsonBody } from "./validate";

// #2299 — the community gallery: list what has been published, and publish.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });

/** The most entries one listing reads, newest first. Each costs one Blob read on a cache miss. */
const MAX_LISTED_ENTRIES = 500;

// The listing is cached at the CDN for 30 s, then served stale for up to 5 min
// while one request refreshes it. So opening the overlay costs Blob reads at
// most about twice a minute, however many people open it. The price: a new
// publish can take up to ~30 s to show in the list, and a deleted entry can
// linger in it as long. The entry route is not cached that way — a removed
// entry answers 410 straight away, so a lingering card opens to "removed".
// A client that must see its own publish at once can add any query string
// (`?fresh=<time>`), which the CDN keys separately.
const LIST_CACHE = "public, s-maxage=30, stale-while-revalidate=300";

export async function GET(): Promise<Response> {
  const store = galleryStore();
  if (!store) return noStore();

  const [listed, removed] = await Promise.all([
    store.list(galleryPaths.entriesPrefix),
    store.list(galleryPaths.removedPrefix),
  ]);
  // An entry whose removed marker exists is gone, even if deleting its listing failed.
  const removedIds = new Set(
    removed.map((b) => b.pathname.slice(galleryPaths.removedPrefix.length).replace(/\.json$/, "")),
  );
  const newest = listed
    .filter((b) => b.pathname.endsWith(".json"))
    .filter((b) => !removedIds.has(b.pathname.slice(galleryPaths.entriesPrefix.length, -".json".length)))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .slice(0, MAX_LISTED_ENTRIES);

  const entries = (
    await Promise.all(newest.map((b) => getJson<GalleryEntry>(store, b.pathname).catch(() => null)))
  ).filter((e): e is GalleryEntry => e !== null);
  entries.sort((a, b) => b.publishedAt - a.publishedAt);

  const body: GalleryListResponse = { entries };
  return Response.json(body, { headers: { "Cache-Control": LIST_CACHE } });
}

// How often one visitor may publish is limited before this code runs, the way
// #2250 limits short links — by a Vercel Firewall rate-limit rule on
// stave-code-app. The existing rule matches POST /api/share ONLY; publishing
// needs its own rule for POST on path /api/gallery (fixed window, keyed by IP,
// answered 429), added in the project's Firewall settings. It is not in this
// repo; a deploy elsewhere needs its own. The publish dialog says why on a 429.

export async function POST(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return noStore();

  const body = await readJsonBody(req, MAX_PUBLISH_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkPublish(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const v = checked.value;

  // Ids are 64 random bits; a clash is a near-impossibility, but never overwrite one.
  let id: string | null = null;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const candidate = newShareId();
    if (!(await store.get(galleryPaths.privateRecord(candidate)))) id = candidate;
  }
  if (!id) return Response.json({ error: "could not store the entry" }, { status: 500 });

  const manageToken = newManageToken();
  const record: PrivateRecord = { authorEmail: v.authorEmail, manageTokenHash: hashToken(manageToken) };
  const entry: GalleryEntry = {
    id,
    title: v.title,
    kind: v.kind,
    tags: v.tags,
    authorName: v.authorName,
    publishedAt: Date.now(),
    fileCount: v.manifest.files.length,
    hasThumbnail: v.thumbnail !== null,
  };

  await putJson(store, galleryPaths.privateRecord(id), record);
  await store.put(galleryPaths.manifest(id), v.manifestBytes, "application/json");
  if (v.thumbnail) await store.put(galleryPaths.thumbnail(id), v.thumbnail.bytes, v.thumbnail.contentType);
  // Last: once the public listing exists, everything it points at already does.
  await putJson(store, galleryPaths.entry(id), entry);

  const res: PublishResponse = { id, manageToken };
  return Response.json(res, { status: 201, headers: { "Cache-Control": "no-store" } });
}
