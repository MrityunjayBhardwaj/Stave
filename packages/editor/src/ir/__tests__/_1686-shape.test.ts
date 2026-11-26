/** #1686 probe — what the IR and strips say for no-live-label docs. Inert. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { resolveBareCaptureId } from '../../engine/bareCapture'
const DOCS = {
  issue: 'n("<A#2 C3 C4>").s("ptest")\n// $: chord("<Cm Cm^7 Cm7 Cm6>")\n// $: s("bd*4")',
  after: '// $: chord("<Cm>")\nn("c e").s("ptest")\ns("hh*8")',
  one: 'n("c e")\n// $: s("bd*4")',
  muted: '_$: s("bd*4")\nn("c e g").s("ptest")',
  mutedLast: 'n("c e g")\n_$: s("bd*4")',
  live: '$: s("bd")\nn("c")',
}
it('shape', () => {
  for (const [k, doc] of Object.entries(DOCS)) {
    const ir: any = parseStrudel(doc)
    const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
    console.log(k, roots.map((t: any) => `${t.tag}:${t.trackId}@${t.loc?.[0]?.start}-${t.loc?.[0]?.end}${t.muted ? ':M' : ''}:${t.body?.tag}`).join(' | '))
    console.log('   strips', buildStripModels(detectAllChunks(doc), doc).map((s) => `${s.name}/${s.captureId}`).join(' '), 'bare=', resolveBareCaptureId(doc))
  }
})
