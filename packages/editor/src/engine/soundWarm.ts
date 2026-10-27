/**
 * #2256 — load the sounds a pattern is about to play before its notes need them.
 *
 * Superdough loads a sample (or a soundfont zone) the first time a note asks for
 * it, and when that load finishes after the note's start time it drops the note:
 * `superdough.mjs` logs `skip hap: still loading` after `await onTrigger`. So the
 * first hit of every sound in a song was silent on a cold cache.
 *
 * This turns the notes about to play into load jobs, one per sound that isn't
 * cached yet, through the very loaders a trigger uses:
 *
 * - a sample → `loadBuffer(url, ac, …)`, the URL resolved exactly as the trigger
 *   resolves it (`sampleUrl.ts`). `loadBuffer` keeps the in-flight promise in
 *   `loadCache[url]` (`sampler.mjs:86-104`), so a note that fires mid-load waits
 *   on the same download rather than starting another.
 * - a `gm_*` instrument → `getFontBufferSource(font, value, ac)`, which caches the
 *   font file per name and the zone per pitch (`fontloader.mjs:22-96`). The font
 *   is picked as the instrument's trigger picks it: `fonts[getSoundIndex(n, len)]`
 *   (`fontloader.mjs:153-157`, `util.mjs:93`).
 *
 * Synths, wavetables and anything unregistered produce no job.
 *
 * ⚠ The audio context is the caller's. `loadBuffer` decodes with the context it
 * is handed and caches the result page-wide, so a warm-up must hand it the LIVE
 * context, never whatever the global is while a bounce has it swapped.
 *
 * Pure apart from the injected loaders, so it is unit-tested with fakes.
 */
import { playedSoundNameIn, resolveSampleUrlIn, type SampleUrlDeps } from './sampleUrl'

export interface SoundWarmDeps extends SampleUrlDeps {
  readonly getCachedBuffer: (url: string) => unknown
  readonly loadBuffer: (url: string, ac: BaseAudioContext, s?: string, n?: number) => Promise<unknown>
  readonly getFontBufferSource?: (
    font: string,
    value: Record<string, unknown>,
    ac: BaseAudioContext,
  ) => Promise<unknown>
  /** The live audio context: what the trigger will decode with. */
  readonly audioContext: () => BaseAudioContext
}

export interface WarmJob {
  /** What is loaded: `sample:<url>` or `font:<font>:<pitch>`. Two jobs never share one. */
  readonly key: string
  readonly run: () => Promise<unknown>
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** superdough `getSoundIndex`: `n` rounded, wrapped into the list (`util.mjs:93`). */
function soundIndex(n: number | null, length: number): number {
  const i = Math.round(n ?? 0)
  return ((i % length) + length) % length
}

/** Load jobs for the sounds these note values play that are not loaded yet. */
export function soundWarmJobs(values: Iterable<Record<string, unknown>>, deps: SoundWarmDeps): WarmJob[] {
  const jobs = new Map<string, WarmJob>()
  for (const value of values) {
    const s = asString(value.s)
    if (!s) continue
    const bank = asString(value.bank)
    const n = asNumber(value.n)
    const note = asNumber(value.note) ?? asString(value.note)
    const freq = asNumber(value.freq)

    const url = resolveSampleUrlIn({ s, bank, n, note, freq }, deps)
    if (url != null) {
      const key = `sample:${url}`
      if (jobs.has(key) || deps.getCachedBuffer(url) != null) continue
      jobs.set(key, { key, run: () => deps.loadBuffer(url, deps.audioContext(), s, n ?? 0) })
      continue
    }

    if (!deps.getFontBufferSource) continue
    const played = playedSoundNameIn(s, deps)
    const sound = deps.getSound(bank ? `${bank}_${played}` : played) as
      | { data?: { type?: unknown; fonts?: unknown } }
      | undefined
    const fonts = sound?.data?.fonts
    if (sound?.data?.type !== 'soundfont' || !Array.isArray(fonts) || fonts.length === 0) continue
    const font = asString(fonts[soundIndex(n, fonts.length)])
    if (!font) continue
    const pitch: Record<string, unknown> = {}
    if (freq != null) pitch.freq = freq
    else if (note != null) pitch.note = note
    const key = `font:${font}:${freq ?? note ?? 'c3'}`
    if (jobs.has(key)) continue
    const load = deps.getFontBufferSource
    jobs.set(key, { key, run: () => load(font, pitch, deps.audioContext()) })
  }
  return [...jobs.values()]
}

/**
 * Run jobs, but wait for them no longer than `capMs`: a slow network must still
 * start playing. Loads that outlast the cap keep going and fill the cache for
 * the notes after. Resolves with how many finished within the cap. A load that
 * fails is the trigger's to report (it will try again and log it), not ours.
 */
export async function runWarmJobs(jobs: readonly WarmJob[], capMs: number): Promise<{ loaded: number; pending: number }> {
  if (jobs.length === 0) return { loaded: 0, pending: 0 }
  let loaded = 0
  const all = Promise.allSettled(jobs.map((j) => j.run().then(() => { loaded++ })))
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, capMs) })
  await Promise.race([all, cap])
  clearTimeout(timer)
  return { loaded, pending: jobs.length - loaded }
}
