import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BlobNotFoundError, del, get, list, put } from "@vercel/blob";

import type { GalleryAuthorProfile } from "../../../gallery/types";
import { hasBlobStore } from "../share/store";

// #2299 — where the community gallery lives. Server-only.
//
// It sits beside the short-share store (`../share/store.ts`) in the same Blob
// store, under its own `gallery/` prefix. Unlike shares, entries are plain and
// listable — but every blob is still PRIVATE, so the only way to read anything
// is through our routes, and the routes decide what is public:
//
//   gallery/entries/<id>.json      the public listing (GalleryEntry). Listed by prefix.
//   gallery/manifests/<id>.json    the project manifest (GalleryManifest)
//   gallery/private/<id>.json      { authorEmail, manageTokenHash } — never served
//   gallery/thumbnails/<id>        PNG or WebP bytes (type is read from the bytes)
//   gallery/reports/<id>/<t>-<r>.json   one GalleryReport per report
//   gallery/removed/<id>.json      the removed marker: GET answers 410 once it exists
//   gallery/authors/<authorId>.json          the public profile (GalleryAuthorProfile)
//   gallery/author-private/<authorId>.json   { authorEmail, authorKeyHash } — never served
//   gallery/author-keys/<keyHash>.json       { authorId } — which author a key belongs to
//   gallery/author-index/<authorId>/entries/<entryId>.json          an author's entries
//   gallery/author-index/<authorId>/collections/<collectionId>.json an author's collections
//   gallery/collections/<id>.json            one collection (GalleryCollection)
//   gallery/accounts/<accountHash>.json      #2319 GalleryAccountRecord — a signed-in account
//                                            and the author it is linked to. Never served.
//   gallery/author-accounts/<authorId>.json  #2319 { accountHash } — which account an author
//                                            belongs to. Never served.
//   gallery/account-links/<accountHash>/<shareId>.json  #2321 AccountLink — a private link
//                                            listed for its owner: id, name, date only, never
//                                            the key or the full link (#2329). Never public.
//   gallery/admin-log/<ms>-<hex>.json        #2331 AdminLogRecord — one per admin action.
//                                            Read by admins only (see admin.ts).
//
// #2320 — a profile merged into an account's profile keeps its JSON with
// `mergedInto: <authorId>` (StoredAuthorProfile); the author route answers
// `{ movedTo }` for it.
//
// The entry JSON is written LAST on publish, so a listing never shows an entry
// whose manifest isn't there yet; the removed marker is written FIRST on delete,
// so a half-finished delete still reads as removed.
//
// Off Vercel (dev and tests) a folder stands in, the same way the share store
// does: `STAVE_GALLERY_DEV_DIR`, or `stave-gallery-dev` under the OS temp dir. A
// production build with no Blob store has no gallery, and the routes answer 503.

export interface StoredBlob {
  pathname: string;
  /** ms since epoch */
  uploadedAt: number;
}

export interface GalleryBlobStore {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes stored at `pathname`, or null. */
  get(pathname: string): Promise<Uint8Array | null>;
  del(pathnames: string[]): Promise<void>;
  /** Every blob whose pathname starts with `prefix`. */
  list(prefix: string): Promise<StoredBlob[]>;
}

export const galleryPaths = {
  entriesPrefix: "gallery/entries/",
  entry: (id: string) => `gallery/entries/${id}.json`,
  manifest: (id: string) => `gallery/manifests/${id}.json`,
  privateRecord: (id: string) => `gallery/private/${id}.json`,
  thumbnail: (id: string) => `gallery/thumbnails/${id}`,
  reportsPrefix: "gallery/reports/",
  reportsOf: (id: string) => `gallery/reports/${id}/`,
  report: (id: string, name: string) => `gallery/reports/${id}/${name}.json`,
  removedPrefix: "gallery/removed/",
  removed: (id: string) => `gallery/removed/${id}.json`,

  // #2314 authors and #2315 collections (see authors.ts for the lifecycle).
  author: (authorId: string) => `gallery/authors/${authorId}.json`,
  authorPrivate: (authorId: string) => `gallery/author-private/${authorId}.json`,
  authorKey: (keyHash: string) => `gallery/author-keys/${keyHash}.json`,
  authorEntriesOf: (authorId: string) => `gallery/author-index/${authorId}/entries/`,
  authorEntry: (authorId: string, entryId: string) => `gallery/author-index/${authorId}/entries/${entryId}.json`,
  authorCollectionsOf: (authorId: string) => `gallery/author-index/${authorId}/collections/`,
  authorCollection: (authorId: string, collectionId: string) =>
    `gallery/author-index/${authorId}/collections/${collectionId}.json`,
  collection: (id: string) => `gallery/collections/${id}.json`,

  // #2319 sign-in accounts (see session.ts). The account hash is the SHA-256 of
  // `<provider>:<providerAccountId>`, so the store never holds a provider id in a path.
  account: (accountHash: string) => `gallery/accounts/${accountHash}.json`,
  authorAccount: (authorId: string) => `gallery/author-accounts/${authorId}.json`,

  // #2321 private links recorded on an account: one blob per link, so recording
  // and revoking never read-modify-write a shared list. Never served except to
  // the account itself (GET /api/gallery/me/shares).
  accountLinksOf: (accountHash: string) => `gallery/account-links/${accountHash}/`,
  accountLink: (accountHash: string, shareId: string) => `gallery/account-links/${accountHash}/${shareId}.json`,
};

