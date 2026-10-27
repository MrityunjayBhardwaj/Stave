/**
 * Which file a sample event plays, asked of the registry the caller hands in.
 *
 * No Strudel import here, on purpose: the engine reaches Strudel only through
 * the modules it loads in `init()`, so the sound warm-up (#2256) passes those
 * in. The timeline's waveforms go through `workspace/samplePeaks.ts`, which supplies the
 * live registry as its default. One implementation, two callers.
 */
import { aliasSoundValue } from './aliases'

/** The parts of an event that decide its file (`workspace/sampleRef.ts` `SampleRef` fits). */
export interface SampleUrlRef {
  readonly s: string
  readonly bank?: string | null
  readonly note?: number | string | null
  readonly freq?: number | null
  readonly n?: number | null
}

/** The registry reads resolving a sample needs. */
export interface SampleUrlDeps {
  readonly getSound: (name: string) => unknown
  readonly getSampleInfo: (hapValue: Record<string, unknown>, bank: never) => { url?: unknown }
  /** The loaded sound registry the alias step consults; absent reads as empty. */
  readonly soundMap?: () => Record<string, unknown> | undefined
}

/**
 * #1767 — the name the engine PLAYS for a written sound name, before any bank.
 *
 * The engine's own alias step (`aliasSoundValue`, called by live playback and
 * by the offline render), asked of the same registry object: a name the loaded
 * registry has wins, otherwise the curated table renames it (`kick` → `bd`).
 * This is that function's third caller, never a second table. The registry is
 * read on every call, so a later `samples(...)` that registers a real `kick`
 * takes over on the next draw, as it does at the next trigger.
 */
export function playedSoundNameIn(s: string, deps: SampleUrlDeps): string {
  return aliasSoundValue({ s }, deps.soundMap?.()).value.s
}

/**
 * Which file would this event play? `null` when the name is not a sample.
 *
 * Mirrors the registration path exactly: `registerSample` stores the bank as
 * `data.samples` on the sound (`sampler.mjs:354-359`) and hands that same bank
 * to `onTriggerSample`, so reading `data.samples` here asks the question the
 * trigger will ask. Synths, wavetables and the audio-in bus have no bank and
 * fall out as null rather than as an error — most lanes on a timeline are not
 * samples, and that is not a failure.
 */
export function resolveSampleUrlIn(ref: SampleUrlRef, deps: SampleUrlDeps): string | null {
  // The engine's order (#1767): alias the bare name, THEN add the bank —
  // `s("kick").bank("RolandTR909")` plays `rolandtr909-bd`, observed.
  const played = playedSoundNameIn(ref.s, deps)
  const name = ref.bank ? `${ref.bank}_${played}` : played
  const sound = deps.getSound(name)
  const bank = (sound as { data?: { samples?: unknown } } | undefined)?.data?.samples
  if (bank == null || typeof bank !== 'object') return null
  try {
    const hapValue: Record<string, unknown> = { s: name }
    if (ref.note != null) hapValue.note = ref.note
    if (ref.freq != null) hapValue.freq = ref.freq
    if (ref.n != null) hapValue.n = ref.n
    const { url } = deps.getSampleInfo(hapValue, bank as never)
    return typeof url === 'string' && url.length > 0 ? url : null
  } catch {
    // A malformed bank is a registration problem, not a drawing one. The lane
    // keeps the marks it already had.
    return null
  }
}
