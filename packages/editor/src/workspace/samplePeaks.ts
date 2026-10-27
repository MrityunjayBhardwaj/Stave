/**
 * samplePeaks — the min/max envelope of a decoded sample, so the Song timeline
 * can draw what a sound actually looks like (#1506, the mechanism #900 describes).
 *
 * ## Why this lives in the editor
 *
 * The app cannot reach any of the audio it draws. It depends on `@strudel/mini`
 * and nothing else from the Strudel family, while `superdough` — which owns both
 * the sample registry and the decoded-buffer cache — arrives only through
 * `@strudel/webaudio`, an editor dependency (`@strudel/webaudio/index.mjs:11`
 * re-exports superdough wholesale). This is the same route `assetStore.ts` takes
 * for `samples`.
 *
 * That constraint happens to point the same way the design does. The side that
 * owns playback is the side that can answer "which bytes are these?", and a
 * waveform resolved anywhere else would be a second opinion about what plays —
 * exactly the drift #900 warns about when it asks for the drawn shape to reflect
 * the sound rather than the file.
 *
 * ## The cache is cold until something plays
 *
 * `getCachedBuffer` reads a map that `loadBuffer` fills only once a fetch and a
 * decode have both completed (`superdough/sampler.mjs:86-101`). A page that has
 * not played yet has none of it. So every read here is allowed to return null,
 * and callers are expected to treat a missing waveform as "not yet" rather than
 * as an error — the timeline simply draws the mark it drew before.
 *
 * One thing worth writing down because the library says otherwise: superdough
 * labels that cache `string: Promise<ArrayBuffer>` (`sampler.mjs:14`). It is
 * neither a promise nor an ArrayBuffer. `sampler.mjs:100` stores the *decoded*
 * buffer, and the accessor at `:17` is synchronous. Reading the comment instead
 * of the code costs an `await` on a value that never settles.
 */

import { getAudioContext, getCachedBuffer, getSampleInfo, getSound, loadBuffer, soundMap } from '@strudel/webaudio'
import { playedSoundNameIn, resolveSampleUrlIn } from '../engine/sampleUrl'
import type { SampleRef } from './sampleRef'

/**
 * Envelope resolution held per sample, independent of zoom — the FLOOR.
 *
 * Peaks are cached ONCE per sample and downsampled to whatever a mark is worth
 * at draw time, rather than cached per (sample, pixel width). The alternative
 * thrashes: a mark's width changes on every zoom step and on every window
 * resize, so a width-keyed cache would recompute the whole envelope for a
 * scroll gesture and hold an entry per width it ever saw.
 *
 * 1024 is well past what a mark playing the WHOLE of a short sample can show.
 * It is not enough for a long file played in slices (#1736): a mark shows only
 * its slice, so the detail it needs scales with the file's length. That is
 * `PEAK_COLUMNS_PER_SECOND`; this is the minimum a short sample still gets.
 */
export const PEAK_COLUMNS = 1024

/**
 * Envelope resolution in TIME, for a file long enough to exceed the floor
 * (#1736). A 374 s vocal played one ~2 s bar per mark had 1024 columns for the
 * whole file — about 5 per mark, drawn as flat plateaus. 256 per second is a
 * column per ~4 ms, finer than the timeline's closest zoom on a song that long
 * (~190 px per second for 187 bars), so a slice is still a reduction there.
 */
export const PEAK_COLUMNS_PER_SECOND = 256

/**
 * Upper bound on a single sample's columns: 2^18 pairs is 2 MB of Float32, and
 * reaches 1024 s (~17 min) at full time resolution. A longer file loses
 * resolution rather than growing the cache without limit.
 */
export const MAX_PEAK_COLUMNS = 1 << 18

/** How many columns a sample of this length is cached at. */
export function peakColumnsFor(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return PEAK_COLUMNS
  return Math.min(MAX_PEAK_COLUMNS, Math.max(PEAK_COLUMNS, Math.ceil(durationSeconds * PEAK_COLUMNS_PER_SECOND)))
}

