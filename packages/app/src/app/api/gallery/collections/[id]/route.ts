import {
  GALLERY_ID_PATTERN,
  type CollectionPageResponse,
} from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { getAuthor } from "../../../../../db/repo/accounts";
import { deleteCollection, getCollection, updateCollection } from "../../../../../db/repo/collections";
import { adminAction } from "../../admin";
import { foreignEntry, servedCollection } from "../../authors";
import { limitAuthor } from "../../rateLimit";
import { mayManageAuthor } from "../../session";
import { galleryStore } from "../../store";
import { checkCollectionWrite, MAX_COLLECTION_BODY_BYTES, readJsonBody } from "../../validate";
import { assertSameOrigin } from "../../origin";
import { withDatabase } from "../../../../../db/errors";

// #2315 — one collection: open it, change it (its signed-in author, #2319, or
// the author key), or delete it (either of those, or an admin with a reason,
// #2331). Deleting a collection never touches its entries.
// Not cached at the CDN, for the same reason as the author page: edits and
// takedowns must show on the next open.
//
// #2352 — the collection and its ordered entries are in Postgres
// (`collections`, `collection_entries`). The stored ids are what the author
// saved; an entry taken down since is left out when the collection is read
// (servedCollection), and deleting the collection removes only its own rows.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const forbidden = () => Response.json({ error: "you can't change this collection" }, { status: 403 });
const NO_STORE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const db = await getDb();
  if (!db) return noStore();

  const stored = await getCollection(db, id);
  if (!stored) return notFound();
  const author = await getAuthor(db, stored.authorId);
  if (!author) return notFound();

  const { collection, entries } = await servedCollection(db, stored);
  const body: CollectionPageResponse = {
    collection,
    author: { authorId: author.authorId, name: author.name },
    entries,
  };
  return Response.json(body, { headers: NO_STORE });
}

async function handlePUT(req: Request, { params }: Ctx): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const db = await getDb();
  if (!db) return noStore();

  const stored = await getCollection(db, id);
  if (!stored) return notFound();
  if (!(await mayManageAuthor(req, stored.authorId))) return forbidden();
  const limited = await limitAuthor("edit", stored.authorId); // #2330
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_COLLECTION_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkCollectionWrite(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const foreign = await foreignEntry(db, stored.authorId, checked.value.entryIds);
  if (foreign) return Response.json({ error: foreign }, { status: 400 });

  const collection = await updateCollection(db, id, checked.value);
  if (!collection) return notFound(); // deleted since it was read
  return Response.json({ collection }, { headers: NO_STORE });
}

async function handleDELETE(req: Request, { params }: Ctx): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const db = await getDb();
  if (!db) return noStore();

  const stored = await getCollection(db, id);
  if (!stored) return notFound();
  if (!(await mayManageAuthor(req, stored.authorId))) {
    // The admin log is still written to the gallery store (admin.ts).
    const store = galleryStore();
    if (!store) return forbidden();
    const admin = await adminAction(req, store, { action: "take-down-collection", target: id }, forbidden);
    if (admin instanceof Response) return admin;
  } else {
    const limited = await limitAuthor("edit", stored.authorId); // #2330 — the owner's own edits only
    if (limited) return limited;
  }

  // Its rows in collection_entries go with it; the entries themselves are untouched.
  if (!(await deleteCollection(db, id))) return notFound();
  return new Response(null, { status: 204 });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const GET = withDatabase(handleGET);
export const PUT = withDatabase(handlePUT);
export const DELETE = withDatabase(handleDELETE);
