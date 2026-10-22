import { describe, it, expect } from 'vitest'
import { getLeafLocations } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../strudelMini/pattern'
import { gridOnsets, rollOnsets, type LeafSpan } from '../parse'

/**
 * #986 P0 gate — the note-broken family's induced fix threads each hap's OWN leaf
 * span into `Onset`/`RollOnset` so P1 can write back at the
 * leaf loc instead of the top-level element span. This proves the plumbing carries a
 * RESOLVABLE leaf span — for nested groups, `*n`, euclid, chords — grounded against
 * krill, never a re-parsed second oracle (PV192).
 *
 * The span was first taken from `context.locations[0]`. For every shape in the #986
 * arms that is the note; where it is not, see the #1974 arms at the end of this file.
 *
 * The cross-check is `getLeafLocations` from `@strudel/mini` itself: `mini()`'s
 * `.withLoc` is derived from exactly that function, so a span the onset carries must
 * be one of krill's whitespace-corrected leaf spans, and must slice to the token.
 */

/** krill's own leaf spans for a bare mini string, in src-space (quoted-offset − 1) */
function krillLeafSpans(src: string): Array<{ start: number; end: number }> {
  // getLeafLocations(code, start) returns [from,to] in the quoted string's space
  return (getLeafLocations('"' + src + '"', 0) as Array<[number, number]>).map(([f, t]) => ({
    start: f - 1,
    end: t - 1,
  }))
}

const spanEq = (a: LeafSpan, b: { start: number; end: number }) =>
  a.start === b.start && a.end === b.end

function expectResolvable(src: string, span: LeafSpan | null, token: string, leaves: Array<{ start: number; end: number }>) {
  expect(span, `no leaf span for token ${JSON.stringify(token)} in ${JSON.stringify(src)}`).not.toBeNull()
  const s = span as LeafSpan
  // 1. slices to the token byte-for-byte
  expect(src.slice(s.start, s.end)).toBe(token)
  // 2. is one of krill's own leaf spans (agreement with the grammar, not a regex)
  expect(leaves.some((l) => spanEq(s, l)), `span ${JSON.stringify(s)} not a krill leaf of ${JSON.stringify(src)}`).toBe(true)
}

describe('#986 P0 — grid onsets carry a resolvable leaf span', () => {
  // src → the leaf tokens the grid should carry (order-independent set assertion)
  const GRID: Array<[string, string[]]> = [
    ['a b c d', ['a', 'b', 'c', 'd']],
    ['a [b c]', ['a', 'b', 'c']], // the plan's nested fixture: `c` gets `c`, not `[b c]`
    ['a [b [c d]]', ['a', 'b', 'c', 'd']], // deeper nesting
    ['bd hh sd cp', ['bd', 'hh', 'sd', 'cp']],
    ['bd [sd cp]', ['bd', 'sd', 'cp']],
    ['bd*2 sd', ['bd', 'sd']], // stretch — one leaf, two columns
    ['bd(3,8)', ['bd']], // euclid — one leaf, several columns
    ['bd@2 sd', ['bd', 'sd']], // elongation
    ['bd!2 sd', ['bd', 'sd']], // replicate
    ['[a,b] c', ['a', 'b', 'c']], // chord stack — two leaves on one column
  ]

  it.each(GRID)('%s', (src, expectedTokens) => {
    const onsets = gridOnsets(miniPattern(src), 0)
    expect(onsets, `gridOnsets refused ${JSON.stringify(src)}`).not.toBeNull()
    const leaves = krillLeafSpans(src)
    const seen = new Set<string>()
    for (const o of onsets!) {
      expect(o.spans.length).toBe(o.atoms.length) // index-aligned, one span per atom
      o.atoms.forEach((token, i) => {
        expectResolvable(src, o.spans[i], token, leaves)
        seen.add(token)
      })
    }
    expect([...seen].sort()).toEqual([...new Set(expectedTokens)].sort())
  })

  it('a stretched leaf reports the SAME span at every column it fills', () => {
    // `bd*2` plays bd twice → two columns, one source leaf. P1 rewrites that one
    // leaf; both columns follow. This is the N-cells/1-leaf input the P2 bijection
    // gate reasons about — recorded here so the invariant is observable.
    const onsets = gridOnsets(miniPattern('bd*2 sd'), 0)!
    const bdSpans = onsets
      .flatMap((o) => o.atoms.map((a, i) => ({ a, s: o.spans[i] })))
      .filter((x) => x.a === 'bd')
      .map((x) => x.s)
    expect(bdSpans.length).toBe(2)
    expect(bdSpans[0]).toEqual(bdSpans[1])
    expect('bd*2 sd'.slice(bdSpans[0]!.start, bdSpans[0]!.end)).toBe('bd')
  })

  it('a comma-stack lands two DISTINCT leaf spans on one column', () => {
    // `[a,b]` stacks two voices on column 0 — two leaves, two spans. P2 refuses the
    // ambiguous write-back; P0 records both faithfully.
    const onsets = gridOnsets(miniPattern('[a,b] c'), 0)!
    const col0 = onsets.find((o) => Math.abs(o.pos) < 1e-9)!
    expect(col0.atoms.sort()).toEqual(['a', 'b'])
    const spans = col0.spans as LeafSpan[]
    expect(spans[0]).not.toEqual(spans[1])
  })
})

