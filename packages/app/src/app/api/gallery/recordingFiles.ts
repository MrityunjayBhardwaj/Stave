import { GALLERY_ID_PATTERN } from "../../../gallery/types";
import { readFrames, readRecording, type GalleryRecording, type RecordedFrame } from "../../../gallery/recording";
import { getDb } from "../../../db/client";
import { isDatabaseUnavailable } from "../../../db/errors";
import { getEntryRecord } from "../../../db/repo/entries";
import { galleryPaths, galleryStore, type GalleryBlobStore } from "./store";

// #2487 / #2603 — what the recording and stills routes share. Both serve an
// entry's recorded files the way the thumbnail is served: only for a live entry
// that has a recording (Postgres says), read back through the same readers that
// checked them at publish (never trusted from storage), nosniff, cached for 5
// minutes so a taken-down entry's files don't outlive it by long.

export const recordingJson = (status: number, body: unknown, cache = "no-store") =>
  Response.json(body, { status, headers: { "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });

export const RECORDING_CACHE = "public, max-age=300, s-maxage=300";

/** The store, when `id` is a live entry with a recording; otherwise the answer to send. */
export async function liveRecordingStore(id: string): Promise<GalleryBlobStore | Response> {
  if (!GALLERY_ID_PATTERN.test(id)) return recordingJson(404, { error: "not found" });
  const store = galleryStore();
  if (!store) return recordingJson(503, { error: "the gallery is not set up here" });
  let live: boolean;
  try {
    const db = await getDb();
    if (!db) return recordingJson(503, { error: "the gallery is not set up here" });
    const record = await getEntryRecord(db, id);
    live = record !== null && record.removed === null && record.entry.hasRecording === true;
  } catch (err) {
    if (!isDatabaseUnavailable(err)) throw err;
    return Response.json(
      { error: "the gallery is having trouble right now" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (!live) return recordingJson(404, { error: "not found" });
  return store;
}

function parse(bytes: Uint8Array | null): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** The stored record, read back through `readRecording`; null when missing or unreadable. */
export async function storedRecording(store: GalleryBlobStore, id: string): Promise<GalleryRecording | null> {
  const raw = parse(await store.get(galleryPaths.recording(id)));
  return raw === undefined ? null : readRecording(raw);
}

/**
 * #2603 — the entry's stills: from their own file, or, for an entry published
 * before the stills were stored apart, from inside its record. Null when the
 * entry has a stills file that doesn't read, or no record at all.
 */
export async function storedFrames(store: GalleryBlobStore, id: string): Promise<RecordedFrame[] | null> {
  const own = parse(await store.get(galleryPaths.frames(id)));
  if (own !== undefined) {
    const list = own && typeof own === "object" && !Array.isArray(own) ? (own as { frames?: unknown }).frames : undefined;
    return readFrames(list);
  }
  const rec = await storedRecording(store, id);
  return rec ? (rec.frames ?? []) : null;
}
