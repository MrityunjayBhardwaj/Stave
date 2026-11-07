import { isReservedName } from "../../../gallery/reservedNames";
import type { GalleryCollection, GalleryEntry } from "../../../gallery/types";
import type { Db } from "../../../db/client";
import {
  authorIdForKeyHash,
  authorKeyHash,
  collectionsOfAuthor,
  entriesOfAuthor,
  insertKeyedAuthor,
  liveEntries,
  type Q,
} from "../../../db/repo";
import { hashToken, newManageToken, tokenMatches } from "./auth";

// #2314 / #2315 — authors and collections, shared by the author routes, the
// collection routes, My shares and the claim.
//
// #2352 — the records are in Postgres (src/db/schema.ts): `authors`,
// `author_keys`, `entries`, `collections`, `collection_entries`. Every function
// here takes the database (or a transaction) first.
//
// An author made before sign-in has no account. Its author key was handed back
// once; the store keeps only the key's SHA-256 (`author_keys.key_hash`). A key
// finds its author by that hash (an index lookup), and the author it found is
// then CONFIRMED with the constant-time compare against the stored hash, so the
// lookup is only an index, never the check.
//
// An author's entries and collections come from indexed queries
// (`entries (author_id, published_at desc)`, `collections (author_id, created_at desc)`),
// live entries only. A collection keeps the ids its author saved; an entry taken
// down since is left out when it is read (servedCollection), never deleted from it.

/** A fresh author key: same shape as a manage token (32 random bytes, base64url). */
export const newAuthorKey = newManageToken;

/** The author this key belongs to, or null (no key, unknown key, or a hash that doesn't confirm). */
export async function authorForKey(db: Q, key: string | null): Promise<string | null> {
  if (!key) return null;
  const authorId = await authorIdForKeyHash(db, hashToken(key));
  if (!authorId) return null;
  return (await keyOwnsAuthor(db, authorId, key)) ? authorId : null;
}

/** Does `key` own `authorId`? Constant-time compare against the stored hash. */
export async function keyOwnsAuthor(db: Q, authorId: string, key: string | null): Promise<boolean> {
  if (!key) return false;
  // #2319 — an author made for a signed-in account has no key; only its session manages it.
  const stored = await authorKeyHash(db, authorId);
  if (!stored) return false;
  return tokenMatches(key, stored);
}

/**
 * Make a new key-held author (the #2314 way, before sign-in): the author and
 * its key hash in one transaction. Publishing no longer calls this (#2319); it
 * stays for #2320's claim tests and the browser specs' dev-only seeding. Null
 * for a reserved name (#2368), like every other door that sets one.
 */
export async function createAuthor(
  db: Db,
  name: string,
  email: string,
): Promise<{ authorId: string; authorKey: string } | null> {
  if (isReservedName(name)) return null;
  const authorKey = newAuthorKey();
  const authorId = await insertKeyedAuthor(db, { name, email, keyHash: hashToken(authorKey) });
  return authorId ? { authorId, authorKey } : null;
}

/** The collection as served: ids of entries that are gone dropped. */
export async function servedCollection(
  db: Q,
  collection: GalleryCollection,
): Promise<{ collection: GalleryCollection; entries: GalleryEntry[] }> {
  const entries = await liveEntries(db, collection.entryIds);
  return { collection: { ...collection, entryIds: entries.map((e) => e.id) }, entries };
}

/**
 * An author's live entries and collections, newest first — what the profile
 * page shows (#2314) and what My shares lists for an account (#2321). Three
 * queries however much the author has: their live entries, their collections,
 * and which of the collections' entries are still live.
 */
export async function authorWork(
  db: Q,
  authorId: string,
): Promise<{ entries: GalleryEntry[]; collections: GalleryCollection[] }> {
  const [entries, stored] = await Promise.all([entriesOfAuthor(db, authorId), collectionsOfAuthor(db, authorId)]);
  const named = [...new Set(stored.flatMap((c) => c.entryIds))];
  const live = new Set((await liveEntries(db, named)).map((e) => e.id));
  const collections = stored.map((c) => ({ ...c, entryIds: c.entryIds.filter((id) => live.has(id)) }));
  return { entries, collections };
}

/**
 * Check every id is the author's own live entry. Returns the error message
 * naming the first id that isn't, or null when all are. One query.
 */
export async function foreignEntry(db: Q, authorId: string, ids: string[]): Promise<string | null> {
  const live = new Map((await liveEntries(db, ids)).map((e) => [e.id, e]));
  for (const id of ids) {
    const e = live.get(id);
    if (!e) return `entry ${id} does not exist or was removed`;
    if (e.authorId !== authorId) return `entry ${id} is not one of yours`;
  }
  return null;
}
