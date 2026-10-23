/**
 * #2201 — Strudel's own messages in Stave's Console.
 *
 * Strudel reports through one logger (`@strudel/core/logger.mjs`): `.log()`
 * output, warnings about the code (`[tonal] transpose: not a note "foo"`),
 * samples that fail to load. Its logger dispatches each message on `document`,
 * and Strudel's own console shows every one (`website/src/repl/components/
 * useLogger.jsx`, `panel/ConsoleTab.jsx` at f73b3956). Stave showed none of
 * them, except errors raised while a pattern plays (#2173).
 *
 * The event goes to the whole page, and Stave runs one engine per Strudel
 * file, so ONE listener asks each engine whether the message is its own
 * (`claimLog`). An engine owns what is raised while its code runs: its
 * evaluate, its scheduler's query, its output step, or a note it played
 * (`.log()` carries the note). A message no engine owns is shown without a
 * file, unless it was raised inside some other query — a visual's, or the
 * quiet evaluate behind the timeline (#1172) — which Stave can't place, and
 * which the play-time error path already leaves out for the same reason.
 */

import { emitLog, type LogLevel } from './engineLog'

export interface StrudelLogDetail {
  message?: unknown
  type?: unknown
  data?: unknown
}

export interface StrudelLogRow {
  level: LogLevel
  message: string
  /**
   * Written by Strudel's `errorLogger` (`[origin] error: message`). While a
   * pattern plays, these are raised as error rows by the play-time path, and
   * an evaluate's own failure comes back as its result, so an owner shows them
   * only from its output step.
   */
  raisedAsError: boolean
}

/**
 * Messages about something Stave already shows another way: the evaluation
 * (the lamp and the error rows), the transport starting and stopping,
 * Strudel's start-up, and a development-only notice about superdough's own
 * code (`helpers.mjs`, gated on `NODE_ENV === 'development'`).
 */
const LEFT_OUT: readonly RegExp[] = [
  /^\[eval\] /,
  /^\[cyclist\] (?:start|stop|pause)$/,
  /^🌀 @strudel\/core loaded 🌀$/,
  /^\[superdough\] (?:ready|AudioWorklets loaded)$/,
  /^\[superdough\]: AudioWorklets disabled/,
  /^\[webaudio\] (?:preloading|start rendering)$/,
  /^\[superdough\] Deprecation warning: /,
]

/**
 * The first half of a load ("load sound …..") that Strudel's own console
 * replaces with the second ("… done! loaded …") — so Stave shows only the second.
 */
const IN_PROGRESS_TYPES = new Set(['load-sample', 'load-table'])

/** What one `strudel.log` entry shows as, or `null` when it is left out. */
export function strudelLogRow(detail: unknown): StrudelLogRow | null {
  const { message, type } = (detail ?? {}) as StrudelLogDetail
  if (typeof message !== 'string' || message.length === 0) return null
  if (typeof type === 'string' && IN_PROGRESS_TYPES.has(type)) return null
  if (LEFT_OUT.some((re) => re.test(message))) return null
  const raisedAsError = /^\[[^\]]+\] error: /.test(message)
  // Strudel's own levels: `error` and `warning`. `highlight` (a sound that took
  // too long to load) is underlined there, a step above plain text.
  const level: LogLevel =
    raisedAsError || type === 'error' ? 'error' : type === 'warning' || type === 'highlight' ? 'warn' : 'info'
  return { level, message, raisedAsError }
}

/**
 * How an engine's code was running when the message was raised. A query or an
 * output step is synchronous, so its claim is certain; an evaluate spans awaits,
 * during which another file's scheduler can tick, so it yields to them.
 */
export type LogClaim = 'evaluate' | 'query' | 'play'
const CLAIM_RANK: Record<LogClaim, number> = { query: 2, play: 2, evaluate: 1 }

export interface StrudelLogOwner {
  claimLog(detail: StrudelLogDetail): LogClaim | null
  takeLog(row: StrudelLogRow, claim: LogClaim): void
}

const owners = new Set<StrudelLogOwner>()
/** Queries of any pattern under way — a visual's, the timeline's, a scheduler's. */
const anyQuery = { depth: 0 }
let stopListening: (() => void) | null = null
const COUNTED = Symbol.for('stave.strudelLogBridge.counted')

/**
 * Count every query of every pattern, so a message raised inside one that no
 * engine claims is known to come from code Stave can't place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countQueries(Pattern: any): void {
  const proto = Pattern?.prototype
  if (!proto || typeof proto.queryArc !== 'function' || proto[COUNTED]) return
  const queryArc = proto.queryArc
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto.queryArc = function (this: unknown, ...args: any[]) {
    anyQuery.depth++
    try {
      return queryArc.apply(this, args)
    } finally {
      anyQuery.depth--
    }
  }
  proto[COUNTED] = true
}

/** Route one `strudel.log` entry. Exported for tests. */
export function routeStrudelLog(detail: unknown): void {
  const row = strudelLogRow(detail)
  if (!row) return
  let best: { owner: StrudelLogOwner; claim: LogClaim } | null = null
  for (const owner of owners) {
    const claim = owner.claimLog((detail ?? {}) as StrudelLogDetail)
    if (claim && (!best || CLAIM_RANK[claim] > CLAIM_RANK[best.claim])) best = { owner, claim }
  }
  if (best) {
    best.owner.takeLog(row, best.claim)
    return
  }
  if (anyQuery.depth > 0) return
  emitLog({ level: row.level, runtime: 'strudel', message: row.message })
}

/**
 * Register an engine as a possible owner of Strudel's messages. The first
 * registration installs the one listener; the last one removed takes it down.
 */
export function registerStrudelLogOwner(
  owner: StrudelLogOwner,
  logKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Pattern: any,
): () => void {
  countQueries(Pattern)
  owners.add(owner)
  if (!stopListening && typeof document !== 'undefined') {
    const onLog = (event: Event) => routeStrudelLog((event as CustomEvent).detail)
    document.addEventListener(logKey, onLog)
    stopListening = () => document.removeEventListener(logKey, onLog)
  }
  return () => {
    owners.delete(owner)
    if (owners.size === 0) {
      stopListening?.()
      stopListening = null
    }
  }
}

/** Test seam: a query under way, as `countQueries` would count it. */
export function __withQueryForTests<T>(run: () => T): T {
  anyQuery.depth++
  try {
    return run()
  } finally {
    anyQuery.depth--
  }
}
