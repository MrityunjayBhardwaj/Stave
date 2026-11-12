import {
  GALLERY_ID_PATTERN,
  MANAGE_TOKEN_HEADER,
  type GalleryEntryResponse,
  type GalleryManifest,
} from "../../../../gallery/types";
import { getDb } from "../../../../db/client";
import { withDatabase } from "../../../../db/errors";
import { deleteEntryIn, getEntryRecord, removeEntryIn } from "../../../../db/repo/entries";
import { inTransaction } from "../../../../db/repo/tx";
import { adminReason, logAdminAction } from "../admin";
import { tokenMatches } from "../auth";
import { deleteEntryFiles } from "../entryFiles";
import { sessionAuthor } from "../session";
import { galleryPaths, galleryStore, getJson } from "../store";
import { assertSameOrigin } from "../origin";

// #2299 / #2303 — one gallery entry: open it, or take it down.
// #2352 — the record (and whether it was removed) is in Postgres; the manifest
// and thumbnail are in Blob, keyed by the id.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });

type Ctx = { params: Promise<{ id: string }> };

// Not cached at the CDN: a takedown must answer 410 at once, and opening an
// entry is one request per click, not per overlay open.
async function handleGET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  const db = store && (await getDb());
  if (!store || !db) return noStore();

  const record = await getEntryRecord(db, id);
  if (!record) return notFound();
  if (record.removed) return Response.json({ error: "this entry was removed" }, { status: 410 });
  const manifest = await getJson<GalleryManifest>(store, galleryPaths.manifest(id));
  if (!manifest) return notFound();

  const body: GalleryEntryResponse = { entry: record.entry, manifest };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDatabase(handleGET);

// The author deletes while signed in (#2319) or with their manage token; an
// admin (#2331: a signed-in account in STAVE_GALLERY_ADMINS) with a reason in
// the JSON body. The author's own route wins, so an admin deleting their own
// entry needs no reason.
//
// An author's delete keeps nothing (#2403): the row, its collection memberships,
// its reports and its files all go, in one transaction, so a failed file delete
// rolls the row back and the author can try again.
//
// An admin take-down only hides the entry (410 and out of the listing at once, its
// open reports closed). Its files, email and token hash stay for TAKEDOWN_KEEP_MS,
// so it can be restored (#2401); the clean-up deletes them after that. It writes
// its log record in the same transaction as the removal (#2352).
async function handleDELETE(req: Request, { params }: Ctx): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  const db = store && (await getDb());
  if (!store || !db) return noStore();

  const record = await getEntryRecord(db, id);
  if (!record || record.removed) return notFound();
  const { entry } = record;

  // #2319 — the signed-in author of the entry may delete it with no token.
  const mine = entry.authorId ? await sessionAuthor(req, { create: false }) : null;

  if (
    (mine && mine.authorId === entry.authorId) ||
    tokenMatches(req.headers.get(MANAGE_TOKEN_HEADER), record.manageTokenHash ?? "")
  ) {
    const deleted = await inTransaction(db, async (tx) => {
      const done = await deleteEntryIn(tx, id);
      if (done) await deleteEntryFiles(store, id);
      return done;
    });
    return deleted ? new Response(null, { status: 204 }) : notFound();
  }

  const gate = await adminReason(req, () =>
    Response.json({ error: "that token does not manage this entry" }, { status: 403 }),
  );
  if (gate instanceof Response) return gate;
  const at = Date.now();
  const removed = await inTransaction(db, async (tx) => {
    const done = await removeEntryIn(tx, id, at);
    // Removed by someone else meanwhile: nothing was taken down, nothing is logged.
    if (done) await logAdminAction(tx, gate.admin, { action: "take-down-entry", target: id }, gate.reason, at);
    return done;
  });
  return removed ? new Response(null, { status: 204 }) : notFound();
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const DELETE = withDatabase(handleDELETE);
