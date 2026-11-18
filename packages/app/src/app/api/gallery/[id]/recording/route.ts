import { withoutFrames } from "../../../../../gallery/recording";
import { RECORDING_CACHE, liveRecordingStore, recordingJson, storedRecording } from "../../recordingFiles";

// #2487 — what an entry plays, recorded at publish on the author's machine: the
// data a card draws its timeline from. Served as the thumbnail is (recordingFiles.ts).
//
// #2603 — never with the visuals' stills: every card fetches this, and no card
// shows a still. An entry published before the stills were stored apart still
// has them inside its stored record; they're left out here and served by the
// stills route (../frames), which only the entry page asks.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const store = await liveRecordingStore(id);
  if (store instanceof Response) return store;
  const rec = await storedRecording(store, id);
  if (!rec) return recordingJson(404, { error: "not found" });
  return recordingJson(200, withoutFrames(rec), RECORDING_CACHE);
}
