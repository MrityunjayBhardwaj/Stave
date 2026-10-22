/**
 * The editor colours every tempo setter as tempo (#1954).
 *
 * Strudel registers one setter under four names (`setcps`, `setCps`, `setcpm`, `setCpm`).
 * The tokenizer used to spell its own two, so `setcpm(30)` sat uncoloured beside a purple
 * `setcps(0.5)`. Its rule is now built from `TEMPO_SETTERS`, the one list the block scanner
 * reads too, so a name added there is coloured here without a second edit.
 *
 * The grammar is captured through a stand-in `monaco` that records what
 * `registerStrudelLanguage` hands it; the browser spec checks the real colouring.
 */
import { describe, expect, it } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { registerStrudelLanguage } from '../language'
import { TEMPO_SETTERS } from '../../codeView'

type Rule = [RegExp, string]

function strudelRootRules(): Rule[] {
  let grammar: { tokenizer: { root: unknown[] } } | undefined
  const monaco = {
    languages: {
      getLanguages: () => [],
      register: () => {},
      setMonarchTokensProvider: (_id: string, g: typeof grammar) => {
        grammar = g
      },
      setLanguageConfiguration: () => {},
    },
  } as unknown as typeof Monaco
  registerStrudelLanguage(monaco)
  if (!grammar) throw new Error('registerStrudelLanguage set no tokens provider')
  return grammar.tokenizer.root.filter(
    (r): r is Rule => Array.isArray(r) && r[0] instanceof RegExp && typeof r[1] === 'string',
  )
}

/** The token the FIRST rule matching at the start of `text` gives it — Monarch's own order. */
function tokenAt(rules: Rule[], text: string): string | null {
  for (const [re, token] of rules) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text)
    if (m && m.index === 0) return token
  }
  return null
}

describe('tempo setters are coloured as tempo (#1954)', () => {
  const rules = strudelRootRules()

  it('all four names, read from the one list', () => {
    expect([...TEMPO_SETTERS].sort()).toEqual(['setCpm', 'setCps', 'setcpm', 'setcps'])
    for (const name of TEMPO_SETTERS) expect(tokenAt(rules, `${name}(30)`), name).toBe('strudel.tempo')
  })

  it('only the whole name — a longer identifier is not tempo', () => {
    expect(tokenAt(rules, 'setcpsx(1)')).not.toBe('strudel.tempo')
    expect(tokenAt(rules, 'mysetcpm(1)')).not.toBe('strudel.tempo')
  })
})
