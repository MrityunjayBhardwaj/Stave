/**
 * #2220 — a visual's syntax error, located in the code the user wrote.
 */
import { describe, it, expect } from 'vitest'

import { ENDS_EARLY, VizSyntaxError, locateVizSyntaxError } from '../vizSyntaxError'
import { compileHydraCode } from '../hydraCompiler'

/** what `new Function` throws for `code` */
function v8(code: string, ...args: string[]): unknown {
  try {
    new Function(...args, code)
  } catch (e) {
    return e
  }
  throw new Error('expected a SyntaxError')
}

const fields = (e: unknown) => {
  expect(e).toBeInstanceOf(VizSyntaxError)
  const v = e as VizSyntaxError
  return [v.message, v.line, v.column]
}

describe('locateVizSyntaxError', () => {
  it('keeps the browser’s words and adds the line and column in the user’s code', () => {
    const code = 's.osc(10)\n  .rotate(() => )\n  .out()'
    expect(fields(locateVizSyntaxError(code, v8(code, 's', 'stave')))).toEqual(["Unexpected token ')'", 2, 17])
  })

  it('a token at the end is the wrapper’s, so it says the code ended, after the last thing written', () => {
    // the browser says "Unexpected token '}'": the brace closing Stave's wrapper
    const code = 's.osc(10).out(\n\n'
    const err = v8(code, 's', 'stave') as Error
    expect(err.message).toBe("Unexpected token '}'")
    expect(fields(locateVizSyntaxError(code, err))).toEqual([ENDS_EARLY, 1, 15])
  })

  it('when acorn accepts what the browser refused, the browser’s message stays, with no line', () => {
    expect(fields(locateVizSyntaxError('s.osc(1).out()', new SyntaxError('odd')))).toEqual(['odd', undefined, undefined])
  })

  it('still works once Strudel has replaced the global SyntaxError with its parser’s', () => {
    // evalScope copies @strudel/mini's exports onto globalThis, krill's
    // peggy `SyntaxError` among them; the browser's error is no instance of it
    const native = globalThis.SyntaxError
    const code = 's.osc(10).out(\n'
    const err = v8(code, 's', 'stave')
    function PegSyntaxError(this: unknown, message: string) {
      const l = Error.call(this, message) as Error
      l.name = 'SyntaxError'
      return l
    }
    ;(globalThis as { SyntaxError: unknown }).SyntaxError = PegSyntaxError
    try {
      expect(err instanceof globalThis.SyntaxError).toBe(false)
      expect(fields(locateVizSyntaxError(code, err))).toEqual([ENDS_EARLY, 1, 15])
    } finally {
      globalThis.SyntaxError = native
    }
  })

  it('anything but a SyntaxError comes back as it was', () => {
    const e = new TypeError('nope')
    expect(locateVizSyntaxError('(', e)).toBe(e)
    const located = new VizSyntaxError('done', 1, 1)
    expect(locateVizSyntaxError('(', located)).toBe(located)
  })
})

describe('compileHydraCode', () => {
  it('throws a syntax error with its line in the user’s file', () => {
    let thrown: unknown
    try {
      compileHydraCode('s.osc(10)\n  .out(]')
    } catch (e) {
      thrown = e
    }
    expect(fields(thrown)).toEqual(["Unexpected token ']'", 2, 8])
  })

  it('still compiles good code', () => {
    expect(typeof compileHydraCode('s.osc(10).out()')).toBe('function')
  })
})
