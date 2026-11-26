import { it } from 'vitest'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
import { parseStrudel } from '../parseStrudel'
import { resolveBareCaptureId } from '../../engine/bareCapture'
it('doc', async () => {
  const all = await loadEveryCorpusDocument()
  for (const n of ['250/0tY5XMDEgMTq', '0/0T1ttaI3Xk5b', '0/0rtidgQOuC0G', '0/2XqklUBptw63', '0/-uq47S3IOvLa']) {
    const d = all.find((x) => x.name === n)!
    const ir: any = parseStrudel(d.code)
    console.log('DOC', n, 'bare=', resolveBareCaptureId(d.code))
    for (const t of ir.tracks) if (!t.loc || t.body.tag !== 'Pure') console.log('   ', t.trackId, JSON.stringify(d.code.slice(t.loc[0].start, t.loc[0].end).slice(0, 90)), t.body.tag)
  }
})
