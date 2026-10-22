/**
 * The mini-notation adapter (#1971): Strudel's parse with offsets in the caller's own
 * string, Strudel's evaluation, and one cycle of its hits.
 *
 * The oracle for "what krill said" is krill itself, imported here directly — a test is
 * not product code, and an adapter checked only against itself checks nothing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as krillParse } from '@strudel/mini/krill-parser.js'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../pattern'
import { miniTree, type KAtom, type KElement, type KPattern } from '../tree'

/** every location in a tree, with the node kind that carries it */
function locations(node: unknown, out: Array<{ kind: string; start: number; end: number; keys: string[] }> = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((c) => locations(c, out))
    return out
  }
  const rec = node as Record<string, unknown>
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'location_') {
      const loc = v as { start: { offset: number }; end: { offset: number } }
      out.push({ kind: String(rec.type_), start: loc.start.offset, end: loc.end.offset, keys: Object.keys(loc).sort() })
    } else locations(v, out)
  }
  return out
}

describe('miniTree — krill, in the coordinates of the string it was given', () => {
  it('top-level element spans tile the string exactly: the slices rebuild it', () => {
    for (const mini of ['bd hh*2 sd cp', 'a@2 b@2', '  bd  [sd cp]  ', '<a b>!2 c@3 _ [d e]?0.3', 'bd:3 rd:<1 3 2>', 'bd(3,8,<0 2>)']) {
      const tree = miniTree(mini)
      const parts = tree.source_.map((el) => mini.slice(el.location_!.start.offset, el.location_!.end.offset))
      // krill starts the first element at the first non-space; nothing else is left out
      expect(mini.trimStart().startsWith(parts.join('')) || parts.join('') === mini.trimStart(), mini).toBe(true)
      expect(parts.join('').trim(), mini).toBe(mini.trim())
    }
  })

  it('an atom starts where its token is written', () => {
    const mini = 'bd hh sd'
    const atoms = miniTree(mini).source_.map((el) => el.source_ as KAtom)
    expect(atoms.map((a) => mini.slice(a.location_!.start.offset, a.location_!.start.offset + a.source_.length))).toEqual(['bd', 'hh', 'sd'])
  })

  it('every location is one less than krill reports — at every depth, an op argument included', () => {
    for (const mini of ['bd:3 rd:<1 3 2>', 'bd(3,8,<0 2>)', 'hh*<2 3> [a [b c]]', 'a . b c', '{a b c}%4, x']) {
      const raw = locations(krillParse('"' + mini + '"'))
      const ours = locations(miniTree(mini))
      expect(raw.length, mini).toBeGreaterThan(2)
      expect(ours.map((l) => [l.kind, l.start, l.end]), mini).toEqual(raw.map((l) => [l.kind, l.start - 1, l.end - 1]))
    }
    // the fixture really does reach a location under an op: `bd:3`'s tail and a euclid's numbers
    const tail = (miniTree('bd:3').source_[0].options_!.ops![0].arguments_!.element as KAtom).location_!
    expect('bd:3'.slice(tail.start.offset, tail.start.offset + 1)).toBe('3')
  })

  it('a location carries offsets and nothing else — krill\'s line and column still count the quote', () => {
    const raw = locations(krillParse('"bd sd"'))
    expect(raw[0].keys).toEqual(['end', 'source', 'start'])
    const ours = miniTree('bd sd').source_[0].location_ as unknown as Record<string, Record<string, unknown>>
    expect(Object.keys(ours).sort()).toEqual(['end', 'start'])
    expect(Object.keys(ours.start)).toEqual(['offset'])
    expect(Object.keys(ours.end)).toEqual(['offset'])
  })

  it('the rest of the tree is krill\'s own, untouched', () => {
    const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'location_' ? undefined : x)))
    for (const mini of ['bd*2 [sd cp]@3 hh!2', '<a b>, c?', 'bd(3,8)']) {
      expect(strip(miniTree(mini)), mini).toEqual(strip(krillParse('"' + mini + '"')))
    }
    const tree: KPattern = miniTree('bd hh')
    expect(tree.type_).toBe('pattern')
    expect(tree.arguments_?.alignment).toBe('fastcat')
    expect((tree.source_[0] as KElement).type_).toBe('element')
  })

  it('throws what krill throws — the caller decides what a rejection means', () => {
    expect(() => miniTree('bd [sd')).toThrow()
    expect(() => miniTree('_')).toThrow()
    expect(() => krillParse('"bd [sd"')).toThrow()
    // control: the same call on text krill accepts does not
    expect(() => miniTree('bd [sd]')).not.toThrow()
  })

  it('parses the string exactly as given: leading space moves the offsets, it is not trimmed away', () => {
    const at = (mini: string): number => miniTree(mini).source_[0].location_!.start.offset
    expect(at('bd sd')).toBe(0)
    expect(at('   bd sd')).toBe(3)
  })
})

