/**
 * Shared event store for every runtime's info / warn / error messages.
 *
 * Goal: one stream of structured log entries that multiple UI surfaces
 * subscribe to — toast on new errors, status-bar LED counting new
 * entries since last opened, Monaco inline markers on the offending
 * file, and a dedicated Console panel with history + filters. Each
 * runtime (Strudel, Sonic Pi, p5.js, Hydra) emits through the same
 * `emitLog` entry point so downstream consumers don't need per-runtime
 * special-casing.
 *
 * The store keeps a bounded history (MAX_HISTORY most recent entries).
 * Listeners are fired synchronously on emit so UI surfaces can update
 * in the same microtask as the runtime error handler.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export type RuntimeId =
  | 'strudel'
  | 'sonicpi'
  | 'p5'
  | 'hydra'
  | 'glsl'
  /** Stave-itself errors (engine init, host-side failures). */
  | 'stave'

/**
 * "Did you mean X?" hint produced by the friendly-error formatter from
 * a fuzzy match against the runtime's `DocsIndex`. Carried on the log
 * entry so every UI surface (toast, console row, Monaco marker) can
 * render it the same way.
 */
export interface LogSuggestion {
  /**
   * Canonical symbol name (e.g. `noise`) — empty when the hint is not about
   * one symbol, so "try `name`" is never said of something else (#2170).
   */
  name: string
  /** #2167 — what the link reads as when it is not a symbol's docs (`#2169`). */
  linkLabel?: string
  /** In-app docs page for the suggested symbol. */
  docsUrl: string
  /** One-line example if the DocsIndex carried one. */
  example?: string
  /** First-sentence description if present. */
  description?: string
}

export interface LogEntry {
  /** Monotonic-ish unique id — used as React key, preserved through history. */
  id: string
  /** Epoch ms when the entry was emitted. */
  ts: number
  level: LogLevel
  runtime: RuntimeId
  /** Workspace file path this entry originated from, if known. */
  source?: string
  /** 1-indexed line number inside `source`, if known. */
  line?: number
  column?: number
  message: string
  suggestion?: LogSuggestion
  /** Raw error stack for the "expand stack" fold. */
  stack?: string
  /**
   * How many times this identical entry has been emitted (1 on first
   * emit). Repeats — even non-consecutive ones — coalesce into this entry
   * (same `id`, position kept, `ts` bumped) and increment `count`; the
   * Console shows a `×N` badge. Without this a per-cycle runtime error
   * (e.g. a soundfont out-of-range note firing every beat) would flood the
   * panel with endless rows. (#563) Optional on the wire — `emitLog` always
   * stamps it (1 on first emit), so a present entry always has it; treat
   * absent as 1.
   */
  count?: number
}

type LogListener = (
  entry: LogEntry | null,
  history: readonly LogEntry[],
) => void

/**
 * Signal that a `(runtime, source)` pair has just evaluated cleanly.
 * Live-mode filters use the marker timestamp to hide any log entry
 * emitted BEFORE it — "old errors the user has since fixed".
 */
export interface FixedMarker {
  runtime: RuntimeId
  /** Workspace file path (or omitted → runtime-wide fix). */
  source?: string
  /** Epoch ms when the fix happened. */
  ts: number
}

type FixedListener = (
  marker: FixedMarker,
  markers: ReadonlyMap<string, number>,
) => void

const MAX_HISTORY = 500

const history: LogEntry[] = []
/**
 * Coalescing index: dedup-key → the live entry that owns it. Lets identical
 * entries merge into one row (bump count + ts) even when NOT consecutive — a
 * repeating GROUP of distinct messages (e.g. a soundfont flood cycling
 * `c7,d7,e7,…` each beat) otherwise defeats a compare-to-last dedup. Kept in
 * sync with `history` on eviction / clear / test-reset. (#563)
 */
const dedupeIndex = new Map<string, LogEntry>()
const listeners = new Set<LogListener>()
const fixedMarkers = new Map<string, number>()
const fixedListeners = new Set<FixedListener>()

let idSeq = 0

function fixedKey(runtime: RuntimeId, source: string | undefined): string {
  return `${runtime}:${source ?? '*'}`
}

