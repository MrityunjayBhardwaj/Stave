import { suspendedRefusal } from "../suspension";
import { newShareId } from "../../../../shareCrypto";
import { type GalleryCollection } from "../../../../gallery/types";
import { getDb } from "../../../../db/client";
import { insertCollection } from "../../../../db/repo/collections";
import { foreignEntry } from "../authors";
import { limitAuthor } from "../rateLimit";
import { actingAuthor } from "../session";
import { checkCollectionWrite, MAX_COLLECTION_BODY_BYTES, readJsonBody } from "../validate";
import { assertSameOrigin } from "../origin";
import { withDatabase } from "../../../../db/errors";

// #2315 — make a collection of your own entries. The session (#2319), or for an
// author from before sign-in the author key, says whose it is; there is no
// author id in the body to trust.
//
// #2352 — the collection and its ordered entries (`collection_entries`) are
// written in one transaction (db/repo/collections.ts insertCollection). Only
// the author's own live entries are accepted (foreignEntry).

async function handlePOST(req: Request): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const db = await getDb();
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const authorId = await actingAuthor(req);
  if (!authorId) return Response.json({ error: "sign in to make a collection" }, { status: 403 });
  const suspended = await suspendedRefusal(authorId); // #2400
  if (suspended) return suspended;
  const limited = await limitAuthor("edit", authorId); // #2330
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_COLLECTION_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkCollectionWrite(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const foreign = await foreignEntry(db, authorId, checked.value.entryIds);
  if (foreign) return Response.json({ error: foreign }, { status: 400 });

  // Ids are 64 random bits; a clash is a near-impossibility, but never overwrite one.
  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const collection: GalleryCollection = { id: newShareId(), authorId, ...checked.value, createdAt: now, updatedAt: now };
    if (await insertCollection(db, collection)) {
      return Response.json({ collection }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
  }
  return Response.json({ error: "could not store the collection" }, { status: 500 });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
