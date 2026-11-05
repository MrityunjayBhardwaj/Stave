import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BlobNotFoundError, del, get, put } from "@vercel/blob";

// #2248 — where sealed shared projects live, keyed by share id. Server-only.
//
// Production is Vercel Blob (private: a blob can't be fetched without the store's
// token, so the only way in is our GET route, one id at a time). Off Vercel, in dev
// and the browser tests, a folder under the OS temp dir stands in, so a short link
// can be made and opened on a laptop without a cloud store. A production build with
// no Blob store configured has no store at all, and the routes answer 503 so the
// client falls back to the long link.
//
// #2311 — each share also has a private record, `shares/<id>.manage`, holding the
// SHA-256 of the manage token handed back once at creation. Holding the token is
// what lets the person who made the link revoke it. Links made before #2311 have
// no record and can't be revoked.

export interface ShareStore {
  /** Store new bytes under `id`. Returns false if the id is already taken. */
  put(id: string, bytes: Uint8Array): Promise<boolean>;
  /** The bytes stored under `id`, or null. */
  get(id: string): Promise<Uint8Array | null>;
  /** #2311 — store the manage token's hash beside the share. */
  putManageHash(id: string, hash: string): Promise<void>;
  /** The stored manage-token hash, or null (no such share, or made before #2311). */
  getManageHash(id: string): Promise<string | null>;
  /** Delete the share and its record. Deleting what isn't there is not an error. */
  remove(id: string): Promise<void>;
}

const blobPath = (id: string) => `shares/${id}`;
const managePath = (id: string) => `shares/${id}.manage`;

async function blobDel(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
}

export function hasBlobStore(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

const blobStore: ShareStore = {
  async put(id, bytes) {
    // `allowOverwrite: false` makes a taken id a thrown error, never an overwrite.
    // Ids are 64 random bits, so that throw means a real failure in practice; the
    // client falls back to the long link either way.
    await put(blobPath(id), Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/octet-stream",
    });
    return true;
  },
  async get(id) {
    // `useCache: false` — a revoked share must stop opening at once (#2311).
    const res = await get(blobPath(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  },
  async putManageHash(id, hash) {
    await put(managePath(id), hash, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain",
    });
  },
  async getManageHash(id) {
    const res = await get(managePath(id), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return (await new Response(res.stream).text()).trim() || null;
  },
  async remove(id) {
    // The project first: once it's gone the link is dead, whatever happens next.
    await blobDel(blobPath(id));
    await blobDel(managePath(id));
  },
};

const DEV_DIR = path.join(os.tmpdir(), "stave-share-dev");

const folderStore: ShareStore = {
  async put(id, bytes) {
    await mkdir(DEV_DIR, { recursive: true });
    try {
      await writeFile(path.join(DEV_DIR, id), bytes, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  },
  async get(id) {
    try {
      return new Uint8Array(await readFile(path.join(DEV_DIR, id)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async putManageHash(id, hash) {
    await mkdir(DEV_DIR, { recursive: true });
    await writeFile(path.join(DEV_DIR, `${id}.manage`), hash, { flag: "wx" });
  },
  async getManageHash(id) {
    try {
      return (await readFile(path.join(DEV_DIR, `${id}.manage`), "utf8")).trim() || null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async remove(id) {
    await rm(path.join(DEV_DIR, id), { force: true });
    await rm(path.join(DEV_DIR, `${id}.manage`), { force: true });
  },
};

/** The store for this deployment, or null when a production build has none. */
export function shareStore(): ShareStore | null {
  if (hasBlobStore()) return blobStore;
  if (process.env.NODE_ENV !== "production" || process.env.STAVE_SHARE_DEV_STORE === "1") {
    return folderStore;
  }
  return null;
}
