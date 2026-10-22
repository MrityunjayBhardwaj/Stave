/**
 * tempo.ts — the tempo a document SETS, read from its code (#1925).
 *
 * Strudel's tempo setters are a family of four top-level calls — `setcps`,
 * `setCps`, `setcpm`, `setCpm` — where the `cpm` pair takes cycles per MINUTE
 * (`repl.mjs`: `setCpm = (cpm) => scheduler.setCps(cpm / 60)`; the same audit is
 * cited beside `PRELUDE_CALL_RE` in `ir/parseStrudel.ts`). Each runs when its
 * statement does, so the LAST one sets the tempo the music starts at.
 *
 * Read from the parsed top-level statements, not from the text: a commented-out
 * `// setcps(0.25)` is not a tempo, and the regex readers this replaces took the
 * first match anywhere, comments included (measured: `// setcps(0.25)` above
 * `setcps(0.5)` showed 60 BPM while the scheduler ran at 0.5 cps).
 *
 * ⚠ THIS IS WHAT THE CODE SAYS, NOT WHAT THE SCHEDULER RUNS. A document with no
 * setter plays at Strudel's default, and a pattern can change cps mid-song from a
 * hap value; neither is visible here. Anything converting cycles to seconds asks
 * the engine (`StrudelEngine.getCps`) instead.
 *
 * This module is pure.
 */
import { parseTopLevel } from './astParse'
import type { TEMPO_SETTERS } from './ir/statementHeads'

/**
 * The setter family, and what each one's argument is measured in. The names are
 * the shared `TEMPO_SETTERS`: leaving one out, or adding a name that isn't on that
 * list, fails to compile (#1927).
 */
const SETTERS: Readonly<Record<string, 'cps' | 'cpm'>> = {
  setcps: 'cps',
  setCps: 'cps',
  setcpm: 'cpm',
  setCpm: 'cpm',
} satisfies Record<(typeof TEMPO_SETTERS)[number], 'cps' | 'cpm'>

/**
 * The cycles per second the document sets:
 *  - a number — the last setter statement's argument, `setcpm(n)` read as `n / 60`;
 *  - `'unknown'` — the last setter's argument is not literal arithmetic
 *    (`setcps(tempo)`), or the document does not parse, so it cannot be read;
 *  - `null` — no setter statement at all.
 *
 * `'unknown'` is never filled in from an earlier setter: the last one is the one
 * that runs, and reporting the one before it would be a tempo the music does not
 * start at.
 */
export function writtenCps(doc: string): number | 'unknown' | null {
  const body = parseTopLevel(doc)
  if (body === null) return 'unknown'
  let found: number | 'unknown' | null = null
  for (const stmt of body) {
    const call = stmt?.type === 'ExpressionStatement' ? stmt.expression : null
    if (call?.type !== 'CallExpression' || call.callee?.type !== 'Identifier') continue
    const unit = SETTERS[call.callee.name]
    if (!unit) continue
    const value = call.arguments.length === 1 ? literalNumber(call.arguments[0]) : null
    found = value === null ? 'unknown' : unit === 'cpm' ? value / 60 : value
  }
  return found
}

/**
 * The value of an expression made only of number literals and `+ - * /`, or null.
 * `92/240` and `130/60/4` are how tempos are written; anything with a name in it
 * is somebody's code and is not evaluated here.
 */
function literalNumber(node: any): number | null {
  if (!node) return null
  if (node.type === 'Literal') return typeof node.value === 'number' && Number.isFinite(node.value) ? node.value : null
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+')) {
    const v = literalNumber(node.argument)
    return v === null ? null : node.operator === '-' ? -v : v
  }
  if (node.type === 'BinaryExpression') {
    const a = literalNumber(node.left)
    const b = literalNumber(node.right)
    if (a === null || b === null) return null
    const v =
      node.operator === '+' ? a + b
      : node.operator === '-' ? a - b
      : node.operator === '*' ? a * b
      : node.operator === '/' ? a / b
      : null
    return v !== null && Number.isFinite(v) ? v : null
  }
  return null
}

/**
 * The play bar's BPM for the tempo the document sets, or undefined when it sets
 * none that can be read. Four quarter notes per cycle: `setcps(92/240)` → 92,
 * the conventional Strudel spelling of 92 BPM (#599 fixed a copy that multiplied
 * by 60 and showed a quarter of it). The transport LCD converts with the user's
 * meter instead (`app/src/lib/meter.ts cpsToBpm`); this readout assumes 4/4.
 */
export function writtenBpm(doc: string): number | undefined {
  const cps = writtenCps(doc)
  return typeof cps === 'number' ? Math.round(cps * 240) : undefined
}
