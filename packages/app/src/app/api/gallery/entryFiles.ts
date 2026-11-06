import { galleryPaths, type GalleryBlobStore } from "./store";

/*
 * #2352 — the Blob side of one gallery entry. The entry's RECORD (listing
 * fields, private email and token hash, removed state) lives in Postgres
 * (db/repo/entries.ts); Blob keeps only the entry's content, found by its id:
 *
 *   gallery/manifests/<id>.json    the project manifest
 *   gallery/thumbnails/<id>        PNG or WebP bytes
 *
 * Nothing else is written here (#2363: the old Blob records publish and
 * take-down used to mirror are gone; galleryBlobContentOnly.test.ts holds the line).
 *
 * Ordering, so a reader never sees an entry whose files are missing:
 *   publish   putEntryFiles FIRST, then the row is inserted (a listed entry's
 *             manifest always exists; a failed insert leaves only unlisted files).
 *   take-down the row is marked removed FIRST (410 and out of the listing at
 *             once), then deleteEntryFiles (one that fails halfway still reads
 *             as removed).
 *   own delete the row and the files go in one transaction (#2403): a failed
 *             file delete rolls the row back, so the author can retry.
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

/**
 * Delete the entry's files. Thumbnail first: if the manifest's delete then fails,
 * an entry rolled back to live has lost only its picture and can still be opened.
 */
export async function deleteEntryFiles(store: GalleryBlobStore, id: string): Promise<void> {
  await store.del([galleryPaths.thumbnail(id), galleryPaths.manifest(id)]);
}
