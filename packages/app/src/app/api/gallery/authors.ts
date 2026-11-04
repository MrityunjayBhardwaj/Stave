import { newShareId } from "../../../shareCrypto";
import type { GalleryAuthorProfile, GalleryCollection, GalleryEntry, GalleryVerified } from "../../../gallery/types";
import { hashToken, newManageToken, tokenMatches } from "./auth";
import {
  galleryPaths,
  getJson,
  putJson,
  type AuthorKeyPointer,
  type GalleryBlobStore,
  type PrivateAuthorRecord,
  type RemovedMarker,
} from "./store";

// #2314 / #2315 — authors and collections, shared by the publish route, the
// author routes and the collection routes.
//
// An author has no account. On a first publish the server makes one and hands
// back an author key once; the store keeps only the key's SHA-256 — in the
// private record beside the email, and as the NAME of a small pointer blob
// (`author-keys/<hash>.json` → authorId), which is how a key alone finds its
// author. A found author is then confirmed with the constant-time compare
// against the private record, so the pointer is only an index, never the check.
//
// Finding an author's entries and collections: a per-author index
// (`author-index/<authorId>/entries/<entryId>.json`, one empty marker per
// entry), not a scan of every entry. The trade-off:
//   - index: one prefix list + one read per THAT author's entries. Cost grows
//     with the author, not the gallery. Publish writes one extra small blob, and
//     the index can point at an entry that is gone — so every read re-checks the
//     entry itself (missing or removed → left out), and a takedown is never
//     trusted to have tidied the index.
//   - scan: list every entry and read each to compare authorId. One read per
//     entry in the whole gallery on every profile open, and the listing route's
//     500-newest cap would silently hide an author's older work.
// The index wins once the gallery has more than a handful of authors.

/** A fresh author key: same shape as a manage token (32 random bytes, base64url). */
export const newAuthorKey = newManageToken;

/** The author this key belongs to, or null (no key, unknown key, or a pointer that doesn't verify). */
export async function authorForKey(store: GalleryBlobStore, key: string | null): Promise<string | null> {
  if (!key) return null;
  const pointer = await getJson<AuthorKeyPointer>(store, galleryPaths.authorKey(hashToken(key)));
  if (!pointer) return null;
  return (await keyOwnsAuthor(store, pointer.authorId, key)) ? pointer.authorId : null;
}

/** Does `key` own `authorId`? Constant-time compare against the stored hash. */
export async function keyOwnsAuthor(store: GalleryBlobStore, authorId: string, key: string | null): Promise<boolean> {
  if (!key) return false;
  const record = await getJson<PrivateAuthorRecord>(store, galleryPaths.authorPrivate(authorId));
  // #2319 — an author made for a signed-in account has no key; only its session manages it.
  if (!record?.authorKeyHash) return false;
  return tokenMatches(key, record.authorKeyHash);
}

/** A fresh, unused author id, or null after three clashes. */
async function freeAuthorId(store: GalleryBlobStore): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newShareId();
    if (!(await store.get(galleryPaths.authorPrivate(candidate)))) return candidate;
  }
  return null;
}

/**
 * Make a new key-held author (the #2314 way, before sign-in). Private record and
 * key pointer first, the public profile last — so a profile that shows exists
 * only once its key works. Publishing no longer calls this (#2319); it stays for
 * #2320's claim flow and for tests that need an author made before sign-in.
 */
export async function createAuthor(
  store: GalleryBlobStore,
  name: string,
  email: string,
): Promise<{ authorId: string; authorKey: string } | null> {
  const authorId = await freeAuthorId(store);
  if (!authorId) return null;

  const authorKey = newAuthorKey();
  const keyHash = hashToken(authorKey);
  const now = Date.now();
  const record: PrivateAuthorRecord = { authorEmail: email, authorKeyHash: keyHash };
  const pointer: AuthorKeyPointer = { authorId };
  const profile: GalleryAuthorProfile = { authorId, name, bio: "", createdAt: now, updatedAt: now };

  await putJson(store, galleryPaths.authorPrivate(authorId), record);
  await putJson(store, galleryPaths.authorKey(keyHash), pointer);
  await putJson(store, galleryPaths.author(authorId), profile);
  return { authorId, authorKey };
}

