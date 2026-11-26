/** #1476 PROBE — print the 5 interior-commented-label documents in full. */
import { describe, it } from 'vitest'
import { extractTracks, splitTopLevelStatements } from '../parseStrudel'
import {
  hasCorpusArchive,
  loadEveryCorpusDocument,
} from '../../visualEdit/miniSource/__tests__/evalHarness'

const NAMES = ['0/-7zrPK5Bii8_', '0/-HB2AUFfae4D', '0/-uq47S3IOvLa', '500/3_ht9FPtBU5l', '0/2NQuAYDvjagj']

describe('#1476 five docs', () => {
  it.skipIf(!hasCorpusArchive())('prints each', async () => {
    const docs = await loadEveryCorpusDocument()
    for (const name of NAMES) {
      const d = docs.find((x) => x.name === name)
      if (!d) { console.log(`### ${name} NOT FOUND`); continue }
      const stmts = splitTopLevelStatements(d.code, 0)
      const ts = extractTracks(d.code)
      // eslint-disable-next-line no-console
      console.log(`\n##### ${name} (${d.code.length} bytes)\n${d.code}\n-----`)
      // eslint-disable-next-line no-console
      console.log(`statements (${stmts.length}):`)
      for (const s of stmts) console.log(`  [${s.offset}, ${s.offset + s.text.length}) ${JSON.stringify(s.text.slice(0, 70))}`)
      // eslint-disable-next-line no-console
      console.log(`tracks (${ts.length}):`)
      for (const t of ts) {
        const interior = stmts.some((s) => t.dollarStart > s.offset && t.dollarStart < s.offset + s.text.length)
        console.log(
          `  label=${t.label} commented=${t.commented} dollarStart=${t.dollarStart} ` +
            `end=${t.end} INTERIOR=${interior} expr=${JSON.stringify(t.expr.slice(0, 60))}`,
        )
      }
    }
  })
})
