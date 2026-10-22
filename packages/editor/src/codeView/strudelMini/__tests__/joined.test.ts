/**
 * The joined tree (#1973): every hit of a cycle paired with the note that wrote it.
 *
 * The fixtures pin the rule one case at a time; the corpus arm is the claim itself —
 * over every real pattern, every hit is attached to exactly one written note, or is
 * listed with the reason it is not. The count of hits with no location is PRINTED, so
 * the number is known rather than assumed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { joinedCycle, type JoinedCycle, type JoinedHit, type Unpaired } from '../joined'
import { miniPattern, type MiniHit, type MiniPattern } from '../pattern'
import type { MiniAtom, MiniElement, MiniGroup } from '../shape'

const join = (mini: string, cyc = 0): JoinedCycle => joinedCycle(miniPattern(mini), cyc)
const note = (j: JoinedHit): string | null => j.atom?.text ?? null
const el = (g: MiniGroup, i: number): MiniElement => g.children[i] as MiniElement

/** a pattern that reports the hits it is told to — for the cases Strudel never produces */
const fake = (mini: string, hits: Array<Pick<MiniHit, 'locations'>>): MiniPattern => ({
  mini,
  hits: () => hits.map((h) => ({ begin: { valueOf: () => 0 }, end: { valueOf: () => 1 }, value: null, locations: h.locations })),
})

describe('joinedCycle — one note per hit', () => {
  it('a plain sequence: each hit is the note at its own place', () => {
    const j = join('bd sd')
    expect(j.hits.map(note)).toEqual(['bd', 'sd'])
    expect(j.hits.map((h) => h.atom!.span)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }])
    expect(j.hits.every((h) => h.why === null && h.args.length === 0 && h.strays.length === 0)).toBe(true)
  })

  it('the note is found wherever Strudel lists it: an op argument can come first', () => {
    // `sd:2` reports the `2` before the `sd`; a range its far end; a polymeter its step count
    const cases: Array<[string, string[], string[]]> = [
      ['sd:2', ['sd'], ['2']],
      ['0 .. 3', ['0', '0', '0', '0'], ['3']],
      ['{a b c}%4', ['a', 'a', 'b', 'c'], ['4']], // Strudel's order, not time order
      ['bd(3,8)', ['bd', 'bd', 'bd'], ['3', '8']],
      ['hh*2', ['hh', 'hh'], ['2']],
    ]
    for (const [mini, notes, args] of cases) {
      const j = join(mini)
      expect(j.hits.map(note), mini).toEqual(notes)
      for (const h of j.hits) {
        expect(h.args.map((a) => a.text), mini).toEqual(args)
        expect(h.strays, mini).toEqual([])
      }
    }
    // the fixture really is argument-first, or the case above proves nothing
    const first = miniPattern('sd:2').hits(0)[0].locations[0]
    expect('sd:2'.slice(first.start, first.end)).toBe('2')
  })

  it('a token before a newline or a tab still joins: Strudel takes spaces off a location, nothing else', () => {
    for (const mini of ['0\n2', '0\t2', ' 0\n2', '<\n 0 2 3 2\n>', 'a\n[b\tc]\n']) {
      const pat = miniPattern(mini)
      // the fixture really does carry a location longer than its token
      const padded = [0, 1, 2, 3].flatMap((c) => pat.hits(c)).some((h) => h.locations.some((l) => /\s/.test(mini.slice(l.start, l.end))))
      expect(padded, JSON.stringify(mini)).toBe(true)
      for (const cyc of [0, 1, 2, 3]) {
        const j = joinedCycle(pat, cyc)
        expect(j.hits.length, JSON.stringify(mini)).toBeGreaterThan(0)
        for (const h of j.hits) {
          expect(h.why, JSON.stringify(mini)).toBeNull()
          expect(mini.slice(h.atom!.span.start, h.atom!.span.end)).toBe(h.atom!.text)
          expect(String(h.hit.value)).toBe(h.atom!.text)
        }
      }
    }
  })

  it('a hit that cannot be settled says why, and is still in the list', () => {
    const at = (text: string, mini: string): { start: number; end: number } => ({ start: mini.indexOf(text), end: mini.indexOf(text) + text.length })
    const why = (mini: string, locations: MiniHit['locations']): Unpaired | null => joinedCycle(fake(mini, [{ locations }]), 0).hits[0].why
    expect(why('bd sd', [])).toBe('no-location')
    expect(why('bd*2 sd', [at('2', 'bd*2 sd')])).toBe('no-written-atom')
    expect(why('bd sd', [at('bd', 'bd sd'), at('sd', 'bd sd')])).toBe('several-written-atoms')
    expect(why('bd sd', [at('bd', 'bd sd')])).toBeNull()
    // a place that is no node at all is a stray, and the hit has no note
    const off = joinedCycle(fake('bd sd', [{ locations: [{ start: 1, end: 3 }] }]), 0).hits[0]
    expect([off.atom, off.why, off.strays]).toEqual([null, 'no-written-atom', [{ start: 1, end: 3 }]])
  })

  it('the quote rule is the pattern\'s, not this file\'s: locations one to the right join nothing', () => {
    const src = 'bd sd hh*2'
    const real = miniPattern(src)
    const shifted: MiniPattern = {
      mini: src,
      hits: (c) => real.hits(c).map((h) => ({ ...h, locations: h.locations.map((l) => ({ start: l.start + 1, end: l.end + 1 })) })),
    }
    expect(joinedCycle(real, 0).hits.every((h) => h.atom !== null)).toBe(true)
    expect(joinedCycle(shifted, 0).hits.every((h) => h.atom === null)).toBe(true)
  })
})

