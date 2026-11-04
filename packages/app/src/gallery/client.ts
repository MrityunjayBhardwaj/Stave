/**
 * Community gallery (#2306) — the browser side of the routes in types.ts.
 * Every function throws an Error whose message a person can act on.
 */
import {
  AUTHOR_KEY_HEADER,
  MANAGE_TOKEN_HEADER,
  type AuthorPageResponse,
  type AuthorUpdateRequest,
  type CollectionPageResponse,
  type CollectionWriteRequest,
  type GalleryAuthorProfile,
  type GalleryCollection,
  type GalleryEntryResponse,
  type GalleryListResponse,
  type PublishRequest,
  type PublishResponse,
} from "./types";

/** A removed entry (410) — the overlay says "this was removed" instead of failing. */
export class GalleryEntryRemoved extends Error {
  constructor() {
    super("this entry was removed from the gallery");
    this.name = "GalleryEntryRemoved";
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) detail = body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 429) {
    return new Error(
      what === "publishing"
        ? "you've published several times in the last few minutes; try again shortly"
        : "too many changes in the last few minutes; try again shortly",
    );
  }
  if (res.status === 503) return new Error("the gallery isn't set up on this site");
  return new Error(detail || `${what} failed (${res.status})`);
}

export async function fetchGalleryList(): Promise<GalleryListResponse> {
  const res = await fetch("/api/gallery");
  if (!res.ok) throw await failure(res, "loading the gallery");
  return (await res.json()) as GalleryListResponse;
}

export async function fetchGalleryEntry(id: string): Promise<GalleryEntryResponse> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}`);
  if (res.status === 410) throw new GalleryEntryRemoved();
  if (res.status === 404) throw new Error("this gallery entry wasn't found");
  if (!res.ok) throw await failure(res, "loading the entry");
  return (await res.json()) as GalleryEntryResponse;
}

export function galleryThumbnailUrl(id: string): string {
  return `/api/gallery/${encodeURIComponent(id)}/thumbnail`;
}

/**
 * `authorKey` (#2314): this browser's author key, when it has one, so the entry
 * lands on the same profile as the earlier ones.
 */
export async function publishToGallery(req: PublishRequest, authorKey?: string): Promise<PublishResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorKey) headers[AUTHOR_KEY_HEADER] = authorKey;
  const res = await fetch("/api/gallery", {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });
  if (res.status !== 201) throw await failure(res, "publishing");
  return (await res.json()) as PublishResponse;
}

export async function deleteFromGallery(id: string, manageToken: string): Promise<void> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { [MANAGE_TOKEN_HEADER]: manageToken },
  });
  // Already gone counts as done.
  if (res.status === 204 || res.status === 404 || res.status === 410) return;
  if (res.status === 403) throw new Error("this browser's key for that entry doesn't match");
  throw await failure(res, "deleting");
}

export async function reportGalleryEntry(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (res.status !== 202) throw await failure(res, "reporting");
}

/** A link that opens the gallery overlay on this entry. */
export function galleryEntryLink(id: string): string {
  return `${window.location.origin}/#gallery=${encodeURIComponent(id)}`;
}

/**
 * #2311 — revoke a private short link this browser made. Already gone (404)
 * counts as done; a link made before revoking existed answers 403 with a reason.
 */
export async function revokeShareLink(id: string, manageToken: string): Promise<void> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { [MANAGE_TOKEN_HEADER]: manageToken },
  });
  if (res.status === 204 || res.status === 404) return;
  throw await failure(res, "revoking the link");
}

// ── #2314 profiles and #2315 collections ───────────────────────────────────

const KEY_MISMATCH = "this browser's author key doesn't match that profile";

function keyed(authorKey: string, json = false): Record<string, string> {
  const h: Record<string, string> = { [AUTHOR_KEY_HEADER]: authorKey };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function fetchAuthorPage(authorId: string): Promise<AuthorPageResponse> {
  const res = await fetch(`/api/gallery/authors/${encodeURIComponent(authorId)}`);
  if (res.status === 404) throw new Error("this profile wasn't found");
  if (!res.ok) throw await failure(res, "loading the profile");
  return (await res.json()) as AuthorPageResponse;
}

export async function updateAuthor(
  authorId: string,
  authorKey: string,
  update: AuthorUpdateRequest,
): Promise<GalleryAuthorProfile> {
  const res = await fetch(`/api/gallery/authors/${encodeURIComponent(authorId)}`, {
    method: "PUT",
    headers: keyed(authorKey, true),
    body: JSON.stringify(update),
  });
  if (res.status === 403) throw new Error(KEY_MISMATCH);
  if (res.status === 404) throw new Error("this profile wasn't found");
  if (!res.ok) throw await failure(res, "saving the profile");
  return ((await res.json()) as { author: GalleryAuthorProfile }).author;
}

export async function createCollection(authorKey: string, req: CollectionWriteRequest): Promise<GalleryCollection> {
  const res = await fetch("/api/gallery/collections", {
    method: "POST",
    headers: keyed(authorKey, true),
    body: JSON.stringify(req),
  });
  if (res.status === 403) throw new Error("this browser's author key wasn't accepted");
  if (res.status !== 201) throw await failure(res, "creating the collection");
  return ((await res.json()) as { collection: GalleryCollection }).collection;
}

export async function fetchCollectionPage(id: string): Promise<CollectionPageResponse> {
  const res = await fetch(`/api/gallery/collections/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error("this collection wasn't found");
  if (!res.ok) throw await failure(res, "loading the collection");
  return (await res.json()) as CollectionPageResponse;
}

export async function updateCollection(
  id: string,
  authorKey: string,
  req: CollectionWriteRequest,
): Promise<GalleryCollection> {
  const res = await fetch(`/api/gallery/collections/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: keyed(authorKey, true),
    body: JSON.stringify(req),
  });
  if (res.status === 403) throw new Error("this browser's author key doesn't match that collection");
  if (res.status === 404) throw new Error("this collection wasn't found");
  if (!res.ok) throw await failure(res, "saving the collection");
  return ((await res.json()) as { collection: GalleryCollection }).collection;
}

/** Already gone (404) counts as done. */
export async function deleteCollection(id: string, authorKey: string): Promise<void> {
  const res = await fetch(`/api/gallery/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: keyed(authorKey),
  });
  if (res.status === 204 || res.status === 404) return;
  if (res.status === 403) throw new Error("this browser's author key doesn't match that collection");
  throw await failure(res, "deleting the collection");
}

/** A link that opens the gallery overlay on this author's profile. */
export function galleryAuthorLink(authorId: string): string {
  return `${window.location.origin}/#gallery-author=${encodeURIComponent(authorId)}`;
}

/** A link that opens the gallery overlay on this collection. */
export function galleryCollectionLink(id: string): string {
  return `${window.location.origin}/#gallery-collection=${encodeURIComponent(id)}`;
}
