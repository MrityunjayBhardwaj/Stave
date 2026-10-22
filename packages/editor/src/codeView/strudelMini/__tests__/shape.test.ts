/**
 * The node view of a mini-notation string (#1972): krill's tree, read once, handed
 * back as plain nodes.
 *
 * The oracle is krill itself, imported here directly and walked BY ITS OWN FIELDS — a
 * test is not product code, and a view checked only against itself checks nothing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as krillParse } from '@strudel/mini/krill-parser.js'
import { argAtom, isRest, miniShape, type MiniArg, type MiniElement, type MiniGroup } from '../shape'

type Raw = Record<string, any>
const krill = (mini: string): Raw => krillParse('"' + mini + '"') as Raw

/** krill's tree, node for node, as the view should describe it — built from krill's fields */
function expectGroup(raw: Raw, mini: string): unknown {
  return {
    kind: 'group',
    alignment: raw.arguments_?.alignment,
    children: raw.source_.map((c: Raw) => (c.type_ === 'element' ? expectElement(c, mini) : expectGroup(c, mini))),
    steps: expectArg(raw.arguments_?.stepsPerCycle, mini),
  }
}
function expectAtom(raw: Raw, mini: string): unknown {
  let start = raw.location_.start.offset - 1
  while (start < mini.length && /\s/.test(mini[start])) start++
  return { kind: 'atom', text: raw.source_, span: { start, end: start + raw.source_.length } }
}
function expectElement(raw: Raw, mini: string): unknown {
  return {
    kind: 'element',
    content: raw.source_.type_ === 'atom' ? expectAtom(raw.source_, mini) : expectGroup(raw.source_, mini),
    span: { start: raw.location_.start.offset - 1, end: raw.location_.end.offset - 1 },
    weight: raw.options_?.weight ?? 1,
    reps: raw.options_?.reps ?? 1,
    ops: (raw.options_?.ops ?? []).map((op: Raw) => ({
      kind: op.type_,
      args: Object.fromEntries(Object.entries(op.arguments_ ?? {}).map(([k, v]) => [k, expectArg(v as Raw, mini)])),
    })),
  }
}
function expectArg(v: any, mini: string): unknown {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return v
  if (v.type_ === 'atom') return expectAtom(v, mini)
  if (v.type_ === 'element') return expectElement(v, mini)
  if (v.type_ === 'pattern') return expectGroup(v, mini)
  return null
}

const FIXTURES = [
  'bd hh*2 sd cp',
  '  bd  [sd cp]  ',
  'a@2 b@2',
  'bd:3 ~ - hh',
  'bd:<1 3 2>',
  '<a b>*8',
  '<0.2!3@2 0.8>/2',
  '<0.2 0.8>/[2]',
  'bd(3,8) sd(3,8,2) hh(<3 5>,8)',
  'a, b',
  'a | b',
  'a . b c',
  '{a b c}%4',
  '{a b, c d e}',
  '[a b]!2 c@3 d? e?0.3',
  'bd*<2 3>',
  'a _ b',
  '[a,b] c',
  '<a b, c d>',
  'bd! sd',
  '0 .. 3',
  '~ ~ ~ bd(<2 4!2>, 8)',
  '[hh ~]!16',
]

