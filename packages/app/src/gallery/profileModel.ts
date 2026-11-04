/**
 * #2314 profiles and #2315 collections — the pure rules behind the views: who may
 * edit, what a profile or collection form sends, and how a collection's entry
 * list is reordered, added to and trimmed. No React, no fetch.
 */
import type { GalleryAuthor } from "./localShares";
import {
  MAX_AUTHOR_NAME_CHARS,
  MAX_BIO_CHARS,
  MAX_COLLECTION_DESCRIPTION_CHARS,
  MAX_COLLECTION_ENTRIES,
  MAX_COLLECTION_TITLE_CHARS,
  type AuthorUpdateRequest,
  type CollectionWriteRequest,
  type GalleryCollection,
  type GalleryEntry,
} from "./types";

/**
 * The key this browser can edit `authorId` with, or null. Only when the
 * remembered author IS this profile and a key is held.
 */
export function ownerKeyFor(author: GalleryAuthor | null, authorId: string): string | null {
  if (!author?.authorId || !author.authorKey) return null;
  return author.authorId === authorId ? author.authorKey : null;
}

/** Move the id at `index` by `delta` (−1 up, +1 down). Out of range: unchanged copy. */
export function moveEntry(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const out = [...ids];
  const to = index + delta;
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** Picked → dropped; not picked → added at the end (the order picked is the order kept). */
export function toggleEntry(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function removeEntry(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

export interface CollectionForm {
  title: string;
  description: string;
  entryIds: string[];
}

/**
 * The request, or everything wrong with the form. `ownIds` are the author's own
 * entries: the server refuses anyone else's, so they are dropped here (with a
 * note) rather than failing the save.
 */
export function buildCollectionRequest(
  form: CollectionForm,
  ownIds?: readonly string[],
): { request: CollectionWriteRequest; errors: [] } | { request: null; errors: string[] } {
  const errors: string[] = [];
  const title = form.title.trim();
  const description = form.description.trim();
  const seen = new Set<string>();
  const entryIds = form.entryIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return !ownIds || ownIds.includes(id);
  });
  if (!title) errors.push("Add a title.");
  else if (title.length > MAX_COLLECTION_TITLE_CHARS) errors.push(`The title can be at most ${MAX_COLLECTION_TITLE_CHARS} characters.`);
  if (description.length > MAX_COLLECTION_DESCRIPTION_CHARS) {
    errors.push(`The description can be at most ${MAX_COLLECTION_DESCRIPTION_CHARS} characters.`);
  }
  if (entryIds.length > MAX_COLLECTION_ENTRIES) errors.push(`A collection holds at most ${MAX_COLLECTION_ENTRIES} entries.`);
  if (errors.length) return { request: null, errors };
  return { request: { title, description, entryIds }, errors: [] };
}

export function buildProfileRequest(form: AuthorUpdateRequest):
  | { request: AuthorUpdateRequest; errors: [] }
  | { request: null; errors: string[] } {
  const errors: string[] = [];
  const name = form.name.trim();
  if (!name) errors.push("Add your name.");
  else if (name.length > MAX_AUTHOR_NAME_CHARS) errors.push(`Your name can be at most ${MAX_AUTHOR_NAME_CHARS} characters.`);
  if (form.bio.length > MAX_BIO_CHARS) errors.push(`The bio can be at most ${MAX_BIO_CHARS.toLocaleString("en")} characters.`);
  if (errors.length) return { request: null, errors };
  return { request: { name, bio: form.bio }, errors: [] };
}

/** A collection card's cover: its first entry with a picture, else null (a generated card). */
export function collectionCover(
  collection: Pick<GalleryCollection, "entryIds">,
  entries: readonly GalleryEntry[],
): GalleryEntry | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of collection.entryIds) {
    const e = byId.get(id);
    if (e?.hasThumbnail) return e;
  }
  return null;
}
