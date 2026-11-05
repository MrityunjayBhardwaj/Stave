import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BlobNotFoundError, del, get, put } from "@vercel/blob";

import { hasBlobStore } from "../share/store";

// #2299 — where the community gallery's CONTENT lives. Server-only.
//
// It sits beside the short-share store (`../share/store.ts`) in the same Blob
// store, under its own `gallery/` prefix. Every blob is PRIVATE, so the only way
// to read one is through our routes, and the routes decide what is public.
//
// #2352 / #2363 — the gallery's RECORDS (entries and the listing, authors,
// collections, reports, the admin log, account links, rate limits) live in
// Postgres (src/db/). Blob holds only each entry's files, keyed by the entry id:
//
//   gallery/manifests/<id>.json    the project manifest (GalleryManifest)
//   gallery/thumbnails/<id>        PNG or WebP bytes (type is read from the bytes)
//
// Written and deleted only by entryFiles.ts, in its order relative to the row.
//
// Off Vercel (dev and tests) a folder stands in, the same way the share store
// does: `STAVE_GALLERY_DEV_DIR`, or `stave-gallery-dev` under the OS temp dir
// (dev's PGlite database keeps its own `pglite` folder in there too; db/client.ts).
// A production build with no Blob store has no gallery, and the routes answer 503.

export interface GalleryBlobStore {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes stored at `pathname`, or null. */
  get(pathname: string): Promise<Uint8Array | null>;
  del(pathnames: string[]): Promise<void>;
}

export const galleryPaths = {
  manifest: (id: string) => `gallery/manifests/${id}.json`,
  thumbnail: (id: string) => `gallery/thumbnails/${id}`,
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
    // Skip the CDN cache: a deleted entry's files must be gone at once, and every
    // read here is already behind our own route's cache.
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
