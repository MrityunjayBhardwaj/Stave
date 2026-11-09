/**
 * Extensions and audio (#2510): the one place that switches extensions on for the page,
 * puts their worklets into audio contexts, gets them ready before sound starts, and says
 * what went wrong under each extension's name.
 *
 * ONE PER PAGE. Strudel's registries (the sound map, `Pattern.prototype`, the worklet
 * list) are one per page, and so is the live audio context, while a page can hold several
 * engines (React's strict mode mounts two). So the engines do not own extensions: each
 * engine's start-up calls `start`, which is safe to call any number of times, and joins
 * whatever is already running.
 *
 * THE ORDER (krama for extensions; see the engine's `initInternal`):
 *  1. the engine sets up audio (`initAudio`) and registers Stave's own sounds;
 *  2. `start`: for each switched-on extension, load its code, add each worklet to the LIVE
 *     context, and only then hand the URL to Strudel's `registerWorklet`, so every context
 *     made later (bounce, stems, the render frame) gets it from Strudel's own `initAudio`;
 *  3. `activate` through the recording host — after Stave's own sounds, so a taken name
 *     is refused rather than overwritten;
 *  4. the engine reads the sound names (and reads them again on every `onChange`).
 * Switching on later runs 2–4 on the running page; switching off undoes through the host.
 *
 * Why the worklet goes to the live context FIRST and to Strudel second, not the other way:
 * Strudel loads its whole list with one `Promise.all` (superdough `loadWorklets`). A URL that
 * fails there rejects the wait early while its own effects are still loading, so one broken
 * extension would make every later bounce start before Strudel's own worklets were ready.
 * Checked on the live context first, a URL only joins the list once it is known to load.
 *
 * Nothing here imports the engine: what it needs from Strudel and from the Console comes
 * in through `ExtensionAudioDoors`.
 */
import { BUILTIN_EXTENSIONS } from './builtin'
import { enabledExtensionIds, onExtensionsEnabledChange } from './enablement'
import { createExtensionManager, type ExtensionManager } from './manager'
import type { HostRegistries } from './host'
import type { ExtensionManifest } from './types'

/** What the engine hands over: Strudel's doors, the live context, the Console. */
export interface ExtensionAudioDoors {
  registries(): HostRegistries
  /** superdough's `registerWorklet`: every later `initAudio` adds the URL to its context */
  registerWorklet(url: string): void
  /**
   * The LIVE audio context, resolved when it is needed and only once no offline render
   * holds superdough's globals: while one renders, superdough's "current" context is the
   * render's. (Captured once at start-up instead, an engine that started while a render
   * ran handed over a closed OfflineAudioContext, and a switch-on put the worklet there:
   * observed 2026-11-09, the bounce had the sound and live playback did not.)
   */
  liveContext(): Promise<{ audioWorklet?: { addModule(url: string): Promise<void> } } | null>
  /** Write a row to Stave's Console. */
  report(level: 'info' | 'warn' | 'error', message: string): void
}

export interface ExtensionAudio {
  /**
   * The engine's start-up step: switch on what the person has switched on, and from now
   * on follow their switches. Never rejects: a failure is reported and the rest go on.
   */
  start(doors: ExtensionAudioDoors): Promise<void>
  /**
   * Run every active extension's `onPrepare`, waiting at most `capMs`. A failure is
   * reported under the extension's name; one still running at the cap is reported too,
   * so a sound missing from the start of a render is never silent.
   *
   * `signal`: stop waiting the moment it aborts (a cancelled bounce must not sit out a
   * slow preparation). The preparations themselves keep running, so they are ready for
   * the next Play or render; a cancel is not reported as a slow extension.
   */
  prepare(capMs: number, signal?: AbortSignal): Promise<void>
  /** Hear when the set of active extensions has changed (sound names to read again). */
  onChange(fn: () => void): () => void
  readonly manager: ExtensionManager
}

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

