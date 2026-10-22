/**
 * surfaceRoute + the cross-statement freshness guard (#1240).
 *
 * ── WHY THIS FILE EXISTS: TWO BREAKS THAT REDDENED NOTHING ────────────────
 * The #1240 break matrix ran five cells. Three reddened app gates. Two did not,
 * and a break that reddens nothing is a claim about the BREAK before it is a
 * claim about the tests — so both were checked for liveness first, and both are
 * live code on a reachable path:
 *
 *   B3 — deleting the `miniAnchor` half of `isChunkFresh` changed no verdict
 *        anywhere. That is the guard standing between a resolver-supplied span
 *        and a write into an unrelated declaration: the most safety-critical
 *        line in the change, and nothing exercised it.
 *
 *   B5 — deleting `chunkSurface`'s `miniVia === 'resolver'` scoping changed no
 *        verdict either, because the only OTHER caller of the rule — the
 *        coverage harness — carries its own copy of that condition, and
 *        `chunkSurface` itself is reached only by `PatternPanel`, which no
 *        vitest arm mounts. The rule was tested; the call site was not
 *        ([[P540]]: arms over an extracted unit are structurally blind to
 *        whether production reaches it).
 *
 * Each arm below was red-tested against the break that motivated it, and the
 * two breaks redden DISJOINT arms — B3 reddens only the freshness describe, B5
 * only the scoping one. Distinct is not disjoint ([[P558]]), so that separation
 * is checked rather than assumed.
 */
import { describe, it, expect } from 'vitest'

import { detectChunk, isChunkFresh } from '../../chunkDetect'
import { chunkSurface, routeSurface, rollShape } from '../surfaceRoute'

describe('the freshness guard follows a cross-statement mini span', () => {
  // `s(drums)` carries no literal of its own; the resolver names the span
  // inside `const drums = …`, which is a DIFFERENT top-level statement from the
  // one `statementRange` watches.
  const doc = 'const drums = "bd sd hh cp"\n$: s(drums).lpf(400)'
  const chunkAt = (needle: string) => detectChunk(doc, doc.indexOf(needle))!

  it('anchors the mini in the declaring statement, not the unit statement', () => {
    const c = chunkAt('lpf')
    expect(c.miniVia).toBe('resolver')
    expect(c.miniString).toBe('bd sd hh cp')
    // The whole point: the span is outside the unit's own statement.
    expect(c.miniAnchor).not.toBeNull()
    expect(c.miniRange![0]).toBeLessThan(c.statementRange[0])
    expect(doc.slice(...c.miniAnchor!.range)).toBe(c.miniAnchor!.text)
  })

  it('is FRESH against the document it was detected from', () => {
    expect(isChunkFresh(doc, chunkAt('lpf'))).toBe(true)
  })

  it('goes STALE when the declaration changes, though its own statement did not', () => {
    const c = chunkAt('lpf')
    // ⚠ THE REPLACEMENT IS THE SAME LENGTH, and that is the whole arm. A
    // shorter declaration shifts every later offset, so `statementText` stops
    // matching and the PRE-#1240 half of the guard catches it — the arm would
    // pass with `miniAnchor` deleted, certifying nothing. At equal length the
    // unit's own statement is byte-identical AT THE SAME OFFSETS, so the old
    // guard sees nothing wrong and only the anchor can fire. This is the exact
    // case that would otherwise write to a span whose content moved.
    const edited = 'const drums = "cp cp cp cp"\n$: s(drums).lpf(400)'
    expect(edited.length).toBe(doc.length)
    expect(edited.slice(...c.statementRange)).toBe(c.statementText)
    expect(isChunkFresh(edited, c)).toBe(false)
  })

  it('stays fresh when an UNRELATED statement changes', () => {
    // The guard must not be a blanket document-hash: an edit that touches
    // neither the unit nor its declaration leaves the offsets valid.
    const c = detectChunk(doc + '\n$: s("hh*4")', doc.indexOf('lpf'))!
    expect(isChunkFresh(doc + '\n$: s("hh*4").gain(0.5)', c)).toBe(true)
  })

  it('a same-statement literal chunk carries NO anchor', () => {
    // The field must stay null on the overwhelmingly common path, or every
    // literal chunk pays for a guard it does not need.
    const plain = '$: s("bd sd")'
    const c = detectChunk(plain, plain.indexOf('bd'))!
    expect(c.miniVia).toBe('literal')
    expect(c.miniAnchor).toBeNull()
  })
})

describe('chunkSurface routes resolver spans, and only those', () => {
  const surfaceOf = (doc: string, needle: string) =>
    chunkSurface(detectChunk(doc, doc.indexOf(needle))!)

  it('sends a resolver-named drum pattern to the step grid', () => {
    expect(surfaceOf('const d = "bd sd hh cp"\n$: s(d).lpf(400)', 'lpf')).toBe('step')
  })

  it('sends a resolver-named melody to the piano roll', () => {
    expect(surfaceOf('const m = "c3 e3 g3"\n$: note(m).room(2)', 'room')).toBe('roll')
  })

  it('routes a resolver span on a SILENT head by its content, not its head', () => {
    // The head (`lpf`) says nothing about which view the values belong to —
    // this is the case `patternKind` alone cannot answer and #1240 exists for.
    expect(routeSurface('lpf', 'c3 e3 g3')).toBe('roll')
    expect(routeSurface('lpf', 'bd sd hh')).toBe('step')
  })

  it('gives a chord progression the grid, since only the roll can decline', () => {
    // The settled product call: a lane-per-chord-name grid IS an editable
    // surface. The roll declines these on vocabulary; the grid takes them.
    expect(routeSurface(null, '<Gsus G7 Em7 D7>')).toBe('step')
    expect(routeSurface(null, '<am dm em>')).toBe('step')
  })

  it('withholds a surface from a LITERAL mini on a non-content head', () => {
    // ⚠ THE B5 ARM. `lpf("0 1 2")` finds its literal the old way, so `miniVia`
    // is `literal` and the routing must NOT fire: re-routing every string a
    // non-content head owns is a separate decision with its own measurement,
    // and #1240 deliberately does not take it. Dropping the scoping makes this
    // return a surface and nothing else in either package notices.
    const doc = '$: lpf("0 1 2")'
    const c = detectChunk(doc, doc.indexOf('lpf'))!
    expect(c.miniVia).toBe('literal')
    expect(chunkSurface(c)).toBeNull()
  })

  it('withholds a surface when there is no content span at all', () => {
    const doc = '$: silence.gain(0.5)'
    expect(chunkSurface(detectChunk(doc, doc.indexOf('gain'))!)).toBeNull()
  })
})

