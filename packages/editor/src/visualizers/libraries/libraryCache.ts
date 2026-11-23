/**
 * libraryCache — a sketch's declared libraries, kept on this device by hash (#2640).
 *
 * A declared library (`stave.libs.json`, #2639) is pinned by the SHA-384 of its
 * module graph. That hash is all the cache needs: the loader asks for the graph by
 * the hash the project DECLARED, before touching the network. On a hit the graph is
 * hashed again and served only if it still matches, so a sketch plays offline and
 * never runs bytes nobody vouched for. On a miss the loader fetches, checks the
 * hash, and hands the graph here to keep.
 *
 * ## What a graph is, and how it is hashed
 *
 * `{ entry, modules }`: every module's source text keyed by its absolute URL, before
 * any rewriting. The hash covers the modules sorted by URL, each contributing
 * `url + "\n" + String(text.length) + "\n" + text + "\n"`, encoded as UTF-8, SHA-384,
 * base64 with no prefix. The length makes the encoding unambiguous: no choice of
 * texts can make two different graphs produce the same bytes. This is the same
 * function the loader verifies a download with, so a graph that loads from the
 * network and one that loads from here are checked by one rule.
 *
 * ## Never in the sketch's way
 *
 * Works in a dedicated worker and on the main thread (IndexedDB and `crypto.subtle`
 * are in both). Nothing here throws to the caller:
 * - IndexedDB missing, refused, or slow to open → the cache is off for this page,
 *   said once in the console, and every lookup is a miss.
 * - A write refused for space → said once; the library still loads from the network.
 *   Writes wait for their transaction through `transactionDone`, like every other
 *   store, so a refusal for space also reaches the app's storage notice (#1779).
 * - An entry that is unreadable, misshapen or fails its hash → deleted, and a miss.
 *
 * ## What stays, and why
 *
 * Least recently used first, past {@link LIBRARY_CACHE_MAX_BYTES} in total, and
 * anything unused for {@link LIBRARY_CACHE_MAX_AGE_MS}. The cache shares the origin's
 * storage with the user's own projects and sounds, so it takes a small share of the
 * smallest quota measured: 1,048,576,000 bytes in WebKit 26.4, against 1,604,618,271
 * in Chromium 147 and 10,737,418,240 in Firefox 148 (`navigator.storage.estimate()`
 * on a fresh localhost page, Playwright 1.59.1, 2026-11-23). 100 MiB is 10% of
 * WebKit's, and holds about 35 graphs the size of Spark 2.4.0 from esm.sh
 * (2,804,136 characters).
 */

import { isQuotaError, openIdbWithTimeout, transactionDone } from '../../idb'

/** A library's module graph, unrewritten: source text by absolute URL. */
export type LibraryGraph = { entry: string; modules: Record<string, string> }

export const LIBRARY_CACHE_DB = 'stave-library-cache'
/** Total size kept, in canonical UTF-8 bytes. See the module note for the number. */
export const LIBRARY_CACHE_MAX_BYTES = 100 * 1024 * 1024
/** A library not used for this long is dropped even when there is room. */
export const LIBRARY_CACHE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000
/**
 * How long opening the database may take before the cache gives up for the page.
 * Shorter than the app's 8 s: a sketch waits on this, and the network is the fallback.
 */
export const LIBRARY_CACHE_OPEN_TIMEOUT_MS = 3_000

const GRAPHS = 'graphs'
const META = 'meta'

