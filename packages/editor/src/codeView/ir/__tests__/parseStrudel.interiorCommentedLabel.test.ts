/**
 * A commented-out label INSIDE a live chain is a fragment of that chain, not a
 * track (#1476 — the second half of #1475).
 *
 * #1475 taught the label scan to read a commented label's TEXT: prose is not a
 * track, code-like text is. That is the right question for a line standing on
 * its own, and the wrong one here:
 *
 * ```js
 * $: note("[C G]")
 *   .roomsize("10")
 *
 *   // $: note("F")
 *   //   .sound("piano")
 *
 * .slow(".1275").gain(.8)
 * ```
 *
 * The `// $: note("F")` reads as code because it IS code — a commented-out
 * alternative the author parked inside the open chain of the track above. What
 * disqualifies it is its POSITION.
 *
 * ⚠ THE DAMAGE IS TO THE TRACK ABOVE, NOT TO THE GHOST ROW. A label match also
 * sets the END of the preceding entry, so admitting an interior label truncates
 * the live track at the comment. Its `.slow(".1275").gain(.8)` tail is dropped
 * — silently, with a plausible tree still produced. `0/2NQuAYDvjagj` is the
 * extreme case in the archive: two of its four tracks kept 19 bytes of a
 * 456-byte chain, losing `.scale`, `.sound("piano")`, `.delay`, `.room` and
 * `.gain(2)` each, and gained two phantom rows for the trouble.
 *
 * The rule delegates rather than deciding a second way: `splitTopLevelStatements`
 * already computes top-level statement extents, and a label strictly inside one
 * is interior to it. That is also why #1384's pin survives untouched — a
 * document that is nothing but a commented label yields NO statements, so the
 * label is interior to nothing and keeps its own name rather than renaming
 * itself to `d1`.
 *
 * Measured over the 558-document archive: 44 documents admit a commented label,
 * 5 of them admit one that is interior. After the rule, 0 are interior and 40
 * still admit a commented label — the boundary cases are untouched.
 *
 * ⚠ BOTH PARSERS OR NEITHER. `extractTracks` is shared by `parseStrudel` and
 * `parseStrudelStages`' RAW stage, which is why the fix lives here: a one-sided
 * change would show up as a PARITY failure rather than a shape one, and the
 * shape would look right in whichever half you inspected.
 */
import { describe, it, expect } from 'vitest'
import { extractTracks, parseStrudel } from '../parseStrudel'
import { parseStrudelStages } from '../parseStrudelStages'
import { IR } from '../PatternIR'
import { pipeline } from './helpers/stagesParity'

/** The archive shape, reduced to its load-bearing bytes. */
const INTERIOR = [
  '$: note("[C G]")',
  '  .roomsize("10")',
  '',
  '  // $: note("F")',
  '  //   .sound("piano")',
  '',
  '.slow(".1275").gain(.8)',
].join('\n')

