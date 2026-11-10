/**
 * The page's extensions runtime (#2510, #2538): the one place that switches extensions on
 * and off for the page, part by part, and says what went wrong under each extension's name.
 *
 * ONE PER PAGE. Strudel's registries (the sound map, `Pattern.prototype`, the worklet
 * list) are one per page, and so is the live audio context, while a page can hold several
 * engines (React's strict mode mounts two). So neither the app nor the engines own
 * extensions; they tell this runtime what has happened:
 *
 *  - `start({ report })`: the page has loaded. From now on the runtime follows the
 *    person's switches, and each switched-on extension's COMMON part is on, with no audio
 *    engine involved. Safe to call again: it joins what is running. The app calls it
 *    once as the editor package loads, through the entry's `startPageExtensions`.
 *  - `attachStrudel(doors)`: a Strudel engine has started (`initInternal`, after Stave's
 *    own sounds and before it reads the sound names). Each active extension's Strudel
 *    part switches on, and from now on a switch-on while attached switches its Strudel
 *    part on at once. Calling it again (a retried init, a second engine) re-applies the
 *    switches over the newest doors.
 *
 * Whichever comes first starts the runtime. An engine that attaches before `start` (tests,
 * a page that never calls it) still gets the person's extensions; the Console rows go
 * through the engine's `report` until `start` gives the page's own.
 *
 * SWITCHING OFF undoes the language parts first, newest first, then the common part
 * (`manager.deactivate`). A part that fails to switch on is one Console row under the
 * extension's name and stays off; the other parts stay as they were. A common part that
 * fails leaves the whole extension off: its language parts are not tried, since they may
 * rely on what the common part sets up.
 *
 * What is Strudel's (worklets, its registries, getting ready before sound) lives in
 * `strudel.ts`. Nothing here imports the engine.
 */
import { BUILTIN_EXTENSIONS } from './builtin'
import { enabledExtensionIds, onExtensionsEnabledChange } from './enablement'
import { createExtensionManager, type ExtensionManager } from './manager'
import { createStrudelDriver, messageOf, prepareStrudelParts, type ExtensionReport, type ExtensionStrudelDoors } from './strudel'
import type { ExtensionManifest } from './types'

export interface ExtensionRuntime {
  /**
   * The page has loaded: switch on what the person has switched on (common parts, and
   * Strudel parts if an engine is attached) and follow their switches from now on. Never
   * rejects: a failure is reported and the rest go on.
   */
  start(opts: { report: ExtensionReport }): Promise<void>
  /**
   * A Strudel engine has started: switch on the Strudel part of every active extension,
   * and of every one switched on later. Never rejects.
   */
  attachStrudel(doors: ExtensionStrudelDoors): Promise<void>
  /**
   * Run every active Strudel part's `onPrepare`, waiting at most `capMs` (see
   * `prepareStrudelParts`). Never rejects.
   */
  prepare(capMs: number, signal?: AbortSignal): Promise<void>
  /** Hear when the set of active extensions or parts has changed (sound names to read again). */
  onChange(fn: () => void): () => void
  readonly manager: ExtensionManager
}

export function createExtensionRuntime(opts: {
  manifests: readonly ExtensionManifest[]
  /** the ids the person has switched on, read now */
  enabled: () => ReadonlySet<string>
  /** hear every switch; returns the unsubscribe */
  subscribe: (fn: (ids: ReadonlySet<string>) => void) => () => void
}): ExtensionRuntime {
  let strudel: ExtensionStrudelDoors | null = null
  let pageReport: ExtensionReport | null = null
  const listeners = new Set<() => void>()
  const report: ExtensionReport = (level, message) => (pageReport ?? strudel?.report)?.(level, message)

  const manager = createExtensionManager({
    manifests: opts.manifests,
    parts: { strudel: createStrudelDriver(() => strudel) },
  })
  const nameOf = (id: string) => manager.manifest(id)?.name ?? id
  const state = () => manager.activeIds().map((id) => `${id}:${manager.isPartActive(id, 'strudel')}`).join('\n')

  const failedLine = (error: unknown) => {
    const undoErrors = (error as { undoErrors?: unknown[] } | null)?.undoErrors ?? []
    return undoErrors.length ? ` Undoing what it had added also failed: ${undoErrors.map(messageOf).join('; ')}.` : ''
  }

  // Every change runs in turn: a switch flipped twice quickly, or an engine attaching
  // while the page's start is still loading, must not have two applications interleave.
  let queue: Promise<void> = Promise.resolve()
  function apply(ids: ReadonlySet<string>): Promise<void> {
    const run = async () => {
      const before = state()
      for (const id of manager.activeIds()) {
        if (ids.has(id)) continue
        for (const e of manager.deactivate(id)) {
          report('warn', `${nameOf(id)} extension: switching it off did not undo everything (${messageOf(e)}).`)
        }
      }
      const { failed } = await manager.sync(ids)
      for (const { id, error } of failed) {
        report('error', `${nameOf(id)} extension could not be switched on: ${messageOf(error)}.${failedLine(error)}`)
      }
      if (strudel) {
        await Promise.all(
          manager.activeIds().filter((id) => ids.has(id)).map((id) =>
            manager.activatePart(id, 'strudel').catch((error: unknown) => {
              report('error', `The ${nameOf(id)} extension could not be switched on for Strudel: ${messageOf(error)}.${failedLine(error)}`)
            }),
          ),
        )
      }
      if (state() !== before) for (const fn of [...listeners]) fn()
    }
    queue = queue.then(run, run)
    return queue
  }

  let following = false
  /** Follow the switches from now on (once), and apply them now. */
  function follow(): Promise<void> {
    if (!following) {
      following = true
      opts.subscribe((ids) => void apply(ids))
    }
    return apply(opts.enabled())
  }

  return {
    manager,
    start(o) {
      pageReport = o.report
      // Already following (an earlier start, or an engine attached first): join what is running.
      return following ? queue : follow()
    },
    attachStrudel(doors) {
      strudel = doors
      return follow()
    },
    prepare: (capMs, signal) => prepareStrudelParts(manager, report, capMs, signal),
    onChange(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

let page: ExtensionRuntime | null = null

/** The page's one runtime, over Stave's own extensions and the person's switches. */
export function pageExtensions(): ExtensionRuntime {
  page ??= createExtensionRuntime({
    manifests: BUILTIN_EXTENSIONS,
    enabled: enabledExtensionIds,
    subscribe: onExtensionsEnabledChange,
  })
  return page
}
