/**
 * Extensions and Strudel (#2510, #2538): how an extension's Strudel part switches on, puts
 * its worklets into audio contexts, and gets ready before sound starts. The page runtime
 * (`runtime.ts`) decides when; this file is what is Strudel's about it.
 *
 * THE ORDER (krama for a Strudel part; see the engine's `initInternal`):
 *  1. the engine sets up audio (`initAudio`) and registers Stave's own sounds;
 *  2. the engine attaches (`attachStrudel`): for each active extension with a Strudel part,
 *     add each worklet to the LIVE context, and only then hand the URL to Strudel's
 *     `registerWorklet`, so every context made later (bounce, stems, the render frame)
 *     gets it from Strudel's own `initAudio`;
 *  3. the part's `activate` through the recording host — after Stave's own sounds, so a
 *     taken name is refused rather than overwritten;
 *  4. the engine reads the sound names (and reads them again on every `onChange`).
 * Switching on later, while attached, runs 2–4 on the running page; switching off undoes
 * through the host.
 *
 * Why the worklet goes to the live context FIRST and to Strudel second, not the other way:
 * Strudel loads its whole list with one `Promise.all` (superdough `loadWorklets`). A URL that
 * fails there rejects the wait early while its own effects are still loading, so one broken
 * extension would make every later bounce start before Strudel's own worklets were ready.
 * Checked on the live context first, a URL only joins the list once it is known to load.
 *
 * Nothing here imports the engine: what it needs from Strudel and from the Console comes
 * in through `ExtensionStrudelDoors`.
 */
import { createRecordingHost, type HostRegistries } from './host'
import type { ExtensionManager, PartDriver } from './manager'

/** One row for Stave's Console. */
export type ExtensionReport = (level: 'info' | 'warn' | 'error', message: string) => void

/** What the Strudel engine hands over when it attaches: Strudel's doors, the live context, the Console. */
export interface ExtensionStrudelDoors {
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
  /**
   * Write a row to Stave's Console. Used until the page's `start` gives the runtime its
   * own (an engine may attach first: tests, a page that never calls `start`).
   */
  report: ExtensionReport
}

export function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

/**
 * How Strudel parts switch on, through the doors of whichever engine attached last.
 * Worklet URLs already handed to Strudel are remembered for the page: its list cannot be
 * emptied (`RESIDUE.worklet`), so a URL joins it once.
 */
export function createStrudelDriver(doors: () => ExtensionStrudelDoors | null): PartDriver<'strudel'> {
  const handedToStrudel = new Set<string>()
  const attached = () => {
    const d = doors()
    if (!d) throw new Error('the Strudel engine has not started')
    return d
  }
  return {
    async before(_m, part) {
      for (const url of part.worklets ?? []) {
        const d = attached()
        const live = await d.liveContext()
        if (!live?.audioWorklet) throw new Error('this browser cannot run audio worklets, which it needs')
        try {
          await live.audioWorklet.addModule(url)
        } catch (e) {
          throw new Error(`its audio worklet did not load (${messageOf(e)})`)
        }
        if (!handedToStrudel.has(url)) {
          handedToStrudel.add(url)
          d.registerWorklet(url)
        }
      }
    },
    // Always the declared list, empty if the manifest declares none: the host refuses
    // every sound and control not on it.
    record: (m) => createRecordingHost(m.id, attached().registries(), m.provides?.strudel ?? {}),
  }
}

/**
 * Run every active Strudel part's `onPrepare`, waiting at most `capMs`. A failure is
 * reported under the extension's name; one still running at the cap is reported too, so a
 * sound missing from the start of a render is never silent.
 *
 * `signal`: stop waiting the moment it aborts (a cancelled bounce must not sit out a slow
 * preparation). The preparations themselves keep running, so they are ready for the next
 * Play or render; a cancel is not reported as a slow extension.
 */
export async function prepareStrudelParts(
  manager: ExtensionManager,
  report: ExtensionReport,
  capMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  const nameOf = (id: string) => manager.manifest(id)?.name ?? id
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
}
