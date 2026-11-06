/**
 * vizSourceChoice — the audio source picked in a viz file's ⚙ → Source (#2429).
 *
 * One value per viz file: which audio its previews listen to (`default` = the
 * most recent publisher, `none`, or a specific publisher such as a pattern file
 * or a built-in example sound). The viz chrome's dropdown writes and shows it;
 * the shell reads it to decide what the viz's OWN background listens to
 * (#2426, `backdropSourceFor`).
 *
 * Before this store the choice lived in the chrome's `useState`, so it reset to
 * `default` whenever the chrome remounted (a tab switch) or the page reloaded,
 * while the shell kept a second copy that could disagree. Now there is one copy,
 * mirrored in localStorage like `vizLiveToggle`.
 */

import type { AudioSourceRef } from '../types'

const STORAGE_PREFIX = 'stave:vizSource:'
const DEFAULT: AudioSourceRef = { kind: 'default' }

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    if (typeof window.localStorage?.getItem !== 'function') return null
    return window.localStorage
  } catch {
    return null
  }
}

const values = new Map<string, AudioSourceRef>()
const listeners = new Set<(fileId: string, ref: AudioSourceRef) => void>()

function keyFor(fileId: string): string {
  return `${STORAGE_PREFIX}${fileId}`
}

function parse(raw: string | null | undefined): AudioSourceRef {
  if (!raw) return DEFAULT
  try {
    const v = JSON.parse(raw) as Partial<AudioSourceRef> & { fileId?: unknown }
    if (v.kind === 'none') return { kind: 'none' }
    if (v.kind === 'file' && typeof v.fileId === 'string' && v.fileId) {
      return { kind: 'file', fileId: v.fileId }
    }
  } catch {
    // A malformed entry reads as the default rather than breaking the chrome.
  }
  return DEFAULT
}

function same(a: AudioSourceRef, b: AudioSourceRef): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== 'file' || (b.kind === 'file' && a.fileId === b.fileId)
}

/** The source chosen for this viz file; `default` when none was ever picked. */
export function getVizSourceChoice(fileId: string): AudioSourceRef {
  const cached = values.get(fileId)
  if (cached) return cached
  const ref = parse(safeLocalStorage()?.getItem(keyFor(fileId)))
  values.set(fileId, ref)
  return ref
}

export function setVizSourceChoice(fileId: string, ref: AudioSourceRef): void {
  if (same(getVizSourceChoice(fileId), ref)) return
  values.set(fileId, ref)
  const ls = safeLocalStorage()
  if (ref.kind === 'default') ls?.removeItem(keyFor(fileId))
  else ls?.setItem(keyFor(fileId), JSON.stringify(ref))
  for (const cb of Array.from(listeners)) cb(fileId, ref)
}

/** Called after any viz file's choice changes. Returns an unsubscribe. */
export function onVizSourceChoiceChange(
  cb: (fileId: string, ref: AudioSourceRef) => void,
): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Test-only: forget the in-memory cache (localStorage is the test's to clear). */
export function __resetVizSourceChoiceForTests(): void {
  values.clear()
  listeners.clear()
}