function makeId(): string {
  idSeq += 1
  return `log-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

/** Identity for coalescing — same (level, runtime, source, line, message) →
 *  same row. `\0` separates fields so values can't run together. */
function dedupeKey(p: Omit<LogEntry, 'id' | 'ts' | 'count'>): string {
  return [p.level, p.runtime, p.source ?? '', p.line ?? '', p.message].join('\0')
}

/**
 * Emit a log entry. Returns the full entry (with generated id + ts) so
 * callers can hold a reference for later deduplication or jumping. A
 * `null` listener signal is reserved for `clearLog` / reset — emitLog
 * always passes the emitted entry.
 */
export function emitLog(
  partial: Omit<LogEntry, 'id' | 'ts' | 'count'>,
): LogEntry {
  // Coalesce: if an identical entry (same level/runtime/source/line/message)
  // is already in the buffer, treat this as a repeat — bump its `count` + `ts`
  // and keep its position, rather than pushing a new row. Without this, a
  // per-cycle runtime error (a p5 FES warning from `draw()`, or a soundfont
  // out-of-range note firing every beat) floods the Console with endless rows.
  // Matching by KEY rather than just the previous entry (#563) is what lets a
  // repeating GROUP of distinct messages collapse — a compare-to-last dedup
  // never fires when `c7,d7,e7,…` cycle each beat. The stretched timestamp also
  // keeps the entry "newer than" the last emitFixed so Live mode keeps
  // surfacing it (still broken — no reason to suppress the reminder).
  const key = dedupeKey(partial)
  const existing = dedupeIndex.get(key)
  if (existing) {
    existing.ts = Date.now()
    existing.count = (existing.count ?? 1) + 1
    // Listeners still fire — UIs re-render the row's count/timestamp. They can
    // dedupe via `entry.id` (stable across repeats) if they want one toast.
    queueMicrotask(() => {
      for (const fn of listeners) {
        try {
          fn(existing, history)
        } catch {
          /* swallow */
        }
      }
    })
    return existing
  }
  const entry: LogEntry = {
    id: makeId(),
    ts: Date.now(),
    count: 1,
    ...partial,
  }
  history.push(entry)
  dedupeIndex.set(key, entry)
  // Bound the buffer — drop oldest when past the cap. Listeners see
  // only the newest entry; they can re-read getLogHistory() if they
  // need the whole window. Evicted entries leave the dedupe index too,
  // so a key can re-appear as a fresh row later (only if it still maps
  // to the evicted entry — a newer entry may have re-claimed the key).
  if (history.length > MAX_HISTORY) {
    const removed = history.splice(0, history.length - MAX_HISTORY)
    for (const r of removed) {
      const rk = dedupeKey(r)
      if (dedupeIndex.get(rk) === r) dedupeIndex.delete(rk)
    }
  }
  // Fire listeners in a microtask so runtime error paths (Strudel
  // onEvalError, Monaco marker commit, etc.) aren't forced to re-enter
  // React's commit phase with React setStates happening from
  // subscribers — mid-eval state updates caused the whole subtree to
  // unmount when a live syntax error interleaved with the engine's
  // own error reporting. Deferred is still fast enough (<1ms) for toast
  // + status bar feel instantaneous.
  queueMicrotask(() => {
    for (const fn of listeners) {
      try {
        fn(entry, history)
      } catch {
        // A broken subscriber shouldn't kill the emitter.
      }
    }
  })
  return entry
}

/**
 * Subscribe to every future log entry. Returns an unsubscribe. Does
 * NOT replay history — consumers that need it should call
 * `getLogHistory()` on mount.
 */
export function subscribeLog(fn: LogListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Read the current history in chronological order. Safe to mutate the
 * returned array; we give back a frozen slice of the internal buffer.
 */
export function getLogHistory(): readonly LogEntry[] {
  return [...history]
}

/**
 * Empty the history and fire a `null` notification so subscribers can
 * reset their local state (clear marker maps, zero the LED counter).
 */
export function clearLog(): void {
  history.length = 0
  dedupeIndex.clear()
  fixedMarkers.clear()
  for (const fn of listeners) {
    try {
      fn(null, history)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Record that `(runtime, source)` just evaluated cleanly. Non-destructive:
 * history is preserved. Consumers (the Console panel's Live mode) use
 * the marker timestamp to hide entries emitted before the fix. Called
 * from the runtime's `onEvaluateSuccess` bridge.
 */
export function emitFixed(input: {
  runtime: RuntimeId
  source?: string
}): FixedMarker {
  const marker: FixedMarker = {
    runtime: input.runtime,
    source: input.source,
    ts: Date.now(),
  }
  fixedMarkers.set(fixedKey(input.runtime, input.source), marker.ts)
  queueMicrotask(() => {
    for (const fn of fixedListeners) {
      try {
        fn(marker, fixedMarkers)
      } catch {
        /* A broken subscriber shouldn't kill the emitter. */
      }
    }
  })
  return marker
}

/**
 * Subscribe to fix events. Does NOT replay existing markers — call
 * `getFixedMarkers()` on mount if a starting snapshot is needed.
 */
export function subscribeFixed(fn: FixedListener): () => void {
  fixedListeners.add(fn)
  return () => {
    fixedListeners.delete(fn)
  }
}

/** Read the current fix-marker table. Key format: `${runtime}:${source|*}`. */
export function getFixedMarkers(): ReadonlyMap<string, number> {
  return new Map(fixedMarkers)
}

/** Key helper exported for consumers that need to build the same key. */
export function makeFixedKey(
  runtime: RuntimeId,
  source: string | undefined,
): string {
  return fixedKey(runtime, source)
}

/**
 * TESTING ONLY — wipe state between vitest suites so module-level
 * history doesn't leak across tests.
 */
export function __resetEngineLogForTests(): void {
  history.length = 0
  dedupeIndex.clear()
  listeners.clear()
  fixedMarkers.clear()
  fixedListeners.clear()
  idSeq = 0
}