describe('miniShape — krill read once', () => {
  it('describes every node krill returned, and nothing else', () => {
    for (const mini of FIXTURES) expect(miniShape(mini), mini).toEqual(expectGroup(krill(mini), mini))
  })

  it('…over every pattern in the corpus', () => {
    const file = path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json')
    const corpus: { minis: { mini: string }[] } = JSON.parse(readFileSync(file, 'utf8'))
    const minis = [...new Set(corpus.minis.map((o) => o.mini))]
    let read = 0
    let refused = 0
    for (const mini of minis) {
      let raw: Raw
      try {
        raw = krill(mini)
      } catch {
        // what krill refuses, the view refuses — by throwing, like `miniTree`
        expect(() => miniShape(mini), mini).toThrow()
        refused++
        continue
      }
      expect(miniShape(mini), mini).toEqual(expectGroup(raw, mini))
      read++
    }
    expect(minis.length).toBeGreaterThan(1000)
    expect(read).toBeGreaterThan(1000)
    // the two arms are both real: the corpus holds strings krill rejects
    expect(read + refused).toBe(minis.length)
  })

  it('a plain sequence holds elements; every other grouping holds one group per layer', () => {
    const kinds = (g: MiniGroup): string[] => g.children.map((c) => c.kind)
    expect(miniShape('a b c').alignment).toBe('fastcat')
    expect(kinds(miniShape('a b c'))).toEqual(['element', 'element', 'element'])
    for (const [mini, alignment] of [['a, b', 'stack'], ['a | b', 'rand'], ['a . b c', 'feet']] as const) {
      const root = miniShape(mini)
      expect(root.alignment, mini).toBe(alignment)
      expect(kinds(root), mini).toEqual(['group', 'group'])
    }
    const alt = (miniShape('<a b>').children[0] as MiniElement).content as MiniGroup
    expect(alt.alignment).toBe('polymeter_slowcat')
    expect(kinds(alt)).toEqual(['group'])
    expect(kinds(alt.children[0] as MiniGroup)).toEqual(['element', 'element'])
  })

  it('an atom span is the token itself, wherever krill put the padding', () => {
    for (const mini of ['bd sd', 'a@2 b@2', '  bd   [sd  cp]  ', 'bd:3 hh(3,8,2)*2']) {
      const seen: string[] = []
      const walk = (n: MiniGroup | MiniElement | MiniArg | undefined): void => {
        if (!n || typeof n !== 'object') return
        if (n.kind === 'atom') {
          expect(mini.slice(n.span.start, n.span.end), mini).toBe(n.text)
          seen.push(n.text)
        } else if (n.kind === 'group') n.children.forEach(walk)
        else {
          walk(n.content)
          for (const op of n.ops) Object.values(op.args).forEach(walk)
        }
      }
      walk(miniShape(mini))
      expect(seen.length, mini).toBeGreaterThan(1)
    }
    // …an op's argument included: the tail, the stretch amount, a euclid's three numbers
    const el = miniShape('bd:3 hh(3,8,2)*2').children as MiniElement[]
    expect(argAtom(el[0].ops[0].args.element)?.text).toBe('3')
    const euclid = el[1].ops.find((o) => o.kind === 'bjorklund')!
    expect([euclid.args.pulse, euclid.args.step, euclid.args.rotation].map((a) => argAtom(a)?.text)).toEqual(['3', '8', '2'])
    expect(argAtom(el[1].ops.find((o) => o.kind === 'stretch')!.args.amount)?.span).toEqual({ start: 15, end: 16 })
  })

  it('element spans tile the string: the slices rebuild it', () => {
    for (const mini of ['bd hh*2 sd cp', 'a@2 b@2', '<a b>!2 c@3 _ [d e]?0.3']) {
      const parts = (miniShape(mini).children as MiniElement[]).map((el) => mini.slice(el.span!.start, el.span!.end))
      expect(parts.join(''), mini).toBe(mini)
    }
  })

  it('weight and repeats default to 1, and are read where written', () => {
    const [a, b, c, d] = miniShape('a b@3 c!2 d _').children as MiniElement[]
    expect([a.weight, a.reps]).toEqual([1, 1])
    expect([b.weight, b.reps]).toEqual([3, 1])
    expect(c.reps).toBe(2)
    expect(d.weight).toBe(2)
  })

  it('ops keep their written order, their plain values, and what is absent', () => {
    const [x] = miniShape('bd(3,8)*2?').children as MiniElement[]
    expect(x.ops.map((o) => o.kind)).toEqual(['bjorklund', 'stretch', 'degradeBy'])
    expect(x.ops[0].args.rotation).toBeNull()
    expect(x.ops[1].args.type).toBe('fast')
    expect((miniShape('bd/2').children[0] as MiniElement).ops[0].args.type).toBe('slow')
    expect((miniShape('bd!3').children[0] as MiniElement).ops[0]).toEqual({ kind: 'replicate', args: { amount: 3 } })
  })

  it('a polymeter keeps its step count on the group: an atom, a pattern, or nothing (#1973)', () => {
    const poly = (mini: string): MiniGroup => (miniShape(mini).children[0] as MiniElement).content as MiniGroup
    const four = poly('{a b c}%4')
    expect(four.alignment).toBe('polymeter')
    expect(four.steps).toEqual({ kind: 'atom', text: '4', span: { start: 8, end: 9 } })
    expect((poly('{a b}%<4 8>').steps as MiniGroup).kind).toBe('group')
    expect(poly('{a b, c d e}').steps).toBeNull()
    // every group that is not a polymeter has none
    expect(miniShape('bd sd').steps).toBeNull()
    expect(poly('<a b>').steps).toBeNull()
  })

  it('an op argument krill lists and the author left out is null; a name the op does not have is absent', () => {
    const op = (mini: string) => (miniShape(mini).children[0] as MiniElement).ops[0]
    expect(op('bd(3,8)').args.rotation).toBeNull()
    expect(op('bd?').args.amount).toBeNull()
    expect('rotation' in op('bd(3,8)').args).toBe(true)
    expect(op('bd:3').args.amount).toBeUndefined()
    expect('amount' in op('bd:3').args).toBe(false)
  })

  it('argAtom: the atom itself, the atom an element holds, nothing for a pattern or a plain value', () => {
    const stretch = (mini: string): MiniArg | undefined => (miniShape(mini).children[0] as MiniElement).ops[0].args.amount
    expect(argAtom(stretch('bd*2'))?.text).toBe('2')
    expect(argAtom(stretch('bd*<2 3>'))).toBeNull()
    expect(argAtom(stretch('bd!3'))).toBeNull()
    expect(argAtom(null)).toBeNull()
    expect(argAtom(undefined)).toBeNull()
  })

  it('isRest: `~` and `-`, not `_` (krill folds that into a weight) and not a name', () => {
    const atoms = (miniShape('~ - bd').children as MiniElement[]).map((el) => el.content)
    expect(atoms.map((a) => a.kind === 'atom' && isRest(a))).toEqual([true, true, false])
  })

  it('throws what krill throws, and reads the string as given', () => {
    expect(() => miniShape('[a b')).toThrow()
    expect((miniShape('   bd').children[0] as MiniElement).content).toMatchObject({ span: { start: 3, end: 5 } })
  })

  it('imports the parser half only — the evaluator must not ride into the engine graph', () => {
    const src = readFileSync(path.resolve(__dirname, '../shape.ts'), 'utf8')
    const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    expect(specs).toEqual(['./tree'])
  })
})
