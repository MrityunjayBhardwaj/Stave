/**
 * #1387 — the record the Inspector's views are built from, over every document
 * in the archive.
 *
 * This replaces the staged-pipeline parity baseline (#1375). That gate compared
 * two parsers; there is one now, so what can go wrong is the recording itself:
 *
 *   1. recording changes the parse          → `ir` differs from `parseStrudel`
 *   2. a body with no track, or a track
 *      with no body                         → the counts differ
 *   3. a RAW body that is not the source
 *      it claims to be                      → the slice differs from its text
 *
 * Each is reported per document by name, so a red run is the list to read.
 */
import { describe, it, expect } from 'vitest'
import {
  hasCorpusArchive,
  loadEveryCorpusDocument,
  CORPUS_RESTORE_HINT,
} from '../../miniSource/__tests__/evalHarness'
import { parseStrudel, parseStrudelRecorded } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { deepEqual } from './helpers/stagesParity'

/** Every document in the archive, deduped by sha256 of its `code` field (#1524). */
const CORPUS_SIZE = 558

function topLevelTracks(ir: PatternIR): PatternIR[] {
  if (ir.tag === 'Track') return [ir]
  if (ir.tag === 'Stack' && ir.tracks.every((t) => t.tag === 'Track')) return ir.tracks
  return []
}

describe('parseStrudelRecorded over the archive (#1387)', () => {
  // `.bakery-runs/` is gitignored (#1307); skip rather than die on a missing path.
  it.skipIf(!hasCorpusArchive())(
    'records one body per top-level track, changes nothing, and every RAW body is its own source',
    async () => {
      const corpus = await loadEveryCorpusDocument()
      expect(
        corpus.length,
        `corpus is ${corpus.length}, expected ${CORPUS_SIZE}. ${CORPUS_RESTORE_HINT}`,
      ).toBe(CORPUS_SIZE)

      const changed: string[] = []
      const miscounted: string[] = []
      const notSource: string[] = []
      let recorded = 0
      let sliced = 0
      for (const { name, code } of corpus) {
        const { ir, bodies } = parseStrudelRecorded(code)
        if (!deepEqual(ir, parseStrudel(code))) changed.push(name)
        const tracks = topLevelTracks(ir).length
        if (tracks !== bodies.length) miscounted.push(`${name} tracks=${tracks} bodies=${bodies.length}`)
        recorded += bodies.length
        for (const b of bodies) {
          if (b.raw.tag !== 'Code') continue
          sliced++
          const loc = b.raw.loc?.[0]
          if (!loc || code.slice(loc.start, loc.end) !== b.raw.code) notSource.push(name)
        }
      }
      console.log(`[#1387 corpus] docs=${corpus.length} bodies=${recorded} rawSlicesChecked=${sliced}`)
      // Control: an empty record would pass all three lists below with nothing
      // in them. The sweep must actually have checked bodies and slices.
      expect({ bodiesRecorded: recorded > 0, slicesChecked: sliced > 0 }).toEqual({
        bodiesRecorded: true,
        slicesChecked: true,
      })
      expect({ changed, miscounted, notSource }).toEqual({ changed: [], miscounted: [], notSource: [] })
    },
  )
})
