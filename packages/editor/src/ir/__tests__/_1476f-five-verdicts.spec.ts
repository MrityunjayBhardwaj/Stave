/** #1476 PROBE — leaves + extent for all five interior documents. */
import { describe, it } from 'vitest'
import { parseStrudel, extractTracks } from '../parseStrudel'
import { songExtent } from '../songExtent'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
const NAMES = ['0/-7zrPK5Bii8_', '0/-HB2AUFfae4D', '0/-uq47S3IOvLa', '500/3_ht9FPtBU5l', '0/2NQuAYDvjagj']
function leaves(n: unknown): number {
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Play' || r.tag === 'Sound') c++
    for (const [k, v] of Object.entries(r)) { if (k === 'loc') continue; visit(v) }
  }
  visit(n); return c
}
describe('#1476 five verdicts', () => {
  it.skipIf(!hasCorpusArchive())('prints', async () => {
    const docs = await loadEveryCorpusDocument()
    for (const name of NAMES) {
      const d = docs.find((x) => x.name === name)!
      const ts = extractTracks(d.code)
      const ir = parseStrudel(d.code)
      // eslint-disable-next-line no-console
      console.log(
        `${name}: tracks=${ts.length} live=${ts.filter((t) => !t.commented).length} ` +
          `ghosts=${ts.filter((t) => t.commented).length} leaves=${leaves(ir)} ` +
          `extent=${JSON.stringify(songExtent(ir))}`,
      )
    }
  })
})
