/**
 * How long should a bounce be — the document's own answer, typed so the modal
 * cannot mistake one kind of answer for another (#1365).
 *
 * ── WHY A TYPE AND NOT A NUMBER ──────────────────────────────────────────────
 * There are three genuinely different answers and they demand different UI:
 * a document with an arrangement has a definite end; a looping document has no
 * end but may have a measurable period, so the user picks how many repeats; and
 * a document with neither can only be bounced by naming a wall-clock duration.
 * A bare number cannot tell the second from the third — and guessing wrong there
 * is silent, because a bounce of the wrong length still produces a valid WAV.
 *
 * ── THE TRAP THIS MODULE EXISTS TO AVOID ─────────────────────────────────────
 * Two different things in this codebase are called "loop", and they disagree:
 *
 *   songExtent(ir).kind === 'loop'          145 of 150 real documents
 *       "no arrangement bounds this document" — a fact about STRUCTURE.
 *   analysis.displaySpan.kind === 'loop'     101 of 142 evaluated documents
 *       "a period was measured"              — a LENGTH.
 *
 * Only the second can size a render. Reading the first as coverage for a
 * length-based feature would promise a length for 63 documents that have none.
 * `displaySpan` is a discriminated union precisely so a consumer cannot read a
 * give-up horizon as a measurement; a bounce is the most literal possible
 * consumer of "repeats every N", so it branches on `kind` and never reaches for
 * `periodCycles ?? horizonCycles`.
 *
 * Figures measured by `song-period-sweep` over the saved corpus, restated when
 * #1465 moved them: 142 of 150 documents evaluate headlessly; of those, 101
 * carry a measured period, 37 are aperiodic at the 256-cycle cap, and 4 are
 * silent. The 19 that moved are documents whose only aperiodicity was a
 * continuously modulated control — which is the defect this file's own dialog
 * was filed for.
 *
 * ── WHY TWO EDITOR FUNCTIONS ARE STILL HANDED IN ──────────────────────────────
 * Until #1938 the app's tests could not load the `@stave/editor` main entry, so
 * every editor function this file used was injected. #1943 imports what the tests
 * never replace (`signalDimensionsOf`) and keeps a seam only where a test hands in
 * its own:
 *   - `createCollector` — the tests feed fixed onsets through it; production passes
 *     the timeline's shared factory, so a second collector cannot drift from it.
 *   - `analyzeSong` — two arms pass one that THROWS, to prove an arrangement is
 *     answered from its end without reaching the analysis at all.
 */
import { signalDimensionsOf } from '@stave/editor'
import type {
  PatternIR,
  IREvent,
  SongAnalysis,
  SongExtent,
  AnalyzeSongOptions,
} from '@stave/editor'

/** What the document says about its own length. Never a bare number. */
export type SongLength =
  /** A definite end: an arrangement of `cycles`. Bounce the whole thing. */
  | { readonly kind: 'arranged'; readonly cycles: number }
  /** No end, but a measured period. Offer repeats of `periodCycles`. */
  | { readonly kind: 'loop'; readonly periodCycles: number }
  /**
   * No length can be offered, and `why` says which of the three reasons — the
   * modal tells the user rather than silently falling back, because "we could
   * not measure this" and "this document is empty" are different situations.
   */
  | {
      readonly kind: 'unknown'
      readonly why: 'no-period' | 'silent' | 'no-document'
    }

/**
 * The document's length and the engine's tempo, kept as SEPARATE fields.
 *
 * They have different epistemic status and different failure modes: the length
 * comes from the IR and the analysis, the tempo from the running scheduler, and
 * either can be absent while the other is known. Flattening them into one struct
 * is how a consumer ends up treating "no tempo yet" as "no length".
 */
export interface BounceSizing {
  readonly length: SongLength
  /** Cycles per second from the live scheduler, or `null` if unavailable. */
  readonly cps: number | null
}

