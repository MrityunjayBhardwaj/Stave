/**
 * graphHash — a library graph's shape and the SHA-384 a `stave.libs.json` entry pins
 * (#2639, split out for #2640).
 *
 * Canonical form: modules sorted by absolute URL, each contributing
 * `url + "\n" + String(text.length) + "\n" + text + "\n"`, UTF-8 encoded, SHA-384,
 * base64 with no prefix. It covers every module, not only the entry, so a CDN that
 * changes a file the entry imports is caught too.
 *
 * Imports nothing: the loader (graph.ts) re-exports it, and the library cache uses it
 * to check what it reads back, in the worker and on the main thread alike.
 */

export type LibraryGraph = {
  /** Absolute URL of the entry module. */
  entry: string
  /** Absolute URL → source text, as fetched. */
  modules: Record<string, string>
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The canonical bytes {@link libraryGraphHash} digests (exported for tests and tools). */
export function libraryGraphBytes(graph: LibraryGraph): Uint8Array {
  const urls = Object.keys(graph.modules).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let s = ''
  for (const url of urls) {
    const text = graph.modules[url]
    s += `${url}\n${String(text.length)}\n${text}\n`
  }
  return new TextEncoder().encode(s)
}

/** base64 SHA-384 over the whole graph (canonical form in the header). */
export async function libraryGraphHash(graph: LibraryGraph): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-384', libraryGraphBytes(graph) as BufferSource)
  return toBase64(new Uint8Array(digest))
}