describe('joinedCycle — the hits of a node', () => {
  it('an atom has its own hits; an element and a group have those of every note written inside', () => {
    const j = join('[a b]*2 c')
    const group = el(j.root, 0)
    const a = (group.content as MiniGroup).children[0] as MiniElement
    expect(j.of(a.content).map(note)).toEqual(['a', 'a'])
    // in Strudel's order, which is not time order
    expect(j.of(group).map(note)).toEqual(['a', 'a', 'b', 'b'])
    expect(j.of(group).map((h) => h.hit.begin.valueOf())).toEqual([0, 0.25, 0.125, 0.375])
    expect(j.of(el(j.root, 1)).map(note)).toEqual(['c'])
    expect(j.of(j.root).length).toBe(j.hits.length)
    // the `2` shaped four hits and wrote none of them: an argument is not inside its element
    const two = group.ops[0].args.amount as MiniAtom
    expect(two.text).toBe('2')
    expect(j.of(two)).toEqual([])
    expect(j.hits.filter((h) => h.args.includes(two)).length).toBe(4)
  })

  it('a rest and a branch another cycle plays have none', () => {
    const rest = join('bd ~')
    expect(rest.of(el(rest.root, 1))).toEqual([])
    const pat = miniPattern('<a b>')
    const c0 = joinedCycle(pat, 0)
    const c1 = joinedCycle(pat, 1)
    // one shape for the pattern, so a node found in one cycle can be asked about in another
    expect(c1.root).toBe(c0.root)
    const [a, b] = (c0.root.children[0] as MiniElement).content.kind === 'group'
      ? ((((c0.root.children[0] as MiniElement).content as MiniGroup).children[0] as MiniGroup).children as MiniElement[])
      : []
    expect([a.content.kind === 'atom' && a.content.text, b.content.kind === 'atom' && b.content.text]).toEqual(['a', 'b'])
    expect([c0.of(a).length, c0.of(b).length]).toEqual([1, 0])
    expect([c1.of(a).length, c1.of(b).length]).toEqual([0, 1])
  })

  it('a comma stack keeps each layer\'s hits apart', () => {
    const j = join('bd*2, hh*4')
    const layers = j.root.children as MiniGroup[]
    expect(layers.map((l) => l.kind)).toEqual(['group', 'group'])
    expect(layers.map((l) => j.of(l).map(note))).toEqual([['bd', 'bd'], ['hh', 'hh', 'hh', 'hh']])
  })

  it('times are exact: thirds in a later cycle are thirds', () => {
    const j = join('a b c', 2)
    expect(j.hits.map((h) => h.hit.begin.sub!(2).toFraction!())).toEqual(['0', '1/3', '2/3'])
  })
})

