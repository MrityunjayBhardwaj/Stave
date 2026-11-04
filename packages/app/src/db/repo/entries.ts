import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { GalleryEntry, GalleryKind } from "../../gallery/types";
import type { Db } from "../client";
import { entries, reports } from "../schema";
import { inTransaction, type Q } from "./tx";

/*
 * #2299 / #2303 — published entries and the listing. The manifest and the
 * thumbnail stay in Blob (`gallery/manifests/<id>.json`, `gallery/thumbnails/<id>`),
 * found by the entry id; this table holds everything else.
 *
 * A taken-down entry keeps its row with `removed_at` set (so its id is never
 * reused and the entry route can answer 410), and its private columns cleared.
 */

/** The most entries one listing returns, newest first. */
export const MAX_LISTED_ENTRIES = 500;

type EntryRow = typeof entries.$inferSelect;

/** Exactly the public GalleryEntry fields, in the contract's shape (no authorId key on an entry from before profiles). */
export function toGalleryEntry(r: EntryRow): GalleryEntry {
  // The key order of the Blob-era JSON (publish's GalleryEntry literal), so a
  // response reads the same as before.
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    tags: r.tags,
    authorName: r.authorName,
    ...(r.authorId ? { authorId: r.authorId } : {}),
    publishedAt: r.publishedAt,
    fileCount: r.fileCount,
    hasThumbnail: r.hasThumbnail,
  };
}

/** An entry with its private side. Never served as is. */
export interface EntryRecord {
  entry: GalleryEntry;
  /** PRIVATE. "" once removed. */
  authorEmail: string;
  /** PRIVATE. Null once removed. */
  manageTokenHash: string | null;
  removed: { removedAt: number; by: "author" | "admin" } | null;
}

const toRecord = (r: EntryRow): EntryRecord => ({
  entry: toGalleryEntry(r),
  authorEmail: r.authorEmail,
  manageTokenHash: r.manageTokenHash,
  removed: r.removedAt !== null ? { removedAt: r.removedAt, by: r.removedBy ?? "admin" } : null,
});

/**
 * Store a new entry. False when the id is taken (the caller picks another).
 * The route writes the manifest and thumbnail to Blob FIRST, then calls this,
 * so a listed entry's files always exist.
 * Phase 2 caller: POST /api/gallery (publish).
 */
export async function insertEntry(
  db: Q,
  input: { entry: GalleryEntry; authorEmail: string; manageTokenHash: string },
): Promise<boolean> {
  const e = input.entry;
  const rows = await db
    .insert(entries)
    .values({
      id: e.id,
      title: e.title,
      kind: e.kind,
      tags: e.tags,
      authorName: e.authorName,
      authorId: e.authorId ?? null,
      publishedAt: e.publishedAt,
      fileCount: e.fileCount,
      hasThumbnail: e.hasThumbnail,
      authorEmail: input.authorEmail,
      manageTokenHash: input.manageTokenHash,
    })
    .onConflictDoNothing()
    .returning({ id: entries.id });
  return rows.length > 0;
}

/**
 * The entry, live or removed, with its private side; null when it never existed.
 * Phase 2 callers: GET and DELETE /api/gallery/[id], GET /api/gallery/[id]/thumbnail
 * (removed → 404), POST /api/gallery/[id]/report (removed → 410), claim.ts.
 */
export async function getEntryRecord(db: Q, id: string): Promise<EntryRecord | null> {
  const [row] = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * The entry when it is live (stored and not taken down), else null.
 * Phase 2 callers: authors.ts liveEntry → collections, foreignEntry.
 */
export async function liveEntry(db: Q, id: string): Promise<GalleryEntry | null> {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), isNull(entries.removedAt)))
    .limit(1);
  return row ? toGalleryEntry(row) : null;
}

/**
 * The live entries among `ids`, in the order given; gone ones left out. One query.
 * Phase 2 callers: authors.ts liveEntries / servedCollection / foreignEntry
 * (GET/POST/PUT collections, GET author page, GET me/shares).
 */
export async function liveEntries(db: Q, ids: string[]): Promise<GalleryEntry[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(entries)
    .where(and(inArray(entries.id, ids), isNull(entries.removedAt)));
  const byId = new Map(rows.map((r) => [r.id, toGalleryEntry(r)]));
  return ids.map((id) => byId.get(id)).filter((e): e is GalleryEntry => e !== undefined);
}

/**
 * #2346 — the listing: ONE indexed query, newest first, live only, optionally
 * one kind, at most `limit` (capped at MAX_LISTED_ENTRIES).
 * Phase 2 caller: GET /api/gallery.
 */
export async function listEntries(
  db: Q,
  opts: { kind?: GalleryKind; limit?: number } = {},
): Promise<GalleryEntry[]> {
  const limit = Math.max(0, Math.min(opts.limit ?? MAX_LISTED_ENTRIES, MAX_LISTED_ENTRIES));
  const where = opts.kind ? and(isNull(entries.removedAt), eq(entries.kind, opts.kind)) : isNull(entries.removedAt);
  const rows = await db.select().from(entries).where(where).orderBy(desc(entries.publishedAt), desc(entries.id)).limit(limit);
  return rows.map(toGalleryEntry);
}

/**
 * An author's live entries, newest first.
 * Phase 2 callers: authors.ts authorWork → GET /api/gallery/authors/[authorId], GET /api/gallery/me/shares.
 */
export async function entriesOfAuthor(db: Q, authorId: string): Promise<GalleryEntry[]> {
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.authorId, authorId), isNull(entries.removedAt)))
    .orderBy(desc(entries.publishedAt), desc(entries.id));
  return rows.map(toGalleryEntry);
}

/**
 * Take an entry down, in one transaction: `removed_at` / `removed_by` set, the
 * private columns cleared (the email goes), and its open reports closed.
 * True when this call removed it; false when it doesn't exist or was already
 * removed. The route deletes the manifest and thumbnail from Blob AFTER this,
 * so a half-finished delete still reads as removed.
 * Phase 2 caller: DELETE /api/gallery/[id] (author or admin).
 */
export async function removeEntry(db: Db, id: string, by: "author" | "admin", at = Date.now()): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const done = await tx
      .update(entries)
      .set({ removedAt: at, removedBy: by, authorEmail: "", manageTokenHash: null })
      .where(and(eq(entries.id, id), isNull(entries.removedAt)))
      .returning({ id: entries.id });
    if (done.length === 0) return false;
    await tx.update(reports).set({ closedAt: at }).where(and(eq(reports.entryId, id), isNull(reports.closedAt)));
    return true;
  });
}