/**
 * A sample's drawable shape.
 *
 * `data` is interleaved `[min0, max0, min1, max1, …]` rather than two arrays:
 * the draw loop reads a column's pair together, so keeping them adjacent is one
 * allocation and one cache line instead of two of each.
 */
export interface SamplePeaks {
  /** Interleaved min/max pairs; length is always `2 * columns`. */
  readonly data: Float32Array
  /** Number of min/max pairs in `data`. */
  readonly columns: number
  /**
   * Decoded length in SECONDS.
   *
   * Carried with the peaks because it is the numerator of the timeline's
   * fidelity rule (sample duration ÷ the slot it is triggered into), and the
   * only other way to get it is a second trip through the buffer cache.
   */
  readonly duration: number
}

/**
 * Reduce decoded channel data to `columns` min/max pairs.
 *
 * Pure, and deliberately takes CHANNELS rather than one channel: the envelope of
 * a stereo sample is the envelope of both sides, and drawing only channel 0
 * would under-report anything panned right. Taking the min and max across all
 * channels costs one linear pass either way and cannot understate the sound.
 *
 * When a column spans no samples — which happens whenever the buffer is shorter
 * than `columns`, e.g. a 300-sample click drawn into 1024 slots — the column
 * takes the nearest sample's value rather than zero. Zero would draw silence
 * that is not there, breaking a short sample into a comb of gaps; nearest-value
 * draws the same shape at lower information, which is what a magnified waveform
 * genuinely is.
 */
