/**
 * The disposal rule, one case per SHAPE that made the four "features"
 * (#931 bound-ref, #932 chained-arg, root position, head routing) look like
 * separate problems. They are one question, and this file is where the answer
 * is pinned.
 *
 * Every expectation here is an observed engine behaviour, not a design wish —
 * the shapes come from the located-hap table measured through the real
 * transpiler over 150 real tunes.
 *
 * RED-TEST DISCIPLINE: this file is only worth its runtime if it FAILS when the
 * rule is broken. Two properties carry that weight and are the ones to break
 * when checking: `NOTE_OVERRIDE` (delete it → the root-position cases resolve to
 * the timbre) and the mid-chain `argument` arm (make it `source` → the timbre
 * trap and every `.bank`/`.scale`/`.speed` case flip). Both were verified red
 * before this file was committed.
 */
import { describe, it, expect } from 'vitest'
import { detectAllChunks, detectChunk } from '../../chunkDetect'
import { resolveMiniSource } from '../resolveMiniSource'
import { SpanIndex } from '../spanRole'
import type { SpanProposal } from '../types'

/** Resolve the first unit of `doc` through the non-evaluating parse walk. */
function resolveFirst(doc: string, pos?: number) {
  const unit = pos == null ? detectAllChunks(doc)[0] : detectChunk(doc, pos)
  if (!unit) throw new Error('no unit')
  return resolveMiniSource(doc, unit)
}

const textOf = (doc: string, pos?: number) => {
  const r = resolveFirst(doc, pos)
  return r.ok ? r.text : `REFUSED:${r.reason}`
}

