/**
 * The engine's BARE-CAPTURE id ↔ the timeline's lane key (#1094).
 *
 * A document that never calls `.p()` plays its last expression, and the engine
 * captures that pattern under the id an anonymous `$:` would have taken. The
 * rule is decided by `bareCaptureIdFor` in
 * `packages/editor/src/codeView/mixer/stripModel.ts` — the mixer owns it,
 * because the mixer is what ASSIGNS these ids while numbering its strips.
 *
 * ⚠ THE RULE IS "THE LAST TRACK", `$<n-1>` — NOT `'$0'`. Since #1096 a bare
 * document declares a Track per top-level statement, so a two-statement
 * document has strips `$0` and `$1` and the pattern strudel plays belongs to
 * `$1`. `'$0'` is that same rule at n = 1, which is the case this file pins;
 * it is not the rule itself.
 *
 * That choice is only correct because of what THIS side does with it: a bare
 * statement has no `dollarPos`, so the containment index is empty and the hap
 * falls through to the positional mapping, which lands `$<n-1>` on `d<n>` —
 * the lane the IR produces for the nth bare statement.
 *
 * The two halves live in different packages and nothing else holds them
 * together. Pinned here so a change to either is a failing test rather than a
 * timeline that silently draws a second, empty row beside the real one.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  structuralWalk: () => [],
}))

import { laneKeyForHap } from '../timelineMarks'

/**
 * The id a SINGLE-statement bare document resolves to — `bareCaptureIdFor`'s
 * `$<n-1>` at n = 1. Kept in step with
 * `packages/editor/src/codeView/mixer/stripModel.ts`.
 *
 * ⚠ DELIBERATELY A LITERAL, not an import. Importing the real constant means
 * importing `@stave/editor` in an app test, and until #1938 the barrel dragged
 * gifenc (CJS) in — which is why this file already `vi.mock`s it below. The literal is the
 * price of that mock, so the citation above is the only thing keeping the two
 * sides in step. Re-point it if the rule moves house again.
 */
const BARE_CAPTURE_ID = '$0'

const hap = (trackId: string, start?: number) =>
  ({
    begin: 0,
    end: 1,
    trackId,
    ...(start === undefined ? {} : { loc: [{ start, end: start + 2 }] }),
  }) as Parameters<typeof laneKeyForHap>[0]

describe('#1094 — the bare capture lands on the IR lane, not beside it', () => {
  it('with no anchors (a bare document has no `dollarPos`) the capture id maps to d1', () => {
    expect(laneKeyForHap(hap(BARE_CAPTURE_ID), [], [])).toBe('d1')
    // …and with a `loc`, which a located hap always carries: still d1, because
    // there is no anchor for containment to hit.
    expect(laneKeyForHap(hap(BARE_CAPTURE_ID, 3), [], [])).toBe('d1')
  })

  it('a labelled document is unaffected — containment still wins over the id', () => {
    // Two `$:` statements at offsets 0 and 30; a hap inside the second belongs to
    // d2 even though its producer id would map to d1.
    const anchors: Array<[string, number]> = [
      ['d1', 0],
      ['d2', 30],
    ]
    // No ghosts, so the lanes the engine counts ARE `d1…dN` — the list the
    // arithmetic used to assume. Passing it explicitly is what makes the
    // assumption checkable (#1696).
    const lanes = ['d1', 'd2']
    expect(laneKeyForHap(hap('$0', 40), anchors, lanes)).toBe('d2')
    expect(laneKeyForHap(hap('$0', 10), anchors, lanes)).toBe('d1')
  })

  it('the positional mapping is what does the work — the id is read, not assumed', () => {
    // The control arm. A NON-positional id has no lane to map to and falls
    // through as itself: if the engine ever keyed the bare capture like this,
    // that is the row the timeline would grow beside the IR lane.
    expect(laneKeyForHap(hap('bare'), [], [])).toBe('bare')
  })

  it('a multi-statement bare document maps its LAST slot to the LAST lane', () => {
    // ⚠ THIS USED TO BE PART OF THE CONTROL ARM ABOVE, framed as the failure
    // mode — "a different id would NOT land on d1". Since #1096 it is the
    // intended behaviour, not the hazard: a two-statement bare document
    // declares d1 and d2, resolves to `$1`, and `$1` must reach d2 or the
    // meter lands on the neighbour. Left in the negative framing it would tell
    // the next reader that a `$1` sighting is a bug, which is now backwards.
    expect(laneKeyForHap(hap('$1'), [], [])).toBe('d2')
    expect(laneKeyForHap(hap('$2'), [], [])).toBe('d3')
  })
})

