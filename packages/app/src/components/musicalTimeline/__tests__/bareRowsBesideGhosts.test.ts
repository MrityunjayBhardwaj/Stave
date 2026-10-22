/**
 * When no label is live, the statement that plays has its own row (#1686).
 *
 * Strudel leaves "play the last expression" only when a pattern registers. A
 * `//`-commented label never runs and a `_`-muted one never registers, so a
 * document whose labels are all commented or muted plays its last bare
 * statement. The parser used to give that statement no Track, so its notes fell
 * back to `$0 → d1` — the first COMMENTED row — and the music you heard was drawn
 * on a silent track.
 *
 * Real parser, real anchor walk; only the haps are synthetic, and they carry the
 * id the engine really gives a bare capture (`$<n-1>`) and a `loc` inside the
 * statement that produced them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  collectCycles: () => [],
}))

import { collectNoteMarks } from '../timelineMarks'
import { wholeSongWindow } from '../songAxis'
import { declaredTracks } from '../trackOrder'
import { parseStrudel } from '@stave/editor'

/** One hap inside the statement that starts with `stmt`, keyed as the engine keys a bare capture. */
function hapIn(doc: string, stmt: string, trackId: string) {
  const at = doc.indexOf(stmt)
  if (at < 0) throw new Error(`fixture: ${stmt} not in doc`)
  return { begin: 0, end: 0.5, trackId, note: 'C3', gain: 1, loc: [{ start: at + 3, end: at + 5 }] }
}

function rowsWithNotes(doc: string, haps: ReturnType<typeof hapIn>[]) {
  const marks = collectNoteMarks(
    haps as unknown as Parameters<typeof collectNoteMarks>[0],
    parseStrudel(doc),
    wholeSongWindow(4),
  )
  return [...marks.marksByLane].filter(([, m]) => m.length > 0).map(([k]) => k)
}

const rowIds = (doc: string) => declaredTracks(parseStrudel(doc) as never).map((t) => t.id)

describe('#1686 — the statement that plays when every label is commented out', () => {
  const DOC = [
    'n("<A#2 C3 C4>").s("ptest")',
    '// $: chord("<Cm Cm^7 Cm7 Cm6>")',
    '// $: s("bd*4")',
  ].join('\n')

  it('has a row of its own, named after the ghosts, which keep theirs', () => {
    expect(rowIds(DOC)).toEqual(['d3', 'd1', 'd2'])
  })

  it('draws its notes on that row, not on the first commented one', () => {
    expect(rowsWithNotes(DOC, [hapIn(DOC, 'n("<A#2', '$0')])).toEqual(['d3'])
  })

  it('below a ghost row too — the ghost no longer reaches over it', () => {
    const doc = ['// $: chord("<Cm>")', 'n("c e").s("ptest")', 's("hh*8")'].join('\n')
    expect(rowIds(doc)).toEqual(['d1', 'd2', 'd3'])
    // strudel plays the LAST expression: `$1`.
    expect(rowsWithNotes(doc, [hapIn(doc, 's("hh*8")', '$1')])).toEqual(['d3'])
  })
})

describe('#1686 — every label muted', () => {
  it('the bare statement below a muted label is its own row, not part of that label\'s body', () => {
    const doc = ['_$: s("bd*4")', 'n("c e g").s("ptest")'].join('\n')
    expect(rowIds(doc)).toEqual(['d1', 'd2'])
    expect(rowsWithNotes(doc, [hapIn(doc, 'n("c e g")', '$1')])).toEqual(['d2'])
  })
})

describe('#1686 — control: a live label still decides everything', () => {
  it('a bare statement beside a live label gets no row (it never plays)', () => {
    const doc = ['$: s("bd*4")', 'n("c e g")'].join('\n')
    expect(rowIds(doc)).toEqual(['d1'])
  })
})
