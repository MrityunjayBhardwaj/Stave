import type { GalleryEntry } from "../../../gallery/types";
import { galleryPaths, putJson, type GalleryBlobStore, type PrivateRecord, type RemovedMarker } from "./store";

/*
 * #2352 — the Blob side of one gallery entry. The entry's RECORD (listing
 * fields, private email and token hash, removed state) lives in Postgres
 * (db/repo/entries.ts); Blob keeps the heavy files, found by the entry id:
 *
 *   gallery/manifests/<id>.json    the project manifest
 *   gallery/thumbnails/<id>        PNG or WebP bytes
 *
 * Ordering, so a reader never sees an entry whose files are missing:
 *   publish   putEntryFiles FIRST, then the row is inserted (a listed entry's
 *             manifest always exists; a failed insert leaves only unlisted files).
 *   delete    the row is marked removed FIRST (410 and out of the listing at
 *             once), then deleteEntryFiles (a delete that fails halfway still
 *             reads as removed).
 *
 * ── Transitional mirror (remove with the store.ts follow-up) ────────────────
 *
 * Until the authors / collections / claim routes read entries from Postgres
 * too (the other half of phase 2), they still read the old Blob records:
 * gallery/entries/<id>.json, gallery/private/<id>.json, the author index and
 * the removed marker. mirrorPublished / mirrorRemoved keep those written, the
 * same way phase 1 mirrored new authors (session.ts mirrorAuthor). Nothing in
 * THIS group's routes reads them; Postgres is the record. Once both halves
 * have merged, the follow-up that trims store.ts deletes this section.
 */

/** Write the manifest (and thumbnail, when there is one). Before the row. */
export async function putEntryFiles(
  store: GalleryBlobStore,
  id: string,
  manifestBytes: Uint8Array,
  thumbnail: { bytes: Uint8Array; contentType: string } | null,
): Promise<void> {
  await store.put(galleryPaths.manifest(id), manifestBytes, "application/json");
  if (thumbnail) await store.put(galleryPaths.thumbnail(id), thumbnail.bytes, thumbnail.contentType);
}

/** Delete the entry's files (and any mirror records). After the row is marked removed. */
export async function deleteEntryFiles(store: GalleryBlobStore, entry: GalleryEntry): Promise<void> {
  const id = entry.id;
  const oldReports = await store.list(galleryPaths.reportsOf(id));
  await store.del([
    galleryPaths.manifest(id),
    galleryPaths.thumbnail(id),
    // Mirror records (and reports from before Postgres): tidying only.
    ...(entry.authorId ? [galleryPaths.authorEntry(entry.authorId, id)] : []),
    galleryPaths.entry(id),
    galleryPaths.privateRecord(id),
    ...oldReports.map((r) => r.pathname),
  ]);
}

/** Transitional: the Blob records the not-yet-moved readers look for. After the row. */
export async function mirrorPublished(store: GalleryBlobStore, entry: GalleryEntry, record: PrivateRecord): Promise<void> {
  await putJson(store, galleryPaths.privateRecord(entry.id), record);
  if (entry.authorId) await putJson(store, galleryPaths.authorEntry(entry.authorId, entry.id), {});
  await putJson(store, galleryPaths.entry(entry.id), entry);
}

/** Transitional: the removed marker the not-yet-moved readers check. After the row, before the files go. */
export async function mirrorRemoved(store: GalleryBlobStore, id: string, marker: RemovedMarker): Promise<void> {
  await putJson(store, galleryPaths.removed(id), marker);
}
