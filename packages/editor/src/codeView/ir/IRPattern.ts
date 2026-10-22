/**
 * IRPattern — the universal queryable music pattern.
 *
 * Any engine that can answer "what happens between time A and time B?"
 * implements this interface. Viz renderers, the DAW timeline, and
 * transforms all consume IRPattern.
 *
 * Time domain matches the producing engine's scheduler — consumers
 * compare query results against now() in the same domain.
 */

import type { IREvent } from './IREvent'

export interface IRPattern {
  /** Current time position in the pattern's time domain. */
  now(): number
  /** Query events overlapping the time range [begin, end). */
  query(begin: number, end: number): IREvent[]
}
