/** #1558 PROBE — what does running BOTH paths cost, per eval? */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline } from './helpers/stagesParity'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

describe('#1558 parse cost', () => {
  it.skipIf(!hasCorpusArchive())('times both paths over the archive', async () => {
    const docs = await loadEveryCorpusDocument()
    // Warm both paths so we time steady state, not first-call JIT.
    for (const d of docs.slice(0, 40)) { parseStrudel(d.code); pipeline(d.code) }

    const timeIt = (fn: (c: string) => unknown): number => {
      const t0 = performance.now()
      for (const d of docs) { try { fn(d.code) } catch { /* divergence is not the question here */ } }
      return performance.now() - t0
    }
    const direct = timeIt(parseStrudel)
    const staged = timeIt(pipeline)
    const n = docs.length
    // eslint-disable-next-line no-console
    console.log(
      `n=${n}\n` +
      `  parseStrudel  total ${direct.toFixed(1)}ms   per-doc ${(direct / n).toFixed(3)}ms\n` +
      `  staged 4-pass total ${staged.toFixed(1)}ms   per-doc ${(staged / n).toFixed(3)}ms\n` +
      `  BOTH (the cost after the swap) per-doc ${((direct + staged) / n).toFixed(3)}ms`,
    )
  })
})
