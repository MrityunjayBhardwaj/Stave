/**
 * Pure transform functions on IREvent arrays.
 *
 * No classes, no state. Each function takes events in, returns events out.
 * Composable: transpose(filter(events, pred), 12)
 */

import type { IREvent } from './IREvent'
import type { IRPattern } from './IRPattern'

/**
 * Merge multiple patterns into one. Events from all sources appear
 * in the merged query result, sorted by begin time.
 *
 * CONSTRAINT: All patterns must use the same time domain (all cycles
 * or all audio-seconds). Merging across time domains is undefined.
 */
export function merge(patterns: IRPattern[]): IRPattern {
  return {
    now: () => patterns[0]?.now() ?? 0,
    query(begin: number, end: number): IREvent[] {
      const all: IREvent[] = []
      for (const p of patterns) {
        all.push(...p.query(begin, end))
      }
      return all.sort((a, b) => a.begin - b.begin)
    },
  }
}

/**
 * Transpose note values by a number of semitones.
 * String notes are left unchanged (no enharmonic spelling logic).
 */
export function transpose(events: IREvent[], semitones: number): IREvent[] {
  return events.map(e => ({
    ...e,
    note: typeof e.note === 'number' ? e.note + semitones : e.note,
    freq: e.freq !== null ? e.freq * Math.pow(2, semitones / 12) : null,
  }))
}

/**
 * Scale time positions by a factor.
 * factor < 1 = compress (faster), factor > 1 = stretch (slower).
 */
export function timestretch(events: IREvent[], factor: number): IREvent[] {
  return events.map(e => ({
    ...e,
    begin: e.begin * factor,
    end: e.end * factor,
    endClipped: e.endClipped * factor,
  }))
}

/**
 * Filter events by predicate. Returns only events where pred returns true.
 */
export function filter(events: IREvent[], pred: (e: IREvent) => boolean): IREvent[] {
  return events.filter(pred)
}

/**
 * Scale gain of all events by a factor.
 */
export function scaleGain(events: IREvent[], factor: number): IREvent[] {
  return events.map(e => ({
    ...e,
    gain: Math.min(1, Math.max(0, e.gain * factor)),
  }))
}
