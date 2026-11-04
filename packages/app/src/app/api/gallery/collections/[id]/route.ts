import {
  GALLERY_ID_PATTERN,
  type CollectionPageResponse,
  type GalleryAuthorProfile,
  type GalleryCollection,
} from "../../../../../gallery/types";
import { adminAction } from "../../admin";
import { foreignEntry, servedCollection } from "../../authors";
import { mayManageAuthor } from "../../session";
import { galleryPaths, galleryStore, getJson, putJson } from "../../store";
import { checkCollectionWrite, MAX_COLLECTION_BODY_BYTES, readJsonBody } from "../../validate";

// #2315 — one collection: open it, change it (its signed-in author, #2319, or
// the author key), or delete it (either of those, or an admin with a reason, #2331). Deleting a collection never touches its entries.
// Not cached at the CDN, for the same reason as the author page: edits and
// takedowns must show on the next open.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const forbidden = () => Response.json({ error: "you can't change this collection" }, { status: 403 });
const NO_STORE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const stored = await getJson<GalleryCollection>(store, galleryPaths.collection(id));
  if (!stored) return notFound();
  const author = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(stored.authorId));
  if (!author) return notFound();

  const { collection, entries } = await servedCollection(store, stored);
  const body: CollectionPageResponse = {
    collection,
    author: { authorId: author.authorId, name: author.name },
    entries,
  };
  return Response.json(body, { headers: NO_STORE });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const stored = await getJson<GalleryCollection>(store, galleryPaths.collection(id));
  if (!stored) return notFound();
  if (!(await mayManageAuthor(req, store, stored.authorId))) return forbidden();

  const body = await readJsonBody(req, MAX_COLLECTION_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkCollectionWrite(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });
  const foreign = await foreignEntry(store, stored.authorId, checked.value.entryIds);
  if (foreign) return Response.json({ error: foreign }, { status: 400 });

  const collection: GalleryCollection = {
    id,
    authorId: stored.authorId,
    ...checked.value,
    createdAt: stored.createdAt,
    updatedAt: Date.now(),
  };
  await putJson(store, galleryPaths.collection(id), collection);
  return Response.json({ collection }, { headers: NO_STORE });
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const stored = await getJson<GalleryCollection>(store, galleryPaths.collection(id));
  if (!stored) return notFound();
  if (!(await mayManageAuthor(req, store, stored.authorId))) {
    const admin = await adminAction(req, store, { action: "take-down-collection", target: id }, forbidden);
    if (admin instanceof Response) return admin;
  }

  // The collection itself first (GET answers 404 at once), then its index marker.
  // Its entries are untouched.
  await store.del([galleryPaths.collection(id), galleryPaths.authorCollection(stored.authorId, id)]);
  return new Response(null, { status: 204 });
}
