import { describe, it, expect, beforeAll } from 'vitest'
import { locateSoundName } from '../evalErrorLocation'

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
