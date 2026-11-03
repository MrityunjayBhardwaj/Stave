/**
 * useDeferredPerText — an expensive answer about a pattern's text, kept per text and, when
 * it is not kept yet, worked out once the typing pauses (#1834).
 *
 * The tree grid and the tree roll read 24 bars of a pattern to find where it repeats:
 * MEASURED over the corpus patterns with no column model, median 1.8 ms but worst 582 ms.
 * Every keystroke in such a pattern is a new text, so asking during render froze typing
 * for that long on every key. Here a text already answered is answered at once; a new one
 * is asked `delayMs` after the last change, and until then the last answer stays drawn
 * (both views are look-only, so a picture one keystroke old changes nothing).
 */
import * as React from 'react'

/** a function of a text, its answers kept for the last `keep` texts */
export interface PerText<T> {
  (text: string): T
  /** the kept answer, without working one out */
  cached(text: string): T | undefined
}

export function perText<T>(fn: (text: string) => T, keep = 16): PerText<T> {
  const kept = new Map<string, T>()
  const f = ((text: string): T => {
    if (kept.has(text)) return kept.get(text)!
    const out = fn(text)
    kept.set(text, out)
    if (kept.size > keep) kept.delete(kept.keys().next().value!)
    return out
  }) as PerText<T>
  f.cached = (text) => kept.get(text)
  return f
}

/** how long the text must stay unchanged before a new one is asked */
export const DEFER_MS = 250

export function useDeferredPerText<T>(text: string | null, f: PerText<T>, delayMs = DEFER_MS): T | null {
  const [last, setLast] = React.useState<{ text: string; value: T } | null>(null)
  const kept = text === null ? undefined : f.cached(text)
  React.useEffect(() => {
    if (text === null || kept !== undefined) return
    const id = setTimeout(() => setLast({ text, value: f(text) }), delayMs)
    return () => clearTimeout(id)
  }, [text, kept, f, delayMs])
  if (text === null) return null
  if (kept !== undefined) return kept
  return last?.value ?? null
}
