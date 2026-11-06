/**
 * codeBackdropOptions — the options the CODE gives the background viz.
 *
 * The background sketch's `stave.options` used to come only from the audio
 * bus payload (`inlineViz.backdropRequest.options`, the last evaluation's
 * capture). Stop withdraws that payload, and before the first Play there is
 * none, so the sketch fell back to its defaults even though the code still
 * said `{ theme: 'transparent', … }`. The app keeps this slot in step with the
 * active pattern's code (read statically, dynamic values from the last
 * evaluation — see `resolveVizOptions`), and a background mount reads it in
 * preference to the payload.
 *
 * One slot, not a map: one pattern's code is active at a time, and the slot
 * names the viz FILE it is for, so a background showing a different file
 * ignores it and keeps the payload's options.
 */
export interface CodeBackdropOptions {
  /** the viz file the options belong to */
  readonly fileId: string
  readonly options: Readonly<Record<string, unknown>>
}

let current: CodeBackdropOptions | null = null
const listeners = new Set<() => void>()

function sameOptions(a: CodeBackdropOptions | null, b: CodeBackdropOptions | null): boolean {
  if (a === b) return true
  if (!a || !b || a.fileId !== b.fileId) return false
  try {
    return JSON.stringify(a.options) === JSON.stringify(b.options)
  } catch {
    return false
  }
}

/** Set (or clear) the code's background options. Unchanged values notify nobody,
 *  so writing on every keystroke costs nothing downstream. */
export function setCodeBackdropOptions(next: CodeBackdropOptions | null): void {
  if (sameOptions(current, next)) return
  current = next
  for (const l of [...listeners]) l()
}

export function getCodeBackdropOptions(): CodeBackdropOptions | null {
  return current
}

export function subscribeCodeBackdropOptions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