const blobStore: GalleryBlobStore = {
  async put(pathname, bytes, contentType) {
    await put(pathname, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
  },
  async get(pathname) {
    // Skip the CDN cache: the removed marker and a deleted entry must be seen at
    // once, and every read here is already behind our own route's cache.
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  },
  async del(pathnames) {
    // One at a time, so a path that was never written (an entry with no
    // thumbnail) can't fail the rest; a missing blob is already deleted.
    for (const p of pathnames) {
      try {
        await del(p);
      } catch (err) {
        if (!(err instanceof BlobNotFoundError)) throw err;
      }
    }
  },
  async list(prefix) {
    const out: StoredBlob[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt).getTime() });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
};

function devDir(): string {
  return process.env.STAVE_GALLERY_DEV_DIR || path.join(os.tmpdir(), "stave-gallery-dev");
}

// Pathnames are built only from validated ids, but refuse to leave the folder anyway.
function devFile(pathname: string): string {
  const root = devDir();
  const file = path.resolve(root, pathname);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error("bad gallery path");
  return file;
}

async function walk(dir: string, rel: string, out: StoredBlob[]): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    const s = await stat(full);
    if (s.isDirectory()) await walk(full, relPath, out);
    else out.push({ pathname: relPath, uploadedAt: s.mtimeMs });
  }
}

const folderStore: GalleryBlobStore = {
  async put(pathname, bytes) {
    const file = devFile(pathname);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },
  async get(pathname) {
    try {
      return new Uint8Array(await readFile(devFile(pathname)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async del(pathnames) {
    await Promise.all(pathnames.map((p) => rm(devFile(p), { force: true })));
  },
  async list(prefix) {
    // Walk the folder the prefix points into, then filter by the full prefix.
    const dirPart = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    const out: StoredBlob[] = [];
    await walk(path.join(devDir(), dirPart), dirPart.replace(/\/$/, ""), out);
    return out.filter((b) => b.pathname.startsWith(prefix));
  },
};

/** The gallery store for this deployment, or null when a production build has none. */
export function galleryStore(): GalleryBlobStore | null {
  if (hasBlobStore()) return blobStore;
  if (process.env.NODE_ENV !== "production" || process.env.STAVE_SHARE_DEV_STORE === "1") {
    return folderStore;
  }
  return null;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

export async function putJson(store: GalleryBlobStore, pathname: string, value: unknown): Promise<void> {
  await store.put(pathname, new TextEncoder().encode(JSON.stringify(value)), "application/json");
}

export async function getJson<T>(store: GalleryBlobStore, pathname: string): Promise<T | null> {
  const bytes = await store.get(pathname);
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** The record kept beside each entry. Never served. */
export interface PrivateRecord {
  authorEmail: string;
  /** SHA-256 of the manage token, hex. */
  manageTokenHash: string;
}

/** The record kept beside each author (#2314). Never served. */
export interface PrivateAuthorRecord {
  authorEmail: string;
  /**
   * SHA-256 of the author key, hex. Absent on an author made for a signed-in
   * account (#2319): it has no key, only the session.
   */
  authorKeyHash?: string;
}

/** `gallery/author-keys/<sha256 of key>.json` — finds the author a key belongs to. Never served. */
export interface AuthorKeyPointer {
  authorId: string;
}

/**
 * `gallery/authors/<authorId>.json` as stored. #2320 — `mergedInto` marks a
 * profile retired by a claim: everything it had now lives on that author.
 * Never served as-is; the author route sends only the public fields.
 */
export interface StoredAuthorProfile extends GalleryAuthorProfile {
  mergedInto?: string;
}

export interface RemovedMarker {
  removedAt: number;
  by: "author" | "admin";
}
