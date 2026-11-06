import { newShareId } from "../../../shareCrypto";
import { type GalleryEntry, type GalleryListResponse, type PublishResponse } from "../../../gallery/types";
import { getDb } from "../../../db/client";
import { withDatabase } from "../../../db/errors";
import { getAuthor } from "../../../db/repo/accounts";
import { getEntryRecord, insertEntry, listEntries } from "../../../db/repo/entries";
import { inTransaction } from "../../../db/repo/tx";
import { hashToken, newManageToken } from "./auth";
import { putEntryFiles } from "./entryFiles";
import { limitAccount } from "./rateLimit";
import { requireSessionAuthor } from "./session";
import { suspendedRefusal } from "./suspension";
import { requireTurnstile } from "./turnstile";
import { galleryStore } from "./store";
import { checkPublish, MAX_PUBLISH_BODY_BYTES, readJsonBody } from "./validate";
import { assertSameOrigin } from "./origin";

// #2299 — the community gallery: list what has been published, and publish.
// #2352 — the records are in Postgres (db/repo/entries.ts); the manifest and
// thumbnail stay in Blob, keyed by the entry id (entryFiles.ts).

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });

// The listing is cached at the CDN for 30 s, then served stale for up to 5 min
// while one request refreshes it. So the listing query runs at most about twice
// a minute, however many people open the overlay. The price: a new publish can
// take up to ~30 s to show in the list, and a deleted entry can linger in it as
// long. The entry route is not cached that way: an entry an admin removed answers
// 410 and one its author deleted answers 404, straight away, so a lingering card
// opens to "removed" or "not found".
export const LIST_CACHE = "public, s-maxage=30, stale-while-revalidate=300";

// #2346 — ONE listing per cache window, whatever the query string. The CDN
// keys its cache on the whole URL, query included, and offers no response
// header that makes it ignore the query. So a request carrying ANY query string
// is answered with a permanent redirect to the bare path, before the database
// is touched: `?x=<random>` costs one tiny function call and no query, and every
// real listing comes from the one cached URL, /api/gallery. The redirect is
// cacheable as well, so a repeated stray URL doesn't reach the function at all.
// The listing takes no parameters, and the client asks for the bare path.
export const LIST_REDIRECT_CACHE = "public, max-age=3600, s-maxage=86400";

async function handleGET(req?: Request): Promise<Response> {
  if (req) {
    const url = new URL(req.url);
    if (url.search !== "") {
      return new Response(null, {
        status: 308,
        headers: { Location: url.pathname, "Cache-Control": LIST_REDIRECT_CACHE },
      });
    }
  }
  const store = galleryStore();
  const db = store && (await getDb());
  if (!store || !db) return noStore();
  // One indexed query: live entries only, newest first, at most MAX_LISTED_ENTRIES.
  const body: GalleryListResponse = { entries: await listEntries(db) };
  return Response.json(body, { headers: { "Cache-Control": LIST_CACHE } });
}
// An outage answers 503 (no-store), so the CDN never caches an error as the listing.
export const GET = withDatabase(handleGET);

// #2330 — how often one account may publish is limited here (rateLimit.ts,
// RATE_LIMITS.publish), and a Turnstile check runs when it is set up
// (turnstile.ts). The outer layer is a per-address Vercel Firewall rule for
// POST /api/gallery; it lives in the project's Firewall settings, not in this
// repo (the docs page "Signing in to the gallery" lists the rules). The publish
// dialog shows the server's message on a 429.

async function handlePOST(req: Request): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const store = galleryStore();
  if (!store) return noStore();

  // #2319 — publishing needs a signed-in account; the entry lands on the
  // account's author. Checked before the body is read, so a signed-out client
  // is told to sign in rather than about its form.
  const who = await requireSessionAuthor(req);
  if (who instanceof Response) return who;
  const { authorId, account } = who;
  // #2330 — per-account limit, then the Turnstile check (when set up).
  const suspended = await suspendedRefusal();
  if (suspended) return suspended;
  const limited = (await limitAccount("publish", account.accountHash)) ?? (await requireTurnstile(req, "publish"));
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_PUBLISH_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkPublish(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const v = checked.value;

  const db = await getDb();
  if (!db) return noStore();

  // Ids are 64 random bits; a clash is a near-impossibility, but never reuse a
  // live or taken-down one (those keep their row). An id whose author deleted the
  // entry leaves no row (#2403), which 64 random bits make safe enough.
  let id: string | null = null;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const candidate = newShareId();
    if (!(await getEntryRecord(db, candidate))) id = candidate;
  }
  if (!id) return Response.json({ error: "could not store the entry" }, { status: 500 });

  // The name shown is the profile's (changed on the profile, not here); the
  // email kept is the account's. Whatever name or email the body carried is ignored.
  const profile = await getAuthor(db, authorId);
  if (!profile) return Response.json({ error: "could not find your gallery profile" }, { status: 500 });

  const manageToken = newManageToken();
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

  // The files first, then the row: once the entry can be listed, its manifest
  // (and thumbnail) already exist. A failure before the insert leaves only
  // unlisted files behind, never a listed entry without them.
  await putEntryFiles(store, id, v.manifestBytes, v.thumbnail);
  const stored = await inTransaction(db, (tx) => insertEntry(tx, { entry, authorEmail: account.email, manageTokenHash: hashToken(manageToken) }));
  if (!stored) return Response.json({ error: "could not store the entry" }, { status: 500 });

  const res: PublishResponse = { id, manageToken, authorId };
  return Response.json(res, { status: 201, headers: { "Cache-Control": "no-store" } });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
