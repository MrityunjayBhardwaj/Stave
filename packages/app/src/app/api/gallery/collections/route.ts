import { newShareId } from "../../../../shareCrypto";
import { type GalleryCollection } from "../../../../gallery/types";
import { foreignEntry } from "../authors";
import { limitAuthor } from "../rateLimit";
import { actingAuthor } from "../session";
import { galleryPaths, galleryStore, putJson } from "../store";
import { checkCollectionWrite, MAX_COLLECTION_BODY_BYTES, readJsonBody } from "../validate";

// #2315 — make a collection of your own entries. The session (#2319), or for an
// author from before sign-in the author key, says whose it is; there is no
// author id in the body to trust.

export async function POST(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const authorId = await actingAuthor(req, store);
  if (!authorId) return Response.json({ error: "sign in to make a collection" }, { status: 403 });
  const limited = await limitAuthor("edit", authorId); // #2330
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_COLLECTION_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkCollectionWrite(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const foreign = await foreignEntry(store, authorId, checked.value.entryIds);
  if (foreign) return Response.json({ error: foreign }, { status: 400 });

  let id: string | null = null;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const candidate = newShareId();
    if (!(await store.get(galleryPaths.collection(candidate)))) id = candidate;
  }
  if (!id) return Response.json({ error: "could not store the collection" }, { status: 500 });

  const now = Date.now();
  const collection: GalleryCollection = { id, authorId, ...checked.value, createdAt: now, updatedAt: now };
  // Collection first, then the author's index marker: a marker never points at nothing new.
  await putJson(store, galleryPaths.collection(id), collection);
  await putJson(store, galleryPaths.authorCollection(authorId, id), {});
  return Response.json({ collection }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