/**
 * #2319 — make the author for a signed-in account: no key (the session is what
 * manages it), the account's badge on the public profile. The caller links it to
 * the account (session.ts attachAuthorToAccount).
 */
export async function createKeylessAuthor(
  store: GalleryBlobStore,
  name: string,
  email: string,
  verified: GalleryVerified,
): Promise<string | null> {
  const authorId = await freeAuthorId(store);
  if (!authorId) return null;
  const now = Date.now();
  const record: PrivateAuthorRecord = { authorEmail: email };
  const profile: GalleryAuthorProfile = { authorId, name, bio: "", createdAt: now, updatedAt: now, verified };
  await putJson(store, galleryPaths.authorPrivate(authorId), record);
  await putJson(store, galleryPaths.author(authorId), profile);
  return authorId;
}

/** An entry that is live (stored and not taken down), or null. */
export async function liveEntry(store: GalleryBlobStore, id: string): Promise<GalleryEntry | null> {
  const [removed, entry] = await Promise.all([
    getJson<RemovedMarker>(store, galleryPaths.removed(id)),
    getJson<GalleryEntry>(store, galleryPaths.entry(id)).catch(() => null),
  ]);
  return removed || !entry ? null : entry;
}

/** The live entries among `ids`, in the same order; gone ones left out. */
export async function liveEntries(store: GalleryBlobStore, ids: string[]): Promise<GalleryEntry[]> {
  const found = await Promise.all(ids.map((id) => liveEntry(store, id)));
  return found.filter((e): e is GalleryEntry => e !== null);
}

/** The collection as served: ids of entries that are gone dropped. */
export async function servedCollection(
  store: GalleryBlobStore,
  collection: GalleryCollection,
): Promise<{ collection: GalleryCollection; entries: GalleryEntry[] }> {
  const entries = await liveEntries(store, collection.entryIds);
  return { collection: { ...collection, entryIds: entries.map((e) => e.id) }, entries };
}

/** Ids named in an index folder (`<prefix><id>.json`). */
export async function indexedIds(store: GalleryBlobStore, prefix: string): Promise<string[]> {
  const listed = await store.list(prefix);
  return listed
    .filter((b) => b.pathname.endsWith(".json"))
    .map((b) => b.pathname.slice(prefix.length, -".json".length));
}

/**
 * An author's live entries and collections, newest first — what the profile
 * page shows (#2314) and what My shares lists for an account (#2321). The index
 * is a hint: an entry must still be live and still name this author, and a
 * collection must still name this author.
 */
export async function authorWork(
  store: GalleryBlobStore,
  authorId: string,
): Promise<{ entries: GalleryEntry[]; collections: GalleryCollection[] }> {
  const [entryIds, collectionIds] = await Promise.all([
    indexedIds(store, galleryPaths.authorEntriesOf(authorId)),
    indexedIds(store, galleryPaths.authorCollectionsOf(authorId)),
  ]);
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
  return { entries, collections };
}

/**
 * Check every id is the author's own live entry. Returns the error message
 * naming the first id that isn't, or null when all are.
 */
export async function foreignEntry(
  store: GalleryBlobStore,
  authorId: string,
  ids: string[],
): Promise<string | null> {
  const entries = await Promise.all(ids.map((id) => liveEntry(store, id)));
  for (let i = 0; i < ids.length; i++) {
    const e = entries[i];
    if (!e) return `entry ${ids[i]} does not exist or was removed`;
    if (e.authorId !== authorId) return `entry ${ids[i]} is not one of yours`;
  }
  return null;
}