describe('#986 P0 — roll onsets carry a resolvable leaf span', () => {
  const ROLL: string[] = [
    '0 2 4',
    '0 [2 4]', // nested numeric
    'c3 e3 g3',
    'c3 [e3 g3]', // nested note names
    '0 2 4 [6 7]',
  ]

  it.each(ROLL)('%s', (src) => {
    const onsets = rollOnsets(miniPattern(src), 0)
    expect(onsets, `rollOnsets refused ${JSON.stringify(src)}`).not.toBeNull()
    const leaves = krillLeafSpans(src)
    for (const o of onsets!) {
      expect(o.loc, `no leaf span for ${o.pitch} in ${JSON.stringify(src)}`).not.toBeNull()
      const s = o.loc as LeafSpan
      // roll normalizes pitch (lowercased note names, numeric-stringified); the raw
      // slice must match the ROLL's own token ignoring that normalization
      expect(src.slice(s.start, s.end).toLowerCase()).toBe(o.pitch.toLowerCase())
      expect(leaves.some((l) => spanEq(s, l))).toBe(true)
    }
  })
})

/**
 * #1974 — the anchor is the NOTE that wrote the hit, not the first place Strudel lists.
 * The leaf writer replaces the bytes of this span, so a span on an op's argument, or one
 * that takes in the newline after a token, is a write onto the wrong text.
 */
describe('#1974 — a hit is anchored on its written note, wherever Strudel lists it', () => {
  const text = (src: string, span: LeafSpan | null): string | null => (span ? src.slice(span.start, span.end) : null)
  const gridAnchors = (src: string): Array<string | null> =>
    (gridOnsets(miniPattern(src), 0) ?? []).flatMap((o) => o.occ.map((x) => text(src, x.span)))
  const rollAnchors = (src: string): Array<string | null> =>
    (rollOnsets(miniPattern(src), 0) ?? []).map((o) => text(src, o.loc))

  it('an op argument Strudel lists first is not the anchor', () => {
    // the fixtures really are argument-first, or the cases below prove nothing
    for (const [src, arg] of [['sd:2 hh', '2'], ['{bd hh sd}%4', '4'], ['0 .. 3', '3']] as const) {
      const first = miniPattern(src).hits(0)[0].locations[0]
      expect(src.slice(first.start, first.end), src).toBe(arg)
    }
    expect(gridAnchors('sd:2 hh')).toEqual(['sd', 'hh'])
    expect(gridAnchors('{bd hh sd}%4').sort()).toEqual(['bd', 'bd', 'hh', 'sd'])
    expect(rollAnchors('0 .. 3')).toEqual(['0', '0', '0', '0'])
    expect(rollAnchors('{0 4 7}%4').sort()).toEqual(['0', '0', '4', '7'])
  })

  it('a token before a newline or a tab is anchored on its own text, not on the break', () => {
    for (const src of ['bd\nsd', 'bd\tsd', 'bd \n sd']) {
      // the fixture really carries a place longer than its token
      expect(miniPattern(src).hits(0).some((h) => h.locations.some((l) => /\s/.test(src.slice(l.start, l.end)))), src).toBe(true)
      expect(gridAnchors(src), src).toEqual(['bd', 'sd'])
    }
    expect(rollAnchors('0\n4')).toEqual(['0', '4'])
  })

  it('a hit with no single written note has no anchor', () => {
    const at = (n: number) => ({ valueOf: () => n })
    const fake = (locations: Array<{ start: number; end: number }>) => ({
      mini: 'bd sd',
      hits: () => [{ begin: at(0), end: at(0.5), value: 'bd', locations }],
    })
    // it names no place at all (a place Strudel reported in a form that cannot be read is dropped by the adapter)
    expect(gridOnsets(fake([]), 0)!.flatMap((o) => o.occ.map((x) => x.span))).toEqual([null])
    // it names a place that is no note
    expect(gridOnsets(fake([{ start: 0, end: 5 }]), 0)!.flatMap((o) => o.occ.map((x) => x.span))).toEqual([null])
    // it names two notes
    expect(gridOnsets(fake([{ start: 0, end: 2 }, { start: 3, end: 5 }]), 0)!.flatMap((o) => o.occ.map((x) => x.span))).toEqual([null])
    // control: one note, one anchor
    expect(gridOnsets(fake([{ start: 0, end: 2 }]), 0)!.flatMap((o) => o.occ.map((x) => x.span))).toEqual([{ start: 0, end: 2 }])
  })
})
