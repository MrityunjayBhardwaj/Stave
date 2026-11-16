import { RECORDING_CACHE, liveRecordingStore, recordingJson, storedFrames } from "../../recordingFiles";

// #2603 — the stills of an entry's visuals, taken at publish (#2590), served
// apart from its recording so the cards, which fetch the recording, never
// download them. Only the entry page asks for these. `{ frames: [] }` when the
// entry has a recording but no stills; an entry published before the stills were
// stored apart gets the ones inside its record. Served as the recording is
// (recordingFiles.ts): live entries only, re-read, nosniff, cached 5 minutes.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = await liveRecordingStore(id);
  if (store instanceof Response) return store;
  const frames = await storedFrames(store, id);
  if (!frames) return recordingJson(404, { error: "not found" });
  return recordingJson(200, { frames }, RECORDING_CACHE);
}
