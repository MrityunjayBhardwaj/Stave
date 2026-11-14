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
 * FAILURES ARE REMEMBERED (#2552). Besides the Console row, the runtime keeps, per
 * extension, why switching it on failed in the latest pass (`failure(id)`), so the
 * Extensions view can say "couldn't switch on" instead of showing the switch alone. Each
 * pass over the switches replaces the set: a later success clears it, and so does
 * switching the extension off. `onChange` fires when it changes.
 *
 * SETTINGS DECLARED BADLY (#2556) are reported once, as a warning per setting, when the
 * runtime starts following the switches; the extension still switches on without them.
 *
 * What is Strudel's (worklets, its registries, getting ready before sound) lives in
 * `strudel.ts`. Nothing here imports the engine.
 */
import { listedExtensions } from './builtin'
import { setCodeEditorErrorReport } from './editors'
import { keysTakenBy, type ExtensionKeyInCode } from './keys'
import { enabledExtensionIds, onExtensionsEnabledChange } from './enablement'
import { settingProblems } from './settings'
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
  /**
   * Hear when the set of active extensions or parts, or of failures, has changed (sound
   * names to read again, the Extensions view to redraw).
   */
  onChange(fn: () => void): () => void
  /**
   * Why switching this extension on failed in the latest pass, in a sentence, or `undefined`
   * if it did not fail (it is on, off, or still loading). The full reason is on the Console.
   */
  failure(id: string): string | undefined
  /** Say something under an extension's name: to the page's Console once started, else the engine's. */
  report: ExtensionReport
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
  /** id → why it could not be switched on, in the latest pass (#2552) */
  let failures = new Map<string, string>()
  const report: ExtensionReport = (level, message) => (pageReport ?? strudel?.report)?.(level, message)

  const manager = createExtensionManager({
    manifests: opts.manifests,
    parts: { strudel: createStrudelDriver(() => strudel) },
  })
  const nameOf = (id: string) => manager.manifest(id)?.name ?? id
  const state = () =>
    [
      ...manager.activeIds().map((id) => `${id}:${manager.isPartActive(id, 'strudel')}`),
      ...[...failures].map(([id, why]) => `failed ${id}:${why}`),
    ].join('\n')

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
      const failedNow = new Map<string, string>()
      const { failed } = await manager.sync(ids)
      for (const { id, error } of failed) {
        failedNow.set(id, `${messageOf(error)}.`)
        report('error', `${nameOf(id)} extension could not be switched on: ${messageOf(error)}.${failedLine(error)}`)
      }
      if (strudel) {
        await Promise.all(
          manager.activeIds().filter((id) => ids.has(id)).map((id) =>
            manager.activatePart(id, 'strudel').catch((error: unknown) => {
              failedNow.set(id, `Its Strudel part failed: ${messageOf(error)}.`)
              report('error', `The ${nameOf(id)} extension could not be switched on for Strudel: ${messageOf(error)}.${failedLine(error)}`)
            }),
          ),
        )
      }
      failures = failedNow
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
      // #2556 — a setting declared badly is left out, not a crash: say so once, by name
      for (const m of opts.manifests) {
        for (const problem of settingProblems(m)) report('warn', `${problem} It is left out of Settings.`)
      }
      opts.subscribe((ids) => void apply(ids))
    }
    return apply(opts.enabled())
  }

  return {
    manager,
    report,
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
    failure: (id) => failures.get(id),
  }
}

let page: ExtensionRuntime | null = null

/** The page's one runtime, over the listed extensions (`listedExtensions`) and the person's switches. */
export function pageExtensions(): ExtensionRuntime {
  if (!page) {
    const runtime = createExtensionRuntime({
      manifests: listedExtensions(),
      enabled: enabledExtensionIds,
      subscribe: onExtensionsEnabledChange,
    })
    page = runtime
    // an extension that fails on one code editor is a Console row under its name (#2513)
    setCodeEditorErrorReport((e) => runtime.report('error', `${messageOf(e)}.`))
  }
  return page
}

/**
 * The keys switched-on extensions take in the code right now (#2513): declared in their
 * manifests and not handed back. The app's key dispatcher reads this on each keystroke in
 * a code editor; Keyboard Shortcuts (#2545) shows it. An extension still loading takes none.
 */
export function extensionKeysInCode(runtime: ExtensionRuntime = pageExtensions()): ExtensionKeyInCode[] {
  return keysTakenBy(activeExtensionManifests(runtime))
}

/**
 * The manifests of the extensions switched on in this page right now, in the order they
 * came on (#2545). Keyboard Shortcuts lists the keys of these, handed back or not; an
 * extension still loading, or one that failed to switch on, is not among them, so the
 * panel shows exactly the extensions whose keys the dispatcher reads.
 */
export function activeExtensionManifests(runtime: ExtensionRuntime = pageExtensions()): ExtensionManifest[] {
  const m = runtime.manager
  return m.activeIds().flatMap((id) => m.manifest(id) ?? [])
}

/**
 * Why switching this extension on failed in this page, or `undefined` (#2552). The
 * Extensions view shows it on the row and the page.
 */
export function extensionFailure(id: string, runtime: ExtensionRuntime = pageExtensions()): string | undefined {
  return runtime.failure(id)
}

/** Hear when the page's extensions, or their failures, change. Returns the unsubscribe. */
export function onPageExtensionsChange(fn: () => void, runtime: ExtensionRuntime = pageExtensions()): () => void {
  return runtime.onChange(fn)
}

/** Is any extension switched on in this page right now? */
export function hasActiveExtensions(runtime: ExtensionRuntime = pageExtensions()): boolean {
  return runtime.manager.activeIds().length > 0
}