/**
 * #1243 — a MELODIC head whose own roll declines the content.
 *
 * Head-first is still the rule; this is the one clause under it. The bounds are
 * measured and both of them are load-bearing, so each has its own arm and each
 * arm fails on a DIFFERENT widening of the rule:
 *
 *   drop the `wrong-surface` test  -> the capacity arm reddens (melodies get
 *                                     drawn as drum grids)
 *   drop `chordLanes`              -> the stray-token arm reddens (a melody the
 *                                     roll refused over one bad token gets a
 *                                     one-lane-per-note diagonal)
 *
 * Together they are why the rule is not "the head's surface declined, so ask the
 * other one", which is the rule the issue proposed and the corpus refuted.
 */
describe('a melodic head falls through to the grid ONLY for a chord chart', () => {
  it('sends a chord progression under note() to the grid', () => {
    // The case #1243 was filed about: `note(chordProgression)` where the
    // progression is chord names. The roll declines it on vocabulary, and the
    // grid draws a lane per chord. Measured live in `bakery-152-block-comment`.
    expect(routeSurface('note', '<Gsus G7 Em7 D7>')).toBe('step')
    expect(routeSurface('n', '<am dm em>')).toBe('step')
  })

  it('keeps an ordinary melody on the roll, which accepts it', () => {
    // The overwhelming majority: nothing about this clause may touch them.
    expect(routeSurface('note', 'c3 e3 g3')).toBe('roll')
    expect(routeSurface('note', '<c4 e4> g4')).toBe('roll')
    expect(routeSurface('n', '0 2 4')).toBe('roll')
  })

  it('⚠ keeps a CAPACITY refusal on the roll, where the grid asks less', () => {
    // `<a1 c2>/2` is refused by the roll for crossing a bar, and the grid would
    // take it — but the grid accepting a melody means it asks LESS, not that it
    // is the right editor. Seven of the twelve declined-and-grid-would-accept
    // units in the corpora are this class, so a rule that skipped the gate test
    // would draw seven melodies as drum grids to fix one chord chart. This arm
    // is what fails if the `roll.gate !== 'wrong-surface'` line goes.
    expect(routeSurface('note', '<a1 c2>/2')).toBe('roll')
  })

  it('⚠ keeps a melody the roll refused over ONE stray token on the roll', () => {
    // `note("f5 p1 c6 e3")` — `p1` is not a note, so the roll refuses the whole
    // string on vocabulary, which passes the gate test above. Only `chordLanes`
    // stops it, and without that it becomes four lanes with one note each.
    // Measured in `500/3TJgkfX7SveM`.
    expect(routeSurface('note', 'f5 p1 c6 e3')).toBe('roll')
    expect(routeSurface('note', 'F# E D C# C Bm1 Am1 G')).toBe('roll')
  })

  it('routes a note-headed chord chart through chunkSurface, not just the rule', () => {
    // ⚠ THE CALL-SITE ARM. #1240's B5 and #1250 both came from a rule that was
    // tested while the path reaching it was not — `chunkSurface` used to return
    // `patternKind`'s head answer directly and never consult the router for a
    // content head. An arm on `routeSurface` alone cannot see that.
    const doc = 'const harm = "<Gsus G7 Em7 D7>"\n$: note(harm).s("piano")'
    const c = detectChunk(doc, doc.indexOf('note'))!
    expect(c.headFn).toBe('note')
    expect(c.miniString).toBe('<Gsus G7 Em7 D7>')
    expect(chunkSurface(c)).toBe('step')
  })

  it('a note-headed MELODY still reaches the roll through chunkSurface', () => {
    const doc = '$: note("c3 e3 g3").s("piano")'
    expect(chunkSurface(detectChunk(doc, doc.indexOf('note'))!)).toBe('roll')
  })
})

describe('rollShape — the roll under the cursor, read off its mini (#1942)', () => {
  it("gives a melody's column shape", () => {
    const doc = '$: note("c3 e3 g3 a3")'
    expect(rollShape(detectChunk(doc, doc.indexOf('e3')))).toEqual({ steps: 4, bars: undefined, barSteps: undefined })
    const alt = '$: note("<[c3 e3] [g3 a3 b3 c4]>")'
    expect(rollShape(detectChunk(alt, alt.indexOf('e3')))?.bars).toBe(2)
  })
  it('is null for a drum pattern, an unreadable melody, and no chunk', () => {
    const drums = '$: s("bd sn")'
    expect(rollShape(detectChunk(drums, drums.indexOf('bd')))).toBeNull()
    expect(rollShape(null)).toBeNull()
  })
})
