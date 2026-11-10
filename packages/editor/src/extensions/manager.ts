/**
 * Switching extensions on and off (#2509), part by part (#2538).
 *
 * The manager owns which extensions are active right now in this page, and which of their
 * language parts. It loads an extension's code when its common part is switched on,
 * activates each part through its own recording host, and on switch-off undoes exactly
 * what each host recorded. It does not decide WHEN: the page runtime (`runtime.ts`) does,
 * from the person's switches (`enablement.ts`) and from which language runtimes have
 * started. How a language part gets its host (Strudel's registries) and what runs before
 * it (Strudel's worklets) is handed in as a `PartDriver`, so nothing here names a
 * language's registries.
 *
 * Two levels:
 *  - the COMMON part (`activate`/`deactivate`): loads the code, refuses a language part
 *    the manifest does not declare, and runs `module.activate` if there is one. An
 *    extension "is active" when its common part is.
 *  - a LANGUAGE part (`activatePart`): only for an active extension, only if its module
 *    has that part. A part that fails leaves the common part on.
 *
 * Guarantees, each pinned by a test, at both levels (they share one set of rules, `slots`):
 *  - switching on twice registers once (a second call joins the first);
 *  - an activation that throws leaves nothing behind, and the error reaches the caller;
 *  - switching off while it is still loading wins: when the load finishes it is undone;
 *  - switching back on right after waits for the cancelled run to give its names back;
 *  - switching off returns the undo errors instead of throwing, so every undo runs;
 *  - switching off undoes the language parts first, newest first, then the common part.
 *
 * Read when the list is given (construction), refused there: two manifests with one id,
 * and a `provides` key that is not one of the manifest's languages listed by name.
 */
import { createCommonHost, type PartRecording } from './host'
import type { ExtensionLanguage, ExtensionManifest, ExtensionModule, StrudelHost, StrudelPart } from './types'

/** The language parts the module contract has (`ExtensionModule`'s keys besides `activate`). */
export type PartLanguage = keyof Omit<ExtensionModule, 'activate'> & ExtensionLanguage

/** A language part's code, by language. */
export interface PartOf {
  strudel: StrudelPart
}
/** A language part's host, by language. */
export interface HostOf {
  strudel: StrudelHost
}

/** What a part's record may also hold: its `onPrepare` callbacks (Strudel's do). */
type Recording = PartRecording<unknown> & { preparers?(): readonly (() => unknown)[] }

/** How one language's parts switch on: given by whoever owns that language's runtime. */
export interface PartDriver<L extends PartLanguage> {
  /** Runs before the part's `activate` (Strudel: its worklets). A throw stops it with nothing registered. */
  before?(manifest: ExtensionManifest, part: PartOf[L]): Promise<void>
  /** A fresh recording host for the part. */
  record(manifest: ExtensionManifest): PartRecording<HostOf[L]> & { preparers?(): readonly (() => unknown)[] }
}

export interface ExtensionManager {
  /** the manifests it was given, by id */
  manifest(id: string): ExtensionManifest | undefined
  /** is the extension (its common part) on? */
  isActive(id: string): boolean
  /** the active extensions, in the order they switched on */
  activeIds(): string[]
  /** is this language part of the extension on? */
  isPartActive(id: string, language: PartLanguage): boolean
  /**
   * Load and activate the common part. Resolves when active; rejects (leaving nothing) if
   * it failed, including when the module has a language part its manifest does not declare.
   */
  activate(id: string): Promise<void>
  /**
   * Activate one language part of an active extension. Resolves at once if the module has
   * no such part; rejects (leaving that part off, the rest as it was) if it failed.
   */
  activatePart(id: string, language: PartLanguage): Promise<void>
  /**
   * Switch the whole extension off: its language parts (newest first), then its common
   * part. Returns the errors of any undo step that threw.
   */
  deactivate(id: string): unknown[]
  /**
   * Make the active set equal `ids`: switch off the rest, then switch on the missing
   * (common parts only). An id with no manifest (an extension Stave no longer ships,
   * still saved as on) is skipped and listed in `unknown`, not reported as a failure on
   * every start.
   */
  sync(ids: ReadonlySet<string>): Promise<{ failed: { id: string; error: unknown }[]; unknown: string[] }>
  /** The `onPrepare` callbacks of every active part (#2510), with whose they are. */
  preparers(): { id: string; run: () => unknown }[]
}

/** Every part language the module contract knows, for the "declared?" check at load. */
const PART_LANGUAGES: readonly PartLanguage[] = ['strudel']

/**
 * Is `language` one the manifest lists by name? `'*'` means the editor as a whole and
 * covers no language part: an extension that adds to a language must say which.
 */
function declares(m: ExtensionManifest, language: string): boolean {
  return m.languages !== '*' && (m.languages as readonly string[]).includes(language)
}

/**
 * One set of switch-on/off rules, for any key (an extension's common part, or one of its
 * language parts). `run` returns the record to keep, or null when it was cancelled.
 */