interface MetaRecord {
  readonly sha384: string
  readonly bytes: number
  readonly lastUsed: number
}

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/** The bytes a graph's hash is taken over. See the module note. */
export function canonicalGraphBytes(graph: LibraryGraph): Uint8Array {
  const urls = Object.keys(graph.modules).sort()
  let s = ''
  for (const url of urls) {
    const text = graph.modules[url]
    s += url + '\n' + String(text.length) + '\n' + text + '\n'
  }
  return new TextEncoder().encode(s)
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** SHA-384 of a graph's canonical bytes, base64, no `sha384-` prefix. */
export async function libraryGraphHash(graph: LibraryGraph): Promise<string> {
  return hashBytes(canonicalGraphBytes(graph))
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-384', bytes as BufferSource)))
}

/** Whether a value read back is shaped like a graph whose entry is one of its modules. */
export function isLibraryGraph(value: unknown): value is LibraryGraph {
  if (typeof value !== 'object' || value === null) return false
  const { entry, modules } = value as { entry?: unknown; modules?: unknown }
  if (typeof entry !== 'string' || typeof modules !== 'object' || modules === null) return false
  if (Array.isArray(modules)) return false
  const values = Object.values(modules as Record<string, unknown>)
  if (values.length === 0 || !values.every((t) => typeof t === 'string')) return false
  return Object.prototype.hasOwnProperty.call(modules, entry)
}

/**
 * Which entries to drop so the rest fit: newest use first, kept while the total stays
 * within `maxBytes` and each was used within `maxAgeMs`. `keep` is never dropped (the
 * graph just stored) and counts toward the total first.
 */
export function chooseEvictions(
  entries: readonly MetaRecord[],
  opts: { maxBytes: number; maxAgeMs: number; now: number; keep?: string },
): string[] {
  const drop: string[] = []
  let total = 0
  const kept = entries.find((e) => e.sha384 === opts.keep)
  if (kept) total += kept.bytes
  const rest = entries.filter((e) => e.sha384 !== opts.keep).sort((a, b) => b.lastUsed - a.lastUsed)
  for (const e of rest) {
    if (opts.now - e.lastUsed > opts.maxAgeMs || total + e.bytes > opts.maxBytes) {
      drop.push(e.sha384)
      continue
    }
    total += e.bytes
  }
  return drop
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface LibraryCacheOptions {
  readonly dbName?: string
  readonly maxBytes?: number
  readonly maxAgeMs?: number
  readonly openTimeoutMs?: number
  readonly now?: () => number
  /** Where the once-only notices go. */
  readonly warn?: (message: string) => void
}

export interface LibraryCache {
  /** The graph stored under this hash, verified; null on any miss. Never throws. */
  getGraph(sha384: string): Promise<LibraryGraph | null>
  /** Keep a graph under its hash. Refuses one that does not hash to it. Never throws. */
  putGraph(sha384: string, graph: LibraryGraph): Promise<void>
}

function read<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('library-cache: request failed'))
  })
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const { name, message } = err as { name?: unknown; message?: unknown }
    return [name, message].filter((x) => typeof x === 'string' && x).join(': ') || String(err)
  }
  return String(err)
}