describe('resolveMiniSource — the pattern SOURCE, by position', () => {
  it('head call: the head argument is the content', () => {
    expect(textOf('s("bd sd")')).toBe('bd sd')
    expect(textOf('note("c3 e3 g3")')).toBe('c3 e3 g3')
    expect(textOf('chord("<Am C>").voicing().s("piano")')).toBe('<Am C>')
  })

  it('a control argument is never content, however mini-shaped', () => {
    // Asserted on `alternatives` too, and that is the load-bearing half: the
    // content literal is written FIRST in every one of these, so a disposal
    // that admitted the control argument would still rank the right answer top
    // and this test would pass while the rule was broken. `alternatives`
    // is where a wrongly-admitted span shows up.
    for (const [doc, content] of [
      ['s("bd sd").bank("RolandTR808")', 'bd sd'],
      ['n("0 2 4").scale("C:major")', '0 2 4'],
      ['s("bd").struct("<x ~ x*2>")', 'bd'],
      ['s("hh*8").room("<.1 .3>")', 'hh*8'],
    ] as const) {
      const r = resolveFirst(doc)
      expect(r.ok && r.text).toBe(content)
      expect(r.ok && r.alternatives).toEqual([])
    }
  })

  it('THE TIMBRE TRAP: a mid-chain sound is a timbre, not drum content', () => {
    // `s("bd sd")` as a head is content; `.s("gm_trumpet")` after a pattern
    // source is a timbre. A name cannot tell them apart — position can.
    expect(textOf('note("c4 e4 g4").s("gm_trumpet")')).toBe('c4 e4 g4')
    expect(textOf('n(run(8)).s("piano")')).toBe('REFUSED:no-source-span')
  })

  it('root position: the root literal is the timbre when a note control follows', () => {
    expect(textOf('"gm_pad_warm".note("<c4 e4>")')).toBe('<c4 e4>')
    expect(textOf('"pulse".note("<- c5>").mask("<0@56 1@64>")')).toBe('<- c5>')
    // …and IS the content when nothing overrides it
    expect(textOf('"<- - sd:3 ->".fast(4).lpf(5000)')).toBe('<- - sd:3 ->')
  })

  it('the root-position override does not depend on how the note arg is written', () => {
    // A BOUND note argument is the same shape as a literal one, and requiring a
    // literal left both strings disposing as `source` — so the answer came from
    // whichever was written first. `alternatives` is what makes that visible.
    for (const doc of [
      'const mel = "<c4 e4>"\n$: "gm_pad_warm".note(mel).gain(.5)',
      '$: "gm_pad_warm".note(mel).gain(.5)\nconst mel = "<c4 e4>"',
    ]) {
      const unit = detectAllChunks(doc).find((c) => c.label === '$')!
      const r = resolveMiniSource(doc, unit)
      expect(r.ok && r.text).toBe('<c4 e4>')
      expect(r.ok && r.alternatives).toEqual([])
    }
  })

  it('a bare `.note()` with NO argument reifies the root, so the root stays content', () => {
    expect(textOf('"0 5 3 2".sometimes(slow(2)).scale(\'G4 minor\').note()')).toBe('0 5 3 2')
    expect(textOf('"<9@14 ~@2>".sub(12).n()')).toBe('<9@14 ~@2>')
  })

  it('a mid-chain note on a chain that HAS a head call does not override it', () => {
    // `sound(…)` already supplies this unit's source; `.note(…)` is the pitch
    // control applied to those samples, and the grid the user edits is the
    // sample pattern.
    expect(textOf('sound("hh:4*16").color("green").note("c2 c2".fast(4))')).toBe('hh:4*16')
  })

  it('chained argument: the transform is transparent (#932)', () => {
    expect(textOf('note("c3 e3 g3".sub(12)).s("piano")')).toBe('c3 e3 g3')
    expect(textOf('note("<0 2 5 3>".scale(\'G1 minor\')).s("sawtooth")')).toBe('<0 2 5 3>')
  })

  it('a whole chain sitting inside a control argument is still an argument', () => {
    expect(textOf('s("hh*8").speed("-1 | 1 | 2".fast(2))')).toBe('hh*8')
    expect(textOf('s("oh*16").mul(gain("[.2 1!3]*4"))')).toBe('oh*16')
  })

  it('bound reference: the anchor is in ANOTHER statement (#931)', () => {
    const doc = 'const lh = "0 2 4"\n$: n(lh).scale("C:major").s("piano")'
    const unit = detectAllChunks(doc).find((c) => c.label === '$')!
    const r = resolveMiniSource(doc, unit)
    expect(r.ok && r.text).toBe('0 2 4')
    expect(r.ok && r.crossesBinding).toBe(true)
  })

  it('a BOUND control argument follows the binding and stays an argument', () => {
    const doc = 'const drumstruct = "RolandTR808"\n$: s("hh*16").bank(drumstruct)'
    const unit = detectAllChunks(doc).find((c) => c.label === '$')!
    const r = resolveMiniSource(doc, unit)
    expect(r.ok && r.text).toBe('hh*16')
  })

  it('a binding used by SEVERAL units is judged the same way for each', () => {
    // The largest stray class when the rule climbed out of the unit: whichever
    // statement came first decided the binding's role for all of them.
    const doc = [
      'const bank1 = "RolandTR909"',
      '$: s("hh*16").bank(bank1)',
      '$: s("<rim>").bank(bank1)',
    ].join('\n')
    const units = detectAllChunks(doc).filter((c) => c.label === '$')
    expect(units.map((u) => (resolveMiniSource(doc, u) as { text: string }).text)).toEqual([
      'hh*16',
      '<rim>',
    ])
  })

  it('a unit BOUND into a stack keeps its own content', () => {
    const doc = [
      'let crackles = sound("crackle").gain(0.4)',
      'let hats = sound("hh*8").bank("RolandTR909")',
      '$: stack(crackles, hats)',
    ].join('\n')
    const crack = detectChunk(doc, doc.indexOf('crackle'))!
    expect((resolveMiniSource(doc, crack) as { text: string }).text).toBe('crackle')
  })

  it('a voice inside an arrangement control is not judged by the control', () => {
    // `"…".pick([intro, core1])` consumes whole voices as arguments; judging
    // their contents by that outer position calls every one of them a control
    // value, and blanks the document.
    const doc = [
      'let intro = stack(s("bd*4"))',
      'let core = stack(s("hh*8"))',
      '"<0 1>".pick([intro, core])',
    ].join('\n')
    const bd = detectChunk(doc, doc.indexOf('bd*4'))!
    expect((resolveMiniSource(doc, bd) as { text: string }).text).toBe('bd*4')
  })

  it('a lambda body is transparent, and a lambda ARGUMENT is not content', () => {
    const doc = 'let bass = (f) => n("0 2 4").lpf(f)\n$: stack(bass(400))'
    const inner = detectChunk(doc, doc.indexOf('0 2 4'))!
    expect((resolveMiniSource(doc, inner) as { text: string }).text).toBe('0 2 4')
    expect(textOf('s("bd*4").sometimes(x => x.note("c3"))')).toBe('bd*4')
  })

  it('a document that does not parse refuses rather than guessing', () => {
    const doc = 's("bd sd"'
    const good = detectAllChunks('s("bd sd")')[0]
    expect(resolveMiniSource(doc, good)).toEqual({ ok: false, reason: 'doc-unparsed' })
  })

  it('single-quoted minis have no doc-space hap span, so the parse walk serves them', () => {
    expect(textOf("s('rd')")).toBe('rd')
  })
})

