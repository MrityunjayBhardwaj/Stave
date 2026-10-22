/**
 * #2167 — a Strudel feature Stave has not got yet says so, links its issue,
 * and leaves every other error as it was.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { formatFriendlyError } from '../../engine/friendlyErrors'
import { STRUDEL_DOCS_INDEX } from '../strudelDocs'
import { STRUDEL_NOT_IN_STAVE } from '../docs/strudelNotInStave'
import { sliderFunctions } from '../../engine/vendored/slider'

const format = (err: Error) => formatFriendlyError(err, 'strudel', { index: STRUDEL_DOCS_INDEX })

describe('Strudel features not in Stave yet', () => {
  for (const row of STRUDEL_NOT_IN_STAVE) {
    for (const name of row.names ?? []) {
      it(`\`${name}\` names itself, says it is not in Stave yet, and links #${row.issue}`, () => {
        for (const message of [`${name} is not defined`, `Can't find variable: ${name}`]) {
          const r = format(new ReferenceError(message))
          expect(r.message).toContain(`\`${name}\` is part of Strudel`)
          expect(r.message).toContain("isn't in Stave yet")
          expect(r.suggestion?.name).toBe('')
          expect(r.suggestion?.linkLabel).toBe(`#${row.issue}`)
          expect(r.suggestion?.docsUrl).toBe(`https://github.com/MrityunjayBhardwaj/stave/issues/${row.issue}`)
        }
      })
    }
    for (const method of row.methods ?? []) {
      it(`\`.${method}()\` names itself and links #${row.issue}`, () => {
        // the shapes Chrome and Firefox ("s(...).x") and Safari ('s("bd").x') produce
        for (const message of [`s(...).${method} is not a function`, `s("bd").${method} is not a function. (In 's("bd").${method}()', 's("bd").${method}' is undefined)`]) {
          const r = format(new TypeError(message))
          expect(r.message).toContain(`\`.${method}()\` is part of Strudel`)
          expect(r.suggestion?.docsUrl).toBe(`https://github.com/MrityunjayBhardwaj/stave/issues/${row.issue}`)
        }
      })
    }
  }

  it('the Hydra names say how to run Hydra in Stave meanwhile', () => {
    expect(format(new ReferenceError('initHydra is not defined')).message).toContain('`.hydra` file')
  })

  it('#2190 — `.edoScale()`, in the words Chrome used in Stave, links #121', () => {
    const r = format(new TypeError('n(...).edoScale is not a function'))
    expect(r.message).toBe(
      "`.edoScale()` is part of Strudel (it builds scales that split the octave into any number of equal steps), but it isn't in Stave yet.",
    )
    expect(r.suggestion?.docsUrl).toBe('https://github.com/MrityunjayBhardwaj/stave/issues/121')
  })

  it('`H` no longer gets "Did you mean `s`?"', () => {
    expect(format(new ReferenceError('H is not defined')).message).not.toContain('Did you mean')
  })

  describe('everything else keeps the message it had', () => {
    it('an unknown method', () => {
      expect(format(new TypeError('s(...).notARealMethod is not a function')).message).toBe('s(...).notARealMethod is not a function')
    })
    it('an unknown name', () => {
      expect(format(new ReferenceError('notARealName is not defined')).message).toBe('`notARealName` is not defined.')
    })
    it('a typo still gets its suggestion', () => {
      expect(format(new ReferenceError('nots is not defined')).message).toContain('Did you mean `note`?')
    })
    it('a name that merely contains a listed one', () => {
      expect(format(new ReferenceError('gamepadX is not defined')).message).toBe('`gamepadX` is not defined.')
      expect(format(new TypeError('s(...).oscillate is not a function')).message).toBe('s(...).oscillate is not a function')
    })
  })
})

/**
 * @strudel/soundfonts will not import under vitest (it takes a named export from a
 * CommonJS package), so its export names are read from the closing `export { … }`
 * of the entry file the engine loads.
 */
function soundfontsExports(): string[] {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('@strudel/soundfonts/package.json')
  const entry = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { main: string }).main
  const src = readFileSync(join(dirname(pkgPath), entry), 'utf8')
  const clause = [...src.matchAll(/export\s*\{([^}]*)\}/g)].pop()?.[1] ?? ''
  return clause.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)
}

describe('no row names something Stave already has', () => {
  // The modules StrudelEngine hands to evalScope, plus the vendored slider pair.
  // When a feature lands in Stave its names appear here and this goes red —
  // delete the row then, or the hint would call a working feature missing.
  it('every listed name and method is absent from Stave\'s Strudel scope', async () => {
    const mods = await Promise.all([
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/webaudio'),
      import('@strudel/xen'),
      import('@strudel/midi'),
      import('@strudel/mondo'),
    ])
    const core = mods[0] as unknown as { Pattern: { prototype: Record<string, unknown> } }
    const scope = new Set<string>([
      ...mods.flatMap((m) => Object.keys(m)),
      ...soundfontsExports(),
      ...Object.keys(sliderFunctions(core as never)),
    ])
    const proto = core.Pattern.prototype
    // control arms: a name and a method the scope surely has, and one soundfonts export
    expect(scope.has('note')).toBe(true)
    expect(scope.has('registerSoundfonts')).toBe(true)
    expect(typeof proto.fast).toBe('function')
    const present = STRUDEL_NOT_IN_STAVE.flatMap((row) => [
      ...(row.names ?? []).filter((n) => scope.has(n)),
      ...(row.methods ?? []).filter((m) => typeof proto[m] === 'function').map((m) => `.${m}`),
    ])
    expect(present).toEqual([])
  })
})