describe('joinedCycle — the whole corpus', () => {
  const corpusPath = path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json')
  const corpus: { minis: { mini: string }[] } = JSON.parse(readFileSync(corpusPath, 'utf8'))
  const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

  it('every hit of every pattern, two cycles: attached to exactly one written note, or listed with its reason', () => {
    const t = { patterns: 0, notEvaluated: 0, notQueried: 0, hits: 0, paired: 0, argumentFirst: 0, padded: 0, strays: 0, valueIsNote: 0 }
    const unpaired: Record<Unpaired, number> = { 'no-location': 0, 'no-written-atom': 0, 'several-written-atoms': 0 }
    const odd: string[] = []
    for (const mini of minis) {
      t.patterns++
      let pat: MiniPattern
      try {
        pat = miniPattern(mini)
      } catch {
        t.notEvaluated++
        continue
      }
      for (const cyc of [0, 1]) {
        let j: JoinedCycle
        try {
          j = joinedCycle(pat, cyc)
        } catch {
          t.notQueried++
          break
        }
        for (const h of j.hits) {
          t.hits++
          t.strays += h.strays.length
          if (h.atom === null) {
            unpaired[h.why!]++
            if (odd.length < 8) odd.push(`${h.why}: ${JSON.stringify(mini.slice(0, 80))}`)
            continue
          }
          expect(h.why).toBeNull()
          t.paired++
          const first = h.hit.locations[0]
          if (mini.slice(first.start, first.end).trim() !== h.atom.text || h.args.some((a) => a.span.start === first.start)) t.argumentFirst++
          if (h.hit.locations.some((l) => mini.slice(l.start, l.end) !== mini.slice(l.start, l.end).trim())) t.padded++
          const v = h.hit.value
          const shown = String(Array.isArray(v) ? v[0] : v)
          if (shown === h.atom.text || Number(shown) === Number(h.atom.text)) t.valueIsNote++
        }
      }
    }
    console.warn(
      `joined tree over the corpus: examined ${t.patterns} distinct patterns, cycles 0 and 1 — ${t.hits} hits, ${t.paired} paired with one written note; ` +
        `no location ${unpaired['no-location']}, no written note ${unpaired['no-written-atom']}, several ${unpaired['several-written-atoms']}; ` +
        `locations naming no node ${t.strays}; note not first in Strudel's list ${t.argumentFirst}; a location with whitespace in it ${t.padded}; ` +
        `not evaluated ${t.notEvaluated}, not queried ${t.notQueried}`,
    )
    // the population is the real one, and the two hard cases are IN it — otherwise the
    // zeros below would be true of a rule that never met them
    expect(t.patterns).toBeGreaterThan(1500)
    expect(t.hits).toBeGreaterThan(20000)
    expect(t.argumentFirst).toBeGreaterThan(500)
    expect(t.padded).toBeGreaterThan(40)
    expect(odd, 'hits with no single written note').toEqual([])
    expect(unpaired).toEqual({ 'no-location': 0, 'no-written-atom': 0, 'several-written-atoms': 0 })
    expect(t.paired).toBe(t.hits)
    expect(t.strays).toBe(0)
  })
})

describe('the joined tree stays on the evaluator\'s side', () => {
  const specifiers = (file: string): string[] => {
    const source = readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
    return [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  }

  it('the files the engine\'s graph reaches import neither the pattern nor the joined tree', () => {
    // `ir/parseMini.ts` and `ir/steppedAutomation.ts` are reached from the engine through
    // `ir/parseStrudel.ts`; `pattern.ts` loads `@strudel/core`, and `joined.ts` exists to
    // be used with it.
    for (const file of ['ir/parseMini.ts', 'ir/steppedAutomation.ts', 'strudelMini/shape.ts', 'strudelMini/tree.ts']) {
      const specs = specifiers(file)
      expect(specs.length, file).toBeGreaterThan(0)
      expect(specs.filter((s) => /strudelMini\/(pattern|joined)$|^\.\/(pattern|joined)$/.test(s)), file).toEqual([])
    }
    // control: the same read finds the import where it is
    expect(specifiers('notation/parse.ts').some((s) => /strudelMini\/pattern$/.test(s))).toBe(true)
    expect(specifiers('strudelMini/joined.ts')).toEqual(['./pattern', './shape'])
  })
})
