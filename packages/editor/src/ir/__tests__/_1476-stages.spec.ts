/**
 * #1476 PROBE — print EVERY staged pass for the failing document, so the
 * divergence is attributed to a stage rather than guessed at.
 */
import { describe, it } from 'vitest'
import { IR } from '../PatternIR'
import { runPasses } from '../passes'
import { PASSES, stripStageMeta } from './helpers/stagesParity'
import { parseStrudel } from '../parseStrudel'
import { hasCorpusArchive, loadCorpus } from '../../visualEdit/miniSource/__tests__/evalHarness'

function shape(n: unknown): string {
  if (n === null || typeof n !== 'object') return String(n)
  const r = n as Record<string, unknown>
  const tag = r.tag as string | undefined
  if (!tag) return '?'
  const extra = r.unresolvedChain ? ` +chain=${JSON.stringify(String(r.unresolvedChain).slice(0, 70))}` : ''
  if (tag === 'Stack' && Array.isArray(r.tracks)) return `Stack[${r.tracks.map(shape).join(', ')}]${extra}`
  if (tag === 'Seq' && Array.isArray(r.children)) return `Seq(${r.children.length})${extra}`
  if (tag === 'Cycle' && Array.isArray(r.items)) return `Cycle(${r.items.length})${extra}`
  if (tag === 'Track') return `Track#${r.trackId}[${r.body ? shape(r.body) : 'EMPTY'}]${extra}`
  if (tag === 'Param') return `Param:${r.key}[${shape(r.body)}]${extra}`
  if (tag === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via
      ? `Code(via .${via.method})[${shape(via.inner)}]${extra}`
      : `Code(${JSON.stringify(String(r.code).slice(0, 90))})${extra}`
  }
  return `${tag}${extra}`
}

describe('#1476 stages', () => {
  it.skipIf(!hasCorpusArchive())('prints each pass', async () => {
    const docs = await loadCorpus()
    const d = docs.find((x) => x.name === '0/-7zrPK5Bii8_')!
    const passes = runPasses(IR.code(d.code), PASSES)
    const out = passes.map((p) => `-- ${p.name} --\n   ${shape(p.ir)}`).join('\n')
    // eslint-disable-next-line no-console
    console.log(`\n##### stages #####\n${out}\n-- MONO --\n   ${shape(stripStageMeta(parseStrudel(d.code)))}`)
  })
})
