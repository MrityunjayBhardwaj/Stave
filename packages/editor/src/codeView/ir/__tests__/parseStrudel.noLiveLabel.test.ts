/**
 * A document whose labels are all commented out or muted plays like a bare one
 * (#1686), so every bare statement is a Track of its own, anchored at itself.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'

function tracksOf(doc: string) {
  const ir = parseStrudel(doc)
  const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
  return roots.map((t) => {
    if (t.tag !== 'Track') throw new Error(`not a Track: ${t.tag}`)
    const loc = t.loc?.[0]
    return { id: t.trackId, start: loc?.start, end: loc?.end, muted: !!t.muted, commented: !!t.commented, text: loc ? doc.slice(loc.start, loc.end) : '' }
  })
}

describe('#1686 — no live label: bare statements are Tracks too', () => {
  it('every commented label keeps its ghost and id; the bare statement is a Track at itself', () => {
    const doc = 'n("<A#2 C3 C4>").s("ptest")\n// $: chord("<Cm>")\n// $: s("bd*4")'
    expect(tracksOf(doc).map(({ id, text }) => [id, text.trim()])).toEqual([
      ['d3', 'n("<A#2 C3 C4>").s("ptest")'],
      ['d1', '// $: chord("<Cm>")'],
      ['d2', '// $: s("bd*4")'],
    ])
  })

  it('a label\'s range ends where the next statement begins — no two Tracks overlap', () => {
    for (const doc of [
      '// $: chord("<Cm>")\nn("c e").s("ptest")\ns("hh*8")',
      '_$: s("bd*4")\nn("c e g").s("ptest")',
      '_$: s("bd*4")\n\nn("c e g")\n_x: s("hh")',
    ]) {
      const ts = tracksOf(doc)
      expect(ts.length, doc).toBeGreaterThan(1)
      for (let i = 1; i < ts.length; i++) expect(ts[i - 1].end!, doc).toBeLessThanOrEqual(ts[i].start!)
    }
  })

  it('a muted label keeps its mute and its own body', () => {
    expect(tracksOf('_$: s("bd*4")\nn("c e g")')).toEqual([
      { id: 'd1', start: 0, end: 14, muted: true, commented: false, text: '_$: s("bd*4")\n' },
      { id: 'd2', start: 14, end: 24, muted: false, commented: false, text: 'n("c e g")' },
    ])
  })

  it('a label alone on its line takes the statement below as its body, as JavaScript does', () => {
    expect(tracksOf('_$:\n  s("bd*4")\nn("c")').map((t) => t.id)).toEqual(['d1', 'd2'])
  })

  it('declarations and transport calls take no row', () => {
    expect(tracksOf('setcps(0.5)\nlet x = 1\n// $: s("a")\nn("c")').map((t) => t.id)).toEqual(['d1', 'd2'])
  })

  it('a commented head\'s dangling chain is not a statement — it takes no second row on the ghost\'s line', () => {
    // reduced from archive `0/-uq47S3IOvLa`
    const doc = 'await initHydra();\n//$: note("c a")\n  .delay(.2)\n\n//$: s("bd")\n  .bank("x")'
    // `await initHydra()` is an unknown head, so it is a (silent) row, as in a
    // bare document (statementHeads.ts); the chain below the first ghost is not
    expect(tracksOf(doc).map((t) => [t.id, t.start])).toEqual([['d3', 0], ['d1', 19], ['d2', 50]])
  })

  it('a statement that merely STARTS with a block comment is still a statement', () => {
    expect(tracksOf('/* note */ s("hh")\n// $: s("a")').map((t) => [t.id, t.start])).toEqual([['d2', 0], ['d1', 19]])
    // …but a block comment over a dangling chain is the same fragment as `//`
    expect(tracksOf('s("q");\n// $: s("a")\n\n/* x */ .fast(2)').map((t) => [t.id, t.start])).toEqual([['d2', 0], ['d1', 8]])
  })

  it('control: a document with nothing but ghosts is unchanged', () => {
    expect(tracksOf('// $: s("a")\n// $: s("b")').map((t) => t.id)).toEqual(['d1', 'd2'])
  })

  it('control: one live label and the bare statements stay out', () => {
    expect(tracksOf('// $: s("a")\n$: s("b")\nn("c")').map((t) => t.id)).toEqual(['d1', 'd2'])
  })
})

/**
 * #1696 — a Track says whether its label was COMMENTED OUT.
 *
 * The row exists either way, so `d{N}` holds still while a line is toggled
 * (#1686). What differs is whether strudel ever saw the statement: it did not,
 * so the engine does not count the row, and a consumer joining an engine
 * producer id (`$N`) to a row has to know which rows to skip. That fact was
 * otherwise only in the SOURCE — readable by looking for `//` at `loc[0].start`
 * — so every such consumer needed the document text as well as its IR.
 *
 * ⚠ Not derivable from the body: a ghost's body is `silent()`, and so is a live
 * `$: "~"`. One cannot sound; the other chose not to.
 */
describe('#1696 — the Track records that its label is commented out', () => {
  const flags = (doc: string) =>
    tracksOf(doc).map((t) => [t.id, t.commented ? 'commented' : t.muted ? 'muted' : 'live'])

  it('marks the ghosts and not the bare statement (the no-live-label branch)', () => {
    expect(flags('const p = s("bd*2")\n// $: s("a")\np')).toEqual([
      ['d1', 'commented'],
      ['d2', 'live'],
    ])
  })

  it('marks a ghost beside LIVE labels (the multi-`$:` branch)', () => {
    expect(flags('// $: s("a")\n$: s("b")\n$: s("c")')).toEqual([
      ['d1', 'commented'],
      ['d2', 'live'],
      ['d3', 'live'],
    ])
  })

  it('marks a lone commented label (the single-`$:` branch)', () => {
    expect(flags('// $: s("a")')).toEqual([['d1', 'commented']])
  })

  it('MUTED is not commented — the two facts stay apart', () => {
    // `_$:` runs and returns silence; `// $:` never runs. Both give a silent
    // row, which is exactly why the body cannot tell them apart and the
    // parser has to say. If these ever collapsed into one flag, every id past
    // a muted track would shift onto its neighbour.
    expect(flags('const p = s("bd*2")\n_$: s("a")\np')).toEqual([
      ['d1', 'muted'],
      ['d2', 'live'],
    ])
  })

  it('control: a live label carries neither flag', () => {
    expect(flags('$: s("a")\n$: s("b")')).toEqual([
      ['d1', 'live'],
      ['d2', 'live'],
    ])
  })
})
