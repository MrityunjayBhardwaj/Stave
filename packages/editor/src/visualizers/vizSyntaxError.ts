/**
 * #2220 — a syntax error in a visual's code, located in the code the user wrote.
 *
 * The p5 and Hydra compilers run user code through `new Function(…)`. When it
 * doesn't parse, V8's SyntaxError has no line (its stack points at Stave's own
 * frames), and its words can be about the wrapper rather than the user's code:
 * `s.osc(10).out(` gives "Unexpected token '}'", the `}` being the one that closes
 * the function the compiler wraps the sketch in. So the user's code is parsed on
 * its own (codeView's acorn wrapper, `syntaxErrorAt`), which says where it
 * stops making sense.
 *
 * The message stays the browser's, except when acorn reaches the end of the
 * user's code: then any token the browser names lies in the wrapper, and the
 * message says the code ended instead, placed after the last thing written. If
 * acorn parses the code without complaint (it and V8 disagree), the browser's
 * message is kept with no line.
 *
 * A syntax error is recognised by its `name`, never `instanceof SyntaxError`:
 * on the main thread the global `SyntaxError` is not the browser's. Strudel's
 * eval scope copies every export of `@strudel/mini` onto `globalThis`, and its
 * krill parser exports its own `SyntaxError` (peggy's), so after the engine
 * starts, the error `new Function` throws is not an instance of it. For the
 * same reason `VizSyntaxError` extends `Error`, not the global.
 */

import { syntaxErrorAt } from '../codeView'

/** A visual's syntax error, with its line and column in the user's file (1-based). */
export class VizSyntaxError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message)
    this.name = 'SyntaxError'
  }
}

/** acorn reached the end of the code still expecting more */
export const ENDS_EARLY = 'Unexpected end of code'

/**
 * Turn the error `new Function` threw for `code` into a `VizSyntaxError`. Not a
 * SyntaxError → returned as it is.
 */
export function locateVizSyntaxError(code: string, err: unknown): unknown {
  if (!(err instanceof Error) || err.name !== 'SyntaxError' || err instanceof VizSyntaxError) return err
  const at = syntaxErrorAt(code)
  if (at) {
    const end = code.trimEnd()
    if (at.pos >= end.length) {
      // at the end of the code: put it after the last thing written
      const lines = end.split('\n')
      return new VizSyntaxError(ENDS_EARLY, lines.length, lines[lines.length - 1].length + 1)
    }
    return new VizSyntaxError(err.message, at.line, at.column + 1)
  }
  return new VizSyntaxError(err.message)
}
