/**
 * Switching extensions on and off (#2509).
 *
 * The manager owns which extensions are active right now in this page. It loads an
 * extension's code when it is switched on, activates it through a recording host, and on
 * switch-off undoes exactly what that host recorded. It does not decide WHEN: the engine's
 * start-up step and the Settings switch call it (#2510, #2511), and the on/off store
 * (`enablement.ts`) is the person's choice, kept separately.
 *
 * Guarantees, each pinned by a test:
 *  - switching on twice registers once (a second call joins the first);
 *  - an activation that throws leaves nothing behind, and the error reaches the caller;
 *  - switching off while it is still loading wins: when the load finishes it is undone;
 *  - switching off returns the undo errors instead of throwing, so every undo runs.
 */
import { createRecordingHost, type HostRegistries, type RecordingHost } from './host'
import type { ExtensionManifest } from './types'

export interface ExtensionManager {
  /** the manifests it was given, by id */
  manifest(id: string): ExtensionManifest | undefined
  isActive(id: string): boolean
  activeIds(): string[]
  /** Load and activate. Resolves when active; rejects (leaving nothing) if it failed. */
  activate(id: string): Promise<void>
  /** Undo everything it registered. Returns the errors of any undo step that threw. */
  deactivate(id: string): unknown[]
  /**
   * Make the active set equal `ids`: switch off the rest, then switch on the missing.
   * An id with no manifest (an extension Stave no longer ships, still saved as on) is
   * skipped and listed in `unknown`, not reported as a failure on every start.
   */
  sync(ids: ReadonlySet<string>): Promise<{ failed: { id: string; error: unknown }[]; unknown: string[] }>
}

export function createExtensionManager(opts: {
  manifests: readonly ExtensionManifest[]
  /** Asked for on each activation, because Strudel's registries exist only after the engine starts. */
  registries: () => HostRegistries
}): ExtensionManager {
  const byId = new Map<string, ExtensionManifest>()
  for (const m of opts.manifests) {
    if (byId.has(m.id)) throw new Error(`Two extensions share the id "${m.id}".`)
    byId.set(m.id, m)
  }

  const active = new Map<string, RecordingHost>()
  const pending = new Map<string, { promise: Promise<void>; cancelled: boolean }>()

  async function run(m: ExtensionManifest, ticket: { cancelled: boolean }): Promise<void> {
    const mod = await m.load()
    if (ticket.cancelled) return
    const rec = createRecordingHost(m.id, opts.registries(), m.provides)
    try {
      await mod.activate(rec.host)
    } catch (e) {
      const undoErrors = rec.undo()
      // The cleanup's own failures travel with the error, so whoever reports it can say so.
      if (undoErrors.length && typeof e === 'object' && e !== null) (e as { undoErrors?: unknown[] }).undoErrors = undoErrors
      throw e
    }
    if (ticket.cancelled) {
      rec.undo()
      return
    }
    active.set(m.id, rec)
  }

  const manager: ExtensionManager = {
    manifest: (id) => byId.get(id),
    isActive: (id) => active.has(id),
    activeIds: () => [...active.keys()],

    activate(id) {
      const m = byId.get(id)
      if (!m) return Promise.reject(new Error(`There is no extension called "${id}".`))
      if (active.has(id)) return Promise.resolve()
      const inFlight = pending.get(id)
      if (inFlight && !inFlight.cancelled) return inFlight.promise
      const ticket = { cancelled: false, promise: Promise.resolve() }
      // A cancelled load still in flight may be mid-activation, holding names it is about to
      // give back. Start only after it has settled, or this run would find them taken.
      const after = inFlight ? inFlight.promise.catch(() => undefined) : Promise.resolve()
      ticket.promise = after.then(() => run(m, ticket)).finally(() => {
        if (pending.get(id) === ticket) pending.delete(id)
      })
      pending.set(id, ticket)
      return ticket.promise
    },

    deactivate(id) {
      const inFlight = pending.get(id)
      if (inFlight) inFlight.cancelled = true
      const rec = active.get(id)
      if (!rec) return []
      active.delete(id)
      return rec.undo()
    },

    async sync(ids) {
      for (const id of [...active.keys(), ...pending.keys()]) if (!ids.has(id)) manager.deactivate(id)
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
  }
  return manager
}
