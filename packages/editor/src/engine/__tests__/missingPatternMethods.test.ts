// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { findMissingPatternMethods, patternRuntimeOf, type PatternRuntime } from '../missingPatternMethods'

/**
 * #2186 — every method a pattern doesn't have, read from the code. REAL
 * Strudel: what a pattern has is `@strudel/core`'s own `Pattern.prototype`
 * after `evalScope`, and each listed place is checked against the error the
 * real run throws once the mistakes before it are fixed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transpiler: any
let runtime: PatternRuntime
beforeAll(async () => {
  core = await import('@strudel/core')
  const mini = await import('@strudel/mini')
  ;({ transpiler } = await import('@strudel/transpiler'))
  await core.evalScope(core, mini)
  core.Pattern.prototype.p = function () { return this } // the repl provides `.p`
  runtime = patternRuntimeOf(core.Pattern)
})

const found = (code: string): string[] =>
  findMissingPatternMethods(code, runtime).map((m) => `${m.line}:${m.column} ${m.receiver}.${m.name}`)

/** what the real run says, or null when it runs */
async function thrown(code: string): Promise<string | null> {
  try {
    await core.evaluate(code, transpiler, { id: 'test' })
    return null
  } catch (e) {
    return (e as Error).message
  }
}

describe('findMissingPatternMethods', () => {
  it('lists each misspelled method, not just the first one the run hits', async () => {
    const code = '$: s("bd").gin(1)\n$: s("hh").fooo(2)\n'
    expect(found(code)).toEqual(['1:12 s(...).gin', '2:12 s(...).fooo'])
    // the run reports the first; fixed, it reports the second
    expect(await thrown(code)).toBe('s(...).gin is not a function')
    expect(await thrown(code.replace('gin', 'gain'))).toBe('s(...).fooo is not a function')
    expect(await thrown(code.replace('gin', 'gain').replace('fooo', 'fast'))).toBeNull()
  })

  it('follows a chain from every kind of start a pattern has', () => {
    expect(found('note("c e").s("sine").lpff(800)')).toEqual(['1:23 note(...).s(...).lpff'])
    expect(found('"bd sd".fasst(2)')).toEqual(['1:9 "bd sd".fasst'])
    expect(found('`bd sd`.fasst(2)')).toEqual(['1:9 `bd sd`.fasst'])
    expect(found('sine.rangee(1, 2)')).toEqual(['1:6 sine.rangee'])
    expect(found('stack(s("bd"), s("hh")).gian(1)')).toEqual(['1:25 stack(...).gian'])
    expect(found('arrange([4, s("bd")]).roomm(1)')).toEqual(['1:23 arrange(...).roomm'])
    // inside arguments too
    expect(found('stack(s("bd").gin(1), s("hh").fooo(2))')).toEqual(['1:15 s(...).gin', '1:31 s(...).fooo'])
  })

  it('lists them in reading order, though an outer call is reached first', () => {
    expect(found('s(s("bd").gin(1)).fooo(2)')).toEqual(['1:11 s(...).gin', '1:19 s(...).fooo'])
  })

  it('stops a chain at its first unknown method: what it returns is not known', () => {
    expect(found('s("bd").gin(1).fooo(2)')).toEqual(['1:9 s(...).gin'])
  })

  it('never lists a call on anything that is not plainly a pattern', () => {
    expect(found('const o = { fooo() {} }\no.fooo()')).toEqual([])
    expect(found('[1, 2].map((x) => x)')).toEqual([])
    expect(found("'bd'.toUpperCase()")).toEqual([]) // single quotes stay a string
    expect(found('Math.max(1, 2)')).toEqual([])
    expect(found('samples("github:x/y").then(() => {})')).toEqual([]) // samples builds no pattern
    // the code's own `s` is not Strudel's
    expect(found('const s = (x) => ({ go() {} })\ns("bd").go()')).toEqual([])
    expect(found('function note(x) { return x }\nnote("c").fooo()')).toEqual([])
  })

  it('knows a method the code registers, even though the run failed before it was added', async () => {
    const code = `s("bd").gin(1)\nconst wob = register('wob', (x, pat) => pat.gain(x))\ns("hh").wob(0.5)\n`
    expect(found(code)).toEqual(['1:9 s(...).gin'])
    expect(await thrown(code.replace('gin', 'gain'))).toBeNull()
  })

  it('a chain past a method that returns haps or a string is no longer a pattern', () => {
    expect(found('s("bd").firstCycle().map((h) => h)')).toEqual([])
    expect(found('s("bd").toString().split(" ")')).toEqual([])
  })

  it('reads nothing from code that does not parse', () => {
    expect(found('s("bd").gin(1')).toEqual([])
  })
})
