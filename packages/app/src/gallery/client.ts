/**
 * Community gallery (#2306) — the browser side of the routes in types.ts.
 * Every function throws an Error whose message a person can act on.
 */
import {
  MANAGE_TOKEN_HEADER,
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
  if (res.status === 429) return new Error("you've published several times in the last few minutes; try again shortly");
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

export async function publishToGallery(req: PublishRequest): Promise<PublishResponse> {
  const res = await fetch("/api/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
