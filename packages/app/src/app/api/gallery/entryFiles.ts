import { galleryPaths, type GalleryBlobStore } from "./store";

/*
 * #2352 — the Blob side of one gallery entry. The entry's RECORD (listing
 * fields, private email and token hash, removed state) lives in Postgres
 * (db/repo/entries.ts); Blob keeps only the entry's content, found by its id:
 *
 *   gallery/manifests/<id>.json    the project manifest
 *   gallery/thumbnails/<id>        PNG or WebP bytes
 *   gallery/recordings/<id>.json   what it plays, recorded at publish (#2487)
 *
 * Nothing else is written here (#2363: the old Blob records publish and
 * take-down used to mirror are gone; galleryBlobContentOnly.test.ts holds the line).
 *
 * Ordering, so a reader never sees an entry whose files are missing:
 *   publish   putEntryFiles FIRST, then the row is inserted (a listed entry's
 *             manifest always exists; a failed insert leaves only unlisted files).
 *   take-down nothing here: the entry is only hidden, and its files stay so it
 *             can be restored (#2401).
 *   purge     when the take-down's window ends, the row and the files change in
 *             one transaction: a failed delete leaves it hidden for the next run.
 *   own delete the row and the files go in one transaction (#2403): a failed
 *             file delete rolls the row back, so the author can retry.
 */

/** Write the manifest (and thumbnail, when there is one). Before the row. */
export async function putEntryFiles(
  store: GalleryBlobStore,
  id: string,
  manifestBytes: Uint8Array,
  thumbnail: { bytes: Uint8Array; contentType: string } | null,
  recording: Uint8Array | null = null,
): Promise<void> {
  await store.put(galleryPaths.manifest(id), manifestBytes, "application/json");
  if (thumbnail) await store.put(galleryPaths.thumbnail(id), thumbnail.bytes, thumbnail.contentType);
  if (recording) await store.put(galleryPaths.recording(id), recording, "application/json");
}

/**
 * Delete the entry's files. Pictures first (the recording, the thumbnail): if the
 * manifest's delete then fails, an entry rolled back to live has lost only its
 * pictures and can still be opened. An entry with no recording deletes nothing
 * there; the store's delete of a missing path is not an error.
 */
export async function deleteEntryFiles(store: GalleryBlobStore, id: string): Promise<void> {
  await store.del([galleryPaths.recording(id), galleryPaths.thumbnail(id), galleryPaths.manifest(id)]);
}