describe('miniPattern — what the string plays, asked of Strudel', () => {
  const onsets = (mini: string, cyc: number): string[] =>
    miniPattern(mini)
      .hits(cyc)
      .map((h) => `${String(h.value)}@${h.begin.valueOf() - cyc}`)

  it('one cycle is the half-open window [cyc, cyc + 1)', () => {
    expect(onsets('bd sd', 0)).toEqual(['bd@0', 'sd@0.5'])
    // `<a b>` plays one entry per cycle: cycle 1 holds b, and only b
    expect(onsets('<a b>', 0)).toEqual(['a@0'])
    expect(onsets('<a b>', 1)).toEqual(['b@0'])
    expect(onsets('<a b>', 2)).toEqual(['a@0'])
  })

  it('times are Strudel\'s exact fractions', () => {
    const [, second] = miniPattern('a b c').hits(1)
    expect(second.begin.sub!(1).toFraction!()).toBe('1/3')
    expect(second.end.sub!(1).toFraction!()).toBe('2/3')
  })

  it('a hit is an onset: the tail of a note held over from the cycle before is not one', () => {
    // `a@3 b` slowed by two: `a` starts in cycle 0 and is still sounding in cycle 1,
    // where Strudel returns a fragment of it with no onset
    const raw = (reifyMini('[a@3 b]/2') as { queryArc(a: number, b: number): Array<{ hasOnset(): boolean; value: unknown }> }).queryArc(1, 2)
    expect(raw.map((h) => [h.value, h.hasOnset()])).toEqual([['a', false], ['b', true]])
    expect(miniPattern('[a@3 b]/2').hits(1).map((h) => h.value)).toEqual(['b'])
  })

  it('every location is in the string that was passed: one less than Strudel reports, in Strudel\'s order', () => {
    for (const mini of ['bd sd', 'a [b c]', 'sd:2 hh', 'bd(3,8)', '0 .. 3', '{a b c}%4', 'hh*<2 3>']) {
      const raw = (reifyMini(mini) as { queryArc(a: number, b: number): Array<{ hasOnset(): boolean; context: { locations: Array<{ start: number; end: number }> } }> })
        .queryArc(0, 1)
        .filter((h) => h.hasOnset())
      const ours = miniPattern(mini).hits(0)
      expect(ours.length, mini).toBeGreaterThan(0)
      expect(ours.map((h) => h.locations), mini).toEqual(raw.map((h) => h.context.locations.map((l) => ({ start: l.start - 1, end: l.end - 1 }))))
    }
    // the plain case reads back as the token; the order is Strudel's, argument first for a tail
    const src = 'bd sd:2'
    const [bd, sd] = miniPattern(src).hits(0)
    expect(bd.locations.map((l) => src.slice(l.start, l.end))).toEqual(['bd'])
    expect(sd.locations.map((l) => src.slice(l.start, l.end))).toEqual(['2', 'sd'])
  })

  it('throws on text Strudel rejects; the pattern remembers the string it was given', () => {
    expect(() => miniPattern('bd [sd')).toThrow()
    expect(miniPattern('  bd sd ').mini).toBe('  bd sd ')
  })
})

describe('the parser half stays importable from the engine\'s graph', () => {
  const specifiers = (file: string): string[] => {
    const source = readFileSync(path.join(__dirname, '..', file), 'utf8')
    return [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/gm)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    )
  }

  it('tree.ts imports krill\'s parser and nothing else', () => {
    // `ir/parseMini.ts` imports it and sits in the engine's import graph (through
    // `ir/parseStrudel.ts`). The evaluator loads `@strudel/core` at import, which the
    // engine loads itself, later — so the two halves of the adapter are two files.
    expect(specifiers('tree.ts')).toEqual(['@strudel/mini/krill-parser.js'])
    // control: the same read finds the evaluator's import next door
    // (it imports the parser half too, to mark a tree before evaluating it — #1833)
    expect(specifiers('pattern.ts')).toEqual(['@strudel/mini/mini.mjs', './tree', './shape'])
  })
})
