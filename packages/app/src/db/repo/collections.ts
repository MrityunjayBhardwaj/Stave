import { asc, desc, eq, inArray } from "drizzle-orm";

import type { GalleryCollection } from "../../gallery/types";
import type { Db } from "../client";
import { collectionEntries, collections } from "../schema";
import { inTransaction, type Q } from "./tx";

/*
 * #2315 — collections: one author's entries, in an order the author chose.
 *
 * Stored entry ids are what the author saved; whether each is still live is the
 * reader's question (authors.ts servedCollection drops gone ones), exactly as
 * with the Blob records. A collection's rows in `collection_entries` are
 * replaced as a whole on every write, in the same transaction as the collection.
 */

type CollectionRow = typeof collections.$inferSelect;

const toCollection = (r: CollectionRow, entryIds: string[]): GalleryCollection => ({
  id: r.id,
  authorId: r.authorId,
  title: r.title,
  description: r.description,
  entryIds,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function entryIdsOf(db: Q, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(collectionEntries)
    .where(inArray(collectionEntries.collectionId, ids))
    .orderBy(asc(collectionEntries.collectionId), asc(collectionEntries.position));
  for (const r of rows) out.get(r.collectionId)?.push(r.entryId);
  return out;
}

async function writeEntryIds(tx: Q, collectionId: string, entryIds: string[]): Promise<void> {
  await tx.delete(collectionEntries).where(eq(collectionEntries.collectionId, collectionId));
  if (entryIds.length > 0) {
    await tx.insert(collectionEntries).values(entryIds.map((entryId, position) => ({ collectionId, entryId, position })));
  }
}

/**
 * Store a new collection and its entry ids, in one transaction. False when the
 * id is taken (the caller picks another). The entry ids must exist as entries
 * (the route checks they are the author's own live ones first).
 * Phase 2 caller: POST /api/gallery/collections.
 */
export async function insertCollection(db: Db, c: GalleryCollection): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const made = await tx
      .insert(collections)
      .values({ id: c.id, authorId: c.authorId, title: c.title, description: c.description, createdAt: c.createdAt, updatedAt: c.updatedAt })
      .onConflictDoNothing()
      .returning({ id: collections.id });
    if (made.length === 0) return false;
    await writeEntryIds(tx, c.id, c.entryIds);
    return true;
  });
}

/**
 * The collection as stored (entry ids in order), or null.
 * Phase 2 callers: GET, PUT and DELETE /api/gallery/collections/[id].
 */
export async function getCollection(db: Q, id: string): Promise<GalleryCollection | null> {
  const [row] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!row) return null;
  return toCollection(row, (await entryIdsOf(db, [id])).get(id) ?? []);
}

/**
 * Replace a collection's title, description and entries, in one transaction.
 * The updated collection, or null when it doesn't exist.
 * Phase 2 caller: PUT /api/gallery/collections/[id].
 */
export async function updateCollection(
  db: Db,
  id: string,
  next: { title: string; description: string; entryIds: string[] },
  updatedAt = Date.now(),
): Promise<GalleryCollection | null> {
  return inTransaction(db, async (tx) => {
    const [row] = await tx
      .update(collections)
      .set({ title: next.title, description: next.description, updatedAt })
      .where(eq(collections.id, id))
      .returning();
    if (!row) return null;
    await writeEntryIds(tx, id, next.entryIds);
    return toCollection(row, next.entryIds);
  });
}

/**
 * Delete a collection (its entry rows go with it; the entries themselves are untouched).
 * True when it existed.
 * Phase 2 caller: DELETE /api/gallery/collections/[id] (owner or admin).
 */
export async function deleteCollection(db: Q, id: string): Promise<boolean> {
  const rows = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
  return rows.length > 0;
}

/**
 * An author's collections, newest first, each with its stored entry ids. Two queries.
 * Phase 2 callers: authors.ts authorWork → GET /api/gallery/authors/[authorId], GET /api/gallery/me/shares.
 */
export async function collectionsOfAuthor(db: Q, authorId: string): Promise<GalleryCollection[]> {
  const rows = await db
    .select()
    .from(collections)
    .where(eq(collections.authorId, authorId))
    .orderBy(desc(collections.createdAt), desc(collections.id));
  const ids = await entryIdsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toCollection(r, ids.get(r.id) ?? []));
}
