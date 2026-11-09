/**
 * Which extensions are switched on (#2509). Per user, in this browser: decided on #2507.
 *
 * A project never stores which extensions it needs; that is worked out from what it uses
 * (#2512). This store is only the person's own switches. It follows the editor's other
 * settings (`editorRegistry.ts`): localStorage under a `stave:` key, read on demand, with
 * subscribers told about every change made in this page.
 *
 * Stored as a sorted JSON array of ids. Anything unreadable reads as "nothing switched
 * on", which is the state Stave was in before extensions existed.
 */
const STORAGE = 'stave:extensions'

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    if (typeof window.localStorage?.getItem !== 'function') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Switches that could not be saved (storage full or blocked): they hold for this page only. */
const unsaved = new Map<string, boolean>()

function read(): Set<string> {
  let ids: Set<string>
  try {
    const raw = storage()?.getItem(STORAGE)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    ids = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    ids = new Set()
  }
  for (const [id, on] of unsaved) {
    if (on) ids.add(id)
    else ids.delete(id)
  }
  return ids
}

const listeners = new Set<(ids: ReadonlySet<string>) => void>()

/** The ids switched on, read from storage now. */
export function enabledExtensionIds(): ReadonlySet<string> {
  return read()
}

export function isExtensionEnabled(id: string): boolean {
  return read().has(id)
}

/** Switch one extension on or off. Subscribers hear about it only if something changed. */
export function setExtensionEnabled(id: string, on: boolean): void {
  const ids = read()
  if (ids.has(id) === on) return
  if (on) ids.add(id)
  else ids.delete(id)
  const ls = storage()
  try {
    if (!ls) throw new Error('no storage')
    // `ids` already carries any earlier unsaved switches, so a save that works saves them too.
    ls.setItem(STORAGE, JSON.stringify([...ids].sort()))
    unsaved.clear()
  } catch {
    // Storage full or blocked: the switch holds for this page, and a reload forgets it.
    unsaved.set(id, on)
  }
  for (const fn of [...listeners]) fn(ids)
}

/** Hear about every switch made in this page. Returns the unsubscribe. */
export function onExtensionsEnabledChange(fn: (ids: ReadonlySet<string>) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
