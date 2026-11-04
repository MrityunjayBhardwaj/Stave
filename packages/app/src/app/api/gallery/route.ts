import { newShareId } from "../../../shareCrypto";
import {
  type GalleryAuthorProfile,
  type GalleryEntry,
  type GalleryListResponse,
  type PublishResponse,
} from "../../../gallery/types";
import { hashToken, newManageToken } from "./auth";
import { limitAccount } from "./rateLimit";
import { requireSessionAuthor } from "./session";
import { requireTurnstile } from "./turnstile";
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

// #2330 — how often one account may publish is limited here (rateLimit.ts,
// RATE_LIMITS.publish), and a Turnstile check runs when it is set up
// (turnstile.ts). The outer layer is a per-address Vercel Firewall rule for
// POST /api/gallery; it lives in the project's Firewall settings, not in this
// repo (the docs page "Signing in to the gallery" lists the rules). The publish
// dialog shows the server's message on a 429.

export async function POST(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return noStore();

  // #2319 — publishing needs a signed-in account; the entry lands on the
  // account's author. Checked before the body is read, so a signed-out client
  // is told to sign in rather than about its form.
  const who = await requireSessionAuthor(req);
  if (who instanceof Response) return who;
  const { authorId, account } = who;
  // #2330 — per-account limit, then the Turnstile check (when set up).
  const limited = (await limitAccount("publish", account.accountHash)) ?? (await requireTurnstile(req));
  if (limited) return limited;

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

  // The name shown is the profile's (changed on the profile, not here); the
  // email kept is the account's. Whatever name or email the body carried is ignored.
  const profile = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(authorId));
  if (!profile) return Response.json({ error: "could not find your gallery profile" }, { status: 500 });

  const manageToken = newManageToken();
  const record: PrivateRecord = { authorEmail: account.email, manageTokenHash: hashToken(manageToken) };
  const entry: GalleryEntry = {
    id,
    title: v.title,
    kind: v.kind,
    tags: v.tags,
    authorName: profile.name,
    authorId,
    publishedAt: Date.now(),
    fileCount: v.manifest.files.length,
    hasThumbnail: v.thumbnail !== null,
  };

  await putJson(store, galleryPaths.privateRecord(id), record);
  await store.put(galleryPaths.manifest(id), v.manifestBytes, "application/json");
  if (v.thumbnail) await store.put(galleryPaths.thumbnail(id), v.thumbnail.bytes, v.thumbnail.contentType);
  // The author index may point at an entry that isn't there yet; readers skip it.
  await putJson(store, galleryPaths.authorEntry(authorId, id), {});
  // Last: once the public listing exists, everything it points at already does.
  await putJson(store, galleryPaths.entry(id), entry);

  const res: PublishResponse = { id, manageToken, authorId };
  return Response.json(res, { status: 201, headers: { "Cache-Control": "no-store" } });
}
