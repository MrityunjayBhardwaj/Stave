import { describe, it, expect, beforeAll } from 'vitest'
import { locateQuotedValue, locateSoundName } from '../evalErrorLocation'

/**
 * #2187 — a sound that isn't loaded is marked at its name. These query REAL
 * Strudel notes (core + mini + the transpiler the repl uses), so the locations
 * are the ones a played note really carries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transpiler: (code: string, options?: Record<string, unknown>) => any
beforeAll(async () => {
  core = await import('@strudel/core')
  const mini = await import('@strudel/mini')
  ;({ transpiler } = await import('@strudel/transpiler'))
  await core.evalScope(core, mini)
  core.Pattern.prototype.p = function () { return this } // the repl provides `.p`
})

/** where each note of the first cycle names its sound */
async function soundPlaces(code: string): Promise<string[]> {
  const { pattern } = await core.evaluate(code, transpiler, { id: 'test' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pattern.queryArc(0, 1).map((hap: any) => {
    const at = locateSoundName(code, hap.context.locations, hap.value.s)
    return `${hap.value.s}@${at ? `${at.line}:${at.column}` : '-'}`
  })
}

describe('a played note says where its sound is named (#2187)', () => {
  it('the reported `s("bdd sd")`', async () => {
    expect(await soundPlaces('$: s("bdd sd")')).toEqual(['bdd@1:7', 'sd@1:11'])
  })

  it('on a later line, among note names, inside `<>`', async () => {
    expect(await soundPlaces('$: note("c e")\n  .s("<bdd hh>")')).toEqual(['bdd@2:8', 'bdd@2:8'])
  })

  it('with a sample number', async () => {
    expect(await soundPlaces('$: s("bdd:3")')).toEqual(['bdd@1:7'])
  })

  it('a note name that reads the same as the sound is not guessed between', async () => {
    // the note's places don't say which is the note and which the sound, and
    // their order follows which control came last, so either order is unplaced
    expect(await soundPlaces('$: note("e").s("e")')).toEqual(['e@-'])
    expect(await soundPlaces('$: s("e").note("e")')).toEqual(['e@-'])
  })

  it('the same name twice in one pattern is still one place per note', async () => {
    expect(await soundPlaces('$: s("bdd bdd")')).toEqual(['bdd@1:7', 'bdd@1:11'])
  })

  it('a plain single-quoted string has no place to point at', async () => {
    expect(await soundPlaces("$: s('bdd')")).toEqual(['bdd@-'])
  })
})

/**
 * #2203 — a value superdough couldn't read, quoted in its error, is marked
 * where it was written. Real notes again; the message is superdough's own
 * (`util.mjs` `noteToMidi`: `'not a note: "' + note + '"'`).
 */
async function quotedPlaces(code: string, message: (hap: any) => string): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { pattern } = await core.evaluate(code, transpiler, { id: 'test' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pattern.queryArc(0, 1).map((hap: any) => {
    const at = locateQuotedValue(code, hap.context.locations, hap.value, message(hap))
    return `${hap.value.note ?? hap.value.s}@${at ? `${at.line}:${at.column}` : '-'}`
  })
}
const notANote = (hap: any) => `not a note: "${hap.value.note}"` // eslint-disable-line @typescript-eslint/no-explicit-any

describe('a value superdough could not read is marked where it was written (#2203)', () => {
  it('the reported `note("c e foo")`', async () => {
    const places = await quotedPlaces('$: note("c e foo").s("sine")', notANote)
    expect(places[2]).toBe('foo@1:14')
  })

  it('on a later line, after a transform', async () => {
    const places = await quotedPlaces('$: note("c foo")\n  .slow(1).s("sine")', notANote)
    expect(places[1]).toBe('foo@1:12')
  })

  it('not when the message quotes no value the note carries', async () => {
    const places = await quotedPlaces('$: note("c e foo").s("sine")', () => 'something else went wrong')
    expect(places).toEqual(['c@-', 'e@-', 'foo@-'])
  })

  it('each note at its own place when the value is written twice', async () => {
    expect(await quotedPlaces('$: note("foo foo").s("sine")', notANote)).toEqual(['foo@1:10', 'foo@1:14'])
  })

  it('not when one note carries the quoted text from two places', async () => {
    expect(await quotedPlaces('$: note("foo").s("foo")', notANote)).toEqual(['foo@-'])
  })

  it('not when two values the note carries are quoted and placed', async () => {
    const places = await quotedPlaces('$: note("foo").s("bar")', (hap) => `"${hap.value.note}" and "${hap.value.s}"`)
    expect(places).toEqual(['foo@-'])
  })
})