export function createExtensionAudio(opts: {
  manifests: readonly ExtensionManifest[]
  /** the ids the person has switched on, read now */
  enabled: () => ReadonlySet<string>
  /** hear every switch; returns the unsubscribe */
  subscribe: (fn: (ids: ReadonlySet<string>) => void) => () => void
}): ExtensionAudio {
  let doors: ExtensionAudioDoors | null = null
  const handedToStrudel = new Set<string>()
  const listeners = new Set<() => void>()
  const nameOf = (id: string) => manager.manifest(id)?.name ?? id
  const report = (level: 'info' | 'warn' | 'error', message: string) => doors?.report(level, message)

  const manager = createExtensionManager({
    manifests: opts.manifests,
    registries: () => {
      if (!doors) throw new Error('Extensions cannot switch on before the audio engine has started.')
      return doors.registries()
    },
    async beforeActivate(m, mod) {
      for (const url of mod.worklets ?? []) {
        const live = await doors?.liveContext()
        if (!live?.audioWorklet) throw new Error('this browser cannot run audio worklets, which it needs')
        try {
          await live.audioWorklet.addModule(url)
        } catch (e) {
          throw new Error(`its audio worklet did not load (${messageOf(e)})`)
        }
        if (!handedToStrudel.has(url)) {
          handedToStrudel.add(url)
          doors?.registerWorklet(url)
        }
      }
    },
  })

  // Every change to the active set runs in turn: a switch flipped twice quickly must
  // not have its two applications interleave.
  let queue: Promise<void> = Promise.resolve()
  function apply(ids: ReadonlySet<string>): Promise<void> {
    const run = async () => {
      const before = manager.activeIds().join('\n')
      for (const id of manager.activeIds()) {
        if (ids.has(id)) continue
        for (const e of manager.deactivate(id)) {
          report('warn', `${nameOf(id)} extension: switching it off did not undo everything (${messageOf(e)}).`)
        }
      }
      const { failed } = await manager.sync(ids)
      for (const { id, error } of failed) {
        const undoErrors = (error as { undoErrors?: unknown[] } | null)?.undoErrors ?? []
        const left = undoErrors.length ? ` Undoing what it had added also failed: ${undoErrors.map(messageOf).join('; ')}.` : ''
        report('error', `${nameOf(id)} extension could not be switched on: ${messageOf(error)}.${left}`)
      }
      if (manager.activeIds().join('\n') !== before) for (const fn of [...listeners]) fn()
    }
    queue = queue.then(run, run)
    return queue
  }

  let started: Promise<void> | null = null

  return {
    manager,
    start(d) {
      doors = d
      if (!started) {
        opts.subscribe((ids) => void apply(ids))
        started = apply(opts.enabled())
      } else {
        // A retried start: make sure the switches are applied, joining any run in flight.
        started = apply(opts.enabled())
      }
      return started
    },

    async prepare(capMs, signal) {
      if (signal?.aborted) return
      const jobs = manager.preparers()
      if (!jobs.length) return
      const pending = new Set(jobs)
      const all = Promise.all(
        jobs.map(async (job) => {
          try {
            await job.run()
          } catch (e) {
            report('error', `${nameOf(job.id)} extension could not get ready to play: ${messageOf(e)}. The rest of the song plays without it.`)
          } finally {
            pending.delete(job)
          }
        }),
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      const ended = await Promise.race([
        all.then(() => 'done' as const),
        new Promise<'capped'>((resolve) => {
          timer = setTimeout(() => resolve('capped'), capMs)
        }),
        new Promise<'cancelled'>((resolve) => {
          onAbort = () => resolve('cancelled')
          signal?.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      if (ended === 'capped' && pending.size) {
        const names = [...new Set([...pending].map((j) => j.id))].map(nameOf).join(', ')
        report('warn', `${names} extension was still getting ready after ${Math.round(capMs / 100) / 10} s, so its sounds may be missing at the start.`)
      }
    },

    onChange(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

let page: ExtensionAudio | null = null

/** The page's one runtime, over Stave's own extensions and the person's switches. */
export function pageExtensionAudio(): ExtensionAudio {
  page ??= createExtensionAudio({
    manifests: BUILTIN_EXTENSIONS,
    enabled: enabledExtensionIds,
    subscribe: onExtensionsEnabledChange,
  })
  return page
}