describe('resolveMiniSource — eval proposes, and the AST still disposes', () => {
  const doc = 'note("c3 e3 g3").s("piano")'
  // exactly what `admitProposals` yields for this document: the transpiler
  // declares the three note atoms AND the timbre.
  const proposals: SpanProposal[] = [
    { span: [20, 25], via: 'eval' }, // "piano"
    { span: [6, 8], via: 'eval' },
    { span: [9, 11], via: 'eval' },
    { span: [12, 14], via: 'eval' },
  ]

  it('drops the declared-but-argument span and keeps the content', () => {
    const unit = detectAllChunks(doc)[0]
    const r = resolveMiniSource(doc, unit, { proposals })
    expect(r.ok && r.via).toBe('eval')
    expect(r.ok && r.text).toBe('c3 e3 g3')
    expect(r.ok && r.spans.length).toBe(3)
  })

  it('membership in the transpiler declaration does NOT subsume the filter', () => {
    // `.s("piano")` IS in `meta.miniLocations` — it is a real, correctly
    // offset, transpiler-declared span. It is also not content. Two composed
    // rules, and the first does not do the second's job.
    const index = SpanIndex.build(doc)!
    const unit = detectAllChunks(doc)[0]
    expect(index.roleOfSpan([20, 25], index.reachableRanges(unit.exprRange))).toBe('argument')
    expect(index.roleOfSpan([6, 8], index.reachableRanges(unit.exprRange))).toBe('source')
  })

  it('falls back to the parse walk per UNIT when eval is silent about it', () => {
    // A bare pattern statement that is not the document's last one never
    // sounds — the transpiler returns only the last statement — so it has no
    // located hap. That is real information, not a reason to withhold an anchor
    // from code that plainly has one.
    const twoStatements = 's("bd sd")\nnote("c3 e3")'
    const first = detectAllChunks(twoStatements)[0]
    const evalOnlyLast: SpanProposal[] = [
      { span: [17, 22], via: 'eval' }, // "c3 e3"
    ]
    const r = resolveMiniSource(twoStatements, first, { proposals: evalOnlyLast })
    expect(r.ok && r.via).toBe('parse')
    expect(r.ok && r.text).toBe('bd sd')
  })
})

