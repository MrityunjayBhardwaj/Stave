/**
 * _1107-beyond-cap.spec.ts — THE SELF-REVIEW PROBE for #1107.
 *
 * A `.spec.ts`, so vitest's `include` (`*.test.ts`) never collects it: this is a
 * probe, not a gate. It asserts nothing and cannot fail — it prints. Run it
 * explicitly when the question below is live; it takes ~78s and queries the whole
 * corpus to 1024 cycles. (It shipped once as a `.test.ts` and joined the suite for
 * exactly that ~78s — #1111.)
 *
 * THE QUESTION: of the registered patterns that produce nothing inside the
 * 256-cycle cap, how many are SILENT and how many merely enter later?
 *
 * WHY IT MATTERS: the presence clause lifts at the cap so a silent track cannot
 * stall a document forever. That is right for silence and wrong-looking for a late
 * entry — such a track is still absent from `analysis.lanes` and still draws an
 * empty, unmarked row. The difference is not observable from inside the cap, so
 * this asks past it.
 *
 * THE ANSWER, as of #1107 (cont.176): all 9 unheard registered tracks, across 6
 * documents, are silent through 1024 cycles. None is a late entry past the cap, so
 * the bound costs nothing in correctness. Re-run this before assuming that still
 * holds — #1108 pages past the cap and makes the far side visible for the first
 * time.
 */
import { describe, it } from 'vitest'
import type { IREvent } from '../../../editor/src/codeView/ir/IREvent'
import { normalizeStrudelHap } from '../../../editor/src/engine/NormalizedHap'
import { evalSongTracks, loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'

const CAP = 256
const BEYOND = 1024

describe('#1107 probe E — silence vs. a late entry past the cap', () => {
  it('classifies every unheard registered track', async () => {
    const corpus = await loadCorpus()
    const rows: string[] = []
    let evaluated = 0
    for (const { name, code } of corpus) {
      const r = await evalSongTracks(code)
      if (!r.ok) continue
      evaluated++
      for (const { trackId, pattern } of r.tracks) {
        const count = (from: number, to: number): number => {
          try {
            const haps = pattern.queryArc(from, to) as unknown[]
            let n = 0
            for (const hap of haps) {
              const ev: IREvent = normalizeStrudelHap(hap, trackId)
              const c = Math.floor(ev.begin)
              if (c >= from && c < to) n++
            }
            return n
          } catch {
            return -1
          }
        }
        const inside = count(0, CAP)
        if (inside !== 0) continue
        const outside = count(CAP, BEYOND)
        rows.push(`${name} :: ${trackId} :: inside=${inside} beyond256=${outside}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log('=== PROBE E ===\n' + JSON.stringify({ evaluated, unheard: rows.length, rows }, null, 1))
  }, 1_800_000)
})
