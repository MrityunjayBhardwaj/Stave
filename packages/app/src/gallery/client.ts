/**
 * Community gallery (#2306) — the browser side of the routes in types.ts.
 * Every function throws an Error whose message a person can act on.
 */
import { readRecording, type GalleryRecording } from "./recording";
import {
  AUTHOR_KEY_HEADER,
  MANAGE_TOKEN_HEADER,
  TURNSTILE_HEADER,
  type AuthorMovedResponse,
  type AuthorPageResponse,
  type ClaimRequest,
  type ClaimResponse,
  type MySharesResponse,
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

function withTurnstile(headers: Record<string, string>, token: string | null | undefined): Record<string, string> {
  return token ? { ...headers, [TURNSTILE_HEADER]: token } : headers;
}

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
  // #2330 — the server says what was limited and when to try again; use its words.
  if (res.status === 429) {
    if (detail) return new Error(detail);
    return new Error(
      what === "publishing"
        ? "you've published several times in the last few minutes; try again shortly"
        : "too many changes in the last few minutes; try again shortly",
    );
  }
  if (res.status === 503) return new Error("the gallery isn't set up on this site");
  return new Error(detail || `${what} failed (${res.status})`);
}

/** A 503 from publish is either no store or no sign-in set up; the server says which. */
async function signInOrStoreMissing(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error && /sign-in/.test(body.error)) return new Error(body.error);
  } catch {
    /* not JSON */
  }
  return new Error("the gallery isn't set up on this site");
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

const recordings = new Map<string, Promise<GalleryRecording | null>>();

/**
 * #2487 — what an entry plays, recorded at publish; null when it has none or it
 * couldn't be read. Read through `readRecording` again here: the card draws only
 * a record of the right shape. One request per entry per page: the card and the
 * entry page share it. A failed fetch is forgotten, so a later draw tries again.
 */
export function fetchGalleryRecording(id: string): Promise<GalleryRecording | null> {
  const had = recordings.get(id);
  if (had) return had;
  const p = fetch(`/api/gallery/${encodeURIComponent(id)}/recording`)
    .then(async (res) => (res.ok ? readRecording(await res.json()) : null))
    .catch(() => {
      recordings.delete(id);
      return null;
    });
  recordings.set(id, p);
  return p;
}

/** Test seam: forget fetched records. */
export function forgetGalleryRecordingsForTests(): void {
  recordings.clear();
}

export function galleryThumbnailUrl(id: string): string {
  return `/api/gallery/${encodeURIComponent(id)}/thumbnail`;
}

/**
 * #2319 — the session cookie (sent with this same-origin request) says who is
 * publishing; signed out, the server answers 401.
 */
export async function publishToGallery(req: PublishRequest, turnstileToken?: string | null): Promise<PublishResponse> {
  const res = await fetch("/api/gallery", {
    method: "POST",
    headers: withTurnstile({ "Content-Type": "application/json" }, turnstileToken),
    body: JSON.stringify(req),
  });
  if (res.status === 401) throw new Error("sign in to publish (your session may have ended)");
  if (res.status === 503) throw await signInOrStoreMissing(res);
  if (res.status !== 201) throw await failure(res, "publishing");
  return (await res.json()) as PublishResponse;
}

/**
 * Take an entry down. `manageToken` is this browser's key for it; without one
 * (#2321, an entry on the signed-in account) the session cookie is what counts.
 */
export async function deleteFromGallery(id: string, manageToken: string | null): Promise<void> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: manageToken ? { [MANAGE_TOKEN_HEADER]: manageToken } : {},
  });
  // Already gone counts as done.
  if (res.status === 204 || res.status === 404 || res.status === 410) return;
  if (res.status === 403) throw new Error("this browser's key for that entry doesn't match");
  throw await failure(res, "deleting");
}

export async function reportGalleryEntry(id: string, reason: string, turnstileToken?: string | null): Promise<void> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}/report`, {
    method: "POST",
    headers: withTurnstile({ "Content-Type": "application/json" }, turnstileToken),
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
export async function revokeShareLink(id: string, manageToken: string | null): Promise<void> {
  // #2321 — no token: a link on the signed-in account, revoked through the session.
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: manageToken ? { [MANAGE_TOKEN_HEADER]: manageToken } : {},
  });
  if (res.status === 204 || res.status === 404) return;
  throw await failure(res, "revoking the link");
}

// ── #2320 claim and #2321 My shares from the account ───────────────────────

/** Bring what this browser holds keys for into the signed-in account. */
export async function claimIntoAccount(req: ClaimRequest): Promise<ClaimResponse> {
  const res = await fetch("/api/gallery/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await failure(res, "bringing your shares into your account");
  return (await res.json()) as ClaimResponse;
}

/** The signed-in account's entries, collections and private links. */
export async function fetchAccountShares(): Promise<MySharesResponse> {
  const res = await fetch("/api/gallery/me/shares", { cache: "no-store" });
  if (!res.ok) throw await failure(res, "loading your shares");
  return (await res.json()) as MySharesResponse;
}

// ── #2314 profiles and #2315 collections ───────────────────────────────────

const KEY_MISMATCH = "you can't edit that profile (sign in with the account it belongs to)";

/**
 * #2319 — the signed-in owner is known by the session cookie; `authorKey` is the
 * fallback for a profile this browser made before sign-in. Send it only when held.
 */
function keyed(authorKey: string | null | undefined, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (authorKey) h[AUTHOR_KEY_HEADER] = authorKey;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/**
 * A profile page. #2320 — a profile merged into an account's profile answers
 * `{ movedTo }`; this follows it (a few hops at most), so an old profile link
 * opens the account's profile. The page's `author.authorId` is where it landed.
 */
export async function fetchAuthorPage(authorId: string): Promise<AuthorPageResponse> {
  let id = authorId;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(`/api/gallery/authors/${encodeURIComponent(id)}`);
    if (res.status === 404) throw new Error("this profile wasn't found");
    if (!res.ok) throw await failure(res, "loading the profile");
    const body = (await res.json()) as AuthorPageResponse | AuthorMovedResponse;
    if (!("movedTo" in body)) return body;
    id = body.movedTo;
  }
  throw new Error("this profile moved too many times to follow");
}

export async function updateAuthor(
  authorId: string,
  authorKey: string | null,
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

export async function createCollection(authorKey: string | null, req: CollectionWriteRequest): Promise<GalleryCollection> {
  const res = await fetch("/api/gallery/collections", {
    method: "POST",
    headers: keyed(authorKey, true),
    body: JSON.stringify(req),
  });
  if (res.status === 403) throw new Error("sign in to make a collection");
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
  authorKey: string | null,
  req: CollectionWriteRequest,
): Promise<GalleryCollection> {
  const res = await fetch(`/api/gallery/collections/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: keyed(authorKey, true),
    body: JSON.stringify(req),
  });
  if (res.status === 403) throw new Error("you can't change that collection");
  if (res.status === 404) throw new Error("this collection wasn't found");
  if (!res.ok) throw await failure(res, "saving the collection");
  return ((await res.json()) as { collection: GalleryCollection }).collection;
}

/** Already gone (404) counts as done. */
export async function deleteCollection(id: string, authorKey: string | null): Promise<void> {
  const res = await fetch(`/api/gallery/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: keyed(authorKey),
  });
  if (res.status === 204 || res.status === 404) return;
  if (res.status === 403) throw new Error("you can't delete that collection");
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