export function computePeaks(channels: readonly Float32Array[], columns: number): Float32Array {
  if (columns <= 0) return new Float32Array(0)
  const out = new Float32Array(columns * 2)
  const length = channels.length > 0 ? channels[0].length : 0
  if (length === 0 || channels.length === 0) return out // silence: every pair stays 0/0

  for (let col = 0; col < columns; col++) {
    const start = Math.floor((col * length) / columns)
    const end = Math.floor(((col + 1) * length) / columns)
    let min = Infinity
    let max = -Infinity
    if (end > start) {
      for (const channel of channels) {
        for (let i = start; i < end; i++) {
          const v = channel[i]
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    } else {
      // Column spans no samples — read the nearest one instead of drawing a gap.
      const at = Math.min(start, length - 1)
      for (const channel of channels) {
        const v = channel[at]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    out[col * 2] = min
    out[col * 2 + 1] = max
  }
  return out
}

/** Every channel of a decoded buffer, as the arrays `computePeaks` reduces. */
function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  return channels
}

/**
 * Peaks already computed for a resolved sample URL.
 *
 * Keyed by URL rather than by sound name because that is the identity the audio
 * actually has: two names can register the same file, and one name can resolve
 * to different files depending on `n` and on the note it is played at. The URL
 * is what `loadBuffer` keys its own cache on (`sampler.mjs:86-101`), so this
 * cache and superdough's fill and miss together.
 */
const peakCache = new Map<string, SamplePeaks>()

export type { SampleRef } from './sampleRef'
export { sampleRefOf } from './sampleRef'

/** The engine reads this module performs, isolated so tests can drive it. */
export interface SamplePeaksDeps {
  readonly getSound: typeof getSound
  readonly getSampleInfo: typeof getSampleInfo
  readonly getCachedBuffer: typeof getCachedBuffer
  /** The loaded sound registry the alias step consults; absent reads as empty. */
  readonly soundMap?: () => Record<string, unknown> | undefined
}

const liveDeps: SamplePeaksDeps = {
  getSound,
  getSampleInfo,
  getCachedBuffer,
  soundMap: () => soundMap.get(),
}

/** #1767 — the name the engine PLAYS for a written sound name (see `engine/sampleUrl.ts`). */
export function playedSoundName(s: string, deps: SamplePeaksDeps = liveDeps): string {
  return playedSoundNameIn(s, deps)
}

/** Which file would this event play? `null` when the name is not a sample (see `engine/sampleUrl.ts`). */
export function resolveSampleUrl(ref: SampleRef, deps: SamplePeaksDeps = liveDeps): string | null {
  return resolveSampleUrlIn(ref, deps)
}

/**
 * Peaks for an event, or `null` when they cannot be had YET.
 *
 * Never performs I/O. A miss means the sample has not been fetched and decoded,
 * which on a freshly loaded page is every sample that has not played. Triggering
 * a load from here would make scrolling a timeline pull a drum kit off a CDN,
 * which is a surprising thing for a view to do; the local assets that matter for
 * seeing a take are warmed deliberately elsewhere instead.
 */
export function peaksForSample(ref: SampleRef, deps: SamplePeaksDeps = liveDeps): SamplePeaks | null {
  const url = resolveSampleUrl(ref, deps)
  if (url == null) return null
  const cached = peakCache.get(url)
  if (cached) return cached
  const buffer = deps.getCachedBuffer(url)
  if (buffer == null) return null
  const columns = peakColumnsFor(buffer.duration)
  const peaks: SamplePeaks = {
    data: computePeaks(channelsOf(buffer), columns),
    columns,
    duration: buffer.duration,
  }
  peakCache.set(url, peaks)
  return peaks
}

/**
 * Drop memoised peaks. Reset state between tests.
 *
 * It is worth being exact about what this does NOT protect against, because the
 * obvious guess is wrong. Entries are keyed by the resolved URL, and that URL
 * comes from the asset's CONTENT HASH — so two different recordings can never
 * share an entry, and re-importing under a name that already exists mints a new
 * name anyway (`uniqueSoundName`). The cache cannot go stale, and no production
 * code needs to clear it.
 *
 * The one condition that would change that is object URLs being revoked and
 * re-minted for the same bytes: entries keyed by the dead URL would accumulate.
 * Nothing does that today — `releaseAsset` and `releaseAllAssets` have no
 * production callers — so this stays a test affordance rather than a guard
 * pretending to hold a line nobody is standing on.
 */
export function clearSamplePeaksCache(): void {
  peakCache.clear()
}

/** The two I/O edges warming needs, isolated so a test can drive it dry. */
export interface SampleWarmDeps {
  readonly loadBuffer: typeof loadBuffer
  readonly getAudioContext: typeof getAudioContext
}

const liveWarmDeps: SampleWarmDeps = { loadBuffer, getAudioContext }

/**
 * Fetch, decode and reduce the named sounds so their shapes can be drawn before
 * anything has played them (#1506).
 *
 * Called for LOCAL assets only — takes and imported files, whose bytes are
 * already in IndexedDB and whose URLs are `blob:`, so "fetching" is a read from
 * memory and there is no network. Doing this for the CDN sample banks would mean
 * a page load quietly pulling megabytes of drums to draw pictures of them, which
 * is why the draw path itself never loads anything and this is the deliberate,
 * bounded exception.
 *
 * Resolves to the names actually warmed. Individual failures are skipped rather
 * than thrown: a take whose bytes went missing should cost its own waveform and
 * nothing else, and the timeline already renders correctly without it.
 */
export async function warmSamplePeaks(
  names: readonly string[],
  deps: SamplePeaksDeps = liveDeps,
  io: SampleWarmDeps = liveWarmDeps,
): Promise<string[]> {
  const warmed: string[] = []
  for (const name of names) {
    try {
      const url = resolveSampleUrl({ s: name }, deps)
      if (url == null) continue
      if (deps.getCachedBuffer(url) == null) {
        await io.loadBuffer(url, io.getAudioContext(), name)
      }
      if (peaksForSample({ s: name }, deps) != null) warmed.push(name)
    } catch {
      // A take that cannot be decoded simply has no waveform.
    }
  }
  return warmed
}
