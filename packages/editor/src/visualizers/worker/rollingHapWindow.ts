/**
 * RollingHapWindow — the wide `stave.scheduler` window (now−back … now+fwd),
 * kept up to date by querying only the NEW sliver each frame (#2563).
 *
 * The window is several cycles wide but moves by ~1/60 of a cycle per frame, so
 * re-querying all of it every frame (what the sampler did) re-derives the same
 * haps ~360 times over. With a dense song that whole-window query was most of
 * the main thread during Play (#2561, #2563).
 *
 * How it stays equal to a full query:
 *   - Event `begin`/`end` are the hap's WHOLE span (`normalizeStrudelHap` reads
 *     `hap.whole`), so a note crossing a slice edge carries the same begin in
 *     every slice. From each new slice `[lastEnd, now+fwd+PREFETCH)` we keep only notes
 *     whose onset is in the slice (`begin >= lastEnd`); a note that started
 *     earlier was kept by the slice its onset fell in.
 *   - Notes are dropped once they end at or before `now−back` (they no longer
 *     intersect the window).
 *   - The first query after a reset is the full window, kept whole (it includes
 *     notes that started before the window and still sound).
 *   - A reset (full re-query) happens when the scheduler changes (re-evaluate
 *     rebinds the sampler), when `now` goes backwards (stop/restart, a seek),
 *     or when it jumps past the whole window in one step.
 *
 * Known difference from a full query: a hap Strudel splits at a cycle boundary
 * comes back as two fragments with the same whole; a full query returns both
 * fragments every frame, the rolling window keeps the fragment(s) returned in
 * the slice holding the onset. Same notes, at most fewer duplicates.
 */

import type { IRPattern, IREvent } from '../../codeView'

/**
 * Edge tolerance (cycles). Window edges are floats (`now − 4`), but Strudel turns
 * a query's bounds into Fractions, which snap a float within ~1e-9 of a simple
 * rational onto it (11.2499999… → 45/4). So at an edge, Strudel's answer is
 * "is the onset/end past the SNAPPED edge". Comparing against the raw float
 * either loses a note whose onset sits exactly on a slice edge (it is in neither
 * slice by our check) or keeps one that ends exactly on the window's low edge
 * (a full query drops it). Note times are small-denominator rationals, so no
 * real onset or end lies within 1e-6 of an edge without being ON it.
 */
export const EDGE = 1e-6

/**
 * How far past the window's front edge each new query reaches (cycles). Every
 * Strudel query pays a fixed cost to walk the whole pattern tree, however short
 * the span, so a 1/60-cycle sliver per frame still costs ~60 tree walks a
 * second. Fetching half a cycle ahead makes it ~one query per half cycle; the
 * extra haps are held back until the window reaches them.
 */
const PREFETCH = 0.5

export class RollingHapWindow {
  private sched: IRPattern | null = null
  private events: IREvent[] = []
  /** End of the span already queried (cycles); NaN = nothing queried yet. */
  private lastEnd = NaN
  private lastNow = NaN

  constructor(
    private readonly back: number,
    private readonly fwd: number,
  ) {}

  /** Forget everything; the next `at()` runs one full query. */
  reset(): void {
    this.sched = null
    this.events = []
    this.lastEnd = NaN
    this.lastNow = NaN
  }

  /**
   * The haps intersecting `[now−back, now+fwd)` for `sched`. `query` runs the
   * actual scheduler query (the sampler routes it through the per-tick cache).
   */
  at(sched: IRPattern, now: number, query: (a: number, b: number) => IREvent[]): IREvent[] {
    return this.inWindow(this.advance(sched, now, query))
  }

  /**
   * Bring the held haps up to `now` (query the new slice if the front edge has
   * passed the prefetched span; drop what ended behind the window) without
   * building the window's answer. Returns the window's front edge.
   */
  advance(sched: IRPattern, now: number, query: (a: number, b: number) => IREvent[]): number {
    const lo = now - this.back
    const hi = now + this.fwd
    const stale =
      sched !== this.sched ||
      !Number.isFinite(this.lastEnd) ||
      now < this.lastNow ||
      lo >= this.lastEnd
    if (stale) {
      this.sched = sched
      this.events = query(lo, hi + PREFETCH).filter((e) => e.end > lo + EDGE)
      this.lastEnd = hi + PREFETCH
      this.lastNow = now
      return hi
    }
    if (hi > this.lastEnd) {
      const from = this.lastEnd
      const to = hi + PREFETCH
      for (const e of query(from, to)) {
        if (e.begin >= from - EDGE) this.events.push(e)
      }
      this.lastEnd = to
    }
    this.lastNow = now
    // Drop what no longer intersects the window (compact in place, order kept).
    let w = 0
    for (let r = 0; r < this.events.length; r++) {
      const e = this.events[r]
      if (e.end > lo + EDGE) this.events[w++] = e
    }
    this.events.length = w
    return hi
  }

  /**
   * The first time after `now` at which a query of `[t, t+span)` could answer
   * differently: a held note's `begin − span` (it starts to intersect) or its
   * `end` (it stops), capped at `lastEnd − span`, beyond which nothing has been
   * fetched yet. Call after `advance(…, now, …)`.
   */
  nextChange(now: number, span: number): number {
    let next = this.lastEnd - span
    for (const e of this.events) {
      const on = e.begin - span
      if (on > now && on < next) next = on
      if (e.end > now && e.end < next) next = e.end
    }
    return next
  }

  /** The held haps that have started before the window's front edge (the rest
   *  were prefetched and wait for the window to reach them). */
  private inWindow(hi: number): IREvent[] {
    return this.events.filter((e) => e.begin < hi - EDGE)
  }
}