function slots() {
  const active = new Map<string, Recording>()
  const pending = new Map<string, { promise: Promise<void>; cancelled: boolean }>()
  return {
    active,
    pending,
    on(key: string, run: (ticket: { cancelled: boolean }) => Promise<Recording | null>): Promise<void> {
      if (active.has(key)) return Promise.resolve()
      const inFlight = pending.get(key)
      if (inFlight && !inFlight.cancelled) return inFlight.promise
      const ticket = { cancelled: false, promise: Promise.resolve() }
      // A cancelled run still in flight may be mid-activation, holding names it is about to
      // give back. Start only after it has settled, or this run would find them taken.
      const after = inFlight ? inFlight.promise.catch(() => undefined) : Promise.resolve()
      ticket.promise = after
        .then(async () => {
          const rec = await run(ticket)
          if (rec) active.set(key, rec)
        })
        .finally(() => {
          if (pending.get(key) === ticket) pending.delete(key)
        })
      pending.set(key, ticket)
      return ticket.promise
    },
    off(key: string): unknown[] {
      const inFlight = pending.get(key)
      if (inFlight) inFlight.cancelled = true
      const rec = active.get(key)
      if (!rec) return []
      active.delete(key)
      return rec.undo()
    },
  }
}

/**
 * Activate through `rec`. A throw undoes what it registered and rethrows (the cleanup's own
 * failures ride on the error as `undoErrors`, so whoever reports it can say so). Cancelled
 * meanwhile: undone, and null.
 */
async function activateThrough<R extends Recording>(rec: R, activate: () => unknown, ticket: { cancelled: boolean }): Promise<R | null> {
  try {
    await activate()
  } catch (e) {
    const undoErrors = rec.undo()
    if (undoErrors.length && typeof e === 'object' && e !== null) (e as { undoErrors?: unknown[] }).undoErrors = undoErrors
    throw e
  }
  if (ticket.cancelled) {
    rec.undo()
    return null
  }
  return rec
}

export function createExtensionManager(opts: {
  manifests: readonly ExtensionManifest[]
  /** How each language's parts switch on. A language with no driver never switches on a part. */
  parts?: { [L in PartLanguage]?: PartDriver<L> }
}): ExtensionManager {
  const byId = new Map<string, ExtensionManifest>()
  for (const m of opts.manifests) {
    if (byId.has(m.id)) throw new Error(`Two extensions share the id "${m.id}".`)
    for (const language of Object.keys(m.provides ?? {})) {
      if (!declares(m, language)) {
        throw new Error(
          `The ${m.id} extension says what it provides for ${language}, but ${language} is not one of the languages it lists.`,
        )
      }
    }
    byId.set(m.id, m)
  }

  const common = slots()
  const parts = slots()
  /** the module each active extension was loaded as, for its language parts */
  const modules = new Map<string, ExtensionModule>()
  const partKey = (id: string, language: PartLanguage) => `${id}\u0000${language}`
  const partsOf = (id: string) => [...new Set([...parts.active.keys(), ...parts.pending.keys()])].filter((k) => k.startsWith(`${id}\u0000`))

  const manager: ExtensionManager = {
    manifest: (id) => byId.get(id),
    isActive: (id) => common.active.has(id),
    activeIds: () => [...common.active.keys()],
    isPartActive: (id, language) => parts.active.has(partKey(id, language)),

    activate(id) {
      const m = byId.get(id)
      if (!m) return Promise.reject(new Error(`There is no extension called "${id}".`))
      return common.on(id, async (ticket) => {
        const mod = await m.load()
        if (ticket.cancelled) return null
        for (const language of PART_LANGUAGES) {
          if (mod[language] && !declares(m, language)) {
            throw new Error(`it has a ${language} part, but ${language} is not one of the languages it lists`)
          }
        }
        const rec = createCommonHost(m.id)
        const kept = await activateThrough(rec, () => mod.activate?.(rec.host), ticket)
        if (kept) modules.set(id, mod)
        return kept
      })
    },

    activatePart(id, language) {
      const m = byId.get(id)
      const mod = modules.get(id)
      // `modules` holds exactly the extensions whose common part is on
      if (!m || !mod) {
        return Promise.reject(new Error(`The ${id} extension is not switched on, so its ${language} part cannot be.`))
      }
      const part = mod[language]
      const driver = opts.parts?.[language]
      if (!part || !driver) return Promise.resolve()
      return parts.on(partKey(id, language), async (ticket) => {
        await driver.before?.(m, part)
        if (ticket.cancelled) return null
        const rec = driver.record(m)
        return activateThrough(rec, () => part.activate(rec.host), ticket)
      })
    },

    deactivate(id) {
      const errors: unknown[] = []
      // language parts first, newest first; a part still loading is cancelled
      for (const key of partsOf(id).reverse()) errors.push(...parts.off(key))
      errors.push(...common.off(id))
      modules.delete(id)
      return errors
    },

    async sync(ids) {
      for (const id of [...common.active.keys(), ...common.pending.keys()]) if (!ids.has(id)) manager.deactivate(id)
      const failed: { id: string; error: unknown }[] = []
      const unknown = [...ids].filter((id) => !byId.has(id))
      await Promise.all(
        [...ids].filter((id) => byId.has(id)).map((id) =>
          manager.activate(id).catch((error: unknown) => {
            failed.push({ id, error })
          }),
        ),
      )
      return { failed, unknown }
    },

    preparers() {
      const out: { id: string; run: () => unknown }[] = []
      for (const [key, rec] of parts.active) {
        const id = key.slice(0, key.indexOf('\u0000'))
        for (const run of rec.preparers?.() ?? []) out.push({ id, run })
      }
      return out
    },
  }
  return manager
}