export function createLibraryCache(opts: LibraryCacheOptions = {}): LibraryCache {
  const dbName = opts.dbName ?? LIBRARY_CACHE_DB
  const maxBytes = opts.maxBytes ?? LIBRARY_CACHE_MAX_BYTES
  const maxAgeMs = opts.maxAgeMs ?? LIBRARY_CACHE_MAX_AGE_MS
  const openTimeoutMs = opts.openTimeoutMs ?? LIBRARY_CACHE_OPEN_TIMEOUT_MS
  const now = opts.now ?? (() => Date.now())
  const warn = opts.warn ?? ((m: string) => console.warn(m))

  let dbPromise: Promise<IDBDatabase | null> | null = null
  let saidOff = false
  let saidFull = false

  const off = (why: string): null => {
    if (!saidOff) {
      saidOff = true
      warn(`[stave] Libraries can't be kept on this device (${why}), so each one loads from the network.`)
    }
    return null
  }

  function open(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise
    dbPromise = (async () => {
      try {
        // Inside the try: in an opaque origin even reading `indexedDB` can throw.
        if (typeof indexedDB === 'undefined') return off('no IndexedDB here')
        if (typeof crypto === 'undefined' || !crypto.subtle) return off('no crypto.subtle here')
        const db = await openIdbWithTimeout(
          dbName,
          1,
          (d) => {
            if (!d.objectStoreNames.contains(GRAPHS)) d.createObjectStore(GRAPHS)
            if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'sha384' })
          },
          { timeoutMs: openTimeoutMs },
        )
        // Another page deleting or upgrading the database: let go, and open afresh next time.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        return db
      } catch (err) {
        return off(errorText(err))
      }
    })()
    return dbPromise
  }

  async function remove(db: IDBDatabase, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    const tx = db.transaction([GRAPHS, META], 'readwrite')
    for (const k of keys) {
      tx.objectStore(GRAPHS).delete(k)
      tx.objectStore(META).delete(k)
    }
    await transactionDone(tx)
  }

  async function getGraph(sha384: string): Promise<LibraryGraph | null> {
    const db = await open()
    if (!db) return null
    let value: unknown
    try {
      value = await read(db.transaction(GRAPHS, 'readonly').objectStore(GRAPHS).get(sha384))
    } catch (err) {
      warn(`[stave] A kept library couldn't be read (${errorText(err)}); loading it from the network.`)
      await remove(db, [sha384]).catch(() => {})
      return null
    }
    if (value === undefined) return null
    let ok = false
    let bytes = 0
    try {
      if (isLibraryGraph(value)) {
        const canonical = canonicalGraphBytes(value)
        bytes = canonical.byteLength
        ok = (await hashBytes(canonical)) === sha384
      }
    } catch {
      ok = false
    }
    if (!ok) {
      warn(`[stave] A kept library didn't match its hash ${sha384.slice(0, 12)}…; it was removed and will load from the network.`)
      await remove(db, [sha384]).catch(() => {})
      return null
    }
    const graph = value as LibraryGraph
    // Mark it used. Only the small record is rewritten, never the graph.
    try {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put({ sha384, bytes, lastUsed: now() } satisfies MetaRecord)
      await transactionDone(tx)
    } catch {
      /* a use not recorded only makes this entry look older */
    }
    return { entry: graph.entry, modules: graph.modules }
  }

  async function putGraph(sha384: string, graph: LibraryGraph): Promise<void> {
    const db = await open()
    if (!db) return
    try {
      if (!isLibraryGraph(graph)) throw new Error('not a library graph')
      const bytes = canonicalGraphBytes(graph)
      const digest = await hashBytes(bytes)
      if (digest !== sha384) {
        warn(`[stave] A library wasn't kept: its graph hashes to ${digest.slice(0, 12)}…, not ${sha384.slice(0, 12)}….`)
        return
      }
      const tx = db.transaction([GRAPHS, META], 'readwrite')
      tx.objectStore(GRAPHS).put({ entry: graph.entry, modules: graph.modules }, sha384)
      tx.objectStore(META).put({ sha384, bytes: bytes.byteLength, lastUsed: now() } satisfies MetaRecord)
      await transactionDone(tx)
    } catch (err) {
      // Once Firefox has refused a write for space, it refuses later writes on the same
      // database with InvalidStateError instead (measured, Firefox 148). It is still
      // the same full disk, already reported, so later failures stay quiet.
      if (isQuotaError(err) || saidFull) {
        if (!saidFull) {
          saidFull = true
          warn("[stave] This device's storage is full, so a library wasn't kept; it will load from the network.")
        }
      } else {
        warn(`[stave] A library wasn't kept (${errorText(err)}).`)
      }
      return
    }
    try {
      const all = (await read(db.transaction(META, 'readonly').objectStore(META).getAll())) as MetaRecord[]
      await remove(db, chooseEvictions(all, { maxBytes, maxAgeMs, now: now(), keep: sha384 }))
    } catch {
      /* eviction is retried on the next store */
    }
  }

  // The bodies already catch what they expect; this is the promise to the sketch that
  // nothing unexpected reaches it either.
  return {
    getGraph: (sha384) =>
      getGraph(sha384).catch((err) => {
        warn(`[stave] Library cache lookup failed (${errorText(err)}); loading from the network.`)
        return null
      }),
    putGraph: (sha384, graph) =>
      putGraph(sha384, graph).catch((err) => {
        warn(`[stave] A library wasn't kept (${errorText(err)}).`)
      }),
  }
}

let shared: LibraryCache | null = null
const instance = (): LibraryCache => (shared ??= createLibraryCache())

/** The graph kept under this declared SHA-384, verified; null on any miss. Never throws. */
export function getGraph(sha384: string): Promise<LibraryGraph | null> {
  return instance().getGraph(sha384)
}

/** Keep a verified graph under its SHA-384. Never throws. */
export function putGraph(sha384: string, graph: LibraryGraph): Promise<void> {
  return instance().putGraph(sha384, graph)
}