describe('#1476 — a commented label inside a chain is not a track', () => {
  it('does not admit the interior label', () => {
    const tracks = extractTracks(INTERIOR)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].commented).toBe(false)
  })

  it('leaves the live track above it whole — the tail survives', () => {
    const [live] = extractTracks(INTERIOR)
    expect(live.expr).toContain('.roomsize("10")')
    expect(live.expr).toContain('.slow(".1275").gain(.8)')
    // `end` runs to the end of the document, not to the comment block.
    expect(live.end).toBe(INTERIOR.length)
  })

  it('truncation is the damage even when the ghost body is empty', () => {
    // The minimal form: one line of chain, a commented label, then the rest of
    // the chain. Without the rule the live track keeps only its first line.
    const src = '$: n("<1 3 5>")\n// $: n("<1 3 7>")\n  .scale("C:major")\n  .sound("piano")'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].expr).toContain('.sound("piano")')
  })

  it('a commented label at a statement BOUNDARY is still a track (#1384/#671)', () => {
    const src = '$: s("bd")\n// $: s("hh")\n$: s("cp")'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(3)
    expect(tracks.map((t) => t.commented)).toEqual([false, true, false])
  })

  it('a document that is only a commented label keeps it — interior to nothing', () => {
    const tracks = extractTracks('// PR: s("bd")')
    expect(tracks).toHaveLength(1)
    expect(tracks[0].commented).toBe(true)
    expect(tracks[0].label).toBe('PR')
  })

  it('a named commented label interior to a chain is rejected too', () => {
    const src = '$: s("bd")\n  // PR: s("hh")\n  .gain(.5)'
    const tracks = extractTracks(src)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].label).toBe('$')
    expect(tracks[0].expr).toContain('.gain(.5)')
  })

  it('the Inspector RAW view agrees — extractTracks is the shared seam', () => {
    // RAW shows each top-level track's body as the source it was parsed from
    // (#1387). One track, carrying the tail, exactly as `parseStrudel` sees it.
    const raw = parseStrudelStages(INTERIOR)[0].ir
    expect(raw.tag).toBe('Track')
    if (raw.tag !== 'Track') throw new Error('unreachable')
    expect(raw.body.tag).toBe('Code')
    expect(JSON.stringify(raw.body)).toContain('.slow(\\".1275\\")')
    // The track's extent runs to the end of the file rather than stopping at
    // the comment block.
    expect(raw.loc?.[0]?.end).toBe(INTERIOR.length)
  })

  it('and the two remain byte-identical on this document', () => {
    // The contract `parseStrudelStages.ts:6` states. ⚠ THIS ARM CANNOT FLIP ON
    // A TWO-SIDED CHANGE and does not cover the rule — break-tested: with the
    // interior check disabled, 5 of the 8 arms here go red and this one stays
    // green, because both parsers read the same `extractTracks` and move
    // together. It guards the OTHER failure: a future fix applied to one path
    // only, which shows up as a parity difference rather than a wrong shape.
    expect(pipeline(INTERIOR)).toEqual(parseStrudel(INTERIOR))
  })
})

/**
 * #1556 — a RUN of commented-out tracks joined by dangling continuation lines.
 *
 * The splitter peeks past `//` lines, so the leading-dot lines between the
 * commented tracks glue the whole run into ONE statement, and the rule above
 * then rejected every label after the first as interior. The run is not a live
 * chain with a comment parked in it — the statement OPENS with a commented
 * label — so each label is a boundary, and each keeps its ghost row. Reduced
 * from `0/-uq47S3IOvLa`, the only archive document of this shape (1 → 5 rows).
 */
const GHOST_RUN = [
  '//$:note("c [c e!2]").sound("gm_piano")',
  '  .delay(.2)',
  '  ._pianoroll()',
  '//$:note("e [c [a b]]").sound("piano1")',
  '  .mask("<0 0 1 1>")',
  '  .pan(0.3)',
  '//$:s("bd*2")',
  '  .gain(.5)',
].join('\n')

describe('#1556 — a run of commented tracks keeps one ghost row each', () => {
  it('every label in the run is a track, and each ends where the next begins', () => {
    const tracks = extractTracks(GHOST_RUN)
    expect(tracks.map((t) => t.commented)).toEqual([true, true, true])
    expect(tracks.map((t) => t.dollarStart)).toEqual(
      [0, GHOST_RUN.indexOf('//$:note("e'), GHOST_RUN.indexOf('//$:s(')],
    )
    expect(tracks.map((t) => t.end)).toEqual([tracks[1].dollarStart, tracks[2].dollarStart, GHOST_RUN.length])
  })

  it('the timeline gets three silent rows, numbered as if each line were live', () => {
    const ir = parseStrudel(GHOST_RUN)
    const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
    expect(roots.map((t) => (t.tag === 'Track' ? t.trackId : t.tag))).toEqual(['d1', 'd2', 'd3'])
  })

  it('a LIVE chain still rejects its parked comment — the run rule needs a commented OPENING', () => {
    // same bytes as the run, first label uncommented
    const live = GHOST_RUN.replace(/^\/\/\$:/, '$:')
    const tracks = extractTracks(live)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].commented).toBe(false)
    expect(tracks[0].expr).toContain('.gain(.5)')
  })

  it('both parsers agree on the run', () => {
    expect(pipeline(GHOST_RUN)).toEqual(parseStrudel(GHOST_RUN))
  })
})