describe('a binding\'s role is scoped to the unit that reads it (#1017)', () => {
  // The corpus shape: one binding, two units, opposite roles. `ch` is the
  // pattern source of the second unit and a control argument of the first, and
  // it is DECLARED FIRST — which is what made the document-wide verdict
  // dangerous, because tied candidates break on source order.
  const twoRoles = [
    'var ch = "[Am C G <Em F>]/8"',
    '$: n("[0 1 <- 2> [3 <7 4>]]*2").chord(ch).voicing().sound("sawtooth")',
    '$: chord(ch).voicing().sound("supersaw")',
  ].join('\n')

  const unitAt = (doc: string, needle: string) => {
    const u = detectChunk(doc, doc.indexOf(needle))
    if (!u) throw new Error(`no unit at ${needle}`)
    return u
  }

  it('the consumer keeps its own note content, not the binding it passes along', () => {
    const index = SpanIndex.build(twoRoles)!
    const unit = unitAt(twoRoles, 'n("[0 1')
    const r = resolveMiniSource(twoRoles, unit, { index })
    expect(r.ok && r.text).toBe('[0 1 <- 2> [3 <7 4>]]*2')
    // ASSERT THE RUNNERS-UP TOO. The wrongly-admitted span shows up in
    // `alternatives` and nowhere else, so a test that reads only the winner
    // passes while the rule is broken — the ranking repairs it.
    expect(r.ok && r.alternatives).toEqual([])
  })

  it('the unit that genuinely plays the binding still resolves to it', () => {
    const index = SpanIndex.build(twoRoles)!
    const unit = unitAt(twoRoles, '$: chord(ch)')
    const r = resolveMiniSource(twoRoles, unit, { index })
    expect(r.ok && r.text).toBe('[Am C G <Em F>]/8')
    expect(r.ok && r.crossesBinding).toBe(true)
  })

  it('the answer does not depend on which line was written first', () => {
    const reversed = [
      '$: n("[0 1 <- 2> [3 <7 4>]]*2").chord(ch).voicing().sound("sawtooth")',
      'var ch = "[Am C G <Em F>]/8"',
      '$: chord(ch).voicing().sound("supersaw")',
    ].join('\n')
    const index = SpanIndex.build(reversed)!
    const r = resolveMiniSource(reversed, unitAt(reversed, 'n("[0 1'), { index })
    expect(r.ok && r.text).toBe('[0 1 <- 2> [3 <7 4>]]*2')
  })

  it('nor on how many atoms each candidate has — the ranking must not decide it', () => {
    // The ranking is by how many admitted spans landed in each literal, so a
    // one-atom content beside a four-chord binding is where a document-wide
    // verdict loses even WITH eval. Simulated here by proposing the spans eval
    // would return for both literals.
    const doc = 'var ch = "<Am C G Em>"\n$: n("0").chord(ch).voicing()\n$: chord(ch).voicing()'
    const index = SpanIndex.build(doc)!
    const chInterior = doc.indexOf('<Am C G Em>')
    const proposals: SpanProposal[] = [
      { span: [chInterior, chInterior + 2], via: 'eval' }, // Am
      { span: [chInterior + 3, chInterior + 4], via: 'eval' }, // C
      { span: [chInterior + 5, chInterior + 6], via: 'eval' }, // G
      { span: [chInterior + 7, chInterior + 9], via: 'eval' }, // Em
      { span: [doc.indexOf('n("0") ') + 3, doc.indexOf('n("0")') + 4], via: 'eval' }, // 0
    ]
    const r = resolveMiniSource(doc, unitAt(doc, 'n("0")'), { proposals, index })
    expect(r.ok && r.text).toBe('0')
    expect(r.ok && r.alternatives).toEqual([])
  })

  it('RED TEST: widening the question back to the whole document must fail', () => {
    // The defect, reproduced by asking the binding about every reference in the
    // document instead of the ones this unit can see. If this passes, the fix is
    // not load-bearing.
    const index = SpanIndex.build(twoRoles)!
    const unit = unitAt(twoRoles, 'n("[0 1')
    const wholeDoc: [number, number][] = [[0, twoRoles.length]]
    // With the whole document as the boundary, `ch`'s head-position reference in
    // the OTHER unit is in scope, the binding disposes as `source`, and the
    // chord progression becomes an admissible candidate for this unit.
    const chSpan = index.reachableRanges(unit.exprRange)
    expect(index.roleOfSpan([twoRoles.indexOf('[Am C'), twoRoles.indexOf('[Am C') + 5], chSpan)).toBe('argument')
    expect(index.roleOfSpan([twoRoles.indexOf('[Am C'), twoRoles.indexOf('[Am C') + 5], wholeDoc)).toBe('source')
  })

  it('a binding used both ways INSIDE one unit still resolves as source', () => {
    // The tie-break is scoped, not deleted: losing real content is still the
    // worse error when the ambiguity is genuinely local.
    const local = 'var p = "bd sd"\n$: s(p).bank(p)'
    const index = SpanIndex.build(local)!
    const before = index.tieBreakFired
    const r = resolveMiniSource(local, unitAt(local, 's(p)'), { index })
    expect(r.ok && r.text).toBe('bd sd')
    expect(index.tieBreakFired).toBeGreaterThan(before)
  })
})