/**
 * The two readings of a document a bounce needs, kept apart because they are read
 * at DIFFERENT TIMES for DIFFERENT jobs (#1373).
 *
 * Both come from the parser. Since #1558 the published snapshot's final pass
 * is `parseStrudel`'s own (`codeView/ir/strudelPasses.ts`), so the snapshot can say whether
 * a document has an arrangement. Before that it could not: the staged pipeline
 * left a top-level `arrange(...)` as an opaque `Code` node, every document read
 * as a loop, and `measureSongLength`'s `arranged` branch went its whole life
 * without firing in the running app.
 *
 * What still separates them:
 *
 *   end         where the file's text AT THE MOMENT the bounce is sized ends —
 *               `songEndOf` of that text, read then. Needs no evaluation, so an
 *               arrangement is sized before a note has sounded.
 *   analysis    the LAST PUBLISHED snapshot, and only when this file published
 *               it. Its lane keys match the runtime accessors the collector is
 *               threaded with, which is what a measured period needs.
 *
 * Collapsing them would size an arrangement off whatever was last published,
 * which can be another tab's document or a revision behind the editor.
 */
export interface SongSources {
  /**
   * STRUCTURE — "does this document have a definite end?" `songEndOf` of the
   * file's current text (#1940: the area reads it, so this module never runs the
   * parser). Needs no evaluation and no playback, so an arrangement can be sized
   * before a note has sounded. `null` when there is no Strudel text to read.
   */
  readonly end: SongExtent | null
  /**
   * MEASUREMENT — "what period does this document repeat at?" Must come from
   * the published snapshot, whose lane keys match the runtime accessors the
   * collector is threaded with. Substituting a fresh parse here would
   * re-key the collector and silently change what the period path measures.
   */
  readonly analysis: PatternIR | null
}

/** One analysis run's onset source, as `createSongCollector` returns it. */
export interface SongCollectorParts {
  readonly collectFn: ((startCycle: number, endCycle: number) => IREvent[]) | undefined
  readonly hasUnheardTrack: (() => boolean) | undefined
}

/** The editor capabilities this module needs, injected — see the header. */
export interface SongLengthDeps {
  readonly analyzeSong: (
    ir: PatternIR | null,
    opts: AnalyzeSongOptions,
  ) => Promise<SongAnalysis>
  readonly createCollector: (ir: PatternIR) => SongCollectorParts
  /** How far the analysis may look (#2109) — the timeline's own limit. Omitted,
   *  the analysis's default applies. */
  readonly capCycles?: number
}

/**
 * Measure `ir`'s length.
 *
 * ⚠ THE COLLECTOR IS NOT OPTIONAL IN SPIRIT. `analyzeSong` with no `collectFn`
 * "sees no onsets and returns the empty shape" — it still resolves, still hands
 * back a well-formed `SongAnalysis`, and every document reads as silent. That is
 * an answer that looks like a measurement, which is why the collector is a
 * required dep rather than something a caller can forget: the shared factory the
 * timeline uses is passed in, so a second collector cannot drift from the one
 * whose header explains the key space.
 */
