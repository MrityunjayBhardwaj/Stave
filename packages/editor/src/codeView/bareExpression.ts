// Which statement a song plays when it has no live `$:` label (#2066, #2067).
//
// Strudel plays the live labelled patterns when there are any, and ignores the
// value of a bare expression (`repl.mjs`: the `pPatterns` branch replaces
// `pattern`); with none, it plays the LAST statement (`transpiler.mjs` returns
// it). A muted label (`_$:`, `name_:`) registers nothing (`Pattern.p` returns
// `silence` for an id that starts or ends with `_`). So a song "plays a bare
// expression" when no live label exists and its last statement is an expression.
//
// Two readers: the Library's Insert labels that expression so a new `$:` line
// does not silence it, and the notice that says a `$:` track is how Stave shows
// it best. One predicate, so the two never disagree about which line plays.

import { parseTopLevel } from './astParse'
import { isMutedLabel } from './ir/trackId'

/**
 * Calls a song makes for its setup, not for its sound: as the last statement
 * they play nothing, and a `$:` in front of one would be wrong advice (and
 * `samples(…)` returns a promise, which has no `.p` to register).
 */
const SETUP_CALLS = new Set(['samples', 'setcps', 'setCps', 'setcpm', 'setCpm', 'hush'])

type Statement = {
  type: string
  start: number
  label?: { name: string }
  expression?: { type: string; callee?: { type: string; name?: string } }
}

/**
 * Where the bare expression the song plays starts, or null when the song plays
 * its labels, plays nothing, or ends in a setup call. Takes parsed top-level
 * statements (`parseTopLevel`).
 */
export function bareExpressionOf(statements: readonly Statement[]): number | null {
  if (statements.some((s) => s.type === 'LabeledStatement' && !isMutedLabel(s.label?.name))) return null
  const last = statements[statements.length - 1]
  if (last?.type !== 'ExpressionStatement') return null
  const e = last.expression
  if (e?.type === 'AwaitExpression') return null
  if (e?.type === 'CallExpression' && e.callee?.type === 'Identifier' && SETUP_CALLS.has(e.callee.name ?? '')) {
    return null
  }
  return last.start
}

/** `bareExpressionOf` over source; null too when the source does not parse. */
export function playsBareExpression(code: string): number | null {
  const statements = parseTopLevel(code)
  return statements ? bareExpressionOf(statements) : null
}
