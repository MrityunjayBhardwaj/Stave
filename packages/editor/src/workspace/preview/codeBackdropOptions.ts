/**
 * codeBackdropOptions — the options the CODE gives the background viz.
 *
 * The background sketch's `stave.options` used to come only from the audio
 * bus payload (`inlineViz.backdropRequest.options`, the last evaluation's
 * capture). Stop withdraws that payload, and before the first Play there is
 * none, so the sketch fell back to its defaults even though the code still
 * said `{ theme: 'transparent', … }`. The app keeps these slots in step with
 * each pattern's code (read statically, dynamic values from the last
 * evaluation — see `resolveVizOptions`), and a background mount reads them in
 * preference to the payload.
 *
 * #2423 — keyed by the PATTERN file that declares them. A background belongs to
 * a file: a pattern's background takes that pattern's options, while a viz
 * file's own background takes none, even when both draw the same viz file.
 * The slot without a pattern key (`setCodeBackdropOptions(x)`) is the legacy
 * single slot, read by a background that does not say whose it is.
 */
export interface CodeBackdropOptions {
  /** the viz file the options belong to */
  readonly fileId: string
  readonly options: Readonly<Record<string, unknown>>
}

const LEGACY = ''
const slots = new Map<string, CodeBackdropOptions>()
const listeners = new Set<() => void>()
let version = 0

function sameOptions(a: CodeBackdropOptions | null, b: CodeBackdropOptions | null): boolean {
  if (a === b) return true
  if (!a || !b || a.fileId !== b.fileId) return false
  try {
    return JSON.stringify(a.options) === JSON.stringify(b.options)
  } catch {
    return false
  }
}

/** Set (or clear) the code's background options — for `patternFileId` when
 *  given, else the legacy single slot. Unchanged values notify nobody, so
 *  writing on every keystroke costs nothing downstream. */
export function setCodeBackdropOptions(next: CodeBackdropOptions | null, patternFileId?: string): void {
  const key = patternFileId ?? LEGACY
  if (sameOptions(slots.get(key) ?? null, next)) return
  if (next) slots.set(key, next)
  else slots.delete(key)
  version++
  for (const l of [...listeners]) l()
}

/** The options `patternFileId`'s code gives its background (legacy slot when omitted). */
export function getCodeBackdropOptions(patternFileId?: string): CodeBackdropOptions | null {
  return slots.get(patternFileId ?? LEGACY) ?? null
}

/** Changes on every write — a snapshot for `useSyncExternalStore`. */
export function getCodeBackdropOptionsVersion(): number {
  return version
}

export function subscribeCodeBackdropOptions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * #2423 — which options a background takes, by whose background it is.
 *
 * @param owner  the file whose background this is: a pattern file id (its code's
 *               options apply), `null` for a viz file's OWN background (its own
 *               settings: no code options, no bus options), or `undefined` when
 *               the host does not say (legacy: the single slot and the bus)
 * @returns `codeOptions` to apply (or null) and whether the bus payload's
 *          backdrop options may apply
 */
export function backdropOptionsFor(
  owner: string | null | undefined,
  vizFileId: string,
): { codeOptions: Readonly<Record<string, unknown>> | null; busOptions: boolean } {
  if (owner === null) return { codeOptions: null, busOptions: false }
  const slot = getCodeBackdropOptions(owner ?? undefined)
  const codeOptions = slot && slot.fileId === vizFileId ? slot.options : null
  // a named owner takes only what its own code says (its slot already folds in
  // the last evaluation's values); the bus carries whichever pattern played last
  return { codeOptions, busOptions: owner === undefined }
}
