import { readdir } from "node:fs/promises";
import path from "node:path";

// #2363 — what the gallery's dev folder store holds, as Blob keys. Blob keeps
// only each entry's CONTENT (store.ts): its manifest and its thumbnail. Every
// record lives in Postgres. Tests use these to check that no record is written
// to Blob (the old mirror of entries, private records, author indexes, removed
// markers, reports and profiles).

/** Every key under `dir`, sorted. Dev's PGlite database (`pglite/` and its `pglite.lock`, db/client.ts) is not Blob: skipped. */
export async function blobKeys(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    let items;
    try {
      items = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const item of items) {
      const key = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (key !== "pglite") await walk(path.join(abs, item.name), key);
      } else if (key !== "pglite.lock") out.push(key);
    }
  }
  await walk(dir, "");
  return out.sort();
}

const CONTENT_KEY = /^gallery\/(manifests\/[^/]+\.json|thumbnails\/[^/]+)$/;

/** The keys that are NOT an entry's manifest or thumbnail. Should always be empty. */
export function recordKeys(keys: string[]): string[] {
  return keys.filter((k) => !CONTENT_KEY.test(k));
}
