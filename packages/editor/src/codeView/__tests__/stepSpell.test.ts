/**
 * The tree → text printer (#2326). KRILL IS THE JUDGE: every spelling must parse back, by
 * Strudel's own parser, to the node it was asked to print (locations aside), and the
 * builders must pick the form each rule names. What the spellings PLAY is checked by the
 * writers' tests (`stepEdit.test.ts`, `stepSplitResize.test.ts`), against Strudel.
 */
import { describe, expect, it } from 'vitest'
import { parse as krillParse } from '@strudel/mini/krill-parser.js'
import { chord, group, note, printElement, printSeq, rests, siblings, type SElement } from '../strudelMini/spell'

const bare = (n: unknown): unknown => JSON.parse(JSON.stringify(n, (k, v) => (k === 'location_' ? undefined : v)))

/** the text, and krill reads it back as exactly these elements */
function spells(els: SElement[], want: string): void {
  const text = printSeq(els)
  expect(text).toBe(want)
  const back = (bare(krillParse('"' + text + '"')) as { source_: unknown[] }).source_
  expect(back).toEqual(bare(els))
}

describe('stepSpell — printed, and read back by krill as the same node', () => {
  it('HOLD_IS_AT: a step held k slots is `x@k`', () => {
    spells([note('bd')], 'bd')
    spells([note('bd', 2)], 'bd@2')
    spells([note('bd:4', 3)], 'bd:4@3')
  })

  it('EVEN_HITS_ARE_STAR: k equal hits of one note are `x*k`; a group with a rest stays a group', () => {
    spells([group([note('bd'), note('bd')])], 'bd*2')
    spells([group([note('bd:3'), note('bd:3'), note('bd:3')], 2)], 'bd:3*3@2')
    spells([group([note('bd'), note('~')])], '[bd ~]')
    spells([group([note('hh'), note('hh'), note('~'), note('hh')])], '[hh hh ~ hh]')
    spells([group([note('~'), note('~')])], '[~ ~]')
  })

  it('COPIES_FROM_THREE_ARE_BANG: three or more copies side by side are `x!k`, two stay written out', () => {
    spells(siblings([note('bd'), note('bd'), note('bd'), note('~')]), 'bd!3 ~')
    spells(siblings([note('bd'), note('bd'), note('~')]), 'bd bd ~')
    spells(siblings([note('~'), note('~'), note('~')]), '~ ~ ~')
  })

  it('RESTS_WRITTEN_OUT, CHORD_IS_COMMAS', () => {
    spells([note('bd'), ...rests(2)], 'bd ~ ~')
    spells([chord(['bd', 'sd'])], '[bd,sd]')
    spells([group([note('hh'), chord(['hh', 'sd'])])], '[hh [hh,sd]]')
  })

  it('a node the printer has no spelling for is refused, not guessed', () => {
    const e = note('bd')
    e.options_.ops.push({ type_: 'degradeBy', arguments_: {} })
    expect(() => printElement(e)).toThrow()
  })
})
