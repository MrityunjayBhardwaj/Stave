/**
 * #1553 PROBE — the 3 documents `stagesParityCorpus` calls the DELIBERATE
 * comma-arm lane split. The fix was predicted to leave them diverging; it
 * does not. So: what are they, and does matching them revert the lane split?
 */
import { describe, it } from 'vitest'
import { IR } from '../PatternIR'
import { runRawStage, runMiniExpandedStage } from '../parseStrudelStages'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function shape(n: unknown): string {
  if (n === null || typeof n !== 'object') return String(n)
  const r = n as Record<string, unknown>
  const tag = r.tag as string | undefined
  if (!tag) return '?'
  if (tag === 'Stack' && Array.isArray(r.tracks)) return `Stack[${r.tracks.map(shape).join(', ')}]`
  if (tag === 'Seq' && Array.isArray(r.children)) return `Seq(${r.children.length})`
  if (tag === 'Cycle' && Array.isArray(r.items)) return `Cycle(${r.items.length})`
  if (tag === 'Track') return `Track#${r.trackId}[${r.body ? shape(r.body) : 'EMPTY'}]`
  if (tag === 'Param') return `Param:${r.key}[${shape(r.body)}]`
  if (tag === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via ? `Code(via .${via.method})[${shape(via.inner)}]` : `Code(${JSON.stringify(String(r.code).slice(0, 50))})`
  }
  return tag
}

const THREE = ['0/-NCnK2rm6qYf', '0/-q6dMecife1x', '0/2C7lDGa1IPsq']

describe('#1553 the three', () => {
  it.skipIf(!hasCorpusArchive())('what chain did they have?', async () => {
    const corpus = await loadEveryCorpusDocument()
    for (const name of THREE) {
      const d = corpus.find((x) => x.name === name)
      if (!d) { console.log(`MISSING ${name}`); continue }
      const me = runMiniExpandedStage(runRawStage(IR.code(d.code))) as unknown as Record<string, unknown>
      const mono = stripStageMeta(parseStrudel(d.code))
      const staged = stripStageMeta(pipeline(d.code))
      // eslint-disable-next-line no-console
      console.log(
        `\n##### ${name} (${d.code.length} bytes) #####\n${d.code.slice(0, 700)}\n` +
          `\n  MINI-EXPANDED tag=${me.tag} outerChain=${JSON.stringify(me.unresolvedChain)}\n` +
          `  mono:   ${shape(mono)}\n  staged: ${shape(staged)}\n` +
          `  PARITY: ${JSON.stringify(mono) === JSON.stringify(staged) ? 'ok' : 'BROKE'}`,
      )
    }
  })
})