export async function measureSongLength(
  sources: SongSources,
  deps: SongLengthDeps,
  signal?: { aborted: boolean },
): Promise<SongLength> {
  if (sources.end == null && sources.analysis == null) {
    return { kind: 'unknown', why: 'no-document' }
  }

  // Structure first, off the source's own end: an arrangement is a definite end,
  // and it does not depend on anything having been evaluated or heard — so this
  // branch can answer before a note has sounded, and it is asked of the file's
  // text as it is now (see `SongSources`). No text reads as a loop, which is
  // what `songEnd(null)` answered when this took a tree.
  const extent: SongExtent = sources.end ?? { kind: 'loop' }
  if (extent.kind === 'arranged' && extent.cycles > 0) {
    // #1580 — the arrangement is a definite end of the STRUCTURE. A parameter
    // whose period does not divide it keeps moving after the last bar, so the
    // song first repeats at the fold of the two: four bars under a three-step
    // gain repeat at twelve, and a bounce of four would loop `.2 .5 .9 .2`,
    // which is not what the song does. `songEnd` folds it — the same reading
    // play-once stops at and the timeline spans (#1723, #1936). Structural, like
    // everything else in this branch — no evaluation, so it still answers before
    // a note has sounded.
    return { kind: 'arranged', cycles: extent.cycles }
  }

  // `opaque` means an arrangement IS present but something unparsed sits above
  // it. Falling through to the period would quietly present an arrangement as a
  // loop, which is exactly the distinction `songExtent` kept the kind for.
  if (extent.kind === 'opaque') return { kind: 'unknown', why: 'no-period' }

  // Everything below measures the EVALUATED document, so it needs the snapshot.
  // A document that has never been evaluated has no period to find — which is a
  // different answer from "we measured it and there was none".
  if (sources.analysis == null) return { kind: 'unknown', why: 'no-document' }

  const { collectFn, hasUnheardTrack } = deps.createCollector(sources.analysis)

  let analysis: SongAnalysis
  try {
    analysis = await deps.analyzeSong(sources.analysis, {
      signal,
      collectFn,
      hasUnheardTrack,
      // #1465 — this is the dialog the issue was filed against: automating a
      // control with a continuous signal dropped the document to "pick a length".
      signals: signalDimensionsOf(sources.analysis),
      capCycles: deps.capCycles,
    })
  } catch {
    return { kind: 'unknown', why: 'no-period' }
  }

  const cycles = songLoopCycles(analysis)
  if (cycles !== null) return { kind: 'loop', periodCycles: cycles }

  // `capped` and `horizon` are both places the analysis STOPPED, not lengths.
  // Distinguish an empty document from an unmeasurable one so the modal can say
  // which; a document with no onsets at all has nothing to bounce.
  const heardAnything = analysis.lanes.some((l) =>
    l.onsetsByCycle.some((n) => n > 0),
  )
  return { kind: 'unknown', why: heardAnything ? 'no-period' : 'silent' }
}

/**
 * The bars one pass of a looping song lasts, read off its analysis, or null when the
 * analysis found no loop. ONE reading for every place that says how long the song is —
 * the bounce offer above and the shape menu's preview (#1611): two readings of one
 * analysis could label a swap with a length the bounce would then not offer.
 *
 * #1599 — a repeat is the length after which EVERY track has come back round, not the
 * view's span. The view spans the longest single track so tracks of different lengths
 * phase inside it (#488), and a bounce of that span cut `<bd sd cp hh>` beside a 3-step
 * gain at 4 cycles of a 12-cycle song. Where no whole-song repeat could be vouched for (a
 * track with no loop of its own, or an LCM past the cap) the reading stays on the span,
 * rather than inventing a number.
 */
export function songLoopCycles(analysis: SongAnalysis): number | null {
  const span = analysis.displaySpan
  // #1721 — an arranged song's span is the end it DECLARES, not a period, so the
  // period is read where it was measured. `periodCycles` is exactly what the `loop`
  // span carried before the arranged span replaced it — the measurement is unchanged
  // — so every document reads the same number it did.
  const period = span.kind === 'loop' ? span.cycles : span.kind === 'arranged' ? analysis.periodCycles : null
  if (period === null || !(period > 0)) return null
  return analysis.repeatCycles !== null ? analysis.repeatCycles : period
}

/** Seconds a span of `cycles` occupies at `cps`, or `null` if tempo is unknown. */
export function cyclesToSeconds(cycles: number, cps: number | null): number | null {
  if (cps == null || !Number.isFinite(cps) || cps <= 0) return null
  if (!Number.isFinite(cycles) || cycles <= 0) return null
  return cycles / cps
}