/**
 * #1696 — the same join, on a document that declares a row the engine does not
 * count.
 *
 * The document these cases describe:
 *
 *     const p = s("bd*2")     ← offset 0;  a declaration, so no row
 *     // $: s("a")            ← offset 20; ghost row d1
 *     p                       ← offset 33; bare row d2, and what plays
 *
 * Every note strudel emits carries the `const` line's offset (10, inside
 * `s("bd*2")`), which precedes BOTH anchors — so containment has no answer and
 * the producer id decides. Offsets and lane names are the measured ones, from
 * `parseStrudel` + `buildLaneAnchors` on exactly this text.
 */
describe('#1696 — a ghost row is a row the engine never counted', () => {
  /** ghost d1 at the comment, bare d2 at `p` — what `buildLaneAnchors` returns. */
  const anchors: Array<[string, number]> = [
    ['d1', 20],
    ['d2', 33],
  ]
  /** what `captureLaneOrder` returns for it: the ghost is not a statement. */
  const lanes = ['d2']
  /** a note's offset inside `s("bd*2")` — before every anchor, in no row. */
  const IN_THE_DECLARATION = 10

  it('the bare capture lands on the row that plays, not on the commented one', () => {
    expect(laneKeyForHap(hap('$0', IN_THE_DECLARATION), anchors, lanes)).toBe('d2')
  })

  it('counting the ghost is what put it on the wrong row', () => {
    // The control arm, and the one that states the bug: with the ghost counted
    // — which is what `d{N+1}` does — `$0` reads the commented row. This is
    // the arithmetic, spelled as a lane list, so the two answers can be
    // compared rather than described.
    expect(laneKeyForHap(hap('$0', IN_THE_DECLARATION), anchors, ['d1', 'd2'])).toBe('d1')
  })

  it('two ghosts shift it by two', () => {
    //     const p = s("bd*2")
    //     // $: s("a")        ← ghost d1 @20
    //     // $: s("b")        ← ghost d2 @33
    //     p                   ← bare d3 @46, and what plays
    expect(laneKeyForHap(hap('$0', IN_THE_DECLARATION), [
      ['d1', 20],
      ['d2', 33],
      ['d3', 46],
    ], ['d3'])).toBe('d3')
  })

  it('a MUTED label stays in the count — only a comment is invisible', () => {
    //     const p = s("bd*2")
    //     _$: s("a")          ← muted d1 @20 — a statement strudel RUNS
    //     p                   ← bare  d2 @31
    //
    // `_$:` returns silence without registering, but it is still a statement,
    // so both sides number it and the bare row is `$1`, not `$0`. If muting
    // ever started behaving like commenting here, this goes red — and `$0`
    // below is the other half: the muted row is still reachable.
    const anchorsWithMute: Array<[string, number]> = [
      ['d1', 20],
      ['d2', 31],
    ]
    expect(laneKeyForHap(hap('$1', IN_THE_DECLARATION), anchorsWithMute, ['d1', 'd2'])).toBe('d2')
    expect(laneKeyForHap(hap('$0', IN_THE_DECLARATION), anchorsWithMute, ['d1', 'd2'])).toBe('d1')
  })

  it('containment still wins — a located note is placed by its offset', () => {
    // The fallback decides only where containment cannot. A note inside the
    // ghost's own span still reads d1, which is what keeps a commented row
    // drawable at all.
    expect(laneKeyForHap(hap('$0', 25), anchors, lanes)).toBe('d1')
  })

  it('an id past the end of the list keeps the old answer', () => {
    // Not a case anyone should reach — it means the two sides disagree about
    // how many statements the document has. The arithmetic is the better of
    // two bad answers, and silence is the worse one.
    expect(laneKeyForHap(hap('$5'), anchors, lanes)).toBe('d6')
  })
})
