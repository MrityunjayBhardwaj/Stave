import { describe, it, expect, beforeAll } from 'vitest'
import { locateEvalError, measureEvalFrame, originalPositionFor, type EvalFrameShape } from '../evalErrorLocation'

/**
 * #2175 — an error thrown while the code runs is placed where it was written.
 * These run REAL Strudel: `@strudel/core`'s `evaluate` with the patched
 * `@strudel/transpiler`, the pair the repl uses. If either changes how it
 * regenerates or wraps the code, the lines below stop matching.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transpiler: (code: string, options?: Record<string, unknown>) => any
let shape: EvalFrameShape | null
beforeAll(async () => {
  core = await import('@strudel/core')
  const mini = await import('@strudel/mini')
  ;({ transpiler } = await import('@strudel/transpiler'))
  await core.evalScope(core, mini)
  core.Pattern.prototype.p = function () { return this } // the repl provides `.p`
  shape = await measureEvalFrame()
})

async function locate(code: string, frame = shape) {
  const options = { id: 'test' }
  try {
    await core.evaluate(code, transpiler, options)
  } catch (err) {
    return locateEvalError(err, () => transpiler(code, { ...options, sourceMap: true }), frame)
  }
  throw new Error('expected the code to throw')
}

describe('an error while the code runs gets its line and column (#2175)', () => {
  it('measures the wrapper: two header lines and the safeEval prefix in V8', () => {
    expect(shape).toEqual({ headerLines: 2, firstLineColumns: '"use strict";return ((async ()=>{'.length })
  })

  it.each([
    ['a misspelled method (the reported `.ain`)', `$: note("c e g")\n  .s("piano")\n  .ain(0.5)`, 3, 4],
    ['a misspelled method on the last of three tracks', `$: s("bd sd")\n$: s("hh*4")\n$: s("cp").fooo()`, 3, 12],
    ['the same on line 1, where the wrapper also shifts columns', `$: s("cp").fooo()`, 1, 12],
    ['an undefined name after blank lines and a comment', `// drums\n\n$: s("bd")\n\nconst x = 2\n$: s("hh").gain(undefinedThing)`, 6, 17],
    ['the first of two errors', `$: s("bd").fooo()\n$: s("hh").barr()`, 1, 12],
  ])('%s', async (_name, code, line, column) => {
    expect(await locate(code)).toEqual({ line, column })
  })

  it('a wrong wrapper shape misses, so the check can fail', async () => {
    const wrong = { headerLines: shape!.headerLines + 1, firstLineColumns: shape!.firstLineColumns }
    expect(await locate(`$: s("bd sd")\n$: s("hh*4")\n$: s("cp").fooo()`, wrong)).not.toEqual({ line: 3, column: 12 })
  })

  it('a syntax error has no frame from the evaluated code: no location', async () => {
    expect(await locate(`$: s("bd").gain(0.5]`)).toBeNull()
  })

  it('no map, no wrapper shape: no location', () => {
    const err = new Error('x')
    expect(locateEvalError(err, () => ({}), shape)).toBeNull()
    expect(locateEvalError(err, () => { throw new Error('transpile') }, shape)).toBeNull()
    expect(locateEvalError(err, () => ({ map: { mappings: 'AAAA' } }), null)).toBeNull()
  })

  it('without `sourceMap` the transpiler returns what it always did', () => {
    const code = `$: note("c e g").s("piano")\n$: s("bd*2").gain(0.8)`
    const plain = transpiler(code, { id: 'x' })
    const mapped = transpiler(code, { id: 'x', sourceMap: true })
    expect(plain.map).toBeUndefined()
    expect(mapped.output).toBe(plain.output)
    expect(mapped.miniLocations).toEqual(plain.miniLocations)
  })
})

describe('originalPositionFor', () => {
  // "AAAA,CAAC;AACA" → line 1: col 0 → 1:0, col 1 → 1:1; line 2: col 0 → 2:1
  it('takes the mapping at or before the column, carrying source fields across lines', () => {
    expect(originalPositionFor('AAAA,CAAC;AACA', 1, 0)).toEqual({ line: 1, column: 1 })
    expect(originalPositionFor('AAAA,CAAC;AACA', 1, 5)).toEqual({ line: 1, column: 2 })
    expect(originalPositionFor('AAAA,CAAC;AACA', 2, 3)).toEqual({ line: 2, column: 2 })
  })
  it('a line out of range or with nothing mapped before the column: null', () => {
    expect(originalPositionFor('AAAA', 2, 0)).toBeNull()
    expect(originalPositionFor('CAAA', 1, 0)).toBeNull()
  })
})
