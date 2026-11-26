/** #1683 on top of #1686 — main vs branch over the archive. Inert probe. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { parseStrudel as parseMain } from '../_parseStrudelMain'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import { buildStripModels as stripsMain } from '../../visualEdit/mixer/_stripModelMain'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { resolveBareCaptureId } from '../../engine/bareCapture'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
const sig = (ir: any) => (ir?.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t?.trackId}@${t?.loc?.[0]?.start}${t?.body?.tag === 'Pure' ? '(ghost)' : ''}`).join(' ')
it('census', async () => {
  const docs = await loadEveryCorpusDocument()
  docs.unshift({ name: 'CONTROL', code: '節奏: s("bd*4")\n$: s("hh")' } as any)
  let n = 0, moved = 0
  for (const { name, code } of docs) {
    n++
    const a = sig(parseMain(code)), b = sig(parseStrudel(code))
    const chunks = detectAllChunks(code)
    const sa = stripsMain(chunks, code).map((s) => s.name).join(','), sb = buildStripModels(chunks, code).map((s) => s.name).join(',')
    if (a === b && sa === sb && name !== '0/1wZis6SXtWoZ') continue
    if (a !== b || sa !== sb) moved++
    console.log(`D ${name}\n   main: ${a} | strips ${sa}\n   this: ${b} | strips ${sb} | bare=${resolveBareCaptureId(code)}`)
  }
  console.log(`examined=${n} (incl. 1 control) moved=${moved}`)
}, 900000)