/**
 * The ceiling a bounce is allowed to reach, in seconds.
 *
 * Set when every bounce was REAL-TIME — `LiveRecorder` captured the live graph,
 * so ten minutes of audio cost ten minutes of wall clock. The old ceiling was
 * 60s only because every option was a hand-picked number; the constraint then
 * was the user's patience, not the format.
 *
 * #1631 made the offline render the default, and it runs faster than the song
 * plays, so patience no longer sets the limit for most files. The live fallback
 * still spends real time: ten minutes offered there is ten minutes waited.
 *
 * ⚠ MEMORY IS NOT WHAT HOLDS THIS AT TEN MINUTES — MEASURED (#1652). The
 * starter song through `renderLoadedReport` in headless Chromium on a 24 GB
 * Mac (probe: `__staveBounceProbe.bounceStats`), peak renderer memory and wall
 * clock:
 *
 *    10 min   0.9 GB    8 s        60 min   3.0 GB    44 s
 *    20 min   1.2 GB   15 s        90 min   3.7 GB    67 s
 *    40 min   2.1 GB   30 s       180 min   5.8 GB   133 s
 *
 * Every file came out whole (full length, level steady in every tenth); 44.1
 * kHz behaves the same. Nothing failed up to three hours. The next hard limit is
 * the WAV format's 4 GiB size field, about 6.2 hours at 48 kHz. Unmeasured: a
 * smaller machine, another browser, and whether the tab stays responsive during
 * a long render. So the numbers below are a product choice, not a measured limit.
 *
 * Decided on #1652: a live take stays at ten minutes, because every second
 * offered there is a second waited. An offline render goes to an hour — 3.0 GB
 * and 44 s on the machine above, well inside what it handled.
 */
export const MAX_LIVE_BOUNCE_SECONDS = 600
export const MAX_OFFLINE_BOUNCE_SECONDS = 3600

/** The longest bounce offered on a path. */
export function maxBounceSeconds(offline: boolean): number {
  return offline ? MAX_OFFLINE_BOUNCE_SECONDS : MAX_LIVE_BOUNCE_SECONDS
}

/**
 * #1666 — the longest STEMS export offered for a song of `tracks` tracks.
 *
 * ⚠ A STEMS EXPORT'S COST IS SECONDS x TRACKS, SO ITS CEILING CANNOT BE A
 * NUMBER OF SECONDS. It renders the whole song once per track and holds every
 * result until the zip is built, so six tracks of ten minutes cost what one
 * track of an hour costs. The dialog used to offer stems the mix's ceiling
 * flat -- an hour, whatever the track count -- which is six times the audio
 * that hour was measured and approved for.
 *
 * Measured (#1666, headless Chromium, `__staveBounceProbe.stemsStats`), audio
 * held at once and peak RSS across the whole browser:
 *
 *    10 min x 6    659 MB held    3.3 GB peak    ok
 *    30 min x 6   1978 MB held    4.9 GB peak    ok
 *    60 min x 6   4147 MB held    9.8 GB peak    FAILED
 *
 * The failure is a blob-storage read error (`NotReadableError`) raised while
 * the archive is built, and the app reports it as "Stems export failed" after
 * the renders have already been paid for.
 *
 * ⚠ THE FAILING SIZE IS THE MACHINE'S, NOT THE PRODUCT'S -- proven, not
 * assumed. The 30-minute case passed with 3.2 GB of free disk and FAILED on a
 * re-run with 845 MB free, because Chromium pages blob storage to disk. So no
 * threshold here is a product limit, and the rule rests instead on the two
 * things that did not move: the cost is exactly linear in seconds x tracks
 * (659 MB and 1978 MB are both exactly `secs * tracks * 48000 * 4`), and peak
 * memory runs about 2.2-2.5x the audio held.
 *
 * ⚠ AND STREAMING THE ZIP WOULD NOT HAVE FIXED IT. Reading the stems back
 * with no archive at all -- no jszip, no second copy, just a chunked read --
 * fails identically at the same size. What is expensive is the PILE, not the
 * copy, so the lever is how much audio is asked for, which is this.
 *
 * The budget is the one already decided: a stems export is offered the same
 * TOTAL audio as a mix bounce (#1652's hour), divided among its tracks. Six
 * tracks get ten minutes -- 659 MB, peaking at 3.3 GB, which is about what the
 * approved hour-long mix peaked at (3.0 GB). A typical song fits comfortably;
 * an hour of twelve-track stems does not, and can no longer be asked for.
 *
 * ⚠ It may under-count by one stem: a document whose song-level chain
 * makes sound no track owns gets an extra `(song)` stem, which cannot be known
 * until the render. That is the safe direction for a ceiling with this much
 * headroom.
 */
export function maxStemsSeconds(tracks: number): number {
  return Math.floor(MAX_OFFLINE_BOUNCE_SECONDS / Math.max(1, tracks))
}

