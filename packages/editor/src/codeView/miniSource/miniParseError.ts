/**
 * Where a mini-notation parse error is in the document (#2174).
 *
 * Strudel names a line — `[mini] parse error at line N: …` (`@strudel/mini/mini.mjs`,
 * `mini2ast`) — and drops the column. Only a string the TRANSPILER rewrote can raise
 * it: a double-quoted or template literal, which becomes a `mini(…)` call that throws.
 * Every other string reaches Stave's string parser, which falls back to the plain value
 * when it is not mini notation (`engine/stringParser.ts`), so a single-quoted string
 * never raises this error and is never the answer here. For the transpiled strings the
 * line Strudel reports is the line of the character it stopped at.
 *
 * So: among the transpiled strings that krill rejects at that line, the first. The
 * column is where krill stopped reading — the bad character, or the closing quote when
 * it ran out of string (an unclosed `[`, a trailing `*`). If none is found, nothing:
 * no squiggle beats one in the wrong place.
 */

import { SpanIndex, literalInterior } from './spanRole'
import { miniParseFailure } from '../strudelMini/tree'

const MINI_PARSE_ERROR = /^\[mini\] parse error at line (\d+):/

export function locateMiniParseError(
  message: unknown,
  doc: string,
): { line: number; column: number } | null {
  if (typeof message !== 'string') return null
  const m = message.match(MINI_PARSE_ERROR)
  if (!m) return null
  const reportedLine = parseInt(m[1], 10)
  const index = SpanIndex.build(doc)
  if (!index) return null

  for (const lit of index.literals) {
    const transpiled =
      lit.type === 'TemplateLiteral' ? !lit.expressions?.length : doc[lit.start] === '"'
    if (!transpiled) continue
    const [from, to] = literalInterior(lit)
    const failure = miniParseFailure(doc.slice(from, to))
    if (failure === null) continue
    const at = from + failure
    const before = doc.slice(0, at)
    if (before.split('\n').length !== reportedLine) continue
    return { line: reportedLine, column: at - before.lastIndexOf('\n') }
  }
  return null
}
