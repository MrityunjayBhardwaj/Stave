import { GALLERY_ID_PATTERN } from "../../../../../gallery/types";
import { readRecording } from "../../../../../gallery/recording";
import { getDb } from "../../../../../db/client";
import { isDatabaseUnavailable } from "../../../../../db/errors";
import { getEntryRecord } from "../../../../../db/repo/entries";
import { galleryPaths, galleryStore } from "../../store";

// #2487 — what an entry plays, recorded at publish on the author's machine: the
// data a card draws its timeline from. Served as the thumbnail is: only for a
// live entry (Postgres says), read back through the same reader that checked it
// at publish (never trusted from storage), nosniff, cached for 5 minutes so a
// taken-down entry's record doesn't outlive it by long.

const json = (status: number, body: unknown, cache = "no-store") =>
  Response.json(body, { status, headers: { "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return json(404, { error: "not found" });
  const store = galleryStore();
  if (!store) return json(503, { error: "the gallery is not set up here" });

  let live: boolean;
  try {
    const db = await getDb();
    if (!db) return json(503, { error: "the gallery is not set up here" });
    const record = await getEntryRecord(db, id);
    live = record !== null && record.removed === null && record.entry.hasRecording === true;
  } catch (err) {
    if (!isDatabaseUnavailable(err)) throw err;
    return Response.json(
      { error: "the gallery is having trouble right now" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (!live) return json(404, { error: "not found" });
  const bytes = await store.get(galleryPaths.recording(id));
  if (!bytes) return json(404, { error: "not found" });
  let rec: ReturnType<typeof readRecording> = null;
  try {
    rec = readRecording(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    rec = null;
  }
  if (!rec) return json(404, { error: "not found" });
  return json(200, rec, "public, max-age=300, s-maxage=300");
}