/** How many repeats of a loop the modal offers. */
const REPEAT_CHOICES = [1, 2, 4, 8] as const

/** One thing the user can pick, already costed in seconds. */
export interface BounceOffer {
  readonly id: string
  /** What the user is choosing, in the document's own terms. */
  readonly label: string
  /** Wall-clock length, which for a real-time bounce is also the wait. */
  readonly seconds: number
}

/** `93` → `"1:33"`. Durations are read, not computed, by the person waiting. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Turn what we know about the document into things the user can pick.
 *
 * Returns song-aware offers when the document can size itself, and a `note`
 * saying why it cannot when it returns none. The note matters: falling back to
 * the seconds picker in silence looks identical whether we measured a document
 * and found no period, or never measured one at all — and the user can act on
 * the difference (an aperiodic sketch will not gain a period; an unevaluated one
 * will, if they press play).
 *
 * `offline` picks the ceiling (#1652): a render is offered far more than a live
 * take, which costs its own length in wall clock.
 *
 * `stemTracks` is how many stems the export would render, and 0 for a mix
 * (#1666). It is not a third path — it is the same offline render, asked for
 * `stemTracks` times over, so it takes the same shape of answer at a lower
 * ceiling. See `maxStemsSeconds`.
 */
export function bounceOffers(
  sizing: BounceSizing | null,
  offline: boolean,
  stemTracks = 0,
): {
  readonly offers: readonly BounceOffer[]
  readonly note: string | null
} {
  if (sizing == null) return { offers: [], note: null }

  const { length, cps } = sizing
  const stems = stemTracks > 0
  const ceiling = stems ? maxStemsSeconds(stemTracks) : maxBounceSeconds(offline)
  // Names the reason the user can act on: with stems it is the track count that
  // brought the ceiling down, and dropping a track or shortening the span are
  // both things they can do. "Longer than a bounce can render" would be false
  // here — the same length renders fine as a mix.
  const tooLong = stems
    ? `longer than a ${stemTracks}-track stems export can hold at once`
    : offline
      ? 'longer than a bounce can render in one go'
      : 'longer than a bounce can record in one take'
  if (length.kind === 'unknown') {
    return {
      offers: [],
      note:
        length.why === 'silent'
          ? 'This document has no sound in it yet, so there is no length to offer.'
          : length.why === 'no-document'
            ? 'Play or evaluate the file first and its length can be measured.'
            : 'This document has no repeating section the analysis could measure, so pick a length.',
    }
  }

  // Tempo is a SEPARATE fact from length, and this is the one place the
  // distinction bites: we know exactly how long the song is in cycles and still
  // cannot say how long that takes. Say so, rather than assuming Strudel's
  // default and handing back a confident number that is wrong off-tempo.
  if (cps == null) {
    return {
      offers: [],
      note: 'The tempo is not known yet — press play once and the song length can be offered.',
    }
  }

  if (length.kind === 'arranged') {
    const seconds = cyclesToSeconds(length.cycles, cps)
    if (seconds == null || seconds > ceiling) {
      return {
        offers: [],
        note:
          seconds == null
            ? null
            : `The whole arrangement runs ${formatDuration(seconds)}, ${tooLong}.`,
      }
    }
    return {
      offers: [{ id: 'whole', label: 'Whole song', seconds }],
      note: null,
    }
  }

  const offers: BounceOffer[] = []
  for (const n of REPEAT_CHOICES) {
    const seconds = cyclesToSeconds(length.periodCycles * n, cps)
    if (seconds == null || seconds > ceiling) continue
    offers.push({
      id: `loop-${n}`,
      label: n === 1 ? '1 repeat' : `${n} repeats`,
      seconds,
    })
  }
  // Every repeat over the ceiling — a single pass of the loop is already longer
  // than a bounce will record. Say that instead of silently offering nothing.
  if (offers.length === 0) {
    const one = cyclesToSeconds(length.periodCycles, cps)
    return {
      offers: [],
      note:
        one == null
          ? null
          : `One pass of this loop runs ${formatDuration(one)}, ${tooLong}.`,
    }
  }
  return { offers, note: null }
}
