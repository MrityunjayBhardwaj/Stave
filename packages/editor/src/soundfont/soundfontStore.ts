/**
 * soundfontStore — where a user's uploaded `.sf2` bytes live (#2660).
 *
 * A `.sf2` is binary and runs from ~100 KB to tens of MB, so it must NOT live in
 * the Yjs CRDT project document — megabytes of base64 in a `Y.Text` would wreck
 * sync, undo and document size (the same reason the asset store exists, #1499).
 * Local-first storage belongs in IndexedDB; this is that store for soundfonts,
 * keyed by the font's name, independent of the collaborative document.
 *
 * It is the single source of truth the engine re-registration (#2661) reads from
 * on each boot: put / get / list / remove raw bytes, nothing more.
 *
 * ## Why it opens through `openIdbWithTimeout`
 *
 * A raw `indexedDB.open` can hang forever — blocked by another tab's older
 * connection, rejected in private mode, corrupted — which was the boot hang
 * (#685/#687). Five stores already route through the shared bounded opener; a
 * sixth that opened raw would reintroduce the exact failure the helper bounds.
 * Callers (the #2661 re-register) catch the rejection and degrade — no fonts —
 * rather than await indefinitely.
 *
 * ## Why keyed by name, not content hash
 *
 * Unlike the asset store (content-addressed, so two records can share bytes), a
 * soundfont is addressed by the name the user plays it as (`s("sf_<name>")`).
 * The store key is that name's slug, so a re-upload under the same name replaces
 * its own row — which is exactly what a boot re-register wants to find.
 */

import { committed, openIdbWithTimeout, requestResult as wrap } from '../idb'
import { sanitizeSoundfontName } from './registerUserSoundfont'

/**
 * The soundfont database's name, exported so nothing keeps a second copy.
 *
 * A test harness that wipes the store by literal string is a second owner of
 * this value: rename the database and the wipe silently stops wiping while every
 * test still passes on state inherited from the previous one (the asset store
 * learned this the hard way). Wipe by this constant, never a copy.
 */
export const SOUNDFONT_DB_NAME = 'stave-soundfonts'

const DB_NAME = SOUNDFONT_DB_NAME
const DB_VERSION = 1
const STORE_NAME = 'fonts'

/** A stored soundfont and what we know about it without parsing it. */
export interface StoredSoundfont {
  /** Sanitized name slug — the object store's key (the part after `sf_`). */
  readonly name: string
  /** The raw `.sf2` bytes. */
  readonly bytes: ArrayBuffer
  /** `bytes.byteLength`, denormalised so `listSoundfonts` need not carry the bytes. */
  readonly size: number
  /** When these bytes entered (or last replaced in) the store. */
  readonly storedAt: number
}

/** What `listSoundfonts` returns: every stored font, minus the bytes. */
export type StoredSoundfontMeta = Omit<StoredSoundfont, 'bytes'>

function openDb(): Promise<IDBDatabase> {
  return openIdbWithTimeout(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'name' })
    }
  })
}

/**
 * Store (or replace) a soundfont's bytes under its name slug.
 *
 * The name is sanitized to the same slug `registerUserSoundfont` keys the sound
 * under, so the store and the registry agree on what a font is called. A second
 * put of the same name replaces the row — re-upload semantics.
 *
 * Awaited to COMMIT, not to request success: a write the browser refuses for
 * space succeeds as a request first in Chromium (#1777), so this rejects with
 * `StorageFullError` and no caller records bytes that are not here.
 *
 * Returns the stored metadata (bytes omitted). Throws on an empty/invalid name
 * or empty bytes.
 */
export async function putSoundfont(
  name: string,
  bytes: Uint8Array,
): Promise<StoredSoundfontMeta> {
  const slug = sanitizeSoundfontName(name)
  if (!slug) {
    throw new Error(`soundfont name "${name}" has no usable characters (need a-z, 0-9, _ or -)`)
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(`soundfont "${slug}" is empty`)
  }
  // A fresh, exactly-sized ArrayBuffer copy: the caller's view may be a window
  // onto a larger/shared buffer, and IndexedDB would clone the whole thing.
  const copy = new Uint8Array(bytes)
  const record: StoredSoundfont = {
    name: slug,
    bytes: copy.buffer,
    size: copy.byteLength,
    storedAt: Date.now(),
  }
  const db = await openDb()
  try {
    await committed(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record),
    )
    const { name: n, size, storedAt } = record
    return { name: n, size, storedAt }
  } finally {
    db.close()
  }
}

/** Read a soundfont's bytes back by name. `null` when the store has none. */
export async function getSoundfont(name: string): Promise<Uint8Array | null> {
  const slug = sanitizeSoundfontName(name)
  if (!slug) return null
  const db = await openDb()
  try {
    const row = await wrap<StoredSoundfont | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(slug),
    )
    return row ? new Uint8Array(row.bytes) : null
  } finally {
    db.close()
  }
}

/** Drop a soundfont from the store by name. A no-op if it was never there. */
export async function deleteSoundfont(name: string): Promise<void> {
  const slug = sanitizeSoundfontName(name)
  if (!slug) return
  const db = await openDb()
  try {
    await committed(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(slug),
    )
  } finally {
    db.close()
  }
}

/** Every stored font's metadata, oldest first. The bytes are omitted. */
export async function listSoundfonts(): Promise<StoredSoundfontMeta[]> {
  const db = await openDb()
  try {
    const rows = await wrap<StoredSoundfont[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    )
    return rows
      .map(({ name, size, storedAt }) => ({ name, size, storedAt }))
      .sort((a, b) => a.storedAt - b.storedAt)
  } finally {
    db.close()
  }
}
