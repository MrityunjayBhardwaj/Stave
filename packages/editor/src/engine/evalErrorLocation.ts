/**
 * #2175 — where an error thrown while evaluated code runs was written.
 *
 * Strudel's transpiler regenerates the whole program before it runs
 * (escodegen), and `@strudel/core`'s evaluate (`evaluate.mjs`, `safeEval`)
 * runs the result inside a wrapper function. So the line and column in the
 * error's stack belong to the generated code, and the gap to the user's line
 * changes from statement to statement: no fixed offset can correct it.
 *
 * The patched transpiler (`patches/@strudel__transpiler@1.2.6.patch`) returns a
 * source map when asked (`sourceMap: true`). This takes the stack position,
 * removes the wrapper (measured once by `measureEvalFrame`, since the header a
 * `Function` body gets differs between JS engines), and looks the position up
 * in that map. Every step that cannot answer returns null, and the caller
 * keeps the error without a line, as before.
 */
import { parseStackLocation } from './friendlyErrors'

/** How `safeEval`'s wrapper shifts a position in the generated code. */
export interface EvalFrameShape {
  /** lines the JS engine puts before the function body */
  headerLines: number
  /** characters before the generated code on its first line */
  firstLineColumns: number
}

/** A source map, as the patched transpiler returns it (v3 JSON). */
export interface TranspiledWithMap {
  map?: { mappings: string }
}

// @strudel/core evaluate.mjs `safeEval` with `wrapExpression` and `wrapAsync`
// on — the way `evaluate` runs transpiled code.
const wrapLikeSafeEval = (code: string): string =>
  `"use strict";return ((async ()=>{${code}})())`

async function stackPositionOf(code: string): Promise<{ line: number; column: number } | null> {
  try {
    await Function(wrapLikeSafeEval(code))()
  } catch (e) {
    return parseStackLocation(e)
  }
  return null
}

const PROBE = '__staveEvalFrameProbe__'

/**
 * Throw from line 1 and from line 2 of code wrapped like `safeEval` wraps it,
 * and read back where the stack puts each throw. Null when the two disagree
 * with a plain shift, which turns the mapping off.
 */
export async function measureEvalFrame(): Promise<EvalFrameShape | null> {
  const first = await stackPositionOf(`${PROBE}()`)
  const second = await stackPositionOf(`0;\n${PROBE}()`)
  if (!first || !second) return null
  if (second.line !== first.line + 1 || second.column !== 1) return null
  return { headerLines: first.line - 1, firstLineColumns: first.column - 1 }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** One segment of a source map's `mappings` (base64 VLQ). */
function decodeSegment(segment: string): number[] | null {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = BASE64.indexOf(ch)
    if (digit < 0) return null
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0
      shift = 0
    }
  }
  return values
}

/**
 * The source position mapped at or before `column` (0-based) on generated
 * `line` (1-based), as 1-based line and column. Source fields are relative
 * across the whole map, so every line before `line` is decoded too.
 */
export function originalPositionFor(
  mappings: string,
  line: number,
  column: number,
): { line: number; column: number } | null {
  const lines = mappings.split(';')
  if (line < 1 || line > lines.length) return null
  let sourceLine = 0
  let sourceColumn = 0
  let best: { line: number; column: number } | null = null
  for (let l = 0; l < line; l++) {
    let generatedColumn = 0
    for (const segment of lines[l].split(',')) {
      if (!segment) continue
      const v = decodeSegment(segment)
      if (!v || v.length === 0) return null
      generatedColumn += v[0]
      if (v.length < 4) continue
      sourceLine += v[2]
      sourceColumn += v[3]
      if (l === line - 1 && generatedColumn <= column) {
        best = { line: sourceLine + 1, column: sourceColumn + 1 }
      }
    }
  }
  return best
}

/**
 * Where in `code` the error was thrown, or null when that can't be known:
 * no frame from the evaluated code in its stack (a syntax error, a throw
 * inside Strudel with no user frame), no wrapper shape, or no map.
 * `transpileWithMap` re-runs the transpiler on the code that ran, with the
 * same options plus `sourceMap: true`; it is only called on an error.
 */
export function locateEvalError(
  err: unknown,
  transpileWithMap: () => TranspiledWithMap,
  shape: EvalFrameShape | null,
): { line: number; column: number } | null {
  if (!shape) return null
  const at = parseStackLocation(err)
  if (!at) return null
  const line = at.line - shape.headerLines
  const column = at.column - 1 - (line === 1 ? shape.firstLineColumns : 0)
  if (line < 1 || column < 0) return null
  let mappings: string | undefined
  try {
    mappings = transpileWithMap().map?.mappings
  } catch {
    return null
  }
  if (typeof mappings !== 'string') return null
  return originalPositionFor(mappings, line, column)
}
