import {
  GALLERY_ID_PATTERN,
  type AuthorPageResponse,
  type GalleryAuthorProfile,
  type GalleryCollection,
} from "../../../../../gallery/types";
import { indexedIds, liveEntries, servedCollection } from "../../authors";
import { mayManageAuthor } from "../../session";
import { galleryPaths, galleryStore, getJson, putJson } from "../../store";
import { checkAuthorUpdate, MAX_AUTHOR_BODY_BYTES, readJsonBody } from "../../validate";

// #2314 — an author's profile page: read it, or edit it (signed in as its owner,
// #2319, or with the author key from before sign-in).
//
// Not cached at the CDN (`no-store`): the person who just edited their bio or
// made a collection expects to see it on the next open, and a takedown must
// leave the page at once. A profile open is one request per click (like the
// entry route), not per overlay open, so the uncached cost stays small.
//
// The response is built only from the public profile and public entries; the
// private record (with the email) is read solely to check the key on PUT.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const NO_STORE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ authorId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { authorId } = await params;
  if (!GALLERY_ID_PATTERN.test(authorId)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const author = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(authorId));
  if (!author) return notFound();

  const [entryIds, collectionIds] = await Promise.all([
    indexedIds(store, galleryPaths.authorEntriesOf(authorId)),
    indexedIds(store, galleryPaths.authorCollectionsOf(authorId)),
  ]);
  // The index is a hint: an entry must still be live and still name this author.
  const entries = (await liveEntries(store, entryIds)).filter((e) => e.authorId === authorId);
  entries.sort((a, b) => b.publishedAt - a.publishedAt);

  const stored = await Promise.all(
    collectionIds.map((id) => getJson<GalleryCollection>(store, galleryPaths.collection(id)).catch(() => null)),
  );
  const collections = (
    await Promise.all(
      stored
        .filter((c): c is GalleryCollection => c !== null && c.authorId === authorId)
        .map(async (c) => (await servedCollection(store, c)).collection),
    )
  ).sort((a, b) => b.createdAt - a.createdAt);

  const body: AuthorPageResponse = { author: publicProfile(author), entries, collections };
  return Response.json(body, { headers: NO_STORE });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { authorId } = await params;
  if (!GALLERY_ID_PATTERN.test(authorId)) return notFound();
  const store = galleryStore();
  if (!store) return noStore();

  const author = await getJson<GalleryAuthorProfile>(store, galleryPaths.author(authorId));
  if (!author) return notFound();
  // #2319 — the signed-in owner, or the key for a profile made before sign-in.
  if (!(await mayManageAuthor(req, store, authorId))) {
    return Response.json({ error: "you can't edit this profile" }, { status: 403 });
  }

  const body = await readJsonBody(req, MAX_AUTHOR_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkAuthorUpdate(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });

  const updated: GalleryAuthorProfile = {
    ...publicProfile(author),
    name: checked.value.name,
    bio: checked.value.bio,
    updatedAt: Date.now(),
  };
  await putJson(store, galleryPaths.author(authorId), updated);
  return Response.json({ author: updated }, { headers: NO_STORE });
}

/** Only the contract's fields, whatever else a stored profile might hold. */
function publicProfile(p: GalleryAuthorProfile): GalleryAuthorProfile {
  const out: GalleryAuthorProfile = {
    authorId: p.authorId,
    name: p.name,
    bio: p.bio,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  // #2319 — the badge, field by field: only the provider, GitHub login and avatar.
  if (p.verified) {
    const v = p.verified;
    out.verified = { provider: v.provider };
    if (v.login) out.verified.login = v.login;
    if (v.avatarUrl) out.verified.avatarUrl = v.avatarUrl;
  }
  return out;
}
