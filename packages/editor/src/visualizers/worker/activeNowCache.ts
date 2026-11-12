/**
 * ActiveNowCache — "what's playing now" for one scheduler, re-queried only when
 * the answer can change (#2567).
 *
 * The sampler reads the active-at-now haps (`query(now, now + ε)`) for the
 * combined pattern and for every track, every frame: with 40 tracks that's
 * ~2,400 Strudel queries a second, and each pays a fixed walk of the pattern
 * tree however short its span. But the answer only changes when a note starts
 * (`begin − ε`, when it enters `[now, now+ε)`) or ends (`end`). So:
 *
 *   - keep the upcoming notes in a `RollingHapWindow` (one query per half cycle);
 *   - run the REAL `query(now, now + ε)` only when `now` reaches the next start
 *     or end the window knows of (or the window's fetched edge, beyond which
 *     nothing is known), and hand back that same answer until then.
 *
 * The answer is always the output of a real query, so fragments, duplicates and
 * every field are exactly what a per-frame query returns at the moment it was
 * taken. Re-querying early is always safe (it's just a query), so the change
 * time is checked with a small margin (`EDGE`) to absorb Strudel snapping float
 * bounds to Fractions.
 *
 * Known difference: a pattern with no discrete events (a bare continuous signal
 * as a whole track) reports values that drift continuously; this cache holds
 * the last value until the next re-query (at most half a cycle). The sampler's
 * active summary reads only `s`, `velocity`, `note` and `color`.
 */

import type { IRPattern, IREvent } from '../../codeView'
import { RollingHapWindow, EDGE } from './rollingHapWindow'

export class ActiveNowCache {
  private readonly window = new RollingHapWindow(0, 0)
  private sched: IRPattern | null = null
  private answer: IREvent[] = []
  private validUntil = -Infinity
  private lastNow = NaN

  constructor(private readonly span: number) {}

  reset(): void {
    this.window.reset()
    this.sched = null
    this.answer = []
    this.validUntil = -Infinity
    this.lastNow = NaN
  }

  /** The haps a `query(now, now + span)` returns, re-queried only on a change. */
  at(sched: IRPattern, now: number, query: (a: number, b: number) => IREvent[]): IREvent[] {
    this.window.advance(sched, now, query)
    const stale =
      sched !== this.sched ||
      !(now >= this.lastNow) || // first call (NaN) or time went backwards
      now >= this.validUntil - EDGE
    this.lastNow = now
    if (stale) {
      this.sched = sched
      this.answer = query(now, now + this.span)
      this.validUntil = this.window.nextChange(now, this.span)
    }
    return this.answer
  }
}
